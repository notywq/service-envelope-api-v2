/**
 * Service Registry - Loads and caches available service definitions
 * Services are loaded exclusively from MongoDB at startup
 * YAML files are no longer consulted - all service definitions must exist in MongoDB
 */

import { Logger } from 'winston';
import type { MongoDBStateManager } from './mongodb-state-manager.js';

export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  type: string;
  yaml?: string;
  envelopes?: {
    approval?: any;
    payment?: any;
    processing?: any;
    delivery?: any;
    feedback?: any;
  };
  [key: string]: any;
}

export class ServiceRegistry {
  private services: Map<string, ServiceDefinition> = new Map();

  constructor(
    private logger: Logger,
    private stateManager?: MongoDBStateManager
  ) {}

  async loadServices(): Promise<void> {
    try {
      if (!this.stateManager) {
        this.logger.error('❌ [ServiceRegistry] No MongoDB state manager available - cannot load services');
        throw new Error('ServiceRegistry requires MongoDB state manager');
      }

      this.logger.info('📚 [ServiceRegistry] Loading services exclusively from MongoDB...');
      const mongoServices = await this.stateManager.getAllServiceDefinitions();
      
      if (!mongoServices || mongoServices.length === 0) {
        this.logger.warn('⚠️  No services found in MongoDB. Please create services via API admin endpoints.');
        this.logger.warn('   POST /api/admin/services to create new services');
        return;
      }

      this.logger.debug(`   Found ${mongoServices.length} services in MongoDB`);
      
      for (const service of mongoServices) {
        if (service.id) {
          this.services.set(service.id, service);
          this.logger.debug(`   ✅ Loaded: ${service.id} (${service.name})`);
        }
      }

      this.logger.info(`📦 Successfully loaded ${this.services.size} services from MongoDB`);
    } catch (error) {
      this.logger.error('❌ [ServiceRegistry] Failed to load services from MongoDB:', error);
      throw error;
    }
  }

  getService(serviceId: string): ServiceDefinition | null {
    return this.services.get(serviceId) || null;
  }

  getAllServices(): ServiceDefinition[] {
    return Array.from(this.services.values());
  }

  getServiceIds(): string[] {
    return Array.from(this.services.keys());
  }

  registerService(service: ServiceDefinition): void {
    this.services.set(service.id, service);
    this.logger.info(`✅ Registered service: ${service.id}`);
  }
}
