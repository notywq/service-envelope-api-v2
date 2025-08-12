/**
 * Main orchestrator that manages the flow through all envelopes
 * Uses RxJS to create a reactive pipeline for processing requests
 */

import { Observable, of, throwError } from 'rxjs';
import { switchMap, tap, catchError, map } from 'rxjs/operators';
import { ServiceRequest, RequestStatus, EnvelopeCollection } from '../types/envelope.types';
import { RequestProcessor } from '../processors/request-processor';
import { ApprovalProcessor } from '../processors/approval-processor';
import { PaymentProcessor } from '../processors/payment-processor';
import { ProcessingProcessor } from '../processors/processing-processor';
import { DeliveryProcessor } from '../processors/delivery-processor';
import { FeedbackProcessor } from '../processors/feedback-processor';
import { StateManager } from './state-manager';
import { Logger } from 'winston';
import { EnvelopeProcessor } from './envelope-processor';

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
  
  private processEnvelope<K extends keyof EnvelopeCollection>(
  request: ServiceRequest,
  envelopeType: K
): Observable<ServiceRequest> {
  const processor = this.getProcessor(envelopeType);
  const envelope = request.envelopes[envelopeType];

  if (!processor.shouldProcess(request, envelope)) {
    this.logger.info(`Skipping ${envelopeType} envelope for request ${request.id}`);
    return of(request);
  }

  return processor.process(request, envelope).pipe(
    switchMap(updatedEnvelope => {
      request.envelopes[envelopeType] = updatedEnvelope;
      request.lastUpdated = new Date().toISOString();
      this.addHistoryEntry(request, updatedEnvelope.status, envelopeType);

      if (updatedEnvelope.status === 'failed') {
        request.overallStatus = 'failed';
        return throwError(() => new Error(`${envelopeType} envelope failed`));
      }

      return of(request);
    }),
    tap(req => this.stateManager.saveRequest(req))
  );
}
  /**
   * Get the appropriate processor for an envelope type
   */
private getProcessor<K extends keyof EnvelopeCollection>(
  envelopeType: K
): EnvelopeProcessor<EnvelopeCollection[K]> {
  switch (envelopeType) {
    case 'request':
      return this.requestProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
    case 'approval':
      return this.approvalProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
    case 'payment':
      return this.paymentProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
    case 'processing':
      return this.processingProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
    case 'delivery':
      return this.deliveryProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
    case 'feedback':
      return this.feedbackProcessor as unknown as EnvelopeProcessor<EnvelopeCollection[K]>;
    default:
      throw new Error(`Unknown envelope type: ${envelopeType}`);
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