/**
 * Requests Routes
 * Handles tracking and resuming service requests
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ParameterValidator } from '../../utils/parameter-validator.js';
import { resolveRequesterEmail } from '../../utils/request-email.js';
import { paginationMeta, parsePagination } from '../../utils/pagination.js';

function normalizeEmail(email: unknown): string | null {
  return typeof email === 'string' && email.trim()
    ? email.trim().toLowerCase()
    : null;
}

function isRequesterRole(req: Request): boolean {
  return req.user?.role === 'requester';
}

function requestBelongsToAuthenticatedUser(req: Request, serviceRequest: any): boolean {
  if (!isRequesterRole(req)) {
    return true;
  }

  const userEmail = normalizeEmail(req.user?.email);
  const requesterEmail = normalizeEmail(resolveRequesterEmail(serviceRequest));
  return Boolean(userEmail && requesterEmail && userEmail === requesterEmail);
}

function logRequesterPermissionDenied(req: Request, reason: string, requestId?: string) {
  appContext.logger.warn(JSON.stringify({
    event: 'api_permission_denied',
    reason,
    method: req.method,
    path: req.originalUrl || req.path,
    email: req.user?.email,
    role: req.user?.role,
    requestId,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Build approver list from approval rules.
 * Ensures all relevant approvers receive tokens across all rule types.
 */
function transformApprovalRulesToApprovers(approvalRules: any): any[] {
  const approverSet = new Set<string>();

  if (Array.isArray(approvalRules?.requiredApprovers)) {
    approvalRules.requiredApprovers.forEach((email: string) => approverSet.add(email));
  }

  if (Array.isArray(approvalRules?.atLeastOneOf)) {
    approvalRules.atLeastOneOf.forEach((email: string) => approverSet.add(email));
  }

  if (typeof approvalRules?.specificApprover === 'string' && approvalRules.specificApprover.trim()) {
    approverSet.add(approvalRules.specificApprover);
  }

  return Array.from(approverSet).map((email: string) => ({
    id: email,
    email,
    role: 'approver',
    status: 'pending',
  }));
}

const router = Router();

