/**
 * Requests Routes
 * Handles tracking and resuming service requests
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ParameterValidator } from '../../utils/parameter-validator.js';

/**
 * Helper function to transform approval rules into Approver objects
 * Converts approvalRules.requiredApprovers (string array) into Approver objects
 */
function transformApprovalRulesToApprovers(approvalRules: any): any[] {
  if (!approvalRules?.requiredApprovers || !Array.isArray(approvalRules.requiredApprovers)) {
    return [];
  }

  return approvalRules.requiredApprovers.map((role: string) => ({
    id: role,
    role: role,
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
    const { type, initiator, parameters } = req.body;

    // Validate required fields
    if (!type || !initiator || !parameters) {
      return res.status(400).json({
        error: 'Missing required fields: type, initiator, parameters',
      });
    }

    // Get service definition from registry/MongoDB
    const serviceDefinition = await appContext.stateManager.getServiceDefinitionByType(type);
    if (!serviceDefinition) {
      return res.status(400).json({
        error: `Service type "${type}" not found`,
      });
    }

    // Validate parameters against service definition schema
    const validator = new ParameterValidator(appContext.logger);
    const validationResult = validator.validateAgainstSchema(parameters, serviceDefinition);
    if (!validationResult.isValid) {
      return res.status(400).json({
        error: 'Invalid parameters',
        validationErrors: validationResult.errors,
      });
    }

    // Create request ID (format: REQ-YYYYMMDD-###)
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const requestId = `REQ-${dateStr}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;

    // Create initial request with all 6 envelopes
    const newRequest = {
      id: requestId,
      type,
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
            serviceDefinition.definition?.envelopes?.approval?.approvalRules || {}
          ),
          approvalRules: serviceDefinition.definition?.envelopes?.approval?.approvalRules || {},
          timestamp: now.toISOString(),
          required: (serviceDefinition.definition?.envelopes?.approval?.required !== false) || (serviceDefinition.definition?.envelopes?.approval?.requiresApproval === true),
        },
        payment: {
          status: 'pending',
          charges: serviceDefinition.definition?.envelopes?.payment?.charges || [],
          paymentMethod: 'credit_card',
          timestamp: now.toISOString(),
          required: serviceDefinition.definition?.envelopes?.payment?.required !== false,
        },
        processing: {
          status: 'queued',
          tasks: serviceDefinition.definition?.envelopes?.processing?.tasks || [],
          timestamp: now.toISOString(),
          required: serviceDefinition.definition?.envelopes?.processing?.required !== false,
        },
        delivery: {
          status: 'queued',
          // Store all available delivery methods from service definition
          availableMethods: serviceDefinition.definition?.envelopes?.delivery?.deliveryMethods || {},
          method: undefined, // User selects method later
          details: undefined,
          deliveryAttempts: 0,
          timestamp: now.toISOString(),
          required: serviceDefinition.definition?.envelopes?.delivery?.required !== false,
        },
        feedback: {
          status: 'queued',
          expiryDays: serviceDefinition.definition?.envelopes?.feedback?.expiryDays || 7,
          emailTemplateId: serviceDefinition.definition?.envelopes?.feedback?.emailTemplateId,
          timestamp: now.toISOString(),
          required: serviceDefinition.definition?.envelopes?.feedback?.required !== false,
        },
      },
    };

    // Save to MongoDB
    await appContext.stateManager.saveRequest(newRequest as any);
    appContext.logger.info(`📝 New request created: ${requestId} | Type: ${type}`);

    // Start orchestration pipeline
    appContext.orchestrator.processRequest(newRequest as any).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request processing: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error processing request: ${err.message}`);
      },
    });

    res.status(201).json({
      success: true,
      requestId: newRequest.id,
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
    const limit = Math.min(parseInt(req.query.limit as string || '20'), 100);
    const offset = parseInt(req.query.offset as string || '0');
    const status = req.query.status as string;
    const type = req.query.type as string;

    let requests;

    if (status) {
      requests = await appContext.stateManager.findByStatus(status);
    } else if (type) {
      requests = await appContext.stateManager.findByType(type);
    } else {
      requests = await appContext.stateManager.listRequests(limit, offset);
    }

    const total = await appContext.stateManager.countRequests();

    res.json({
      total,
      count: requests.length,
      limit,
      offset,
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
