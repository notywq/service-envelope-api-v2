/**
 * Main orchestrator that manages the flow through all envelopes
 * Supports pausing on "pending_external" and resuming later
 */

import { Observable, of, throwError } from 'rxjs';
import { switchMap, tap, catchError, map } from 'rxjs/operators';
import { ServiceRequest, EnvelopeCollection } from '../types/envelope.types.js';
import { RequestProcessor } from '../processors/request-processor.js';
import { ApprovalProcessor } from '../processors/approval-processor.js';
import { PaymentProcessor } from '../processors/payment-processor.js';
import { ProcessingProcessor } from '../processors/processing-processor.js';
import { DeliveryProcessor } from '../processors/delivery-processor.js';
import { FeedbackProcessor } from '../processors/feedback-processor.js';
import { StateManager } from './state-manager.js';
import { Logger } from 'winston';
import { EnvelopeProcessor } from './envelope-processor.js';

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
        const errorMsg = error.message || '';
        
        // If this is a pending_external pause, don't mark as failed
        // The status has already been set correctly in processEnvelope
        if (errorMsg.includes('pending_external')) {
          this.logger.info(`Request ${request.id} paused - waiting for external processes`);
          return throwError(() => error);
        }
        
        // For other errors, mark as failed
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
    if (['completed', 'waived'].includes(envelope.status)) {
      this.logger.info(`Skipping ${envelopeType.toUpperCase()} (status: ${envelope.status.toUpperCase()}) for request ${request.id}`);
      return of(request);
    }

    // Resume if status is pending_external — we try processing again
    if (envelope.status === 'pending_external') {
      this.logger.info(`Resuming ${envelopeType.toUpperCase()} for request ${request.id}`);
    }

    if (envelope.status === 'failed') {
    this.logger.warn(
      `[RETRY ENVELOPE ENABLED] ${envelopeType.toUpperCase()} previously failed for request ${request.id}. Retrying now...`
    );
  }

    return processor.process(request, envelope).pipe(
      switchMap(updatedEnvelope => {
        request.envelopes[envelopeType] = updatedEnvelope;
        request.lastUpdated = new Date().toISOString();
        this.addHistoryEntry(request, updatedEnvelope.status, envelopeType);

        // Pause if processor signals pending_external
        if (updatedEnvelope.status === 'pending_external') {
          this.logger.warn(
            `\x1b[36m[PAUSING PIPELINE]\x1b[0m — ${envelopeType} is waiting for external processes to complete (request ${request.id})`
          );
          // Update overall status to reflect the current stage
          request.overallStatus = this.mapEnvelopeToOverallStatus(envelopeType);
          request.lastUpdated = new Date().toISOString();
          this.stateManager.saveRequest(request);
          return throwError(() => new Error('[PIPELINE PAUSED]: pending_external'));
        }

      // If approval failed, save and pause instead of failing the whole request
        if (updatedEnvelope.status === 'failed') {
          this.logger.warn(
            `[PAUSING PIPELINE] ${envelopeType.toUpperCase()} failed for request ${request.id} — will allow retry on resume`
          );
          request.overallStatus = this.mapEnvelopeToOverallStatus(envelopeType);
          request.lastUpdated = new Date().toISOString();
          this.stateManager.saveRequest(request);
          return throwError(() => new Error(`[PIPELINE PAUSED]: ${envelopeType} envelope failed`));
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

  /**
   * Map envelope type to a meaningful overall status
   * Used when an envelope is waiting on external processes (pending_external)
   */
  private mapEnvelopeToOverallStatus(envelopeType: keyof EnvelopeCollection): 'pending_approval' | 'pending_payment' | 'processing' | 'pending_delivery' | 'pending_feedback' | 'process_pending' {
    switch (envelopeType) {
      case 'approval':
        return 'pending_approval';
      case 'payment':
        return 'pending_payment';
      case 'processing':
        return 'processing';
      case 'delivery':
        return 'pending_delivery';
      case 'feedback':
        return 'pending_feedback';
      default:
        return 'process_pending';
    }
  }
}
