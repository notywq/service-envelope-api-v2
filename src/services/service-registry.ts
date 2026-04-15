/**
 * Service Registry - Loads and caches available service YAML definitions
 * Services are defined in YAML files and loaded at startup
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import YAML from 'yaml';
import { Logger } from 'winston';

export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  type: string;
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
    private servicesPath: string,
    private logger: Logger
  ) {}

  async loadServices(): Promise<void> {
    try {
      const files = await readdir(this.servicesPath);
      const yamlFiles = files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

      for (const file of yamlFiles) {
        const filePath = join(this.servicesPath, file);
        const content = await readFile(filePath, 'utf-8');
        const serviceData = YAML.parse(content);

        if (serviceData.id) {
          this.services.set(serviceData.id, serviceData);
          this.logger.info(`✅ Loaded service: ${serviceData.id} (${serviceData.name || 'N/A'})`);
        }
      }

      this.logger.info(`📦 Loaded ${this.services.size} services from ${this.servicesPath}`);
    } catch (error) {
      this.logger.warn(`⚠️  Services directory not found at ${this.servicesPath}. Starting with empty registry.`);
      this.logger.debug(`Directory error: ${error}`);
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
