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
   * Register an approver as pending.
   * Token generation and email sending are handled exclusively by the orchestrator
   * via sendEnvelopeEmailTemplate() — this method only validates and sets status.
   */
  async sendApprovalRequest(req: ServiceRequest, approver: Approver, uiBaseUrl: string = process.env.FRONTEND_BASE_URL || 'http://localhost:5173'): Promise<{ status: 'approved' | 'pending_external' | 'denied'; approver: Approver }> {
    try {
      if (!approver.id || !approver.id.includes('@')) {
        this.logger.error(`❌ Invalid approver email: ${approver.id}`);
        throw new Error(`Invalid approver email: ${approver.id}`);
      }
      approver.status = 'pending';
      this.logger.info(`📋 Approver registered as pending: ${approver.id} | Request: ${req.id}`);
      return { status: 'pending_external', approver };
    } catch (error) {
      this.logger.error(`❌ Error registering approver ${approver.id}: ${error}`);
      approver.status = 'pending';
      return { status: 'pending_external', approver };
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