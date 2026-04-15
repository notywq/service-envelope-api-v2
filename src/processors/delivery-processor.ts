/**
 * Processor for Delivery Envelopes
 * Handles delivery of service outputs to users
 */

import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { DeliveryEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';

export class DeliveryProcessor extends EnvelopeProcessor<DeliveryEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: DeliveryEnvelope): Observable<DeliveryEnvelope> {
    if (!envelope.required) {
      envelope.status = 'skipped';
      return of(envelope);
    }

    return this.executeDelivery(request, envelope).pipe(
      map(success => {
        envelope.status = success ? 'completed' : 'failed';
        envelope.deliveryAttempts = (envelope.deliveryAttempts || 0) + 1;
        envelope.lastAttemptAt = new Date().toISOString();
        envelope.timestamp = new Date().toISOString();
        return envelope;
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Delivery';
  }

  /**
   * Execute delivery based on the specified method
   */
  private executeDelivery(request: ServiceRequest, envelope: DeliveryEnvelope): Observable<boolean> {
    switch (envelope.method) {
      case 'email':
        return this.thirdPartyService.sendEmail({
          to: envelope.details.email?.recipient || '',
          subject: envelope.details.email?.subject || 'Service Request Complete',
          templateId: envelope.details.email?.templateId,
          attachments: envelope.details.email?.attachmentUrls,
          requestId: request.id
        });
      
      case 'sms':
        return this.thirdPartyService.sendSMS({
          to: envelope.details.sms?.phoneNumber || '',
          message: envelope.details.sms?.message || 'Your request has been completed',
          requestId: request.id
        });
      
      case 'physical_mail':
        return this.thirdPartyService.sendPhysicalMail({
          address: envelope.details.physicalMail?.address || '',
          requestId: request.id
        });
      
      default:
        return of(true);
    }
  }
}

