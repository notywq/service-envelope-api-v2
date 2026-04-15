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
}
