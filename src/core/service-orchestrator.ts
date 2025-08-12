/**
 * Main orchestrator that manages the flow through all envelopes
 * Uses RxJS to create a reactive pipeline for processing requests
 */

import { Observable, of, throwError } from 'rxjs';
import { switchMap, tap, catchError, map } from 'rxjs/operators';
import { ServiceRequest, RequestStatus } from '../types/envelope.types';
import { RequestProcessor } from '../processors/request-processor';
import { ApprovalProcessor } from '../processors/approval-processor';
import { PaymentProcessor } from '../processors/payment-processor';
import { ProcessingProcessor } from '../processors/processing-processor';
import { DeliveryProcessor } from '../processors/delivery-processor';
import { FeedbackProcessor } from '../processors/feedback-processor';
import { StateManager } from './state-manager';
import { Logger } from 'winston';

export class ServiceOrchestrator {
  constructor(
    private requestProcessor: RequestProcessor,
    private approvalProcessor: ApprovalProcessor,
    private paymentProcessor: PaymentProcessor,
    private processingProcessor: ProcessingProcessor,
    private deliveryProcessor: DeliveryProcessor,
    private feedbackProcessor: FeedbackProcessor,
    private stateManager: StateManager,
    private logger: Logger
  ) {}

  /**
   * Main orchestration method that processes a service request through all envelopes
   */
  processRequest(request: ServiceRequest): Observable<ServiceRequest> {
    this.logger.info(`Starting orchestration for request ${request.id}`);
    
    return of(request).pipe(
      // Save initial state
      tap(req => this.stateManager.saveRequest(req)),
      
      // Process Request Envelope
      switchMap(req => this.processEnvelope(req, 'request')),
      
      // Process Approval Envelope
      switchMap(req => this.processEnvelope(req, 'approval')),
      
      // Process Payment Envelope
      switchMap(req => this.processEnvelope(req, 'payment')),
      
      // Process Processing Envelope
      switchMap(req => this.processEnvelope(req, 'processing')),
      
      // Process Delivery Envelope
      switchMap(req => this.processEnvelope(req, 'delivery')),
      
      // Process Feedback Envelope
      switchMap(req => this.processEnvelope(req, 'feedback')),
      
      // Finalize request
      tap(req => {
        req.overallStatus = 'completed';
        req.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(req, 'completed', 'system');
        this.stateManager.saveRequest(req);
        this.logger.info(`Request ${req.id} completed successfully`);
      }),
      
      catchError(error => {
        this.logger.error(`Request ${request.id} failed: ${error.message}`);
        request.overallStatus = 'failed';
        this.addHistoryEntry(request, 'failed', 'system', error.message);
        this.stateManager.saveRequest(request);
        return throwError(() => error);
      })
    );
  }

  /**
   * Process a specific envelope type
   */
  private processEnvelope(request: ServiceRequest, envelopeType: keyof ServiceRequest['envelopes']): Observable<ServiceRequest> {
    const processor = this.getProcessor(envelopeType);
    const envelope = request.envelopes[envelopeType];
    
    if (!processor.shouldProcess(request, envelope)) {
      this.logger.info(`Skipping ${envelopeType} envelope for request ${request.id}`);
      return of(request);
    }

    return processor.process(request, envelope).pipe(
      map(updatedEnvelope => {
        request.envelopes[envelopeType] = updatedEnvelope;
        request.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(request, updatedEnvelope.status, envelopeType);
        
        // Check if envelope failed and should stop processing
        if (updatedEnvelope.status === 'failed') {
          request.overallStatus = 'failed';
          throw new Error(`${envelopeType} envelope failed`);
        }
        
        return request;
      }),
      tap(req => this.stateManager.saveRequest(req))
    );
  }

  /**
   * Get the appropriate processor for an envelope type
   */
  private getProcessor(envelopeType: keyof ServiceRequest['envelopes']) {
    switch (envelopeType) {
      case 'request': return this.requestProcessor;
      case 'approval': return this.approvalProcessor;
      case 'payment': return this.paymentProcessor;
      case 'processing': return this.processingProcessor;
      case 'delivery': return this.deliveryProcessor;
      case 'feedback': return this.feedbackProcessor;
      default: throw new Error(`Unknown envelope type: ${envelopeType}`);
    }
  }

  /**
   * Add a history entry to the request
   */
  private addHistoryEntry(request: ServiceRequest, status: string, envelope: string, notes?: string) {
    request.history.push({
      status,
      timestamp: new Date().toISOString(),
      envelope,
      notes
    });
  }
}