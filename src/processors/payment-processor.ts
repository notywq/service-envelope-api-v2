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

    // Payment is NOT automatic
    // The payment envelope enters pending_external state and waits for user to complete payment
    // User must initiate payment through the payment interface
    envelope.status = 'pending_external';
    envelope.timestamp = new Date().toISOString();
    this.logger.info(`⏳ [PENDING] Payment envelope awaiting user payment through payment interface for request ${request.id}`);
    this.logger.debug(`💰 Total charges: ₱${envelope.charges.reduce((sum, c) => sum + c.amount, 0).toFixed(2)} (awaiting user confirmation)`);
    
    return of(envelope);
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

