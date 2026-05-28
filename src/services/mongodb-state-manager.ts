/**
 * MongoDB-backed State Manager
 * Replaces file-based JSON persistence with MongoDB for scalability
 */

import { ServiceRequest, HistoryEntry } from '../types/envelope.types.js';
import mongoose, { Schema, Document } from 'mongoose';
import { Logger } from 'winston';

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
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  used: { type: Boolean, default: false },
});

interface ApprovalTokenDoc extends Document {
  token: string;
  requestId: string;
  approverId: string;
  expiresAt: Date;
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

  async connect(mongoUri: string): Promise<void> {
    try {
      await mongoose.connect(mongoUri);
      this.logger.info('✅ Connected to MongoDB');
    } catch (error) {
      this.logger.error('❌ Failed to connect to MongoDB:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();
  }

  async saveRequest(request: ServiceRequest): Promise<void> {
    try {
      await ServiceRequestModel.findOneAndUpdate(
        { id: request.id },
        request,
        { upsert: true, new: true }
      );
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

  async listRequests(limit: number = 100, offset: number = 0): Promise<ServiceRequest[]> {
    try {
      const docs = await ServiceRequestModel
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset);
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
      return result.deletedCount > 0;
    } catch (error) {
      this.logger.error(`Failed to delete request ${requestId}:`, error);
      return false;
    }
  }

  async countRequests(): Promise<number> {
    try {
      return await ServiceRequestModel.countDocuments();
    } catch (error) {
      this.logger.error('Failed to count requests:', error);
      return 0;
    }
  }

  async findByStatus(status: string): Promise<ServiceRequest[]> {
    try {
      const docs = await ServiceRequestModel.find({ overallStatus: status });
      return docs.map(doc => doc.toObject() as ServiceRequest);
    } catch (error) {
      this.logger.error(`Failed to find requests with status ${status}:`, error);
      return [];
    }
  }

  async findByType(type: string): Promise<ServiceRequest[]> {
    try {
      const docs = await ServiceRequestModel.find({ type });
      return docs.map(doc => doc.toObject() as ServiceRequest);
    } catch (error) {
      this.logger.error(`Failed to find requests with type ${type}:`, error);
      return [];
    }
  }

  // Approval Token Methods
  async saveApprovalToken(token: string, requestId: string, approverId: string, expiryHours: number = 24): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
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
      const result = await ApprovalTokenModel.deleteMany({ expiresAt: { $lt: new Date() } });
      this.logger.debug(`Deleted ${result.deletedCount} expired approval tokens`);
      return result.deletedCount || 0;
    } catch (error) {
      this.logger.error('Failed to delete expired tokens:', error);
      return 0;
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
      await ServiceDefinitionModel.findOneAndUpdate(
        { id: service.id },
        {
          ...service,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );
      this.logger.debug(`Saved service definition ${service.id} to MongoDB`);
    } catch (error) {
      this.logger.error(`Failed to save service definition ${service.id}:`, error);
      throw error;
    }
  }

  async getServiceDefinition(serviceId: string): Promise<any> {
    try {
      const doc = await ServiceDefinitionModel.findOne({ id: serviceId });
      return doc ? doc.toObject() : null;
    } catch (error) {
      this.logger.error(`Failed to get service definition ${serviceId}:`, error);
      return null;
    }
  }

  async getAllServiceDefinitions(): Promise<any[]> {
    try {
      this.logger.debug('[ServiceRegistry] Querying servicedefinitions collection...');
      const docs = await ServiceDefinitionModel.find({}).sort({ createdAt: -1 });
      this.logger.debug(`[ServiceRegistry] Found ${docs.length} service definitions`);
      if (docs.length === 0) {
        this.logger.warn('[ServiceRegistry] No documents found in servicedefinitions collection');
      }
      return docs.map(doc => doc.toObject());
    } catch (error) {
      this.logger.error('Failed to get all service definitions:', error);
      if (error instanceof Error) {
        this.logger.error('Error details:', error.message);
        this.logger.error('Error stack:', error.stack);
      }
      return [];
    }
  }

  async getServiceDefinitionByType(type: string): Promise<any> {
    try {
      const doc = await ServiceDefinitionModel.findOne({ type });
      return doc ? doc.toObject() : null;
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

  async countEmailTemplates(): Promise<number> {
    try {
      return await EmailTemplateModel.countDocuments();
    } catch (error) {
      this.logger.error('Failed to count email templates:', error);
      return 0;
    }
  }

  async getAllEmailTemplates(): Promise<any[]> {
    try {
      const docs = await EmailTemplateModel.find({}).sort({ createdAt: -1 });
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

  async getAllSchemaVersions(): Promise<any[]> {
    try {
      const docs = await SchemaVersionModel.find({}).sort({ updatedAt: -1 });
      return docs.map(doc => doc.toObject());
    } catch (error) {
      this.logger.error('Failed to get all schema versions:', error);
      return [];
    }
  }
}
