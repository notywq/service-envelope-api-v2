/**
 * Processor for Payment Envelopes
 * Handles payment processing and financial transactions
 * Sends payment required email when starting, payment confirmed email when completed
 */

import { Observable, of, from } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { PaymentEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';
import { EmailService } from '../services/email-service.js';
import { EmailTemplateLoader } from '../utils/email-template-loader.js';

export class PaymentProcessor extends EnvelopeProcessor<PaymentEnvelope> {
  private templateLoader: EmailTemplateLoader;

  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager: StateManager,
    private emailService?: EmailService,
    private paymentGatewayUrl: string = process.env.FRONTEND_BASE_URL || 'http://localhost:5173'
  ) {
    super(logger);
    this.templateLoader = new EmailTemplateLoader(stateManager, logger);
  }

  protected processInternal(request: ServiceRequest, envelope: PaymentEnvelope): Observable<PaymentEnvelope> {
    if (!envelope.required || envelope.charges.length <= 0) {
      envelope.status = 'waived';
      this.logger.info(`[PAYMENT-WAIVED] Request ${request.id} | No payment required`);
      return of(envelope);
    }

    // Check if this is the initial start (status = pending)
    if (envelope.status === 'pending' && !envelope.startEmailSentAt) {
      // Send start email (payment required notification)
      return from(this.sendStartEmail(request, envelope)).pipe(
        switchMap(() => {
          // After sending start email, set to pending_external (waiting for payment)
          envelope.status = 'pending_external';
          envelope.timestamp = new Date().toISOString();
          
          this.logger.info(
            `[PAYMENT-WAIT] Request ${request.id} | Awaiting payment | Total: ${envelope.charges.reduce((sum: number, c: any) => sum + c.amount, 0)} ${envelope.charges[0]?.currency || 'PHP'}`
          );
          
          return of(envelope);
        })
      );
    }

    // If already pending_external, stay that way (waiting for payment callback)
    if (envelope.status === 'pending_external') {
      return of(envelope);
    }

    // If payment is complete, send end email
    if (envelope.status === 'completed' && !envelope.endEmailSentAt) {
      return from(this.sendEndEmail(request, envelope)).pipe(
        map(() => envelope)
      );
    }

    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Payment';
  }

  /**
   * Send payment required email when payment envelope starts
   */
  private async sendStartEmail(request: ServiceRequest, envelope: PaymentEnvelope): Promise<void> {
    try {
      // Get service definition to find template ID
      const serviceDefinition = await this.stateManager.getServiceDefinition(request.type);
      if (!serviceDefinition?.payment?.emailTemplateStartEnvelope) {
        this.logger.warn(`No payment start email template configured for service ${request.type}`);
        return;
      }

      // Fetch and render template
      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.payment.emailTemplateStartEnvelope,
        request,
        'payment-start'
      );

      if (!template) {
        this.logger.warn(
          `Could not load payment start email template: ${serviceDefinition.payment.emailTemplateStartEnvelope}`
        );
        return;
      }

      // Get requestor email
      const requestorEmail = request.envelopes.request.parameters?.email;
      if (!requestorEmail) {
        this.logger.warn(`No email address found for requestor in request ${request.id}`);
        return;
      }

      // Send email
      if (this.emailService) {
        await this.emailService.sendEmail({
          to: requestorEmail,
          subject: template.subject,
          html: template.htmlBody,
        });

        envelope.startEmailSentAt = new Date().toISOString();
        this.logger.info(`[PAYMENT-EMAIL-SENT] Request ${request.id} | Payment notification sent to ${requestorEmail}`);
      }
    } catch (error) {
      this.logger.error(`[PAYMENT-ERROR] Request ${request.id} | Failed to send payment email: ${(error as Error).message}`);
    }
  }

  /**
   * Send payment confirmed email when payment envelope completes
   */
  private async sendEndEmail(request: ServiceRequest, envelope: PaymentEnvelope): Promise<void> {
    try {
      // Get service definition to find template ID
      const serviceDefinition = await this.stateManager.getServiceDefinition(request.type);
      if (!serviceDefinition?.payment?.emailTemplateEndEnvelope) {
        this.logger.warn(`No payment end email template configured for service ${request.type}`);
        return;
      }

      // Fetch and render template
      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.payment.emailTemplateEndEnvelope,
        request,
        'payment-end'
      );

      if (!template) {
        this.logger.warn(
          `Could not load payment end email template: ${serviceDefinition.payment.emailTemplateEndEnvelope}`
        );
        return;
      }

      // Get requestor email
      const requestorEmail = request.envelopes.request.parameters?.email;
      if (!requestorEmail) {
        this.logger.warn(`No email address found for requestor in request ${request.id}`);
        return;
      }

      // Send email
      if (this.emailService) {
        await this.emailService.sendEmail({
          to: requestorEmail,
          subject: template.subject,
          html: template.htmlBody,
        });

        envelope.endEmailSentAt = new Date().toISOString();
        this.logger.info(`[PAYMENT-COMPLETE] Request ${request.id} | Payment confirmation sent to ${requestorEmail}`);
      }
    } catch (error) {
      this.logger.error(`[PAYMENT-ERROR] Request ${request.id} | Failed to send payment confirmation: ${(error as Error).message}`);
    }
  }
}
