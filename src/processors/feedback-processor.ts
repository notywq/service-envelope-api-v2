/**
 * Processor for Feedback Envelopes
 * Handles post-completion feedback collection with email support
 */

import { Observable, of, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { FeedbackEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';
import { EmailService } from '../services/email-service.js';
import { EmailTemplateLoader } from '../utils/email-template-loader.js';
import { v4 as uuidv4 } from 'uuid';

export class FeedbackProcessor extends EnvelopeProcessor<FeedbackEnvelope> {
  private uiBaseUrl: string;
  private templateLoader: EmailTemplateLoader;

  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager?: StateManager,
    private emailService?: EmailService,
    uiBaseUrl?: string
  ) {
    super(logger);
    this.uiBaseUrl = uiBaseUrl || process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
    this.templateLoader = new EmailTemplateLoader(stateManager || ({} as StateManager), logger);
  }

  protected processInternal(request: ServiceRequest, envelope: FeedbackEnvelope): Observable<FeedbackEnvelope> {
    if (!envelope.required) {
      envelope.status = 'waived';
      this.logger.info(`[FEEDBACK-WAIVED] Request ${request.id} | Feedback not required`);
      return of(envelope);
    }

    // On initial start: send survey invite and transition to pending_external
    if (envelope.status === 'pending' && !envelope.startEmailSentAt) {
      return from(this.sendStartEmail(request, envelope)).pipe(
        switchMap(() => this.generateAndSendFeedbackLink(request, envelope)),
        map(() => envelope)
      );
    }

    // If pending_external: keep waiting for feedback submission
    if (envelope.status === 'pending_external') {
      return of(envelope);
    }

    // If feedback submitted: send thank you email
    if (envelope.status === 'completed' && !envelope.endEmailSentAt) {
      return from(this.sendEndEmail(request, envelope)).pipe(
        map(() => envelope)
      );
    }

    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Feedback';
  }

  /**
   * Send feedback survey start email
   */
  private async sendStartEmail(request: ServiceRequest, envelope: FeedbackEnvelope): Promise<void> {
    try {
      const serviceDefinition = await (this.stateManager as any).getServiceDefinitionByType(request.type);
      if (!serviceDefinition?.feedback?.emailTemplateStartEnvelope) {
        this.logger.debug(`[FEEDBACK-EMAIL-TEMPLATE] No start email configured for service ${request.type}`);
        envelope.startEmailSentAt = new Date().toISOString();
        return;
      }

      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.feedback.emailTemplateStartEnvelope,
        request,
        'Feedback'
      );

      if (template) {
        await this.emailService?.sendEmail({
          to: request.envelopes.request.parameters?.initiatorEmail || '',
          subject: template.subject,
          html: template.htmlBody,
        });
        this.logger.info(`[FEEDBACK-INIT] Request ${request.id} | Survey invitation sent`);
      }

      envelope.startEmailSentAt = new Date().toISOString();
    } catch (error) {
      this.logger.error(`[FEEDBACK-ERROR] Request ${request.id} | Failed to send survey: ${(error as Error).message}`);
      envelope.startEmailSentAt = new Date().toISOString(); // Mark sent anyway
    }
  }

  /**
   * Send feedback survey end email (thank you message)
   */
  private async sendEndEmail(request: ServiceRequest, envelope: FeedbackEnvelope): Promise<void> {
    try {
      const serviceDefinition = await (this.stateManager as any).getServiceDefinitionByType(request.type);
      if (!serviceDefinition?.feedback?.emailTemplateEndEnvelope) {
        this.logger.debug(`[FEEDBACK-EMAIL-TEMPLATE] No end email configured for service ${request.type}`);
        envelope.endEmailSentAt = new Date().toISOString();
        return;
      }

      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.feedback.emailTemplateEndEnvelope,
        request,
        'Feedback'
      );

      if (template) {
        await this.emailService?.sendEmail({
          to: request.envelopes.request.parameters?.initiatorEmail || '',
          subject: template.subject,
          html: template.htmlBody,
        });
        this.logger.info(`[FEEDBACK-COMPLETE] Request ${request.id} | Thank you email sent`);
      }

      envelope.endEmailSentAt = new Date().toISOString();
    } catch (error) {
      this.logger.error(`[FEEDBACK-ERROR] Request ${request.id} | Failed to send thank you email: ${(error as Error).message}`, error);
      envelope.endEmailSentAt = new Date().toISOString(); // Mark sent anyway
    }
  }

  /**
   * Generate feedback token and send link
   */
  private async generateAndSendFeedbackLink(request: ServiceRequest, envelope: FeedbackEnvelope): Promise<void> {
    try {
      const token = uuidv4();
      const expiryDays = envelope.expiryDays || 7;
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

      if (this.stateManager) {
        // Save feedback token for verification
        await (this.stateManager as any).saveFeedbackToken({
          token,
          requestId: request.id,
          expiresAt: expiresAt.toISOString(),
          createdAt: new Date().toISOString(),
          used: false,
        });
      }

      const feedbackLink = `${this.uiBaseUrl}/feedback/${token}`;
      envelope.feedbackLink = feedbackLink;
      envelope.feedbackToken = token;
      envelope.expiresAt = expiresAt.toISOString();
      envelope.status = 'pending_external';

      this.logger.info(`[FEEDBACK-TOKEN] Request ${request.id} | Token generated | Expires: ${expiryDays} days`);
    } catch (error) {
      this.logger.error(`[FEEDBACK-ERROR] Request ${request.id} | Failed to generate token: ${(error as Error).message}`);
    }
  }
}