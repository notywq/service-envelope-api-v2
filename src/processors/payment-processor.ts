/**
 * Processor for Payment Envelopes
 * Handles payment processing and financial transactions
 */

import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor';
import { PaymentEnvelope, ServiceRequest } from '../types/envelope.types';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service';

export class PaymentProcessor extends EnvelopeProcessor<PaymentEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: PaymentEnvelope): Observable<PaymentEnvelope> {
    if (!envelope.required || envelope.amount <= 0) {
      envelope.status = 'waived';
      return of(envelope);
    }

    return this.processPayment(request, envelope).pipe(
      map(paymentResult => {
        envelope.transactionId = paymentResult.transactionId;
        envelope.paymentGatewayResponse = paymentResult.response;
        envelope.status = paymentResult.success ? 'completed' : 'failed';
        envelope.timestamp = new Date().toISOString();
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
      amount: envelope.amount,
      currency: envelope.currency,
      method: envelope.paymentMethod,
      requestId: request.id
    });
  }
}

interface PaymentResult {
  success: boolean;
  transactionId: string;
  response: any;
}

