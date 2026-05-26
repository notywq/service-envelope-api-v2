/**
 * Delivery Status Update Routes
 * Simple API to update delivery progress and track status changes
 * Supports status updates: in_transit, out_for_delivery, received, failed, etc.
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';

const router = Router();

/**
 * POST /api/delivery-status/:requestId
 * Update delivery status with optional tracking information
 * 
 * Body:
 * {
 *   status: 'in_transit' | 'out_for_delivery' | 'received' | 'failed' | 'returned',
 *   notes?: 'Your tracking notes',
 *   trackingId?: 'Tracking reference',
 *   location?: 'Current location',
 *   timestamp?: 'ISO timestamp (default: now)'
 * }
 */
router.post('/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { status, notes, trackingId, location, timestamp } = req.body;

    // Validate required fields
    if (!requestId || !status) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['requestId', 'status'],
        validStatuses: ['in_transit', 'out_for_delivery', 'received', 'failed', 'returned']
      });
    }

    // Load request
    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    const delivery = request.envelopes.delivery;

    // Initialize deliveryHistory if not exists
    if (!delivery.deliveryHistory) {
      delivery.deliveryHistory = [];
    }

    // Add status update to history
    const statusUpdate = {
      status,
      notes: notes || '',
      trackingId: trackingId || delivery.details?.physical_mail?.trackingId,
      location: location || '',
      timestamp: timestamp || new Date().toISOString(),
      updateSequence: delivery.deliveryHistory.length + 1
    };

    delivery.deliveryHistory.push(statusUpdate);
    delivery.lastStatusUpdate = statusUpdate.timestamp;
    delivery.currentStatus = status;

    // If received, mark envelope as completed
    if (status === 'received') {
      delivery.status = 'completed';
      delivery.lastAttemptAt = new Date().toISOString();
      delivery.timestamp = new Date().toISOString();
      appContext.logger.info(`[DELIVERY-RECEIVED] Request ${requestId} | Document received | Delivered at: ${statusUpdate.timestamp}`);
    } else if (status === 'failed' || status === 'returned') {
      delivery.status = 'failed';
      appContext.logger.warn(`[DELIVERY-FAILED] Request ${requestId} | Status: ${status} | Notes: ${notes || 'N/A'}`);
    } else {
      // in_transit, out_for_delivery, etc.
      if (delivery.status !== 'in_progress') {
        delivery.status = 'in_progress';
      }
      appContext.logger.info(`[DELIVERY-UPDATE] Request ${requestId} | Status: ${status} | Location: ${location || 'N/A'}`);
    }

    // Save updated request
    await appContext.stateManager.saveRequest(request);

    res.json({
      requestId,
      message: `Delivery status updated to: ${status}`,
      delivery: {
        currentStatus: delivery.currentStatus,
        lastStatusUpdate: delivery.lastStatusUpdate,
        totalUpdates: delivery.deliveryHistory.length,
        envelopeStatus: delivery.status
      },
      statusUpdate
    });
  } catch (error) {
    appContext.logger.error(`[DELIVERY-ERROR] Failed to update delivery status:`, error);
    res.status(500).json({ error: 'Failed to update delivery status', details: (error as Error).message });
  }
});

/**
 * GET /api/delivery-status/:requestId/history
 * Get full delivery status history for a request
 */
router.get('/:requestId/history', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    const delivery = request.envelopes.delivery;
    const history = delivery.deliveryHistory || [];

    res.json({
      requestId,
      deliveryMethod: delivery.method,
      currentStatus: delivery.currentStatus || delivery.status,
      lastStatusUpdate: delivery.lastStatusUpdate,
      totalStatusUpdates: history.length,
      history: history.map((update: any) => ({
        sequence: update.updateSequence,
        status: update.status,
        timestamp: update.timestamp,
        location: update.location,
        notes: update.notes,
        trackingId: update.trackingId
      }))
    });
  } catch (error) {
    appContext.logger.error(`[DELIVERY-ERROR] Failed to fetch delivery history:`, error);
    res.status(500).json({ error: 'Failed to fetch delivery history', details: (error as Error).message });
  }
});

/**
 * GET /api/delivery-status/:requestId/current
 * Get current delivery status
 */
router.get('/:requestId/current', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    const delivery = request.envelopes.delivery;
    const latestUpdate = delivery.deliveryHistory?.[delivery.deliveryHistory.length - 1];

    res.json({
      requestId,
      deliveryMethod: delivery.method,
      envelopeStatus: delivery.status,
      currentStatus: delivery.currentStatus || delivery.status,
      lastStatusUpdate: delivery.lastStatusUpdate,
      lastUpdateDetails: latestUpdate ? {
        status: latestUpdate.status,
        timestamp: latestUpdate.timestamp,
        location: latestUpdate.location,
        notes: latestUpdate.notes,
        trackingId: latestUpdate.trackingId,
        sequence: latestUpdate.updateSequence
      } : null,
      deliveryAttempts: delivery.deliveryAttempts,
      lastAttemptAt: delivery.lastAttemptAt
    });
  } catch (error) {
    appContext.logger.error(`[DELIVERY-ERROR] Failed to fetch current delivery status:`, error);
    res.status(500).json({ error: 'Failed to fetch delivery status', details: (error as Error).message });
  }
});

export default router;
