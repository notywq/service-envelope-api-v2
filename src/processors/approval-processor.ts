/**
 * Processor for Approval Envelopes
 * Handles authorization workflows and approver notifications with email support
 */

import { Observable, of, forkJoin, from } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { ApprovalEnvelope, ServiceRequest, Approver, ServiceDefinition } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';
import { EmailService } from '../services/email-service.js';
import { EmailTemplateLoader } from '../utils/email-template-loader.js';

export class ApprovalProcessor extends EnvelopeProcessor<ApprovalEnvelope> {
  private templateLoader: EmailTemplateLoader;

  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager: StateManager, // 💾 Needed to save state on pause
    private emailService?: EmailService, // Optional email service
    private uiBaseUrl: string = process.env.FRONTEND_BASE_URL || 'http://localhost:5173', // UI base URL for approval links (Phase 2 Dashboard)
    private phase2PaymentUrl: string = process.env.FRONTEND_BASE_URL || 'http://localhost:5173' // Phase 2 payment UI base URL
  ) {
    super(logger);
    this.templateLoader = new EmailTemplateLoader(stateManager, logger);
  }

  protected processInternal(request: ServiceRequest, envelope: ApprovalEnvelope): Observable<ApprovalEnvelope> {
    console.log(`🔵 [APPROVAL-INTERNAL] processInternal() START - Status: ${envelope.status}`);
    
    if (!envelope.required) {
      console.log(`🔵 [APPROVAL-INTERNAL] Approval not required - returning waived`);
      envelope.status = 'waived';
      this.logger.info(`[APPROVAL-WAIVED] Request ${request.id} | Approval not required`);
      return of(envelope);
    }

    // On initial start: request approvals from all approvers
    // NOTE: Orchestrator handles email sending via sendEnvelopeEmailTemplate()
    if (envelope.status === 'pending') {
      console.log(`🔵 [APPROVAL-INTERNAL] Initial pending - requesting approvals from ${envelope.approvers.length} approvers`);
      return this.requestApprovals(request, envelope);
    }

    // If pending_external: keep waiting for approvals
    if (envelope.status === 'pending_external') {
      console.log(`🔵 [APPROVAL-INTERNAL] Already pending_external - returning as-is`);
      return of(envelope);
    }

    // If completed: just return (orchestrator handles email sending)
    if (envelope.status === 'completed') {
      console.log(`🔵 [APPROVAL-INTERNAL] Completed - returning as-is`);
      return of(envelope);
    }

    console.log(`🔵 [APPROVAL-INTERNAL] Fell through all conditions - returning as-is with status: ${envelope.status}`);
    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Approval';
  }

  /**
   * Send approval request start email
   */
  private async sendStartEmail(request: ServiceRequest, envelope: ApprovalEnvelope): Promise<void> {
    try {
      const serviceDefinition = await (this.stateManager as any).getServiceDefinitionByType(request.type);
      if (!serviceDefinition?.approval?.emailTemplateStartEnvelope) {
        this.logger.debug(`[APPROVAL-EMAIL-TEMPLATE] No start email configured for service ${request.type}`);
        envelope.startEmailSentAt = new Date().toISOString();
        return;
      }

      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.approval.emailTemplateStartEnvelope,
        request,
        'Approval'
      );

      if (template) {
        await this.emailService?.sendEmail({
          to: request.envelopes.request.parameters?.initiatorEmail || '',
          subject: template.subject,
          html: template.htmlBody,
        });
        this.logger.info(`✅ [APPROVAL-EMAIL] Start email sent for request ${request.id}`);
      }

      envelope.startEmailSentAt = new Date().toISOString();
    } catch (error) {
      this.logger.error(`❌ [APPROVAL-EMAIL] Error sending start email: ${(error as Error).message}`);
      envelope.startEmailSentAt = new Date().toISOString(); // Mark sent anyway to avoid retry loop
    }
  }

  /**
   * Send approval request end email (after all approvals complete)
   */
  private async sendEndEmail(request: ServiceRequest, envelope: ApprovalEnvelope): Promise<void> {
    try {
      const serviceDefinition = await (this.stateManager as any).getServiceDefinitionByType(request.type);
      if (!serviceDefinition?.approval?.emailTemplateEndEnvelope) {
        this.logger.debug(`[APPROVAL-EMAIL-TEMPLATE] No end email configured for service ${request.type}`);
        envelope.endEmailSentAt = new Date().toISOString();
        return;
      }

      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.approval.emailTemplateEndEnvelope,
        request,
        'Approval'
      );

      if (template) {
        await this.emailService?.sendEmail({
          to: request.envelopes.request.parameters?.initiatorEmail || '',
          subject: template.subject,
          html: template.htmlBody,
        });
        this.logger.info(`✅ [APPROVAL-EMAIL] End email sent for request ${request.id}`);
      }

      envelope.endEmailSentAt = new Date().toISOString();
    } catch (error) {
      this.logger.error(`❌ [APPROVAL-EMAIL] Error sending end email: ${(error as Error).message}`);
      envelope.endEmailSentAt = new Date().toISOString(); // Mark sent anyway to avoid retry loop
    }
  }

  /**
   * Request approvals from all required approvers
   */
  private requestApprovals(request: ServiceRequest, envelope: ApprovalEnvelope): Observable<ApprovalEnvelope> {
    console.log(`🟣 [REQUEST-APPROVALS] Starting - ${envelope.approvers.length} approvers to process`);
    
    // Handle empty approvers case - immediately complete
    if (envelope.approvers.length === 0) {
      console.log(`🟣 [REQUEST-APPROVALS] No approvers configured - marking as completed`);
      envelope.status = 'completed';
      envelope.timestamp = new Date().toISOString();
      return of(envelope);
    }
    
    // Send approval requests to all required approvers
    const approvalObservables = envelope.approvers.map((approver, idx) => {
      console.log(`🟣 [REQUEST-APPROVALS] Mapping approver ${idx + 1}/${envelope.approvers.length}: ${approver.id}`);
      return this.requestApproval(request, approver).pipe(
        tap(result => console.log(`🟣 [REQUEST-APPROVALS] Approver ${approver.id} returned: ${result.status}`))
      );
    });

    console.log(`🟣 [REQUEST-APPROVALS] Created ${approvalObservables.length} observables, entering forkJoin`);

    return forkJoin(approvalObservables).pipe(
      tap(approvers => console.log(`🟣 [REQUEST-APPROVALS] forkJoin completed with ${approvers.length} approvers`)),
      map(approvers => {
        console.log(`🟣 [REQUEST-APPROVALS] In map - processing ${approvers.length} approver results`);
        envelope.approvers = approvers;

        // If any approver is still pending, pause the whole envelope
        if (approvers.some(a => a.status === 'pending')) {
          console.log(`🟣 [REQUEST-APPROVALS] At least one approver pending - setting pending_external`);
          envelope.status = 'pending_external';
          envelope.timestamp = new Date().toISOString();
          request.overallStatus = 'pending_approval';
          this.stateManager.saveRequest(request);
          this.logger.info(`[APPROVAL-WAIT] Request ${request.id} | Waiting for approvers | Pending: ${approvers.filter((a: any) => a.status === 'pending').length}`);
          return envelope;
        }

        // Calculate final status
        console.log(`🟣 [REQUEST-APPROVALS] No pending approvers - calculating final status`);
        envelope.status = this.calculateApprovalStatus(envelope);
        envelope.timestamp = new Date().toISOString();
        
        if (envelope.status === 'completed') {
          this.logger.info(`[APPROVAL-COMPLETE] Request ${request.id} | All approvals granted`);
        }
        
        console.log(`🟣 [REQUEST-APPROVALS] Returning envelope with status: ${envelope.status}`);
        return envelope;
      })
    );
  }

  /**
   * Request approval from a specific approver
   */
  private requestApproval(request: ServiceRequest, approver: Approver): Observable<Approver> {
    console.log(`🟡 [REQUEST-APPROVAL] Starting for approver: ${approver.id}`);
    
    return from(this.thirdPartyService.sendApprovalRequest(request, approver, this.uiBaseUrl)).pipe(
      tap(result => console.log(`🟡 [REQUEST-APPROVAL] thirdPartyService returned for ${approver.id}: ${result.status}`)),
      map(result => {
        console.log(`🟡 [REQUEST-APPROVAL] Processing result for ${approver.id} - Setting status to ${result.status === 'pending_external' ? 'pending' : result.status}`);
        
        if (result.status === 'pending_external') {
          approver.status = 'pending';
          request.envelopes.approval.status = 'pending_external';
        } else if (result.status === 'denied') {
          approver.status = 'denied';
          approver.deniedAt = new Date().toISOString();
          request.envelopes.approval.status = 'failed';
          this.logger.warn(`[APPROVAL-DENIED] Request ${request.id} | Approver ${approver.id} denied`);
        } else if (result.status === 'approved') {
          approver.status = 'approved';
          approver.approvedAt = new Date().toISOString();
          this.logger.info(`[APPROVAL-APPROVED] Request ${request.id} | Approver ${approver.id} approved`);
        }
        console.log(`🟡 [REQUEST-APPROVAL] Returning approver for ${approver.id} with status: ${approver.status}`);
        return approver;
      }),
      tap(() => console.log(`🟡 [REQUEST-APPROVAL] Observable completed for approver: ${approver.id}`))
    );
  }

  /**
   * Calculate overall approval status based on approval rules
   */
  private calculateApprovalStatus(envelope: ApprovalEnvelope): 'pending' | 'completed' | 'failed' {
    const approvedCount = envelope.approvers.filter(a => a.status === 'approved').length;
    const rejectedCount = envelope.approvers.filter(a => a.status === 'denied').length;

    if (rejectedCount > 0) {
      return 'failed';
    }

    switch (envelope.approvalRules.type) {
      case 'all_must_approve':
        return approvedCount === envelope.approvers.length ? 'completed' : 'pending';
      case 'any_one':
        return approvedCount > 0 ? 'completed' : 'pending';
      case 'specific_approver':
        const specificApprover = envelope.approvers.find(
          a => a.id === envelope.approvalRules.specificApprover
        );
        return specificApprover?.status === 'approved' ? 'completed' : 'pending';
      case 'complex': {
        // Complex rule: all required approvers must approve AND at least one from atLeastOneOf must approve
        const { requiredApprovers = [], atLeastOneOf = [] } = envelope.approvalRules;
        
        // Check all required approvers have approved
        const allRequiredApproved = requiredApprovers.every(email => 
          envelope.approvers.some(a => a.id === email && a.status === 'approved')
        );
        
        // Check at least one from atLeastOneOf has approved
        const atLeastOneApproved = atLeastOneOf.length === 0 || atLeastOneOf.some(email =>
          envelope.approvers.some(a => a.id === email && a.status === 'approved')
        );
        
        return allRequiredApproved && atLeastOneApproved ? 'completed' : 'pending';
      }
      default:
        return 'pending';
    }
  }
}
