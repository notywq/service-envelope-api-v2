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
}

export interface ApprovalRules {
  type: 'all_must_approve' | 'any_one' | 'specific_approver';
  specificApprover?: string;
}

export interface PaymentEnvelope extends BaseEnvelope {
  amount: number;
  currency: string;
  paymentMethod: string;
  transactionId?: string;
  paymentGatewayResponse?: any;
}

export interface ProcessingEnvelope extends BaseEnvelope {
  processorId?: string;
  currentTask?: string;
  tasks: ProcessingTask[];
}

export interface ProcessingTask {
  name: string;
  status: TaskStatus;
  notes?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
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
  submissionDate?: string;
  autoCloseOnExpiry?: string;
}

// Enums for various statuses
export type RequestStatus = 'queued' | 'pending_approval' | 'pending_payment' | 
  'processing' | 'completed' | 'failed' | 'cancelled';

export type EnvelopeStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 
  'waived' | 'skipped';

export type ValidationStatus = 'passed' | 'failed_schema' | 'failed_rules';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type DeliveryMethod = 'email' | 'physical_mail' | 'sms' | 'digital_download';