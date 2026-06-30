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
        this.logger.error('BOOT | Services     | Registry failed | reason="MongoDB state manager missing"');
        throw new Error('ServiceRegistry requires MongoDB state manager');
      }

      this.logger.info('BOOT | Services     | Loading registry | source=MongoDB');
      const mongoServices = await this.stateManager.getAllServiceDefinitions();
      
      if (!mongoServices || mongoServices.length === 0) {
        this.logger.warn('BOOT | Services     | Registry empty | action="POST /api/admin/services"');
        return;
      }

      this.logger.debug(`BOOT | Services     | Registry query complete | count=${mongoServices.length}`);
      
      for (const service of mongoServices) {
        if (service.id) {
          this.services.set(service.id, service);
          this.logger.debug(`BOOT | Services     | Service cached | id=${service.id} | name=${JSON.stringify(service.name || '')}`);
        }
      }

      this.logger.info(`BOOT | Services     | Registry ready | count=${this.services.size}`);
    } catch (error) {
      this.logger.error('BOOT | Services     | Registry failed', error);
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

  removeService(serviceId: string): boolean {
    const hadService = this.services.has(serviceId);
    if (hadService) {
      this.services.delete(serviceId);
      this.logger.info(`🗑️  Removed service from registry: ${serviceId}`);
    }
    return hadService;
  }
}
