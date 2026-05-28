/**
 * Service Definition Schema Validator
 * Fetches schema from MongoDB for validation
 * Used by backend (admin routes) and exposed to Phase 2 UI for builder validation
 */

// @ts-ignore - Using default exports from ESM packages
import AjvPackage from 'ajv';
import formats from 'ajv-formats';

// Get Ajv constructor
const Ajv = AjvPackage.default || AjvPackage;

// Module-level schema cache (fetched from MongoDB on initialization)
let cachedSchema: any = null;
let validateSchema: any = null;
let ajv: any = null;

/**
 * Initialize validator with schema from MongoDB
 * Must be called once at server startup before using validator functions
 */
export function initializeValidator(schema: any): void {
  cachedSchema = schema;
  
  // Initialize AJV validator with formats support
  ajv = new Ajv({
    allErrors: true,
    verbose: true,
  });
  
  // Apply formats to ajv instance
  const formatsFunc = formats.default || formats;
  formatsFunc(ajv);
  
  // Compile schema for validation
  validateSchema = ajv.compile(cachedSchema);
}

/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    path: string;
    message: string;
    keyword: string;
    params?: Record<string, any>;
  }>;
}

/**
 * Validate a service definition YAML object against the schema
 * @param serviceDefinition - Parsed YAML object
 * @returns ValidationResult with details if invalid
 */
export function validateServiceDefinition(serviceDefinition: any): ValidationResult {
  const isValid = validateSchema(serviceDefinition);

  if (isValid) {
    return { valid: true };
  }

  // Convert AJV errors to user-friendly format
  const errors = (validateSchema.errors || []).map((error: any) => ({
    path: error.instancePath || '/',
    message: getErrorMessage(error),
    keyword: error.keyword,
    params: error.params,
  }));

  return { valid: false, errors };
}

/**
 * Get human-readable error message for AJV validation errors
 */
function getErrorMessage(error: any): string {
  const { keyword, instancePath, params } = error;

  switch (keyword) {
    case 'required':
      return `Missing required field: ${params.missingProperty}`;
    case 'type':
      return `Invalid type at ${instancePath || '/'}: expected ${params.type}, got ${typeof error.data}`;
    case 'enum':
      return `Invalid value at ${instancePath || '/'}: must be one of ${params.allowedValues.join(', ')}`;
    case 'minLength':
      return `String too short at ${instancePath || '/'}: minimum length is ${params.limit}`;
    case 'maxLength':
      return `String too long at ${instancePath || '/'}: maximum length is ${params.limit}`;
    case 'pattern':
      return `Invalid format at ${instancePath || '/'}: does not match pattern ${params.pattern}`;
    case 'additionalProperties':
      return `Invalid property at ${instancePath || '/'}: ${params.additionalProperty} is not allowed`;
    case 'const':
      return `Invalid value at ${instancePath || '/'}: must be ${params.allowedValue}`;
    default:
      return error.message || `Validation error at ${instancePath || '/'}`;
  }
}

/**
 * Get the schema from MongoDB cache
 * Returns the canonical schema for client-side validation and UI generation
 * Available after initializeValidator() is called
 */
export function getServiceSchema(): any {
  if (!cachedSchema) {
    throw new Error('Schema validator not initialized. Call initializeValidator() at server startup.');
  }
  return cachedSchema;
}

/**
 * Validate a specific envelope type (used by admin.ts validateOptionalEnvelopes)
 * Returns detailed errors for each envelope
 */
export function validateEnvelopeStructure(
  envelopeName: string,
  envelope: any
): { valid: boolean; errors?: string[] } {
  if (!cachedSchema) {
    throw new Error('Schema validator not initialized. Call initializeValidator() at server startup.');
  }
  
  const envelopeSchema = (cachedSchema.definitions as Record<string, any>)?.[`${envelopeName}Envelope`];

  if (!envelopeSchema) {
    return { valid: true }; // No schema definition found, skip validation
  }

  const validateEnvelope = ajv.compile(envelopeSchema);
  const isValid = validateEnvelope(envelope);

  if (isValid) {
    return { valid: true };
  }

  const errors = (validateEnvelope.errors || []).map((error: any) => getErrorMessage(error));
  return { valid: false, errors };
}
