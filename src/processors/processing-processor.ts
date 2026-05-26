/**
 * Processor for Processing Envelopes
 * Handles API call task execution with parameter substitution
 * Supports GET, POST, PUT, DELETE, PATCH methods
 * Sends start email when processing begins, end email when all tasks complete
 */

import { Observable, of, from } from 'rxjs';
import { map, concatMap, tap, last, switchMap } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { ProcessingEnvelope, ServiceRequest, ProcessingTask } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { StateManager } from '../core/state-manager.js';
import { EmailService } from '../services/email-service.js';
import { EmailTemplateLoader } from '../utils/email-template-loader.js';
import { APITaskExecutor } from '../utils/api-task-executor.js';

export class ProcessingProcessor extends EnvelopeProcessor<ProcessingEnvelope> {
  private templateLoader: EmailTemplateLoader;
  private apiExecutor: APITaskExecutor;

  constructor(
    logger: Logger,
    private stateManager: StateManager,
    private emailService?: EmailService
  ) {
    super(logger);
    this.templateLoader = new EmailTemplateLoader(stateManager, logger);
    this.apiExecutor = new APITaskExecutor(logger);
  }

  protected processInternal(
    request: ServiceRequest,
    envelope: ProcessingEnvelope
  ): Observable<ProcessingEnvelope> {
    // Check if this is the initial start (status = pending)
    if (envelope.status === 'pending' && !envelope.startEmailSentAt) {
      // Send start email
      return from(this.sendStartEmail(request, envelope)).pipe(
        switchMap(() => {
          // After sending start email, process tasks
          envelope.status = 'in_progress';
          envelope.timestamp = new Date().toISOString();
          return this.processTasks(request, envelope);
        })
      );
    }

    // If already in_progress, continue processing tasks
    if (envelope.status === 'in_progress') {
      return this.processTasks(request, envelope);
    }

    // If completed and end email not sent, send it
    if (envelope.status === 'completed' && !envelope.endEmailSentAt) {
      return from(this.sendEndEmail(request, envelope)).pipe(
        map(() => envelope)
      );
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
      concatMap((task, index) =>
        from(this.apiExecutor.executeTask(task, request)).pipe(
          tap((updatedTask) => {
            const taskIndex = envelope.tasks.findIndex(t => t.name === updatedTask.name);
            if (taskIndex >= 0) {
              envelope.tasks[taskIndex] = updatedTask;
            }
            envelope.currentTask = updatedTask.name;

            this.logger.info(
              `[PROCESSING-EXEC] Request ${request.id} | Task ${index + 1}/${envelope.tasks.length} "${updatedTask.name}" | Status: ${updatedTask.status}`
            );

            // Save state after every task update
            this.stateManager.saveRequest(request);

            // If stopOnFailure and task failed, we should stop
            if (envelope.stopOnFailure && updatedTask.status === 'failed') {
              this.logger.error(
                `[PROCESSING-ABORT] Request ${request.id} | Task "${updatedTask.name}" failed, stopOnFailure enabled`
              );
              // Mark envelope as failed
              envelope.status = 'failed';
              throw new Error(`Task "${updatedTask.name}" failed and stopOnFailure is enabled`);
            }
          })
        )
      ),
      last(),
      map(() => {
        const allCompleted = envelope.tasks.every(t => t.status === 'completed');
        const anyFailed = envelope.tasks.some(t => t.status === 'failed');

        envelope.status = anyFailed ? 'failed' : allCompleted ? 'completed' : 'in_progress';
        envelope.currentTask = undefined;
        envelope.timestamp = new Date().toISOString();

        this.logger.info(
          `[PROCESSING-COMPLETE] Request ${request.id} | All tasks completed | Status: ${envelope.status} | ${envelope.tasks.filter((t: any) => t.status === 'completed').length}/${envelope.tasks.length} succeeded`
        );

        return envelope;
      })
    );
  }

  protected getEnvelopeType(): string {
    return 'Processing';
  }

  /**
   * Send processing started email
   */
  private async sendStartEmail(request: ServiceRequest, envelope: ProcessingEnvelope): Promise<void> {
    try {
      // Get service definition to find template ID
      const serviceDefinition = await this.stateManager.getServiceDefinition(request.type);
      if (!serviceDefinition?.processing?.emailTemplateStartEnvelope) {
        this.logger.debug(`[PROCESSING-INIT] Request ${request.id} | No start email template configured`);
        return;
      }

      // Fetch and render template
      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.processing.emailTemplateStartEnvelope,
        request,
        'processing-start'
      );

      if (!template) {
        this.logger.warn(
          `[PROCESSING-INIT] Request ${request.id} | Failed to load start email template`
        );
        return;
      }

      // Get requestor email
      const requestorEmail = request.envelopes.request.parameters?.email;
      if (!requestorEmail) {
        this.logger.warn(`No email address found for requestor in request ${request.id}`);
        return;
      }

      // Send email
      if (this.emailService) {
        await this.emailService.sendEmail({
          to: requestorEmail,
          subject: template.subject,
          html: template.htmlBody,
        });

        envelope.startEmailSentAt = new Date().toISOString();
        this.logger.info(`[PROCESSING-INIT] Request ${request.id} | Start email sent | ${envelope.tasks.length} tasks | stopOnFailure=${envelope.stopOnFailure}`);
      }
    } catch (error) {
      this.logger.error(`[PROCESSING-ERROR] Request ${request.id} | Failed to send start email: ${(error as Error).message}`);
    }
  }

  /**
   * Send processing completed email
   */
  private async sendEndEmail(request: ServiceRequest, envelope: ProcessingEnvelope): Promise<void> {
    try {
      // Get service definition to find template ID
      const serviceDefinition = await this.stateManager.getServiceDefinition(request.type);
      if (!serviceDefinition?.processing?.emailTemplateEndEnvelope) {
        this.logger.debug(`[PROCESSING-COMPLETE] Request ${request.id} | No end email template configured`);
        return;
      }

      // Fetch and render template
      const template = await this.templateLoader.fetchAndRenderTemplate(
        serviceDefinition.processing.emailTemplateEndEnvelope,
        request,
        'processing-end'
      );

      if (!template) {
        this.logger.warn(
          `[PROCESSING-COMPLETE] Request ${request.id} | Failed to load end email template`
        );
        return;
      }

      // Get requestor email
      const requestorEmail = request.envelopes.request.parameters?.email;
      if (!requestorEmail) {
        this.logger.warn(`No email address found for requestor in request ${request.id}`);
        return;
      }

      // Send email
      if (this.emailService) {
        await this.emailService.sendEmail({
          to: requestorEmail,
          subject: template.subject,
          html: template.htmlBody,
        });

        envelope.endEmailSentAt = new Date().toISOString();
        this.logger.info(`[PROCESSING-COMPLETE] Request ${request.id} | Completion email sent to ${requestorEmail}`);
      }
    } catch (error) {
      this.logger.error(`[PROCESSING-ERROR] Request ${request.id} | Failed to send completion email: ${(error as Error).message}`);
    }
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
