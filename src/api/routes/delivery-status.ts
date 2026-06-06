/**
 * Delivery Status Update Routes
 * Simple API to update delivery progress and track status changes
 * Supports method-specific status updates with code_number and code_name
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';

const router = Router();

type DeliveryMethod = 'email' | 'physical_mail' | 'pickup';

interface MethodCode {
  code_number: number;
  code_name: string;
  completes: boolean;
}

const METHOD_STATUS_CODES: Record<DeliveryMethod, MethodCode[]> = {
  email: [
    { code_number: 0, code_name: 'email_pending', completes: false },
    { code_number: 1, code_name: 'email_sent', completes: true },
  ],
  physical_mail: [
    { code_number: 0, code_name: 'preparing', completes: false },
    { code_number: 1, code_name: 'ready_to_deliver', completes: false },
    { code_number: 2, code_name: 'out_for_delivery', completes: false },
    { code_number: 3, code_name: 'delivered', completes: true },
  ],
  pickup: [
    { code_number: 0, code_name: 'preparing', completes: false },
    { code_number: 1, code_name: 'ready_for_pickup', completes: false },
    { code_number: 2, code_name: 'picked_up', completes: true },
  ],
};

const LEGACY_CODE_NAME_ALIASES: Record<string, string> = {
  processing: 'preparing',
  in_transit: 'out_for_delivery',
  received: 'delivered',
  pickup_complete: 'picked_up',
};

function getAllowedStatusSummary() {
  return {
    byMethod: {
      email: {
        flow: '0(email_pending) → 1(email_sent)',
        codes: METHOD_STATUS_CODES.email,
      },
      physical_mail: {
        flow: '0(preparing) → 1(ready_to_deliver) → 2(out_for_delivery) → 3(delivered)',
        codes: METHOD_STATUS_CODES.physical_mail,
      },
      pickup: {
        flow: '0(preparing) → 1(ready_for_pickup) → 2(picked_up)',
        codes: METHOD_STATUS_CODES.pickup,
      },
    },
    acceptedPayloadFields: [
      'code_number (preferred)',
      'code_name (preferred)',
      'status (legacy backward compatibility)',
    ],
  };
}

/**
 * POST /api/delivery-status/:requestId
 * Update delivery status with optional tracking information
 * 
 * Body:
 * {
 *   code_number?: number,
 *   code_name?: string,
 *   status?: number|string, // legacy alias for backward compatibility
 *   notes?: 'Your tracking notes',
 *   trackingId?: 'Tracking reference',
 *   location?: 'Current location',
 *   timestamp?: 'ISO timestamp (default: now)'
 * }
 */
