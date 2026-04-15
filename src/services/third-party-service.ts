import { Observable, of, delay } from 'rxjs';
import { Logger } from 'winston';
import { Approver, ServiceRequest, ProcessingTask, Charge } from '../types/envelope.types.js';
import { EmailService } from './email-service.js';
import type { StateManager } from '../core/state-manager.js';

export class ThirdPartyService {
  constructor(
    private logger: Logger,
    private emailService?: EmailService,
    private stateManager?: StateManager
  ) {}

  /**
   * Send approval request via email
   * Integrates with EmailService to send formatted approval emails with approval/deny links
   * Links redirect to Phase 2 UI (Dashboard) for approvers to handle decisions
   */
  async sendApprovalRequest(req: ServiceRequest, approver: Approver, uiBaseUrl: string = 'http://localhost:5173'): Promise<{ status: 'approved' | 'pending_external' | 'denied'; approver: Approver }> {
    try {
      // Validate that approver email is present
      if (!approver.id || !approver.id.includes('@')) {
        this.logger.error(`❌ Invalid approver email format: ${approver.id}`);
        throw new Error(`Invalid approver email: ${approver.id}`);
      }

      // Check if email service is available
      if (!this.emailService) {
        this.logger.warn(`⚠️  EmailService not initialized - approval request cannot be sent to ${approver.id}`);
        throw new Error('EmailService not initialized');
      }

      // Generate approval token and save to DB
      const { generateApprovalToken } = await import('../api/routes/approvals.js');
      const token = await generateApprovalToken(req.id, approver.id);
      this.logger.debug(`🔐 Generated approval token for request ${req.id}`);

      // Build approval and deny links - point to Phase 2 UI
      const approvalLink = `${uiBaseUrl}/approvals/${token}`;
      const denyLink = `${uiBaseUrl}/approvals/${token}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Try to fetch service-specific email template
      let htmlTemplate: string | undefined;
      if (this.stateManager) {
        try {
          const service = await (this.stateManager as any).getServiceDefinitionByType(req.type);
          if (service?.approval?.emailTemplateId) {
            const template = await (this.stateManager as any).getEmailTemplate(service.approval.emailTemplateId);
            if (template?.htmlBody) {
              htmlTemplate = template.htmlBody;
              this.logger.info(`📧 Using email template ${service.approval.emailTemplateId} for service ${req.type}`);
            }
          }
        } catch (error) {
          this.logger.debug(`Note: Could not fetch email template - will use default: ${error}`);
        }
      }

      // Send approval email
      this.logger.info(`📨 Sending approval email to ${approver.id} for request ${req.id}...`);
      const emailSent = await this.emailService.sendApprovalEmail({
        approverEmail: approver.id,
        requestId: req.id,
        serviceType: req.type,
        initiatorName: req.initiator,
        approvalToken: token,
        approvalLink,
        denyLink,
        expiresAt,
        htmlTemplate, // Pass template if found
      });

      if (!emailSent) {
        this.logger.error(`❌ Failed to send approval email to ${approver.id}`);
        throw new Error(`Email sending failed for ${approver.id}`);
      }

      this.logger.info(`✅ Approval email successfully sent to ${approver.id}`);

      // Set approver status to pending and return pending_external
      approver.status = 'pending';
      this.logger.info(`⏳ Awaiting approval decision from ${approver.id} (expires: ${expiresAt})`);

      return {
        status: 'pending_external',
        approver,
      };
    } catch (error) {
      this.logger.error(`❌ Error in approval workflow for ${approver.id}: ${error}`);
      // Return pending_external anyway - don't fail the whole flow
      approver.status = 'pending';
      return {
        status: 'pending_external',
        approver,
      };
    }
  }


  processPayment(data: { charges: Charge[]; paymentMethod: string; transactionId?: string ; requestId: string}): Observable<{ success: boolean; transactionId: string; response: any; pending?: boolean }> {
    let total = 0;
    let currency = "";
    
    data.charges.forEach((charge: Charge) => {
      this.logger.info(`Charge item: ${charge.item}, amount: ${charge.amount} ${charge.currency}`);
      total += charge.amount;
      currency = charge.currency;
    });
    
    this.logger.info(`Simulating payment of ${total} ${currency}`);
    
    const isPending = Math.random() < 0.3; // 30% chance of external wait
    if (isPending) {
      this.logger.warn(`Payment requires external verification`);
      return of({
        success: false,
        transactionId: `TXN-${Date.now()}`,
        response: { code: 'PENDING', message: 'Awaiting verification' },
      });
    }

    return of({
      success: true,
      transactionId: `TXN-${Date.now()}`,
      response: { code: '00', message: 'Mock success' }
    });
  }

  validatePrerequisites(req: ServiceRequest): Observable<'completed' | 'waiting' | 'failed'> {
    return of('completed');
  }

  updateDatabase(req: ServiceRequest): Observable<'completed' | 'waiting' | 'failed'> {
    return of('completed');
  }

  sendNotification(req: ServiceRequest, type: string): Observable<'completed' | 'waiting' | 'failed'>{
    return of('completed');
  }

executeGenericTask(
  taskName: string,
  req: ServiceRequest
): Observable<'completed' | 'waiting' | 'failed'> {
  const random = Math.random();

  if (random < 0.3) {
    // 30% chance waiting for external input
    this.logger.warn(`Task "${taskName}" is waiting for external data`);
    return of('waiting');
  } else if (random < 0.5) {
    // 20% chance task fails
    this.logger.error(`Task "${taskName}" failed`);
    return of('failed');
  }

  // 50% chance success
  this.logger.info(`Task "${taskName}" completed successfully`);
  return of('completed');
}

  sendEmail(data: any): Observable<boolean> {
    return of(true);
  }

  sendSMS(data: any): Observable<boolean> {
    return of(true);
  }

  sendPhysicalMail(data: any): Observable<boolean> {
    return of(true);
  }

  sendFeedbackRequest(req: ServiceRequest, link: string): Observable<boolean> {
    return of(true);
  }
}