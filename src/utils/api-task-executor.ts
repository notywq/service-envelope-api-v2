/**
 * API Task Executor Utility
 * Handles execution of API call tasks with parameter substitution
 * Used by processing envelope processor
 */

import { Logger } from 'winston';
import axios, { AxiosError, AxiosResponse } from 'axios';
import { ProcessingTask, ServiceRequest } from '../types/envelope.types.js';

export class APITaskExecutor {
  constructor(private logger: Logger) {}

  /**
   * Execute a single API call task with parameter substitution
   * Supports GET, POST, PUT, DELETE, PATCH
   */
  async executeTask(
    task: ProcessingTask,
    request: ServiceRequest
  ): Promise<ProcessingTask> {
    try {
      const startTime = Date.now();
      task.status = 'in_progress';
      task.startedAt = new Date().toISOString();

      this.logger.info(
        `[PROCESSING-TASK] Starting: ${task.name} (${task.method} ${task.url})`
      );

      // Substitute parameters in URL, headers, payload, and query params
      const url = this.substituteParameters(task.url, request);
      const headers = this.substituteParametersInObject(task.headers || {}, request);
      const payload = this.substituteParametersInObject(task.payload || {}, request);
      const queryParams = this.substituteParametersInObject(task.queryParams || {}, request);

      this.logger.debug(
        `[PROCESSING-TASK] Substituted URL: ${url}`
      );

      // Build query string from queryParams
      const queryString = new URLSearchParams(queryParams).toString();
      const finalUrl = queryString ? `${url}?${queryString}` : url;

      // Execute API call
      const timeout = task.timeout || 30000;
      const maxRetries = task.retries || 3;
      const successCodes = task.successCodes || [200, 201, 204];

      let lastError: AxiosError | null = null;
      let response: AxiosResponse | null = null;

      // Retry logic
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.logger.debug(
            `[PROCESSING-TASK] Attempt ${attempt}/${maxRetries} for ${task.name}`
          );

          response = await axios({
            method: task.method.toLowerCase() as any,
            url: finalUrl,
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
            data: ['POST', 'PUT', 'PATCH'].includes(task.method) ? payload : undefined,
            timeout,
            validateStatus: () => true, // Don't throw on any status
          });

          if (response && successCodes.includes(response.status)) {
            task.status = 'completed';
            task.responseStatus = response.status;
            task.responseData = response.data;
            task.completedAt = new Date().toISOString();

            const duration = Date.now() - startTime;
            this.logger.info(
              `[PROCESSING-TASK] ✅ Completed: ${task.name} (${response.status} in ${duration}ms)`
            );
            return task;
          } else if (response) {
            // Non-success status code
            lastError = new AxiosError(
              `HTTP ${response.status}`,
              'EHTTP',
              {} as any,
              {} as any,
              response
            );

            if (attempt < maxRetries) {
              this.logger.warn(
                `[PROCESSING-TASK] ⚠️ Attempt ${attempt} failed with HTTP ${response.status}, retrying...`
              );
              await this.delay(1000 * attempt); // Exponential backoff
              continue;
            }
          }
        } catch (error) {
          lastError = error as AxiosError;

          if (attempt < maxRetries) {
            this.logger.warn(
              `[PROCESSING-TASK] ⚠️ Attempt ${attempt} failed: ${(error as Error).message}, retrying...`
            );
            await this.delay(1000 * attempt); // Exponential backoff
            continue;
          }
        }
      }

      // All retries exhausted
      task.status = 'failed';
      task.responseStatus = response?.status;
      task.responseError = lastError
        ? `${lastError.message}${response ? ` (HTTP ${response.status})` : ''}`
        : 'Max retries exceeded';
      task.completedAt = new Date().toISOString();

      const duration = Date.now() - startTime;
      this.logger.error(
        `[PROCESSING-TASK] ❌ Failed: ${task.name} - ${task.responseError} (${duration}ms)`
      );

      return task;
    } catch (error) {
      task.status = 'failed';
      task.responseError = (error as Error).message;
      task.completedAt = new Date().toISOString();

      this.logger.error(
        `[PROCESSING-TASK] ❌ Exception in task ${task.name}: ${(error as Error).message}`
      );

      return task;
    }
  }

  /**
   * Replace {{parameterName}} placeholders with actual values in a string
   */
  private substituteParameters(text: string, request: ServiceRequest): string {
    let result = text;

    // System variables
    const systemVariables: Record<string, string> = {
      requestId: request.id,
      currentTimestamp: new Date().toISOString(),
    };

    // Replace system variables
    Object.entries(systemVariables).forEach(([key, value]) => {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(placeholder, String(value || ''));
    });

    // Replace request parameters
    if (request.envelopes.request.parameters) {
      Object.entries(request.envelopes.request.parameters).forEach(([key, value]) => {
        const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        const stringValue = typeof value === 'string' ? value : (value ? String(value) : '');
        result = result.replace(placeholder, stringValue);
      });
    }

    return result;
  }

  /**
   * Recursively substitute parameters in an object's string values
   */
  private substituteParametersInObject(
    obj: Record<string, any>,
    request: ServiceRequest
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.substituteParameters(value, request);
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.substituteParametersInObject(value, request);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Sleep utility for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
