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
      this.logger.error('Email service not initialized');
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@mapua.edu.ph',
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        replyTo: payload.replyTo,
      });

      this.logger.info(`✅ Email sent to ${payload.to} (ID: ${info.messageId})`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${payload.to}:`, error);
      return false;
    }
  }

  async sendApprovalEmail(payload: ApprovalEmailPayload): Promise<boolean> {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
          <h2 style="color: #333;">Approval Request</h2>
          
          <p>Hello,</p>
          <p>A new service request requires your approval:</p>
          
          <div style="background-color: white; padding: 15px; border-left: 4px solid #1976d2; margin: 20px 0;">
            <p><strong>Request ID:</strong> ${payload.requestId}</p>
            <p><strong>Service Type:</strong> ${payload.serviceType}</p>
            <p><strong>Requested by:</strong> ${payload.initiatorName}</p>
            <p><strong>Expires at:</strong> ${payload.expiresAt}</p>
          </div>
          
          <p style="margin: 20px 0;">Please review and approve or deny this request:</p>
          
          <div style="display: flex; gap: 10px; margin: 20px 0;">
            <a href="${payload.approvalLink}" style="background-color: #4caf50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✓ Approve</a>
            <a href="${payload.denyLink}" style="background-color: #f44336; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✗ Deny</a>
          </div>
          
          <p style="font-size: 12px; color: #999; margin-top: 30px;">
            This link will expire in 24 hours. If you did not expect this request, please contact the administrator.
          </p>
        </div>
      </div>
    `;

    return this.sendEmail({
      to: payload.approverEmail,
      subject: `Approval Required: ${payload.serviceType} Request (${payload.requestId})`,
      html,
      replyTo: process.env.EMAIL_FROM,
    });
  }

  async sendCompletionEmail(
    to: string,
    requestId: string,
    serviceType: string,
    status: string
  ): Promise<boolean> {
    const statusColor = status === 'completed' ? '#4caf50' : '#f44336';
    const statusEmoji = status === 'completed' ? '✓' : '✗';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
          <h2 style="color: #333;">Request ${statusEmoji} ${status.toUpperCase()}</h2>
          
          <p>Hello,</p>
          <p>Your service request has been processed.</p>
          
          <div style="background-color: white; padding: 15px; border-left: 4px solid ${statusColor}; margin: 20px 0;">
            <p><strong>Request ID:</strong> ${requestId}</p>
            <p><strong>Service Type:</strong> ${serviceType}</p>
            <p><strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${status}</span></p>
          </div>
          
          <p style="font-size: 12px; color: #999; margin-top: 30px;">
            If you have any questions, please contact the service administrator.
          </p>
        </div>
      </div>
    `;

    return this.sendEmail({
      to,
      subject: `Service Request ${requestId} - ${status.toUpperCase()}`,
      html,
    });
  }

  // Mock mode for development/testing
  async sendMockEmail(payload: EmailPayload): Promise<boolean> {
    this.logger.info(`📧 [MOCK] Email to ${payload.to}: ${payload.subject}`);
    return true;
  }
}
