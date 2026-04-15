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
import servicesRouter from './routes/services.js';
import requestsRouter from './routes/requests.js';
import authRouter from './routes/auth.js';
import approvalsRouter from './routes/approvals.js';

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

  const servicesPath = process.env.SERVICES_PATH || './services';
  const serviceRegistry = new ServiceRegistry(servicesPath, logger);
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
  const thirdPartyService = new ThirdPartyService(logger);
  const requestProcessor = new RequestProcessor(logger);
  const approvalProcessor = new ApprovalProcessor(logger, thirdPartyService, stateManager as any);
  const paymentProcessor = new PaymentProcessor(logger, thirdPartyService);
  const processingProcessor = new ProcessingProcessor(logger, thirdPartyService, stateManager as any);
  const deliveryProcessor = new DeliveryProcessor(logger, thirdPartyService);
  const feedbackProcessor = new FeedbackProcessor(logger, thirdPartyService);

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
  app.use('/api/approvals', approvalsRouter);

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

    app.listen(port, () => {
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
