/**
 * Core type definitions for the Service Envelope System
 * Defines the structure of service requests, envelopes, and their states
 */

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
}

export interface ApprovalEnvelope extends BaseEnvelope {
  approvers: Approver[];
  approvalRules: ApprovalRules;
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
}

export interface ProcessingTask {
  name: string;
  status: TaskStatus;
  notes?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  type?: 'webhook' | 'api_call' | 'custom_function' | 'built_in' | 'generic';
  
  // Webhook task configuration
  webhook?: {
    url: string;
    method: string;
    timeout?: number;
    retries?: number;
  };
  
  // API call task configuration
  apiCall?: {
    url: string;
    method: string;
    payload?: Record<string, any>;
    timeout?: number;
    retries?: number;
  };
  
  // Custom function task configuration
  customFunction?: {
    function: string;
    parameters?: Record<string, any>;
  };
  
  // Built-in function task configuration
  builtIn?: {
    function: string;
    parameters?: Record<string, any>;
  };
  
  // Response data from executed tasks
  webhookResponse?: any;
  webhookError?: string;
  apiResponse?: any;
  customFunctionResponse?: any;
}

export interface DeliveryEnvelope extends BaseEnvelope {
  method: DeliveryMethod;
  details: DeliveryDetails;
  deliveryAttempts: number;
  lastAttemptAt?: string;
}

export interface DeliveryDetails {
  email?: {
    recipient: string;
    subject: string;
    templateId?: string;
    attachmentUrls?: string[];
  };
  physicalMail?: {
    address: string;
    trackingId?: string;
  };
  sms?: {
    phoneNumber: string;
    message: string;
  };
}

export interface FeedbackEnvelope extends BaseEnvelope {
  feedbackLink?: string;
  feedbackToken?: string;
  submissionDate?: string;
  autoCloseOnExpiry?: string;
  expiresAt?: string;
  expiryDays?: number;
  emailTemplateId?: string;
}

// Enums for various statuses
export type RequestStatus = 'queued' | 'pending_approval' | 'pending_payment' | 'pending_delivery' | 'pending_feedback' |
  'processing' | 'completed' | 'failed' | 'cancelled' | 'process_pending';

export type EnvelopeStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 
  'waived' | 'skipped'  | 'pending_external' | 'cancelled'; // NEW: waiting on human/external input;

export type ValidationStatus = 'passed' | 'failed_schema' | 'failed_rules';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'pending_external';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'waiting' | 'pending_external'; // NEW: waiting on human/external input

export type DeliveryMethod = 'email' | 'physical_mail' | 'sms' | 'digital_download';