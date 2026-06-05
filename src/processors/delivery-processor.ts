/**
 * Processor for Delivery Envelopes
 * Handles document delivery via multiple methods:
 * - Email: Send document via email with attachments
 * - Physical Mail: Ship via courier (LBC, JNT, DHL)
 * - Pickup: Mark ready for pickup at designated location
 * Email sending is handled by the orchestrator via sendEnvelopeEmailTemplate()
 */

import { Observable, of, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { DeliveryEnvelope, ServiceRequest } from '../types/envelope.types.js';
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

    // Check if delivery was marked complete externally via API.
    // Code 3 = delivered (email / physical_mail).
    // Code 4 = pickup_complete (pickup only).
    // Envelope may be in_progress or pending_external when the external trigger arrives.
    const isDelivered =
      envelope.currentStatusCode === 3 ||
      envelope.currentStatusCode === 4 ||
      envelope.currentStatus === 'delivered' ||
      envelope.currentStatus === 'pickup_complete';

    if (isDelivered) {
      envelope.status = 'completed';
      envelope.deliveredAt = envelope.deliveredAt || new Date().toISOString();
      this.logger.info(
        `[DELIVERY-COMPLETED] Request ${request.id} | Delivery completed via status: ${envelope.currentStatus || envelope.currentStatusCode}`
      );
      return of(envelope);
    }

    // Check if this is the initial start (status = pending)
    if (envelope.status === 'pending') {
      // Check if delivery details were pre-submitted via POST /api/delivery/{requestId}/details
      if (envelope.method) {
        // Details already provided, proceed to in_progress
        this.logger.info(
          `[DELIVERY-DETAILS-FOUND] Request ${request.id} | Using pre-submitted delivery method: ${envelope.method}`
        );
        envelope.status = 'in_progress';
        envelope.timestamp = new Date().toISOString();

        return from(this.executeDelivery(request, envelope)).pipe(
          map(() => {
            // Email is done once sent — auto-complete.
            // physical_mail and pickup must be manually confirmed via /api/delivery-status/:requestId.
            if (envelope.method === 'email') {
              envelope.status = 'completed';
              this.logger.info(`[DELIVERY-AUTO-COMPLETE] Request ${request.id} | Email delivery auto-completed`);
            } else {
              envelope.status = 'pending_external';
              this.logger.info(
                `[DELIVERY-AWAIT-CONFIRM] Request ${request.id} | ${envelope.method} delivery awaiting manual confirmation via POST /api/delivery-status/${request.id}`
              );
            }
            envelope.timestamp = new Date().toISOString();
            return envelope;
          })
        );
      }

      // No details yet, wait for UI to submit them or user to select method
      // NOTE: Orchestrator handles email sending via sendEnvelopeEmailTemplate()
      envelope.status = 'pending_external';
      envelope.timestamp = new Date().toISOString();

      this.logger.info(
        `[DELIVERY-WAIT] Request ${request.id} | Awaiting delivery method selection (submit via POST /api/delivery/{requestId}/details or /method)`
      );

      return of(envelope);
    }

    // If pending_external, still waiting for method selection
    if (envelope.status === 'pending_external' && !envelope.method) {
      return of(envelope);
    }

    // If method selected but not yet in_progress, start delivery
    if (envelope.method && envelope.status !== 'in_progress' && envelope.status !== 'pending_external' && envelope.status !== 'completed') {
      envelope.status = 'in_progress';
      envelope.timestamp = new Date().toISOString();

      return from(this.executeDelivery(request, envelope)).pipe(
        map(() => {
          if (envelope.method === 'email') {
            envelope.status = 'completed';
            this.logger.info(`[DELIVERY-AUTO-COMPLETE] Request ${request.id} | Email delivery auto-completed`);
          } else {
            envelope.status = 'pending_external';
            this.logger.info(
              `[DELIVERY-AWAIT-CONFIRM] Request ${request.id} | ${envelope.method} delivery awaiting manual confirmation via POST /api/delivery-status/${request.id}`
            );
          }
          envelope.timestamp = new Date().toISOString();
          return envelope;
        })
      );
    }

    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Delivery';
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

