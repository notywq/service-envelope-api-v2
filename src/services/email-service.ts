/**
 * Email Service - Handles sending emails for approvals, notifications, etc.
 * Uses Nodemailer for flexibility (Gmail, SendGrid, or any SMTP provider)
 */

import nodemailer, { Transporter } from 'nodemailer';
import { Logger } from 'winston';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export interface ApprovalEmailPayload {
  approverEmail: string;
  requestId: string;
  serviceType: string;
  initiatorName: string;
  approvalToken: string;
  approvalLink: string;
  denyLink: string;
  expiresAt: string;
  htmlTemplate?: string; // Optional custom HTML template with {{variable}} placeholders
}

export class EmailService {
  private transporter: Transporter | null = null;

  constructor(private logger: Logger) {}

  async initialize(smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    from: string;
  }): Promise<void> {
    try {
      this.transporter = nodemailer.createTransport(smtpConfig);
      
      // Verify connection
      await this.transporter.verify();
      this.logger.info('✅ Email service initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize email service:', error);
      throw error;
    }
  }

  async sendEmail(payload: EmailPayload): Promise<boolean> {
    if (!this.transporter) {
      this.logger.error(`❌ Email service not initialized - cannot send email to ${payload.to}`);
      return false;
    }

    try {
      this.logger.debug(`📨 Sending email to ${payload.to} with subject: ${payload.subject}`);
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@mapua.edu.ph',
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        replyTo: payload.replyTo,
      });

      this.logger.info(`✅ Email successfully sent to ${payload.to} (Message ID: ${info.messageId})`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${payload.to}: ${error}`);
      return false;
    }
  }

  async sendApprovalEmail(payload: ApprovalEmailPayload): Promise<boolean> {
    if (!this.transporter) {
      this.logger.error(`❌ Email service not initialized - cannot send approval email to ${payload.approverEmail}`);
      return false;
    }

    // Use custom template if provided, otherwise use default
    // NOTE: Default template should only be used if custom template loading fails
    // Approval decisions are handled in Phase 2 UI, not in email
    let html = payload.htmlTemplate || `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
          <h2 style="color: #003a70;">Service Request Approval Required</h2>
          
          <p>Hello,</p>
          <p>A service request requires your approval:</p>
          
          <div style="background-color: white; padding: 15px; border-left: 4px solid #1976d2; margin: 20px 0;">
            <p><strong>Request ID:</strong> {{requestId}}</p>
            <p><strong>Service Type:</strong> {{serviceType}}</p>
            <p><strong>Requested by:</strong> {{initiatorName}}</p>
            <p><strong>Expires:</strong> {{expiresAt}}</p>
          </div>
          
          <p style="margin: 20px 0; text-align: center;">
            <a href="{{approvalLink}}" style="background-color: #1976d2; color: white; padding: 12px 50px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 14px;">Review & Approve Request</a>
          </p>
          
          <p style="font-size: 11px; color: #666; margin-top: 30px; text-align: center;">
            Click above to review the request details and make your approval decision in the approval portal.<br/>
            This link will expire in 24 hours.
          </p>
        </div>
      </div>
    `;

    // Replace placeholders with actual values - dynamic replacement for all payload properties
    Object.keys(payload).forEach(key => {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      const value = (payload as any)[key];
      // Handle null/undefined values
      if (typeof value !== 'object' && typeof value !== 'function') {
        html = html.replace(placeholder, value !== null && value !== undefined ? String(value) : '');
      }
    });

    try {
      const emailSent = await this.sendEmail({
        to: payload.approverEmail,
        subject: `Approval Required: ${payload.serviceType} Request (${payload.requestId})`,
        html,
        replyTo: process.env.EMAIL_FROM,
      });

      if (!emailSent) {
        this.logger.error(`❌ Approval email delivery failed for ${payload.approverEmail}`);
      }

      return emailSent;
    } catch (error) {
      this.logger.error(`❌ Exception sending approval email to ${payload.approverEmail}: ${error}`);
      return false;
    }
  }

  /**
   * Send denial notification email to requestor
   */
  async sendDenialEmail(payload: {
    requestorEmail: string;
    requestorName: string;
    requestId: string;
    approverId: string;
    reason: string;
    serviceType: string;
  }): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.logger.warn('⚠️ Email service not initialized - skipping denial email');
        return false;
      }

      const { requestorEmail, requestorName, requestId, approverId, reason, serviceType } = payload;

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto;">
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
            <h2 style="color: #d32f2f;">Request Denied</h2>
            
            <p>Dear ${requestorName},</p>
            <p>Your request has been reviewed and unfortunately denied. Please find the details below:</p>
            
            <div style="background-color: white; padding: 20px; border-left: 4px solid #d32f2f; margin: 20px 0; border-radius: 3px;">
              <h3 style="margin-top: 0; color: #003a70; font-size: 14px;">REQUEST INFORMATION</h3>
              
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 8px 0; font-weight: bold; color: #333; width: 35%;">Request ID:</td>
                  <td style="padding: 8px 0; color: #666;">${requestId}</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 8px 0; font-weight: bold; color: #333;">Service Type:</td>
                  <td style="padding: 8px 0; color: #666;">${serviceType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: bold; color: #333;">Status:</td>
                  <td style="padding: 8px 0; color: #d32f2f; font-weight: bold;">CANCELLED</td>
                </tr>
              </table>
            </div>

            <div style="background-color: white; padding: 20px; border-left: 4px solid #ff9800; margin: 20px 0; border-radius: 3px;">
              <h3 style="margin-top: 0; color: #003a70; font-size: 14px;">REASON FOR DENIAL</h3>
              <p style="margin: 10px 0; color: #333; line-height: 1.6;">${reason}</p>
            </div>

            <div style="background-color: #fff3e0; padding: 15px; border-radius: 3px; margin: 20px 0;">
              <p style="margin: 0; font-size: 12px; color: #666;">
                <strong>What's next?</strong><br/>
                You may resubmit your request with any necessary adjustments. If you have questions about the denial, please contact your department office.
              </p>
            </div>

            <p style="font-size: 11px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
              This is an automated message from MAPUA Service Envelope System. Please do not reply to this email.
            </p>
          </div>
        </div>
      `;

      this.logger.info(`📧 Preparing denial email for ${requestorEmail} (Request: ${requestId})`);

      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@mapua.edu.ph',
        to: requestorEmail,
        subject: `Request Cancelled: ${serviceType} Request (${requestId})`,
        html: htmlBody,
      });

      const emailSent = !!info.response;

      if (emailSent) {
        this.logger.info(`✅ Email successfully sent to ${requestorEmail} (Message ID: ${info.messageId})`);
        this.logger.info(`✅ Denial email successfully delivered to ${requestorEmail}`);
      } else {
        this.logger.error(`❌ Denial email delivery failed for ${requestorEmail}`);
      }

      return emailSent;
    } catch (error) {
      this.logger.error(`❌ Exception sending denial email to ${payload.requestorEmail}: ${error}`);
      return false;
    }
  }
}