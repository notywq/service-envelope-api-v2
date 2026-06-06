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
   * @param extraContext - Optional extra key/value pairs for additional {{variable}} substitution
   * @returns Object with subject and htmlBody, or null if template not found
   */
  async fetchAndRenderTemplate(
    templateId: string,
    request: ServiceRequest,
    envelopeType: string,
    extraContext?: Record<string, string>
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

      const serviceDefinition = await this.stateManager.getServiceDefinitionByType(request.type);
      const serviceContext = {
        serviceType: serviceDefinition?.name || request.type,
        serviceName: serviceDefinition?.name || request.type,
        serviceDefinitionType: request.type,
      };

      // Perform parameter substitution
      let subject = this.substituteParameters(template.subject, request, serviceContext);
      let htmlBody = this.substituteParameters(template.htmlBody, request, serviceContext);

      // Apply any extra context variables (e.g., documentLinks from delivery processor)
      if (extraContext) {
        Object.entries(extraContext).forEach(([key, value]) => {
          const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
          subject = subject.replace(placeholder, String(value ?? ''));
          htmlBody = htmlBody.replace(placeholder, String(value ?? ''));
        });
      }

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
  private substituteParameters(
    text: string,
    request: ServiceRequest,
    extraBaseContext?: Record<string, string>
  ): string {
    let result = text;

    // System variables
    const systemVariables: Record<string, string> = {
      requestId: request.id,
      currentTimestamp: new Date().toISOString(),
      ...(extraBaseContext || {}),
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
      serviceType: request.type,
      serviceName: request.type,
      serviceDefinitionType: request.type,
    };

    if (request.envelopes.request.parameters) {
      Object.entries(request.envelopes.request.parameters).forEach(([key, value]) => {
        values[key] = typeof value === 'string' ? value : (value ? String(value) : '');
      });
    }

    return values;
  }
}
