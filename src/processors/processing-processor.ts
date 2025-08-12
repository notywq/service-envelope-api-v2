/**
 * Processor for Processing Envelopes
 * Handles core business logic and task execution
 */

import { Observable, of, from, concat } from 'rxjs';
import { map, switchMap, concatMap, tap, last } from 'rxjs/operators';
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

protected processInternal(
  request: ServiceRequest,
  envelope: ProcessingEnvelope
): Observable<ProcessingEnvelope> {
  envelope.status = 'in_progress';
  envelope.processorId = `worker_${Date.now()}`;

  return from(envelope.tasks).pipe(
    concatMap((task, index) =>
      this.processTask(request, task).pipe(
        tap(updatedTask => {
          // Update envelope task list
          const taskIndex = envelope.tasks.findIndex(t => t.name === updatedTask.name);
          envelope.tasks[taskIndex] = updatedTask;
          envelope.currentTask =
            updatedTask.status === 'in_progress' ? updatedTask.name : undefined;

          // Log current task status
          this.logger.info(
            `[ProcessingEnvelope] Request ${request.id} - Task ${index + 1}/${envelope.tasks.length} "${updatedTask.name}" → ${updatedTask.status}`
          );
        })
      )
    ),
    // After all tasks complete, finalize status once
    last(), // <-- waits until all tasks processed
    map(() => {
      const allCompleted = envelope.tasks.every(t => t.status === 'completed');
      const anyFailed = envelope.tasks.some(t => t.status === 'failed');

      envelope.status = anyFailed
        ? 'failed'
        : allCompleted
        ? 'completed'
        : 'in_progress';
      envelope.currentTask = undefined;
      envelope.timestamp = new Date().toISOString();

      this.logger.info(
        `[ProcessingEnvelope] Request ${request.id} - Final status: ${envelope.status}`
      );

      return envelope;
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