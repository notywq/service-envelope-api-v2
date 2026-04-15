/**
 * Processor for Processing Envelopes
 * Handles core business logic and task execution
 */

import { Observable, of, from, concat, throwError } from 'rxjs';
import { map, switchMap, concatMap, tap, last } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { ProcessingEnvelope, ServiceRequest, ProcessingTask } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';

export class ProcessingProcessor extends EnvelopeProcessor<ProcessingEnvelope> {
  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager: StateManager // 💾 Needed to save state on pause
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
          const taskIndex = envelope.tasks.findIndex(t => t.name === updatedTask.name);
          envelope.tasks[taskIndex] = updatedTask;
          envelope.currentTask =
            updatedTask.status === 'in_progress' || updatedTask.status === 'pending_external'
              ? updatedTask.name
              : undefined;

          this.logger.info(
            `[ProcessingEnvelope] Request ${request.id} - Task ${index + 1}/${envelope.tasks.length} "${updatedTask.name}" → ${updatedTask.status}`
          );

          // Save state after every task update
          this.stateManager.saveRequest(request);

          // Stop immediately if failed or waiting
            if (updatedTask.status === 'failed' || updatedTask.status === 'pending_external') 
            {
              // End stream immediately — ServiceOrchestrator will decide what to do next
              throwError(() => ({
                stopProcessing: true,
                status: updatedTask.status
              }));
            }
        })
      )
    ),
    last(),
    map(() => {
      const allCompleted = envelope.tasks.every(t => t.status === 'completed');
      const anyFailed = envelope.tasks.some(t => t.status === 'failed');
      const anyWaiting = envelope.tasks.some(t => t.status === 'pending_external');

      envelope.status = anyFailed
        ? 'failed'
        : allCompleted
        ? 'completed'
        : anyWaiting
        ? 'pending_external'
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

private processTask(request: ServiceRequest, task: ProcessingTask): Observable<ProcessingTask> {
  task.status = 'in_progress';
  task.startedAt = new Date().toISOString();

  // Add color to [TASK] using ANSI escape codes (yellow)
  this.logger.info(`\x1b[33m[TASK]\x1b[0m Running "${task.name}" for request ${request.id}`);
  return this.executeTaskLogic(request, task).pipe(
    map(result => {
      if (result === 'waiting') {
        task.status = 'pending_external';
      } else if (result === 'failed') {
        task.status = 'failed';
        task.errorMessage = 'Task execution failed';
      } else {
        task.status = 'completed';
      }
      task.completedAt = new Date().toISOString();
      return task;
    })
  );
}


    protected getEnvelopeType(): string {
    return 'Processing';
  }
  /**
   * Execute task-specific logic
   * This is where you integrate with your business systems
   */
  private executeTaskLogic(request: ServiceRequest, task: ProcessingTask): Observable<'waiting' | 'completed' | 'failed'> {
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