/**
 * POST /api/requests
 * Submit a new service request
 * This creates a request and starts the 6-envelope pipeline
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { type, serviceId, initiator, parameters } = req.body;

    // Validate required fields
    if ((!type && !serviceId) || !initiator || !parameters) {
      return res.status(400).json({
        error: 'Missing required fields: (type or serviceId), initiator, parameters',
      });
    }

    if (isRequesterRole(req)) {
      const requesterEmail = normalizeEmail(resolveRequesterEmail({
        initiator,
        envelopes: {
          request: {
            parameters,
          },
        },
      } as any));
      const userEmail = normalizeEmail(req.user?.email);

      if (!userEmail || requesterEmail !== userEmail) {
        logRequesterPermissionDenied(req, 'requester_submit_email_mismatch');
        return res.status(403).json({
          error: 'Requester accounts can only submit requests for their authenticated email',
        });
      }
    }

    // Resolve service definition using either type or serviceId.
    // Canonical request.type remains the service definition type for backward compatibility.
    let serviceDefinition: any = null;

    if (serviceId) {
      serviceDefinition = await appContext.stateManager.getServiceDefinition(serviceId);
    }

    if (!serviceDefinition && type) {
      serviceDefinition = await appContext.stateManager.getServiceDefinitionByType(type);
    }

    if (!serviceDefinition) {
      return res.status(400).json({
        error: `Service not found for identifier: ${serviceId || type}`,
      });
    }

    if (serviceId && type && serviceDefinition.type !== type) {
      return res.status(400).json({
        error: `Identifier mismatch: serviceId "${serviceId}" is type "${serviceDefinition.type}", not "${type}"`,
      });
    }

    const resolvedType = serviceDefinition.type || type;
    const envelopeDefinitions = serviceDefinition.definition?.envelopes || serviceDefinition.envelopes || {};
    const isEnvelopeRequired = (envelopeName: string): boolean =>
      Boolean(envelopeDefinitions?.[envelopeName]) &&
      envelopeDefinitions[envelopeName].required !== false;

    // Validate parameters against service definition schema
    const validator = new ParameterValidator(appContext.logger);
    const validationResult = validator.validateAgainstSchema(parameters, serviceDefinition);
    const expectedParameterSchema =
      serviceDefinition?.envelopes?.request?.parameters ||
      serviceDefinition?.definition?.envelopes?.request?.parameters || {};
    if (!validationResult.isValid) {
      return res.status(400).json({
        error: 'Invalid parameters',
        validationErrors: validationResult.errors,
        validationDetails: validationResult.details || [],
        schemaContext: {
          serviceId: serviceDefinition.id,
          serviceType: serviceDefinition.type,
          expectedParameters: Object.keys(expectedParameterSchema),
        },
      });
    }

    // Create request ID (format: REQ-YYYYMMDD-###)
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const requestId = `REQ-${dateStr}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

    // Create initial request with all 6 envelopes
    const newRequest = {
      id: requestId,
      type: resolvedType,
      initiator,
      overallStatus: 'queued',
      createdAt: now.toISOString(),
      lastUpdated: now.toISOString(),
      history: [
        {
          status: 'queued',
          timestamp: now.toISOString(),
          envelope: 'request',
          notes: 'Request submitted',
        },
      ],
      envelopes: {
        request: {
          status: 'completed',
          parameters,
          timestamp: now.toISOString(),
          required: true,
        },
        approval: {
          status: 'pending',
          // Transform approval rules into Approver objects
          approvers: transformApprovalRulesToApprovers(
            envelopeDefinitions?.approval?.approvalRules || {}
          ),
          approvalRules: envelopeDefinitions?.approval?.approvalRules || {},
          expiryHours: envelopeDefinitions?.approval?.expiryHours,
          timestamp: now.toISOString(),
          required: isEnvelopeRequired('approval') || envelopeDefinitions?.approval?.requiresApproval === true,
        },
        payment: {
          status: 'pending',
          charges: envelopeDefinitions?.payment?.charges || [],
          paymentMethod: 'credit_card',
          timestamp: now.toISOString(),
          required: isEnvelopeRequired('payment'),
        },
        processing: {
          status: 'pending',
          tasks: envelopeDefinitions?.processing?.tasks || [],
          stopOnFailure: envelopeDefinitions?.processing?.stopOnFailure !== false,
          timestamp: now.toISOString(),
          required: isEnvelopeRequired('processing'),
        },
        delivery: {
          status: 'pending',  // Delivery details submitted separately
          // Store all available delivery methods from service definition
          availableMethods: envelopeDefinitions?.delivery?.deliveryMethods || {},
          method: undefined,  // User provides via POST /api/delivery/{requestId}/details
          details: undefined,
          deliveryAttempts: 0,
          deliveryHistory: [],  // Initialize empty history array for tracking status updates
          currentStatus: undefined,
          currentStatusCode: undefined,
          lastStatusUpdate: undefined,
          timestamp: now.toISOString(),
          required: isEnvelopeRequired('delivery'),
        },
        feedback: {
          status: 'pending',
          expiryDays: envelopeDefinitions?.feedback?.expiryDays || 7,
          autoCloseAfterHours: envelopeDefinitions?.feedback?.autoCloseAfterHours ?? 24,
          emailTemplateId: envelopeDefinitions?.feedback?.emailTemplateId,
          timestamp: now.toISOString(),
          required: isEnvelopeRequired('feedback'),
        },
      },
    };

    // Save to MongoDB
    await appContext.stateManager.saveRequest(newRequest as any);
    appContext.logger.info(
      `📝 New request created: ${requestId} | Type: ${resolvedType} | ServiceId: ${serviceDefinition.id || serviceId || 'n/a'}`
    );

    // Acquire lock and start orchestration pipeline
    const lock = await appContext.requestProcessingLock.acquire(requestId);
    
    appContext.orchestrator.processRequest(newRequest as any).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request processing: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error processing request: ${err.message}`);
        lock.release();
      },
      complete: () => {
        lock.release();
        appContext.logger.info(`   ℹ️  Orchestrator completed, lock released`);
      },
    });

    res.status(201).json({
      success: true,
      requestId: newRequest.id,
      type: resolvedType,
      serviceId: serviceDefinition.id,
      status: newRequest.overallStatus,
      envelopes: newRequest.envelopes,
      message: 'Request submitted successfully. Processing initiated.',
    });
  } catch (error: any) {
    appContext.logger.error('Error creating request:', error);
    res.status(500).json({
      error: 'Failed to create request: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/requests
 * List all requests with pagination and filtering
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    if (isRequesterRole(req)) {
      logRequesterPermissionDenied(req, 'requester_list_all_requests_blocked');
      return res.status(403).json({ error: 'Requester accounts cannot list all requests' });
    }

    const { limit, offset } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const status = req.query.status as string;
    const type = req.query.type as string;
    const filters = { status, type };

    let requests;

    if (status && !type) {
      requests = await appContext.stateManager.findByStatus(status, limit, offset);
    } else if (type) {
      requests = await appContext.stateManager.listRequests(limit, offset, filters);
    } else {
      requests = await appContext.stateManager.listRequests(limit, offset);
    }

    const total = await appContext.stateManager.countRequests(filters);
    const meta = paginationMeta(total, requests.length, limit, offset);

    res.json({
      total: meta.total,
      count: meta.count,
      limit,
      offset,
      hasMore: meta.hasMore,
      nextOffset: meta.nextOffset,
      requests: requests.map(r => ({
        id: r.id,
        type: r.type,
        initiator: r.initiator,
        status: r.overallStatus,
        createdAt: r.createdAt,
        lastUpdated: r.lastUpdated,
      })),
    });
  } catch (error) {
    appContext.logger.error('Error listing requests:', error);
    res.status(500).json({ error: 'Failed to list requests' });
  }
});

/**
 * GET /api/requests/:requestId
 * Get request details and full history
 */
