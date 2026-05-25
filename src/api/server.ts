/**
 * Express API Server
 * Main entry point for the Service Envelope System API
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import 'dotenv/config';
import winston from 'winston';
import { MongoDBStateManager } from '../services/mongodb-state-manager.js';
import { ServiceRegistry } from '../services/service-registry.js';
import { EmailService } from '../services/email-service.js';
import { ServiceOrchestrator } from '../core/service-orchestrator.js';
import { RequestProcessor } from '../processors/request-processor.js';
import { ApprovalProcessor } from '../processors/approval-processor.js';
import { PaymentProcessor } from '../processors/payment-processor.js';
import { ProcessingProcessor } from '../processors/processing-processor.js';
import { DeliveryProcessor } from '../processors/delivery-processor.js';
import { FeedbackProcessor } from '../processors/feedback-processor.js';
import { ThirdPartyService } from '../services/third-party-service.js';
import { ServiceRequest, EnvelopeCollection, RequestEnvelope, ApprovalEnvelope, PaymentEnvelope, ProcessingEnvelope, DeliveryEnvelope, FeedbackEnvelope } from '../types/envelope.types.js';
import servicesRouter from './routes/services.js';
import requestsRouter from './routes/requests.js';
import authRouter from './routes/auth.js';
import approvalsRouter from './routes/approvals.js';
import paymentsRouter from './routes/payments.js';
import adminRouter from './routes/admin.js';

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
    }),
  ],
});

export interface AppContext {
  stateManager: MongoDBStateManager;
  serviceRegistry: ServiceRegistry;
  emailService: EmailService;
  orchestrator: ServiceOrchestrator;
  logger: winston.Logger;
}

// Global context object
export let appContext: AppContext;

/**
 * Seed default email templates for all envelope types
 * Templates for: approval, delivery confirmation, feedback request, processing notification
 */
