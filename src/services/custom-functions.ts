/**
 * Custom Functions Registry
 * Provides a mechanism for defining and executing custom business logic functions
 * Used by the Processing envelope to execute service-specific tasks
 */

import { ServiceRequest, ProcessingTask } from '../types/envelope.types.js';
import { Logger } from 'winston';

export interface CustomFunctionContext {
  request: ServiceRequest;
  task: ProcessingTask;
  logger: Logger;
}

export interface CustomFunctionResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Registry of custom functions
 * Format: { functionName: async function(context) => CustomFunctionResult }
 */
const customFunctionsRegistry: Record<
  string,
  (context: CustomFunctionContext) => Promise<CustomFunctionResult>
> = {};

/**
 * Register a custom function
 * @param name Function identifier (e.g., "verify_student", "pull_transcript")
 * @param fn Async function that executes the business logic
 */
export function registerCustomFunction(
  name: string,
  fn: (context: CustomFunctionContext) => Promise<CustomFunctionResult>
): void {
  customFunctionsRegistry[name] = fn;
}

/**
 * Get a registered custom function
 */
export function getCustomFunction(
  name: string
): ((context: CustomFunctionContext) => Promise<CustomFunctionResult>) | undefined {
  return customFunctionsRegistry[name];
}

/**
 * Execute a custom function
 */
export async function executeCustomFunction(
  functionName: string,
  context: CustomFunctionContext
): Promise<CustomFunctionResult> {
  const fn = getCustomFunction(functionName);
  if (!fn) {
    return {
      success: false,
      error: `Custom function not found: ${functionName}`,
    };
  }

  try {
    return await fn(context);
  } catch (error) {
    return {
      success: false,
      error: `Error executing ${functionName}: ${(error as Error).message}`,
    };
  }
}

/**
 * Load built-in custom functions
 * These are predefined functions for common tasks
 */
export function loadBuiltInCustomFunctions(logger?: any): void {
  // Example: Verify Student Enrollment
  registerCustomFunction('verify_student', async (context: CustomFunctionContext) => {
    const { request, logger } = context;
    const studentId = request.envelopes.request.parameters?.studentId;
    
    if (!studentId) {
      return { success: false, error: 'Student ID not found in request' };
    }

    logger.info(`✅ [CUSTOM] Verifying student enrollment for ${studentId}`);
    
    // Simulate verification logic
    // In real implementation, this would query your student database
    const isEnrolled = Math.random() > 0.1; // 90% pass rate for demo
    
    if (isEnrolled) {
      logger.info(`✅ [CUSTOM] Student ${studentId} is enrolled`);
      return { success: true, data: { enrollmentStatus: 'active', verified: true } };
    } else {
      return { success: false, error: `Student ${studentId} is not enrolled` };
    }
  });

  // Example: Pull Transcript from Database
  registerCustomFunction('pull_transcript', async (context: CustomFunctionContext) => {
    const { request, logger } = context;
    const studentId = request.envelopes.request.parameters?.studentId;
    
    if (!studentId) {
      return { success: false, error: 'Student ID not found' };
    }

    logger.info(`📄 [CUSTOM] Pulling transcript for student ${studentId}`);
    
    // Simulate pulling transcript
    const transcript = {
      studentId,
      gpa: 3.8,
      coursesCompleted: 124,
      currentSemester: 'Spring 2026',
      timestamp: new Date().toISOString(),
    };

    logger.info(`✅ [CUSTOM] Transcript retrieved for ${studentId}`);
    return { success: true, data: transcript };
  });

  // Example: Generate Document (PDF, etc)
  registerCustomFunction('generate_document', async (context: CustomFunctionContext) => {
    const { request, task, logger } = context;
    const docType = (task.customFunction?.parameters?.documentType || 'transcript') as string;
    
    logger.info(`📄 [CUSTOM] Generating ${docType} document`);
    
    // Simulate document generation
    const documentUrl = `https://storage.example.com/documents/${request.id}-${docType}.pdf`;
    
    logger.info(`✅ [CUSTOM] Document generated: ${documentUrl}`);
    return { 
      success: true, 
      data: { 
        documentUrl, 
        documentType: docType,
        generatedAt: new Date().toISOString()
      } 
    };
  });

  // Example: Send Notification
  registerCustomFunction('send_notification', async (context: CustomFunctionContext) => {
    const { request, task, logger } = context;
    const notificationType = (task.customFunction?.parameters?.notificationType || 'email') as string;
    const recipient = (task.customFunction?.parameters?.recipient || request.envelopes.request.parameters?.initiatorEmail) as string;
    
    logger.info(`📧 [CUSTOM] Sending ${notificationType} notification to ${recipient}`);
    
    // Simulate notification sending
    logger.info(`✅ [CUSTOM] Notification sent successfully`);
    return { success: true, data: { notificationType, recipient, sentAt: new Date().toISOString() } };
  });

  // Example: Validate Address
  registerCustomFunction('validate_address', async (context: CustomFunctionContext) => {
    const { request, logger } = context;
    const address = request.envelopes.request.parameters?.deliveryAddress;
    
    if (!address) {
      return { success: false, error: 'Delivery address not found' };
    }

    logger.info(`📍 [CUSTOM] Validating address: ${address}`);
    
    // Simulate address validation
    const isValid = !address.includes('Unknown');
    
    if (isValid) {
      logger.info(`✅ [CUSTOM] Address is valid`);
      return { success: true, data: { validAddress: address, verified: true } };
    } else {
      return { success: false, error: 'Address validation failed' };
    }
  });

  logger?.info?.(`✅ Loaded built-in custom functions (5 functions registered)`);
}

/**
 * List all registered custom functions
 */
export function listCustomFunctions(): string[] {
  return Object.keys(customFunctionsRegistry);
}

let logger: Logger;

export function setLogger(newLogger: Logger): void {
  logger = newLogger;
}
