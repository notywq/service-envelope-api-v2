/**
 * Processor for Approval Envelopes
 * Handles authorization workflows and approver notifications
 */

import { Observable, of, forkJoin, from } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { ApprovalEnvelope, ServiceRequest, Approver } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';
import { EmailService } from '../services/email-service.js';

export class ApprovalProcessor extends EnvelopeProcessor<ApprovalEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager: StateManager, // 💾 Needed to save state on pause
    private emailService?: EmailService, // Optional email service
    private uiBaseUrl: string = 'http://localhost:5173', // UI base URL for approval links (Phase 2 Dashboard)
    private phase2PaymentUrl: string = 'http://localhost:5173' // Phase 2 payment UI base URL
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
        if (approvers.some(a => a.status === 'pending')) {
          envelope.status = 'pending_external';
          envelope.timestamp = new Date().toISOString();
          // Update request overall status to reflect we're waiting for approval
          request.overallStatus = 'pending_approval';
          this.stateManager.saveRequest(request);
          this.logger.warn(`\x1b[36m[PAUSED]\x1b[0m due to pending external approvals on request ${request.id}`);
          return envelope;
        }

        // Otherwise calculate the final status
        envelope.status = this.calculateApprovalStatus(envelope);
       // this.logger.info(`${envelope.status.toUpperCase()} - Approval`);
        envelope.timestamp = new Date().toISOString();
        
        // If approval is now complete, send payment notification to requestor
        if (envelope.status === 'completed') {
          this.logger.info(`📮 All approvals complete - sending payment notification email to requestor for request ${request.id}`);
          // Fire-and-forget async call
          this.sendPaymentNotificationToRequestor(request).catch(err => {
            this.logger.error(`Error in payment notification: ${(err as Error).message}`);
          });
        }
        
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
  return from(this.thirdPartyService.sendApprovalRequest(request, approver, this.uiBaseUrl)).pipe(
    map(result => {
      if (result.status === 'pending_external') {
        // Set envelope to pending_external so orchestrator pauses
        approver.status = 'pending';
        request.envelopes.approval.status = 'pending_external';
      }
      else if(result.status === 'denied') {
        approver.status = 'denied';
        approver.deniedAt = new Date().toISOString();
        request.envelopes.approval.status = 'failed';
        this.logger.warn(`❌ Approval denied for ${approver.id}`);
      } else if (result.status === 'approved') {
        approver.status = 'approved';
        approver.approvedAt = new Date().toISOString();
        this.logger.info(`✅ Approval granted by ${approver.id}`);
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

   // this.logger.info(`${envelope.approvalRules.type} - ${approvedCount} approved, ${rejectedCount} denied`);
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

  /**
   * Send payment notification email to requestor after approval is complete
   */
  private async sendPaymentNotificationToRequestor(request: ServiceRequest): Promise<void> {
    try {
      if (!this.emailService) {
        this.logger.warn('⚠️  Email service not available - skipping payment notification');
        return;
      }

      const requestorEmail = request.envelopes.request.parameters?.initiatorEmail;
      const requestorName = request.envelopes.request.parameters?.initiatorName || 'Student';
      
      if (!requestorEmail) {
        this.logger.warn(`⚠️  No requestor email found for request ${request.id}`);
        return;
      }

      this.logger.info(`💌 Preparing payment notification email for ${requestorEmail}`);

      // Calculate total amount to pay
      const totalAmount = request.envelopes.payment.charges?.reduce((sum, charge) => sum + charge.amount, 0) || 0;
      const phase2PaymentLink = `${this.phase2PaymentUrl}/payment?requestId=${request.id}`;

      // Try to fetch service-specific payment template
      let htmlTemplate: string | undefined;
      
      if (this.stateManager) {
        try {
          // Step 1: Get service definition by type
          const service = await (this.stateManager as any).getServiceDefinitionByType(request.type);
          
          if (service && service.definition?.envelopes?.payment?.emailTemplateId) {
            const templateId = service.definition.envelopes.payment.emailTemplateId;
            
            // Step 2: Fetch the template from MongoDB
            const template = await (this.stateManager as any).getEmailTemplate(templateId);
            
            if (template && template.htmlBody) {
              htmlTemplate = template.htmlBody;
              this.logger.info(`✅ [TEMPLATE-LOOKUP-SUCCESS] Loaded custom payment template: ${templateId}`);
            } else {
              this.logger.debug(`📧 Payment template ${templateId} not found or missing htmlBody`);
            }
          } else {
            this.logger.debug(`📧 No payment template configured for service type: ${request.type}`);
          }
        } catch (error) {
          this.logger.debug(`📧 Could not load payment template: ${error}`);
        }
      }

      // Use custom template if available, otherwise use default
      const emailContent = {
        to: requestorEmail,
        subject: `Your Request Has Been Approved - Payment Required`,
        html: htmlTemplate ? this.replacePaymentPlaceholders(htmlTemplate, {
          firstName: request.envelopes.request.parameters?.firstName || requestorName,
          requestId: request.id,
          totalAmount: totalAmount.toFixed(2),
          numberOfCopies: request.envelopes.request.parameters?.numberOfCopies,
          purpose: request.envelopes.request.parameters?.purpose,
          paymentLink: phase2PaymentLink,
        }) : `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">✅ Request Approved - Payment Required</h2>
              
              <p>Hello ${requestorName},</p>
              <p>Great news! Your service request has been approved by all required approvers.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #003a70; margin: 20px 0;">
                <p><strong>Request ID:</strong> ${request.id}</p>
                <p><strong>Total Amount Due:</strong> ₱${totalAmount.toFixed(2)}</p>
                <p><strong>Status:</strong> Ready for Payment</p>
              </div>

              <p>Please complete the payment through the secure payment gateway:</p>
              
              <p style="margin: 20px 0; text-align: center;">
                <a href="${phase2PaymentLink}" style="background-color: #1976d2; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">💳 Proceed to Payment</a>
              </p>

              <p style="margin-top: 20px; font-size: 13px; color: #666;">
                This payment is required to complete your service request processing. Once payment is received, your request will be processed and you will receive confirmation via email.
              </p>
              
              <p style="font-size: 11px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
                Payment link expires in 7 days. If you need assistance, please contact the registrar's office.
              </p>
            </div>
          </div>
        `,
      };

      // Send email
      try {
        await this.emailService.sendEmail(emailContent);
        this.logger.info(`📧 Payment notification email sent to ${requestorEmail} for request ${request.id}`);
      } catch (err) {
        this.logger.error(`❌ Failed to send payment notification email: ${(err as Error).message}`);
      }

    } catch (error) {
      this.logger.error(`Error sending payment notification: ${(error as Error).message}`);
    }
  }

  /**
   * Replace placeholders in payment email template
   */
  private replacePaymentPlaceholders(html: string, data: Record<string, any>): string {
    Object.keys(data).forEach(key => {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      const value = data[key];
      html = html.replace(placeholder, value !== null && value !== undefined ? String(value) : '');
    });
    return html;
  }
}
