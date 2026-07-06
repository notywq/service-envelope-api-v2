/**
 * MongoDB-backed State Manager
 * Replaces file-based JSON persistence with MongoDB for scalability
 */

import { ServiceRequest, HistoryEntry } from '../types/envelope.types.js';
import mongoose, { Schema, Document } from 'mongoose';
import { Logger } from 'winston';
import { publishTableEvent } from '../utils/table-events.js';

// Define MongoDB Schemas
const HistoryEntrySchema = new Schema({
  status: String,
  timestamp: String,
  envelope: String,
  notes: String,
}, { _id: false });

const ServiceRequestSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  type: String,
  initiator: String,
  overallStatus: String,
  createdAt: String,
  lastUpdated: String,
  history: [HistoryEntrySchema],
  envelopes: Schema.Types.Mixed,
});

interface ServiceRequestDoc extends Document {
  id: string;
  type: string;
  initiator: string;
  overallStatus: string;
  createdAt: string;
  lastUpdated: string;
  history: any[];
  envelopes: any;
}

const ServiceRequestModel = mongoose.model<ServiceRequestDoc>(
  'ServiceRequest',
  ServiceRequestSchema
);

// Define Approval Token Schema
const ApprovalTokenSchema = new Schema({
  token: { type: String, unique: true, required: true, index: true },
  requestId: { type: String, required: true, index: true },
  approverId: { type: String, required: true },
  expiresAt: { type: Date, required: false, default: null },
  createdAt: { type: Date, default: Date.now },
  used: { type: Boolean, default: false },
});

interface ApprovalTokenDoc extends Document {
  token: string;
  requestId: string;
  approverId: string;
  expiresAt?: Date | null;
  createdAt: Date;
  used: boolean;
}

const ApprovalTokenModel = mongoose.model<ApprovalTokenDoc>(
  'ApprovalToken',
  ApprovalTokenSchema
);

// Define Feedback Token Schema
const FeedbackTokenSchema = new Schema({
  token: { type: String, unique: true, required: true, index: true },
  requestId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  used: { type: Boolean, default: false },
  feedback: Schema.Types.Mixed, // Store feedback responses when submitted
});

interface FeedbackTokenDoc extends Document {
  token: string;
  requestId: string;
  expiresAt: Date;
  createdAt: Date;
  used: boolean;
  feedback?: any;
}

const FeedbackTokenModel = mongoose.model<FeedbackTokenDoc>(
  'FeedbackToken',
  FeedbackTokenSchema
);

// Define OTP Challenge Schema
const OtpChallengeSchema = new Schema({
  email: { type: String, required: true, index: true },
  purpose: { type: String, required: true, default: 'login', index: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  sentAt: { type: Date, default: Date.now },
  consumedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  ipAddress: String,
  userAgent: String,
}, { collection: 'otpchallenges' });

OtpChallengeSchema.index({ email: 1, purpose: 1, createdAt: -1 });

interface OtpChallengeDoc extends Document {
  email: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
  sentAt: Date;
  consumedAt?: Date | null;
  cancelledAt?: Date | null;
  attempts: number;
  maxAttempts: number;
  ipAddress?: string;
  userAgent?: string;
}

const OtpChallengeModel = mongoose.model<OtpChallengeDoc>(
  'OtpChallenge',
  OtpChallengeSchema
);

// Define Auth User Schema
const AuthUserSchema = new Schema({
  email: { type: String, unique: true, required: true, index: true },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'requester', 'orchestrator', 'approver', 'service'],
    default: 'requester',
    index: true,
  },
  name: String,
  isActive: { type: Boolean, default: true, index: true },
  allowedForOtp: { type: Boolean, default: true, index: true },
  metadata: Schema.Types.Mixed,
  lastLoginAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'authusers' });

