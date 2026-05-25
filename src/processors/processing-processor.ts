/**
 * Processor for Processing Envelopes
 * Handles core business logic and task execution
 * Supports both webhook calls and built-in function execution
 */

import { Observable, of, from } from 'rxjs';
import { map, concatMap, tap, last } from 'rxjs/operators';
import { EnvelopeProcessor } from '../core/envelope-processor.js';
import { ProcessingEnvelope, ServiceRequest, ProcessingTask } from '../types/envelope.types.js';
import { Logger } from 'winston';
import { ThirdPartyService } from '../services/third-party-service.js';
import { StateManager } from '../core/state-manager.js';
import { executeCustomFunction, loadBuiltInCustomFunctions } from '../services/custom-functions.js';
import axios from 'axios';

export class ProcessingProcessor extends EnvelopeProcessor<ProcessingEnvelope> {
  private customFunctionsInitialized = false;

  constructor(
    logger: Logger,
    private thirdPartyService: ThirdPartyService,
    private stateManager: StateManager
  ) {
    super(logger);
    
    // Initialize custom functions on first instantiation
    if (!this.customFunctionsInitialized) {
      loadBuiltInCustomFunctions(this.logger);
      this.customFunctionsInitialized = true;
      this.logger.info(`✅ Custom functions loader initialized`);
    }
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
            if (taskIndex >= 0) {
              envelope.tasks[taskIndex] = updatedTask;
            }
            envelope.currentTask =
              updatedTask.status === 'in_progress' || updatedTask.status === 'pending_external'
                ? updatedTask.name
                : undefined;

            this.logger.info(
              `[TASK] Request ${request.id} - Task ${index + 1}/${envelope.tasks.length} "${updatedTask.name}" → ${updatedTask.status}`
            );

            // Save state after every task update
            this.stateManager.saveRequest(request);
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
          `[TASK] Request ${request.id} - Processing complete | Status: ${envelope.status}`
        );

