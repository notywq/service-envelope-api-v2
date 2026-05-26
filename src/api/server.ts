/**
 * Express API Server
 * Main entry point for the Service Envelope System API
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import 'dotenv/config';
import winston from 'winston';
import { MongoDBStateManager } from '../services/mongodb-state-manager.js';
import { ServiceRegistry } from '../services/service-registry.js';
import { EmailService } from '../services/email-service.js';
import { ServiceOrchestrator } from '../core/service-orchestrator.js';
import { RequestProcessor } from '../processors/request-processor.js';
import { ApprovalProcessor } from '../processors/approval-processor.js';
import { PaymentProcessor } from '../processors/payment-processor.js';
import { ProcessingProcessor } from '../processors/processing-processor.js';
import { DeliveryProcessor } from '../processors/delivery-processor.js';
import { FeedbackProcessor } from '../processors/feedback-processor.js';
import { ThirdPartyService } from '../services/third-party-service.js';
import { ServiceRequest, EnvelopeCollection, RequestEnvelope, ApprovalEnvelope, PaymentEnvelope, ProcessingEnvelope, DeliveryEnvelope, FeedbackEnvelope } from '../types/envelope.types.js';
import servicesRouter from './routes/services.js';
import requestsRouter from './routes/requests.js';
import authRouter from './routes/auth.js';
import approvalsRouter from './routes/approvals.js';
import paymentsRouter from './routes/payments.js';
import feedbackRouter from './routes/feedback.js';
import deliveryRouter from './routes/delivery.js';
import deliveryStatusRouter from './routes/delivery-status.js';
import processingRouter from './routes/processing.js';
import adminRouter from './routes/admin.js';
import mockServiceApisRouter from './routes/mock-service-apis.js';

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} [${level}]: ${message}`;
        })
      ),
    }),
  ],
});

export interface AppContext {
  stateManager: MongoDBStateManager;
  serviceRegistry: ServiceRegistry;
  emailService: EmailService;
  orchestrator: ServiceOrchestrator;
  logger: winston.Logger;
}

// Global context object
export let appContext: AppContext;



/**
 * Service definitions are loaded exclusively from MongoDB
 * Phase 2 - No YAML file fallback. All services managed via API or pre-populated in MongoDB
 * To add services: Use POST /api/admin/services or update MongoDB directly
 */

