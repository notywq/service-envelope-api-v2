/**
 * Processor for Feedback Envelopes
 * Handles post-completion feedback collection with email support
 */

import { Observable, of, from } from 'rxjs';
import { map } from 'rxjs/operators';
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

    // Check if auto-close timeout has been reached (24 hours since envelope was created)
    // Even if feedback hasn't been submitted, auto-close the request after 24 hours
    if (envelope.status === 'pending_external' && envelope.timestamp) {
      const createdAt = new Date(envelope.timestamp);
      const hoursSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
      
      // Auto-close after 24 hours if feedback wasn't submitted
      if (hoursSinceCreation >= 24) {
        this.logger.info(
          `[FEEDBACK-AUTO-CLOSE] Request ${request.id} | 24-hour auto-close timeout reached | No feedback submitted`
        );
        envelope.status = 'completed';
        envelope.autoClosedAt = new Date().toISOString();
        envelope.autoClosedReason = 'Feedback window expired after 24 hours with no submission';
        return of(envelope);
      }
    }

    // On initial start: generate feedback link and transition to pending_external
    // NOTE: Orchestrator handles email sending via sendEnvelopeEmailTemplate()
    if (envelope.status === 'pending') {
      return this.generateAndSendFeedbackLink(request, envelope);
    }

    // If pending_external: keep waiting for feedback submission
    if (envelope.status === 'pending_external' && !envelope.feedback) {
      return of(envelope);
    }

    // If feedback submitted: mark as completed (feedback window stays open for 7 days)
    if (envelope.feedback && envelope.status !== 'completed') {
      envelope.status = 'completed';
      this.logger.info(
        `[FEEDBACK-COMPLETED] Request ${request.id} | Feedback submitted | Feedback link remains valid for ${envelope.expiryDays || 7} days`
      );
      return of(envelope);
    }

    // If feedback submitted: just return (orchestrator handles end email)
    if (envelope.status === 'completed') {
      return of(envelope);
    }

    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Feedback';
  }

  /**
   * Generate feedback token and send link
   */
  private generateAndSendFeedbackLink(request: ServiceRequest, envelope: FeedbackEnvelope): Observable<FeedbackEnvelope> {
    return from(this.doGenerateFeedbackLink(request, envelope)).pipe(
      map(() => envelope)
    );
  }

  private async doGenerateFeedbackLink(request: ServiceRequest, envelope: FeedbackEnvelope): Promise<void> {
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