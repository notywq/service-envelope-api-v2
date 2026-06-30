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

  private approvalLog(message: string, fields: Record<string, unknown> = {}, level: 'log' | 'warn' | 'error' = 'log'): void {
    const detail = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        const text = Array.isArray(value)
          ? `[${value.join(', ')}]`
          : value && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value ?? 'n/a');
        return `${key}=${/\s/.test(text) ? JSON.stringify(text) : text}`;
      })
      .join(' | ');
    const line = detail ? `[Approval] ${message} | ${detail}` : `[Approval] ${message}`;
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

  protected processInternal(request: ServiceRequest, envelope: ApprovalEnvelope): Observable<ApprovalEnvelope> {
    this.approvalLog('started', { request: request.id, status: envelope.status, required: envelope.required });
    
    if (!envelope.required) {
      this.approvalLog('waived', { request: request.id, reason: 'not required' });
      envelope.status = 'waived';
      return of(envelope);
    }

    // On initial start: request approvals from all approvers
    // NOTE: Orchestrator handles email sending via sendEnvelopeEmailTemplate()
    if (envelope.status === 'pending') {
      this.approvalLog('requesting approvers', { request: request.id, count: envelope.approvers.length });
      return this.requestApprovals(request, envelope);
    }

    // If pending_external: keep waiting for approvals
    if (envelope.status === 'pending_external') {
      this.approvalLog('waiting for external approval', { request: request.id });
      return of(envelope);
    }

    // If completed: just return (orchestrator handles email sending)
    if (envelope.status === 'completed') {
      this.approvalLog('already completed', { request: request.id });
      return of(envelope);
    }

    this.approvalLog('unchanged', { request: request.id, status: envelope.status });
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
    this.approvalLog('processing approvers', { request: request.id, count: envelope.approvers.length });
    
    // Handle empty approvers case - immediately complete
    if (envelope.approvers.length === 0) {
      this.approvalLog('completed', { request: request.id, reason: 'no approvers configured' });
      envelope.status = 'completed';
      envelope.timestamp = new Date().toISOString();
      return of(envelope);
    }
    
    // Send approval requests to all required approvers
    const approvalObservables = envelope.approvers.map((approver) => {
      return this.requestApproval(request, approver).pipe(
        tap(result => this.approvalLog('approver result', {
          request: request.id,
          approver: approver.id,
          status: result.status,
        }))
      );
    });

    return forkJoin(approvalObservables).pipe(
      map(approvers => {
        envelope.approvers = approvers;

        // If any approver is still pending, pause the whole envelope
        if (approvers.some(a => a.status === 'pending')) {
          envelope.status = 'pending_external';
          envelope.timestamp = new Date().toISOString();
          request.overallStatus = 'pending_approval';
          this.stateManager.saveRequest(request);
          this.approvalLog('waiting', {
            request: request.id,
            pending: approvers.filter((a: any) => a.status === 'pending').length,
            total: approvers.length,
          });
          return envelope;
        }

        // Calculate final status
        envelope.status = this.calculateApprovalStatus(envelope);
        envelope.timestamp = new Date().toISOString();
        this.approvalLog('resolved', { request: request.id, status: envelope.status, total: approvers.length });
        return envelope;
      })
    );
  }

  /**
   * Request approval from a specific approver
   */
  private requestApproval(request: ServiceRequest, approver: Approver): Observable<Approver> {
    this.approvalLog('approver requested', { request: request.id, approver: approver.id });
    
    return from(this.thirdPartyService.sendApprovalRequest(request, approver, this.uiBaseUrl)).pipe(
      map(result => {
        if (result.status === 'pending_external') {
          approver.status = 'pending';
          request.envelopes.approval.status = 'pending_external';
        } else if (result.status === 'denied') {
          approver.status = 'denied';
          approver.deniedAt = new Date().toISOString();
          request.envelopes.approval.status = 'failed';
        } else if (result.status === 'approved') {
          approver.status = 'approved';
          approver.approvedAt = new Date().toISOString();
        }
        this.approvalLog('approver updated', { request: request.id, approver: approver.id, status: approver.status });
        return approver;
      })
    );
  }

  /**
   * Calculate overall approval status based on approval rules
   */
  private calculateApprovalStatus(envelope: ApprovalEnvelope): 'pending' | 'completed' | 'failed' {
    const approvedCount = envelope.approvers.filter(a => a.status === 'approved').length;

    switch (envelope.approvalRules.type) {
      case 'all_must_approve':
        if (envelope.approvers.some(a => a.status === 'denied')) {
          return 'failed';
        }
        return approvedCount === envelope.approvers.length ? 'completed' : 'pending';
      case 'any_one':
        if (approvedCount > 0) {
          return 'completed';
        }
        if (envelope.approvers.length > 0 && envelope.approvers.every(a => a.status === 'denied')) {
          return 'failed';
        }
        return approvedCount > 0 ? 'completed' : 'pending';
      case 'specific_approver':
        const specificApprover = envelope.approvers.find(
          a => a.id === envelope.approvalRules.specificApprover
        );
        if (specificApprover?.status === 'denied') {
          return 'failed';
        }
        return specificApprover?.status === 'approved' ? 'completed' : 'pending';
      case 'complex': {
        // Complex rule: all required approvers must approve AND at least one from atLeastOneOf must approve
        const { requiredApprovers = [], atLeastOneOf = [] } = envelope.approvalRules;

        if (requiredApprovers.some(email =>
          envelope.approvers.some(a => a.id === email && a.status === 'denied')
        )) {
          return 'failed';
        }
        
        // Check all required approvers have approved
        const allRequiredApproved = requiredApprovers.every(email => 
          envelope.approvers.some(a => a.id === email && a.status === 'approved')
        );
        
        // Check at least one from atLeastOneOf has approved
        const atLeastOneApproved = atLeastOneOf.length === 0 || atLeastOneOf.some(email =>
          envelope.approvers.some(a => a.id === email && a.status === 'approved')
        );

        const atLeastOneImpossible = atLeastOneOf.length > 0 && atLeastOneOf.every(email =>
          envelope.approvers.some(a => a.id === email && a.status === 'denied')
        );

        if (atLeastOneImpossible) {
          return 'failed';
        }
        
        return allRequiredApproved && atLeastOneApproved ? 'completed' : 'pending';
      }
      default:
        return 'pending';
    }
  }
}
