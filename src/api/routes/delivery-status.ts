/**
 * Delivery Status Update Routes
 * Simple API to update delivery progress and track status changes
 * Supports status updates with codes: 0=processing, 1=ready_to_deliver, 2=out_for_delivery, 3=delivered
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';

const router = Router();

/**
 * Delivery Status Code Mapping
 *
 * Codes 0-3 apply to all methods.
 * Code 4 is pickup-only and triggers orchestrator completion (same as code 3 for email/physical_mail).
 *
 * Physical mail flow:   0 → 1 → 2 → 3  (manual triggers)
 * Email flow:           auto-completes on send; code 3 can still confirm
 * Pickup flow:          0 → 1 (ready_for_pickup) → 4 (pickup_complete)  (manual triggers)
 */
const DELIVERY_STATUS_CODES: Record<number | string, number | string> = {
  // Numeric → name
  0: 'processing',
  1: 'ready_to_deliver',      // physical_mail / email
  2: 'out_for_delivery',      // physical_mail
  3: 'delivered',             // physical_mail / email completion
  4: 'pickup_complete',       // pickup completion (manually triggered)
  // Name → numeric
  'processing': 0,
  'ready_to_deliver': 1,
  'ready_for_pickup': 1,      // pickup-specific alias for code 1
  'out_for_delivery': 2,
  'in_transit': 2,            // legacy alias
  'delivered': 3,
  'received': 3,              // legacy alias
  'pickup_complete': 4,
};

/**
 * POST /api/delivery-status/:requestId
 * Update delivery status with optional tracking information
 * 
 * Body:
 * {
 *   status: 0|1|2|3 or 'processing'|'ready_to_deliver'|'out_for_delivery'|'delivered',
 *   notes?: 'Your tracking notes',
 *   trackingId?: 'Tracking reference',
 *   location?: 'Current location',
 *   timestamp?: 'ISO timestamp (default: now)'
 * }
 */
