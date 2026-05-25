/**
 * Processor for Feedback Envelopes
 * Handles post-completion feedback collection
 * Generates feedback tokens and links to Phase 2 UI
 */

import { Observable, of, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { FeedbackEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';
import { v4 as uuidv4 } from 'uuid';

export class FeedbackProcessor extends EnvelopeProcessor<FeedbackEnvelope> {
  private uiBaseUrl: string;

  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager?: StateManager,
    uiBaseUrl?: string
  ) {
    super(logger);
    this.uiBaseUrl = uiBaseUrl || process.env.UI_BASE_URL || 'http://localhost:5173';
  }

  protected processInternal(request: ServiceRequest, envelope: FeedbackEnvelope): Observable<FeedbackEnvelope> {
    if (!envelope.required) {
      envelope.status = 'skipped';
      return of(envelope);
    }

    // Generate feedback token and link
    return from(this.generateFeedbackToken(request)).pipe(
      switchMap(token => {
        const feedbackLink = `${this.uiBaseUrl}/feedback/${token}`;
        envelope.feedbackLink = feedbackLink;
        envelope.feedbackToken = token;
        envelope.expiresAt = new Date(Date.now() + (envelope.expiryDays || 7) * 24 * 60 * 60 * 1000).toISOString();

        this.logger.info(
          `📋 Feedback request generated | Link: ${feedbackLink} | Expires: ${envelope.expiresAt}`
        );

        // Send feedback request via email
        return this.sendFeedbackEmail(request, envelope, feedbackLink);
      }),
      map(success => {
        envelope.status = success ? 'completed' : 'failed';
        envelope.timestamp = new Date().toISOString();
        return envelope;
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Feedback';
  }

  /**
   * Generate and store feedback token in MongoDB
   * Token expires after configured period (default: 7 days)
   */
  private async generateFeedbackToken(request: ServiceRequest): Promise<string> {
    try {
      const token = uuidv4();
      const expiryDays = 7;
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

      if (this.stateManager) {
        // Save feedback token to MongoDB for verification later
        await (this.stateManager as any).saveFeedbackToken({
          token,
          requestId: request.id,
          expiresAt: expiresAt.toISOString(),
          createdAt: new Date().toISOString(),
          used: false,
        });

        this.logger.debug(`🔐 Generated feedback token for request ${request.id}`);
      }

      return token;
    } catch (error) {
      this.logger.error(`Failed to generate feedback token: ${error}`);
      throw error;
    }
  }

  /**
   * Send feedback request email to requestor
   * Uses template from MongoDB if available
   */
  private async sendFeedbackEmail(
    request: ServiceRequest,
    envelope: FeedbackEnvelope,
    feedbackLink: string
  ): Promise<boolean> {
    try {
      const recipient = request.envelopes?.request?.parameters?.email || '';

      if (!recipient) {
        this.logger.warn(`⚠️  No email address found for feedback delivery`);
        return false;
      }

      this.logger.info(`📧 Preparing feedback email | Recipient: ${recipient} | Template: ${envelope.emailTemplateId}`);

      // Fetch template if available
      let htmlBody = '';
      if (envelope.emailTemplateId && this.stateManager) {
        try {
          const template = await (this.stateManager as any).getEmailTemplate(envelope.emailTemplateId);
          if (template?.htmlBody) {
            htmlBody = this.replaceVariables(template.htmlBody, request, feedbackLink, envelope.expiresAt!);
            this.logger.debug(`📄 Using feedback template: ${envelope.emailTemplateId}`);
          }
        } catch (error) {
          this.logger.warn(`Could not fetch feedback template: ${error}`);
        }
      }

      // If no template or template fetch failed, use default content
      if (!htmlBody) {
        htmlBody = this.getDefaultFeedbackEmail(request, feedbackLink, envelope.expiresAt!);
      }

      // Send feedback email
      const emailSent = await this.thirdPartyService.sendFeedbackEmail({
        to: recipient,
        subject: envelope.emailTemplateId ? 'We Value Your Feedback' : 'Please Share Your Feedback',
        html: htmlBody,
        requestId: request.id,
        feedbackLink,
      });

      if (emailSent) {
        this.logger.info(`✅ Feedback email sent successfully to ${recipient}`);
        return true;
      } else {
        this.logger.error(`❌ Failed to send feedback email`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error sending feedback email: ${error}`);
      return false;
    }
  }

  /**
   * Replace template variables for feedback email
   */
  private replaceVariables(template: string, request: ServiceRequest, feedbackLink: string, expiresAt: string): string {
    let result = template;

    const replacements: Record<string, string> = {
      requestId: request.id,
      firstName: request.envelopes?.request?.parameters?.firstName || 'Valued Customer',
      lastName: request.envelopes?.request?.parameters?.lastName || '',
      serviceType: request.type,
      feedbackLink,
      expiresAt,
      expiryDays: '7',
    };

    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
      result = result.replace(regex, value);
    }

    return result;
  }

  /**
   * Default feedback email template if none configured
   */
  private getDefaultFeedbackEmail(request: ServiceRequest, feedbackLink: string, expiresAt: string): string {
    const firstName = request.envelopes?.request?.parameters?.firstName || 'Valued Customer';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
          <h2 style="color: #003a70;">📋 We Value Your Feedback</h2>
          
          <p>Dear ${firstName},</p>
          <p>Thank you for using our service! We would love to hear your feedback to help us improve.</p>
          
          <div style="background-color: white; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0;">
            <p>Your feedback takes just 2-3 minutes and helps us serve you better.</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${feedbackLink}" style="background-color: #2196F3; color: white; padding: 12px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">Share Your Feedback</a>
          </div>
          
          <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; font-size: 12px;">
            <p style="color: #666;">Request ID: ${request.id}</p>
            <p style="color: #666;">This feedback link expires: ${expiresAt}</p>
          </div>
          
          <p style="color: #666; margin-top: 30px; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
        </div>
      </div>
    `;
  }
}