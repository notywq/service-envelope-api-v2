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
import { resolveRequesterEmail } from '../utils/request-email.js';

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
      envelope.currentStatus === 'delivered' ||
      envelope.currentStatus === 'picked_up';

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
        if (envelope.method === 'email') {
          this.recordAutomaticDeliveryState(
            envelope,
            'email_pending',
            0,
            'Email delivery is pending; document is being prepared'
          );
          envelope.status = 'pending_external';
          envelope.timestamp = new Date().toISOString();
          this.logger.info(
            `[DELIVERY-AWAIT-CONFIRM] Request ${request.id} | email delivery pending; awaiting code 1 (email_sent) via POST /api/delivery-status/${request.id}`
          );
          return of(envelope);
        }

        // Details already provided, proceed to in_progress
        this.logger.info(
          `[DELIVERY-DETAILS-FOUND] Request ${request.id} | Using pre-submitted delivery method: ${envelope.method}`
        );
        envelope.status = 'in_progress';
        envelope.timestamp = new Date().toISOString();

        return from(this.executeDelivery(request, envelope)).pipe(
          map(() => {
            // Keep email aligned with method-aware status flow.
            // Email now starts at code 0 (email_pending) and waits for an explicit
            // transition to code 1 (email_sent) via /api/delivery-status/:requestId.
            if (envelope.method === 'email') {
              this.recordAutomaticDeliveryState(
                envelope,
                'email_pending',
                0,
                'Email delivery is pending; document is being prepared'
              );
              envelope.status = 'pending_external';
              this.logger.info(
                `[DELIVERY-AWAIT-CONFIRM] Request ${request.id} | email delivery pending; awaiting code 1 (email_sent) via POST /api/delivery-status/${request.id}`
              );
            } else {
              this.recordAutomaticDeliveryState(
                envelope,
                'preparing',
                0,
                envelope.method === 'pickup'
                  ? 'Document is being prepared for pickup'
                  : 'Package is being prepared for physical delivery'
              );
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

    // Method has been selected via POST /api/delivery/:requestId/method
    // (that route sets status = 'in_progress' before calling the orchestrator)
    // Also handles the case where status is pending_external but method was already set
    // by a pre-submitted /details call that somehow left a stale pending_external state.
    if (envelope.method && (envelope.status === 'in_progress' || envelope.status === 'pending_external')) {
      if (envelope.method === 'email') {
        // Explicit trigger path: code 1 (email_sent) posted through /api/delivery-status/:requestId
        // sets currentStatus=email_sent and status=in_progress. Only then do we dispatch email.
        if (envelope.currentStatus === 'email_sent' && envelope.status === 'in_progress') {
          return from(this.executeEmailDelivery(request, envelope)).pipe(
            map(() => {
              this.recordAutomaticDeliveryState(
                envelope,
                'email_sent',
                1,
                'Delivery email sent successfully'
              );
              envelope.status = 'completed';
              envelope.deliveredAt = envelope.deliveredAt || new Date().toISOString();
              envelope.timestamp = new Date().toISOString();
              this.logger.info(`[DELIVERY-AUTO-COMPLETE] Request ${request.id} | Email delivery completed after code 1 trigger`);
              return envelope;
            })
          );
        }

        // Default email state while waiting for explicit code 1 trigger.
        this.recordAutomaticDeliveryState(
          envelope,
          'email_pending',
          0,
          'Email delivery is pending; document is being prepared'
        );
        envelope.status = 'pending_external';
        envelope.timestamp = new Date().toISOString();
        this.logger.info(
          `[DELIVERY-AWAIT-CONFIRM] Request ${request.id} | email delivery pending; awaiting code 1 (email_sent) via POST /api/delivery-status/${request.id}`
        );
        return of(envelope);
      }

      envelope.status = 'in_progress';
      envelope.timestamp = new Date().toISOString();

      return from(this.executeDelivery(request, envelope)).pipe(
        map(() => {
          if (envelope.method === 'email') {
            this.recordAutomaticDeliveryState(
              envelope,
              'email_pending',
              0,
              'Email delivery is pending; document is being prepared'
            );
            envelope.status = 'pending_external';
            this.logger.info(
              `[DELIVERY-AWAIT-CONFIRM] Request ${request.id} | email delivery pending; awaiting code 1 (email_sent) via POST /api/delivery-status/${request.id}`
            );
          } else {
            this.recordAutomaticDeliveryState(
              envelope,
              'preparing',
              0,
              envelope.method === 'pickup'
                ? 'Document is being prepared for pickup'
                : 'Package is being prepared for physical delivery'
            );
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
   * Execute email delivery — resolves document links from processing tasks, selects template
   * via candidate fallback chain, and sends the document delivery email to the recipient.
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

      // 1. Resolve document links from processing task results (resolveAttachmentsFrom config)
      const resolvedLinks = await this.resolveDocumentLinks(request);
      if (resolvedLinks.length > 0) {
        emailDetails.resolvedDocumentLinksHtml = this.buildDocumentLinksHtml(resolvedLinks);
        emailDetails.resolvedDocumentLinksText = resolvedLinks.map(l => `${l.label}: ${l.url}`).join('\n');
        this.logger.info(`[DELIVERY-EMAIL] Request ${request.id} | Resolved ${resolvedLinks.length} document link(s)`);
      }

      // 2. Load template via candidate fallback chain
      //    service-def emailTemplateId -> service-specific generic -> global generic
      const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);
      const serviceEmailTemplateId =
        serviceDefinition?.envelopes?.delivery?.deliveryMethods?.email?.emailTemplateId;
      const serviceScopedGenericTemplateId = `${request.type}-delivery-email-document`;
      const globalGenericTemplateId = 'delivery-email-document';

      const templateCandidates: string[] = [
        serviceEmailTemplateId,
        serviceScopedGenericTemplateId,
        globalGenericTemplateId,
      ].filter((c): c is string => Boolean(c));

      const extraContext = {
        documentLinks: emailDetails.resolvedDocumentLinksHtml || '',
        documentLinksText: emailDetails.resolvedDocumentLinksText || '',
      };

      let subject = emailDetails.subject || 'Your Documents Are Ready';
      let htmlBody = `<p>Your documents are ready. ${extraContext.documentLinksText || 'Please contact us for access.'}</p>`;
      let resolvedTemplate = false;

      for (const candidateId of templateCandidates) {
        const template = await this.templateLoader.fetchAndRenderTemplate(
          candidateId,
          request,
          'delivery-email',
          extraContext
        );
        if (template) {
          resolvedTemplate = true;
          subject = template.subject;
          htmlBody = template.htmlBody;
          const source = this.classifyTemplateSource(candidateId, {
            yamlConfigured: [serviceEmailTemplateId],
            serviceScopedGeneric: [serviceScopedGenericTemplateId],
            globalGeneric: [globalGenericTemplateId],
          });
          this.logger.info(
            `[TEMPLATE-RESOLUTION] Request ${request.id} | Envelope delivery:document-email | Matched: ${candidateId} | Source: ${source} | TemplateId: ${candidateId} | TemplateScope: ${source.startsWith('generic-') ? 'generic' : source === 'yaml-service-definition' ? 'service' : 'n/a'}`
          );
          break;
        }
      }
      if (!resolvedTemplate) {
        this.logger.warn(
          `[DELIVERY-EMAIL] Request ${request.id} | No delivery email template found from candidates: ${templateCandidates.join(', ')}; using built-in minimal fallback body`
        );
      }

      // 3. Determine recipient: runtime-submitted details → request parameters email
      const configuredRecipient = emailDetails.recipient;
      const recipient =
        configuredRecipient && !configuredRecipient.includes('{{')
          ? configuredRecipient
          : resolveRequesterEmail(request);

      if (!recipient) {
        this.logger.warn(`[DELIVERY-EMAIL] Request ${request.id} | No recipient email found`);
        return;
      }

      await this.emailService.sendEmail({ to: recipient, subject, html: htmlBody });

      this.logger.info(`[DELIVERY-EXEC] Request ${request.id} | Email delivered to ${recipient}`);
    } catch (error) {
      this.logger.error(`[DELIVERY-ERROR] Request ${request.id} | Email delivery failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Resolve document URLs from processing task results using the service definition's
   * deliveryMethods.email.resolveAttachmentsFrom configuration.
   */
  private async resolveDocumentLinks(request: ServiceRequest): Promise<Array<{ label: string; url: string }>> {
    const links: Array<{ label: string; url: string }> = [];
    try {
      const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);
      const emailConfig = serviceDefinition?.envelopes?.delivery?.deliveryMethods?.email;
      const resolveFrom: Array<{ taskName: string; field: string; label?: string }> =
        emailConfig?.resolveAttachmentsFrom || [];

      if (resolveFrom.length === 0) return links;

      const processingTasks: any[] = (request.envelopes.processing as any)?.tasks || [];

      for (const mapping of resolveFrom) {
        const task = processingTasks.find((t: any) => t.name === mapping.taskName);
        if (!task?.responseData) {
          this.logger.warn(
            `[DELIVERY-RESOLVE] Request ${request.id} | Task "${mapping.taskName}" not found or has no responseData`
          );
          continue;
        }
        const url = this.getNestedField(task.responseData, mapping.field);
        if (url && typeof url === 'string') {
          links.push({ label: mapping.label || mapping.taskName, url });
        }
      }
    } catch (error) {
      this.logger.warn(
        `[DELIVERY-RESOLVE] Request ${request.id} | Failed to resolve document links: ${(error as Error).message}`
      );
    }
    return links;
  }

  /**
   * Get a value from a nested object using a dot-notation path (e.g., "data.documentUrl").
   */
  private getNestedField(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Build an HTML unordered list of clickable document links for use in email templates.
   */
  private buildDocumentLinksHtml(links: Array<{ label: string; url: string }>): string {
    if (links.length === 0) return '';
    const items = links
      .map(l => `<li><a href="${l.url}" style="color:#1976d2;font-weight:bold;">${l.label}</a></li>`)
      .join('\n');
    return `<ul style="padding:0 0 0 20px;margin:8px 0;">\n${items}\n</ul>`;
  }

  /**
   * Persist canonical current delivery state so GET /api/delivery-status/:requestId/current
   * can restore UI state even when no manual status update has been posted yet.
   */
  private setCurrentDeliveryState(
    envelope: DeliveryEnvelope,
    codeName: 'email_pending' | 'email_sent' | 'preparing' | 'ready_to_deliver' | 'out_for_delivery' | 'delivered' | 'ready_for_pickup' | 'picked_up',
    codeNumber: number
  ): void {
    envelope.currentStatus = codeName;
    envelope.currentStatusCode = codeNumber;
    envelope.lastStatusUpdate = new Date().toISOString();
  }

  /**
   * Keep automatic delivery transitions visible in the same history/timeline API used by the UI.
   * This avoids a mismatch where /current reflects state but /history appears empty until a manual update.
   */
  private recordAutomaticDeliveryState(
    envelope: DeliveryEnvelope,
    codeName: 'email_pending' | 'email_sent' | 'preparing' | 'ready_to_deliver' | 'out_for_delivery' | 'delivered' | 'ready_for_pickup' | 'picked_up',
    codeNumber: number,
    notes: string
  ): void {
    const now = new Date().toISOString();

    if (!envelope.deliveryHistory) {
      envelope.deliveryHistory = [];
    }

    const latestUpdate = envelope.deliveryHistory[envelope.deliveryHistory.length - 1];
    if (latestUpdate?.code_number === codeNumber && latestUpdate?.code_name === codeName) {
      this.setCurrentDeliveryState(envelope, codeName, codeNumber);
      return;
    }

    this.setCurrentDeliveryState(envelope, codeName, codeNumber);
    envelope.deliveryHistory.push({
      code_number: codeNumber,
      code_name: codeName,
      statusCode: codeNumber,
      status: codeName,
      timestamp: now,
      notes,
      trackingId: envelope.details?.physical_mail?.trackingId,
      updateSequence: envelope.deliveryHistory.length + 1,
    });
  }

  /**
   * Classify where a resolved template came from.
   */
  private classifyTemplateSource(
    matchedCandidate: string,
    buckets: {
      yamlConfigured?: Array<string | undefined | null>;
      runtimeOverrides?: Array<string | undefined | null>;
      serviceScopedGeneric?: Array<string | undefined | null>;
      globalGeneric?: Array<string | undefined | null>;
    }
  ): string {
    const runtimeSet = new Set((buckets.runtimeOverrides || []).filter((v): v is string => !!v));
    const yamlSet = new Set((buckets.yamlConfigured || []).filter((v): v is string => !!v));
    const serviceScopedSet = new Set((buckets.serviceScopedGeneric || []).filter((v): v is string => !!v));
    const globalSet = new Set((buckets.globalGeneric || []).filter((v): v is string => !!v));

    if (runtimeSet.has(matchedCandidate)) return 'runtime-override';
    if (yamlSet.has(matchedCandidate)) return 'yaml-service-definition';
    if (serviceScopedSet.has(matchedCandidate)) return 'generic-service-scoped';
    if (globalSet.has(matchedCandidate)) return 'generic-global';
    return 'unknown';
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

      // Send pickup-ready notification via template (service-def notificationTemplateId or generic fallback)
      if (this.emailService) {
        const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);
        const configuredTemplateId =
          serviceDefinition?.envelopes?.delivery?.deliveryMethods?.pickup?.notificationTemplateId;
        const serviceScopedGenericTemplateId = `${request.type}-delivery-pickup-ready`;
        const globalGenericTemplateId = 'delivery-pickup-ready';

        const templateCandidates = [
          configuredTemplateId,
          serviceScopedGenericTemplateId,
          globalGenericTemplateId,
        ].filter((c): c is string => Boolean(c));

        let notifTemplate = null;
        for (const candidateId of templateCandidates) {
          notifTemplate = await this.templateLoader.fetchAndRenderTemplate(
            candidateId,
            request,
            'delivery-pickup-ready'
          );
          if (notifTemplate) {
            const source = this.classifyTemplateSource(candidateId, {
              yamlConfigured: [configuredTemplateId],
              serviceScopedGeneric: [serviceScopedGenericTemplateId],
              globalGeneric: [globalGenericTemplateId],
            });
            this.logger.info(
              `[TEMPLATE-RESOLUTION] Request ${request.id} | Envelope delivery:pickup-notification | Matched: ${candidateId} | Source: ${source} | TemplateId: ${candidateId} | TemplateScope: ${source.startsWith('generic-') ? 'generic' : source === 'yaml-service-definition' ? 'service' : 'n/a'}`
            );
            break;
          }
        }

        if (notifTemplate) {
          const requestorEmail = resolveRequesterEmail(request);
          if (requestorEmail) {
            await this.emailService.sendEmail({
              to: requestorEmail,
              subject: notifTemplate.subject,
              html: notifTemplate.htmlBody,
            });
            this.logger.info(`[DELIVERY-PICKUP] Request ${request.id} | Pickup-ready notification sent to ${requestorEmail}`);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error executing pickup delivery:`, error);
      throw error;
    }
  }
}