interface AuthUserDoc extends Document {
  email: string;
  role: 'super_admin' | 'admin' | 'requester' | 'orchestrator' | 'approver' | 'service';
  name?: string;
  isActive: boolean;
  allowedForOtp: boolean;
  metadata?: any;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuthUserModel = mongoose.model<AuthUserDoc>(
  'AuthUser',
  AuthUserSchema
);

// Define API Client Schema for machine-to-machine authentication
const ApiClientSchema = new Schema({
  clientId: { type: String, unique: true, required: true, index: true },
  name: { type: String, required: true },
  role: {
    type: String,
    enum: ['orchestrator', 'service'],
    default: 'orchestrator',
    index: true,
  },
  scopes: { type: [String], default: [] },
  secretHash: { type: String, required: true },
  secretSalt: { type: String, required: true },
  isActive: { type: Boolean, default: true, index: true },
  metadata: Schema.Types.Mixed,
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  rotatedAt: { type: Date, default: null },
  deactivatedAt: { type: Date, default: null },
}, { collection: 'apiclients' });

interface ApiClientDoc extends Document {
  clientId: string;
  name: string;
  role: 'orchestrator' | 'service';
  scopes: string[];
  secretHash: string;
  secretSalt: string;
  isActive: boolean;
  metadata?: any;
  lastUsedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  rotatedAt?: Date | null;
  deactivatedAt?: Date | null;
}

const ApiClientModel = mongoose.model<ApiClientDoc>(
  'ApiClient',
  ApiClientSchema
);

// Define Service Definition Schema
const ServiceDefinitionSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  name: { type: String, required: true },
  type: { type: String, required: true, index: true },
  initiator: String,
  description: String,
  yaml: { type: String, required: true },
  definition: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'servicedefinitions' });

