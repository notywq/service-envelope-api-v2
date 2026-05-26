/**
 * Processor for Delivery Envelopes
 * Handles document delivery via multiple methods:
 * - Email: Send document via email with attachments
 * - Physical Mail: Ship via courier (LBC, JNT, DHL)
 * - Pickup: Mark ready for pickup at designated location
 * Sends delivery start email when beginning, delivery complete email when done
 */

import { Observable, of, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { DeliveryEnvelope, ServiceRequest, DeliveryMethod } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { StateManager } from '../core/state-manager.js';
import { EmailService } from '../services/email-service.js';
import { EmailTemplateLoader } from '../utils/email-template-loader.js';

export class DeliveryProcessor extends EnvelopeProcessor<DeliveryEnvelope> {
  private templateLoader: EmailTemplateLoader;

  constructor(
    logger: Logger,
    private stateManager: StateManager,
    private emailService?: EmailService
  ) {
    super(logger);
    this.templateLoader = new EmailTemplateLoader(stateManager, logger);
  }

  protected processInternal(
    request: ServiceRequest,
    envelope: DeliveryEnvelope
  ): Observable<DeliveryEnvelope> {
    // If not required, skip delivery
    if (!envelope.required) {
      envelope.status = 'waived';
      this.logger.info(`[DELIVERY-WAIVED] Request ${request.id} | Delivery not required`);
      return of(envelope);
    }

    // Check if this is the initial start (status = pending)
    if (envelope.status === 'pending' && !envelope.startEmailSentAt) {
      // Send start email (document ready for delivery)
      return from(this.sendStartEmail(request, envelope)).pipe(
        switchMap(() => {
          // After sending start email, wait for delivery method selection
          envelope.status = 'pending_external';
          envelope.timestamp = new Date().toISOString();

          this.logger.info(
            `[DELIVERY-WAIT] Request ${request.id} | Awaiting delivery method selection`
          );

          return of(envelope);
        })
      );
    }

    // If pending_external, still waiting for method selection
    if (envelope.status === 'pending_external' && !envelope.method) {
      return of(envelope);
    }

    // If method selected but not yet in_progress, start delivery
    if (envelope.method && envelope.status !== 'in_progress' && envelope.status !== 'completed') {
      envelope.status = 'in_progress';
      envelope.timestamp = new Date().toISOString();

      return from(this.executeDelivery(request, envelope)).pipe(
        switchMap(() => {
          // After delivery execution, send end email
          envelope.status = 'completed';
          envelope.timestamp = new Date().toISOString();
          return from(this.sendEndEmail(request, envelope)).pipe(
            map(() => envelope)
          );
        })
      );
    }

    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Delivery';
  }

  /**
   * Send delivery start email (document ready to be delivered)
   */
  private async sendStartEmail(request: ServiceRequest, envelope: DeliveryEnvelope): Promise<void> {
    try {
      const serviceDefinition = await this.stateManager.getServiceDefinition(request.type);
      if (!serviceDefinition?.delivery?.emailTemplateStartEnvelope) {
        this.logger.debug(`[DELIVERY-INIT] Request ${request.id} | No start email template configured`);
        return;
      }

      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.delivery.emailTemplateStartEnvelope,
        request,
        'delivery-start'
      );

      if (!template) {
        this.logger.warn(
          `[DELIVERY-INIT] Request ${request.id} | Failed to load start email template`
        );
        return;
      }

      const requestorEmail = request.envelopes.request.parameters?.email;
      if (!requestorEmail) {
        this.logger.warn(`No email address found for requestor in request ${request.id}`);
        return;
      }

      if (this.emailService) {
        await this.emailService.sendEmail({
          to: requestorEmail,
          subject: template.subject,
          html: template.htmlBody,
        });

        envelope.startEmailSentAt = new Date().toISOString();
        this.logger.info(`[DELIVERY-INIT] Request ${request.id} | Start notification sent to ${requestorEmail}`);
      }
    } catch (error) {
      this.logger.error(`[DELIVERY-ERROR] Request ${request.id} | Failed to send start email: ${(error as Error).message}`);
    }
  }

  /**
   * Send delivery completion email
   */
  private async sendEndEmail(request: ServiceRequest, envelope: DeliveryEnvelope): Promise<void> {
    try {
      const serviceDefinition = await this.stateManager.getServiceDefinition(request.type);
      if (!serviceDefinition?.delivery?.emailTemplateEndEnvelope) {
        this.logger.debug(`[DELIVERY-COMPLETE] Request ${request.id} | No end email template configured`);
        return;
      }

      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.delivery.emailTemplateEndEnvelope,
        request,
        'delivery-end'
      );

      if (!template) {
        this.logger.warn(
          `[DELIVERY-COMPLETE] Request ${request.id} | Failed to load end email template`
        );
        return;
      }

      const requestorEmail = request.envelopes.request.parameters?.email;
      if (!requestorEmail) {
        this.logger.warn(`[DELIVERY-EMAIL] Request ${request.id} | No email found for completion notification`);
        return;
      }

      if (this.emailService) {
        await this.emailService.sendEmail({
          to: requestorEmail,
          subject: template.subject,
          html: template.htmlBody,
        });

        envelope.endEmailSentAt = new Date().toISOString();
        this.logger.info(`[DELIVERY-COMPLETE] Request ${request.id} | Completion notification sent to ${requestorEmail}`);
      }
    } catch (error) {
      this.logger.error(`[DELIVERY-ERROR] Request ${request.id} | Failed to send completion email: ${(error as Error).message}`);
    }
  }

  /**
   * Execute delivery based on selected method
   */
  private async executeDelivery(request: ServiceRequest, envelope: DeliveryEnvelope): Promise<void> {
    if (!envelope.method || !envelope.details) {
      this.logger.warn(`[DELIVERY-ERROR] Request ${request.id} | No delivery method or details specified`);
      return;
    }

    switch (envelope.method) {
      case 'email':
        await this.executeEmailDelivery(request, envelope);
        break;
      case 'physical_mail':
        await this.executePhysicalMailDelivery(request, envelope);
        break;
      case 'pickup':
        await this.executePickupDelivery(request, envelope);
        break;
      default:
        this.logger.warn(`[DELIVERY-ERROR] Request ${request.id} | Unknown delivery method: ${envelope.method}`);
    }

    envelope.lastAttemptAt = new Date().toISOString();
    envelope.deliveryAttempts++;
  }

  /**
   * Execute email delivery
   */
  private async executeEmailDelivery(request: ServiceRequest, envelope: DeliveryEnvelope): Promise<void> {
    try {
      const emailDetails = envelope.details?.email;
      if (!emailDetails) {
        this.logger.warn(`[DELIVERY-EMAIL] Request ${request.id} | No email delivery details`);
        return;
      }

      if (!this.emailService) {
        this.logger.warn(`[DELIVERY-EMAIL] Request ${request.id} | Email service unavailable`);
        return;
      }

      // Fetch document template if specified
      let template = null;
      if (emailDetails.templateId) {
        template = await this.templateLoader.fetchAndRenderTemplate(
          emailDetails.templateId,
          request,
          'delivery-email'
        );
      }

      // Send email with attachments
      await this.emailService.sendEmail({
        to: emailDetails.recipient,
        subject: emailDetails.subject || 'Your Document',
        html: template?.htmlBody || '<p>Please find your document attached.</p>',
        // Note: Attachment URLs would be handled by email service
        // attachments: emailDetails.attachmentUrls,
      });

      this.logger.info(
        `[DELIVERY-EXEC] Request ${request.id} | Email delivered to ${emailDetails.recipient}`
      );
    } catch (error) {
      this.logger.error(`[DELIVERY-ERROR] Request ${request.id} | Email delivery failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Execute physical mail delivery
   */
  private async executePhysicalMailDelivery(request: ServiceRequest, envelope: DeliveryEnvelope): Promise<void> {
    try {
      const mailDetails = envelope.details?.physical_mail;
      if (!mailDetails) {
        this.logger.warn(`[DELIVERY-MAIL] Request ${request.id} | No physical mail details`);
        return;
      }

      // In a real implementation, this would integrate with a shipping API
      // For now, we just log and simulate
      this.logger.info(
        `[DELIVERY-MAIL] Request ${request.id} | Queuing for shipment | Carrier: ${mailDetails.carrier || 'TBD'} | ETA: ${mailDetails.estimatedDays || '3-5'} days`
      );

      // Simulate shipping integration (would call actual courier API)
      mailDetails.shippedAt = new Date().toISOString();

      // Generate tracking ID (would be provided by courier)
      if (!mailDetails.trackingId) {
        mailDetails.trackingId = `TRK${Date.now()}`;
      }
    } catch (error) {
      this.logger.error(`Error executing physical mail delivery:`, error);
      throw error;
    }
  }

  /**
   * Execute pickup delivery
   */
  private async executePickupDelivery(request: ServiceRequest, envelope: DeliveryEnvelope): Promise<void> {
    try {
      const pickupDetails = envelope.details?.pickup;
      if (!pickupDetails) {
        this.logger.warn(`No pickup delivery details for request ${request.id}`);
        return;
      }

      this.logger.info(
        `🏢 Document marked ready for pickup for request ${request.id}`
      );
      this.logger.info(
        `   Location: ${pickupDetails.location}`
      );
      this.logger.info(
        `   Hours: ${pickupDetails.hoursOfOperation}`
      );
      this.logger.info(
        `   Pickup Deadline: ${pickupDetails.pickupDeadlineAt}`
      );

      // Mark as ready for pickup
      pickupDetails.location = pickupDetails.location || 'Registrar Office';

      // Set pickup deadline if not already set
      if (!pickupDetails.pickupDeadlineAt) {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 30); // 30 days to pickup
        pickupDetails.pickupDeadlineAt = deadline.toISOString();
      }

      // Send pickup notification if configured
      const serviceDefinition = await this.stateManager.getServiceDefinition(request.type);
      const notificationTemplate = serviceDefinition?.delivery?.deliveryMethods?.pickup?.notificationTemplate;

      if (notificationTemplate && this.emailService) {
        const template = await this.templateLoader.fetchAndRenderTemplate(
          notificationTemplate,
          request,
          'delivery-pickup-ready'
        );

        if (template) {
          const requestorEmail = request.envelopes.request.parameters?.email;
          if (requestorEmail) {
            await this.emailService.sendEmail({
              to: requestorEmail,
              subject: template.subject,
              html: template.htmlBody,
            });
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error executing pickup delivery:`, error);
      throw error;
    }
  }
}