async function initializeApp(): Promise<Express> {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // Initialize services
  logger.info('🔧 Initializing services...');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/service-envelope';
  const stateManager = new MongoDBStateManager(logger);
  await stateManager.connect(mongoUri);

  // Email templates are managed via the Phase 2 UI and API endpoints
  // No seeding - system relies on MongoDB templates only
  logger.info('📧 Email template system: Fetching templates from MongoDB on-demand');

  // Phase 2: All services are loaded exclusively from MongoDB
  const serviceRegistry = new ServiceRegistry(logger, stateManager);
  await serviceRegistry.loadServices();

  const emailService = new EmailService(logger);
  if (process.env.NODE_ENV !== 'development' || process.env.ENABLE_EMAIL === 'true') {
    await emailService.initialize({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASSWORD || '',
      },
      from: process.env.EMAIL_FROM || 'noreply@mapua.edu.ph',
    });
  } else {
    logger.warn('⚠️  Email service running in mock mode (development)');
  }

  // Instantiate all processors
  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:8000';
  const uiBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:5173'; // Phase 2 Dashboard URL for approval links
  const phase2PaymentUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:5173'; // Phase 2 payment UI
  const thirdPartyService = new ThirdPartyService(logger, emailService, stateManager as any);
  const requestProcessor = new RequestProcessor(logger);
  const approvalProcessor = new ApprovalProcessor(logger, thirdPartyService, stateManager as any, emailService, uiBaseUrl, phase2PaymentUrl);
  const paymentProcessor = new PaymentProcessor(logger, thirdPartyService, stateManager as any, emailService);
  const processingProcessor = new ProcessingProcessor(logger, stateManager as any, emailService);
  const deliveryProcessor = new DeliveryProcessor(logger, stateManager as any, emailService);
  const feedbackProcessor = new FeedbackProcessor(logger, thirdPartyService, stateManager as any, emailService, uiBaseUrl);

  const orchestrator = new ServiceOrchestrator(
    requestProcessor,
    approvalProcessor,
    paymentProcessor,
    processingProcessor,
    deliveryProcessor,
    feedbackProcessor,
    stateManager as any,
    logger
  );

  // Store context globally for routes
  appContext = {
    stateManager,
    serviceRegistry,
    emailService,
    orchestrator,
    logger,
  };

  logger.info('✅ All services initialized');

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/feedback', feedbackRouter);
  app.use('/api/delivery', deliveryRouter);
  app.use('/api/delivery-status', deliveryStatusRouter);
  app.use('/api/processing', processingRouter);
  app.use('/api/webhooks', paymentsRouter);
  app.use('/api/mock', mockServiceApisRouter);  // Mock APIs for testing

  // Unified submit endpoint - service_id in request body
  app.post('/api/submit', async (req: Request, res: Response) => {
    try {
      const { service_id, ...parameters } = req.body;

      if (!service_id) {
        return res.status(400).json({ error: 'service_id is required in request body' });
      }

      const service = appContext.serviceRegistry.getService(service_id);
      if (!service) {
        return res.status(404).json({ error: `Service ${service_id} not found` });
      }

      appContext.logger.info(`📝 Submitting request for service: ${service_id}`);

      // Helper function from services route - create request
      const { randomUUID } = await import('crypto');
      const requestId = `req-${Date.now()}-${randomUUID().substring(0, 8)}`;
      const now = new Date().toISOString();

      const envelopes: EnvelopeCollection = {
        request: {
          status: 'in_progress',
          timestamp: now,
          required: true,
          sourceSystem: parameters.sourceSystem || 'api',
          validationStatus: 'passed',
          validationErrors: [],
          parameters: parameters,
        } as RequestEnvelope,
        approval: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.approval?.required || false,
          approvers: service.envelopes?.approval?.approvers || [],
          approvalRules: service.envelopes?.approval?.approvalRules || { type: 'all_must_approve' },
        } as ApprovalEnvelope,
        payment: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.payment?.required || false,
          charges: service.envelopes?.payment?.charges || [],
          paymentMethod: 'credit_card',
        } as PaymentEnvelope,
        processing: {
          status: 'pending',
          timestamp: now,
          required: true,
          tasks: service.envelopes?.processing?.tasks || [],
        } as ProcessingEnvelope,
        delivery: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.delivery?.required || false,
          method: service.envelopes?.delivery?.method || 'email',
          details: service.envelopes?.delivery?.details || {},
          deliveryAttempts: 0,
        } as DeliveryEnvelope,
        feedback: {
          status: 'pending',
          timestamp: now,
          required: service.envelopes?.feedback?.required || false,
        } as FeedbackEnvelope,
      };

      const serviceRequest: ServiceRequest = {
        id: requestId,
        type: service_id,
        initiator: parameters.initiator || parameters.studentId || 'unknown',
        overallStatus: 'queued' as const,
        createdAt: now,
        lastUpdated: now,
        history: [
          {
            status: 'queued',
            timestamp: now,
            envelope: 'system',
            notes: 'Request submitted via /api/submit',
          },
        ],
        envelopes,
      } as ServiceRequest;

      await appContext.stateManager.saveRequest(serviceRequest);
      appContext.logger.info(`✅ Request created: ${requestId}`);

      appContext.orchestrator.processRequest(serviceRequest).subscribe({
        next: (result) => {
          appContext.logger.info(`📊 Request processed: ${result.id} -> ${result.overallStatus}`);
        },
        error: (err) => {
          appContext.logger.error(`❌ Error processing request: ${err.message}`);
        },
      });

      res.status(201).json({
        requestId,
        status: 'queued',
        message: 'Request submitted successfully',
        service: {
          id: service_id,
          name: service.name,
        },
      });
    } catch (error) {
      appContext.logger.error('Error submitting request:', error);
      res.status(500).json({ error: 'Failed to submit request', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API info
  app.get('/api', (req: Request, res: Response) => {
    res.json({
      name: 'Service Envelope API',
      version: '1.0.0',
      endpoints: [
        'POST /api/auth/login',
        'GET /api/services',
        'POST /api/services/:serviceId/submit',
        'GET /api/requests',
        'GET /api/requests/:requestId',
        'POST /api/requests/:requestId/resume',
        'POST /api/approvals/:token/approve',
        'POST /api/approvals/:token/deny',
      ],
    });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Route not found', path: req.path });
  });

  // Error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  return app;
}

// Start server
async function start(): Promise<void> {
  try {
    const app = await initializeApp();
    const port = process.env.PORT || 8000;

    app.listen(8000, "127.0.0.1", () => {
      logger.info(`🚀 Server listening on port ${port}`);
      logger.info(`📍 API available at http://localhost:${port}/api`);
      logger.info(`💚 Health check at http://localhost:${port}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
