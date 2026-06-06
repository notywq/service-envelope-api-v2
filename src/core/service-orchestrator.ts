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

  /**
   * Main orchestration method
   */
  processRequest(request: ServiceRequest): Observable<ServiceRequest> {
    console.log(`\n🎯 [ORCHESTRATOR-START] Beginning orchestration for request: ${request.id}`);
    this.logger.info(`Starting orchestration for request ${request.id}`);

    return of(request).pipe(
      tap(req => {
        console.log(`💾 [ORCHESTRATOR-INIT] Saving initial request state`);
        this.stateManager.saveRequest(req);
      }),

      // Sequentially process all envelopes
      switchMap(req => {
        console.log(`\n📦 [ORCHESTRATOR-FLOW] Moving to REQUEST envelope`);
        return this.processEnvelope(req, 'request');
      }),
      switchMap(req => {
        console.log(`\n📦 [ORCHESTRATOR-FLOW] Moving to APPROVAL envelope`);
        return this.processEnvelope(req, 'approval');
      }),
      switchMap(req => {
        console.log(`\n📦 [ORCHESTRATOR-FLOW] Moving to PAYMENT envelope`);
        return this.processEnvelope(req, 'payment');
      }),
      switchMap(req => {
        console.log(`\n📦 [ORCHESTRATOR-FLOW] Moving to PROCESSING envelope`);
        return this.processEnvelope(req, 'processing');
      }),
      switchMap(req => {
        console.log(`\n📦 [ORCHESTRATOR-FLOW] Moving to DELIVERY envelope`);
        return this.processEnvelope(req, 'delivery');
      }),
      switchMap(req => {
        console.log(`\n📦 [ORCHESTRATOR-FLOW] Moving to FEEDBACK envelope`);
        return this.processEnvelope(req, 'feedback');
      }),

      // Finalize request if all envelopes processed
      tap(req => {
        console.log(`\n✅ [ORCHESTRATOR-COMPLETE] All envelopes processed! Marking request as COMPLETED`);
        req.overallStatus = 'completed';
        req.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(req, 'completed', 'system');
        this.stateManager.saveRequest(req);
        this.logger.info(`Request ${req.id} completed successfully`);
      }),

      catchError(error => {
        const errorMsg = error.message || '';
        
        console.log(`\n❌ [ORCHESTRATOR-ERROR] Pipeline error: ${errorMsg}`);
        
        // If this is a pending_external pause, don't mark as failed
        // The status has already been set correctly in processEnvelope
        if (errorMsg.includes('pending_external')) {
          console.log(`⏸️  [ORCHESTRATOR-PAUSED] Pipeline paused - waiting for external processes`);
          this.logger.info(`Request ${request.id} paused - waiting for external processes`);
          return throwError(() => error);
        }
        
        // For other errors, mark as failed
        console.log(`❌ [ORCHESTRATOR-FAILED] Marking request as FAILED`);
        this.logger.error(`Request ${request.id} failed: ${error.message}`);
        request.overallStatus = 'failed';
        this.addHistoryEntry(request, 'failed', 'system', error.message);
        this.stateManager.saveRequest(request);
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
    console.log(`\n✅ [PROCESS-ENVELOPE-START] Starting ${envelopeType.toUpperCase()} envelope processing for request ${request.id}`);
    
    const processor = this.getProcessor(envelopeType);
    const envelope = request.envelopes[envelopeType];
    
    console.log(`📋 [PROCESS-ENVELOPE-START] Current ${envelopeType} envelope status: ${envelope.status}`);

    // Skip if already completed or failed
    if (['completed', 'waived'].includes(envelope.status)) {
      console.log(`⏭️  [PROCESS-ENVELOPE-SKIP] Skipping ${envelopeType.toUpperCase()} (already ${envelope.status})`);
      this.logger.info(`Skipping ${envelopeType.toUpperCase()} (status: ${envelope.status.toUpperCase()}) for request ${request.id}`);
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
          console.log(`❌ CANCELLING REQUEST - Payment expired (${Math.floor(daysSinceInitiation)} days > ${expiryDays} days)`);
          this.logger.error(
            `[REQUEST CANCELLED] Payment expired for request ${request.id} | Initiated ${Math.floor(daysSinceInitiation)} days ago, expiry is ${expiryDays} days`
          );
          
          request.overallStatus = 'cancelled';
          request.lastUpdated = new Date().toISOString();
          this.stateManager.saveRequest(request);

          // Send cancellation email for payment expiry
          console.log(`📧 Sending cancellation email for payment expiry...`);
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
      console.log(`🔄 [PROCESS-ENVELOPE-RESUME] Resuming ${envelopeType.toUpperCase()} from pending_external`);
      this.logger.info(`Resuming ${envelopeType.toUpperCase()} for request ${request.id}`);
    }

    if (envelope.status === 'failed') {
      console.log(`🔄 [PROCESS-ENVELOPE-RETRY] Retrying ${envelopeType.toUpperCase()} after previous failure`);
      this.logger.warn(
        `[RETRY ENVELOPE ENABLED] ${envelopeType.toUpperCase()} previously failed for request ${request.id}. Retrying now...`
      );
    }

    console.log(`🚀 [PROCESS-ENVELOPE-EXEC] Calling processor.process() for ${envelopeType.toUpperCase()}`);
    console.log(`🚀 [PROCESS-ENVELOPE-DEBUG] Envelope object before processing:`, { type: envelopeType, status: envelope.status });
    
    return processor.process(request, envelope).pipe(
      tap(() => console.log(`📍 [PROCESS-ENVELOPE-TAP] Observable from ${envelopeType} processor emitted`)),
      switchMap(updatedEnvelope => {
        console.log(`✅ [PROCESS-ENVELOPE-COMPLETE] ${envelopeType.toUpperCase()} processor returned status: ${updatedEnvelope.status}`);
        
        request.envelopes[envelopeType] = updatedEnvelope;
        request.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(request, updatedEnvelope.status, envelopeType);

        console.log(`\n📧 [ENVELOPE-PROCESSING] ${envelopeType.toUpperCase()}: Processing complete with status: ${updatedEnvelope.status}`);

          // Send start email exactly once per envelope — guard prevents double-fire on resume.
          // If both start and end are due in the same pass (fast envelopes), ensure start is
          // dispatched first, then end, to keep logs and recipient experience in sequence.
          const envelopeForEmailCheck = request.envelopes[envelopeType] as any;
          let startEmailPromise: Promise<void> | null = null;
          if (!envelopeForEmailCheck?.startEmailSentAt) {
            console.log(`📧 [${envelopeType.toUpperCase()}] Sending START email (first time)`);
            startEmailPromise = this.sendEnvelopeEmailTemplate(request, envelopeType, 'start').catch(err => {
              console.log(`⚠️  [${envelopeType.toUpperCase()}-START-EMAIL] Failed:`, err.message);
              this.logger.warn(`Failed to process start email for ${envelopeType}:`, err);
            });
          } else {
            console.log(`⏭️  [${envelopeType.toUpperCase()}] START email already sent, skipping`);
          }

          // Send end email exactly once on completion — guard prevents double-fire on resume.
          if (updatedEnvelope.status === 'completed' && !envelopeForEmailCheck?.endEmailSentAt) {
            const sendEndEmail = () => {
              console.log(`📧 [${envelopeType.toUpperCase()}] Sending END email (completion)`);
              this.sendEnvelopeEmailTemplate(request, envelopeType, 'end').catch(err => {
                console.log(`⚠️  [${envelopeType.toUpperCase()}-END-EMAIL] Failed:`, err.message);
                this.logger.warn(`Failed to process completion email for ${envelopeType}:`, err);
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
          console.log(`⏸️  PAUSING - ${envelopeType} is pending_external`);
          this.logger.warn(
            `\x1b[36m[PAUSING PIPELINE]\x1b[0m — ${envelopeType} is waiting for external processes to complete (request ${request.id})`
          );
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
            console.log(`❌ CANCELLING REQUEST - Approval denied`);
            const approvalEnvelope = updatedEnvelope as ApprovalEnvelope;
            const deniedApprover = approvalEnvelope.approvers?.find((a: any) => a.status === 'denied');
            const reason = deniedApprover 
              ? `Your request was denied by ${deniedApprover.role} (${deniedApprover.id})`
              : 'Your request was denied by an approver';
            
            this.logger.error(
              `[REQUEST CANCELLED] Approval envelope failed for request ${request.id} | Denied by: ${deniedApprover?.id}`
            );
            
            request.overallStatus = 'cancelled';
            request.lastUpdated = new Date().toISOString();
            this.stateManager.saveRequest(request);

            // Send cancellation email with denial details
            console.log(`📧 Sending cancellation email for approval denial...`);
              this.sendCancellationEmail(request, 'Approval Process', reason, 'approval').catch(err => {
              this.logger.warn(`Failed to send cancellation email:`, err);
            });

            return throwError(() => new Error(`[REQUEST CANCELLED]: Approval denied`));
          }

          // Special handling for processing envelope - cancel entire request
          if (envelopeType === 'processing') {
            console.log(`❌ CANCELLING REQUEST - Processing failed`);
            const processingEnvelope = updatedEnvelope as ProcessingEnvelope;
            const failedTask = processingEnvelope.tasks?.find((t: any) => t.status === 'failed');
            const failureDetails = failedTask?.responseError || 'Unknown error';
            
            this.logger.error(
              `[REQUEST CANCELLED] Processing envelope failed for request ${request.id} | Failed task: ${failedTask?.name} | Error: ${failureDetails}`
            );
            
            request.overallStatus = 'cancelled';
            request.lastUpdated = new Date().toISOString();
            this.stateManager.saveRequest(request);

            // Send cancellation email with failure details
            console.log(`📧 Sending cancellation email with failure details...`);
            this.sendCancellationEmail(request, failedTask?.name || 'Unknown', failureDetails, 'processing').catch(err => {
              this.logger.warn(`Failed to send cancellation email:`, err);
            });

            return throwError(() => new Error(`[REQUEST CANCELLED]: Processing envelope failed - ${failureDetails}`));
          }

          // For other envelopes, just pause
          console.log(`❌ PAUSING - ${envelopeType} failed`);
          this.logger.warn(
            `[PAUSING PIPELINE] ${envelopeType.toUpperCase()} failed for request ${request.id} — will allow retry on resume`
          );
          request.overallStatus = this.mapEnvelopeToOverallStatus(envelopeType);
          request.lastUpdated = new Date().toISOString();
          this.stateManager.saveRequest(request);
          return throwError(() => new Error(`[PIPELINE PAUSED]: ${envelopeType} envelope failed`));
        }

        console.log(`✅ [PROCESS-ENVELOPE-RETURNING] Returning to continue pipeline for next envelope`);
        return of(request);
      }),
      catchError(error => {
        console.log(`❌ [PROCESS-ENVELOPE-ERROR] Error in ${envelopeType.toUpperCase()} processing:`, error.message);
        return throwError(() => error);
      }),
      tap(req => {
        console.log(`💾 [PROCESS-ENVELOPE-SAVE] Saving request state after ${envelopeType.toUpperCase()}`);
        this.stateManager.saveRequest(req);
      })
    );
  }

  /**
   * Send email template for an envelope if configured
   * Non-blocking operation - doesn't delay envelope processing
   * Phase: 'start' = emailTemplateStartEnvelope, 'end' = emailTemplateEndEnvelope (Process Completes & Summary)
   */
  private async sendEnvelopeEmailTemplate<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K,
    phase: 'start' | 'end' = 'start'
  ): Promise<void> {
    const marker = `[${envelopeType.toUpperCase()}-${phase.toUpperCase()}-EMAIL]`;
    
    try {
      console.log(`\n📧 ${marker} Starting email process for request: ${request.id}`);
      this.logger.info(`📧 ${marker} Triggering - Request ${request.id}`);

      // Check if email service is available
      if (!appContext?.emailService) {
        console.log(`❌ ${marker} Email service not available`);
        this.logger.debug(`📧 Email service not available`);
        return;
      }
      console.log(`✅ ${marker} Email service is available`);

      // Get service definition by type
      console.log(`🔍 ${marker} Looking up service definition for type: ${request.type}`);
      const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);

      if (!serviceDefinition) {
        console.log(`❌ ${marker} Service definition NOT found for type: ${request.type}`);
        this.logger.debug(`📧 Service definition not found`);
        return;
      }
      console.log(`✅ ${marker} Service definition found`);

      // Check if envelopes exist - they might be nested in "definition"
      let envelopes = serviceDefinition.envelopes;
      if (!envelopes && serviceDefinition.definition?.envelopes) {
        console.log(`⚠️  ${marker} Envelopes found in definition property`);
        envelopes = serviceDefinition.definition.envelopes;
      }

      if (!envelopes?.[envelopeType]) {
        console.log(`❌ ${marker} Envelope config NOT found for: ${envelopeType}`);
        console.log(`   Available envelopes:`, envelopes ? Object.keys(envelopes) : 'NONE');
        this.logger.debug(`📧 Envelope config not found for: ${envelopeType}`);
        return;
      }
      console.log(`✅ ${marker} Envelope config found for: ${envelopeType}`);

      const envelopeConfig = envelopes[envelopeType];
      console.log(`📋 ${marker} Envelope config keys:`, Object.keys(envelopeConfig));

      // Get template name based on phase and then apply fallback candidates.
      const configuredTemplateName = phase === 'start'
        ? envelopeConfig.emailTemplateStartEnvelope 
        : envelopeConfig.emailTemplateEndEnvelope;
      const envelopeDefaultTemplateName = phase === 'start'
        ? envelopeConfig.defaultEmailTemplateStartEnvelope
        : envelopeConfig.defaultEmailTemplateEndEnvelope;

      const genericEventKey = `${String(envelopeType)}-${phase}`;
      const templateCandidates = [
        configuredTemplateName,
        envelopeDefaultTemplateName,
        `${request.type}-${genericEventKey}`,
        genericEventKey,
      ];

      const candidateLogList = [...new Set(templateCandidates.filter((candidate): candidate is string => !!candidate))];
      console.log(`🔍 ${marker} Resolving template candidates: ${candidateLogList.join(', ')}`);
      const templateResolution = await this.resolveEmailTemplateByCandidates(templateCandidates, {
        yamlConfiguredCandidates: [configuredTemplateName, envelopeDefaultTemplateName],
        serviceScopedGenericCandidates: [`${request.type}-${genericEventKey}`],
        globalGenericCandidates: [genericEventKey],
      });

      if (!templateResolution) {
        console.log(`❌ ${marker} Template NOT found for any candidate`);
        this.logger.warn(`📧 Email template not found for candidates: ${candidateLogList.join(', ')}`);
        return;
      }
      const template = templateResolution.template;
      console.log(`✅ ${marker} Template loaded: ${template.name}`);
      this.logger.info(
        `[TEMPLATE-RESOLUTION] Request ${request.id} | Envelope ${String(envelopeType)}:${phase} | Matched: ${templateResolution.matchedCandidate} | Source: ${templateResolution.source} | TemplateId: ${template.id || 'n/a'} | TemplateScope: ${template.templateScope || 'n/a'}`
      );

      // Determine recipients based on envelope type
      console.log(`👥 ${marker} Determining recipients for envelope type: ${envelopeType}`);
      const recipients = this.getEmailRecipients(request, envelopeType);
      console.log(`📧 ${marker} Recipients:`, recipients);

      if (!recipients || recipients.length === 0) {
        console.log(`⚠️  ${marker} No recipients determined for envelope`);
        this.logger.warn(`📧 No recipients determined for ${envelopeType}`);
        return;
      }

      console.log(`✅ ${marker} ${recipients.length} recipient(s) ready`);

      // Canonical token generation path (single source of truth — ThirdPartyService no longer does this).
      // Uses configured expiryHours from the approval envelope. Skips approvers that already have a token
      // so resume calls do not re-generate or duplicate tokens.
      if (envelopeType === 'approval' && phase === 'start') {
        console.log(`🔐 ${marker} Generating approval tokens for approvers`);
        const approvalEnvelope = request.envelopes.approval as any;
        const configuredExpiryHours = approvalEnvelope?.expiryHours;

        if (approvalEnvelope?.approvers) {
          for (const approver of approvalEnvelope.approvers) {
            if (approver.approvalToken) {
              console.log(`⏭️  ${marker} Token already exists for ${approver.email}, skipping`);
              continue;
            }
            const { randomUUID } = await import('crypto');
            const token = randomUUID();
            approver.approvalToken = token;
            await this.stateManager.saveApprovalToken(token, request.id, approver.id, configuredExpiryHours);
            console.log(`✅ ${marker} Token generated for ${approver.email} (expiryHours: ${configuredExpiryHours ?? 'default'})`);
          }
          // Persist updated approver tokens immediately so subsequent reads see them
          await this.stateManager.saveRequest(request);
        }
      }

      // Prepare email context with all available variables for substitution
      let emailContext = this.buildEmailContext(request, envelopeType);
      console.log(`🔧 ${marker} Email context keys:`, Object.keys(emailContext).join(', '));

      // Send email to each recipient
      for (const recipient of recipients) {
        // For approval emails, build context specific to this approver
        let currentContext = emailContext;
        if (envelopeType === 'approval' && phase === 'start') {
          const approvalEnvelope = request.envelopes.approval as any;
          const approver = approvalEnvelope?.approvers?.find((a: any) => a.email === recipient);
          if (approver) {
            currentContext = {
              ...emailContext,
              approverName: approver.role || 'Approver',
              approverEmail: approver.email,
              approvalToken: approver.approvalToken || '',
              approvalLink: approver.approvalToken 
                ? `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/approvals/${approver.approvalToken}`
                : '',
            };
            console.log(`🔐 ${marker} Using token for ${approver.email}: ${approver.approvalToken?.substring(0, 8)}...`);
          }
        }

        const subject = this.substituteVariables(template.subject, currentContext);
        const html = this.substituteVariables(template.htmlBody, currentContext);

        console.log(`\n📮 ${marker} Sending to: ${recipient}`);
        console.log(`   Subject: ${subject}`);

        this.logger.info(`📧 ${marker} Sending to ${recipient}`);

        // Send via email service (non-blocking)
        const sendResult = await appContext.emailService.sendEmail({
          to: recipient,
          subject,
          html,
        });

        if (!sendResult) {
          console.log(`⚠️  ${marker} Email send returned false`);
          this.logger.warn(`⚠️  Email send failed for ${recipient}`);
        } else {
          console.log(`✅ ${marker} Sent to ${recipient}`);
        }
      }
      // Persist the sent-at timestamp on the envelope so the guard works on resume
      const envelopeToMark = request.envelopes[envelopeType] as any;
      if (phase === 'start') {
        envelopeToMark.startEmailSentAt = new Date().toISOString();
      } else {
        envelopeToMark.endEmailSentAt = new Date().toISOString();
      }
      await this.stateManager.saveRequest(request);

      console.log(`\n✅ ${marker} Email process completed`);
    } catch (error) {
      console.log(`❌ ${marker} Error:`, error instanceof Error ? error.message : String(error));
      this.logger.error(`📧 Email send error for ${envelopeType} (${phase}):`, error);
      throw error;
    }
  }

  /**
   * Get email recipients based on envelope type
   */
  private getEmailRecipients<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K
  ): string[] {
    console.log(`\n🔍 [GET-RECIPIENTS] Determining recipients for envelope: ${envelopeType}`);
    const recipients: string[] = [];

    switch (envelopeType) {
      case 'request':
        // Send to requester - email is in request.envelopes.request.parameters.email
        const requestEmail = (request.envelopes.request as any)?.parameters?.email;
        console.log(`📧 [REQUEST] email from parameters:`, requestEmail);
        if (requestEmail) {
          recipients.push(requestEmail);
        }
        break;

      case 'approval':
        // Send to all approvers
        const approval = request.envelopes.approval as any;
        console.log(`👥 [APPROVAL] Approvers object:`, approval?.approvers);
        console.log(`👥 [APPROVAL] Is array?`, Array.isArray(approval?.approvers));
        console.log(`👥 [APPROVAL] Approvers count:`, approval?.approvers?.length);
        
        if (approval?.approvers && Array.isArray(approval.approvers)) {
          console.log(`👥 [APPROVAL] Processing ${approval.approvers.length} approver(s)`);
          approval.approvers.forEach((approver: any, idx: number) => {
            console.log(`  [APPROVAL #${idx}] approver:`, approver);
            console.log(`  [APPROVAL #${idx}] email:`, approver?.email);
            if (approver.email) {
              console.log(`  ✓ Adding approver email: ${approver.email}`);
              recipients.push(approver.email);
            }
          });
        } else {
          console.log(`❌ [APPROVAL] Approvers not found or not array`);
        }
        break;

      case 'payment':
        // Send to requester
        const paymentEmail = (request.envelopes.request as any)?.parameters?.email;
        console.log(`💳 [PAYMENT] email from parameters:`, paymentEmail);
        if (paymentEmail) {
          recipients.push(paymentEmail);
        }
        break;

      case 'processing':
        // Send to requester
        const processingEmail = (request.envelopes.request as any)?.parameters?.email;
        console.log(`⚙️  [PROCESSING] email from parameters:`, processingEmail);
        if (processingEmail) {
          recipients.push(processingEmail);
        }
        break;

      case 'delivery':
        // Send to requester
        const deliveryEmail = (request.envelopes.request as any)?.parameters?.email;
        console.log(`🚚 [DELIVERY] email from parameters:`, deliveryEmail);
        if (deliveryEmail) {
          recipients.push(deliveryEmail);
        }
        break;

      case 'feedback':
        // Send to requester
        const feedbackEmail = (request.envelopes.request as any)?.parameters?.email;
        console.log(`📋 [FEEDBACK] email from parameters:`, feedbackEmail);
        if (feedbackEmail) {
          recipients.push(feedbackEmail);
        }
        break;
    }

    // Remove duplicates
    const uniqueRecipients = [...new Set(recipients)];
    console.log(`✅ [GET-RECIPIENTS] Final list: ${uniqueRecipients.length} recipient(s):`, uniqueRecipients);
    return uniqueRecipients;
  }

  /**
   * Build context object for variable substitution with all available request data
   */
  private buildEmailContext<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K
  ): Record<string, any> {
    const requestEnvelope = request.envelopes.request as any;
    const approvalEnvelope = request.envelopes.approval as any;
    const requestParams = requestEnvelope?.parameters || {};
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

    return {
      // Request data
      requestId: request.id,
      serviceType: request.type,
      studentId: requestParams?.studentId || '',
      firstName: requestParams?.firstName || '',
      lastName: requestParams?.lastName || '',
      email: requestParams?.email || '',
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

      // Feedback — link generated by FeedbackProcessor and stored on the envelope
      feedbackLink: (request.envelopes.feedback as any)?.feedbackLink || '',
      feedbackToken: (request.envelopes.feedback as any)?.feedbackToken || '',
      trackingId: resolvedTrackingId,
      deliveryTrackingUrl,

      // Delivery document links (resolved at execution time by delivery processor, stored on details)
      documentLinks: deliveryEnvelope?.details?.email?.resolvedDocumentLinksHtml || '',
      documentLinksText: deliveryEnvelope?.details?.email?.resolvedDocumentLinksText || '',

      // Generic fields
      documentTypes: requestParams?.documentTypes?.join(', ') || '',
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
      const template = await this.stateManager.getEmailTemplateByName(name);
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
   * field in the service definition. Falls back to 'request-cancelled' if not configured.
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

      const primaryGenericKey = triggerEnvelopeType === 'approval' ? 'request-denied' : 'request-cancelled';
      const templateResolution = await this.resolveEmailTemplateByCandidates([
        configuredCancelTemplateName,
        defaultEnvelopeCancelTemplateName,
        `${request.type}-${primaryGenericKey}`,
        primaryGenericKey,
        `${request.type}-request-cancelled`,
        'request-cancelled',
      ], {
        yamlConfiguredCandidates: [configuredCancelTemplateName, defaultEnvelopeCancelTemplateName],
        serviceScopedGenericCandidates: [
          `${request.type}-${primaryGenericKey}`,
          `${request.type}-request-cancelled`,
        ],
        globalGenericCandidates: [primaryGenericKey, 'request-cancelled'],
      });

      if (!templateResolution) {
        this.logger.warn(`[CANCELLATION-EMAIL] No cancellation template found for request ${request.id}`);
        return;
      }
      const template = templateResolution.template;
      this.logger.info(
        `[TEMPLATE-RESOLUTION] Request ${request.id} | Envelope cancellation:${triggerEnvelopeType || 'unknown'} | Matched: ${templateResolution.matchedCandidate} | Source: ${templateResolution.source} | TemplateId: ${template.id || 'n/a'} | TemplateScope: ${template.templateScope || 'n/a'}`
      );

      // Build email context with failure details
      const requestParams = request.envelopes.request?.parameters || {};
      const submittedDate = request.createdAt || new Date().toISOString();
      
      const emailContext = {
        requestId: request.id,
        studentId: requestParams?.studentId || '',
        firstName: requestParams?.firstName || '',
        lastName: requestParams?.lastName || '',
        email: requestParams?.email || '',
        currentTimestamp: new Date().toISOString(),
        documentTypes: requestParams?.documentTypes?.join(', ') || '',
        purpose: requestParams?.purpose || '',
        numberOfCopies: requestParams?.numberOfCopies || '',
        failedTask: failedTask,
        failureDetails: failureDetails,
        cancellationReason: `Technical issue during document processing - ${failedTask} failed`,
        requestSubmittedDate: submittedDate,
      };

      // Build email content
      const subject = this.substituteVariables(template.subject, emailContext);
      const html = this.substituteVariables(template.htmlBody, emailContext);

      // Send to requester
      const recipient = requestParams?.email;
      if (!recipient) {
        this.logger.warn(`[CANCELLATION-EMAIL] No recipient email found`);
        return;
      }

      console.log(`\n📧 [CANCELLATION-EMAIL] Sending to: ${recipient}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Failed Task: ${failedTask}`);
      console.log(`   Error: ${failureDetails}`);

      const sendResult = await appContext.emailService.sendEmail({
        to: recipient,
        subject,
        html,
      });

      if (sendResult) {
        console.log(`✅ [CANCELLATION-EMAIL] Sent to ${recipient}`);
        this.logger.info(`[CANCELLATION-EMAIL] Cancellation email sent to ${recipient}`);
      } else {
        console.log(`⚠️  [CANCELLATION-EMAIL] Send returned false`);
        this.logger.warn(`[CANCELLATION-EMAIL] Failed to send cancellation email`);
      }
    } catch (error) {
      this.logger.error(`[CANCELLATION-EMAIL] Error sending cancellation email:`, error);
    }
  }
}
