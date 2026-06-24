/**
 * Approvals Routes
 * Handles approval tokens and approval/denial of requests
 * Used primarily for email-based approval links
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { randomUUID } from 'crypto';
import { resolveRequesterEmail } from '../../utils/request-email.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function evaluateApprovalRulesAfterDecision(approval: any): {
  complete: boolean;
  failed: boolean;
  message: string;
} {
  const approvers = approval?.approvers || [];
  const rules = approval?.approvalRules || {};
  const { type: ruleType, specificApprover, requiredApprovers = [], atLeastOneOf = [] } = rules;
  const isApproved = (email: string) => approvers.some((a: any) => a.id === email && a.status === 'approved');
  const isDenied = (email: string) => approvers.some((a: any) => a.id === email && a.status === 'denied');
  const anyApproved = approvers.some((a: any) => a.status === 'approved');
  const allDecided = approvers.length > 0 && approvers.every((a: any) => ['approved', 'denied'].includes(a.status));

  switch (ruleType) {
    case 'all_must_approve':
      if (approvers.some((a: any) => a.status === 'denied')) {
        return { complete: false, failed: true, message: 'A required approver denied the request' };
      }
      return {
        complete: approvers.length > 0 && approvers.every((a: any) => a.status === 'approved'),
        failed: false,
        message: 'Awaiting all required approvers',
      };

    case 'any_one':
      if (anyApproved) {
        return { complete: true, failed: false, message: 'At least one approver approved' };
      }
      if (allDecided) {
        return { complete: false, failed: true, message: 'All eligible approvers denied the request' };
      }
      return { complete: false, failed: false, message: 'Awaiting at least one approval' };

    case 'specific_approver': {
      const specific = approvers.find((a: any) => a.id === specificApprover);
      if (specific?.status === 'denied') {
        return { complete: false, failed: true, message: `Required approver ${specificApprover} denied the request` };
      }
      return {
        complete: specific?.status === 'approved',
        failed: false,
        message: `Awaiting approval from ${specificApprover}`,
      };
    }

    case 'complex': {
      if (requiredApprovers.some((email: string) => isDenied(email))) {
        return { complete: false, failed: true, message: 'A required approver denied the request' };
      }

      const allRequiredApproved = requiredApprovers.every((email: string) => isApproved(email));
      const atLeastOneApproved = atLeastOneOf.length === 0 || atLeastOneOf.some((email: string) => isApproved(email));
      if (allRequiredApproved && atLeastOneApproved) {
        return { complete: true, failed: false, message: 'All required approval conditions were met' };
      }

      const atLeastOneImpossible =
        atLeastOneOf.length > 0 &&
        atLeastOneOf.every((email: string) => isDenied(email));
      if (atLeastOneImpossible) {
        return { complete: false, failed: true, message: 'All delegated approver options denied the request' };
      }

      return { complete: false, failed: false, message: 'Approval conditions are still pending' };
    }

    default:
      if (approvers.some((a: any) => a.status === 'denied')) {
        return { complete: false, failed: true, message: 'An approver denied the request' };
      }
      return {
        complete: approvers.length > 0 && approvers.every((a: any) => a.status === 'approved'),
        failed: false,
        message: 'Awaiting approvals',
      };
  }
}

function isApprovalTokenExpired(expiresAt: any): boolean {
  if (!expiresAt) {
    return false; // expiryHours: 0 => non-expiring token
  }
  return new Date() > new Date(expiresAt);
}

/**
 * Substitute {{variables}} in text with context values.
 */
function substituteTemplateVariables(text: string, context: Record<string, any>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return context[key] !== undefined && context[key] !== null ? String(context[key]) : match;
  });
}

/**
 * Send denial/cancellation notification via Mongo email templates.
 * Resolution order: envelope-configured cancel template -> service-specific generic -> global generic.
 */
