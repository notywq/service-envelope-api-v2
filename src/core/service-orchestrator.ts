/**
 * Main orchestrator that manages the flow through all envelopes
 * Supports pausing on "pending_external" and resuming later
 */

import { Observable, of, throwError } from 'rxjs';
import { switchMap, tap, catchError, map } from 'rxjs/operators';
import { ServiceRequest, EnvelopeCollection } from '../types/envelope.types';
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
   * Main orchestration method
   */
  processRequest(request: ServiceRequest): Observable<ServiceRequest> {
    this.logger.info(`Starting orchestration for request ${request.id}`);

    return of(request).pipe(
      tap(req => this.stateManager.saveRequest(req)), // Save initial state

      // Sequentially process all envelopes
      switchMap(req => this.processEnvelope(req, 'request')),
      switchMap(req => this.processEnvelope(req, 'approval')),
      switchMap(req => this.processEnvelope(req, 'payment')),
      switchMap(req => this.processEnvelope(req, 'processing')),
      switchMap(req => this.processEnvelope(req, 'delivery')),
      switchMap(req => this.processEnvelope(req, 'feedback')),

      // Finalize request if all envelopes processed
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
   * Process a specific envelope type with support for pending_external pause/resume
   */
  private processEnvelope<K extends keyof EnvelopeCollection>(
    request: ServiceRequest,
    envelopeType: K
  ): Observable<ServiceRequest> {
    const processor = this.getProcessor(envelopeType);
    const envelope = request.envelopes[envelopeType];

    // Skip if already completed or failed
    if (['completed', 'failed', 'waived'].includes(envelope.status)) {
      this.logger.info(`Skipping ${envelopeType} (status: ${envelope.status}) for request ${request.id}`);
      return of(request);
    }

    // Resume if status is pending_external — we try processing again
    if (envelope.status === 'pending_external') {
      this.logger.info(`Resuming ${envelopeType} for request ${request.id}`);
    }

    return processor.process(request, envelope).pipe(
      switchMap(updatedEnvelope => {
        request.envelopes[envelopeType] = updatedEnvelope;
        request.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(request, updatedEnvelope.status, envelopeType);

        // Pause if processor signals pending_external
        if (updatedEnvelope.status === 'pending_external') {
          this.logger.warn(
            `Pausing pipeline — ${envelopeType} is waiting for external input (request ${request.id})`
          );
          this.stateManager.saveRequest(request);
          return throwError(() => new Error('Pipeline paused: pending_external'));
        }

        // Stop if envelope failed
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
   * Get the processor for a given envelope type
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
   * Append to request history
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
