/**
 * Parameter Validation Utility
 * Dynamically validates request parameters against service definition schemas
 * Supports all parameter types: String, Number, Boolean, Date, Dropdown, Radio, Checkboxes
 */

import { Logger } from 'winston';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  details?: ValidationErrorDetail[];
}

export interface ValidationErrorDetail {
  field: string;
  rule: string;
  message: string;
  expectedType?: string;
  receivedType?: string;
  receivedValue?: any;
  allowedValues?: any[];
  constraints?: Record<string, any>;
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
    const details: ValidationErrorDetail[] = [];
    const parameterSchema =
      serviceDefinition?.envelopes?.request?.parameters ||
      serviceDefinition?.definition?.envelopes?.request?.parameters;

    // Basic input validation
    if (!parameters || typeof parameters !== 'object') {
      const message = 'Parameters must be an object';
      errors.push(message);
      details.push({
        field: 'parameters',
        rule: 'type',
        message,
        expectedType: 'object',
        receivedType: typeof parameters,
        receivedValue: parameters,
      });
      return { isValid: false, errors, details };
    }

    if (!parameterSchema) {
      const message = 'Service definition missing request envelope parameters';
      errors.push(message);
      details.push({
        field: 'serviceDefinition.envelopes.request.parameters|serviceDefinition.definition.envelopes.request.parameters',
        rule: 'schema_missing',
        message,
      });
      return { isValid: false, errors, details };
    }

    // Validate each parameter in the schema
    for (const [paramName, schema] of Object.entries(parameterSchema)) {
      const paramSchema = schema as ParameterSchema;
      const paramValue = parameters[paramName];

      // Check required fields
      if (paramSchema.required && (paramValue === undefined || paramValue === null || paramValue === '')) {
        const message = `${paramName} is required`;
        errors.push(message);
        details.push({
          field: paramName,
          rule: 'required',
          message,
          expectedType: paramSchema.type,
          receivedType: paramValue === null ? 'null' : typeof paramValue,
          receivedValue: paramValue,
        });
        continue;
      }

      // Skip validation if not required and not provided
      if (!paramSchema.required && (paramValue === undefined || paramValue === null || paramValue === '')) {
        continue;
      }

      // Validate based on type
      const typeError = this.validateParameterType(paramName, paramValue, paramSchema);
      if (typeError) {
        errors.push(typeError.message);
        details.push(typeError);
      }
    }

    if (errors.length > 0) {
      this.logger.warn(
        `[VALIDATION-FAIL] Service: ${serviceDefinition.serviceId || serviceDefinition.id || serviceDefinition.type} | Errors: ${errors.join(' | ')}`
      );
      return { isValid: false, errors, details };
    }