async function sendDenialNotificationEmail(request: any, reason: string, approverId: string): Promise<void> {
  try {
    const requestParams = request.envelopes?.request?.parameters || {};
    const recipient = resolveRequesterEmail(request);
    if (!recipient) {
      appContext.logger.warn(`[DENIAL-EMAIL] No requestor email for request ${request.id}`);
      return;
    }

    const serviceDefinition = await appContext.stateManager.getServiceDefinitionByType(request.type);
    const envs = serviceDefinition?.envelopes || serviceDefinition?.definition?.envelopes || {};
    const configuredCancelTemplate = envs?.approval?.emailTemplateCancelEnvelope;
    const defaultCancelTemplate = envs?.approval?.defaultEmailTemplateCancelEnvelope;

    const candidateNames = [
      configuredCancelTemplate,
      defaultCancelTemplate,
      `${request.type}-request-denied`,
      'request-denied',
      `${request.type}-request-cancelled`,
      'request-cancelled',
    ].filter((name): name is string => !!name);

    let template: any = null;
    for (const name of [...new Set(candidateNames)]) {
      template = await appContext.stateManager.getEmailTemplate(name)
        || await appContext.stateManager.getEmailTemplateByName(name);
      if (template) {
        appContext.logger.info(`[DENIAL-EMAIL] Using template: ${name}`);
        break;
      }
    }

    if (!template) {
      appContext.logger.warn(`[DENIAL-EMAIL] No template found from candidates: ${candidateNames.join(', ')}`);
      return;
    }

    const serviceData = requestParams.serviceData || {};
    const context = {
      ...serviceData,
      ...requestParams,
      requestId: request.id,
      serviceType: request.type,
      studentId: requestParams.studentId || '',
      firstName: requestParams.firstName || '',
      lastName: requestParams.lastName || '',
      email: recipient,
      approverId,
      reason,
      cancellationReason: reason,
      failedTask: 'Approval Process',
      failureDetails: reason,
      currentTimestamp: new Date().toISOString(),
    };

    const subject = substituteTemplateVariables(template.subject, context);
    const html = substituteTemplateVariables(template.htmlBody, context);

    const sent = await appContext.emailService.sendEmail({
      to: recipient,
      subject,
      html,
    });

    if (!sent) {
      appContext.logger.warn(`[DENIAL-EMAIL] Send returned false for ${recipient}`);
    }
  } catch (error) {
    appContext.logger.warn(`[DENIAL-EMAIL] Failed to send denial email: ${error}`);
  }
}

/**
 * Generate an approval token for a request
 * This is called internally when a request enters approval envelope
 */
export async function generateApprovalToken(requestId: string, approverId: string, expiryHours: number = 24): Promise<string> {
  const token = randomUUID();
  await appContext.stateManager.saveApprovalToken(token, requestId, approverId, expiryHours);
  appContext.logger.info(`🔐 Generated approval token for request ${requestId}`);
  return token;
}

/**
 * GET /api/approvals/admin/tokens/:requestId
 * Admin endpoint to get all approval tokens for a request (for testing/debugging)
 */
router.get('/admin/tokens/:requestId', requireAuth({ roles: ['admin'] }), async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    
    const tokens = await appContext.stateManager.getApprovalTokensByRequest(requestId);

    if (tokens.length === 0) {
      return res.status(404).json({ error: 'No approval tokens found for this request', requestId });
    }

    const tokenList = tokens.map((t: any) => ({
      token: t.token,
      approverId: t.approverId,
      requestId: t.requestId,
      used: t.used || false,
      expiresAt: t.expiresAt,
      createdAt: t.createdAt,
    }));

    res.json({
      requestId,
      count: tokens.length,
      tokens: tokenList,
    });
  } catch (error) {
    appContext.logger.error('Error fetching approval tokens:', error);
    res.status(500).json({ error: 'Failed to fetch approval tokens' });
  }
});

/**
 * POST /api/approvals/:token/approve
 * Approve a request using token (from email link)
 */
