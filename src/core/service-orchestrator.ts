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
          this.sendCancellationEmail(request, 'Payment Processing', `Payment window expired (${expiryDays} days)`).catch(err => {
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

        // Send start email when envelope begins processing (for all envelopes)
        // Fire-and-forget - don't block Observable chain
        console.log(`📧 [${envelopeType.toUpperCase()}] Attempting to send START phase email`);
        this.sendEnvelopeEmailTemplate(request, envelopeType, 'start').catch(err => {
          console.log(`⚠️  [${envelopeType.toUpperCase()}-START-EMAIL] Failed:`, err.message);
          this.logger.warn(`Failed to process start email for ${envelopeType}:`, err);
        });

        // Send end email template if envelope completed successfully
        if (updatedEnvelope.status === 'completed') {
          console.log(`📧 [${envelopeType.toUpperCase()}] Attempting to send END phase email`);
          this.sendEnvelopeEmailTemplate(request, envelopeType, 'end').catch(err => {
            console.log(`⚠️  [${envelopeType.toUpperCase()}-END-EMAIL] Failed:`, err.message);
            this.logger.warn(`Failed to process completion email for ${envelopeType}:`, err);
          });
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
            this.sendCancellationEmail(request, 'Approval Process', reason).catch(err => {
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
            this.sendCancellationEmail(request, failedTask?.name || 'Unknown', failureDetails).catch(err => {
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

      // Get template ID based on phase
      const templateId = phase === 'start' 
        ? envelopeConfig.emailTemplateStartEnvelope 
        : envelopeConfig.emailTemplateEndEnvelope;

      console.log(`🔍 ${marker} Looking for template (phase=${phase}): ${templateId}`);

      if (!templateId) {
        console.log(`⚠️  ${marker} No template configured for phase: ${phase}`);
        this.logger.debug(`📧 No email template configured for phase: ${phase}`);
        return; // No template configured for this phase
      }

      console.log(`✅ ${marker} Template name found: ${templateId}`);

      // Load template from MongoDB by name
      console.log(`🗄️  ${marker} Fetching template from MongoDB by name: ${templateId}`);
      const template = await this.stateManager.getEmailTemplateByName(templateId);

      if (!template) {
        console.log(`❌ ${marker} Template NOT found by name: ${templateId}`);
        this.logger.warn(`📧 Email template not found: ${templateId}`);
        return;
      }
      console.log(`✅ ${marker} Template loaded: ${template.name}`);

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

      // For approval envelope at start phase, generate tokens for each approver
      if (envelopeType === 'approval' && phase === 'start') {
        console.log(`🔐 ${marker} Generating approval tokens for ${recipients.length} approver(s)`);
        const approvalEnvelope = request.envelopes.approval as any;
        
        if (approvalEnvelope?.approvers) {
          for (const approver of approvalEnvelope.approvers) {
            const { randomUUID } = await import('crypto');
            const token = randomUUID();
            approver.approvalToken = token;
            
            // Save token to database
            await this.stateManager.saveApprovalToken(token, request.id, approver.id, 24);
            console.log(`✅ ${marker} Token generated for ${approver.email}`);
          }
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

    return {
      // Request data - from parameters
      requestId: request.id,
      serviceType: request.type,
      studentId: requestParams?.studentId || '',
      firstName: requestParams?.firstName || '',
      lastName: requestParams?.lastName || '',
      email: requestParams?.email || '',
      currentTimestamp: new Date().toISOString(),
      
      // Approval data
      approverName: approvalEnvelope?.approvers?.[0]?.role || 'Approver',
      approverEmail: approvalEnvelope?.approvers?.[0]?.email || '',
      approvalToken: approvalEnvelope?.approvers?.[0]?.approvalToken || '',
      approvalLink: approvalEnvelope?.approvers?.[0]?.approvalToken 
        ? `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/approvals/${approvalEnvelope.approvers[0].approvalToken}`
        : '',
      
      // Generic fields for flexibility
      documentTypes: requestParams?.documentTypes?.join(', ') || '',
      purpose: requestParams?.purpose || '',
      numberOfCopies: requestParams?.numberOfCopies || '',
      deliveryMethod: requestParams?.deliveryMethod || '',
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
   * Send cancellation email when processing fails
   * Includes details about what failed and why
   */
  private async sendCancellationEmail(
    request: ServiceRequest,
    failedTask: string,
    failureDetails: string
  ): Promise<void> {
    try {
      if (!appContext?.emailService) {
        this.logger.warn(`[CANCELLATION-EMAIL] Email service not available`);
        return;
      }

      // Load cancellation template
      const template = await this.stateManager.getEmailTemplateByName('csd-request-cancelled');
      if (!template) {
        this.logger.warn(`[CANCELLATION-EMAIL] Cancellation template not found`);
        return;
      }

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
