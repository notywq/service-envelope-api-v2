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

  private processingLog(message: string, fields: Record<string, unknown> = {}, level: 'log' | 'warn' | 'error' = 'log'): void {
    const detail = Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        const text = Array.isArray(value)
          ? `[${value.join(', ')}]`
          : value && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value ?? 'n/a');
        return `${key}=${/\s/.test(text) ? JSON.stringify(text) : text}`;
      })
      .join(' | ');
    const line = detail ? `[Processing] ${message} | ${detail}` : `[Processing] ${message}`;
    if (level === 'error') {
      this.logger.error(line);
      return;
    }
    if (level === 'warn') {
      this.logger.warn(line);
      return;
    }
    this.logger.info(line);
  }

  protected processInternal(
    request: ServiceRequest,
    envelope: ProcessingEnvelope
  ): Observable<ProcessingEnvelope> {
    if (!envelope.required) {
      envelope.status = 'waived';
      envelope.timestamp = new Date().toISOString();
      this.processingLog('waived', { request: request.id, reason: 'not required' });
      return of(envelope);
    }

    // Check if this is the initial start (status = pending)
    if (envelope.status === 'pending') {
      // NOTE: Orchestrator handles email sending via sendEnvelopeEmailTemplate()
      envelope.status = 'in_progress';
      envelope.timestamp = new Date().toISOString();
      this.processingLog('started', {
        request: request.id,
        tasks: envelope.tasks.length,
        taskNames: envelope.tasks.map(task => task.name || 'UNNAMED'),
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

            this.processingLog('task updated', {
              request: request.id,
              task: updatedTask.name,
              index: index + 1,
              total: envelope.tasks.length,
              status: updatedTask.status,
            }, updatedTask.status === 'failed' ? 'warn' : 'log');

            // Save state after every task update
            this.stateManager.saveRequest(request);

            // If stopOnFailure and task failed, we should stop
            if (envelope.stopOnFailure && updatedTask.status === 'failed') {
              this.processingLog('aborting remaining tasks', {
                request: request.id,
                failedTask: updatedTask.name,
                reason: 'stopOnFailure',
              }, 'error');
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

        this.processingLog('finished', {
          request: request.id,
          status: envelope.status,
          succeeded: `${completedCount}/${envelope.tasks.length}`,
          failed: `${failedCount}/${envelope.tasks.length}`,
          failedTasks: envelope.tasks
            .filter(task => task.status === 'failed')
            .map(task => `${task.name}: ${task.responseError || 'unknown error'}`),
        }, failedCount > 0 ? 'warn' : 'log');

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
