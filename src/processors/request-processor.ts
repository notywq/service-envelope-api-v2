/**
 * Processor for Request Envelopes
 * Initializes request envelope - actual parameter validation happens at POST /api/requests
 */

import { Observable, of } from 'rxjs';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { RequestEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';

export class RequestProcessor extends EnvelopeProcessor<RequestEnvelope> {
  constructor(logger: Logger) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: RequestEnvelope): Observable<RequestEnvelope> {
    // Request envelope is already validated at submission time (POST /api/requests)
    // This processor simply marks it as completed and initializes the envelope
    
    envelope.status = 'completed';
    envelope.timestamp = new Date().toISOString();

    this.logger.info(`[REQUEST-INIT] Request ${request.id} | Envelope initialized`);
    
    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Request';
  }
}