router.post('/:token/approve', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { comment } = req.body;

    const tokenData = await appContext.stateManager.getApprovalToken(token);

    if (!tokenData) {
      return res.status(404).json({ error: 'Approval token not found' });
    }

    if (tokenData.used) {
      return res.status(400).json({ error: 'Approval token already used' });
    }

    if (isApprovalTokenExpired(tokenData.expiresAt)) {
      return res.status(400).json({ error: 'Approval token expired' });
    }

    const request = await appContext.stateManager.loadRequest(tokenData.requestId);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (['completed', 'cancelled', 'failed'].includes(request.envelopes.approval.status)) {
      return res.status(409).json({ error: 'Approval stage is already finalized for this request' });
    }

    // Update approval status
    const approver = request.envelopes.approval.approvers.find(a => a.id === tokenData.approverId);
    if (approver) {
      approver.status = 'approved';
      approver.approvedAt = new Date().toISOString();
      approver.comment = comment;
    }

    // Check approval rule based on rule type
    const { type: ruleType, specificApprover, requiredApprovers = [], atLeastOneOf = [] } = request.envelopes.approval.approvalRules;
    let approvalComplete = false;
    let approvalMessage = '';

    switch (ruleType) {
      case 'all_must_approve':
        approvalComplete = request.envelopes.approval.approvers.every(a => a.status === 'approved');
        approvalMessage = approvalComplete ? 'All approvers approved' : 'Awaiting other approvers';
        break;
      case 'any_one':
        approvalComplete = request.envelopes.approval.approvers.some(a => a.status === 'approved');
        approvalMessage = 'At least one approver approved - processing will resume';
        break;
      case 'specific_approver':
        const specificApprovedApprover = request.envelopes.approval.approvers.find(a => a.id === specificApprover);
        approvalComplete = specificApprovedApprover?.status === 'approved';
        approvalMessage = approvalComplete ? `Approved by required approver (${specificApprover})` : 'Awaiting approval from required approver';
        break;
      case 'complex': {
        // Complex rule: all required approvers must approve AND at least one from atLeastOneOf must approve
        const allRequiredApproved = requiredApprovers.every(email => 
          request.envelopes.approval.approvers.some(a => a.id === email && a.status === 'approved')
        );
        const atLeastOneApproved = atLeastOneOf.length === 0 || atLeastOneOf.some(email =>
          request.envelopes.approval.approvers.some(a => a.id === email && a.status === 'approved')
        );
        
        approvalComplete = allRequiredApproved && atLeastOneApproved;
        
        const remainingRequired = requiredApprovers.filter(email => 
          !request.envelopes.approval.approvers.some(a => a.id === email && a.status === 'approved')
        );
        const remainingAtLeastOne = atLeastOneOf.filter(email =>
          !request.envelopes.approval.approvers.some(a => a.id === email && a.status === 'approved')
        );
        
        if (approvalComplete) {
          approvalMessage = 'All required approvers and at least one delegated approver approved';
        } else if (remainingRequired.length > 0) {
          approvalMessage = `Awaiting approval from required approvers: ${remainingRequired.join(', ')}`;
        } else if (remainingAtLeastOne.length === atLeastOneOf.length) {
          approvalMessage = `Awaiting approval from at least one of: ${atLeastOneOf.join(', ')}`;
        } else {
          approvalMessage = 'Approval in progress';
        }
        break;
      }
      default:
        approvalComplete = request.envelopes.approval.approvers.every(a => a.status === 'approved');
        approvalMessage = 'Awaiting approvals';
    }

    if (approvalComplete) {
      request.envelopes.approval.status = 'completed';
      request.overallStatus = 'processing';
    } else {
      request.envelopes.approval.status = 'pending_external';
      request.overallStatus = 'pending_approval';
    }
    
    request.lastUpdated = new Date().toISOString();
    request.history.push({
      status: 'approved',
      timestamp: new Date().toISOString(),
      envelope: 'approval',
      notes: `Approved by ${tokenData.approverId}. ${comment ? `Comment: ${comment}` : ''}`,
    });

    // Mark token as used
    await appContext.stateManager.markApprovalTokenAsUsed(token);

    // Save the request
    await appContext.stateManager.saveRequest(request);
    appContext.logger.info(`✅ Request approved: ${tokenData.requestId} by ${tokenData.approverId}`);

    // Resume if approval is complete
    if (approvalComplete) {
      appContext.logger.info(`✅ Approval complete for request ${tokenData.requestId} (${ruleType})`);

      // Acquire lock and auto-resume orchestrator
      const lock = await appContext.requestProcessingLock.acquire(tokenData.requestId);
      
      appContext.orchestrator.processRequest(request).subscribe({
        next: (result) => {
          appContext.logger.info(`📊 Request auto-resumed after approval: ${result.id} -> ${result.overallStatus}`);
        },
        error: (err) => {
          appContext.logger.error(`❌ Error in auto-resume: ${err.message}`);
          lock.release();
        },
        complete: () => {
          lock.release();
          appContext.logger.info(`   ℹ️  Orchestrator completed, lock released`);
        },
      });
    } else {
      appContext.logger.info(`⏳ Approval pending for request ${tokenData.requestId} - waiting (${ruleType})`);
    }

    res.json({
      requestId: tokenData.requestId,
      status: 'approved',
      message: approvalMessage,
      approvalComplete,
      rule: ruleType,
      nextStatus: approvalComplete ? 'processing' : 'pending',
    });
  } catch (error) {
    appContext.logger.error('Error approving request:', error);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

/**
 * POST /api/approvals/:token/deny
 * Deny a request using token (from email link)
 */
router.post('/:token/deny', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Reason for denial required' });
    }

    const tokenData = await appContext.stateManager.getApprovalToken(token);

    if (!tokenData) {
      return res.status(404).json({ error: 'Approval token not found' });
    }

    if (tokenData.used) {
      return res.status(400).json({ error: 'Approval token already used' });
    }

    if (isApprovalTokenExpired(tokenData.expiresAt)) {
      return res.status(400).json({ error: 'Approval token expired' });
    }

    const request = await appContext.stateManager.loadRequest(tokenData.requestId);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.envelopes.approval.status === 'completed' || request.envelopes.approval.status === 'cancelled') {
      return res.status(409).json({ error: 'Approval stage is already finalized for this request' });
    }

    // Update approval status
    const approver = request.envelopes.approval.approvers.find(a => a.id === tokenData.approverId);
    if (approver) {
      approver.status = 'denied';
      approver.comment = reason;
      approver.deniedAt = new Date().toISOString();
    }

    const approvalOutcome = evaluateApprovalRulesAfterDecision(request.envelopes.approval);
    request.envelopes.approval.status = approvalOutcome.failed
      ? 'failed'
      : approvalOutcome.complete
        ? 'completed'
        : 'pending_external';
    request.overallStatus = approvalOutcome.failed
      ? 'cancelled'
      : approvalOutcome.complete
        ? 'processing'
        : 'pending_approval';
    request.lastUpdated = new Date().toISOString();
    request.history.push({
      status: approvalOutcome.failed ? 'approval_failed' : 'denied',
      timestamp: new Date().toISOString(),
      envelope: 'approval',
      notes: `Denied by ${tokenData.approverId}. Reason: ${reason}`,
    });

    // Mark token as used
    await appContext.stateManager.markApprovalTokenAsUsed(token);

    // Save the request
    await appContext.stateManager.saveRequest(request);
    appContext.logger.info(`❌ Request cancelled: ${tokenData.requestId} by ${tokenData.approverId}`);

    if (approvalOutcome.failed) {
      // Send denial email to requestor via template resolver
      await sendDenialNotificationEmail(request, reason, tokenData.approverId);
    }

    res.json({
      requestId: tokenData.requestId,
      status: request.overallStatus,
      message: approvalOutcome.failed
        ? 'Request has failed approval and requestor has been notified'
        : approvalOutcome.message,
      reason,
      approvalComplete: approvalOutcome.complete,
      approvalFailed: approvalOutcome.failed,
    });
  } catch (error) {
    appContext.logger.error('Error denying request:', error);
    res.status(500).json({ error: 'Failed to deny request' });
  }
});

