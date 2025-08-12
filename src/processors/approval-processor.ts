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

export class ApprovalProcessor extends EnvelopeProcessor<ApprovalEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService
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
    // Here you can integrate with email services, notification systems, etc.
    return this.thirdPartyService.sendApprovalRequest(request, approver).pipe(
      map(() => {
        // For demo purposes, we'll simulate approval
        approver.status = Math.random() > 0.3 ? 'approved' : 'pending';
        if (approver.status === 'approved') {
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
    const rejectedCount = envelope.approvers.filter(a => a.status === 'rejected').length;
    
    if (rejectedCount > 0) {
      return 'failed';
    }
    
    switch (envelope.approvalRules.type) {
      case 'all_must_approve':
        return approvedCount === envelope.approvers.length ? 'completed' : 'pending';
      case 'any_one':
        return approvedCount > 0 ? 'completed' : 'pending';
      case 'specific_approver':
        const specificApprover = envelope.approvers.find(a => a.id === envelope.approvalRules.specificApprover);
        return specificApprover?.status === 'approved' ? 'completed' : 'pending';
      default:
        return 'pending';
    }
  }
}