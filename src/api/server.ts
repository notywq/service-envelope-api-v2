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
import { RequestProcessingLock } from '../utils/request-processing-lock.js';
import servicesRouter from './routes/services.js';
import requestsRouter from './routes/requests.js';
import authRouter from './routes/auth.js';
import otpRouter from './routes/otp.js';
import approvalsRouter from './routes/approvals.js';
import paymentsRouter from './routes/payments.js';
import feedbackRouter from './routes/feedback.js';
import deliveryRouter from './routes/delivery.js';
import deliveryStatusRouter from './routes/delivery-status.js';
import processingRouter from './routes/processing.js';
import adminRouter from './routes/admin.js';
import mockServiceApisRouter from './routes/mock-service-apis.js';
import { initializeValidator } from '../utils/schema-validator.js';
import { requireApiAuth, requireAuth, validateAuthConfiguration } from './middleware/auth.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

function resolveCanonicalSchemaPath(): string {
  const cwdSchemaPath = path.resolve(process.cwd(), 'src', 'schemas', 'service-definition.schema.json');
  if (fs.existsSync(cwdSchemaPath)) {
    return cwdSchemaPath;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '../schemas/service-definition.schema.json');
}

function getMongoUriMode(uri: string): string {
  if (uri.startsWith('mongodb+srv://')) {
    return 'SRV';
  }

  if (uri.startsWith('mongodb://')) {
    return 'direct URI';
  }

  return 'custom URI';
}

