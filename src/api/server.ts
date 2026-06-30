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
import { tableEventsHandler } from '../utils/table-events.js';
import { isAuthRequired, requireApiAuth, requireAuth, validateAuthConfiguration } from './middleware/auth.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Writable } from 'stream';

const isProductionRuntime = process.env.NODE_ENV === 'production';
const logsDirectory = path.resolve(process.cwd(), 'logs');

function getDailyLogFilePath(date: Date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return path.join(logsDirectory, `service-envelope-${day}.log`);
}

function ensureLogsDirectory(): void {
  if (!fs.existsSync(logsDirectory)) {
    fs.mkdirSync(logsDirectory, { recursive: true });
  }
}

function formatConsoleArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function appendProductionConsoleLine(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  ensureLogsDirectory();
  const line = `${new Date().toISOString()} [${level}]: ${args.map(formatConsoleArg).join(' ')}\n`;
  fs.appendFileSync(getDailyLogFilePath(), line, 'utf-8');
}

function installProductionConsoleRedirect(): void {
  if (!isProductionRuntime) {
    return;
  }

  console.log = (...args: unknown[]) => appendProductionConsoleLine('info', args);
  console.info = (...args: unknown[]) => appendProductionConsoleLine('info', args);
  console.debug = (...args: unknown[]) => appendProductionConsoleLine('info', args);
  console.warn = (...args: unknown[]) => appendProductionConsoleLine('warn', args);
  console.error = (...args: unknown[]) => appendProductionConsoleLine('error', args);
}

class DailyLogStream extends Writable {
  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    ensureLogsDirectory();
    fs.appendFile(getDailyLogFilePath(), chunk, encoding, callback);
  }
}

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

function getEnvPresence(name: string): 'set' | 'missing' {
  return process.env[name]?.trim() ? 'set' : 'missing';
}

function getConfiguredMongoSource(): string {
  if (process.env.MONGODB_SRV_URI?.trim()) {
    return 'MONGODB_SRV_URI';
  }
  if (process.env.MONGODB_URI?.trim()) {
    return 'MONGODB_URI';
  }
  return 'missing';
}

function getEmailMode(): string {
  const emailEnabled = process.env.NODE_ENV !== 'development' || process.env.ENABLE_EMAIL === 'true';
  return emailEnabled ? 'smtp' : 'mock';
}

function getDotenvStatus(): string {
  return fs.existsSync(path.resolve(process.cwd(), '.env')) ? 'found' : 'not found';
}

function formatBootValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'n/a';
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatBootValue).join(', ')}]`;
  }
  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function formatBootFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatBootValue(value)}`)
    .join(' | ');
}

function bootLine(section: string, message: string, fields: Record<string, unknown> = {}): string {
  const detail = formatBootFields(fields);
  return detail
    ? `BOOT | ${section.padEnd(12)} | ${message} | ${detail}`
    : `BOOT | ${section.padEnd(12)} | ${message}`;
}

function logStartupEnvironment(): void {
  logger.info(bootLine('Config', 'Runtime loaded', {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || '8000',
    host: process.env.HOST || '127.0.0.1',
    logLevel: process.env.LOG_LEVEL || 'info',
    logTarget: isProductionRuntime ? getDailyLogFilePath() : 'console',
    dotEnv: getDotenvStatus(),
  }));
  logger.info(bootLine('Config', 'API surface', {
    authRequired: isAuthRequired(),
    corsEnabled: isCorsEnabled(),
    apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:8000',
    frontendBaseUrl: process.env.FRONTEND_BASE_URL || 'http://localhost:5173',
  }));
  logger.info(bootLine('Config', 'Integrations', {
    mongoSource: getConfiguredMongoSource(),
    mongoFallback: getEnvPresence('MONGODB_DIRECT_URI'),
    emailMode: getEmailMode(),
    emailHost: process.env.EMAIL_HOST || 'smtp.gmail.com',
    emailUser: getEnvPresence('EMAIL_USER'),
    emailPassword: getEnvPresence('EMAIL_PASSWORD'),
  }));
  logger.info(bootLine('Config', 'Security', {
    jwtSecret: process.env.JWT_SECRET ? 'set' : 'dev default',
    jwtIssuer: process.env.JWT_ISSUER || 'unset',
    jwtAudience: process.env.JWT_AUDIENCE || 'unset',
    otpSecret: getEnvPresence('OTP_SECRET'),
  }));
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

  logger.info(bootLine('MongoDB', 'Primary selected', {
    source: getConfiguredMongoSource(),
    mode: getMongoUriMode(primaryMongoUri),
    target: describeMongoUri(primaryMongoUri),
  }));

  try {
    await stateManager.connect(primaryMongoUri, `MongoDB primary ${getMongoUriMode(primaryMongoUri)}`, false);
    return;
  } catch (error) {
    if (!primaryMongoUri.startsWith('mongodb+srv://') || !isSrvLookupRefused(error)) {
      logger.error(bootLine('MongoDB', 'Primary failed without eligible fallback'), error);
      throw error;
    }

    if (!fallbackMongoUri) {
      logger.error(bootLine('MongoDB', 'SRV fallback unavailable', { fallback: 'MONGODB_DIRECT_URI missing' }));
      throw error;
    }

    logger.warn(bootLine('MongoDB', 'SRV lookup refused', { error: getErrorText(error) }));
    logger.warn(bootLine('MongoDB', 'Switching to fallback', {
      mode: getMongoUriMode(fallbackMongoUri),
      target: describeMongoUri(fallbackMongoUri),
    }));

    await stateManager.connect(fallbackMongoUri, `MongoDB fallback ${getMongoUriMode(fallbackMongoUri)}`);
    logger.info(bootLine('MongoDB', 'Startup continued with fallback'));
  }
}

