/**
 * Processor for Payment Envelopes
 * Handles payment processing and financial transactions
 */

import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { PaymentEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';

export class PaymentProcessor extends EnvelopeProcessor<PaymentEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: PaymentEnvelope): Observable<PaymentEnvelope> {
    if (!envelope.required || envelope.charges.length <= 0) {
      envelope.status = 'waived';
      return of(envelope);
    }

    return this.processPayment(request, envelope).pipe(
      map(paymentResult => {
        envelope.transactionId = paymentResult.transactionId;
        envelope.paymentGatewayResponse = paymentResult.response;
        envelope.timestamp = new Date().toISOString();
        if(paymentResult.response.code === 'PENDING') {
          envelope.status = 'pending_external';
          this.logger.warn(`\x1b[36m[PAUSED]\x1b[0m due to pending payment verification for request ${request.id}`);
        }
        else {
            envelope.status = paymentResult.success ? 'completed' : 'failed';
        }

        return envelope;
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Payment';
  }

  /**
   * Process payment through 3rd party payment gateway
   * Integrate with services like Stripe, PayPal, etc.
   */
  private processPayment(request: ServiceRequest, envelope: PaymentEnvelope): Observable<PaymentResult> {
    return this.thirdPartyService.processPayment({
      charges: envelope.charges,
      paymentMethod: envelope.paymentMethod,
      transactionId: envelope.transactionId,
      requestId: request.id
    });
  }
}

interface PaymentResult {
  success: boolean;
  transactionId: string;
  response: any;
}

