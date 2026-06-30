/**
 * Main orchestrator that manages the flow through all envelopes
 * Supports pausing on "pending_external" and resuming later
 */

import { Observable, of, throwError, from } from 'rxjs';
import { switchMap, tap, catchError, map } from 'rxjs/operators';
import { ServiceRequest, EnvelopeCollection, ProcessingEnvelope, ApprovalEnvelope, PaymentEnvelope } from '../types/envelope.types.js';
import { RequestProcessor } from '../processors/request-processor.js';
import { ApprovalProcessor } from '../processors/approval-processor.js';
import { PaymentProcessor } from '../processors/payment-processor.js';
import { ProcessingProcessor } from '../processors/processing-processor.js';
import { DeliveryProcessor } from '../processors/delivery-processor.js';
import { FeedbackProcessor } from '../processors/feedback-processor.js';
import { StateManager } from './state-manager.js';
import { Logger } from 'winston';
import { EnvelopeProcessor } from './envelope-processor.js';
import { appContext } from '../api/server.js';
import { resolveRequesterEmail } from '../utils/request-email.js';

export class ServiceOrchestrator {
  constructor(
    private requestProcessor: RequestProcessor,
    private approvalProcessor: ApprovalProcessor,
    private paymentProcessor: PaymentProcessor,
    private processingProcessor: ProcessingProcessor,
    private deliveryProcessor: DeliveryProcessor,
    private feedbackProcessor: FeedbackProcessor,
    private stateManager: StateManager,
    private logger: Logger
  ) {}