function describeMongoUri(uri: string): string {
  const schemeMatch = uri.match(/^(mongodb(?:\+srv)?):\/\//);
  const scheme = schemeMatch?.[1] || 'mongodb';
  const withoutScheme = uri.replace(/^mongodb(?:\+srv)?:\/\//, '');
  const withoutCredentials = withoutScheme.includes('@')
    ? withoutScheme.slice(withoutScheme.indexOf('@') + 1)
    : withoutScheme;
  const hostSegment = withoutCredentials.split('/')[0];
  const hostCount = hostSegment.split(',').filter(Boolean).length;
  const pathStart = withoutCredentials.indexOf('/');
  const pathOnly = pathStart >= 0 ? withoutCredentials.slice(pathStart).split('?')[0] : '';
  const hostDescription = hostCount > 1 ? `${hostCount} hosts` : hostSegment;

  return `${scheme}://${hostDescription}${pathOnly}`;
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    const causeText = 'cause' in error ? getErrorText(error.cause) : '';
    return `${error.name} ${error.message} ${causeText}`.trim();
  }

  return String(error);
}

function isSrvLookupRefused(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase();

  return text.includes('querysrv')
    && text.includes('econnrefused')
    && text.includes('_mongodb._tcp');
}

function getCorsAllowedOrigins(): string[] {
  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  return [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
}

function getCorsAllowedHeaders(): string[] {
  const configuredHeaders = (process.env.CORS_ALLOWED_HEADERS || '')
    .split(',')
    .map(header => header.trim())
    .filter(Boolean);

  if (configuredHeaders.length > 0) {
    return configuredHeaders;
  }

  return ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'];
}

function isCorsEnabled(): boolean {
  if (process.env.CORS_ENABLED === 'true') {
    return true;
  }
  if (process.env.CORS_ENABLED === 'false') {
    return false;
  }

  return process.env.SWAGGER_UI_ENABLED === 'true';
}

function createCorsOptions(): cors.CorsOptions {
  const allowedOrigins = getCorsAllowedOrigins();

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: getCorsAllowedHeaders(),
    credentials: false,
  };
}

async function connectMongoWithFallback(stateManager: MongoDBStateManager): Promise<void> {
  const primaryMongoUri = process.env.MONGODB_SRV_URI || process.env.MONGODB_URI;
  if (!primaryMongoUri) {
    throw new Error('MongoDB connection is required. Set MONGODB_SRV_URI or MONGODB_URI.');
  }
  const fallbackMongoUri = process.env.MONGODB_DIRECT_URI
    || (process.env.MONGODB_SRV_URI && process.env.MONGODB_URI?.startsWith('mongodb://')
      ? process.env.MONGODB_URI
      : undefined);

  logger.info(`[MongoDB] Primary connection: ${getMongoUriMode(primaryMongoUri)} (${describeMongoUri(primaryMongoUri)})`);

  try {
    await stateManager.connect(primaryMongoUri, `MongoDB primary ${getMongoUriMode(primaryMongoUri)}`, false);
    return;
  } catch (error) {
    if (!primaryMongoUri.startsWith('mongodb+srv://') || !isSrvLookupRefused(error)) {
      logger.error(`[MongoDB] Primary connection failed without eligible SRV fallback:`, error);
      throw error;
    }

    if (!fallbackMongoUri) {
      logger.error('[MongoDB] SRV lookup was refused, but MONGODB_DIRECT_URI is not configured.');
      throw error;
    }

    logger.warn(`[MongoDB] SRV lookup refused: ${getErrorText(error)}`);
    logger.warn(`[MongoDB] Switching to fallback connection: ${getMongoUriMode(fallbackMongoUri)} (${describeMongoUri(fallbackMongoUri)})`);

    await stateManager.connect(fallbackMongoUri, `MongoDB fallback ${getMongoUriMode(fallbackMongoUri)}`);
    logger.info('[MongoDB] Startup continued with MongoDB fallback connection.');
  }
}

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
  requestProcessingLock: RequestProcessingLock;
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
  if (isCorsEnabled()) {
    const corsOptions = createCorsOptions();
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));
    logger.info(`[CORS] Enabled for origins: ${getCorsAllowedOrigins().join(', ')}`);
  } else {
    logger.info('[CORS] Disabled. Set CORS_ENABLED=true when using browser-based Swagger UI or frontend clients.');
  }
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // Initialize services
  logger.info('🔧 Initializing services...');

  validateAuthConfiguration();

  const stateManager = new MongoDBStateManager(logger);
  await connectMongoWithFallback(stateManager);

  // Email templates are managed via the Phase 2 UI and API endpoints
  // Count templates in MongoDB
  const templateCount = await stateManager.countEmailTemplates();
  logger.info(`📧 Email template system: ${templateCount} templates available in MongoDB`);

  // Load schema from MongoDB and initialize validator
  try {
    const TARGET_SCHEMA_VERSION = '1.0.5';
    const TARGET_SCHEMA_NAME = 'Service Definition Schema v1.0.5';

    // Always load local canonical schema file and ensure target version exists in MongoDB.
    const schemaPath = resolveCanonicalSchemaPath();
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const localSchemaObject = JSON.parse(schemaContent);

    const targetVersionDoc = await stateManager.getSchemaVersion(TARGET_SCHEMA_VERSION);
    if (!targetVersionDoc) {
      await stateManager.saveSchemaVersion(
        TARGET_SCHEMA_VERSION,
        TARGET_SCHEMA_NAME,
        localSchemaObject,
        localSchemaObject.description || 'Canonical service definition schema'
      );
      logger.info(`📋 [SCHEMA-VALIDATOR] Seeded schema v${TARGET_SCHEMA_VERSION} into MongoDB`);
    }

    // Activate latest schema from MongoDB (or local fallback on first-time failure scenarios).
    const latestSchemaDoc = await stateManager.getLatestSchemaVersion();
    const schemaObject = latestSchemaDoc?.schema || localSchemaObject;
    const versionLabel = latestSchemaDoc?.version || TARGET_SCHEMA_VERSION;
    const loadSource = latestSchemaDoc?.schema ? 'MongoDB' : 'Local file fallback';

    initializeValidator(schemaObject);
    logger.info(`📋 [SCHEMA-VALIDATOR] Schema v${versionLabel} - Loaded from ${loadSource}`);
  } catch (err) {
    logger.error(`📋 [SCHEMA-VALIDATOR] Failed to initialize validator:`, err);
    throw err; // Critical - cannot proceed without schema
  }

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
  const paymentProcessor = new PaymentProcessor(logger, thirdPartyService, stateManager as any);
  const processingProcessor = new ProcessingProcessor(logger, stateManager as any);
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

  // Initialize request processing lock
  const requestProcessingLock = new RequestProcessingLock(logger);

  // Store context globally for routes
  appContext = {
    stateManager,
    serviceRegistry,
    emailService,
    orchestrator,
    requestProcessingLock,
    logger,
  };

  logger.info('✅ All services initialized');

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/OTP', otpRouter);
  app.use('/api/otp', otpRouter);
  app.use('/api/mock', mockServiceApisRouter);  // Mock APIs for local/testing processing tasks
  app.use('/api', requireApiAuth);
  app.use('/api/services', servicesRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/admin', requireAuth({ roles: ['admin'] }), adminRouter);
  app.use('/api/approvals', approvalsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/feedback', feedbackRouter);
  app.use('/api/delivery', deliveryRouter);
  app.use('/api/delivery-status', deliveryStatusRouter);
  app.use('/api/processing', processingRouter);
  app.use('/api/webhooks', paymentsRouter);

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
        'POST /api/OTP/send',
        'POST /api/OTP/verify',
        'POST /api/OTP/cancel',
        'POST /api/OTP/flush',
        'GET /api/auth/me',
        'POST /api/auth/verify',
        'GET /api/services',
        'POST /api/requests',
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
