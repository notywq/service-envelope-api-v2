/**
 * Processor for Payment Envelopes
 * Handles payment processing and financial transactions
 * Email sending is handled by the orchestrator via sendEnvelopeEmailTemplate()
 */

import { Observable, of } from 'rxjs';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { PaymentEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';

export class PaymentProcessor extends EnvelopeProcessor<PaymentEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager: StateManager
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: PaymentEnvelope): Observable<PaymentEnvelope> {
    if (!envelope.required || envelope.charges.length <= 0) {
      envelope.status = 'waived';
      this.logger.info(`[PAYMENT-WAIVED] Request ${request.id} | No payment required`);
      return of(envelope);
    }

    // Check if this is the initial start (status = pending)
    if (envelope.status === 'pending') {
      // Set to pending_external (waiting for payment)
      // NOTE: Orchestrator handles email sending via sendEnvelopeEmailTemplate()
      envelope.status = 'pending_external';
      envelope.timestamp = new Date().toISOString();
      
      this.logger.info(
        `[PAYMENT-WAIT] Request ${request.id} | Awaiting payment | Total: ${envelope.charges.reduce((sum: number, c: any) => sum + c.amount, 0)} ${envelope.charges[0]?.currency || 'PHP'}`
      );
      
      return of(envelope);
    }

    // If already pending_external, stay that way (waiting for payment callback)
    if (envelope.status === 'pending_external') {
      return of(envelope);
    }

    // If payment is complete, just return (orchestrator handles email)
    if (envelope.status === 'completed') {
      return of(envelope);
    }

    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Payment';
  }
}