interface ServiceDefinitionDoc extends Document {
  id: string;
  name: string;
  type: string;
  initiator: string;
  description: string;
  yaml: string;
  definition: any;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceDefinitionModel = mongoose.model<ServiceDefinitionDoc>(
  'ServiceDefinition',
  ServiceDefinitionSchema
);

// Define Email Template Schema
const EmailTemplateSchema = new Schema({
  id: { type: String, unique: true, required: true, index: true },
  name: { type: String, required: true },
  subject: { type: String, required: true },
  htmlBody: { type: String, required: true },
  description: String,
  templateScope: String, // generic | envelope | service
  eventKey: String, // e.g., request-cancelled, request-denied, approval-start
  serviceType: String, // optional scope for service-specific overrides
  isActive: { type: Boolean, default: true },
  envelopeType: String, // e.g., 'request', 'approval', 'payment', 'processing', 'delivery', 'feedback'
  phase: String, // e.g., 'confirmation', 'start', 'complete'
  variables: [String], // e.g., ['studentName', 'requestType', 'approverName']
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

interface EmailTemplateDoc extends Document {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  description: string;
  templateScope?: 'generic' | 'envelope' | 'service';
  eventKey?: string;
  serviceType?: string;
  isActive?: boolean;
  envelopeType?: string;
  phase?: string;
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

const EmailTemplateModel = mongoose.model<EmailTemplateDoc>(
  'EmailTemplate',
  EmailTemplateSchema
);

// Define Schema Version Schema (NEW - May 29: Track schema evolution)
const SchemaVersionSchema = new Schema({
  version: { type: String, unique: true, required: true, index: true },
  name: { type: String, required: true },
  description: String,
  schema: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

interface SchemaVersionDoc extends Document {
  version: string;
  name: string;
  description?: string;
  schema: any;
  createdAt: Date;
  updatedAt: Date;
}

const SchemaVersionModel = mongoose.model<SchemaVersionDoc>(
  'SchemaVersion',
  SchemaVersionSchema
);

export class MongoDBStateManager {
  constructor(private logger: Logger) {}

  private applyPagination<T>(query: mongoose.Query<T[], any>, limit?: number, offset: number = 0): mongoose.Query<T[], any> {
    const safeOffset = Math.max(offset, 0);

    if (safeOffset > 0) {
      query = query.skip(safeOffset);
    }

    if (typeof limit === 'number') {
      query = query.limit(Math.max(limit, 0));
    }

    return query;
  }

  private normalizeLoadedServiceDefinition(service: any): any {
    if (!service) {
      return service;
    }

    const canonical = service.definition || service;
    const resolvedId = service.id || canonical.id || service.serviceId;
    const resolvedType = service.type || canonical.type;
    const resolvedName = service.name || canonical.name;
    const resolvedDescription = service.description || canonical.description;
    const resolvedInitiator = service.initiator || canonical.initiator;
    const resolvedEnvelopes = service.envelopes || canonical.envelopes || {};

    const normalizedCanonical = {
      ...canonical,
      id: resolvedId,
      type: resolvedType,
      name: resolvedName,
      description: resolvedDescription,
      initiator: resolvedInitiator,
      envelopes: resolvedEnvelopes,
    };

    return {
      ...service,
      id: resolvedId,
      serviceId: service.serviceId || canonical.serviceId || resolvedId,
      type: resolvedType,
      name: resolvedName,
      description: resolvedDescription,
      initiator: resolvedInitiator,
      envelopes: resolvedEnvelopes,
      definition: normalizedCanonical,
    };
  }

  private buildRequesterEmailQuery(email: string): Record<string, any> {
    const escapedEmail = email.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emailRegex = new RegExp(`^${escapedEmail}$`, 'i');

    return {
      $or: [
        { initiator: emailRegex },
        { 'envelopes.request.parameters.email': emailRegex },
        { 'envelopes.request.parameters.emailAddress': emailRegex },
        { 'envelopes.request.parameters.requesterEmail': emailRegex },
        { 'envelopes.request.parameters.requestorEmail': emailRegex },
        { 'envelopes.request.parameters.initiatorEmail': emailRegex },
        { 'envelopes.request.parameters.studentEmail': emailRegex },
        { 'envelopes.request.parameters.contactEmail': emailRegex },
        { 'envelopes.request.parameters.serviceData.email': emailRegex },
        { 'envelopes.request.parameters.serviceData.emailAddress': emailRegex },
        { 'envelopes.request.parameters.serviceData.requesterEmail': emailRegex },
        { 'envelopes.request.parameters.serviceData.requestorEmail': emailRegex },
        { 'envelopes.request.parameters.serviceData.initiatorEmail': emailRegex },
      ],
    };
  }

  async connect(mongoUri: string, label: string = 'MongoDB', logFailure: boolean = true): Promise<void> {
    try {
      await mongoose.connect(mongoUri);
      this.logger.info(`BOOT | MongoDB      | Connected | label=${JSON.stringify(label)}`);
    } catch (error) {
      if (logFailure) {
        this.logger.error(`BOOT | MongoDB      | Connection failed | label=${JSON.stringify(label)}`, error);
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();
  }

  async saveRequest(request: ServiceRequest): Promise<void> {
    try {
      // Preserve user-selected delivery state from the latest persisted request when
      // stale in-memory orchestration snapshots are saved later in the pipeline.
      const existing = await ServiceRequestModel.findOne({ id: request.id });
      if (existing) {
        const existingObj = existing.toObject() as ServiceRequest;
        const existingDelivery = existingObj?.envelopes?.delivery as any;
        const incomingDelivery = request?.envelopes?.delivery as any;

        if (existingDelivery && incomingDelivery) {
          const incomingHasMethod = Boolean(incomingDelivery.method);
          const existingHasMethod = Boolean(existingDelivery.method);

          if (!incomingHasMethod && existingHasMethod) {
            this.logger.info(
              `[SAVE-REQUEST-MERGE] Request ${request.id} | Preserving persisted delivery method | existing=${String(existingDelivery.method)} incoming=${String(incomingDelivery.method)}`
            );
            incomingDelivery.method = existingDelivery.method;
            incomingDelivery.details = existingDelivery.details;
            incomingDelivery.deliveryAttempts = incomingDelivery.deliveryAttempts ?? existingDelivery.deliveryAttempts;
            incomingDelivery.deliveryHistory =
              Array.isArray(incomingDelivery.deliveryHistory) && incomingDelivery.deliveryHistory.length > 0
                ? incomingDelivery.deliveryHistory
                : existingDelivery.deliveryHistory;
            incomingDelivery.currentStatus = incomingDelivery.currentStatus ?? existingDelivery.currentStatus;
            incomingDelivery.currentStatusCode = incomingDelivery.currentStatusCode ?? existingDelivery.currentStatusCode;
            incomingDelivery.lastStatusUpdate = incomingDelivery.lastStatusUpdate ?? existingDelivery.lastStatusUpdate;
          }
        }
      }

      await ServiceRequestModel.findOneAndUpdate(
        { id: request.id },
        request,
        { upsert: true, new: true }
      );
      publishTableEvent({
        resource: 'requests',
        event: existing ? 'updated' : 'created',
        ids: [request.id],
      });
      this.logger.debug(`Saved request ${request.id} to MongoDB`);
    } catch (error) {
      this.logger.error(`Failed to save request ${request.id}:`, error);
      throw error;
    }
  }

  async loadRequest(requestId: string): Promise<ServiceRequest | null> {
    try {
      const doc = await ServiceRequestModel.findOne({ id: requestId });
      if (!doc) {
        return null;
      }
      return doc.toObject() as ServiceRequest;
    } catch (error) {
      this.logger.error(`Failed to load request ${requestId}:`, error);
      return null;
    }
  }

  async listRequests(
    limit: number = 100,
    offset: number = 0,
    filters: { status?: string; type?: string } = {}
  ): Promise<ServiceRequest[]> {
    try {
      const query: Record<string, string> = {};
      if (filters.status) {
        query.overallStatus = filters.status;
      }
      if (filters.type) {
        query.type = filters.type;
      }

      const docs = await this.applyPagination(
        ServiceRequestModel.find(query).sort({ createdAt: -1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject() as ServiceRequest);
    } catch (error) {
      this.logger.error('Failed to list requests:', error);
      return [];
    }
  }

  async listRequestIds(): Promise<string[]> {
    try {
      const docs = await ServiceRequestModel.find({}, { id: 1 });
      return docs.map(doc => doc.id);
    } catch (error) {
      this.logger.error('Failed to list request IDs:', error);
      return [];
    }
  }

  async deleteRequest(requestId: string): Promise<boolean> {
    try {
      const result = await ServiceRequestModel.deleteOne({ id: requestId });
      if (result.deletedCount > 0) {
        publishTableEvent({
          resource: 'requests',
          event: 'deleted',
          ids: [requestId],
        });
      }
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(`Failed to delete request ${requestId}:`, error);
      return false;
    }
  }

  async countRequests(filters: { status?: string; type?: string } = {}): Promise<number> {
    try {
      const query: Record<string, string> = {};
      if (filters.status) {
        query.overallStatus = filters.status;
      }
      if (filters.type) {
        query.type = filters.type;
      }

      return await ServiceRequestModel.countDocuments(query);
    } catch (error) {
      this.logger.error('Failed to count requests:', error);
      return 0;
    }
  }

  async listRequestsByRequester(
    email: string,
    limit: number = 100,
    offset: number = 0,
    filters: { status?: string; type?: string } = {}
  ): Promise<ServiceRequest[]> {
    try {
      const query: Record<string, any> = this.buildRequesterEmailQuery(email);
      if (filters.status) {
        query.overallStatus = filters.status;
      }
      if (filters.type) {
        query.type = filters.type;
      }

      const docs = await this.applyPagination(
        ServiceRequestModel.find(query).sort({ createdAt: -1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject() as ServiceRequest);
    } catch (error) {
      this.logger.error(`Failed to list requests for requester ${email}:`, error);
      return [];
    }
  }

  async countRequestsByRequester(
    email: string,
    filters: { status?: string; type?: string } = {}
  ): Promise<number> {
    try {
      const query: Record<string, any> = this.buildRequesterEmailQuery(email);
      if (filters.status) {
        query.overallStatus = filters.status;
      }
      if (filters.type) {
        query.type = filters.type;
      }

      return await ServiceRequestModel.countDocuments(query);
    } catch (error) {
      this.logger.error(`Failed to count requests for requester ${email}:`, error);
      return 0;
    }
  }

  async findByStatus(status: string, limit: number = 100, offset: number = 0): Promise<ServiceRequest[]> {
    try {
      const docs = await this.applyPagination(
        ServiceRequestModel.find({ overallStatus: status }).sort({ createdAt: -1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject() as ServiceRequest);
    } catch (error) {
      this.logger.error(`Failed to find requests with status ${status}:`, error);
      return [];
    }
  }

  async findByType(type: string, limit: number = 100, offset: number = 0): Promise<ServiceRequest[]> {
    try {
      const docs = await this.applyPagination(
        ServiceRequestModel.find({ type }).sort({ createdAt: -1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject() as ServiceRequest);
    } catch (error) {
      this.logger.error(`Failed to find requests with type ${type}:`, error);
      return [];
    }
  }

  // Approval Token Methods
  async saveApprovalToken(token: string, requestId: string, approverId: string, expiryHours: number = 24): Promise<void> {
    try {
      const expiresAt = expiryHours === 0 ? null : new Date(Date.now() + expiryHours * 60 * 60 * 1000);
      await ApprovalTokenModel.create({
        token,
        requestId,
        approverId,
        expiresAt,
      });
      this.logger.debug(`Saved approval token ${token} to MongoDB`);
    } catch (error) {
      this.logger.error(`Failed to save approval token ${token}:`, error);
      throw error;
    }
  }

  async getApprovalToken(token: string): Promise<any> {
    try {
      const doc = await ApprovalTokenModel.findOne({ token });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get approval token ${token}:`, error);
      return null;
    }
  }

  async getApprovalTokensByRequest(requestId: string): Promise<any[]> {
    try {
      const docs = await ApprovalTokenModel.find({ requestId });
      return docs.map(doc => doc.toObject());
    } catch (error) {
      this.logger.error(`Failed to get approval tokens for request ${requestId}:`, error);
      return [];
    }
  }

  async markApprovalTokenAsUsed(token: string): Promise<void> {
    try {
      await ApprovalTokenModel.updateOne({ token }, { used: true });
      this.logger.debug(`Marked approval token ${token} as used`);
    } catch (error) {
      this.logger.error(`Failed to mark token ${token} as used:`, error);
      throw error;
    }
  }

  async deleteExpiredTokens(): Promise<number> {
    try {
      const result = await ApprovalTokenModel.deleteMany({
        expiresAt: { $exists: true, $ne: null, $lt: new Date() },
      });
      this.logger.debug(`Deleted ${result.deletedCount} expired approval tokens`);
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error('Failed to delete expired tokens:', error);
      return 0;
    }
  }

  // OTP Challenge Methods
  async createOtpChallenge(challenge: {
    email: string;
    purpose?: string;
    codeHash: string;
    expiresAt: Date;
    maxAttempts: number;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<any> {
    try {
      const doc = await OtpChallengeModel.create({
        email: challenge.email,
        purpose: challenge.purpose || 'login',
        codeHash: challenge.codeHash,
        expiresAt: challenge.expiresAt,
        maxAttempts: challenge.maxAttempts,
        ipAddress: challenge.ipAddress,
        userAgent: challenge.userAgent,
      });
      this.logger.debug(`Saved OTP challenge for ${challenge.email}`);
      return doc.toObject();
    } catch (error) {
      this.logger.error(`Failed to save OTP challenge for ${challenge.email}:`, error);
      throw error;
    }
  }

  async getActiveOtpChallenge(email: string, purpose: string = 'login'): Promise<any> {
    try {
      const doc = await OtpChallengeModel.findOne({
        email,
        purpose,
        consumedAt: null,
        cancelledAt: null,
      }).sort({ createdAt: -1 });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get active OTP challenge for ${email}:`, error);
      return null;
    }
  }

  async incrementOtpChallengeAttempts(challengeId: string): Promise<void> {
    try {
      await OtpChallengeModel.updateOne({ _id: challengeId }, { $inc: { attempts: 1 } });
    } catch (error) {
      this.logger.error(`Failed to increment OTP attempts for ${challengeId}:`, error);
      throw error;
    }
  }

  async markOtpChallengeConsumed(challengeId: string): Promise<void> {
    try {
      await OtpChallengeModel.updateOne({ _id: challengeId }, { consumedAt: new Date() });
    } catch (error) {
      this.logger.error(`Failed to consume OTP challenge ${challengeId}:`, error);
      throw error;
    }
  }

  async cancelOtpChallenges(email: string, purpose: string = 'login'): Promise<number> {
    try {
      const result = await OtpChallengeModel.updateMany(
        {
          email,
          purpose,
          consumedAt: null,
          cancelledAt: null,
        },
        { cancelledAt: new Date() }
      );
      return result.modifiedCount || 0;
    } catch (error) {
      this.logger.error(`Failed to cancel OTP challenges for ${email}:`, error);
      throw error;
    }
  }

  async flushStaleOtpChallenges(now: Date = new Date(), consumedRetentionHours: number = 24): Promise<number> {
    try {
      const consumedBefore = new Date(now.getTime() - consumedRetentionHours * 60 * 60 * 1000);
      const result = await OtpChallengeModel.deleteMany({
        $or: [
          { expiresAt: { $lt: now } },
          { consumedAt: { $ne: null, $lt: consumedBefore } },
          { cancelledAt: { $ne: null, $lt: consumedBefore } },
        ],
      });
      this.logger.debug(`Deleted ${result.deletedCount} stale OTP challenge(s)`);
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error('Failed to flush stale OTP challenges:', error);
      return 0;
    }
  }

  // Auth User Methods
  async upsertAuthUser(user: {
    email: string;
    role?: 'super_admin' | 'admin' | 'requester' | 'orchestrator' | 'approver' | 'service';
    name?: string;
    isActive?: boolean;
    allowedForOtp?: boolean;
    metadata?: any;
  }): Promise<any> {
    try {
      const email = user.email.trim().toLowerCase();
      const doc = await AuthUserModel.findOneAndUpdate(
        { email },
        {
          $set: {
            email,
            role: user.role || 'requester',
            name: user.name,
            isActive: user.isActive !== false,
            allowedForOtp: user.allowedForOtp !== false,
            metadata: user.metadata || {},
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );
      return doc.toObject();
    } catch (error) {
      this.logger.error(`Failed to upsert auth user ${user.email}:`, error);
      throw error;
    }
  }

  async getAuthUserByEmail(email: string): Promise<any> {
    try {
      const doc = await AuthUserModel.findOne({ email: email.trim().toLowerCase() });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get auth user ${email}:`, error);
      return null;
    }
  }

  async listAuthUsers(limit?: number, offset: number = 0): Promise<any[]> {
    try {
      const docs = await this.applyPagination(
        AuthUserModel.find({}).sort({ email: 1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject());
    } catch (error) {
      this.logger.error('Failed to list auth users:', error);
      return [];
    }
  }

  async countAuthUsers(): Promise<number> {
    try {
      return AuthUserModel.countDocuments();
    } catch (error) {
      this.logger.error('Failed to count auth users:', error);
      return 0;
    }
  }

  async deactivateAuthUser(email: string): Promise<boolean> {
    try {
      const result = await AuthUserModel.updateOne(
        { email: email.trim().toLowerCase() },
        { isActive: false, allowedForOtp: false, updatedAt: new Date() }
      );
      return (result.modifiedCount || 0) > 0;
    } catch (error) {
      this.logger.error(`Failed to deactivate auth user ${email}:`, error);
      throw error;
    }
  }

  async markAuthUserLogin(email: string): Promise<void> {
    try {
      await AuthUserModel.updateOne(
        { email: email.trim().toLowerCase() },
        { lastLoginAt: new Date(), updatedAt: new Date() }
      );
    } catch (error) {
      this.logger.error(`Failed to update auth user login timestamp ${email}:`, error);
    }
  }

  // API Client Methods
  async createApiClient(client: {
    clientId: string;
    name: string;
    role?: 'orchestrator' | 'service';
    scopes?: string[];
    secretHash: string;
    secretSalt: string;
    isActive?: boolean;
    metadata?: any;
  }): Promise<any> {
    try {
      const doc = await ApiClientModel.create({
        clientId: client.clientId,
        name: client.name,
        role: client.role || 'orchestrator',
        scopes: client.scopes || [],
        secretHash: client.secretHash,
        secretSalt: client.secretSalt,
        isActive: client.isActive !== false,
        metadata: client.metadata || {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return doc.toObject();
    } catch (error) {
      this.logger.error(`Failed to create API client ${client.clientId}:`, error);
      throw error;
    }
  }

  async getApiClientById(clientId: string): Promise<any> {
    try {
      const doc = await ApiClientModel.findOne({ clientId: clientId.trim() });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get API client ${clientId}:`, error);
      return null;
    }
  }

  async listApiClients(limit?: number, offset: number = 0): Promise<any[]> {
    try {
      const docs = await this.applyPagination(
        ApiClientModel.find({}).sort({ createdAt: -1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject());
    } catch (error) {
      this.logger.error('Failed to list API clients:', error);
      return [];
    }
  }

  async countApiClients(): Promise<number> {
    try {
      return ApiClientModel.countDocuments();
    } catch (error) {
      this.logger.error('Failed to count API clients:', error);
      return 0;
    }
  }

  async updateApiClient(clientId: string, updates: {
    name?: string;
    role?: 'orchestrator' | 'service';
    scopes?: string[];
    isActive?: boolean;
    metadata?: any;
  }): Promise<any> {
    try {
      const set: Record<string, any> = { updatedAt: new Date() };

      if (updates.name !== undefined) {
        set.name = updates.name;
      }
      if (updates.role !== undefined) {
        set.role = updates.role;
      }
      if (updates.scopes !== undefined) {
        set.scopes = updates.scopes;
      }
      if (updates.isActive !== undefined) {
        set.isActive = updates.isActive;
        set.deactivatedAt = updates.isActive ? null : new Date();
      }
      if (updates.metadata !== undefined) {
        set.metadata = updates.metadata;
      }

      const doc = await ApiClientModel.findOneAndUpdate(
        { clientId: clientId.trim() },
        { $set: set },
        { new: true }
      );
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to update API client ${clientId}:`, error);
      throw error;
    }
  }

  async rotateApiClientSecret(clientId: string, secretHash: string, secretSalt: string): Promise<any> {
    try {
      const doc = await ApiClientModel.findOneAndUpdate(
        { clientId: clientId.trim() },
        {
          $set: {
            secretHash,
            secretSalt,
            rotatedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { new: true }
      );
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to rotate API client secret ${clientId}:`, error);
      throw error;
    }
  }

  async deactivateApiClient(clientId: string): Promise<boolean> {
    try {
      const result = await ApiClientModel.updateOne(
        { clientId: clientId.trim() },
        {
          $set: {
            isActive: false,
            deactivatedAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
      return (result.modifiedCount || 0) > 0;
    } catch (error) {
      this.logger.error(`Failed to deactivate API client ${clientId}:`, error);
      throw error;
    }
  }

  async markApiClientUsed(clientId: string): Promise<void> {
    try {
      await ApiClientModel.updateOne(
        { clientId: clientId.trim() },
        { lastUsedAt: new Date(), updatedAt: new Date() }
      );
    } catch (error) {
      this.logger.error(`Failed to update API client usage ${clientId}:`, error);
    }
  }

  // Feedback Token Methods
  async saveFeedbackToken(tokenData: { token: string; requestId: string; expiresAt: string; createdAt: string; used: boolean }): Promise<void> {
    try {
      await FeedbackTokenModel.create({
        token: tokenData.token,
        requestId: tokenData.requestId,
        expiresAt: new Date(tokenData.expiresAt),
        used: tokenData.used,
      });
      this.logger.debug(`Saved feedback token ${tokenData.token} to MongoDB`);
    } catch (error) {
      this.logger.error(`Failed to save feedback token ${tokenData.token}:`, error);
      throw error;
    }
  }

  async getFeedbackToken(token: string): Promise<any> {
    try {
      const doc = await FeedbackTokenModel.findOne({ token });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get feedback token ${token}:`, error);
      return null;
    }
  }

  async verifyFeedbackToken(token: string, requestId?: string): Promise<boolean> {
    try {
      const doc = await FeedbackTokenModel.findOne({ token });
      if (!doc) {
        return false;
      }

      if (requestId && doc.requestId !== requestId) {
        return false;
      }

      if (doc.used) {
        return false;
      }

      if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to verify feedback token ${token}:`, error);
      return false;
    }
  }

  async markFeedbackTokenAsUsed(token: string, feedback: any): Promise<void> {
    try {
      await FeedbackTokenModel.updateOne({ token }, { used: true, feedback });
      this.logger.debug(`Marked feedback token ${token} as used`);
    } catch (error) {
      this.logger.error(`Failed to mark feedback token ${token} as used:`, error);
      throw error;
    }
  }

  async deleteExpiredFeedbackTokens(): Promise<number> {
    try {
      const result = await FeedbackTokenModel.deleteMany({ expiresAt: { $lt: new Date() } });
      this.logger.debug(`Deleted ${result.deletedCount} expired feedback tokens`);
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error('Failed to delete expired feedback tokens:', error);
      return 0;
    }
  }

  // Service Definition Methods
  async saveServiceDefinition(service: any): Promise<void> {
    try {
      const existing = await ServiceDefinitionModel.findOne({ id: service.id }, { id: 1 });
      await ServiceDefinitionModel.findOneAndUpdate(
        { id: service.id },
        {
          ...service,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      publishTableEvent({
        resource: 'services',
        event: existing ? 'updated' : 'created',
        ids: [service.id],
      });
      this.logger.debug(`Saved service definition ${service.id} to MongoDB`);
    } catch (error) {
      this.logger.error(`Failed to save service definition ${service.id}:`, error);
      throw error;
    }
  }

  async getServiceDefinition(serviceId: string): Promise<any> {
    try {
      const doc = await ServiceDefinitionModel.findOne({ id: serviceId });
      return doc ? this.normalizeLoadedServiceDefinition(doc.toObject()) : null;
    } catch (error) {
      this.logger.error(`Failed to get service definition ${serviceId}:`, error);
      return null;
    }
  }

  async getAllServiceDefinitions(limit?: number, offset: number = 0): Promise<any[]> {
    try {
      this.logger.debug('[ServiceRegistry] Querying servicedefinitions collection...');
      const docs = await this.applyPagination(
        ServiceDefinitionModel.find({}).sort({ createdAt: -1 }),
        limit,
        offset
      );
      this.logger.debug(`[ServiceRegistry] Found ${docs.length} service definitions`);
      if (docs.length === 0) {
        this.logger.warn('[ServiceRegistry] No documents found in servicedefinitions collection');
      }
      return docs.map(doc => this.normalizeLoadedServiceDefinition(doc.toObject()));
    } catch (error) {
      this.logger.error('Failed to get all service definitions:', error);
      if (error instanceof Error) {
        this.logger.error('Error details:', error.message);
        this.logger.error('Error stack:', error.stack);
      }
      return [];
    }
  }

  async countServiceDefinitions(): Promise<number> {
    try {
      return ServiceDefinitionModel.countDocuments();
    } catch (error) {
      this.logger.error('Failed to count service definitions:', error);
      return 0;
    }
  }

  async getServiceDefinitionByType(type: string): Promise<any> {
    try {
      const doc = await ServiceDefinitionModel.findOne({ type });
      return doc ? this.normalizeLoadedServiceDefinition(doc.toObject()) : null;
    } catch (error) {
      this.logger.error(`Failed to get service definition by type ${type}:`, error);
      return null;
    }
  }

  async deleteServiceDefinition(serviceId: string): Promise<boolean> {
    try {
      this.logger.info(`🗑️  Deleting from MongoDB: ${serviceId}`);
      
      // Use findOneAndDelete to get confirmation of deletion
      const result = await ServiceDefinitionModel.findOneAndDelete({ id: serviceId });
      
      if (result) {
        this.logger.info(`✅ Deleted from MongoDB: ${serviceId} (${(result as any).name})`);
        publishTableEvent({
          resource: 'services',
          event: 'deleted',
          ids: [serviceId],
        });
        return true;
      } else {
        this.logger.warn(`⚠️  Service not found in MongoDB for deletion: ${serviceId}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to delete service definition ${serviceId}:`, error);
      return false;
    }
  }

  // Email Template Methods
  async saveEmailTemplate(template: any): Promise<void> {
    try {
      // Auto-extract variable names from htmlBody ({{variableName}} format)
      const variableMatches = template.htmlBody.match(/\{\{(\w+)\}\}/g) || [];
      const variables = [...new Set(variableMatches.map((match: string) => match.replace(/\{\{|\}\}/g, '')))];

      await EmailTemplateModel.findOneAndUpdate(
        { id: template.id },
        {
          ...template,
          variables,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      this.logger.debug(`Saved email template ${template.id} to MongoDB`);
    } catch (error) {
      this.logger.error(`Failed to save email template ${template.id}:`, error);
      throw error;
    }
  }

  async getEmailTemplate(templateId: string): Promise<any> {
    try {
      const doc = await EmailTemplateModel.findOne({ id: templateId });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get email template ${templateId}:`, error);
      return null;
    }
  }

  async getEmailTemplateByName(name: string): Promise<any> {
    try {
      const doc = await EmailTemplateModel.findOne({ name });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get email template by name ${name}:`, error);
      return null;
    }
  }

  async countEmailTemplates(filters: {
    templateScope?: string;
    eventKey?: string;
    envelopeType?: string;
    phase?: string;
    serviceType?: string;
    isActive?: boolean;
  } = {}): Promise<number> {
    try {
      return await EmailTemplateModel.countDocuments(filters);
    } catch (error) {
      this.logger.error('Failed to count email templates:', error);
      return 0;
    }
  }

  async getAllEmailTemplates(
    limit?: number,
    offset: number = 0,
    filters: {
      templateScope?: string;
      eventKey?: string;
      envelopeType?: string;
      phase?: string;
      serviceType?: string;
      isActive?: boolean;
    } = {}
  ): Promise<any[]> {
    try {
      const docs = await this.applyPagination(
        EmailTemplateModel.find(filters).sort({ createdAt: -1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject());
    } catch (error) {
      this.logger.error('Failed to get all email templates:', error);
      return [];
    }
  }

  async deleteEmailTemplate(templateId: string): Promise<boolean> {
    try {
      const result = await EmailTemplateModel.deleteOne({ id: templateId });
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(`Failed to delete email template ${templateId}:`, error);
      return false;
    }
  }

  // Schema Version Methods (NEW - May 29: Support schema versioning and evolution)
  async saveSchemaVersion(version: string, name: string, schema: any, description?: string): Promise<void> {
    try {
      await SchemaVersionModel.findOneAndUpdate(
        { version },
        {
          version,
          name,
          description,
          schema,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      this.logger.debug(`Saved schema version ${version} to MongoDB`);
    } catch (error) {
      this.logger.error(`Failed to save schema version ${version}:`, error);
      throw error;
    }
  }

  async getSchemaVersion(version: string): Promise<any> {
    try {
      const doc = await SchemaVersionModel.findOne({ version });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get schema version ${version}:`, error);
      return null;
    }
  }

  async getLatestSchemaVersion(): Promise<any> {
    try {
      const doc = await SchemaVersionModel.findOne().sort({ updatedAt: -1 });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error('Failed to get latest schema version:', error);
      return null;
    }
  }

  async getAllSchemaVersions(limit?: number, offset: number = 0): Promise<any[]> {
    try {
      const docs = await this.applyPagination(
        SchemaVersionModel.find({}).sort({ updatedAt: -1 }),
        limit,
        offset
      );
      return docs.map(doc => doc.toObject());
    } catch (error) {
      this.logger.error('Failed to get all schema versions:', error);
      return [];
    }
  }

  async countSchemaVersions(): Promise<number> {
    try {
      return SchemaVersionModel.countDocuments();
    } catch (error) {
      this.logger.error('Failed to count schema versions:', error);
      return 0;
    }
  }
}
