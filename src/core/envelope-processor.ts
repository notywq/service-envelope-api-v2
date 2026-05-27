/**
 * Abstract base class for envelope processors
 * Each envelope type extends this to implement specific processing logic
 */

import { Observable, of, throwError, timer } from 'rxjs';
import { map, catchError, retryWhen, take, delayWhen } from 'rxjs/operators';
import { BaseEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';

export abstract class EnvelopeProcessor<T extends BaseEnvelope> {
  constructor(
    protected logger: Logger,
    protected retryAttempts: number = 0,
    protected retryDelay: number = 1000
  ) {}

  /**
   * Process an envelope with retry logic and error handling
   */
  process(request: ServiceRequest, envelope: T): Observable<T> {
    console.log(`📦 [ENVELOPE-PROCESSOR] process() called for ${this.getEnvelopeType()} | Status: ${envelope.status}`);
    this.logger.info(`Processing ${this.getEnvelopeType()} envelope for request ${request.id}`);
    
    console.log(`📦 [ENVELOPE-PROCESSOR] Invoking processInternal() for ${this.getEnvelopeType()}`);
    return this.processInternal(request, envelope).pipe(
      map(result => {
        console.log(`📦 [ENVELOPE-PROCESSOR] processInternal() returned for ${this.getEnvelopeType()} with status: ${result.status}`);
        // Log status based on envelope status
        if (result.status === 'pending_external') {
          this.logger.info(`⏳ [PENDING] ${this.getEnvelopeType()} envelope awaiting external processes for request ${request.id}`);
        } else {
          this.logger.info(`\x1b[32m[SUCCESS]\x1b[0m - Processed ${this.getEnvelopeType()} envelope for request ${request.id}`);
        }
        return result;
      }),
      catchError(error => {
        // Red for failed
        console.log(`📦 [ENVELOPE-PROCESSOR] catchError triggered for ${this.getEnvelopeType()}: ${error.message}`);
        this.logger.error(`\x1b[31m[FAILED]\x1b[0m to process ${this.getEnvelopeType()} envelope for request ${request.id}: ${error.message}`);
        return throwError(() => error);
      })
    );
  }

  /**
   * Check if this envelope should be processed or skipped
   */
  shouldProcess(request: ServiceRequest, envelope: T): boolean {
    return envelope.required || envelope.status === 'pending';
  }

  /**
   * Abstract methods that must be implemented by concrete processors
   */
  protected abstract processInternal(request: ServiceRequest, envelope: T): Observable<T>;
  protected abstract getEnvelopeType(): string;
}