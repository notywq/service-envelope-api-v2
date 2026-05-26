/**
 * Core type definitions for the Service Envelope System
 * Defines the structure of service requests, envelopes, and their states
 */

import { ParameterDefinitions } from './parameter-schema.types.js';

export type Envelope =
  | RequestEnvelope
  | ApprovalEnvelope
  | PaymentEnvelope
  | ProcessingEnvelope
  | DeliveryEnvelope
  | FeedbackEnvelope;

export interface ServiceRequest {
  id: string;
  type: string;
  initiator: string;
  overallStatus: RequestStatus;
  createdAt: string;
  lastUpdated: string;
  history: HistoryEntry[];
  envelopes: EnvelopeCollection;
}

export interface HistoryEntry {
  status: string;
  timestamp: string;
  envelope: string;
  notes?: string;
}

export interface EnvelopeCollection {
  request: RequestEnvelope;
  approval: ApprovalEnvelope;
  payment: PaymentEnvelope;
  processing: ProcessingEnvelope;
  delivery: DeliveryEnvelope;
  feedback: FeedbackEnvelope;
}

// Base envelope interface that all envelopes extend
export interface BaseEnvelope {
  status: EnvelopeStatus;
  timestamp: string;
  required: boolean;
  notes?: string;
}

export interface RequestEnvelope extends BaseEnvelope {
  sourceSystem: string;
  validationStatus: ValidationStatus;
  validationErrors: string[];
  parameters: Record<string, any>;
  parameterSchema?: ParameterDefinitions; // Schema that defines allowed parameters
}

export interface ApprovalEnvelope extends BaseEnvelope {
  approvers: Approver[];
  approvalRules: ApprovalRules;
  emailTemplateStartEnvelope?: string;    // Email template sent when approval starts
  emailTemplateEndEnvelope?: string;      // Email template sent when approval completes
  startEmailSentAt?: string;
  endEmailSentAt?: string;
}

export interface Approver {
  id: string;
  role: string;
  status: ApprovalStatus;
  comment?: string;
  approvedAt?: string;
  deniedAt?: string;
}




export interface ApprovalRules {
  type: 'all_must_approve' | 'any_one' | 'specific_approver' | 'complex';
  specificApprover?: string;
  // Complex rule support: required approvers (all must approve) + at least one from a set
  requiredApprovers?: string[];
  atLeastOneOf?: string[];
}

export interface PaymentEnvelope extends BaseEnvelope {
  charges: Charge[]
  paymentMethod: string;
  transactionId?: string;
  paymentGatewayResponse?: any;
  emailTemplateStartEnvelope?: string;   // Email template sent when payment is required
  emailTemplateEndEnvelope?: string;     // Email template sent when payment is received
  startEmailSentAt?: string;
  endEmailSentAt?: string;
}

export interface Charge {
  item: string;
  amount: number;
  currency: string;
  quantity?: number;
}

export interface ProcessingEnvelope extends BaseEnvelope {
  processorId?: string;
  currentTask?: string;
  tasks: ProcessingTask[];
  stopOnFailure?: boolean;
  emailTemplateStartEnvelope?: string;   // Email template sent when processing starts
  emailTemplateEndEnvelope?: string;     // Email template sent when processing completes
  startEmailSentAt?: string;
  endEmailSentAt?: string;
}

export interface ProcessingTask {
  name: string;
  type: 'api_call';  // Only api_call is supported
  status: TaskStatus;
  notes?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  
  // API call task configuration - generic HTTP support
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;  // Supports {{parameterName}} substitution
  headers?: Record<string, string>;  // Supports {{parameterName}} substitution
  payload?: Record<string, any>;  // For POST/PUT - supports {{parameterName}} substitution
  queryParams?: Record<string, string>;  // For GET/DELETE - supports {{parameterName}} substitution
  timeout?: number;  // milliseconds, default 30000
  retries?: number;  // number of retries, default 3
  successCodes?: number[];  // HTTP success codes, default [200, 201, 204]
  
  // Response data from executed task
  responseStatus?: number;
  responseData?: any;
  responseError?: string;
}

export interface DeliveryEnvelope extends BaseEnvelope {
  method?: DeliveryMethod;  // email, physical_mail, or pickup
  details?: DeliveryDetails;
  availableMethods?: Record<string, any>;  // Store all available delivery methods from service definition
  deliveryAttempts: number;
  lastAttemptAt?: string;
  emailTemplateStartEnvelope?: string;   // Email template sent when delivery starts (document ready)
  emailTemplateEndEnvelope?: string;     // Email template sent when delivery completes
  startEmailSentAt?: string;
  endEmailSentAt?: string;
  // Delivery tracking - history of all status updates
  currentStatus?: string;  // Latest status: in_transit, out_for_delivery, received, failed, returned
  lastStatusUpdate?: string;  // ISO timestamp of last update
  deliveryHistory?: DeliveryStatusUpdate[];  // Array of all status updates
}

