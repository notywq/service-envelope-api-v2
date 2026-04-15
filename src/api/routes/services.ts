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
 * Helper function to create and process a service request
 */
async function submitServiceRequest(serviceId: string, parameters: Record<string, any>, res: Response): Promise<void> {
  try {
    const service = appContext.serviceRegistry.getService(serviceId);

    if (!service) {
      res.status(404).json({ error: `Service ${serviceId} not found` });
      return;
    }

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
    appContext.orchestrator.processRequest(serviceRequest).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request processed: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error processing request: ${err.message}`);
      },
    });

    res.status(201).json({
      id: requestId,
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
}

/**
 * GET /api/services
 * List all available services with IDs, names, and descriptions
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const services = appContext.serviceRegistry.getAllServices();
    console.log('🔍 [API] Getting all services, count:', services.length);
    
    const response = {
      count: services.length,
      services: services.map(s => {
        const serviceResponse = {
          id: s.id,
          name: s.name,
          description: s.description,
          type: s.type,
          yaml: (s as any).yaml || '',
        };
        console.log(`   📋 Service ${s.id}:`);
        console.log(`      - yaml present: ${!!serviceResponse.yaml}`);
        console.log(`      - yaml length: ${serviceResponse.yaml.length}`);
        if (serviceResponse.yaml) {
          console.log(`      - yaml preview: ${serviceResponse.yaml.substring(0, 150)}`);
        }
        return serviceResponse;
      }),
    };
    
    console.log('✅ [API] Returning response with', response.services.length, 'services');
    res.json(response);
  } catch (error) {
    console.error('❌ [API] Error listing services:', error);
    appContext.logger.error('Error listing services:', error);
    res.status(500).json({ error: 'Failed to list services' });
  }
});

/**
 * GET /api/services/ids
 * Quick reference: List all service IDs and names (for frontend mapping)
 */
router.get('/ids', (req: Request, res: Response) => {
  try {
    const services = appContext.serviceRegistry.getAllServices();
    const serviceMap: Record<string, string> = {};
    
    services.forEach(s => {
      serviceMap[s.id] = s.name;
    });

    res.json({
      count: services.length,
      serviceMap,
      services: services.map(s => ({
        id: s.id,
        name: s.name,
      })),
    });
  } catch (error) {
    appContext.logger.error('Error listing service IDs:', error);
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

    res.json({
      service_id: service.id,
      service_name: service.name,
      type: service.type,
      description: service.description,
      envelopes: service.envelopes,
      requestParameters: (service as any).envelopes?.request?.parameters || [],
    });
  } catch (error) {
    appContext.logger.error('Error getting service:', error);
    res.status(500).json({ error: 'Failed to get service' });
  }
});

/**
 * POST /api/submit
 * Unified endpoint to submit any service request
 * Service ID is specified in request body payload
 */
router.post('/submit', async (req: Request, res: Response) => {
  try {
    const { service_id, ...parameters } = req.body;

    if (!service_id) {
      return res.status(400).json({ error: 'service_id is required in request body' });
    }

    await submitServiceRequest(service_id, parameters, res);
  } catch (error) {
    appContext.logger.error('Error in submit endpoint:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

/**
 * POST /api/services/:serviceId/submit (Legacy)
 * Submit a new service request via URL parameter
 * Kept for backward compatibility
 */
router.post('/:serviceId/submit', async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.params;
    const parameters = req.body.parameters || req.body;
    await submitServiceRequest(serviceId, parameters, res);
  } catch (error) {
    appContext.logger.error('Error submitting request:', error);
    res.status(500).json({ error: 'Failed to submit request', details: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
