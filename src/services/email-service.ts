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
}