export interface DeliveryStatusUpdate {
  status: string;  // in_transit, out_for_delivery, received, failed, returned, etc.
  timestamp: string;  // ISO timestamp
  location?: string;  // Current location
  notes?: string;  // Additional notes
  trackingId?: string;  // Tracking reference
  updateSequence: number;  // Order in history
}

export interface DeliveryDetails {
  email?: {
    recipient: string;
    subject: string;
    templateId?: string;
    attachmentUrls?: string[];
  };
  physical_mail?: {
    address: string;
    carrier?: string;  // LBC, JNT, DHL, etc.
    trackingId?: string;
    requiresSignature?: boolean;
    estimatedDays?: number;
    shippedAt?: string;
  };
  pickup?: {
    location: string;
    hoursOfOperation?: string;
    pickedUpAt?: string;
    pickupDeadlineAt?: string;
  };
}

export interface FeedbackEnvelope extends BaseEnvelope {
  feedbackLink?: string;
  feedbackToken?: string;
  submissionDate?: string;
  autoCloseOnExpiry?: string;
  expiresAt?: string;
  expiryDays?: number;
  emailTemplateStartEnvelope?: string;   // Email template sent with survey invite
  emailTemplateEndEnvelope?: string;     // Email template sent after feedback submitted
  startEmailSentAt?: string;
  endEmailSentAt?: string;
  feedback?: {
    ratings?: Record<string, number>;
    comments?: string;
    submittedAt?: string;
  };
}

// Enums for various statuses
export type RequestStatus = 'queued' | 'pending_approval' | 'approval_started' | 'pending_payment' | 
  'payment_started' | 'processing' | 'processing_started' | 'processing_complete' | 'pending_delivery' | 'delivery_started' | 
  'delivery_complete' | 'pending_feedback' | 'feedback_started' | 'feedback_complete' |
  'completed' | 'failed' | 'cancelled' | 'process_pending';

export type EnvelopeStatus = 'pending' | 'started' | 'in_progress' | 'completed' | 'failed' | 
  'waived' | 'skipped' | 'pending_external' | 'cancelled';

export type ValidationStatus = 'passed' | 'failed_schema' | 'failed_rules';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'pending_external';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'waiting' | 'pending_external';

export type DeliveryMethod = 'email' | 'physical_mail' | 'pickup';

/**
 * Service Definition Type
 * Defines the complete structure of a service including all 6 envelopes
 */
export interface ServiceDefinition {
  serviceId: string;
  type: string; // Used as request.type to link requests to service definition
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  
  request: {
    parameters: ParameterDefinitions; // Parameter schema for Phase 2 UI
  };

  approval: {
    approvalRules: ApprovalRules;
    emailTemplateStartEnvelope?: string;  // Email sent when approval process starts
    emailTemplateEndEnvelope?: string;    // Email sent when approval completes
    requiresApproval?: boolean;
  };

  payment?: {
    required: boolean;
    paymentProvider?: string;
    charges: Charge[];
    emailTemplateStartEnvelope?: string;  // Email sent when payment is required
    emailTemplateEndEnvelope?: string;    // Email sent when payment received
  };

  processing?: {
    tasks: ProcessingTask[];
    stopOnFailure?: boolean;
    emailTemplateStartEnvelope?: string;  // Email sent when processing starts
    emailTemplateEndEnvelope?: string;    // Email sent when processing completes
  };

  delivery?: {
    deliveryMethods?: {
      email?: {
        enabled: boolean;
        subject?: string;
        recipient?: string;
        attachmentUrls?: string[];
        defaultTemplate?: string;
      };
      physical_mail?: {
        enabled: boolean;
        address?: string;
        carrier?: string;
        requiresSignature?: boolean;
        trackingEnabled?: boolean;
        estimatedDays?: number;
        costPercentage?: number;
      };
      pickup?: {
        enabled: boolean;
        location?: string;
        hoursOfOperation?: string;
        requiresIDVerification?: boolean;
        pickupDeadlineDays?: number;
        notificationRequired?: boolean;
        notificationTemplate?: string;
      };
    };
    emailTemplateStartEnvelope?: string;  // Email sent when document ready for delivery
    emailTemplateEndEnvelope?: string;    // Email sent when delivery completes
  };

  feedback?: {
    required: boolean;
    expiryDays?: number;
    surveyId?: string;
    emailTemplateStartEnvelope?: string;  // Email sent with survey invite
    emailTemplateEndEnvelope?: string;    // Email sent after feedback received
    notificationRequired?: boolean;
    reminderDaysBefore?: number;
  };
}