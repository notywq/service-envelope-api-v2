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

    // Flatten serviceData into parameters for email template placeholders
    if (parameters.serviceData && typeof parameters.serviceData === 'object') {
      parameters = {
        ...parameters,
        ...parameters.serviceData,
      };
    }

    // Parse service YAML if needed to extract envelope configurations
    let serviceEnvelopes = service.envelopes;
    if (!serviceEnvelopes && service.yaml) {
      try {
        const parsedYaml = YAML.parse(service.yaml);
        serviceEnvelopes = parsedYaml.envelopes;
        appContext.logger.debug(`Parsed envelopes from YAML for service ${serviceId}`);
      } catch (err) {
        appContext.logger.warn(`Failed to parse YAML for service ${serviceId}:`, err);
      }
    }

    // Create ServiceRequest object
    const requestId = `req-${Date.now()}-${randomUUID().substring(0, 8)}`;
    const now = new Date().toISOString();

    // Extract approvers from approval rules or approvers array
    const approvalConfig = serviceEnvelopes?.approval;
    const requiredApprovers = approvalConfig?.approvalRules?.requiredApprovers || approvalConfig?.approvers || [];
    const approverList: any[] = requiredApprovers.map((approverEmail: string) => ({
      id: approverEmail,
      email: approverEmail,
      role: 'approver',
      status: 'pending',
    }));

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
        required: serviceEnvelopes?.approval?.required || false,
        approvers: approverList,
        approvalRules: serviceEnvelopes?.approval?.approvalRules || { type: 'all_must_approve' },
      } as ApprovalEnvelope,
      payment: {
        status: 'pending',
        timestamp: now,
        required: serviceEnvelopes?.payment?.required || false,
        charges: serviceEnvelopes?.payment?.charges || [],
        paymentMethod: 'credit_card',
      } as PaymentEnvelope,
      processing: {
        status: 'pending',
        timestamp: now,
        required: true,
        tasks: serviceEnvelopes?.processing?.tasks || [],
      } as ProcessingEnvelope,
      delivery: {
        status: 'pending',
        timestamp: now,
        required: serviceEnvelopes?.delivery?.required || false,
        method: serviceEnvelopes?.delivery?.method || 'email',
        details: serviceEnvelopes?.delivery?.details || {},
        deliveryAttempts: 0,
      } as DeliveryEnvelope,
      feedback: {
        status: 'pending',
        timestamp: now,
        required: serviceEnvelopes?.feedback?.required || false,
      } as FeedbackEnvelope,
    };

    const serviceRequest: ServiceRequest = {
      id: requestId,
      type: service.type || serviceId,
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
          serviceId: (s as any).serviceId || s.id,  // Use serviceId from YAML if available, fallback to id
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
        serviceId: (s as any).serviceId || s.id,  // Use serviceId from YAML if available, fallback to id
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
      serviceId: (service as any).serviceId || service.id,  // Use serviceId from YAML if available, fallback to id
      id: service.id,
      name: service.name,
      service_id: (service as any).serviceId || service.id,  // For backward compatibility
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

/**
 * DELETE /api/services/:serviceId
 * Delete a service definition from MongoDB
 */
router.delete('/:serviceId', async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.params;

    if (!serviceId) {
      return res.status(400).json({ error: 'Service ID is required' });
    }

    appContext.logger.info(`🗑️  Attempting to delete service: ${serviceId}`);

    // Check if service exists before deletion
    const service = appContext.serviceRegistry.getService(serviceId);
    if (!service) {
      appContext.logger.warn(`⚠️  Service not found: ${serviceId}`);
      return res.status(404).json({ error: `Service ${serviceId} not found` });
    }

    // Delete from MongoDB
    const deleted = await appContext.stateManager.deleteServiceDefinition(serviceId);

    if (!deleted) {
      appContext.logger.warn(`⚠️  Failed to delete service from MongoDB: ${serviceId}`);
      return res.status(500).json({ error: `Failed to delete service ${serviceId}` });
    }

    // Remove from in-memory registry
    appContext.serviceRegistry.removeService(serviceId);

    appContext.logger.info(`✅ Service deleted successfully: ${serviceId}`);

    res.json({
      success: true,
      message: `Service ${serviceId} deleted successfully`,
      serviceId,
      deletedService: {
        id: service.id,
        name: service.name,
        type: service.type,
      },
    });
  } catch (error) {
    appContext.logger.error('Error deleting service:', error);
    res.status(500).json({
      error: 'Failed to delete service',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
