import { Observable, of } from 'rxjs';
import { Logger } from 'winston';
import { Approver, ServiceRequest, ProcessingTask } from '../types/envelope.types';

export class ThirdPartyService {
  constructor(private logger: Logger) {}

  sendApprovalRequest(req: ServiceRequest, approver: Approver): Observable<void> {
    this.logger.info(`Simulating approval request for ${approver.id}`);
    return of(undefined);
  }

  processPayment(data: any): Observable<{ success: boolean; transactionId: string; response: any }> {
    this.logger.info(`Simulating payment processing of ${data.amount} ${data.currency}`);
    return of({
      success: true,
      transactionId: `TXN-${Date.now()}`,
      response: { code: '00', message: 'Mock success' }
    });
  }

  validatePrerequisites(req: ServiceRequest): Observable<boolean> {
    return of(true);
  }

  updateDatabase(req: ServiceRequest): Observable<boolean> {
    return of(true);
  }

  sendNotification(req: ServiceRequest, type: string): Observable<boolean> {
    return of(true);
  }

  executeGenericTask(taskName: string, req: ServiceRequest): Observable<boolean> {
    return of(true);
  }

  sendEmail(data: any): Observable<boolean> {
    return of(true);
  }

  sendSMS(data: any): Observable<boolean> {
    return of(true);
  }

  sendPhysicalMail(data: any): Observable<boolean> {
    return of(true);
  }

  sendFeedbackRequest(req: ServiceRequest, link: string): Observable<boolean> {
    return of(true);
  }
}