    this.logger.debug(
      `[VALIDATION-PASS] Service: ${serviceDefinition.serviceId || serviceDefinition.id || serviceDefinition.type}`
    );
    return { isValid: true, errors: [], details: [] };
  }

  /**
   * Validate a single parameter against its schema
   */
  private validateParameterType(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
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
        return {
          field: paramName,
          rule: 'unknown_type',
          message: `${paramName}: Unknown parameter type "${type}"`,
          expectedType: type,
          receivedType: typeof value,
          receivedValue: value,
        };
    }
  }

  private validateString(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
    if (typeof value !== 'string') {
      return {
        field: paramName,
        rule: 'type',
        message: `${paramName}: Expected string, got ${typeof value}`,
        expectedType: 'string',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return {
        field: paramName,
        rule: 'minLength',
        message: `${paramName}: Minimum length is ${schema.minLength}`,
        expectedType: 'string',
        receivedType: typeof value,
        receivedValue: value,
        constraints: { minLength: schema.minLength },
      };
    }

    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return {
        field: paramName,
        rule: 'maxLength',
        message: `${paramName}: Maximum length is ${schema.maxLength}`,
        expectedType: 'string',
        receivedType: typeof value,
        receivedValue: value,
        constraints: { maxLength: schema.maxLength },
      };
    }

    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        return {
          field: paramName,
          rule: 'pattern',
          message: `${paramName}: Invalid format (pattern: ${schema.pattern})`,
          expectedType: 'string',
          receivedType: typeof value,
          receivedValue: value,
          constraints: { pattern: schema.pattern },
        };
      }
    }

    return null;
  }

  private validateNumber(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
    if (typeof value !== 'number' || isNaN(value)) {
      return {
        field: paramName,
        rule: 'type',
        message: `${paramName}: Expected number, got ${typeof value}`,
        expectedType: 'number',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    if (schema.min !== undefined && value < schema.min) {
      return {
        field: paramName,
        rule: 'min',
        message: `${paramName}: Minimum value is ${schema.min}`,
        expectedType: 'number',
        receivedType: typeof value,
        receivedValue: value,
        constraints: { min: schema.min },
      };
    }

    if (schema.max !== undefined && value > schema.max) {
      return {
        field: paramName,
        rule: 'max',
        message: `${paramName}: Maximum value is ${schema.max}`,
        expectedType: 'number',
        receivedType: typeof value,
        receivedValue: value,
        constraints: { max: schema.max },
      };
    }

    return null;
  }

  private validateBoolean(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
    if (typeof value !== 'boolean') {
      return {
        field: paramName,
        rule: 'type',
        message: `${paramName}: Expected boolean, got ${typeof value}`,
        expectedType: 'boolean',
        receivedType: typeof value,
        receivedValue: value,
      };
    }
    return null;
  }

  private validateDate(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
    if (typeof value !== 'string') {
      return {
        field: paramName,
        rule: 'type',
        message: `${paramName}: Expected date string, got ${typeof value}`,
        expectedType: 'string (YYYY-MM-DD)',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(value)) {
      return {
        field: paramName,
        rule: 'format',
        message: `${paramName}: Invalid date format (expected YYYY-MM-DD)`,
        expectedType: 'string (YYYY-MM-DD)',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return {
        field: paramName,
        rule: 'date',
        message: `${paramName}: Invalid date`,
        expectedType: 'valid date',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    if (schema.min) {
      const minDate = new Date(schema.min);
      if (date < minDate) {
        return {
          field: paramName,
          rule: 'minDate',
          message: `${paramName}: Date must be after ${schema.min}`,
          expectedType: 'date',
          receivedType: typeof value,
          receivedValue: value,
          constraints: { min: schema.min },
        };
      }
    }

    if (schema.max) {
      const maxDate = new Date(schema.max);
      if (date > maxDate) {
        return {
          field: paramName,
          rule: 'maxDate',
          message: `${paramName}: Date must be before ${schema.max}`,
          expectedType: 'date',
          receivedType: typeof value,
          receivedValue: value,
          constraints: { max: schema.max },
        };
      }
    }

    return null;
  }

  private validateDropdown(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
    if (typeof value !== 'string') {
      return {
        field: paramName,
        rule: 'type',
        message: `${paramName}: Expected string, got ${typeof value}`,
        expectedType: 'string',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    if (!schema.options || schema.options.length === 0) {
      return {
        field: paramName,
        rule: 'schema_missing_options',
        message: `${paramName}: Schema missing options`,
      };
    }

    const validValues = schema.options.map((opt) => (typeof opt === 'string' ? opt : opt.value));
    if (!validValues.includes(value)) {
      return {
        field: paramName,
        rule: 'enum',
        message: `${paramName}: Invalid value. Expected one of: ${validValues.join(', ')}`,
        expectedType: 'string',
        receivedType: typeof value,
        receivedValue: value,
        allowedValues: validValues,
      };
    }

    return null;
  }

  private validateRadio(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
    if (typeof value !== 'string') {
      return {
        field: paramName,
        rule: 'type',
        message: `${paramName}: Expected string, got ${typeof value}`,
        expectedType: 'string',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    if (!schema.options || schema.options.length === 0) {
      return {
        field: paramName,
        rule: 'schema_missing_options',
        message: `${paramName}: Schema missing options`,
      };
    }

    const validValues = schema.options.map((opt) => (typeof opt === 'string' ? opt : opt.value));
    if (!validValues.includes(value)) {
      return {
        field: paramName,
        rule: 'enum',
        message: `${paramName}: Invalid value. Expected one of: ${validValues.join(', ')}`,
        expectedType: 'string',
        receivedType: typeof value,
        receivedValue: value,
        allowedValues: validValues,
      };
    }

    return null;
  }

  private validateCheckboxes(paramName: string, value: any, schema: ParameterSchema): ValidationErrorDetail | null {
    if (!Array.isArray(value)) {
      return {
        field: paramName,
        rule: 'type',
        message: `${paramName}: Expected array, got ${typeof value}`,
        expectedType: 'array',
        receivedType: typeof value,
        receivedValue: value,
      };
    }

    if (!schema.options || schema.options.length === 0) {
      return {
        field: paramName,
        rule: 'schema_missing_options',
        message: `${paramName}: Schema missing options`,
      };
    }

    const validValues = schema.options.map((opt) => (typeof opt === 'string' ? opt : opt.value));

    // Validate each selected value
    for (const selectedValue of value) {
      if (!validValues.includes(selectedValue)) {
        return {
          field: paramName,
          rule: 'enum',
          message: `${paramName}: Invalid value "${selectedValue}". Expected one of: ${validValues.join(', ')}`,
          expectedType: 'array',
          receivedType: 'array',
          receivedValue: value,
          allowedValues: validValues,
        };
      }
    }

    // Check minSelected constraint
    if (schema.minSelected !== undefined && value.length < schema.minSelected) {
      return {
        field: paramName,
        rule: 'minSelected',
        message: `${paramName}: Minimum ${schema.minSelected} selections required`,
        expectedType: 'array',
        receivedType: 'array',
        receivedValue: value,
        constraints: { minSelected: schema.minSelected },
      };
    }

    // Check maxSelected constraint
    if (schema.maxSelected !== undefined && value.length > schema.maxSelected) {
      return {
        field: paramName,
        rule: 'maxSelected',
        message: `${paramName}: Maximum ${schema.maxSelected} selections allowed`,
        expectedType: 'array',
        receivedType: 'array',
        receivedValue: value,
        constraints: { maxSelected: schema.maxSelected },
      };
    }

    return null;
  }
}
