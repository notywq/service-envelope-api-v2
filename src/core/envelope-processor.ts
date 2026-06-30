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
    this.logger.info(`[Envelope Processor] started | request=${request.id} | envelope=${this.getEnvelopeType()} | status=${envelope.status}`);

    return this.processInternal(request, envelope).pipe(
      map(result => {
        if (result.status === 'pending_external') {
          this.logger.info(`[Envelope Processor] waiting | request=${request.id} | envelope=${this.getEnvelopeType()} | status=${result.status}`);
        } else {
          this.logger.info(`[Envelope Processor] finished | request=${request.id} | envelope=${this.getEnvelopeType()} | status=${result.status}`);
        }
        return result;
      }),
      catchError(error => {
        this.logger.error(`[Envelope Processor] failed | request=${request.id} | envelope=${this.getEnvelopeType()} | error=${error.message}`);
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
