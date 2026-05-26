/**
 * Parameter Schema Type Definitions
 * Enforces the structure of request parameters in service YAML definitions
 */

/**
 * Base parameter type with common properties
 */
export interface BaseParameter {
  required?: boolean;
  description?: string;
  default?: any;
}

/**
 * Simple scalar types
 */
export interface StringParameter extends BaseParameter {
  type: 'String';
  minLength?: number;
  maxLength?: number;
  pattern?: string; // Regex pattern
}

export interface NumberParameter extends BaseParameter {
  type: 'Number';
  min?: number;
  max?: number;
  step?: number;
}

export interface BooleanParameter extends BaseParameter {
  type: 'Boolean';
}

export interface DateParameter extends BaseParameter {
  type: 'Date';
  format?: 'YYYY-MM-DD' | 'DD-MM-YYYY' | 'MM-DD-YYYY' | 'ISO8601';
  min?: string; // Earlier date allowed
  max?: string; // Latest date allowed
}

/**
 * Selection types with options
 */
export interface DropdownParameter extends BaseParameter {
  type: 'Dropdown';
  options: string[] | DropdownOption[];
  clearable?: boolean;
  searchable?: boolean;
}

export interface RadioParameter extends BaseParameter {
  type: 'Radio';
  options: string[] | RadioOption[];
}

export interface CheckboxesParameter extends BaseParameter {
  type: 'Checkboxes';
  options: string[] | CheckboxOption[];
  minSelected?: number;
  maxSelected?: number;
}

/**
 * Option objects for complex selections
 */
export interface DropdownOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface RadioOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface CheckboxOption {
  label: string;
  value: string;
  disabled?: boolean;
}

/**
 * Union type for all parameter types
 */
export type ParameterSchema =
  | StringParameter
  | NumberParameter
  | BooleanParameter
  | DateParameter
  | DropdownParameter
  | RadioParameter
  | CheckboxesParameter;

/**
 * Service parameter definitions map
 * Maps parameter name to its schema definition
 */
export type ParameterDefinitions = Record<string, ParameterSchema>;

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate parameter value against schema
 */
export function validateParameter(
  paramName: string,
  value: any,
  schema: ParameterSchema
): ValidationResult {
  const errors: string[] = [];

  // Check required
  if (schema.required && (value === null || value === undefined || value === '')) {
    errors.push(`Parameter '${paramName}' is required but not provided`);
    return { valid: false, errors };
  }

  // If not required and empty, pass
  if (!schema.required && (value === null || value === undefined || value === '')) {
    return { valid: true, errors: [] };
  }

  switch (schema.type) {
    case 'String':
      if (typeof value !== 'string') {
        errors.push(`Parameter '${paramName}' must be a string, got ${typeof value}`);
      } else {
        if (schema.minLength && value.length < schema.minLength) {
          errors.push(`Parameter '${paramName}' must be at least ${schema.minLength} characters`);
        }
        if (schema.maxLength && value.length > schema.maxLength) {
          errors.push(`Parameter '${paramName}' must be at most ${schema.maxLength} characters`);
        }
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
          errors.push(`Parameter '${paramName}' does not match required pattern: ${schema.pattern}`);
        }
      }
      break;

    case 'Number':
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`Parameter '${paramName}' must be a number, got ${typeof value}`);
      } else {
        if (schema.min !== undefined && value < schema.min) {
          errors.push(`Parameter '${paramName}' must be at least ${schema.min}`);
        }
        if (schema.max !== undefined && value > schema.max) {
          errors.push(`Parameter '${paramName}' must be at most ${schema.max}`);
        }
      }
      break;

    case 'Boolean':
      if (typeof value !== 'boolean') {
        errors.push(`Parameter '${paramName}' must be a boolean, got ${typeof value}`);
      }
      break;

    case 'Date':
      // Accept string or Date object
      const dateValue = typeof value === 'string' ? new Date(value) : value;
      if (!(dateValue instanceof Date) || isNaN(dateValue.getTime())) {
        errors.push(`Parameter '${paramName}' must be a valid date`);
      } else {
        if (schema.min) {
          const minDate = new Date(schema.min);
          if (dateValue < minDate) {
            errors.push(`Parameter '${paramName}' must be on or after ${schema.min}`);
          }
        }
        if (schema.max) {
          const maxDate = new Date(schema.max);
          if (dateValue > maxDate) {
            errors.push(`Parameter '${paramName}' must be on or before ${schema.max}`);
          }
        }
      }
      break;

    case 'Dropdown':
      const dropdownValues = schema.options.map(opt => typeof opt === 'string' ? opt : opt.value);
      if (!dropdownValues.includes(value)) {
        errors.push(`Parameter '${paramName}' must be one of: ${dropdownValues.join(', ')}`);
      }
      break;

    case 'Radio':
      const radioValues = schema.options.map(opt => typeof opt === 'string' ? opt : opt.value);
      if (!radioValues.includes(value)) {
        errors.push(`Parameter '${paramName}' must be one of: ${radioValues.join(', ')}`);
      }
      break;

    case 'Checkboxes':
      if (!Array.isArray(value)) {
        errors.push(`Parameter '${paramName}' must be an array`);
      } else {
        const checkboxValues = schema.options.map(opt => typeof opt === 'string' ? opt : opt.value);
        const invalidValues = value.filter(v => !checkboxValues.includes(v));
        if (invalidValues.length > 0) {
          errors.push(`Parameter '${paramName}' contains invalid values: ${invalidValues.join(', ')}`);
        }
        if (schema.minSelected && value.length < schema.minSelected) {
          errors.push(`Parameter '${paramName}' requires at least ${schema.minSelected} selections`);
        }
        if (schema.maxSelected && value.length > schema.maxSelected) {
          errors.push(`Parameter '${paramName}' allows at most ${schema.maxSelected} selections`);
        }
      }
      break;

    default:
      errors.push(`Unknown parameter type: ${(schema as any).type}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all parameters against their schemas
 */
export function validateAllParameters(
  params: Record<string, any>,
  schemas: ParameterDefinitions
): ValidationResult {
  const allErrors: string[] = [];

  // Check for unknown parameters
  Object.keys(params).forEach(key => {
    if (!schemas[key]) {
      allErrors.push(`Unknown parameter: '${key}'`);
    }
  });

  // Validate each parameter
  Object.entries(schemas).forEach(([paramName, schema]) => {
    const value = params[paramName];
    const result = validateParameter(paramName, value, schema);
    if (!result.valid) {
      allErrors.push(...result.errors);
    }
  });

  return { valid: allErrors.length === 0, errors: allErrors };
}
