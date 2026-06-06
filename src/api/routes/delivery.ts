/**
 * Delivery Routes
 * Handles delivery method selection and delivery status
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest } from '../../types/envelope.types.js';

const router = Router();

const VALID_METHODS = ['email', 'physical_mail', 'pickup'] as const;
type DeliveryMethod = typeof VALID_METHODS[number];

function normalizeDeliveryPayload(body: any): { method?: DeliveryMethod; details?: Record<string, any> } {
  // Preferred payload shape (/details): { deliveryMethod, deliveryDetails }
  const deliveryMethod = body?.deliveryMethod as DeliveryMethod | undefined;
  const deliveryDetails = body?.deliveryDetails as Record<string, any> | undefined;

  if (deliveryMethod || deliveryDetails) {
    return {
      method: deliveryMethod,
      details: deliveryDetails,
    };
  }

  // Backward-compatible shape (/method): { method, details }
  return {
    method: body?.method as DeliveryMethod | undefined,
    details: body?.details as Record<string, any> | undefined,
  };
}

/**
 * POST /api/delivery/:requestId/details
 * Store delivery details for a request before delivery envelope is reached
 * This allows Phase 2 UI to submit delivery info separately from request submission
 * 
 * Body format:
 * {
 *   "deliveryMethod": "email|physical_mail|pickup",
 *   "deliveryDetails": {
 *     "email": {},
 *     "physical_mail": { "mailingAddress": "..." },
 *     "pickup": {}
 *   }
 * }
 */
router.post('/:requestId/details', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { method: deliveryMethod, details: deliveryDetails } = normalizeDeliveryPayload(req.body);

    // Validate required fields
    if (!deliveryMethod || !deliveryDetails) {
      return res.status(400).json({
        error: 'Missing required fields: deliveryMethod, deliveryDetails',
        validMethods: VALID_METHODS,
      });
    }

    // Validate method
    if (!VALID_METHODS.includes(deliveryMethod)) {
      return res.status(400).json({
        error: `Invalid delivery method. Must be one of: ${VALID_METHODS.join(', ')}`,
      });
    }

    // Load request
    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    // Verify delivery envelope exists
    if (!request.envelopes.delivery) {
      return res.status(400).json({ error: 'Delivery envelope not found for this request' });
    }

    // Extract method-specific details
    const methodDetails = deliveryDetails[deliveryMethod] || deliveryDetails;

    // Ensure deliveryHistory is initialized
    if (!request.envelopes.delivery.deliveryHistory) {
      request.envelopes.delivery.deliveryHistory = [];
    }

    // Store method + details in all cases so tracking payload has a method immediately.
    request.envelopes.delivery.method = deliveryMethod;
    request.envelopes.delivery.details = {
      [deliveryMethod]: methodDetails
    };

    let autoResumed = false;

    // If delivery envelope is waiting for a method, selecting details should also activate delivery
    // and resume the orchestrator. This removes the frontend need to call /method separately.
    if (request.envelopes.delivery.status === 'pending_external') {
      request.envelopes.delivery.status = 'in_progress';
      request.envelopes.delivery.timestamp = new Date().toISOString();
      request.overallStatus = 'pending_delivery';
      autoResumed = true;
    }

    // Update last modified timestamp
    request.lastUpdated = new Date().toISOString();

    // Save to MongoDB
    await appContext.stateManager.saveRequest(request);

    appContext.logger.info(
      `✅ Delivery details saved for request ${requestId}: ${deliveryMethod}${autoResumed ? ' | auto-resume triggered' : ''}`
    );

    if (autoResumed) {
      const lock = await appContext.requestProcessingLock.acquire(requestId);

      appContext.orchestrator.processRequest(request).subscribe({
        next: (result) => {
          appContext.logger.info(`📊 Request auto-resumed for delivery via /details: ${result.id} -> ${result.overallStatus}`);
        },
        error: (err) => {
          appContext.logger.error(`❌ Error in auto-resume via /details: ${err.message}`);
          lock.release();
        },
        complete: () => {
          lock.release();
          appContext.logger.info(`   ℹ️  Orchestrator completed, lock released`);
        },
      });
    }

    res.json({
      status: 'success',
      message: autoResumed
        ? `Delivery details saved (${deliveryMethod}) and processing started.`
        : `Delivery details saved (${deliveryMethod})`,
      requestId,
      deliveryMethod,
      deliveryDetails: request.envelopes.delivery.details,
      autoResumed,
    });
  } catch (error) {
    appContext.logger.error(`Error saving delivery details: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/delivery/:requestId/method
 * Select delivery method for a pending delivery envelope
 * 
 * Body format:
 * {
 *   "method": "email|physical_mail|pickup",
 *   "details": {
 *     "email": {},
 *     "physical_mail": { "mailingAddress": "..." },
 *     "pickup": {}
 *   }
 * }
 */
router.post('/:requestId/method', async (req: Request, res: Response) => {
  try {
    // Backward-compatible alias: normalize /method payload and delegate to /details behavior.
    req.body = {
      deliveryMethod: req.body?.method,
      deliveryDetails: req.body?.details,
    };
    return (router as any).handle({
      ...req,
      url: `/${req.params.requestId}/details`,
      method: 'POST',
    }, res, () => undefined);
  } catch (error) {
    appContext.logger.error(`Error selecting delivery method: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/delivery/:requestId/method
 * Get delivery method (for frontend UI routing)
 * Frontend uses this to determine: EMAIL, PHYSICAL_MAIL, or PICKUP UI
 */
router.get('/:requestId/method', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    if (!request.envelopes.delivery) {
      return res.status(400).json({ error: 'Delivery envelope not found for this request' });
    }

    const delivery = request.envelopes.delivery;
    const deliveryMethod = delivery.method?.toUpperCase().replace(/_/g, '_') || null;

    res.json({
      requestId,
      deliveryMethod: deliveryMethod,  // EMAIL, PHYSICAL_MAIL, PICKUP, or null if not yet selected
      status: delivery.status,  // pending_external, in_progress, completed, failed
      details: delivery.details || {},  // Delivery-specific details (address, recipient, location, etc.)
      availableMethods: delivery.availableMethods || {},  // Available delivery method options from service definition
      timestamp: delivery.timestamp,
      lastAttemptAt: delivery.lastAttemptAt,
    });
  } catch (error) {
    appContext.logger.error(`Error fetching delivery method: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/requests/:requestId/delivery
 * Get delivery status and details
 */
router.get('/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    const delivery = request.envelopes.delivery;
    res.json({
      requestId,
      status: delivery.status,
      method: delivery.method,
      details: delivery.details,
      deliveryAttempts: delivery.deliveryAttempts,
    });
  } catch (error) {
    appContext.logger.error(`Error fetching delivery status: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
