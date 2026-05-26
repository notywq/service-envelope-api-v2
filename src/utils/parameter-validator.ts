/**
 * Parameter Validation Utility
 * Dynamically validates request parameters against service definition schemas
 * Supports all parameter types: String, Number, Boolean, Date, Dropdown, Radio, Checkboxes
 */

import { Logger } from 'winston';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface ParameterSchema {
  type: string;
  required?: boolean;
  description?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  step?: number;
  format?: string;
  options?: Array<{ label: string; value: string } | string>;
  minSelected?: number;
  maxSelected?: number;
  default?: any;
  searchable?: boolean;
  clearable?: boolean;
}

export class ParameterValidator {
  constructor(private logger: Logger) {}

  /**
   * Validate request parameters against service definition schema
   * @param parameters - User-provided parameters
   * @param serviceDefinition - Complete service definition with parameter schema
   * @returns Validation result with detailed errors
   */
  validateAgainstSchema(parameters: Record<string, any>, serviceDefinition: any): ValidationResult {
    const errors: string[] = [];

    // Basic input validation
    if (!parameters || typeof parameters !== 'object') {
      errors.push('Parameters must be an object');
      return { isValid: false, errors };
    }

    if (!serviceDefinition?.envelopes?.request?.parameters) {
      errors.push('Service definition missing request envelope parameters');
      return { isValid: false, errors };
    }

    const parameterSchema = serviceDefinition.envelopes.request.parameters;

    // Validate each parameter in the schema
    for (const [paramName, schema] of Object.entries(parameterSchema)) {
      const paramSchema = schema as ParameterSchema;
      const paramValue = parameters[paramName];

      // Check required fields
      if (paramSchema.required && (paramValue === undefined || paramValue === null || paramValue === '')) {
        errors.push(`${paramName} is required`);
        continue;
      }

      // Skip validation if not required and not provided
      if (!paramSchema.required && (paramValue === undefined || paramValue === null || paramValue === '')) {
        continue;
      }

      // Validate based on type
      const typeError = this.validateParameterType(paramName, paramValue, paramSchema);
      if (typeError) {
        errors.push(typeError);
      }
    }

    if (errors.length > 0) {
      this.logger.warn(`[VALIDATION-FAIL] Service: ${serviceDefinition.serviceId} | Errors: ${errors.join(' | ')}`);
      return { isValid: false, errors };
    }

    this.logger.debug(`[VALIDATION-PASS] Service: ${serviceDefinition.serviceId}`);
    return { isValid: true, errors: [] };
  }

  /**
   * Validate a single parameter against its schema
   */
  private validateParameterType(paramName: string, value: any, schema: ParameterSchema): string | null {
    const type = schema.type;

    switch (type) {
      case 'String':
        return this.validateString(paramName, value, schema);
      case 'Number':
        return this.validateNumber(paramName, value, schema);
      case 'Boolean':
        return this.validateBoolean(paramName, value, schema);
      case 'Date':
        return this.validateDate(paramName, value, schema);
      case 'Dropdown':
        return this.validateDropdown(paramName, value, schema);
      case 'Radio':
        return this.validateRadio(paramName, value, schema);
      case 'Checkboxes':
        return this.validateCheckboxes(paramName, value, schema);
      default:
        return `${paramName}: Unknown parameter type "${type}"`;
    }
  }

  private validateString(paramName: string, value: any, schema: ParameterSchema): string | null {
    if (typeof value !== 'string') {
      return `${paramName}: Expected string, got ${typeof value}`;
    }

    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${paramName}: Minimum length is ${schema.minLength}`;
    }

    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${paramName}: Maximum length is ${schema.maxLength}`;
    }

    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        return `${paramName}: Invalid format (pattern: ${schema.pattern})`;
      }
    }

    return null;
  }

  private validateNumber(paramName: string, value: any, schema: ParameterSchema): string | null {
    if (typeof value !== 'number' || isNaN(value)) {
      return `${paramName}: Expected number, got ${typeof value}`;
    }

    if (schema.min !== undefined && value < schema.min) {
      return `${paramName}: Minimum value is ${schema.min}`;
    }

    if (schema.max !== undefined && value > schema.max) {
      return `${paramName}: Maximum value is ${schema.max}`;
    }

    return null;
  }

  private validateBoolean(paramName: string, value: any, schema: ParameterSchema): string | null {
    if (typeof value !== 'boolean') {
      return `${paramName}: Expected boolean, got ${typeof value}`;
    }
    return null;
  }

  private validateDate(paramName: string, value: any, schema: ParameterSchema): string | null {
    if (typeof value !== 'string') {
      return `${paramName}: Expected date string, got ${typeof value}`;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(value)) {
      return `${paramName}: Invalid date format (expected YYYY-MM-DD)`;
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return `${paramName}: Invalid date`;
    }

    if (schema.min) {
      const minDate = new Date(schema.min);
      if (date < minDate) {
        return `${paramName}: Date must be after ${schema.min}`;
      }
    }

    if (schema.max) {
      const maxDate = new Date(schema.max);
      if (date > maxDate) {
        return `${paramName}: Date must be before ${schema.max}`;
      }
    }

    return null;
  }

  private validateDropdown(paramName: string, value: any, schema: ParameterSchema): string | null {
    if (typeof value !== 'string') {
      return `${paramName}: Expected string, got ${typeof value}`;
    }

    if (!schema.options || schema.options.length === 0) {
      return `${paramName}: Schema missing options`;
    }

    const validValues = schema.options.map((opt) => (typeof opt === 'string' ? opt : opt.value));
    if (!validValues.includes(value)) {
      return `${paramName}: Invalid value. Expected one of: ${validValues.join(', ')}`;
    }

    return null;
  }

  private validateRadio(paramName: string, value: any, schema: ParameterSchema): string | null {
    if (typeof value !== 'string') {
      return `${paramName}: Expected string, got ${typeof value}`;
    }

    if (!schema.options || schema.options.length === 0) {
      return `${paramName}: Schema missing options`;
    }

    const validValues = schema.options.map((opt) => (typeof opt === 'string' ? opt : opt.value));
    if (!validValues.includes(value)) {
      return `${paramName}: Invalid value. Expected one of: ${validValues.join(', ')}`;
    }

    return null;
  }

  private validateCheckboxes(paramName: string, value: any, schema: ParameterSchema): string | null {
    if (!Array.isArray(value)) {
      return `${paramName}: Expected array, got ${typeof value}`;
    }

    if (!schema.options || schema.options.length === 0) {
      return `${paramName}: Schema missing options`;
    }

    const validValues = schema.options.map((opt) => (typeof opt === 'string' ? opt : opt.value));

    // Validate each selected value
    for (const selectedValue of value) {
      if (!validValues.includes(selectedValue)) {
        return `${paramName}: Invalid value "${selectedValue}". Expected one of: ${validValues.join(', ')}`;
      }
    }

    // Check minSelected constraint
    if (schema.minSelected !== undefined && value.length < schema.minSelected) {
      return `${paramName}: Minimum ${schema.minSelected} selections required`;
    }

    // Check maxSelected constraint
    if (schema.maxSelected !== undefined && value.length > schema.maxSelected) {
      return `${paramName}: Maximum ${schema.maxSelected} selections allowed`;
    }

    return null;
  }
}
