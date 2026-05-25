import { Observable, of, delay } from 'rxjs';
import { Logger } from 'winston';
import { Approver, ServiceRequest, ProcessingTask, Charge } from '../types/envelope.types.js';
import { EmailService } from './email-service.js';
import { MAYAPaymentProvider } from './payment-provider.js';
import type { StateManager } from '../core/state-manager.js';

export class ThirdPartyService {
  private mayaProvider: MAYAPaymentProvider;

  constructor(
    private logger: Logger,
    private emailService?: EmailService,
    private stateManager?: StateManager
  ) {
    // Initialize MAYA payment provider
    this.mayaProvider = new MAYAPaymentProvider(logger);
  }

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
      this.logger.debug(`🔍 [TEMPLATE-LOOKUP-START] Service type: ${req.type}, StateManager available: ${!!this.stateManager}`);
      
      if (!this.stateManager) {
        this.logger.debug(`❌ [TEMPLATE-LOOKUP] StateManager is NULL!`);
      } else {
        try {
          // Step 1: Get service definition by type
          this.logger.debug(`🔍 [TEMPLATE-LOOKUP] Fetching service definition for: ${req.type}`);
          const service = await (this.stateManager as any).getServiceDefinitionByType(req.type);
          
          if (!service) {
            this.logger.debug(`❌ [TEMPLATE-LOOKUP] Service definition NOT FOUND for type: ${req.type}`);
          } else if (!service.definition?.envelopes?.approval?.emailTemplateId) {
            this.logger.debug(`❌ [TEMPLATE-LOOKUP] No emailTemplateId in service definition`);
          } else {
            const templateId = service.definition.envelopes.approval.emailTemplateId;
            this.logger.debug(`✅ [TEMPLATE-LOOKUP] Found emailTemplateId: ${templateId}`);
            
            // Step 2: Fetch the template from MongoDB
            this.logger.debug(`🔍 [TEMPLATE-LOOKUP] Fetching template from MongoDB: ${templateId}`);
            const template = await (this.stateManager as any).getEmailTemplate(templateId);
            
            if (!template) {
              this.logger.debug(`❌ [TEMPLATE-LOOKUP] Template NOT FOUND in MongoDB: ${templateId}`);
            } else if (!template.htmlBody) {
              this.logger.debug(`❌ [TEMPLATE-LOOKUP] Template has no htmlBody: ${templateId}`);
            } else {
              htmlTemplate = template.htmlBody;
              this.logger.debug(`✅ [TEMPLATE-LOOKUP-SUCCESS] Loaded custom template: ${templateId}`);
            }
          }
        } catch (error) {
          this.logger.debug(`❌ [TEMPLATE-LOOKUP] Exception: ${error}`);
        }
      }

      // Send approval email
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
        // Pass request parameters for detailed display
        ...req.envelopes.request.parameters,
      });

      if (!emailSent) {
        this.logger.error(`❌ Failed to send approval email to ${approver.id}`);
        throw new Error(`Email sending failed for ${approver.id}`);
      }

      // Set approver status to pending and return pending_external
      approver.status = 'pending';

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
    // Calculate total amount from charges
    let totalAmount = 0;
    let currency = 'PHP';
    
    data.charges.forEach((charge: Charge) => {
      this.logger.info(`💰 Charge: ${charge.item} | ₱${charge.amount} x${charge.quantity || 1}`);
      totalAmount += charge.amount * (charge.quantity || 1);
      currency = charge.currency || 'PHP';
    });

    // Create payment request for MAYA provider
    const paymentRequest = {
      requestId: data.requestId,
      amount: totalAmount,
      currency,
      charges: data.charges,
    };

    // Process payment through MAYA provider
    return this.mayaProvider.processPayment(paymentRequest).pipe(
      (source) => new Observable(subscriber => {
        source.subscribe(
          (response) => {
            // Map MAYA response to expected format
            const result = {
              success: response.status === 'COMPLETED',
              transactionId: response.transactionId,
              response: {
                code: response.statusCode === '00' ? '00' : (response.status === 'PENDING' ? 'PENDING' : 'FAILED'),
                message: response.message,
                status: response.status,
                reference: response.reference,
              },
            };
            subscriber.next(result);
            subscriber.complete();
          },
          (error) => subscriber.error(error)
        );
      })
    );
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

  /**
   * Send email via EmailService
   * Supports both plain emails and templated emails
   */
  sendEmail(data: {
    to?: string;
    subject?: string;
    body?: string;
    html?: string;
    requestId?: string;
    attachments?: string[];
  }): Observable<boolean> {
    if (!data.to) {
      this.logger.warn('⚠️  No recipient email specified');
      return of(false);
    }

    // Mock: log the email instead of actually sending
    this.logger.info(`📧 Email | To: ${data.to} | Subject: ${data.subject || '(no subject)'}`);
    return of(true);
  }

  sendSMS(data: {
    to?: string;
    message?: string;
    requestId?: string;
  }): Observable<boolean> {
    if (!data.to) {
      this.logger.warn('⚠️  No recipient phone specified');
      return of(false);
    }

    this.logger.info(`📱 SMS | To: ${data.to} | Message: ${data.message || ''}`);
    return of(true);
  }

  sendPhysicalMail(data: {
    address?: string;
    tracking?: boolean;
    requestId?: string;
  }): Observable<boolean> {
    if (!data.address) {
      this.logger.warn('⚠️  No delivery address specified');
      return of(false);
    }

    this.logger.info(`📮 Physical Mail | Address: ${data.address} | Tracking: ${data.tracking ? 'Yes' : 'No'}`);
    return of(true);
  }

  /**
   * Send feedback request email to requestor
   */
  async sendFeedbackEmail(data: {
    to?: string;
    subject?: string;
    html?: string;
    requestId?: string;
    feedbackLink?: string;
  }): Promise<boolean> {
    if (!data.to) {
      this.logger.warn('⚠️  No recipient email specified for feedback');
      return false;
    }

    this.logger.info(`📋 Feedback Email | To: ${data.to} | Link: ${data.feedbackLink}`);
    
    // In production, would call emailService.sendEmail() with the HTML
    // For now, mock the response
    return true;
  }

  /**
   * Legacy method: send feedback request
   * @deprecated Use sendFeedbackEmail instead
   */
  sendFeedbackRequest(req: ServiceRequest, link: string): Observable<boolean> {
    this.logger.info(`📋 Feedback Request | Request: ${req.id} | Link: ${link}`);
    return of(true);
  }
}