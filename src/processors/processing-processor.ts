/**
 * Processor for Processing Envelopes
 * Handles API call task execution with parameter substitution
 * Supports GET, POST, PUT, DELETE, PATCH methods
 * Email sending is handled by the orchestrator via sendEnvelopeEmailTemplate()
 */

import { Observable, of, from } from 'rxjs';
import { concatMap, last, tap, map } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { ProcessingEnvelope, ServiceRequest, ProcessingTask } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { StateManager } from '../core/state-manager.js';
import { APITaskExecutor } from '../utils/api-task-executor.js';

export class ProcessingProcessor extends EnvelopeProcessor<ProcessingEnvelope> {
  private apiExecutor: APITaskExecutor;

  constructor(
    logger: Logger,
    private stateManager: StateManager
  ) {
    super(logger);
    this.apiExecutor = new APITaskExecutor(logger);
  }

  protected processInternal(
    request: ServiceRequest,
    envelope: ProcessingEnvelope
  ): Observable<ProcessingEnvelope> {
    if (!envelope.required) {
      envelope.status = 'waived';
      envelope.timestamp = new Date().toISOString();
      this.logger.info(`[PROCESSING-WAIVED] Request ${request.id} | Processing not required`);
      return of(envelope);
    }

    // Check if this is the initial start (status = pending)
    if (envelope.status === 'pending') {
      // NOTE: Orchestrator handles email sending via sendEnvelopeEmailTemplate()
      envelope.status = 'in_progress';
      envelope.timestamp = new Date().toISOString();
      this.logger.info(
        `[PROCESSING-START] Request ${request.id} | Starting processing envelope | ${envelope.tasks.length} tasks to execute`
      );
      console.log(`\n🔄 [PROCESSING-START] Starting ${envelope.tasks.length} API tasks for request: ${request.id}`);
      envelope.tasks.forEach((task, idx) => {
        console.log(`   Task ${idx + 1}: ${task.name || 'UNNAMED'}`);
      });
      return this.processTasks(request, envelope);
    }

    // If already in_progress, continue processing tasks
    if (envelope.status === 'in_progress') {
      return this.processTasks(request, envelope);
    }

    // If completed, just return (orchestrator handles email)
    if (envelope.status === 'completed') {
      return of(envelope);
    }

    return of(envelope);
  }

  /**
   * Process all tasks sequentially
   */
  private processTasks(
    request: ServiceRequest,
    envelope: ProcessingEnvelope
  ): Observable<ProcessingEnvelope> {
    // Validate tasks before processing
    const validation = this.validateTasks(envelope.tasks);
    if (!validation.valid) {
      this.logger.error(
        `[PROCESSING-VALIDATE] Request ${request.id} | Task validation failed | ${validation.errors.join(', ')}`
      );
      envelope.status = 'failed';
      envelope.timestamp = new Date().toISOString();
      return of(envelope);
    }

    if (envelope.tasks.length === 0) {
      envelope.status = 'completed';
      envelope.timestamp = new Date().toISOString();
      return of(envelope);
    }

    return from(envelope.tasks).pipe(
      concatMap((task, index) => {
        if (envelope.stopOnFailure && envelope.status === 'failed') {
          return of(task);
        }

        return from(this.apiExecutor.executeTask(task, request)).pipe(
          tap((updatedTask) => {
            const taskIndex = envelope.tasks.findIndex(t => t.name === updatedTask.name);
            if (taskIndex >= 0) {
              envelope.tasks[taskIndex] = updatedTask;
            }
            envelope.currentTask = updatedTask.name;

            const statusIcon = updatedTask.status === 'completed' ? '✅' : updatedTask.status === 'failed' ? '❌' : '⏳';
            console.log(`${statusIcon} Task ${index + 1}/${envelope.tasks.length}: ${updatedTask.name} - ${updatedTask.status.toUpperCase()}`);
            
            this.logger.info(
              `[PROCESSING-EXEC] Request ${request.id} | Task ${index + 1}/${envelope.tasks.length} "${updatedTask.name}" | Status: ${updatedTask.status}`
            );

            // Save state after every task update
            this.stateManager.saveRequest(request);

            // If stopOnFailure and task failed, we should stop
            if (envelope.stopOnFailure && updatedTask.status === 'failed') {
              console.log(`\n⛔ [PROCESSING-ABORT] stopOnFailure enabled - aborting remaining tasks`);
              this.logger.error(
                `[PROCESSING-ABORT] Request ${request.id} | Task "${updatedTask.name}" failed, stopOnFailure enabled`
              );
              // Mark envelope as failed
              envelope.status = 'failed';
            }
          })
        );
      }),
      last(),
      map(() => {
        const allCompleted = envelope.tasks.every(t => t.status === 'completed');
        const anyFailed = envelope.tasks.some(t => t.status === 'failed');
        const completedCount = envelope.tasks.filter((t: any) => t.status === 'completed').length;
        const failedCount = envelope.tasks.filter((t: any) => t.status === 'failed').length;

        envelope.status = anyFailed ? 'failed' : allCompleted ? 'completed' : 'in_progress';
        envelope.currentTask = undefined;
        envelope.timestamp = new Date().toISOString();

        console.log(`\n✅ [PROCESSING-SUMMARY] Request ${request.id} | All ${envelope.tasks.length} API tasks completed`);
        console.log(`   Status: ${envelope.status.toUpperCase()}`);
        console.log(`   ✅ Success: ${completedCount}/${envelope.tasks.length}`);
        if (failedCount > 0) {
          console.log(`   ❌ Failed: ${failedCount}/${envelope.tasks.length}`);
          envelope.tasks.forEach((task, idx) => {
            if (task.status === 'failed') {
              console.log(`      • Task ${idx + 1}: ${task.name} - ${task.responseError}`);
            }
          });
        }

        this.logger.info(
          `[PROCESSING-COMPLETE] Request ${request.id} | All tasks completed | Status: ${envelope.status} | ${completedCount}/${envelope.tasks.length} succeeded`
        );

        return envelope;
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Processing';
  }

  /**
   * Validate all tasks against ProcessingTask interface requirements
   */
  private validateTasks(tasks: ProcessingTask[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

    tasks.forEach((task, index) => {
      const taskRef = `Task[${index}] "${task.name || 'UNNAMED'}"`;
      
      // Check required fields
      if (!task.name || task.name.trim() === '') {
        errors.push(`${taskRef} | Missing required field: name`);
      }
      if (!task.method || !validMethods.includes(task.method)) {
        errors.push(`${taskRef} | Invalid HTTP method "${task.method}" (valid: GET, POST, PUT, DELETE, PATCH)`);
      }
      if (!task.url || task.url.trim() === '') {
        errors.push(`${taskRef} | Missing required field: url`);
      }
      
      // Check method-specific requirements
      if (task.method === 'POST' || task.method === 'PUT') {
        if (!task.payload) {
          errors.push(`${taskRef} | ${task.method} request requires payload`);
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