router.post('/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    let {
      status,
      code_number,
      code_name,
      notes,
      trackingId,
      location,
      timestamp,
    } = req.body;

    // Validate required fields
    const hasAnyCode =
      code_number !== undefined ||
      (typeof code_name === 'string' && code_name.trim().length > 0) ||
      status !== undefined;

    if (!requestId || !hasAnyCode) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['requestId', 'code_number or code_name (or status for legacy clients)'],
        validStatuses: getAllowedStatusSummary(),
      });
    }

    // Load request
    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    const delivery = request.envelopes.delivery;
    const deliveryMethod = delivery.method as DeliveryMethod | undefined;

    if (!deliveryMethod || !['email', 'physical_mail', 'pickup'].includes(deliveryMethod)) {
      return res.status(400).json({
        error: `Delivery method is not selected yet for request ${requestId}. Set delivery method first via POST /api/delivery/${requestId}/details`,
        validMethods: ['email', 'physical_mail', 'pickup'],
      });
    }

    const allowedCodes = METHOD_STATUS_CODES[deliveryMethod];

    // Backward-compat: map legacy status into code_number or code_name
    if (status !== undefined && code_number === undefined && code_name === undefined) {
      if (typeof status === 'number') {
        code_number = status;
      } else if (typeof status === 'string') {
        code_name = status;
      }
    }

    let normalizedCodeNumber: number | undefined;
    let normalizedCodeName: string | undefined;

    if (code_number !== undefined && code_number !== null) {
      const parsedNumber = Number(code_number);
      const byNumber = allowedCodes.find(c => c.code_number === parsedNumber);
      if (!byNumber) {
        return res.status(400).json({
          error: `Invalid code_number ${code_number} for delivery method ${deliveryMethod}`,
          deliveryMethod,
          allowed: allowedCodes,
        });
      }
      normalizedCodeNumber = byNumber.code_number;
      normalizedCodeName = byNumber.code_name;
    } else if (typeof code_name === 'string' && code_name.trim()) {
      const incomingName = code_name.trim().toLowerCase();
      const canonicalName = LEGACY_CODE_NAME_ALIASES[incomingName] || incomingName;
      const byName = allowedCodes.find(c => c.code_name === canonicalName);
      if (!byName) {
        return res.status(400).json({
          error: `Invalid code_name ${code_name} for delivery method ${deliveryMethod}`,
          deliveryMethod,
          allowed: allowedCodes,
        });
      }
      normalizedCodeNumber = byName.code_number;
      normalizedCodeName = byName.code_name;
    }

    if (normalizedCodeNumber === undefined || !normalizedCodeName) {
      return res.status(400).json({
        error: `Unable to resolve delivery status code for method ${deliveryMethod}`,
        deliveryMethod,
        allowed: allowedCodes,
      });
    }

    const matchedCode = allowedCodes.find(c => c.code_number === normalizedCodeNumber)!;

    // Initialize deliveryHistory if not exists
    if (!delivery.deliveryHistory) {
      delivery.deliveryHistory = [];
    }

    // Add status update to history
    const statusUpdate: any = {
      code_number: normalizedCodeNumber,
      code_name: normalizedCodeName,
      // Backward-compatible fields for older consumers
      statusCode: normalizedCodeNumber,
      status: normalizedCodeName,
      notes: notes || '',
      trackingId: trackingId || delivery.details?.physical_mail?.trackingId,
      location: location || '',
      timestamp: timestamp || new Date().toISOString(),
      updateSequence: delivery.deliveryHistory.length + 1
    };

    delivery.deliveryHistory.push(statusUpdate);
    delivery.lastStatusUpdate = statusUpdate.timestamp;
    delivery.currentStatus = normalizedCodeName;
    delivery.currentStatusCode = normalizedCodeNumber;

    // Handle status transitions by method-specific code map
    if (matchedCode.completes) {
      delivery.status = 'completed';
      delivery.deliveredAt = statusUpdate.timestamp;
      appContext.logger.info(
        `[DELIVERY-COMPLETED] Request ${requestId} | Method: ${deliveryMethod} | ${normalizedCodeName} (${normalizedCodeNumber}) | At: ${statusUpdate.timestamp}`
      );
    } else {
      if (delivery.status !== 'in_progress') {
        delivery.status = 'in_progress';
      }
      appContext.logger.info(
        `[DELIVERY-STATUS] Request ${requestId} | Method: ${deliveryMethod} | ${normalizedCodeName} (${normalizedCodeNumber})`
      );
    }

    // Save first, then resume orchestrator for completion codes
    await appContext.stateManager.saveRequest(request);

    if (matchedCode.completes) {
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
        message: `Delivery status updated to: ${normalizedCodeName} (code: ${normalizedCodeNumber}) — orchestrator auto-resumed.`,
        delivery: {
          deliveryMethod,
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
      message: `Delivery status updated to: ${normalizedCodeName} (code: ${normalizedCodeNumber})`,
      delivery: {
        deliveryMethod,
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
      code_name: delivery.currentStatus || delivery.status,
      code_number: delivery.currentStatusCode,
      lastStatusUpdate: delivery.lastStatusUpdate,
      totalStatusUpdates: history.length,
      history: history.map((update: any) => ({
        sequence: update.updateSequence,
        code_number: update.code_number ?? update.statusCode,
        code_name: update.code_name ?? update.status,
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
      code_name: delivery.currentStatus || delivery.status,
      code_number: delivery.currentStatusCode,
      lastStatusUpdate: delivery.lastStatusUpdate,
      lastUpdateDetails: latestUpdate ? {
        code_number: latestUpdate.code_number ?? latestUpdate.statusCode,
        code_name: latestUpdate.code_name ?? latestUpdate.status,
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
