/**
 * Processor for Approval Envelopes
 * Handles authorization workflows and approver notifications
 */

import { Observable, of, forkJoin } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor';
import { ApprovalEnvelope, ServiceRequest, Approver } from '../types/envelope.types';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service';
import { StateManager } from '../core/state-manager';

export class ApprovalProcessor extends EnvelopeProcessor<ApprovalEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager: StateManager // 💾 Needed to save state on pause
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: ApprovalEnvelope): Observable<ApprovalEnvelope> {
    if (!envelope.required) {
      envelope.status = 'waived';
      return of(envelope);
    }

    // Send approval requests to all required approvers
    const approvalObservables = envelope.approvers.map(approver =>
      this.requestApproval(request, approver)
    );

    return forkJoin(approvalObservables).pipe(
      map(approvers => {
        envelope.approvers = approvers;

        // If any approver is still pending_external, pause the whole envelope
        if (approvers.some(a => a.status === 'pending_external')) {
          envelope.status = 'pending_external';
          envelope.timestamp = new Date().toISOString();
          this.stateManager.saveRequest(request);
          this.logger.warn(`[Approval] Paused for external approvals on request ${request.id}`);
          return envelope;
        }

        // Otherwise calculate the final status
        envelope.status = this.calculateApprovalStatus(envelope);
        envelope.timestamp = new Date().toISOString();
        return envelope;
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Approval';
  }

  /**
   * Request approval from a specific approver
   * This integrates with 3rd party notification services
   */
private requestApproval(request: ServiceRequest, approver: Approver): Observable<Approver> {
  return this.thirdPartyService.sendApprovalRequest(request, approver).pipe(
    map(result => {
      if (result.status === 'pending_external') {
        // Set envelope to pending_external so orchestrator pauses
        approver.status = 'pending';
        request.envelopes.approval.status = 'pending_external';
      }
      else if(result.status === 'denied') {
        approver.status = 'denied';
        approver.approvedAt = new Date().toISOString();
        request.envelopes.approval.status = 'failed';
      }else {
        approver.status = 'approved';
        approver.approvedAt = new Date().toISOString();
      } 
      return approver;
    })
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
      default:
        return 'pending';
    }
  }
}
