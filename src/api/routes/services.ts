/**
 * Services Routes
 * Handles service definitions and request submission
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest, EnvelopeCollection, RequestEnvelope, ApprovalEnvelope, PaymentEnvelope, ProcessingEnvelope, DeliveryEnvelope, FeedbackEnvelope } from '../../types/envelope.types.js';
import { randomUUID } from 'crypto';
import YAML from 'yaml';

const router = Router();

/**
 * GET /api/services
 * List all available services
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const services = appContext.serviceRegistry.getAllServices();
    res.json({
      count: services.length,
      services: services.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        type: s.type,
      })),
    });
  } catch (error) {
    appContext.logger.error('Error listing services:', error);
    res.status(500).json({ error: 'Failed to list services' });
  }
});

/**
 * GET /api/services/:serviceId
 * Get service definition
 */
router.get('/:serviceId', (req: Request, res: Response) => {
  try {
    const service = appContext.serviceRegistry.getService(req.params.serviceId);
    
    if (!service) {
      return res.status(404).json({ error: `Service ${req.params.serviceId} not found` });
    }

    res.json(service);
  } catch (error) {
    appContext.logger.error('Error getting service:', error);
    res.status(500).json({ error: 'Failed to get service' });
  }
});

/**
 * POST /api/services/:serviceId/submit
 * Submit a new service request
 * Accepts form data with dynamic fields based on service type
 */
router.post('/:serviceId/submit', async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.params;
    const service = appContext.serviceRegistry.getService(serviceId);

    if (!service) {
      return res.status(404).json({ error: `Service ${serviceId} not found` });
    }

    // Validate request parameters
    const parameters = req.body.parameters || req.body;
    appContext.logger.info(`📝 Submitting request for service: ${serviceId}`);
    appContext.logger.debug(`Parameters: ${JSON.stringify(parameters)}`);

    // Create ServiceRequest object
    const requestId = `req-${Date.now()}-${randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    const envelopes: EnvelopeCollection = {
      request: {
        status: 'in_progress',
        timestamp: now,
        required: true,
        sourceSystem: parameters.sourceSystem || 'api',
        validationStatus: 'passed',
        validationErrors: [],
        parameters: parameters,
      } as RequestEnvelope,
      approval: {
        status: 'pending',
        timestamp: now,
        required: service.envelopes?.approval?.required || false,
        approvers: service.envelopes?.approval?.approvers || [],
        approvalRules: service.envelopes?.approval?.approvalRules || { type: 'all_must_approve' },
      } as ApprovalEnvelope,
      payment: {
        status: 'pending',
        timestamp: now,
        required: service.envelopes?.payment?.required || false,
        charges: service.envelopes?.payment?.charges || [],
        paymentMethod: 'credit_card',
      } as PaymentEnvelope,
      processing: {
        status: 'pending',
        timestamp: now,
        required: true,
        tasks: service.envelopes?.processing?.tasks || [],
      } as ProcessingEnvelope,
      delivery: {
        status: 'pending',
        timestamp: now,
        required: service.envelopes?.delivery?.required || false,
        method: service.envelopes?.delivery?.method || 'email',
        details: service.envelopes?.delivery?.details || {},
        deliveryAttempts: 0,
      } as DeliveryEnvelope,
      feedback: {
        status: 'pending',
        timestamp: now,
        required: service.envelopes?.feedback?.required || false,
      } as FeedbackEnvelope,
    };

    const serviceRequest: ServiceRequest = {
      id: requestId,
      type: serviceId,
      initiator: parameters.initiator || parameters.studentId || 'unknown',
      overallStatus: 'queued',
      createdAt: now,
      lastUpdated: now,
      history: [
        {
          status: 'queued',
          timestamp: now,
          envelope: 'system',
          notes: 'Request submitted via API',
        },
      ],
      envelopes,
    };

    // Save to MongoDB
    await appContext.stateManager.saveRequest(serviceRequest);
    appContext.logger.info(`✅ Request created: ${requestId}`);

    // Process the request through orchestrator
    // This will update status through the pipeline
    appContext.orchestrator.processRequest(serviceRequest).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request processed: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error processing request: ${err.message}`);
      },
    });

    res.status(201).json({
      requestId,
      status: 'queued',
      message: 'Request submitted successfully',
      service: {
        id: serviceId,
        name: service.name,
      },
    });
  } catch (error) {
    appContext.logger.error('Error submitting request:', error);
    res.status(500).json({ error: 'Failed to submit request', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
