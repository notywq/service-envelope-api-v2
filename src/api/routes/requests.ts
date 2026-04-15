/**
 * Requests Routes
 * Handles tracking and resuming service requests
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';

const router = Router();

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
