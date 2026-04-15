/**
 * Processor for Request Envelopes
 * Handles validation of request parameters and initialization
 */

import { Observable, of, throwError } from 'rxjs';
import { map } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { RequestEnvelope, ServiceRequest } from '../types/envelope.types.js';
import { Logger } from 'winston';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export class RequestProcessor extends EnvelopeProcessor<RequestEnvelope> {
  private ajv: Ajv;

    constructor(logger: Logger) {
    super(logger);
    this.ajv = new Ajv({ allErrors: true });
    addFormats(this.ajv); // ✅ Adds "date-time", "email", "uri", etc.
  }

  protected processInternal(request: ServiceRequest, envelope: RequestEnvelope): Observable<RequestEnvelope> {
    // Validate request parameters
    const validationResult = this.validateParameters(envelope.parameters, request.type);
    
    if (!validationResult.isValid) {
      envelope.validationStatus = 'failed_schema';
      envelope.validationErrors = validationResult.errors;
      envelope.status = 'failed';
      return of(envelope);
    }

    // Mark as completed if validation passes
    envelope.validationStatus = 'passed';
    envelope.validationErrors = [];
    envelope.status = 'completed';
    envelope.timestamp = new Date().toISOString();

    return of(envelope);
  }

  protected getEnvelopeType(): string {
    return 'Request';
  }

  /**
   * Validate request parameters against service-specific schema
   * This is where you can implement custom validation logic
   */
  private validateParameters(parameters: Record<string, any>, serviceType: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Example validation for course enrollment
    if (serviceType === 'courseEnrollment') {
      if (!parameters.studentId) {
        errors.push('Student ID is required');
      }
      if (!parameters.courseCode) {
        errors.push('Course code is required');
      }
      if (!parameters.semester) {
        errors.push('Semester is required');
      }
    }

    // Add more service-specific validations here
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}