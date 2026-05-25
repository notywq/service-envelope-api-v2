/**
 * Approvals Routes
 * Handles approval tokens and approval/denial of requests
 * Used primarily for email-based approval links
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { randomUUID } from 'crypto';
import { ServiceRequest } from '../../types/envelope.types.js';

const router = Router();

/**
 * Helper function to send payment notification email when approvals complete
 */
async function sendPaymentNotificationEmail(request: ServiceRequest) {
  try {
    const requestorEmail = request.envelopes.request.parameters?.initiatorEmail;
    const requestorName = request.envelopes.request.parameters?.initiatorName || 'Student';
    
    if (!requestorEmail) {
      appContext.logger.warn(`⚠️  No requestor email found for request ${request.id}`);
      return;
    }

    appContext.logger.info(`💌 Preparing payment notification email for ${requestorEmail}`);

    // Calculate total amount to pay
    const totalAmount = request.envelopes.payment.charges?.reduce((sum, charge) => sum + charge.amount, 0) || 0;
    const phase2PaymentLink = `http://localhost:5173/payment?requestId=${request.id}`;

    // Try to fetch service-specific payment template
    let htmlTemplate: string | undefined;
    
    try {
      // Step 1: Get service definition by type
      const service = await (appContext.stateManager as any).getServiceDefinitionByType(request.type);
      
      if (service && service.definition?.envelopes?.payment?.emailTemplateId) {
        const templateId = service.definition.envelopes.payment.emailTemplateId;
        
        // Step 2: Fetch the template from MongoDB
        const template = await (appContext.stateManager as any).getEmailTemplate(templateId);
        
        if (template && template.htmlBody) {
          htmlTemplate = template.htmlBody;
          appContext.logger.info(`✅ [TEMPLATE-LOOKUP-SUCCESS] Loaded custom payment template: ${templateId}`);
        }
      }
    } catch (error) {
      appContext.logger.debug(`📧 Could not load payment template: ${error}`);
    }

    // Replace placeholders if using custom template
    if (htmlTemplate) {
      htmlTemplate = htmlTemplate.replace(/\{\{firstName\}\}/g, request.envelopes.request.parameters?.firstName || requestorName);
      htmlTemplate = htmlTemplate.replace(/\{\{requestId\}\}/g, request.id);
      htmlTemplate = htmlTemplate.replace(/\{\{totalAmount\}\}/g, totalAmount.toFixed(2));
      htmlTemplate = htmlTemplate.replace(/\{\{numberOfCopies\}\}/g, request.envelopes.request.parameters?.numberOfCopies || '');
      htmlTemplate = htmlTemplate.replace(/\{\{purpose\}\}/g, request.envelopes.request.parameters?.purpose || '');
      htmlTemplate = htmlTemplate.replace(/\{\{paymentLink\}\}/g, phase2PaymentLink);
    }

    // Use custom template if available
    const html = htmlTemplate || `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>✅ Request Approved - Payment Required</h2>
        <p>Hello ${requestorName},</p>
        <p>Your request has been approved. Please proceed with payment.</p>
        <p><a href="${phase2PaymentLink}" style="background-color: #1976d2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">💳 Proceed to Payment</a></p>
      </div>
    `;

    // Send email
    await appContext.emailService.sendEmail({
      to: requestorEmail,
      subject: 'Request Approved - Payment Required',
      html,
    });
    appContext.logger.info(`✅ Payment notification email sent to ${requestorEmail}`);

  } catch (error) {
    appContext.logger.error(`Failed to send payment notification email: ${(error as Error).message}`);
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
router.get('/admin/tokens/:requestId', async (req: Request, res: Response) => {
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

    if (new Date() > new Date(tokenData.expiresAt)) {
      return res.status(400).json({ error: 'Approval token expired' });
    }

    const request = await appContext.stateManager.loadRequest(tokenData.requestId);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
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
      appContext.logger.info(`✅ Approval complete for request ${tokenData.requestId} (${ruleType}) - resuming pipeline`);
      
      // Send payment notification email to requestor before resuming
      sendPaymentNotificationEmail(request);
      
      // Resume processing
      appContext.orchestrator.processRequest(request).subscribe({
        next: (result) => {
          appContext.logger.info(`📊 Request resumed after approval: ${result.id} -> ${result.overallStatus}`);
        },
        error: (err) => {
          appContext.logger.error(`❌ Error processing approved request: ${err.message}`);
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

    if (new Date() > new Date(tokenData.expiresAt)) {
      return res.status(400).json({ error: 'Approval token expired' });
    }

    const request = await appContext.stateManager.loadRequest(tokenData.requestId);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Update approval status
    const approver = request.envelopes.approval.approvers.find(a => a.id === tokenData.approverId);
    if (approver) {
      approver.status = 'denied';
      approver.comment = reason;
      approver.deniedAt = new Date().toISOString();
    }

    // Set to cancelled instead of failed
    request.envelopes.approval.status = 'cancelled';
    request.overallStatus = 'cancelled';
    request.lastUpdated = new Date().toISOString();
    request.history.push({
      status: 'cancelled',
      timestamp: new Date().toISOString(),
      envelope: 'approval',
      notes: `Denied by ${tokenData.approverId}. Reason: ${reason}`,
    });

    // Mark token as used
    await appContext.stateManager.markApprovalTokenAsUsed(token);

    // Save the request
    await appContext.stateManager.saveRequest(request);
    appContext.logger.info(`❌ Request cancelled: ${tokenData.requestId} by ${tokenData.approverId}`);

    // Send denial email to requestor
    try {
      const requestorEmail = request.envelopes.request.parameters?.email || request.initiator;
      const requestorName = `${request.envelopes.request.parameters?.firstName || ''} ${request.envelopes.request.parameters?.lastName || ''}`.trim();
      
      await appContext.emailService?.sendDenialEmail({
        requestorEmail,
        requestorName,
        requestId: tokenData.requestId,
        approverId: tokenData.approverId,
        reason,
        serviceType: request.type,
      });

      appContext.logger.info(`📧 Denial email sent to ${requestorEmail} for request ${tokenData.requestId}`);
    } catch (emailError) {
      appContext.logger.warn(`⚠️ Failed to send denial email: ${emailError}`);
      // Don't fail the denial just because email didn't send
    }

    res.json({
      requestId: tokenData.requestId,
      status: 'cancelled',
      message: 'Request has been cancelled and requestor has been notified',
      reason,
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

    if (new Date() > new Date(tokenData.expiresAt)) {
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

    const isExpired = new Date() > new Date(tokenData.expiresAt);

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
