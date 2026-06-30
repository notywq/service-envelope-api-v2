/**
 * Services Routes
 * Handles service definitions and request submission
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest, EnvelopeCollection, RequestEnvelope, ApprovalEnvelope, PaymentEnvelope, ProcessingEnvelope, DeliveryEnvelope, FeedbackEnvelope } from '../../types/envelope.types.js';
import { randomUUID } from 'crypto';
import { paginationMeta, parsePagination } from '../../utils/pagination.js';
// REMOVED: No longer used. Use ParameterValidator from requests.ts instead

const router = Router();

/**
 * GET /api/services
 * List all available services with IDs, names, and descriptions
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 500 });
    const services = appContext.serviceRegistry.getAllServices();
    const pagedServices = services.slice(offset, offset + limit);
    const meta = paginationMeta(services.length, pagedServices.length, limit, offset);
    console.log('🔍 [API] Getting all services, count:', services.length);
    
    const response = {
      total: meta.total,
      count: meta.count,
      limit,
      offset,
      hasMore: meta.hasMore,
      nextOffset: meta.nextOffset,
      services: pagedServices.map(s => {
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
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 500 });
    const services = appContext.serviceRegistry.getAllServices();
    const pagedServices = services.slice(offset, offset + limit);
    const meta = paginationMeta(services.length, pagedServices.length, limit, offset);
    const serviceMap: Record<string, string> = {};
    
    pagedServices.forEach(s => {
      serviceMap[s.id] = s.name;
    });

    res.json({
      total: meta.total,
      count: meta.count,
      limit,
      offset,
      hasMore: meta.hasMore,
      nextOffset: meta.nextOffset,
      serviceMap,
      services: pagedServices.map(s => ({
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
