/**
 * Approvals Routes
 * Handles approval tokens and approval/denial of requests
 * Used primarily for email-based approval links
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { randomUUID } from 'crypto';

const router = Router();

// In-memory approval token store (in production, use MongoDB)
// Format: { token: string, requestId: string, approverId: string, expiresAt: Date }
const approvalTokens = new Map<string, any>();

/**
 * Generate an approval token for a request
 * This is called internally when a request enters approval envelope
 */
export async function generateApprovalToken(requestId: string, approverId: string, expiryHours: number = 24): Promise<string> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  approvalTokens.set(token, {
    requestId,
    approverId,
    expiresAt,
    createdAt: new Date(),
    used: false,
  });

  appContext.logger.info(`🔐 Generated approval token for request ${requestId}`);
  return token;
}

/**
 * POST /api/approvals/:token/approve
 * Approve a request using token (from email link)
 */
router.post('/:token/approve', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { comment } = req.body;

    const tokenData = approvalTokens.get(token);

    if (!tokenData) {
      return res.status(404).json({ error: 'Approval token not found' });
    }

    if (tokenData.used) {
      return res.status(400).json({ error: 'Approval token already used' });
    }

    if (new Date() > tokenData.expiresAt) {
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

    request.envelopes.approval.status = 'completed';
    request.lastUpdated = new Date().toISOString();
    request.history.push({
      status: 'approved',
      timestamp: new Date().toISOString(),
      envelope: 'approval',
      notes: `Approved by ${tokenData.approverId}. ${comment ? `Comment: ${comment}` : ''}`,
    });

    // Mark token as used
    tokenData.used = true;

    // Save the request
    await appContext.stateManager.saveRequest(request);
    appContext.logger.info(`✅ Request approved: ${tokenData.requestId} by ${tokenData.approverId}`);

    // Resume processing
    appContext.orchestrator.processRequest(request).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request resumed after approval: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error processing approved request: ${err.message}`);
      },
    });

    res.json({
      requestId: tokenData.requestId,
      status: 'approved',
      message: 'Request approved successfully',
      nextStatus: 'processing',
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

    const tokenData = approvalTokens.get(token);

    if (!tokenData) {
      return res.status(404).json({ error: 'Approval token not found' });
    }

    if (tokenData.used) {
      return res.status(400).json({ error: 'Approval token already used' });
    }

    if (new Date() > tokenData.expiresAt) {
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
    }

    request.envelopes.approval.status = 'failed';
    request.overallStatus = 'failed';
    request.lastUpdated = new Date().toISOString();
    request.history.push({
      status: 'denied',
      timestamp: new Date().toISOString(),
      envelope: 'approval',
      notes: `Denied by ${tokenData.approverId}. Reason: ${reason}`,
    });

    // Mark token as used
    tokenData.used = true;

    // Save the request
    await appContext.stateManager.saveRequest(request);
    appContext.logger.info(`❌ Request denied: ${tokenData.requestId} by ${tokenData.approverId}`);

    res.json({
      requestId: tokenData.requestId,
      status: 'denied',
      message: 'Request denied',
      reason,
    });
  } catch (error) {
    appContext.logger.error('Error denying request:', error);
    res.status(500).json({ error: 'Failed to deny request' });
  }
});

/**
 * GET /api/approvals/:token
 * Check approval token status
 */
router.get('/:token', (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const tokenData = approvalTokens.get(token);

    if (!tokenData) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const isExpired = new Date() > tokenData.expiresAt;

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