/**
 * GET /api/approvals/:token/request
 * Get request details for approval review (used by Phase 2 UI)
 */
router.get('/:token/request', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const tokenData = await appContext.stateManager.getApprovalToken(token);

    if (!tokenData) {
      return res.status(404).json({ error: 'Approval token not found' });
    }

    if (isApprovalTokenExpired(tokenData.expiresAt)) {
      return res.status(400).json({ error: 'Approval token expired' });
    }

    const request = await appContext.stateManager.loadRequest(tokenData.requestId);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Return request details for UI display
    res.json({
      requestId: request.id,
      type: request.type,
      status: request.overallStatus,
      approverId: tokenData.approverId,
      used: tokenData.used,
      expiresAt: tokenData.expiresAt,
      parameters: request.envelopes.request.parameters,
      approvalStatus: request.envelopes.approval.status,
      approvers: request.envelopes.approval.approvers.map(a => ({
        id: a.id,
        status: a.status,
      })),
    });
  } catch (error) {
    appContext.logger.error('Error fetching request for approval:', error);
    res.status(500).json({ error: 'Failed to fetch request details' });
  }
});

/**
 * GET /api/approvals/:token
 * Check approval token status
 */
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const tokenData = await appContext.stateManager.getApprovalToken(token);

    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const isExpired = isApprovalTokenExpired(tokenData.expiresAt);

    res.json({
      token,
      requestId: tokenData.requestId,
      approverId: tokenData.approverId,
      used: tokenData.used,
      expired: isExpired,
      expiresAt: tokenData.expiresAt,
      createdAt: tokenData.createdAt,
    });
  } catch (error) {
    appContext.logger.error('Error checking token:', error);
    res.status(500).json({ error: 'Failed to check token' });
  }
});

export default router;