router.get('/:requestId', async (req: Request, res: Response) => {
  try {
    const request = await appContext.stateManager.loadRequest(req.params.requestId);

    if (!request) {
      return res.status(404).json({ error: `Request ${req.params.requestId} not found` });
    }

    if (!requestBelongsToAuthenticatedUser(req, request)) {
      logRequesterPermissionDenied(req, 'requester_request_detail_not_owner', req.params.requestId);
      return res.status(403).json({ error: 'Requester accounts can only access their own requests' });
    }

    res.json({
      id: request.id,
      type: request.type,
      initiator: request.initiator,
      status: request.overallStatus,
      createdAt: request.createdAt,
      lastUpdated: request.lastUpdated,
      envelopes: request.envelopes,
      history: request.history,
    });
  } catch (error) {
    appContext.logger.error('Error getting request:', error);
    res.status(500).json({ error: 'Failed to get request' });
  }
});

/**
 * POST /api/requests/:requestId/resume
 * Resume a request that was paused (e.g., waiting for approval)
 * This is called after an approval is given, payment is confirmed, etc.
 */
router.post('/:requestId/resume', async (req: Request, res: Response) => {
  try {
    const request = await appContext.stateManager.loadRequest(req.params.requestId);

    if (!request) {
      return res.status(404).json({ error: `Request ${req.params.requestId} not found` });
    }

    if (isRequesterRole(req)) {
      logRequesterPermissionDenied(req, 'requester_resume_request_blocked', req.params.requestId);
      return res.status(403).json({ error: 'Requester accounts cannot resume requests directly' });
    }

    appContext.logger.info(`▶️  Resuming request: ${req.params.requestId}`);

    // Resume orchestration
    appContext.orchestrator.processRequest(request).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request resumed: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error resuming request: ${err.message}`);
      },
    });

    res.json({
      requestId: req.params.requestId,
      message: 'Request resumed',
      status: 'processing',
    });
  } catch (error) {
    appContext.logger.error('Error resuming request:', error);
    res.status(500).json({ error: 'Failed to resume request' });
  }
});

/**
 * DELETE /api/requests/:requestId
 * Delete/cancel a request
 */
router.delete('/:requestId', async (req: Request, res: Response) => {
  try {
    const request = await appContext.stateManager.loadRequest(req.params.requestId);

    if (!request) {
      return res.status(404).json({ error: `Request ${req.params.requestId} not found` });
    }

    if (isRequesterRole(req)) {
      logRequesterPermissionDenied(req, 'requester_cancel_request_blocked', req.params.requestId);
      return res.status(403).json({ error: 'Requester accounts cannot cancel requests via API' });
    }

    // Mark as cancelled instead of deleting
    request.overallStatus = 'cancelled';
    request.lastUpdated = new Date().toISOString();
    request.history.push({
      status: 'cancelled',
      timestamp: new Date().toISOString(),
      envelope: 'system',
      notes: 'Request cancelled via API',
    });

    await appContext.stateManager.saveRequest(request);
    appContext.logger.info(`✅ Request cancelled: ${req.params.requestId}`);

    res.json({
      requestId: req.params.requestId,
      status: 'cancelled',
      message: 'Request cancelled successfully',
    });
  } catch (error) {
    appContext.logger.error('Error cancelling request:', error);
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

/**
 * GET /api/requests/:requestId/history
 * Get detailed history of a request
 */
router.get('/:requestId/history', async (req: Request, res: Response) => {
  try {
    const request = await appContext.stateManager.loadRequest(req.params.requestId);

    if (!request) {
      return res.status(404).json({ error: `Request ${req.params.requestId} not found` });
    }

    if (!requestBelongsToAuthenticatedUser(req, request)) {
      logRequesterPermissionDenied(req, 'requester_request_history_not_owner', req.params.requestId);
      return res.status(403).json({ error: 'Requester accounts can only access their own request history' });
    }

    res.json({
      requestId: req.params.requestId,
      history: request.history,
      totalEntries: request.history.length,
    });
  } catch (error) {
    appContext.logger.error('Error getting history:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

export default router;
