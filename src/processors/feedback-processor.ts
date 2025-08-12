/**
 * Processor for Feedback Envelopes
 * Handles post-completion feedback collection
 */

import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor';
import { FeedbackEnvelope, ServiceRequest } from '../types/envelope.types';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service';

export class FeedbackProcessor extends EnvelopeProcessor<FeedbackEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: FeedbackEnvelope): Observable<FeedbackEnvelope> {
    if (!envelope.required) {
      envelope.status = 'skipped';
      return of(envelope);
    }

    // Generate feedback link and send to user
    const feedbackLink = this.generateFeedbackLink(request);
    envelope.feedbackLink = feedbackLink;

    return this.thirdPartyService.sendFeedbackRequest(request, feedbackLink).pipe(
      map(success => {
        envelope.status = success ? 'completed' : 'failed';
        envelope.timestamp = new Date().toISOString();
        return envelope;
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Feedback';
  }

  private generateFeedbackLink(request: ServiceRequest): string {
    return `https://feedback.system.com/survey?reqId=${request.id}&type=${request.type}`;
  }
}