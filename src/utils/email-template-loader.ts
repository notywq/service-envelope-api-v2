/**
 * Email Template Loader & Parameter Substitution Utility
 * Handles loading templates from MongoDB and performing parameter substitution
 * Shared across all envelope processors for consistent template handling
 */

import { Logger } from 'winston';
import { StateManager } from '../core/state-manager.js';
import { ServiceRequest } from '../types/envelope.types.js';

export class EmailTemplateLoader {
  constructor(
    private stateManager: StateManager,
    private logger: Logger
  ) {}

  /**
   * Fetch email template by ID and perform parameter substitution
   * @param templateId - Template identifier (e.g., SERV-3-approval-start)
   * @param request - Service request containing parameters for substitution
   * @param envelopeType - Type of envelope (for logging)
   * @returns Object with subject and htmlBody, or null if template not found
   */
  async fetchAndRenderTemplate(
    templateId: string,
    request: ServiceRequest,
    envelopeType: string
  ): Promise<{ subject: string; htmlBody: string } | null> {
    try {
      // Log lookup attempt
      this.logger.info(
        `[${envelopeType.toUpperCase()}-EMAIL-TEMPLATE] Looking up template: ${templateId}`
      );

      // Fetch template from MongoDB
      const template = await this.stateManager.getEmailTemplate(templateId);

      if (!template) {
        this.logger.warn(
          `[${envelopeType.toUpperCase()}-EMAIL-TEMPLATE] Template NOT FOUND: ${templateId}`
        );
        return null;
      }

      this.logger.info(
        `[${envelopeType.toUpperCase()}-EMAIL-TEMPLATE] Template found: ${templateId}`
      );

      // Perform parameter substitution
      const subject = this.substituteParameters(template.subject, request);
      const htmlBody = this.substituteParameters(template.htmlBody, request);

      this.logger.info(
        `[${envelopeType.toUpperCase()}-EMAIL-TEMPLATE] Parameters substituted and ready to send`
      );

      return { subject, htmlBody };
    } catch (error) {
      this.logger.error(
        `[${envelopeType.toUpperCase()}-EMAIL-TEMPLATE] Error loading template ${templateId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Replace all {{parameterName}} placeholders with actual values
   * Supports system variables and all request parameters
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
   * Get placeholder values for a request (useful for email preview)
   */
  getPlaceholderValues(request: ServiceRequest): Record<string, string> {
    const values: Record<string, string> = {
      requestId: request.id,
      currentTimestamp: new Date().toISOString(),
    };

    if (request.envelopes.request.parameters) {
      Object.entries(request.envelopes.request.parameters).forEach(([key, value]) => {
        values[key] = typeof value === 'string' ? value : (value ? String(value) : '');
      });
    }

    return values;
  }
}