function createLogFormat(useColor: boolean = false): winston.Logform.Format {
  const formats: winston.Logform.Format[] = [
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
  ];

  if (useColor) {
    formats.push(winston.format.colorize());
  }

  formats.push(winston.format.printf(({ level, message, timestamp, stack, ...metadata }) => {
    const metadataText = Object.keys(metadata).length > 0
      ? ` ${JSON.stringify(metadata)}`
      : '';
    return `${timestamp} [${level}]: ${stack || message}${metadataText}`;
  }));

  return winston.format.combine(...formats);
}

function createLogTransports(): winston.transport[] {
  if (isProductionRuntime) {
    ensureLogsDirectory();
    return [
      new winston.transports.Stream({
        stream: new DailyLogStream(),
        format: createLogFormat(false),
      }),
    ];
  }

  return [
    new winston.transports.Console({
      format: createLogFormat(true),
    }),
  ];
}

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: createLogFormat(false),
  transports: createLogTransports(),
});

installProductionConsoleRedirect();

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

  logger.info(bootLine('System', 'Service Envelope API starting'));
  logStartupEnvironment();

  // Middleware
  if (isCorsEnabled()) {
    const corsOptions = createCorsOptions();
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions));
    logger.info(bootLine('HTTP', 'CORS enabled', { origins: getCorsAllowedOrigins() }));
  } else {
    logger.info(bootLine('HTTP', 'CORS disabled', { enableWith: 'CORS_ENABLED=true' }));
  }
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  // Initialize services
  logger.info(bootLine('Services', 'Initializing'));

  validateAuthConfiguration();

  const stateManager = new MongoDBStateManager(logger);
  await connectMongoWithFallback(stateManager);

  // Email templates are managed via the Phase 2 UI and API endpoints
  // Count templates in MongoDB
  const templateCount = await stateManager.countEmailTemplates();
  logger.info(bootLine('Templates', 'Loaded from MongoDB', { count: templateCount }));

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
      logger.info(bootLine('Schema', 'Seeded canonical schema', { version: TARGET_SCHEMA_VERSION }));
    }

    // Activate latest schema from MongoDB (or local fallback on first-time failure scenarios).
    const latestSchemaDoc = await stateManager.getLatestSchemaVersion();
    const schemaObject = latestSchemaDoc?.schema || localSchemaObject;
    const versionLabel = latestSchemaDoc?.version || TARGET_SCHEMA_VERSION;
    const loadSource = latestSchemaDoc?.schema ? 'MongoDB' : 'Local file fallback';

    initializeValidator(schemaObject);
    logger.info(bootLine('Schema', 'Validator ready', { version: versionLabel, source: loadSource }));
  } catch (err) {
    logger.error(bootLine('Schema', 'Validator failed'), err);
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
    logger.warn(bootLine('Email', 'Mock mode enabled', { reason: 'development without ENABLE_EMAIL=true' }));
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

  logger.info(bootLine('Services', 'Initialized'));

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/OTP', otpRouter);
  app.use('/api/otp', otpRouter);
  app.use('/api/mock', mockServiceApisRouter);  // Mock APIs for local/testing processing tasks
  app.use('/api', requireApiAuth);
  app.get('/api/table-events', tableEventsHandler);
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
  logger.info(bootLine('HTTP', 'Routes mounted', {
    tableEvents: '/api/table-events',
    mockApis: '/api/mock',
    apiRoot: '/api',
  }));

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
        'GET /api/table-events',
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
    const port = Number.parseInt(process.env.PORT || '8000', 10);
    const host = process.env.HOST || '127.0.0.1';

    app.listen(port, host, () => {
      logger.info(bootLine('HTTP', 'Server listening', { host, port }));
      logger.info(bootLine('HTTP', 'API ready', { url: `http://${host}:${port}/api` }));
      logger.info(bootLine('HTTP', 'Health check ready', { url: `http://${host}:${port}/health` }));
      logger.info(bootLine('System', 'Startup complete'));
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