async function seedEmailTemplates(stateManager: MongoDBStateManager, logger: winston.Logger): Promise<void> {
  try {
    const defaultTemplates = [
      // ========== APPROVAL TEMPLATES ==========
      {
        id: 'SERV-1-approval',
        name: 'Course Enrollment Approval',
        subject: 'Course Enrollment Approval Request',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">Course Enrollment Approval Request</h2>
              
              <p>Hello,</p>
              <p>A student has requested to enroll in a course. Please review the request and approve or deny:</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #003a70; margin: 20px 0;">
                <p><strong>Request ID:</strong> {{requestId}}</p>
                <p><strong>Student:</strong> {{initiatorName}}</p>
                <p><strong>Expires:</strong> {{expiresAt}}</p>
              </div>
              
              <div style="display: flex; gap: 10px; margin: 20px 0;">
                <a href="{{approvalLink}}" style="background-color: #4caf50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✓ Approve Enrollment</a>
                <a href="{{denyLink}}" style="background-color: #f44336; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✗ Deny Request</a>
              </div>
              
              <p style="font-size: 11px; color: #666; margin-top: 30px;">This link expires in 24 hours.</p>
            </div>
          </div>
        `,
        description: 'Email template for course enrollment approval requests',
      },
      {
        id: 'SERV-2-approval',
        name: 'Dormitory Room Rental Approval',
        subject: 'Dorm Room Rental Approval Request',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">Dormitory Room Rental Approval</h2>
              
              <p>Hello,</p>
              <p>A student has requested to rent dormitory room. Please review and approve or deny:</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #1976d2; margin: 20px 0;">
                <p><strong>Request ID:</strong> {{requestId}}</p>
                <p><strong>Student:</strong> {{initiatorName}}</p>
                <p><strong>Expires:</strong> {{expiresAt}}</p>
              </div>
              
              <div style="display: flex; gap: 10px; margin: 20px 0;">
                <a href="{{approvalLink}}" style="background-color: #4caf50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✓ Approve Rental</a>
                <a href="{{denyLink}}" style="background-color: #f44336; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">✗ Deny Request</a>
              </div>
              
              <p style="font-size: 11px; color: #666; margin-top: 30px;">This link expires in 24 hours.</p>
            </div>
          </div>
        `,
        description: 'Email template for dormitory room rental approval requests',
      },
      {
        id: 'SERV-3-approval',
        name: 'Transcript of Records Approval',
        subject: 'Transcript of Records Approval Request',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">Transcript of Records Request Approval</h2>
              
              <p>Hello,</p>
              <p>A student has submitted a request for official transcript of records. Please review the details below and approve or deny:</p>
              
              <!-- REQUEST DETAILS SECTION -->
              <div style="background-color: white; padding: 20px; border-left: 4px solid #1976d2; margin: 20px 0; border-radius: 3px;">
                <h3 style="margin-top: 0; color: #003a70; font-size: 14px;">REQUEST INFORMATION</h3>
                
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px 0; font-weight: bold; color: #333; width: 35%;">Request ID:</td>
                    <td style="padding: 8px 0; color: #666;">{{requestId}}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px 0; font-weight: bold; color: #333;">Purpose:</td>
                    <td style="padding: 8px 0; color: #666;">{{purpose}}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px 0; font-weight: bold; color: #333;">Number of Copies:</td>
                    <td style="padding: 8px 0; color: #666;">{{numberOfCopies}}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px 0; font-weight: bold; color: #333;">Delivery Address:</td>
                    <td style="padding: 8px 0; color: #666;">{{deliveryAddress}}</td>
                  </tr>
                </table>
              </div>
              
              <!-- STUDENT DETAILS SECTION -->
              <div style="background-color: white; padding: 20px; border-left: 4px solid #00897b; margin: 20px 0; border-radius: 3px;">
                <h3 style="margin-top: 0; color: #003a70; font-size: 14px;">STUDENT INFORMATION</h3>
                
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px 0; font-weight: bold; color: #333; width: 35%;">Name:</td>
                    <td style="padding: 8px 0; color: #666;">{{firstName}} {{lastName}}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px 0; font-weight: bold; color: #333;">Student ID:</td>
                    <td style="padding: 8px 0; color: #666;">{{studentId}}</td>
                  </tr>
                  <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px 0; font-weight: bold; color: #333;">Program:</td>
                    <td style="padding: 8px 0; color: #666;">{{program}}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; font-weight: bold; color: #333;">Email:</td>
                    <td style="padding: 8px 0; color: #666;">{{email}}</td>
                  </tr>
                </table>
              </div>
              
              <!-- ACTION BUTTON -->
              <div style="background-color: white; padding: 20px; margin: 20px 0; border-radius: 3px; text-align: center;">
                <p style="margin-top: 0; font-size: 13px; color: #666; margin-bottom: 15px;">Please review and take action on this request:</p>
                <div style="margin: 15px 0;">
                  <a href="{{approvalLink}}" style="background-color: #1976d2; color: white; padding: 12px 50px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 14px;">Review Request</a>
                </div>
              </div>
              
              <!-- FOOTER INFO -->
              <p style="font-size: 11px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
                <strong>Expiration:</strong> This approval link expires on {{expiresAt}}<br/>
                If you did not expect this request, please contact the system administrator.
              </p>
            </div>
          </div>
        `,
        description: 'Email template for transcript of records approval requests with detailed student and request information',
      },

      // ========== PAYMENT TEMPLATES ==========
      {
        id: 'SERV-1-payment',
        name: 'Course Enrollment Payment Required',
        subject: 'Payment Required - Your Enrollment is Approved',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">✅ Enrollment Approved - Payment Required</h2>
              
              <p>Hello {{firstName}},</p>
              <p>Great news! Your course enrollment request has been approved by all required approvers. The next step is to complete payment.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #ff9800; margin: 20px 0;">
                <p><strong>Request ID:</strong> {{requestId}}</p>
                <p><strong>Total Amount Due:</strong> ₱{{totalAmount}}</p>
                <p><strong>Status:</strong> Ready for Payment</p>
              </div>
              
              <p style="margin: 20px 0; text-align: center;">
                <a href="{{paymentLink}}" style="background-color: #1976d2; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">💳 Proceed to Payment</a>
              </p>
              
              <p style="font-size: 13px; color: #666; margin-top: 20px;">
                Click the button above to complete your payment through our secure payment gateway. Once payment is confirmed, your enrollment will be processed.
              </p>
              
              <p style="font-size: 11px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
                Payment link expires in 7 days. If you need assistance, please contact the Registrar's Office.
              </p>
            </div>
          </div>
        `,
        description: 'Payment notification for course enrollment',
      },
      {
        id: 'SERV-2-payment',
        name: 'Dorm Rental Payment Required',
        subject: 'Payment Required - Your Room Rental is Approved',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">✅ Room Rental Approved - Payment Required</h2>
              
              <p>Hello {{firstName}},</p>
              <p>Excellent! Your dormitory room rental request has been approved. Please complete the payment to finalize your reservation.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0;">
                <p><strong>Request ID:</strong> {{requestId}}</p>
                <p><strong>Total Amount Due:</strong> ₱{{totalAmount}}</p>
                <p><strong>Status:</strong> Ready for Payment</p>
              </div>
              
              <p style="margin: 20px 0; text-align: center;">
                <a href="{{paymentLink}}" style="background-color: #1976d2; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">💳 Proceed to Payment</a>
              </p>
              
              <p style="font-size: 13px; color: #666; margin-top: 20px;">
                Please complete your payment within 7 days to secure your room assignment. Your payment will be processed through our secure payment gateway.
              </p>
              
              <p style="font-size: 11px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
                Payment link expires in 7 days. For questions, contact the Housing Office.
              </p>
            </div>
          </div>
        `,
        description: 'Payment notification for dorm rental',
      },
      {
        id: 'SERV-3-payment',
        name: 'Transcript of Records Payment Required',
        subject: 'Payment Required - Your TOR Request is Approved',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">✅ TOR Request Approved - Payment Required</h2>
              
              <p>Hello {{firstName}},</p>
              <p>Your Transcript of Records request has been approved! To proceed with processing and delivery, please complete the payment.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #9c27b0; margin: 20px 0;">
                <p><strong>Request Details:</strong></p>
                <p><strong>Request ID:</strong> {{requestId}}</p>
                <p><strong>Number of Copies:</strong> {{numberOfCopies}}</p>
                <p><strong>Purpose:</strong> {{purpose}}</p>
              </div>
              
              <div style="background-color: #e8f5e9; padding: 15px; border-left: 4px solid #4caf50; margin: 20px 0;">
                <p><strong>Total Amount Due:</strong> ₱{{totalAmount}}</p>
                <p style="font-size: 12px; color: #666; margin-top: 10px;">This includes processing fees and delivery charges.</p>
              </div>
              
              <p style="margin: 20px 0; text-align: center;">
                <a href="{{paymentLink}}" style="background-color: #1976d2; color: white; padding: 14px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">💳 Proceed to Payment</a>
              </p>
              
              <p style="font-size: 13px; color: #666; margin-top: 20px;">
                After payment confirmation, your transcript will be processed and delivered to the address on file within 3-5 business days.
              </p>
              
              <p style="font-size: 11px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
                Payment link expires in 7 days. For assistance, contact the Registrar's Office.
              </p>
            </div>
          </div>
        `,
        description: 'Payment notification for transcript of records',
      },

      // ========== DELIVERY TEMPLATES ==========
      {
        id: 'SERV-1-delivery',
        name: 'Course Enrollment Confirmation',
        subject: 'Your Course Enrollment is Confirmed - MAPUA',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">✓ Course Enrollment Confirmed</h2>
              
              <p>Dear {{firstName}},</p>
              <p>Congratulations! Your course enrollment request has been approved and processed.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #4caf50; margin: 20px 0;">
                <p><strong>Enrollment Details:</strong></p>
                <p>Request ID: {{requestId}}</p>
                <p>Course: {{courseName}}</p>
                <p>Section: {{section}}</p>
                <p>Semester: {{semester}}</p>
                <p>Academic Year: {{academicYear}}</p>
                <p>Processed: {{processedDate}}</p>
              </div>
              
              <p>Please refer to your course portal for further details. If you have any questions, contact the Registrar's Office.</p>
              
              <p style="color: #666; margin-top: 30px; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        `,
        description: 'Enrollment confirmation email sent to student',
      },
      {
        id: 'SERV-2-delivery',
        name: 'Room Assignment Confirmation',
        subject: 'Your Dorm Room Assignment - MAPUA',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">🏠 Your Room Assignment Confirmed</h2>
              
              <p>Dear {{firstName}},</p>
              <p>Your dormitory room rental request has been approved! Here are your assignment details:</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0;">
                <p><strong>Room Assignment:</strong></p>
                <p>Building: {{buildingName}}</p>
                <p>Room Number: {{roomNumber}}</p>
                <p>Floor: {{floor}}</p>
                <p>Room Type: {{roomType}}</p>
                <p>Semester: {{semester}}</p>
              </div>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #ff9800; margin: 20px 0;">
                <p><strong>Important Move-in Instructions:</strong></p>
                <p>Please check the attached documents for move-in date, time, and instructions. Contact the Housing Office with any questions.</p>
              </div>
              
              <p style="color: #666; margin-top: 30px; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        `,
        description: 'Room assignment confirmation sent to student',
      },
      {
        id: 'SERV-3-delivery',
        name: 'Transcript of Records Delivery',
        subject: 'Your Transcript of Records is Ready - MAPUA',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">📄 Your Transcript of Records</h2>
              
              <p>Dear {{firstName}},</p>
              <p>Your Transcript of Records (TOR) has been generated and is ready for delivery.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #9c27b0; margin: 20px 0;">
                <p><strong>Request Details:</strong></p>
                <p>Request ID: {{requestId}}</p>
                <p>Number of Copies: {{numberOfCopies}}</p>
                <p>Purpose: {{purpose}}</p>
                <p>Generated: {{generatedDate}}</p>
              </div>
              
              <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0;">
                <p><strong>Delivery Information:</strong></p>
                <p>Your TOR document(s) will be delivered to: {{deliveryAddress}}</p>
                <p>Estimated Delivery: {{estimatedDelivery}}</p>
              </div>
              
              <p>If you have any questions or did not receive your documents, please contact the Registrar's Office immediately.</p>
              
              <p style="color: #666; margin-top: 30px; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        `,
        description: 'TOR delivery confirmation sent to student',
      },

      // ========== FEEDBACK TEMPLATES ==========
      {
        id: 'SERV-1-feedback',
        name: 'Course Enrollment Feedback Request',
        subject: 'We Would Love Your Feedback - Course Enrollment Service',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">📋 We Value Your Feedback</h2>
              
              <p>Dear {{firstName}},</p>
              <p>Thank you for using the Course Enrollment Service! We would appreciate your feedback to help us improve our services.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #ff9800; margin: 20px 0;">
                <p>Your feedback is important to us. The survey takes approximately 2-3 minutes to complete.</p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="{{feedbackLink}}" style="background-color: #2196F3; color: white; padding: 12px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">Share Your Feedback</a>
              </div>
              
              <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; font-size: 12px;">
                <p style="color: #666;">Request ID: {{requestId}}</p>
                <p style="color: #666;">This feedback link expires: {{expiresAt}}</p>
              </div>
              
              <p style="color: #666; margin-top: 30px; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        `,
        description: 'Feedback request for course enrollment service',
      },
      {
        id: 'SERV-2-feedback',
        name: 'Room Rental Feedback Request',
        subject: 'Tell Us About Your Dorm Experience - MAPUA',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">📋 Share Your Dorm Experience</h2>
              
              <p>Dear {{firstName}},</p>
              <p>Thank you for renting a dorm room with us! Your feedback helps us maintain quality housing services.</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #2196F3; margin: 20px 0;">
                <p>Please take a moment to share your experience with our dormitory facilities and services.</p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="{{feedbackLink}}" style="background-color: #2196F3; color: white; padding: 12px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">Provide Feedback</a>
              </div>
              
              <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; font-size: 12px;">
                <p style="color: #666;">Request ID: {{requestId}}</p>
                <p style="color: #666;">This feedback link expires: {{expiresAt}}</p>
              </div>
              
              <p style="color: #666; margin-top: 30px; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        `,
        description: 'Feedback request for dorm rental service',
      },
      {
        id: 'SERV-3-feedback',
        name: 'Transcript of Records Feedback Request',
        subject: 'Share Your Feedback on TOR Request Service',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
              <h2 style="color: #003a70;">📋 Your Feedback Matters</h2>
              
              <p>Dear {{firstName}},</p>
              <p>Thank you for using our Transcript of Records service. We'd love to hear about your experience!</p>
              
              <div style="background-color: white; padding: 15px; border-left: 4px solid #9c27b0; margin: 20px 0;">
                <p>Your feedback will help us deliver better service to all students.</p>
              </div>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="{{feedbackLink}}" style="background-color: #2196F3; color: white; padding: 12px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">Share Your Experience</a>
              </div>
              
              <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; font-size: 12px;">
                <p style="color: #666;">Request ID: {{requestId}}</p>
                <p style="color: #666;">This feedback link expires: {{expiresAt}}</p>
              </div>
              
              <p style="color: #666; margin-top: 30px; font-size: 12px;">This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        `,
        description: 'Feedback request for TOR service',
      },
    ];

    // Seed each template
    for (const template of defaultTemplates) {
      await stateManager.saveEmailTemplate(template);
    }

    logger.info(`📧 Seeded ${defaultTemplates.length} email templates (3 approval + 3 payment + 3 delivery + 3 feedback)`);
  } catch (error) {
    logger.error('Failed to seed email templates:', error);
    // Don't throw - continue startup even if templates fail
  }
}

/**
 * Service definitions are loaded exclusively from MongoDB
 * Phase 2 - No YAML file fallback. All services managed via API or pre-populated in MongoDB
 * To add services: Use POST /api/admin/services or update MongoDB directly
 */

async function initializeApp(): Promise<Express> {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // Initialize services
  logger.info('🔧 Initializing services...');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/service-envelope';
  const stateManager = new MongoDBStateManager(logger);
  await stateManager.connect(mongoUri);

  // Seed default email templates
  await seedEmailTemplates(stateManager, logger);

  // Phase 2: All services are loaded exclusively from MongoDB
  const serviceRegistry = new ServiceRegistry(logger, stateManager);
  await serviceRegistry.loadServices();

  const emailService = new EmailService(logger);
  if (process.env.NODE_ENV !== 'development' || process.env.ENABLE_EMAIL === 'true') {
    await emailService.initialize({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASSWORD || '',
      },
      from: process.env.EMAIL_FROM || 'noreply@mapua.edu.ph',
    });
  } else {
    logger.warn('⚠️  Email service running in mock mode (development)');
  }

  // Instantiate all processors
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8000';
  const uiBaseUrl = process.env.UI_BASE_URL || 'http://localhost:5173'; // Phase 2 Dashboard URL for approval links
  const phase2PaymentUrl = process.env.PHASE2_PAYMENT_URL || 'http://localhost:5173'; // Phase 2 payment UI
  const thirdPartyService = new ThirdPartyService(logger, emailService, stateManager as any);
  const requestProcessor = new RequestProcessor(logger);
  const approvalProcessor = new ApprovalProcessor(logger, thirdPartyService, stateManager as any, emailService, uiBaseUrl, phase2PaymentUrl);
  const paymentProcessor = new PaymentProcessor(logger, thirdPartyService);
  const processingProcessor = new ProcessingProcessor(logger, thirdPartyService, stateManager as any);
  const deliveryProcessor = new DeliveryProcessor(logger, thirdPartyService, stateManager as any);
  const feedbackProcessor = new FeedbackProcessor(logger, thirdPartyService, stateManager as any, uiBaseUrl);

  const orchestrator = new ServiceOrchestrator(
    requestProcessor,
    approvalProcessor,
    paymentProcessor,
    processingProcessor,
    deliveryProcessor,
    feedbackProcessor,
    stateManager as any,
    logger
  );

  // Store context globally for routes
  appContext = {
    stateManager,
    serviceRegistry,
    emailService,
    orchestrator,
    logger,
  };

  logger.info('✅ All services initialized');

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/webhooks', paymentsRouter);

  // Unified submit endpoint - service_id in request body
  app.post('/api/submit', async (req: Request, res: Response) => {
    try {
      const { service_id, ...parameters } = req.body;

      if (!service_id) {
        return res.status(400).json({ error: 'service_id is required in request body' });
      }

      const service = appContext.serviceRegistry.getService(service_id);
      if (!service) {
        return res.status(404).json({ error: `Service ${service_id} not found` });
      }

      appContext.logger.info(`📝 Submitting request for service: ${service_id}`);

      // Helper function from services route - create request
      const { randomUUID } = await import('crypto');
      const requestId = `req-${Date.now()}-${randomUUID().substring(0, 8)}`;
      const now = new Date().toISOString();

      const envelopes: EnvelopeCollection = {
        request: {
          status: 'in_progress',
          timestamp: now,
          required: true,
          sourceSystem: parameters.sourceSystem || 'api',
          validationStatus: 'passed',
          validationErrors: [],
          parameters: parameters,
        } as RequestEnvelope,
        approval: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.approval?.required || false,
          approvers: service.envelopes?.approval?.approvers || [],
          approvalRules: service.envelopes?.approval?.approvalRules || { type: 'all_must_approve' },
        } as ApprovalEnvelope,
        payment: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.payment?.required || false,
          charges: service.envelopes?.payment?.charges || [],
          paymentMethod: 'credit_card',
        } as PaymentEnvelope,
        processing: {
          status: 'pending',
          timestamp: now,
          required: true,
          tasks: service.envelopes?.processing?.tasks || [],
        } as ProcessingEnvelope,
        delivery: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.delivery?.required || false,
          method: service.envelopes?.delivery?.method || 'email',
          details: service.envelopes?.delivery?.details || {},
          deliveryAttempts: 0,
        } as DeliveryEnvelope,
        feedback: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.feedback?.required || false,
        } as FeedbackEnvelope,
      };

      const serviceRequest: ServiceRequest = {
        id: requestId,
        type: service_id,
        initiator: parameters.initiator || parameters.studentId || 'unknown',
        overallStatus: 'queued' as const,
        createdAt: now,
        lastUpdated: now,
        history: [
          {
            status: 'queued',
            timestamp: now,
            envelope: 'system',
            notes: 'Request submitted via /api/submit',
          },
        ],
        envelopes,
      } as ServiceRequest;

      await appContext.stateManager.saveRequest(serviceRequest);
      appContext.logger.info(`✅ Request created: ${requestId}`);

      appContext.orchestrator.processRequest(serviceRequest).subscribe({
        next: (result) => {
          appContext.logger.info(`📊 Request processed: ${result.id} -> ${result.overallStatus}`);
        },
        error: (err) => {
          appContext.logger.error(`❌ Error processing request: ${err.message}`);
        },
      });

      res.status(201).json({
        requestId,
        status: 'queued',
        message: 'Request submitted successfully',
        service: {
          id: service_id,
          name: service.name,
        },
      });
    } catch (error) {
      appContext.logger.error('Error submitting request:', error);
      res.status(500).json({ error: 'Failed to submit request', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API info
  app.get('/api', (req: Request, res: Response) => {
    res.json({
      name: 'Service Envelope API',
      version: '1.0.0',
      endpoints: [
        'POST /api/auth/login',
        'GET /api/services',
        'POST /api/services/:serviceId/submit',
        'GET /api/requests',
        'GET /api/requests/:requestId',
        'POST /api/requests/:requestId/resume',
        'POST /api/approvals/:token/approve',
        'POST /api/approvals/:token/deny',
      ],
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Route not found', path: req.path });
  });

  // Error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}

// Start server
async function start(): Promise<void> {
  try {
    const app = await initializeApp();
    const port = process.env.PORT || 8000;

    app.listen(8000, "127.0.0.1", () => {
      logger.info(`🚀 Server listening on port ${port}`);
      logger.info(`📍 API available at http://localhost:${port}/api`);
      logger.info(`💚 Health check at http://localhost:${port}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
