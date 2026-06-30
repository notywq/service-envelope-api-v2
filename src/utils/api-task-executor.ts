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

  private taskLog(
    message: string,
    fields: Record<string, unknown> = {},
    level: 'log' | 'warn' | 'error' = 'log'
  ): void {
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
    const line = detail ? `[Processing Task] ${message} | ${detail}` : `[Processing Task] ${message}`;
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

      this.taskLog('started', {
        request: request.id,
        task: task.name,
        method: task.method,
        url: task.url,
      });

      // Substitute parameters in URL, headers, payload, and query params
      const url = this.substituteParameters(task.url, request);
      const headers = this.sanitizeHeaders(this.substituteParametersInObject(task.headers || {}, request));
      const payload = this.substituteParametersInObject(task.payload || {}, request);
      const queryParams = this.substituteParametersInObject(task.queryParams || {}, request);

      this.taskLog('url resolved', { request: request.id, task: task.name, url });

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
          this.taskLog('attempt', { request: request.id, task: task.name, attempt, maxRetries });

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
            this.taskLog('completed', {
              request: request.id,
              task: task.name,
              status: response.status,
              durationMs: duration,
            });
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
              this.taskLog('attempt failed; retrying', {
                request: request.id,
                task: task.name,
                attempt,
                status: response.status,
              }, 'warn');
              await this.delay(1000 * attempt); // Exponential backoff
              continue;
            }
          }
        } catch (error) {
          lastError = error as AxiosError;

          if (attempt < maxRetries) {
            this.taskLog('attempt failed; retrying', {
              request: request.id,
              task: task.name,
              attempt,
              error: (error as Error).message,
            }, 'warn');
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
      this.taskLog('failed', {
        request: request.id,
        task: task.name,
        error: task.responseError,
        durationMs: duration,
      }, 'error');
      return task;
    } catch (error) {
      task.status = 'failed';
      task.responseError = (error as Error).message;
      task.completedAt = new Date().toISOString();

      this.taskLog('exception', {
        request: request.id,
        task: task.name,
        error: (error as Error).message,
      }, 'error');
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

  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    Object.entries(headers).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }

      const stringValue = String(value).trim();
      if (!stringValue || /\{\{\w+\}\}/.test(stringValue)) {
        this.logger.warn(
          `[PROCESSING-TASK] Omitting header "${key}" because it contains an unresolved template value`
        );
        return;
      }

      if (key.toLowerCase() === 'authorization' && /^bearer\s*$/i.test(stringValue)) {
        this.logger.warn('[PROCESSING-TASK] Omitting empty Authorization bearer header');
        return;
      }

      sanitized[key] = value;
    });

    return sanitized;
  }

  /**
   * Sleep utility for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
