/**
 * Processor for Processing Envelopes
 * Handles core business logic and task execution
 */

import { Observable, of, from, concat } from 'rxjs';
import { map, switchMap, concatMap, tap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor';
import { ProcessingEnvelope, ServiceRequest, ProcessingTask } from '../types/envelope.types';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service';

export class ProcessingProcessor extends EnvelopeProcessor<ProcessingEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService
  ) {
    super(logger);
  }

  protected processInternal(request: ServiceRequest, envelope: ProcessingEnvelope): Observable<ProcessingEnvelope> {
    envelope.status = 'in_progress';
    envelope.processorId = `worker_${Date.now()}`;
    
    // Process tasks sequentially
    return from(envelope.tasks).pipe(
      concatMap(task => this.processTask(request, task)),
      tap(task => {
        // Update current task in envelope
        const taskIndex = envelope.tasks.findIndex(t => t.name === task.name);
        envelope.tasks[taskIndex] = task;
        envelope.currentTask = task.status === 'in_progress' ? task.name : undefined;
      }),
      map(task => envelope), // Return updated envelope for each task
      // After all tasks complete, finalize the envelope
      switchMap(() => {
        const allCompleted = envelope.tasks.every(t => t.status === 'completed');
        const anyFailed = envelope.tasks.some(t => t.status === 'failed');
        
        envelope.status = anyFailed ? 'failed' : (allCompleted ? 'completed' : 'in_progress');
        envelope.currentTask = undefined;
        envelope.timestamp = new Date().toISOString();
        
        return of(envelope);
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Processing';
  }

  /**
   * Process an individual task within the processing envelope
   * This is where core business logic is executed
   */
  private processTask(request: ServiceRequest, task: ProcessingTask): Observable<ProcessingTask> {
    task.status = 'in_progress';
    task.startedAt = new Date().toISOString();

    // Route to appropriate task handler based on task name
    return this.executeTaskLogic(request, task).pipe(
      map(success => {
        task.status = success ? 'completed' : 'failed';
        task.completedAt = new Date().toISOString();
        if (!success) {
          task.errorMessage = 'Task execution failed';
        }
        return task;
      })
    );
  }

  /**
   * Execute task-specific logic
   * This is where you integrate with your business systems
   */
  private executeTaskLogic(request: ServiceRequest, task: ProcessingTask): Observable<boolean> {
    switch (task.name) {
      case 'validate_prerequisites':
        return this.thirdPartyService.validatePrerequisites(request);
      case 'db_update_enrollment':
        return this.thirdPartyService.updateDatabase(request);
      case 'send_enrollment_confirmation':
        return this.thirdPartyService.sendNotification(request, 'enrollment_confirmation');
      default:
        // Generic task processing
        return this.thirdPartyService.executeGenericTask(task.name, request);
    }
  }
}