router.post('/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    let { status, notes, trackingId, location, timestamp } = req.body;

    // Validate required fields
    if (!requestId || status === undefined || status === null) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['requestId', 'status'],
        validStatuses: {
          all: {
            codes: [0, 1, 2, 3, 4],
            names: ['processing', 'ready_to_deliver', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'pickup_complete'],
          },
          byMethod: {
            email:         { flow: '0 → 3', codes: [0, 3], notes: 'auto-completes on send; code 3 confirms delivery' },
            physical_mail: { flow: '0 → 1 → 2 → 3', codes: [0, 1, 2, 3], notes: 'all steps manual' },
            pickup:        { flow: '0 → 1 (ready_for_pickup) → 4 (pickup_complete)', codes: [0, 1, 4], notes: 'all steps manual; code 4 completes delivery' },
          },
          meaning: {
            0: 'Processing – Preparing document',
            1: 'Ready to Deliver / Ready for Pickup – Document ready',
            2: 'Out for Delivery – In transit (physical_mail)',
            3: 'Delivered – Confirmed delivery (email / physical_mail)',
            4: 'Pickup Complete – Customer collected document (pickup only)',
          },
        },
      });
    }

    // Convert status code to name if numeric, or validate name if string
    let statusCode: number | undefined;
    let statusName: string = '';

    if (typeof status === 'number') {
      statusCode = status;
      statusName = (DELIVERY_STATUS_CODES[statusCode as keyof typeof DELIVERY_STATUS_CODES] as string) || '';
    } else if (typeof status === 'string') {
      statusName = status.toLowerCase();
      statusCode = DELIVERY_STATUS_CODES[statusName as keyof typeof DELIVERY_STATUS_CODES] as number;
    }

    // Validate status
    if (statusCode === undefined || ![0, 1, 2, 3, 4].includes(statusCode) || !statusName) {
      return res.status(400).json({
        error: `Invalid delivery status: ${status}`,
        validStatuses: {
          codes: [0, 1, 2, 3, 4],
          names: ['processing', 'ready_to_deliver', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'pickup_complete'],
        },
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
    const statusUpdate: any = {
      statusCode,
      status: statusName,
      notes: notes || '',
      trackingId: trackingId || delivery.details?.physical_mail?.trackingId,
      location: location || '',
      timestamp: timestamp || new Date().toISOString(),
      updateSequence: delivery.deliveryHistory.length + 1
    };

    delivery.deliveryHistory.push(statusUpdate);
    delivery.lastStatusUpdate = statusUpdate.timestamp;
    delivery.currentStatus = statusName;
    delivery.currentStatusCode = statusCode;

    // Handle status transitions
    switch (statusCode) {
      case 0: // Processing
        if (delivery.status !== 'in_progress') {
          delivery.status = 'in_progress';
        }
        appContext.logger.info(`[DELIVERY-PROCESSING] Request ${requestId} | Processing started`);
        break;

      case 1: // Ready to Deliver
        if (delivery.status !== 'in_progress') {
          delivery.status = 'in_progress';
        }
        appContext.logger.info(`[DELIVERY-READY] Request ${requestId} | Ready for shipment`);
        break;

      case 2: // Out for Delivery
        if (delivery.status !== 'in_progress') {
          delivery.status = 'in_progress';
        }
        appContext.logger.info(`[DELIVERY-IN-TRANSIT] Request ${requestId} | Document in transit | Location: ${location || 'N/A'}`);
        break;

      case 3: // Delivered (email / physical_mail)
        delivery.status = 'completed';
        delivery.deliveredAt = statusUpdate.timestamp;
        appContext.logger.info(
          `[DELIVERY-COMPLETED] Request ${requestId} | Delivered | At: ${statusUpdate.timestamp}`
        );
        break;

      case 4: // Pickup Complete (pickup method)
        delivery.status = 'completed';
        delivery.deliveredAt = statusUpdate.timestamp;
        appContext.logger.info(
          `[DELIVERY-PICKUP-COMPLETE] Request ${requestId} | Customer collected document | At: ${statusUpdate.timestamp}`
        );
        break;
    }

    // Save first, then resume orchestrator for completion codes
    await appContext.stateManager.saveRequest(request);

    if (statusCode === 3 || statusCode === 4) {
      const lock = await appContext.requestProcessingLock.acquire(requestId);

      appContext.orchestrator.processRequest(request).subscribe({
        next: (result) => {
          appContext.logger.info(
            `📊 Request auto-resumed after delivery completion: ${result.id} -> ${result.overallStatus}`
          );
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

      res.json({
        requestId,
        message: `Delivery status updated to: ${statusName} (code: ${statusCode}) — orchestrator auto-resumed.`,
        delivery: {
          currentStatus: delivery.currentStatus,
          currentStatusCode: delivery.currentStatusCode,
          lastStatusUpdate: delivery.lastStatusUpdate,
          deliveredAt: delivery.deliveredAt,
        },
      });
      return;
    }

    // Non-completion codes (0-2): request already saved above.
    res.json({
      requestId,
      message: `Delivery status updated to: ${statusName} (code: ${statusCode})`,
      delivery: {
        currentStatus: delivery.currentStatus,
        currentStatusCode: delivery.currentStatusCode,
        lastStatusUpdate: delivery.lastStatusUpdate,
        totalUpdates: delivery.deliveryHistory.length,
        envelopeStatus: delivery.status,
        deliveredAt: delivery.deliveredAt || null
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
      currentStatusCode: delivery.currentStatusCode,
      lastStatusUpdate: delivery.lastStatusUpdate,
      totalStatusUpdates: history.length,
      history: history.map((update: any) => ({
        sequence: update.updateSequence,
        statusCode: update.statusCode,
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
      currentStatusCode: delivery.currentStatusCode,
      lastStatusUpdate: delivery.lastStatusUpdate,
      lastUpdateDetails: latestUpdate ? {
        statusCode: latestUpdate.statusCode,
        status: latestUpdate.status,
        timestamp: latestUpdate.timestamp,
        location: latestUpdate.location,
        notes: latestUpdate.notes,
        trackingId: latestUpdate.trackingId,
        sequence: latestUpdate.updateSequence
      } : null,
      deliveryAttempts: delivery.deliveryAttempts,
      lastAttemptAt: delivery.lastAttemptAt,
      deliveredAt: delivery.deliveredAt || null
    });
  } catch (error) {
    appContext.logger.error(`[DELIVERY-ERROR] Failed to fetch current delivery status:`, error);
    res.status(500).json({ error: 'Failed to fetch delivery status', details: (error as Error).message });
  }
});

export default router;
