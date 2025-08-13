import { Observable, of, delay } from 'rxjs';
import { Logger } from 'winston';
import { Approver, ServiceRequest, ProcessingTask } from '../types/envelope.types';

export class ThirdPartyService {
  constructor(private logger: Logger) {}

  /**
   * Simulates sending an approval request.
   * Some requests will be "waiting" (human approval), triggering pending_external.
   */
  sendApprovalRequest(req: ServiceRequest, approver: Approver): Observable<{ status: 'approved' | 'waiting'; approver: Approver }> {
    this.logger.info(`Simulating approval request for ${approver.id}`);

    // Simulate network delay
    const isWaiting = Math.random() < 0.5; // 50% chance to be "waiting"
    if (isWaiting) {
      this.logger.warn(`Approval request for ${approver.id} is waiting for external input`);
      return of<{ status: 'approved' | 'waiting'; approver: Approver }>({ status: 'waiting', approver })// Simulate small delay
    }

    // Auto-approve for simulation
    approver.status = 'approved';
    approver.approvedAt = new Date().toISOString();
    return of<{ status: 'approved' | 'waiting'; approver: Approver }>({ status: 'approved', approver })
  }

  processPayment(data: any): Observable<{ success: boolean; transactionId: string; response: any; pending?: boolean }> {
    this.logger.info(`Simulating payment of ${data.amount} ${data.currency}`);
    
    const isPending = Math.random() < 0.3; // 30% chance of external wait
    if (isPending) {
      this.logger.warn(`Payment requires external verification`);
      return of({
        success: false,
        transactionId: `TXN-${Date.now()}`,
        response: { code: 'PENDING', message: 'Awaiting verification' },
        pending: true
      });
    }

    return of({
      success: true,
      transactionId: `TXN-${Date.now()}`,
      response: { code: '00', message: 'Mock success' }
    });
  }

  validatePrerequisites(req: ServiceRequest): Observable<'completed' | 'waiting' | 'failed'> {
    return of('completed');
  }

  updateDatabase(req: ServiceRequest): Observable<'completed' | 'waiting' | 'failed'> {
    return of('completed');
  }

  sendNotification(req: ServiceRequest, type: string): Observable<'completed' | 'waiting' | 'failed'>{
    return of('completed');
  }

executeGenericTask(
  taskName: string,
  req: ServiceRequest
): Observable<'completed' | 'waiting' | 'failed'> {
  const random = Math.random();

  if (random < 0.3) {
    // 30% chance waiting for external input
    this.logger.warn(`Task "${taskName}" is waiting for external data`);
    return of('waiting');
  } else if (random < 0.5) {
    // 20% chance task fails
    this.logger.error(`Task "${taskName}" failed`);
    return of('failed');
  }

  // 50% chance success
  this.logger.info(`Task "${taskName}" completed successfully`);
  return of('completed');
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