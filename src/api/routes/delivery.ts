/**
 * Delivery Routes
 * Handles delivery method selection and delivery status
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest } from '../../types/envelope.types.js';

const router = Router();

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
    const { deliveryMethod, deliveryDetails } = req.body;

    // Validate required fields
    if (!deliveryMethod || !deliveryDetails) {
      return res.status(400).json({
        error: 'Missing required fields: deliveryMethod, deliveryDetails',
        validMethods: ['email', 'physical_mail', 'pickup'],
      });
    }

    // Validate method
    const validMethods = ['email', 'physical_mail', 'pickup'];
    if (!validMethods.includes(deliveryMethod)) {
      return res.status(400).json({
        error: `Invalid delivery method. Must be one of: ${validMethods.join(', ')}`,
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

    // Store delivery details (do NOT change status or call orchestrator)
    request.envelopes.delivery.method = deliveryMethod;
    request.envelopes.delivery.details = {
      [deliveryMethod]: methodDetails
    };

    // Update last modified timestamp
    request.lastUpdated = new Date().toISOString();

    // Save to MongoDB
    await appContext.stateManager.saveRequest(request);

    appContext.logger.info(
      `✅ Delivery details saved for request ${requestId}: ${deliveryMethod}`
    );

    res.json({
      status: 'success',
      message: `Delivery details saved (${deliveryMethod})`,
      requestId,
      deliveryMethod,
      deliveryDetails: request.envelopes.delivery.details,
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
    const { requestId } = req.params;
    const { method, details } = req.body;

    // Validate method
    const validMethods = ['email', 'physical_mail', 'pickup'];
    if (!method || !validMethods.includes(method)) {
      return res.status(400).json({
        error: `Invalid delivery method. Must be one of: ${validMethods.join(', ')}`,
      });
    }

    // Load request
    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    // Verify delivery envelope exists and is waiting for method
    if (!request.envelopes.delivery) {
      return res.status(400).json({ error: 'Delivery envelope not found for this request' });
    }

    if (request.envelopes.delivery.status !== 'pending_external') {
      return res.status(400).json({
        error: `Cannot select delivery method when envelope status is ${request.envelopes.delivery.status}`,
      });
    }

    // Extract method-specific details from the nested structure
    // details = { method_name: { method_config }, ... }
    const methodDetails = details?.[method] || {};

    // Ensure deliveryHistory is initialized
    if (!request.envelopes.delivery.deliveryHistory) {
      request.envelopes.delivery.deliveryHistory = [];
    }

    // Set delivery method and details
    request.envelopes.delivery.method = method;
    request.envelopes.delivery.details = {
      [method]: methodDetails
    };

    // Mark as in progress
    request.envelopes.delivery.status = 'in_progress';
    request.envelopes.delivery.timestamp = new Date().toISOString();

    // Update overall request status
    request.overallStatus = 'pending_delivery';
    request.lastUpdated = new Date().toISOString();

    // Save updated request
    await appContext.stateManager.saveRequest(request);

    appContext.logger.info(
      `✅ Delivery method [${method}] selected for request ${requestId}.`
    );

    // Acquire lock and auto-resume orchestrator
    const lock = await appContext.requestProcessingLock.acquire(requestId);
    
    appContext.orchestrator.processRequest(request).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request auto-resumed for delivery: ${result.id} -> ${result.overallStatus}`);
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
      status: 'success',
      message: `Delivery method [${method}] selected and processing started.`,
      requestId,
      method,
      deliveryDetails: request.envelopes.delivery.details,
    });
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
