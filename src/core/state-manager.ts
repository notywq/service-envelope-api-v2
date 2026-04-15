/**
 * Manages persistence and retrieval of service request state
 * In a real implementation, this would integrate with a database
 */

import { ServiceRequest } from '../types/envelope.types.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

export class StateManager {
  private storePath: string;

  constructor(storePath: string = './data') {
    this.storePath = storePath;
    if (!existsSync(storePath)) {
      mkdirSync(storePath, { recursive: true });
    }
  }

  /**
   * Save a service request to persistent storage
   * Overload: can accept just the request, or request and a custom path
   */
  saveRequest(request: ServiceRequest): void;
  saveRequest(request: ServiceRequest, customPath: string): void;
  saveRequest(request: ServiceRequest, customPath?: string): void {
    const filePath = customPath
      ? join(customPath, `${request.id}.json`)
      : join(this.storePath, `${request.id}.json`);
    writeFileSync(filePath, JSON.stringify(request, null, 2));
  }

  /**
   * Load a service request from persistent storage
   */
  loadRequest(requestId: string): ServiceRequest | null {
  const filePath = join(this.storePath, `${requestId}.json`);
    if (!existsSync(filePath)) {
      return null;
    }
    const data = readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  }

  /**
   * List all stored requests
   */
  listRequests(): string[] {
    if (!existsSync(this.storePath)) {
      return [];
    }
    return readdirSync(this.storePath)
      .filter((file: string) => file.endsWith('.json'))
      .map((file: string) => file.replace('.json', ''));
  }

  /**
   * Delete a stored request
   */
  deleteRequest(requestId: string): boolean {
    const filePath = join(this.storePath, `${requestId}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      return true;
    }
    return false;
  }
}