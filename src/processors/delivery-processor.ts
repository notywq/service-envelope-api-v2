/**
 * Processor for Delivery Envelopes
 * Handles delivery of service outputs to users
 * Supports email templates with dynamic variable substitution
 */

import { Observable, of, from } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { DeliveryEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';

export class DeliveryProcessor extends EnvelopeProcessor<DeliveryEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager?: StateManager
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: DeliveryEnvelope): Observable<DeliveryEnvelope> {
    if (!envelope.required) {
      envelope.status = 'skipped';
      return of(envelope);
    }

    return this.executeDelivery(request, envelope).pipe(
      map(success => {
        envelope.status = success ? 'completed' : 'failed';
        envelope.deliveryAttempts = (envelope.deliveryAttempts || 0) + 1;
        envelope.lastAttemptAt = new Date().toISOString();
        envelope.timestamp = new Date().toISOString();
        return envelope;
      }),
      catchError(error => {
        this.logger.error(`Delivery failed: ${error}`);
        envelope.status = 'failed';
        envelope.deliveryAttempts = (envelope.deliveryAttempts || 0) + 1;
        return of(envelope);
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Delivery';
  }

  /**
   * Execute delivery based on the specified method
   */
  private executeDelivery(request: ServiceRequest, envelope: DeliveryEnvelope): Observable<boolean> {
    switch (envelope.method) {
      case 'email':
        return this.deliverViaEmail(request, envelope);
      
      case 'sms':
        return this.deliverViaSMS(request, envelope);
      
      case 'physical_mail':
        return this.deliverViaPhysicalMail(request, envelope);
      
      default:
        this.logger.warn(`Unknown delivery method: ${envelope.method}`);
        return of(false);
    }
  }

  /**
   * Deliver service output via email
   * Fetches email template from MongoDB and substitutes variables
   */
  private deliverViaEmail(request: ServiceRequest, envelope: DeliveryEnvelope): Observable<boolean> {
    if (!envelope.details?.email) {
      this.logger.warn('Email delivery details missing');
      return of(false);
    }

    const recipient = this.replaceVariables(envelope.details.email.recipient, request);
    const subject = this.replaceVariables(envelope.details.email.subject || 'Service Request Complete', request);

    this.logger.info(`📨 Preparing email delivery | Recipient: ${recipient} | Subject: ${subject}`);

    // If templateId is specified, fetch from MongoDB
    const templateId = envelope.details.email.templateId;
    if (templateId && this.stateManager) {
      return from(this.fetchAndRenderTemplate(templateId, request)).pipe(
        switchMap(htmlBody => {
          this.logger.info(`📧 Using delivery template: ${templateId}`);
          return from(this.thirdPartyService.sendEmail({
            to: recipient,
            subject,
            html: htmlBody,
            requestId: request.id
          })).pipe(map(() => true));
        }),
        catchError(error => {
          this.logger.error(`Failed to send templated email: ${error}`);
          return of(false);
        })
      );
    } else {
      // No template, send basic email
      this.logger.info(`📧 Sending delivery email without template`);
      return from(this.thirdPartyService.sendEmail({
        to: recipient,
        subject,
        body: `Your request ${request.id} has been completed.`,
        requestId: request.id
      })).pipe(
        map(() => true),
        catchError(error => {
          this.logger.error(`Failed to send basic email: ${error}`);
          return of(false);
        })
      );
    }
  }

  /**
   * Deliver service output via SMS
   */
  private deliverViaSMS(request: ServiceRequest, envelope: DeliveryEnvelope): Observable<boolean> {
    if (!envelope.details?.sms) {
      this.logger.warn('SMS delivery details missing');
      return of(false);
    }

    const phoneNumber = this.replaceVariables(envelope.details.sms.phoneNumber, request);
    const message = this.replaceVariables(
      envelope.details.sms.message || `Your request ${request.id} has been completed.`,
      request
    );

    this.logger.info(`📱 Preparing SMS delivery | Phone: ${phoneNumber}`);

    return from(this.thirdPartyService.sendSMS({
      to: phoneNumber,
      message,
      requestId: request.id
    })).pipe(
      map(() => true),
      catchError(error => {
        this.logger.error(`Failed to send SMS: ${error}`);
        return of(false);
      })
    );
  }

  /**
   * Deliver service output via physical mail
   */
  private deliverViaPhysicalMail(request: ServiceRequest, envelope: DeliveryEnvelope): Observable<boolean> {
    if (!envelope.details?.physicalMail) {
      this.logger.warn('Physical mail delivery details missing');
      return of(false);
    }

    const address = this.replaceVariables(envelope.details.physicalMail.address, request);

    this.logger.info(`📮 Preparing physical mail delivery | Address: ${address}`);

    return from(this.thirdPartyService.sendPhysicalMail({
      address,
      tracking: envelope.details.physicalMail.trackingId ? true : false,
      requestId: request.id
    })).pipe(
      map(() => true),
      catchError(error => {
        this.logger.error(`Failed to send physical mail: ${error}`);
        return of(false);
      })
    );
  }

  /**
   * Fetch email template from MongoDB and render with request variables
   */
  private async fetchAndRenderTemplate(templateId: string, request: ServiceRequest): Promise<string> {
    try {
      if (!this.stateManager) {
        throw new Error('StateManager not available');
      }

      const template = await (this.stateManager as any).getEmailTemplate(templateId);
      if (!template || !template.htmlBody) {
        throw new Error(`Template ${templateId} not found or has no htmlBody`);
      }

      this.logger.debug(`📄 Rendering template ${templateId}`);
      return this.replaceVariables(template.htmlBody, request);
    } catch (error) {
      this.logger.error(`Failed to fetch template ${templateId}: ${error}`);
      throw error;
    }
  }

  /**
   * Replace template variables with request data
   * Supports {{variableName}} syntax
   */
  private replaceVariables(template: string, request: ServiceRequest): string {
    let result = template;

    // Get request parameters
    const params = request.envelopes?.request?.parameters || {};

    // Replace request-level variables
    const replacements: Record<string, any> = {
      requestId: request.id,
      serviceType: request.type,
      initiatorName: request.initiator,
      createdAt: request.createdAt,
      processedDate: new Date().toISOString(),
      firstName: params.firstName || '',
      lastName: params.lastName || '',
      email: params.email || '',
      studentId: params.studentId || '',
      courseName: params.courseName || '',
      section: params.section || '',
      semester: params.semester || '',
      academicYear: params.academicYear || '',
      buildingName: params.buildingName || 'TBD',
      roomNumber: params.roomNumber || 'TBD',
      floor: params.floor || 'TBD',
      roomType: params.roomType || '',
      numberOfCopies: params.numberOfCopies || '',
      purpose: params.purpose || '',
      deliveryAddress: params.deliveryAddress || '',
      generatedDate: new Date().toISOString(),
      estimatedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
    };

    // Replace all variables
    Object.entries(replacements).forEach(([key, value]) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
      result = result.replace(regex, String(value || ''));
    });

    return result;
  }
}

