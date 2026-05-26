/**
 * Delivery Routes
 * Handles delivery method selection and delivery status
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest } from '../../types/envelope.types.js';

const router = Router();

/**
 * POST /api/requests/:requestId/delivery/method
 * Select delivery method for a pending delivery envelope
 * Body: { method: 'email' | 'physical_mail' | 'pickup', details: {...} }
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

    // Set delivery method and details
    request.envelopes.delivery.method = method;
    request.envelopes.delivery.details = details || {};

    // Mark as in progress
    request.envelopes.delivery.status = 'in_progress';
    request.envelopes.delivery.timestamp = new Date().toISOString();

    // Update overall request status
    request.overallStatus = 'pending_delivery';
    request.lastUpdated = new Date().toISOString();

    // Save updated request
    await appContext.stateManager.saveRequest(request);

    // Trigger orchestrator to process delivery
    appContext.orchestrator.processRequest(request).subscribe({
      next: (processedRequest: any) => {
        appContext.logger.info(
          `✅ Delivery method [${method}] selected and processing started for request ${requestId}`
        );
      },
      error: (error: any) => {
        appContext.logger.error(`Error processing delivery: ${error}`);
      },
    });

    res.json({
      status: 'success',
      message: `Delivery method [${method}] selected and processing started`,
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
