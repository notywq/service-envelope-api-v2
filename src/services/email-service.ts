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
    let html = payload.htmlTemplate || `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
          <h2 style="color: #333;">Approval Request</h2>
          
          <p>Hello,</p>
          <p>A new service request requires your approval:</p>
          
          <div style="background-color: white; padding: 15px; border-left: 4px solid #1976d2; margin: 20px 0;">
            <p><strong>Request ID:</strong> {{requestId}}</p>
            <p><strong>Service Type:</strong> {{serviceType}}</p>
            <p><strong>Requested by:</strong> {{initiatorName}}</p>
            <p><strong>Expires at:</strong> {{expiresAt}}</p>
          </div>
          
          <p style="margin: 20px 0;">Please review and approve or deny this request:</p>
          
          <div style="display: flex; gap: 10px; margin: 20px 0;">
            <a href="{{approvalLink}}" style="background-color: #4caf50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✓ Approve</a>
            <a href="{{denyLink}}" style="background-color: #f44336; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✗ Deny</a>
          </div>
          
          <p style="font-size: 12px; color: #999; margin-top: 30px;">
            This link will expire in 24 hours. If you did not expect this request, please contact the administrator.
          </p>
        </div>
      </div>
    `;

    // Replace placeholders with actual values
    html = html
      .replace(/\{\{requestId\}\}/g, payload.requestId)
      .replace(/\{\{serviceType\}\}/g, payload.serviceType)
      .replace(/\{\{initiatorName\}\}/g, payload.initiatorName)
      .replace(/\{\{approvalLink\}\}/g, payload.approvalLink)
      .replace(/\{\{denyLink\}\}/g, payload.denyLink)
      .replace(/\{\{expiresAt\}\}/g, payload.expiresAt);

    try {
      this.logger.info(`📧 Preparing approval email for ${payload.approverEmail} (Request: ${payload.requestId})`);
      const emailSent = await this.sendEmail({
        to: payload.approverEmail,
        subject: `Approval Required: ${payload.serviceType} Request (${payload.requestId})`,
        html,
        replyTo: process.env.EMAIL_FROM,
      });

      if (emailSent) {
        this.logger.info(`✅ Approval email successfully delivered to ${payload.approverEmail}`);
      } else {
        this.logger.error(`❌ Approval email delivery failed for ${payload.approverEmail}`);
      }

      return emailSent;
    } catch (error) {
      this.logger.error(`❌ Exception sending approval email to ${payload.approverEmail}: ${error}`);
      return false;
    }
  }
}