  private formatConsoleValue(value: unknown): string {
    if (value === undefined || value === null || value === '') {
      return 'n/a';
    }

    if (Array.isArray(value)) {
      return `[${value.map(item => this.formatConsoleValue(item)).join(', ')}]`;
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    const text = String(value);
    return /\s/.test(text) ? JSON.stringify(text) : text;
  }

  private formatConsoleFields(fields: Record<string, unknown>): string {
    return Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${this.formatConsoleValue(value)}`)
      .join(' | ');
  }

  private consoleLine(
    section: 'Pipeline' | 'Envelope' | 'Email' | 'Template' | 'Recipients',
    message: string,
    fields: Record<string, unknown> = {},
    level: 'log' | 'warn' | 'error' = 'log'
  ): void {
    const detail = this.formatConsoleFields(fields);
    const line = detail ? `[${section}] ${message} | ${detail}` : `[${section}] ${message}`;
    if (level === 'error') {
      this.logger.error(line);
      return;
    }
    if (level === 'warn') {
      this.logger.warn(line);
      return;
    }
    this.logger.info(line);
  }

  private pipelineLog(request: ServiceRequest, message: string, fields: Record<string, unknown> = {}, level: 'log' | 'warn' | 'error' = 'log'): void {
    this.consoleLine('Pipeline', message, {
      request: request.id,
      service: request.type,
      ...fields,
    }, level);
  }

  private envelopeLog<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K,
    message: string,
    fields: Record<string, unknown> = {},
    level: 'log' | 'warn' | 'error' = 'log'
  ): void {
    this.consoleLine('Envelope', message, {
      request: request.id,
      envelope: String(envelopeType),
      ...fields,
    }, level);
  }

  private emailLog<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K | 'cancellation',
    phase: string,
    message: string,
    fields: Record<string, unknown> = {},
    level: 'log' | 'warn' | 'error' = 'log'
  ): void {
    this.consoleLine('Email', message, {
      request: request.id,
      envelope: String(envelopeType),
      phase,
      ...fields,
    }, level);
  }

  /**
   * Main orchestration method
   */
  processRequest(request: ServiceRequest): Observable<ServiceRequest> {
    this.pipelineLog(request, 'started', { status: request.overallStatus });

    return of(request).pipe(
      tap(req => {
        this.pipelineLog(req, 'state saved before envelope flow', { status: req.overallStatus });
        this.stateManager.saveRequest(req);
      }),

      // Sequentially process all envelopes
      switchMap(req => {
        this.pipelineLog(req, 'entering envelope', { envelope: 'request' });
        return this.processEnvelope(req, 'request');
      }),
      switchMap(req => {
        this.pipelineLog(req, 'entering envelope', { envelope: 'approval' });
        return this.processEnvelope(req, 'approval');
      }),
      switchMap(req => {
        this.pipelineLog(req, 'entering envelope', { envelope: 'payment' });
        return this.processEnvelope(req, 'payment');
      }),
      switchMap(req => {
        this.pipelineLog(req, 'entering envelope', { envelope: 'processing' });
        return this.processEnvelope(req, 'processing');
      }),
      switchMap(req => {
        this.pipelineLog(req, 'entering envelope', { envelope: 'delivery' });
        return this.processEnvelope(req, 'delivery');
      }),
      switchMap(req => {
        this.pipelineLog(req, 'entering envelope', { envelope: 'feedback' });
        return this.processEnvelope(req, 'feedback');
      }),

      // Finalize request if all envelopes processed
      tap(req => {
        req.overallStatus = 'completed';
        req.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(req, 'completed', 'system');
        this.stateManager.saveRequest(req);
        this.pipelineLog(req, 'completed', { status: req.overallStatus });
      }),

      catchError(error => {
        const errorMsg = error.message || '';
        
        // If this is a pending_external pause, don't mark as failed
        // The status has already been set correctly in processEnvelope
        if (errorMsg.includes('pending_external')) {
          this.pipelineLog(request, 'paused for external work', { reason: errorMsg }, 'warn');
          return throwError(() => error);
        }
        
        // For other errors, mark as failed
        request.overallStatus = 'failed';
        this.addHistoryEntry(request, 'failed', 'system', error.message);
        this.stateManager.saveRequest(request);
        this.pipelineLog(request, 'failed', { reason: errorMsg }, 'error');
        return throwError(() => error);
      })
    );
  }

  /**
   * Process a specific envelope type with support for pending_external pause/resume
   */
  private processEnvelope<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K
  ): Observable<ServiceRequest> {
    const processor = this.getProcessor(envelopeType);
    const envelope = request.envelopes[envelopeType];
    this.envelopeLog(request, envelopeType, 'started', {
      status: envelope.status,
      required: (envelope as any).required ?? 'unknown',
    });

    // Skip if already completed or failed
    if (['completed', 'waived'].includes(envelope.status)) {
      this.envelopeLog(request, envelopeType, 'skipped', { reason: `already ${envelope.status}` });

      // Delivery can be completed externally via /api/delivery-status final codes.
      // Ensure END email still fires exactly once for non-email methods.
      const envelopeForEmailCheck = request.envelopes[envelopeType] as any;
      const deliveryMethod = envelopeType === 'delivery'
        ? (request.envelopes.delivery as any)?.method
        : undefined;
      const shouldSendEndFromSkip =
        envelope.status === 'completed' &&
        !envelopeForEmailCheck?.endEmailSentAt &&
        (
          envelopeType !== 'delivery' ||
          (deliveryMethod && deliveryMethod !== 'email')
        );

      if (shouldSendEndFromSkip) {
        this.emailLog(request, envelopeType, 'end', 'queued after external completion');
        this.sendEnvelopeEmailTemplate(request, envelopeType, 'end').catch(err => {
          this.emailLog(request, envelopeType, 'end', 'failed after external completion', { error: err.message }, 'warn');
        });
      }

      return of(request);
    }

    // Check payment expiry before processing
    if (envelopeType === 'payment' && envelope.status === 'pending_external') {
      return from(this.checkPaymentExpiry(request, envelope as PaymentEnvelope)).pipe(
        switchMap(isExpired => {
          if (isExpired) {
            return throwError(() => new Error(`[REQUEST CANCELLED]: Payment window expired`));
          }
          return this.continueEnvelopeProcessing(processor, request, envelopeType, envelope);
        })
      );
    }

    return this.continueEnvelopeProcessing(processor, request, envelopeType, envelope);
  }

  /**
   * Check if payment has expired
   */
  private async checkPaymentExpiry(request: ServiceRequest, envelope: PaymentEnvelope): Promise<boolean> {
    try {
      const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);
      const expiryDays = serviceDefinition?.envelopes?.payment?.expiryDays || 7;
      const paymentInitiatedAt = envelope.timestamp ? new Date(envelope.timestamp) : null;
      
      if (paymentInitiatedAt) {
        const daysSinceInitiation = (Date.now() - paymentInitiatedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceInitiation > expiryDays) {
          this.pipelineLog(request, 'cancelled: payment window expired', {
            ageDays: Math.floor(daysSinceInitiation),
            expiryDays,
          }, 'warn');
          
          request.overallStatus = 'cancelled';
          request.lastUpdated = new Date().toISOString();
          this.stateManager.saveRequest(request);

          // Send cancellation email for payment expiry
          this.emailLog(request, 'cancellation', 'payment', 'queued for payment expiry');
          this.sendCancellationEmail(request, 'Payment Processing', `Payment window expired (${expiryDays} days)`, 'payment').catch(err => {
            this.logger.warn(`Failed to send cancellation email:`, err);
          });

          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.warn(`Failed to check payment expiry:`, error);
      return false;
    }
  }

  /**
   * Continue with envelope processing after checks
   */
  private continueEnvelopeProcessing<K extends keyof EnvelopeCollection>(
    processor: EnvelopeProcessor<EnvelopeCollection[K]>,
    request: ServiceRequest,
    envelopeType: K,
    envelope: EnvelopeCollection[K]
  ): Observable<ServiceRequest> {
    // Resume if status is pending_external — we try processing again
    if (envelope.status === 'pending_external') {
      this.envelopeLog(request, envelopeType, 'resuming from pending_external');
    }

    if (envelope.status === 'failed') {
      this.envelopeLog(request, envelopeType, 'retrying after previous failure', {}, 'warn');
    }

    this.envelopeLog(request, envelopeType, 'processor invoked', { status: envelope.status });
    
    return processor.process(request, envelope).pipe(
      switchMap(updatedEnvelope => {
        request.envelopes[envelopeType] = updatedEnvelope;
        request.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(request, updatedEnvelope.status, envelopeType);

        this.envelopeLog(request, envelopeType, 'processor completed', { status: updatedEnvelope.status });

          // Send start email exactly once per envelope — guard prevents double-fire on resume.
          // If both start and end are due in the same pass (fast envelopes), ensure start is
          // dispatched first, then end, to keep logs and recipient experience in sequence.
          const envelopeForEmailCheck = request.envelopes[envelopeType] as any;
          const deliveryMethod = envelopeType === 'delivery'
            ? (request.envelopes.delivery as any)?.method
            : undefined;
          let startEmailPromise: Promise<void> | null = null;
          // Delivery semantics:
          // - email method: document email is sent by DeliveryProcessor on code 1 trigger
          // - physical_mail/pickup: send delivery START email when delivery begins
          const shouldSendStartEmail =
            !['waived', 'skipped', 'failed', 'cancelled'].includes(updatedEnvelope.status) &&
            !envelopeForEmailCheck?.startEmailSentAt &&
            (
              envelopeType !== 'delivery' ||
              (deliveryMethod && deliveryMethod !== 'email')
            );

          if (shouldSendStartEmail) {
            this.emailLog(request, envelopeType, 'start', 'queued');
            startEmailPromise = this.sendEnvelopeEmailTemplate(request, envelopeType, 'start').catch(err => {
            this.emailLog(request, envelopeType, 'start', 'failed', { error: err.message }, 'warn');
            });
          } else {
            this.emailLog(request, envelopeType, 'start', 'not queued', {
              reason: envelopeForEmailCheck?.startEmailSentAt ? 'already sent' : 'not applicable',
            });
          }

          // Send end email exactly once on completion — guard prevents double-fire on resume.
          // Keep one meaningful delivery email in success path:
          // do not send envelope END email for delivery, because delivery notifications
          // are method-driven (email dispatch on code 1, pickup-ready notification, etc.).
          const shouldSendEndEmail =
            updatedEnvelope.status === 'completed' &&
            !envelopeForEmailCheck?.endEmailSentAt &&
            (
              envelopeType !== 'delivery' ||
              (deliveryMethod && deliveryMethod !== 'email')
            );

          if (shouldSendEndEmail) {
            const sendEndEmail = () => {
              this.emailLog(request, envelopeType, 'end', 'queued');
              this.sendEnvelopeEmailTemplate(request, envelopeType, 'end').catch(err => {
                this.emailLog(request, envelopeType, 'end', 'failed', { error: err.message }, 'warn');
              });
            };

            if (startEmailPromise) {
              void startEmailPromise.finally(sendEndEmail);
            } else {
              sendEndEmail();
            }
          }

        // Pause if processor signals pending_external
        if (updatedEnvelope.status === 'pending_external') {
          this.envelopeLog(request, envelopeType, 'paused for external work', { status: updatedEnvelope.status }, 'warn');
          // Update overall status to reflect the current stage
          request.overallStatus = this.mapEnvelopeToOverallStatus(envelopeType);
          request.lastUpdated = new Date().toISOString();
          this.stateManager.saveRequest(request);
          return throwError(() => new Error('[PIPELINE PAUSED]: pending_external'));
        }

      // If approval failed, save and pause instead of failing the whole request
        if (updatedEnvelope.status === 'failed') {
          // Special handling for approval denial - cancel entire request
          if (envelopeType === 'approval') {
            const approvalEnvelope = updatedEnvelope as ApprovalEnvelope;
            const deniedApprover = approvalEnvelope.approvers?.find((a: any) => a.status === 'denied');
            const reason = deniedApprover 
              ? `Your request was denied by ${deniedApprover.role} (${deniedApprover.id})`
              : 'Your request was denied by an approver';
            
            request.overallStatus = 'cancelled';
            request.lastUpdated = new Date().toISOString();
            this.stateManager.saveRequest(request);
            this.pipelineLog(request, 'cancelled: approval denied', { approver: deniedApprover?.id }, 'warn');

            // Send cancellation email with denial details
            this.emailLog(request, 'cancellation', 'approval', 'queued for approval denial');
            this.sendCancellationEmail(request, 'Approval Process', reason, 'approval').catch(err => {
              this.logger.warn(`Failed to send cancellation email:`, err);
            });

            return throwError(() => new Error(`[REQUEST CANCELLED]: Approval denied`));
          }

          // Special handling for processing envelope - cancel entire request
          if (envelopeType === 'processing') {
            const processingEnvelope = updatedEnvelope as ProcessingEnvelope;
            const failedTask = processingEnvelope.tasks?.find((t: any) => t.status === 'failed');
            const failureDetails = failedTask?.responseError || 'Unknown error';
            
            request.overallStatus = 'cancelled';
            request.lastUpdated = new Date().toISOString();
            this.stateManager.saveRequest(request);
            this.pipelineLog(request, 'cancelled: processing failed', {
              task: failedTask?.name || 'unknown',
              error: failureDetails,
            }, 'warn');

            // Send cancellation email with failure details
            this.emailLog(request, 'cancellation', 'processing', 'queued for processing failure', {
              task: failedTask?.name || 'unknown',
            });
            this.sendCancellationEmail(request, failedTask?.name || 'Unknown', failureDetails, 'processing').catch(err => {
              this.logger.warn(`Failed to send cancellation email:`, err);
            });

            return throwError(() => new Error(`[REQUEST CANCELLED]: Processing envelope failed - ${failureDetails}`));
          }

          // For other envelopes, just pause
          this.envelopeLog(request, envelopeType, 'paused after failure', { status: updatedEnvelope.status }, 'warn');
          request.overallStatus = this.mapEnvelopeToOverallStatus(envelopeType);
          request.lastUpdated = new Date().toISOString();
          this.stateManager.saveRequest(request);
          return throwError(() => new Error(`[PIPELINE PAUSED]: ${envelopeType} envelope failed`));
        }

        this.envelopeLog(request, envelopeType, 'finished; pipeline may continue', { status: updatedEnvelope.status });
        return of(request);
      }),
      catchError(error => {
        this.envelopeLog(request, envelopeType, 'error', { error: error.message }, 'error');
        return throwError(() => error);
      }),
      tap(req => {
        this.envelopeLog(req, envelopeType, 'state saved', { status: req.envelopes[envelopeType].status });
        this.stateManager.saveRequest(req);
      })
    );
  }

  /**
   * Send email template for an envelope using service-defined templates first,
   * then core generic fallback templates.
   * Non-blocking operation - doesn't delay envelope processing.
   * Phase: 'start' = emailTemplateStartEnvelope, 'end' = emailTemplateEndEnvelope (Process Completes & Summary)
   */
  private async sendEnvelopeEmailTemplate<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K,
    phase: 'start' | 'end' = 'start'
  ): Promise<void> {
    const marker = `[${envelopeType.toUpperCase()}-${phase.toUpperCase()}-EMAIL]`;
    
    try {
      this.emailLog(request, envelopeType, phase, 'started');

      // Check if email service is available
      if (!appContext?.emailService) {
        this.emailLog(request, envelopeType, phase, 'skipped', { reason: 'email service unavailable' }, 'warn');
        this.logger.debug(`📧 Email service not available`);
        return;
      }

      // Get service definition by type
      const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);

      if (!serviceDefinition) {
        this.emailLog(request, envelopeType, phase, 'skipped', { reason: 'service definition not found' }, 'warn');
        this.logger.debug(`📧 Service definition not found`);
        return;
      }

      // Check if envelopes exist - they might be nested in "definition"
      let envelopes = serviceDefinition.envelopes;
      if (!envelopes && serviceDefinition.definition?.envelopes) {
        envelopes = serviceDefinition.definition.envelopes;
      }

      if (!envelopes?.[envelopeType]) {
        this.emailLog(request, envelopeType, phase, 'skipped', {
          reason: 'envelope config not found',
          availableEnvelopes: envelopes ? Object.keys(envelopes) : [],
        }, 'warn');
        this.logger.debug(`📧 Envelope config not found for: ${envelopeType}`);
        return;
      }

      const envelopeConfig = envelopes[envelopeType];

      // Get template name based on phase and then apply fallback candidates.
      const configuredTemplateName = phase === 'start'
        ? envelopeConfig.emailTemplateStartEnvelope 
        : envelopeConfig.emailTemplateEndEnvelope;
      const envelopeDefaultTemplateName = phase === 'start'
        ? envelopeConfig.defaultEmailTemplateStartEnvelope
        : envelopeConfig.defaultEmailTemplateEndEnvelope;
      const serviceScopedGenericTemplateName = `${request.type}-${String(envelopeType)}-${phase}`;
      const globalGenericTemplateName = `${String(envelopeType)}-${phase}`;

      const templateCandidates = [
        configuredTemplateName,
        envelopeDefaultTemplateName,
        serviceScopedGenericTemplateName,
        globalGenericTemplateName,
      ];

      const candidateLogList = [...new Set(templateCandidates.filter((candidate): candidate is string => !!candidate))];
      this.consoleLine('Template', 'resolving candidates', {
        request: request.id,
        envelope: String(envelopeType),
        phase,
        candidates: candidateLogList,
      });
      const templateResolution = await this.resolveEmailTemplateByCandidates(templateCandidates, {
        yamlConfiguredCandidates: [configuredTemplateName, envelopeDefaultTemplateName],
        serviceScopedGenericCandidates: [serviceScopedGenericTemplateName],
        globalGenericCandidates: [globalGenericTemplateName],
      });

      if (!templateResolution) {
        this.consoleLine('Template', 'not found', {
          request: request.id,
          envelope: String(envelopeType),
          phase,
          candidates: candidateLogList,
        }, 'warn');
        return;
      }
      const template = templateResolution.template;
      this.consoleLine('Template', 'matched', {
        request: request.id,
        envelope: String(envelopeType),
        phase,
        candidate: templateResolution.matchedCandidate,
        source: templateResolution.source,
        template: template.name || template.id || 'unnamed',
      });

      // Determine recipients based on envelope type
      const recipients = this.getEmailRecipients(request, envelopeType, phase);

      if (!recipients || recipients.length === 0) {
        this.emailLog(request, envelopeType, phase, 'skipped', { reason: 'no recipients' }, 'warn');
        return;
      }

      this.consoleLine('Recipients', 'resolved', {
        request: request.id,
        envelope: String(envelopeType),
        phase,
        count: recipients.length,
        recipients,
      });

      // Canonical token generation path (single source of truth — ThirdPartyService no longer does this).
      // Uses configured expiryHours from the approval envelope. Skips approvers that already have a token
      // so resume calls do not re-generate or duplicate tokens.
      if (envelopeType === 'approval' && phase === 'start') {
        this.emailLog(request, envelopeType, phase, 'checking approval tokens');
        const approvalEnvelope = request.envelopes.approval as any;
        const configuredExpiryHours = approvalEnvelope?.expiryHours;

        if (approvalEnvelope?.approvers) {
          for (const approver of approvalEnvelope.approvers) {
            if (approver.approvalToken) {
              this.emailLog(request, envelopeType, phase, 'approval token exists', { approver: approver.email || approver.id });
              continue;
            }
            const { randomUUID } = await import('crypto');
            const token = randomUUID();
            approver.approvalToken = token;
            await this.stateManager.saveApprovalToken(token, request.id, approver.id, configuredExpiryHours);
            this.emailLog(request, envelopeType, phase, 'approval token created', {
              approver: approver.email || approver.id,
              expiryHours: configuredExpiryHours ?? 'default',
            });
          }
          // Persist updated approver tokens immediately so subsequent reads see them
          await this.stateManager.saveRequest(request);
        }
      }

      // Prepare email context with all available variables for substitution
      let emailContext = await this.buildEmailContext(request, envelopeType);
      this.emailLog(request, envelopeType, phase, 'context prepared', { keys: Object.keys(emailContext).length });

      // Send email to each recipient
      let allEmailsSent = true;
      for (const recipient of recipients) {
        // For approval emails, build context specific to this approver
        let currentContext = emailContext;
        if (envelopeType === 'approval' && phase === 'start') {
          const approvalEnvelope = request.envelopes.approval as any;
          const approver = approvalEnvelope?.approvers?.find((a: any) => (a.email || a.id) === recipient);
          if (approver) {
            currentContext = {
              ...emailContext,
              approverName: approver.role || 'Approver',
              approverEmail: approver.email || approver.id || recipient,
              approvalToken: approver.approvalToken || '',
              approvalLink: approver.approvalToken 
                ? `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/approvals/${approver.approvalToken}`
                : '',
            };
            this.emailLog(request, envelopeType, phase, 'approval link prepared', { approver: approver.email || approver.id });
          }
        }

        const subject = this.substituteVariables(template.subject, currentContext);
        const html = this.substituteVariables(template.htmlBody, currentContext);

        this.emailLog(request, envelopeType, phase, 'sending', { to: recipient, subject });

        // Send via email service (non-blocking)
        const sendResult = await appContext.emailService.sendEmail({
          to: recipient,
          subject,
          html,
        });

        if (!sendResult) {
          allEmailsSent = false;
          this.emailLog(request, envelopeType, phase, 'send returned false', { to: recipient }, 'warn');
        } else {
          this.emailLog(request, envelopeType, phase, 'sent', { to: recipient });
        }
      }
      if (!allEmailsSent) {
        this.logger.warn(`${marker} Not marking email as sent because at least one recipient failed`);
        return;
      }
      // Persist the sent-at timestamp on the envelope so the guard works on resume
      const sentAt = new Date().toISOString();
      const latestRequest = await this.stateManager.loadRequest(request.id) || request;
      const envelopeToMark = latestRequest.envelopes[envelopeType] as any;
      if (phase === 'start') {
        envelopeToMark.startEmailSentAt = sentAt;
        (request.envelopes[envelopeType] as any).startEmailSentAt = sentAt;
      } else {
        envelopeToMark.endEmailSentAt = sentAt;
        (request.envelopes[envelopeType] as any).endEmailSentAt = sentAt;
      }
      await this.stateManager.saveRequest(latestRequest);

      this.emailLog(request, envelopeType, phase, 'completed', { sentAt });
    } catch (error) {
      this.emailLog(request, envelopeType, phase, 'error', {
        error: error instanceof Error ? error.message : String(error),
      }, 'error');
      throw error;
    }
  }

  /**
   * Get email recipients based on envelope type
   */
  private getEmailRecipients<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K,
    phase: 'start' | 'end' = 'start'
  ): string[] {
    const recipients: string[] = [];
    const requesterEmail = this.getRequesterEmail(request);

    switch (envelopeType) {
      case 'request':
        // Send to requester - email is in request.envelopes.request.parameters.email
        const requestEmail = requesterEmail;
        if (requestEmail) {
          recipients.push(requestEmail);
        }
        break;

      case 'approval':
        if (phase === 'end') {
          if (requesterEmail) {
            recipients.push(requesterEmail);
          }
          break;
        }

        // Send to all approvers
        const approval = request.envelopes.approval as any;

        if (approval?.approvers && Array.isArray(approval.approvers)) {
          approval.approvers.forEach((approver: any) => {
            const approverEmail = approver?.email || approver?.id;
            if (approverEmail) {
              recipients.push(approverEmail);
            }
          });
        } else {
          this.consoleLine('Recipients', 'approval approvers missing', {
            request: request.id,
            envelope: String(envelopeType),
            phase,
          }, 'warn');
        }
        break;

      case 'payment':
        // Send to requester
        const paymentEmail = requesterEmail;
        if (paymentEmail) {
          recipients.push(paymentEmail);
        }
        break;

      case 'processing':
        // Send to requester
        const processingEmail = requesterEmail;
        if (processingEmail) {
          recipients.push(processingEmail);
        }
        break;

      case 'delivery':
        // Send to requester
        const deliveryEmail = requesterEmail;
        if (deliveryEmail) {
          recipients.push(deliveryEmail);
        }
        break;

      case 'feedback':
        // Send to requester
        const feedbackEmail = requesterEmail;
        if (feedbackEmail) {
          recipients.push(feedbackEmail);
        }
        break;
    }

    // Remove duplicates
    const uniqueRecipients = [...new Set(recipients)];
    return uniqueRecipients;
  }

  private getRequesterEmail(request: ServiceRequest): string {
    return resolveRequesterEmail(request);
  }

  /**
   * Build context object for variable substitution with all available request data
   */
  private async buildEmailContext<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K
  ): Promise<Record<string, any>> {
    const requestEnvelope = request.envelopes.request as any;
    const approvalEnvelope = request.envelopes.approval as any;
    const requestParams = requestEnvelope?.parameters || {};
    const serviceData = requestParams?.serviceData || {};
    const requesterEmail = this.getRequesterEmail(request);
    const paymentEnvelope = request.envelopes.payment as any;
    const paymentGatewayResponse = paymentEnvelope?.paymentGatewayResponse || {};
    const deliveryEnvelope = request.envelopes.delivery as any;

    const latestDeliveryUpdate =
      deliveryEnvelope?.deliveryHistory?.[deliveryEnvelope.deliveryHistory.length - 1] || null;
    const resolvedTrackingId =
      latestDeliveryUpdate?.trackingId ||
      deliveryEnvelope?.details?.physical_mail?.trackingId ||
      '';

    const configuredTrackingUrlTemplate =
      `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/delivery/${request.id}/tracking`;

    const deliveryTrackingUrl = this.substituteVariables(configuredTrackingUrlTemplate, {
      requestId: request.id,
      trackingId: resolvedTrackingId,
    });

    const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);
    const canonicalServiceDefinition = serviceDefinition?.definition || serviceDefinition || {};
    const serviceDisplayName =
      canonicalServiceDefinition.name ||
      serviceDefinition?.name ||
      request.type;
    const serviceId =
      canonicalServiceDefinition.id ||
      serviceDefinition?.id ||
      serviceDefinition?.serviceId ||
      '';

    return {
      ...serviceData,
      ...requestParams,
      // Request data
      requestId: request.id,
      serviceType: serviceDisplayName,
      serviceName: serviceDisplayName,
      serviceId,
      serviceDefinitionType: request.type,
      studentId: requestParams?.studentId || '',
      firstName: requestParams?.firstName || '',
      lastName: requestParams?.lastName || '',
      email: requesterEmail,
      requesterEmail,
      currentTimestamp: new Date().toISOString(),

      // Approval — defaults to first approver; per-approver send loop overrides these
      approverName: approvalEnvelope?.approvers?.[0]?.role || 'Approver',
      approverEmail: approvalEnvelope?.approvers?.[0]?.email || '',
      approvalToken: approvalEnvelope?.approvers?.[0]?.approvalToken || '',
      approvalLink: approvalEnvelope?.approvers?.[0]?.approvalToken
        ? `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/approvals/${approvalEnvelope.approvers[0].approvalToken}`
        : '',

      // Payment — direct link to Phase 2 payment page
      paymentLink: `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/payment?requestId=${request.id}`,
      transactionId: paymentEnvelope?.transactionId || paymentGatewayResponse.transactionId || '',
      paymentTransactionId: paymentEnvelope?.transactionId || paymentGatewayResponse.transactionId || '',
      paymentAmount: paymentGatewayResponse.amount ?? '',
      paymentCurrency: paymentGatewayResponse.currency || 'PHP',
      paymentMethod: paymentGatewayResponse.method || '',
      paymentReference: paymentGatewayResponse.reference || '',
      paymentTimestamp: paymentGatewayResponse.timestamp || paymentGatewayResponse.webhookTimestamp || '',

      // Feedback — link generated by FeedbackProcessor and stored on the envelope
      feedbackLink: (request.envelopes.feedback as any)?.feedbackLink || '',
      feedbackToken: (request.envelopes.feedback as any)?.feedbackToken || '',
      trackingId: resolvedTrackingId,
      deliveryTrackingUrl,

      // Delivery document links (resolved at execution time by delivery processor, stored on details)
      documentLinks: deliveryEnvelope?.details?.email?.resolvedDocumentLinksHtml || '',
      documentLinksText: deliveryEnvelope?.details?.email?.resolvedDocumentLinksText || '',

      // Generic fields
      documentTypes: Array.isArray(requestParams?.documentTypes)
        ? requestParams.documentTypes.join(', ')
        : requestParams?.documentTypes || '',
      purpose: requestParams?.purpose || '',
      numberOfCopies: requestParams?.numberOfCopies || '',
      deliveryMethod: (request.envelopes.delivery as any)?.method || requestParams?.deliveryMethod || '',
      isUrgent: requestParams?.isUrgent || 'No',
      remarks: requestParams?.remarks || '',
    };
  }

  /**
   * Substitute {{variables}} in template with context values
   */
  private substituteVariables(text: string, context: Record<string, any>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return context[key] !== undefined ? String(context[key]) : match;
    });
  }

  /**
   * Resolve a template by trying a prioritized candidate list.
   */
  private async resolveEmailTemplateByCandidates(
    candidates: Array<string | undefined | null>,
    context?: {
      yamlConfiguredCandidates?: Array<string | undefined | null>;
      serviceScopedGenericCandidates?: Array<string | undefined | null>;
      globalGenericCandidates?: Array<string | undefined | null>;
      runtimeCandidates?: Array<string | undefined | null>;
    }
  ): Promise<{ template: any; matchedCandidate: string; source: string } | null> {
    const runtimeSet = new Set(
      (context?.runtimeCandidates || []).filter((candidate): candidate is string => !!candidate)
    );
    const yamlConfiguredSet = new Set(
      (context?.yamlConfiguredCandidates || []).filter((candidate): candidate is string => !!candidate)
    );
    const serviceScopedGenericSet = new Set(
      (context?.serviceScopedGenericCandidates || []).filter((candidate): candidate is string => !!candidate)
    );
    const globalGenericSet = new Set(
      (context?.globalGenericCandidates || []).filter((candidate): candidate is string => !!candidate)
    );

    for (const name of [...new Set(candidates.filter((candidate): candidate is string => !!candidate))]) {
      const template = await this.stateManager.getEmailTemplate(name)
        || await this.stateManager.getEmailTemplateByName(name);
      if (template) {
        let source = 'unknown';
        if (runtimeSet.has(name)) {
          source = 'runtime-override';
        } else if (yamlConfiguredSet.has(name)) {
          source = 'yaml-service-definition';
        } else if (serviceScopedGenericSet.has(name)) {
          source = 'generic-service-scoped';
        } else if (globalGenericSet.has(name)) {
          source = 'generic-global';
        }

        return {
          template,
          matchedCandidate: name,
          source,
        };
      }
    }
    return null;
  }

  /**
   * Get the processor for a given envelope type
   */
  private getProcessor<K extends keyof EnvelopeCollection>(
    envelopeType: K
  ): EnvelopeProcessor<EnvelopeCollection[K]> {
    switch (envelopeType) {
      case 'request':
        return this.requestProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
      case 'approval':
        return this.approvalProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
      case 'payment':
        return this.paymentProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
      case 'processing':
        return this.processingProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
      case 'delivery':
        return this.deliveryProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
      case 'feedback':
        return this.feedbackProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
      default:
        throw new Error(`Unknown envelope type: ${envelopeType}`);
    }
  }

  /**
   * Append to request history
   */
  private addHistoryEntry(request: ServiceRequest, status: string, envelope: string, notes?: string) {
    request.history.push({
      status,
      timestamp: new Date().toISOString(),
      envelope,
      notes
    });
  }

  /**
   * Map envelope type to a meaningful overall status
   * Used when an envelope is waiting on external processes (pending_external)
   */
  private mapEnvelopeToOverallStatus(envelopeType: keyof EnvelopeCollection): 'pending_approval' | 'pending_payment' | 'processing' | 'pending_delivery' | 'pending_feedback' | 'process_pending' {
    switch (envelopeType) {
      case 'approval':
        return 'pending_approval';
      case 'payment':
        return 'pending_payment';
      case 'processing':
        return 'processing';
      case 'delivery':
        return 'pending_delivery';
      case 'feedback':
        return 'pending_feedback';
      default:
        return 'process_pending';
    }
  }

  /**
   * Send cancellation email.
   * Template name is resolved from the triggering envelope's emailTemplateCancelEnvelope
   * field first, then core generic cancellation/denial fallbacks.
   */
  private async sendCancellationEmail(
    request: ServiceRequest,
    failedTask: string,
    failureDetails: string,
    triggerEnvelopeType?: 'approval' | 'payment' | 'processing' | 'delivery' | 'feedback'
  ): Promise<void> {
    try {
      if (!appContext?.emailService) {
        this.logger.warn(`[CANCELLATION-EMAIL] Email service not available`);
        return;
      }

      // Resolve cancel/denial template from service definition (per envelope), then service/global generic candidates.
      let configuredCancelTemplateName: string | undefined;
      let defaultEnvelopeCancelTemplateName: string | undefined;
      try {
        const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);
        const envs = serviceDefinition?.envelopes || serviceDefinition?.definition?.envelopes || {};
        const envConfig = triggerEnvelopeType ? envs[triggerEnvelopeType] : null;
        configuredCancelTemplateName =
          envConfig?.emailTemplateCancelEnvelope ||
          envs?.approval?.emailTemplateCancelEnvelope ||
          envs?.payment?.emailTemplateCancelEnvelope ||
          envs?.processing?.emailTemplateCancelEnvelope;
        defaultEnvelopeCancelTemplateName =
          triggerEnvelopeType && envs?.[triggerEnvelopeType]?.defaultEmailTemplateCancelEnvelope
            ? envs[triggerEnvelopeType].defaultEmailTemplateCancelEnvelope
            : undefined;
      } catch {
        // Keep fallback
      }

      const primaryGenericKey = triggerEnvelopeType === 'approval'
        ? 'request-denied'
        : 'request-cancelled';
      const serviceScopedPrimaryGenericTemplateName = `${request.type}-${primaryGenericKey}`;
      const globalPrimaryGenericTemplateName = primaryGenericKey;
      const serviceScopedFallbackGenericTemplateName = `${request.type}-request-cancelled`;
      const globalFallbackGenericTemplateName = 'request-cancelled';
      const serviceScopedGenericCandidates = [
        serviceScopedPrimaryGenericTemplateName,
        serviceScopedFallbackGenericTemplateName,
      ];
      const globalGenericCandidates = [
        globalPrimaryGenericTemplateName,
        globalFallbackGenericTemplateName,
      ];

      const templateResolution = await this.resolveEmailTemplateByCandidates([
        configuredCancelTemplateName,
        defaultEnvelopeCancelTemplateName,
        serviceScopedPrimaryGenericTemplateName,
        globalPrimaryGenericTemplateName,
        serviceScopedFallbackGenericTemplateName,
        globalFallbackGenericTemplateName,
      ], {
        yamlConfiguredCandidates: [configuredCancelTemplateName, defaultEnvelopeCancelTemplateName],
        serviceScopedGenericCandidates,
        globalGenericCandidates,
      });

      if (!templateResolution) {
        this.logger.warn(`[CANCELLATION-EMAIL] No cancellation template found for request ${request.id}`);
        return;
      }
      const template = templateResolution.template;

      // Build email context with failure details
      const requesterEmail = this.getRequesterEmail(request);
      const submittedDate = request.createdAt || new Date().toISOString();
      const baseEmailContext = await this.buildEmailContext(request, triggerEnvelopeType || 'request');
      
      const emailContext = {
        ...baseEmailContext,
        failedTask: failedTask,
        failureDetails: failureDetails,
        cancellationReason: `Technical issue during document processing - ${failedTask} failed`,
        requestSubmittedDate: submittedDate,
      };

      // Build email content
      const subject = this.substituteVariables(template.subject, emailContext);
      const html = this.substituteVariables(template.htmlBody, emailContext);

      // Send to requester
      const recipient = requesterEmail;
      if (!recipient) {
        this.logger.warn(`[CANCELLATION-EMAIL] No recipient email found`);
        return;
      }

      this.emailLog(request, 'cancellation', triggerEnvelopeType || 'unknown', 'sending', {
        to: recipient,
        subject,
        failedTask,
        error: failureDetails,
      });

      const sendResult = await appContext.emailService.sendEmail({
        to: recipient,
        subject,
        html,
      });

      if (sendResult) {
        this.emailLog(request, 'cancellation', triggerEnvelopeType || 'unknown', 'sent', { to: recipient });
      } else {
        this.emailLog(request, 'cancellation', triggerEnvelopeType || 'unknown', 'send returned false', { to: recipient }, 'warn');
      }
    } catch (error) {
      this.logger.error(`[CANCELLATION-EMAIL] Error sending cancellation email:`, error);
    }
  }
}