        return envelope;
      })
    );
  }

  private processTask(request: ServiceRequest, task: ProcessingTask): Observable<ProcessingTask> {
    task.status = 'in_progress';
    task.startedAt = new Date().toISOString();

    this.logger.info(`[TASK] Executing "${task.name}" | Type: ${task.type || 'generic'}`);

    return this.executeTaskLogic(request, task).pipe(
      map(result => {
        if (result === 'failed') {
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
   * Supports: webhook, api_call, custom_function, and built-in functions
   */
  private executeTaskLogic(request: ServiceRequest, task: ProcessingTask): Observable<'completed' | 'failed'> {
    // Determine task type and execute accordingly
    if (task.type === 'webhook' && task.webhook) {
      return this.executeWebhookTask(request, task);
    } else if (task.type === 'api_call' && task.apiCall) {
      return this.executeApiCallTask(request, task);
    } else if (task.type === 'custom_function' && task.customFunction) {
      return this.executeCustomFunctionTask(request, task);
    } else if (task.type === 'built_in' && task.builtIn) {
      return this.executeBuiltInTask(request, task);
    } else {
      // Generic task - just mark as completed
      this.logger.debug(`⏭️  Skipping generic task "${task.name}" (no explicit type)`);
      return of('completed');
    }
  }

  /**
   * Execute webhook task: POST to external URL with retry logic
   */
  private executeWebhookTask(request: ServiceRequest, task: ProcessingTask): Observable<'completed' | 'failed'> {
    const webhookConfig = task.webhook!;
    const url = webhookConfig.url;
    const method = webhookConfig.method || 'POST';
    const timeoutMs = webhookConfig.timeout || 30000;
    const maxRetries = webhookConfig.retries || 3;

    this.logger.info(
      `🌐 Webhook task "${task.name}" | URL: ${url} | Method: ${method} | Retries: ${maxRetries}`
    );

    // Build payload with request context
    const payload = {
      requestId: request.id,
      serviceType: request.type,
      taskName: task.name,
      timestamp: new Date().toISOString(),
      requestParameters: request.envelopes?.request?.parameters || {},
    };

    return from(this.callWebhookWithRetry(url, method, payload, timeoutMs, maxRetries))
      .pipe(
        map(response => {
          this.logger.info(`✅ Webhook "${task.name}" succeeded | Status: ${response.status}`);
          task.webhookResponse = {
            status: response.status,
            data: response.data,
            timestamp: new Date().toISOString(),
          };
          return 'completed';
        })
      );
  }

  /**
   * Execute API call task: Make HTTP request to external API
   */
  private executeApiCallTask(request: ServiceRequest, task: ProcessingTask): Observable<'completed' | 'failed'> {
    const apiCallConfig = task.apiCall!;
    const url = apiCallConfig.url;
    const method = apiCallConfig.method || 'POST';
    const timeoutMs = apiCallConfig.timeout || 30000;
    const maxRetries = apiCallConfig.retries || 1;

    this.logger.info(
      `🔗 API call task "${task.name}" | URL: ${url} | Method: ${method}`
    );

    // Build payload with request context
    const payload = {
      requestId: request.id,
      serviceType: request.type,
      taskName: task.name,
      timestamp: new Date().toISOString(),
      requestParameters: request.envelopes?.request?.parameters || {},
      ...apiCallConfig.payload, // Merge any custom payload fields
    };

    return from(this.callApiWithRetry(url, method, payload, timeoutMs, maxRetries))
      .pipe(
        map(response => {
          this.logger.info(`✅ API call "${task.name}" succeeded | Status: ${response.status}`);
          task.apiResponse = {
            status: response.status,
            data: response.data,
            timestamp: new Date().toISOString(),
          };
          return 'completed';
        })
      );
  }

  /**
   * Execute custom function task
   */
  private executeCustomFunctionTask(request: ServiceRequest, task: ProcessingTask): Observable<'completed' | 'failed'> {
    const customFunctionConfig = task.customFunction!;
    const functionName = customFunctionConfig.function;

    this.logger.info(`⚡ Custom function task "${task.name}" | Function: ${functionName}`);

    return from(
      executeCustomFunction(functionName, {
        request,
        task,
        logger: this.logger,
      })
    ).pipe(
      map(result => {
        if (result.success) {
          this.logger.info(`✅ Custom function "${functionName}" succeeded`);
          task.customFunctionResponse = {
            success: true,
            data: result.data,
            timestamp: new Date().toISOString(),
          };
          return 'completed';
        } else {
          this.logger.error(`❌ Custom function "${functionName}" failed: ${result.error}`);
          task.customFunctionResponse = {
            success: false,
            error: result.error,
            timestamp: new Date().toISOString(),
          };
          return 'failed';
        }
      })
    );
  }

  /**
   * Call API with exponential backoff retry logic
   */
  private async callApiWithRetry(
    url: string,
    method: string,
    payload: any,
    timeoutMs: number,
    maxRetries: number,
    attempt: number = 1
  ): Promise<any> {
    try {
      this.logger.debug(`🔄 API attempt ${attempt}/${maxRetries} for ${url}`);

      const response = await axios({
        method: method.toLowerCase(),
        url,
        data: payload,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Retry': attempt.toString(),
          'X-Service-Envelope-Request': payload.requestId,
        },
      });

      return response;
    } catch (error: any) {
      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        this.logger.warn(
          `⏳ API attempt ${attempt} failed, retrying in ${backoffMs}ms | Error: ${error.message}`
        );

        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.callApiWithRetry(url, method, payload, timeoutMs, maxRetries, attempt + 1);
      } else {
        throw error;
      }
    }
  }

  /**
   * Call webhook with exponential backoff retry logic
   */
  private async callWebhookWithRetry(
    url: string,
    method: string,
    payload: any,
    timeoutMs: number,
    maxRetries: number,
    attempt: number = 1
  ): Promise<any> {
    try {
      this.logger.debug(`🔄 Webhook attempt ${attempt}/${maxRetries} for ${url}`);

      const response = await axios({
        method: method.toLowerCase(),
        url,
        data: payload,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Retry': attempt.toString(),
          'X-Service-Envelope-Request': payload.requestId,
        },
      });

      return response;
    } catch (error: any) {
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        this.logger.warn(
          `⏳ Webhook attempt ${attempt} failed, retrying in ${backoffMs}ms | Error: ${error.message}`
        );

        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.callWebhookWithRetry(url, method, payload, timeoutMs, maxRetries, attempt + 1);
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute built-in task: call predefined business logic function
   */
  private executeBuiltInTask(request: ServiceRequest, task: ProcessingTask): Observable<'completed' | 'failed'> {
    const builtInConfig = task.builtIn!;
    const functionName = builtInConfig.function;
    const parameters = builtInConfig.parameters || {};

    this.logger.info(`⚙️  Built-in task "${task.name}" | Function: ${functionName}`);

    // Execute built-in function based on name
    switch (functionName) {
      case 'verify_student_enrollment':
        return this.verifyStudentEnrollment(parameters);
      case 'verify_academic_standing':
        return this.verifyAcademicStanding(parameters);
      case 'validate_tor_content':
        return this.validateTORContent(parameters);
      case 'generate_room_assignment_details':
        return this.generateRoomAssignmentDetails(parameters);
      case 'validate_prerequisites':
        return this.validatePrerequisites(parameters);
      default:
        this.logger.warn(`⚠️  Unknown built-in function: ${functionName}`);
        return of('completed');
    }
  }

  // ============= Built-in Function Implementations =============

  private verifyStudentEnrollment(parameters: any): Observable<'completed' | 'failed'> {
    this.logger.info(`👤 Verifying student enrollment | Student: ${parameters.studentId}`);
    // Mock implementation - in production would query SIS
    return of('completed');
  }

  private verifyAcademicStanding(parameters: any): Observable<'completed' | 'failed'> {
    this.logger.info(`📊 Verifying academic standing | Student: ${parameters.studentId}`);
    // Mock implementation - in production would query academic records
    return of('completed');
  }

  private validateTORContent(parameters: any): Observable<'completed' | 'failed'> {
    this.logger.info(`📄 Validating TOR content | Type: ${parameters.documentType}`);
    // Mock implementation - in production would validate document
    return of('completed');
  }

  private generateRoomAssignmentDetails(parameters: any): Observable<'completed' | 'failed'> {
    this.logger.info(`🏠 Generating room assignment details | Semester: ${parameters.semester}`);
    // Mock implementation - in production would generate assignment
    return of('completed');
  }

  private validatePrerequisites(parameters: any): Observable<'completed' | 'failed'> {
    this.logger.info(`✓ Validating prerequisites | Course: ${parameters.courseCode}`);
    // Mock implementation - in production would check prerequisites
    return of('completed');
  }
}
