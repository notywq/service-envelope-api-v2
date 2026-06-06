/**
 * Admin Routes
 * Handles admin operations like service creation and system management
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import YAML from 'yaml';
import { validateServiceDefinition, getServiceSchema, initializeValidator } from '../../utils/schema-validator.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const router = Router();

function resolveCanonicalSchemaPath(): string {
  const cwdSchemaPath = path.resolve(process.cwd(), 'src', 'schemas', 'service-definition.schema.json');
  if (fs.existsSync(cwdSchemaPath)) {
    return cwdSchemaPath;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.join(__dirname, '../../schemas/service-definition.schema.json');
}

function normalizeServiceDefinitionShape(
  parsedYaml: any,
  opts: {
    yamlContent: string;
    name?: string;
    type?: string;
    initiator?: string;
    isCreate: boolean;
    schemaVersion?: string;
    schemaName?: string;
  }
): any {
  const resolvedId = parsedYaml.id || parsedYaml.serviceId;
  const resolvedType = opts.type || parsedYaml.type;
  const resolvedName = opts.name || parsedYaml.name;
  const resolvedInitiator = opts.initiator || parsedYaml.initiator;
  const resolvedDescription = parsedYaml.description || resolvedName;

  // Canonical definition object follows service-definition.schema.json.
  const canonicalDefinition = {
    ...parsedYaml,
    id: resolvedId,
    type: resolvedType,
    name: resolvedName,
    description: resolvedDescription,
    initiator: resolvedInitiator,
    envelopes: parsedYaml.envelopes || {},
  };

  return {
    ...canonicalDefinition,
    serviceId: parsedYaml.serviceId || resolvedId, // Backward-compatible alias
    yaml: opts.yamlContent,
    definition: canonicalDefinition, // Keep nested mirror for legacy readers
    schemaVersion: opts.schemaVersion || 'unversioned',
    schemaName: opts.schemaName || 'Service Definition Schema (dynamic)',
    validatedAt: new Date().toISOString(),
    ...(opts.isCreate ? { createdAt: new Date().toISOString() } : {}),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * POST /api/admin/services
 * Create a new service definition
 */
router.post('/services', async (req: Request, res: Response) => {
  try {
    const { name, yaml: yamlContent, type, initiator } = req.body;

    // Validate required fields
    if (!name || !yamlContent || !type || !initiator) {
      return res.status(400).json({
        error: 'Missing required fields: name, yaml, type, initiator',
      });
    }

    // Parse and validate YAML
    let parsedYaml;
    try {
      parsedYaml = YAML.parse(yamlContent) as any;
    } catch (err: any) {
      return res.status(400).json({
        error: `Invalid YAML: ${err.message}`,
      });
    }

    // Use latest schema metadata from MongoDB (dynamic, no hardcoded version labels).
    const latestSchema = await appContext.stateManager.getLatestSchemaVersion();

    // Normalize first so schema validation runs against the canonical persisted shape.
    const serviceDefinition = normalizeServiceDefinitionShape(parsedYaml, {
      yamlContent,
      name,
      type,
      initiator,
      isCreate: true,
      schemaVersion: latestSchema?.version,
      schemaName: latestSchema?.name,
    });

    // Validate entire service definition against canonical JSON Schema (NEW May 29: Full YAML schema validation)
    appContext.logger.info(`[SCHEMA-VALIDATOR] Validating service definition against canonical schema...`);
    const schemaValidation = validateServiceDefinition(serviceDefinition.definition);
    if (!schemaValidation.valid) {
      const errorDetails = schemaValidation.errors?.map(e => `${e.path}: ${e.message}`).join('; ') || 'Unknown error';
      appContext.logger.warn(`[SCHEMA-VALIDATOR] ❌ Schema validation failed: ${errorDetails}`);
      return res.status(400).json({
        error: 'Service definition does not match schema',
        details: schemaValidation.errors,
      });
    }
    appContext.logger.info(`[SCHEMA-VALIDATOR] ✅ Schema validation passed`);

    // Additional envelope structure validation (redundant but kept for backward compatibility)
    if (!serviceDefinition.definition.envelopes || !serviceDefinition.definition.envelopes.request) {
      return res.status(400).json({
        error: 'Missing required envelope: request (REQUEST envelope is always required)',
      });
    }

    appContext.logger.info(`📝 Creating new service: ${type} (${name})`);;

    // Save to MongoDB
    try {
      await appContext.stateManager.saveServiceDefinition(serviceDefinition);
      appContext.logger.info(`✅ Service "${name}" saved to MongoDB`);
    } catch (err) {
      appContext.logger.error(`❌ Failed to save service to MongoDB:`, err);
      return res.status(500).json({
        error: 'Failed to save service to database',
      });
    }

    // Also register in ServiceRegistry for immediate use
    appContext.serviceRegistry.registerService(serviceDefinition);
    
    res.status(201).json({
      success: true,
      message: `Service "${name}" created successfully`,
      service: {
        id: serviceDefinition.id,
        name: serviceDefinition.name,
        type: serviceDefinition.type,
        schemaVersion: serviceDefinition.schemaVersion,
        validatedAt: serviceDefinition.validatedAt,
        createdAt: serviceDefinition.createdAt,
      },
    });
  } catch (error: any) {
    appContext.logger.error('Error creating service:', error);
    res.status(500).json({
      error: 'Failed to create service: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * PUT /api/admin/services/:serviceId
 * Update an existing service definition
 */
router.put('/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const { serviceId } = req.params;
    const { name, yaml: yamlContent, type, initiator } = req.body;

    // Validate required fields
    if (!name || !yamlContent || !type || !initiator) {
      return res.status(400).json({
        error: 'Missing required fields: name, yaml, type, initiator',
      });
    }

    // Parse and validate YAML
    let parsedYaml;
    try {
      parsedYaml = YAML.parse(yamlContent) as any;
    } catch (err: any) {
      return res.status(400).json({
        error: `Invalid YAML: ${err.message}`,
      });
    }

    // Use latest schema metadata from MongoDB (dynamic, no hardcoded version labels).
    const latestSchema = await appContext.stateManager.getLatestSchemaVersion();

    // Normalize first so schema validation runs against the canonical persisted shape.
    const updatedServiceDefinition = normalizeServiceDefinitionShape(parsedYaml, {
      yamlContent,
      name,
      type,
      initiator,
      isCreate: false,
      schemaVersion: latestSchema?.version,
      schemaName: latestSchema?.name,
    });

    // Validate entire service definition against canonical JSON Schema
    appContext.logger.info(`[SCHEMA-VALIDATOR] Validating service definition update against canonical schema...`);
    const schemaValidation = validateServiceDefinition(updatedServiceDefinition.definition);
    if (!schemaValidation.valid) {
      const errorDetails = schemaValidation.errors?.map(e => `${e.path}: ${e.message}`).join('; ') || 'Unknown error';
      appContext.logger.warn(`[SCHEMA-VALIDATOR] ❌ Schema validation failed: ${errorDetails}`);
      return res.status(400).json({
        error: 'Service definition does not match schema',
        details: schemaValidation.errors,
      });
    }
    appContext.logger.info(`[SCHEMA-VALIDATOR] ✅ Schema validation passed`);

    // Additional envelope structure validation
    if (!updatedServiceDefinition.definition.envelopes || !updatedServiceDefinition.definition.envelopes.request) {
      return res.status(400).json({
        error: 'Missing required envelope: request (REQUEST envelope is always required)',
      });
    }

    appContext.logger.info(`📝 Updating service: ${serviceId}`);

    // Save to MongoDB
    try {
      await appContext.stateManager.saveServiceDefinition(updatedServiceDefinition);
      appContext.logger.info(`✅ Service "${name}" updated in MongoDB`);
    } catch (err) {
      appContext.logger.error(`❌ Failed to update service in MongoDB:`, err);
      return res.status(500).json({
        error: 'Failed to update service in database',
      });
    }

    // Also register in ServiceRegistry for immediate use
    appContext.serviceRegistry.registerService(updatedServiceDefinition);
    
    res.status(200).json({
      success: true,
      message: `Service "${name}" updated successfully`,
      service: {
        id: updatedServiceDefinition.id,
        name: updatedServiceDefinition.name,
        type: updatedServiceDefinition.type,
        schemaVersion: updatedServiceDefinition.schemaVersion,
        validatedAt: updatedServiceDefinition.validatedAt,
        updatedAt: updatedServiceDefinition.updatedAt,
      },
    });
  } catch (error: any) {
    appContext.logger.error('Error updating service:', error);
    res.status(500).json({
      error: 'Failed to update service: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/admin/services
 * List all service definitions (for admin management)
 */
router.get('/services', async (req: Request, res: Response) => {
  try {
    const services = await appContext.stateManager.getAllServiceDefinitions();
    res.json({
      services,
      total: services.length,
    });
  } catch (error) {
    appContext.logger.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

/**
 * GET /api/admin/audit-logs
 * Get system audit logs
 */
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '100'), 1000);
    const offset = parseInt(req.query.offset as string || '0');

    // TODO: Fetch from audit log collection in MongoDB
    res.json({
      logs: [],
      total: 0,
      limit,
      offset,
    });
  } catch (error) {
    appContext.logger.error('Error fetching audit logs:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

/**
 * POST /api/admin/email-templates
 * Create a new email template
 */
router.post('/email-templates', async (req: Request, res: Response) => {
  try {
    const { id, name, subject, htmlBody, description, envelopeType, phase, templateScope, eventKey, serviceType, isActive } = req.body;

    // Validate required fields
    if (!id || !name || !subject || !htmlBody) {
      return res.status(400).json({
        error: 'Missing required fields: id, name, subject, htmlBody',
      });
    }

    const template = {
      id,
      name,
      subject,
      htmlBody,
      description: description || '',
      templateScope: templateScope || undefined,
      eventKey: eventKey || undefined,
      serviceType: serviceType || undefined,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      envelopeType: envelopeType || undefined,
      phase: phase || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    appContext.logger.info(`📧 Creating new email template: ${id} (${name})`);
    await appContext.stateManager.saveEmailTemplate(template);
    appContext.logger.info(`✅ Email template "${name}" created successfully`);

    res.status(201).json({
      success: true,
      message: `Email template "${name}" created successfully`,
      template: {
        id: template.id,
        name: template.name,
        subject: template.subject,
        htmlBody: template.htmlBody,
        description: template.description,
        templateScope: template.templateScope,
        eventKey: template.eventKey,
        serviceType: template.serviceType,
        isActive: template.isActive,
        envelopeType: template.envelopeType,
        phase: template.phase,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
      },
    });
  } catch (error: any) {
    appContext.logger.error('Error creating email template:', error);
    res.status(500).json({
      error: 'Failed to create email template: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/admin/email-templates
 * List all email templates
 */
router.get('/email-templates', async (req: Request, res: Response) => {
  try {
    const templates = await appContext.stateManager.getAllEmailTemplates();
    const filteredTemplates = templates.filter(t => {
      const templateScope = req.query.templateScope as string | undefined;
      const eventKey = req.query.eventKey as string | undefined;
      const envelopeType = req.query.envelopeType as string | undefined;
      const phase = req.query.phase as string | undefined;
      const serviceType = req.query.serviceType as string | undefined;
      const isActive = req.query.isActive as string | undefined;

      if (templateScope && t.templateScope !== templateScope) return false;
      if (eventKey && t.eventKey !== eventKey) return false;
      if (envelopeType && t.envelopeType !== envelopeType) return false;
      if (phase && t.phase !== phase) return false;
      if (serviceType && t.serviceType !== serviceType) return false;
      if (isActive !== undefined && String(Boolean(t.isActive)) !== isActive) return false;

      return true;
    });

    const formattedTemplates = filteredTemplates.map(t => ({
      id: t.id,
      name: t.name,
      subject: t.subject,
      htmlBody: t.htmlBody,
      description: t.description,
      templateScope: t.templateScope,
      eventKey: t.eventKey,
      serviceType: t.serviceType,
      isActive: t.isActive,
      envelopeType: t.envelopeType,
      phase: t.phase,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
    res.json({
      templates: formattedTemplates,
      total: formattedTemplates.length,
    });
  } catch (error) {
    appContext.logger.error('Error fetching email templates:', error);
    res.status(500).json({ error: 'Failed to fetch email templates' });
  }
});

/**
 * GET /api/admin/email-templates/:templateId
 * Get a single email template
 */
router.get('/email-templates/:templateId', async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const template = await appContext.stateManager.getEmailTemplate(templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Email template not found' });
    }
    
    res.json({
      id: template.id,
      name: template.name,
      subject: template.subject,
      htmlBody: template.htmlBody,
      description: template.description,
      templateScope: template.templateScope,
      eventKey: template.eventKey,
      serviceType: template.serviceType,
      isActive: template.isActive,
      envelopeType: template.envelopeType,
      phase: template.phase,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    });
  } catch (error) {
    appContext.logger.error('Error fetching email template:', error);
    res.status(500).json({ error: 'Failed to fetch email template' });
  }
});

/**
 * PUT /api/admin/email-templates/:templateId
 * Update an email template
 */
router.put('/email-templates/:templateId', async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    const { name, subject, htmlBody, description, envelopeType, phase, templateScope, eventKey, serviceType, isActive } = req.body;

    // Validate required fields
    if (!name || !subject || !htmlBody) {
      return res.status(400).json({
        error: 'Missing required fields: name, subject, htmlBody',
      });
    }

    const template = {
      id: templateId,
      name,
      subject,
      htmlBody,
      description: description || '',
      templateScope: templateScope || undefined,
      eventKey: eventKey || undefined,
      serviceType: serviceType || undefined,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      envelopeType: envelopeType || undefined,
      phase: phase || undefined,
      updatedAt: new Date().toISOString(),
    };

    appContext.logger.info(`📧 Updating email template: ${templateId}`);
    await appContext.stateManager.saveEmailTemplate(template);
    appContext.logger.info(`✅ Email template "${name}" updated successfully`);

    res.json({
      success: true,
      message: `Email template "${name}" updated successfully`,
      template: {
        id: template.id,
        name: template.name,
        subject: template.subject,
        htmlBody: template.htmlBody,
        description: template.description,
        templateScope: template.templateScope,
        eventKey: template.eventKey,
        serviceType: template.serviceType,
        isActive: template.isActive,
        envelopeType: template.envelopeType,
        phase: template.phase,
        updatedAt: template.updatedAt,
      },
    });
  } catch (error: any) {
    appContext.logger.error('Error updating email template:', error);
    res.status(500).json({
      error: 'Failed to update email template: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * DELETE /api/admin/email-templates/:templateId
 * Delete an email template
 */
router.delete('/email-templates/:templateId', async (req: Request, res: Response) => {
  try {
    const { templateId } = req.params;
    
    const deleted = await appContext.stateManager.deleteEmailTemplate(templateId);
    if (!deleted) {
      return res.status(404).json({ error: 'Email template not found' });
    }

    appContext.logger.info(`✅ Email template "${templateId}" deleted successfully`);
    res.json({
      success: true,
      message: `Email template "${templateId}" deleted successfully`,
    });
  } catch (error: any) {
    appContext.logger.error('Error deleting email template:', error);
    res.status(500).json({
      error: 'Failed to delete email template: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/admin/approval-tokens/:requestId
 * Get approval tokens for a request (for testing/admin purposes)
 */
router.get('/approval-tokens/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    // Get tokens for this request (will need to add method to StateManager)
    // For now, return approvers and link to get tokens via approval processor
    const approvers = request.envelopes.approval.approvers;
    const tokens: any[] = [];

    for (const approver of approvers) {
      // In a real scenario, we'd retrieve the actual tokens from the database
      // For testing, we'll show placeholder tokens
      tokens.push({
        approverId: approver.id,
        approverRole: approver.role,
        approverStatus: approver.status,
        note: 'Approval tokens are generated when request enters approval envelope and sent via email',
      });
    }

    res.json({
      requestId,
      approvalRules: request.envelopes.approval.approvalRules,
      message: 'Approval tokens are generated and sent via email to approvers',
      approvers: tokens,
    });
  } catch (error: any) {
    appContext.logger.error('Error retrieving approval tokens:', error);
    res.status(500).json({
      error: 'Failed to retrieve approval tokens: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * Validate optional envelope structure (NEW May 29, 2026)
 * Helper function to validate optional envelopes that can be empty if required:false
 * 
 * RULES:
 *   - Optional envelopes can be: omitted, empty {}, or { required: false }
 *   - If envelope is present but required: true, validate all required fields
 *   - If envelope has required: false, no validation needed (will be skipped)
 */
function validateOptionalEnvelopes(envelopes: any, logger: any): { valid: boolean; error?: string } {
  const optionalEnvelopeNames = ['approval', 'payment', 'processing', 'delivery', 'feedback'];
  
  for (const envName of optionalEnvelopeNames) {
    const envelope = envelopes[envName];
    
    // If envelope not present, it's ok (will be skipped)
    if (!envelope) {
      logger.debug(`[ENVELOPE-VALIDATION] ${envName} not present (optional, will be skipped)`);
      continue;
    }
    
    // If envelope has required: false, it's ok (will be skipped)
    if (envelope.required === false) {
      logger.info(`[ENVELOPE-VALIDATION] ${envName} marked as optional (required: false, will be skipped)`);
      continue;
    }
    
    // If envelope has required: true or no required field, validate content based on type
    logger.info(`[ENVELOPE-VALIDATION] ${envName} marked as required, validating configuration...`);
    
    switch (envName) {
      case 'approval':
        if (!envelope.approvalRules) {
          return { valid: false, error: 'approval envelope: missing approvalRules' };
        }
        break;
        
      case 'payment':
        if (!envelope.charges || envelope.charges.length === 0) {
          return { valid: false, error: 'payment envelope: missing or empty charges array' };
        }
        break;
        
      case 'processing':
        if (!envelope.tasks || envelope.tasks.length === 0) {
          return { valid: false, error: 'processing envelope: missing or empty tasks array' };
        }
        break;
        
      case 'delivery':
        if (!envelope.deliveryMethods) {
          return { valid: false, error: 'delivery envelope: missing deliveryMethods' };
        }
        break;
        
      case 'feedback':
        if (!envelope.expiryDays) {
          return { valid: false, error: 'feedback envelope: missing expiryDays' };
        }
        break;
    }
  }
  
  logger.info('[ENVELOPE-VALIDATION] All envelopes validated successfully');
  return { valid: true };
}

// Attach validator to router for access in route handlers
(router as any).validateOptionalEnvelopes = validateOptionalEnvelopes;

/**
 * POST /api/admin/schema/upload
 * Upload a schema version to MongoDB and activate it in AJV validator.
 * If schema is omitted in body, loads from local src/schemas/service-definition.schema.json.
 */
router.post('/schema/upload', async (req: Request, res: Response) => {
  try {
    const {
      version = '1.0.3',
      name = 'Service Definition Schema v1.0.3',
      description,
      schema,
    } = req.body || {};

    let schemaToUpload = schema;
    let source = 'request-body';

    if (!schemaToUpload) {
      const schemaPath = resolveCanonicalSchemaPath();
      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
      schemaToUpload = JSON.parse(schemaContent);
      source = 'local-file';
    }

    if (!schemaToUpload || typeof schemaToUpload !== 'object' || Array.isArray(schemaToUpload)) {
      return res.status(400).json({
        error: 'Invalid schema payload. Expected JSON schema object.',
      });
    }

    // Keep previous validator state in case upload/save fails after validation pass.
    const previousSchemaDoc = await appContext.stateManager.getLatestSchemaVersion();

    // Validate schema compiles in AJV before saving.
    try {
      initializeValidator(schemaToUpload);
    } catch (compileErr: any) {
      if (previousSchemaDoc?.schema) {
        initializeValidator(previousSchemaDoc.schema);
      }
      return res.status(400).json({
        error: 'Schema compilation failed in AJV',
        details: compileErr?.message || 'Unknown schema compilation error',
      });
    }

    await appContext.stateManager.saveSchemaVersion(
      version,
      name,
      schemaToUpload,
      description || schemaToUpload.description || 'Uploaded via /api/admin/schema/upload'
    );

    const uploadedSchemaDoc = await appContext.stateManager.getSchemaVersion(version);

    appContext.logger.info(`✅ Uploaded schema version ${version} (source: ${source})`);

    res.status(201).json({
      success: true,
      message: `Schema v${version} uploaded and activated`,
      version,
      name,
      source,
      lastUpdated: uploadedSchemaDoc?.updatedAt || new Date().toISOString(),
    });
  } catch (error: any) {
    appContext.logger.error('Error uploading schema:', error);
    res.status(500).json({
      error: 'Failed to upload schema: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/admin/schema
 * Serve the LATEST canonical service definition schema to Phase 2 UI
 * The UI builder uses this to validate service definitions and generate forms
 * Always fetches latest from MongoDB to ensure schema is always current
 */
router.get('/schema', async (req: Request, res: Response) => {
  try {
    const schemaDoc = await appContext.stateManager.getLatestSchemaVersion();
    
    if (!schemaDoc || !schemaDoc.schema) {
      return res.status(500).json({
        error: 'No schema version found in MongoDB. Server may not be fully initialized.',
      });
    }
    
    res.json({
      schema: schemaDoc.schema,
      description: schemaDoc.description || 'Canonical Service Definition Schema',
      version: schemaDoc.version,
      name: schemaDoc.name,
      lastUpdated: schemaDoc.updatedAt,
    });
  } catch (error: any) {
    appContext.logger.error('Error retrieving schema:', error);
    res.status(500).json({
      error: 'Failed to retrieve schema: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/admin/schema/versions
 * List all schema versions stored in MongoDB (NEW May 29: Schema evolution tracking)
 * Returns list of all schema versions that have been validated
 */
router.get('/schema/versions', async (req: Request, res: Response) => {
  try {
    const versions = await appContext.stateManager.getAllSchemaVersions();
    res.json({
      success: true,
      count: versions.length,
      versions: versions.map(v => ({
        version: v.version,
        name: v.name,
        description: v.description,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
      })),
    });
  } catch (error: any) {
    appContext.logger.error('Error retrieving schema versions:', error);
    res.status(500).json({
      error: 'Failed to retrieve schema versions: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/admin/schema/versions/latest
 * Get the latest schema version (NEW May 29: Schema evolution tracking)
 */
router.get('/schema/versions/latest', async (req: Request, res: Response) => {
  try {
    const schemaDoc = await appContext.stateManager.getLatestSchemaVersion();
    if (!schemaDoc || !schemaDoc.schema) {
      return res.status(404).json({
        error: 'No schema versions found',
      });
    }
    res.json({
      schema: schemaDoc.schema,
      version: schemaDoc.version,
      name: schemaDoc.name,
      description: schemaDoc.description || 'Canonical Service Definition Schema',
      lastUpdated: schemaDoc.updatedAt,
    });
  } catch (error: any) {
    appContext.logger.error('Error retrieving latest schema version:', error);
    res.status(500).json({
      error: 'Failed to retrieve latest schema version: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * GET /api/admin/schema/versions/:version
 * Get a specific schema version (NEW May 29: Schema evolution tracking)
 */
router.get('/schema/versions/:version', async (req: Request, res: Response) => {
  try {
    const { version } = req.params;
    const schema = await appContext.stateManager.getSchemaVersion(version);
    if (!schema) {
      return res.status(404).json({
        error: `Schema version ${version} not found`,
      });
    }
    res.json({
      success: true,
      schema,
    });
  } catch (error: any) {
    appContext.logger.error('Error retrieving schema version:', error);
    res.status(500).json({
      error: 'Failed to retrieve schema version: ' + (error.message || 'Unknown error'),
    });
  }
});

/**
 * POST /api/admin/schema/reload
 * Reload the schema validator with the latest version from MongoDB
 * Useful when schema is updated and you want validator to use new version without restarting server
 * ADMIN ONLY - Should be restricted in production
 */
router.post('/schema/reload', async (req: Request, res: Response) => {
  try {
    appContext.logger.info('🔄 Reloading schema from MongoDB...');
    
    const schemaDoc = await appContext.stateManager.getLatestSchemaVersion();
    
    if (!schemaDoc || !schemaDoc.schema) {
      return res.status(500).json({
        error: 'No schema version found in MongoDB',
      });
    }
    
    // Reinitialize validator with latest schema
    initializeValidator(schemaDoc.schema);
    
    appContext.logger.info(`✅ Schema validator reloaded with v${schemaDoc.version}`);
    
    res.json({
      success: true,
      message: `Schema validator reloaded with v${schemaDoc.version}`,
      version: schemaDoc.version,
      name: schemaDoc.name,
      lastUpdated: schemaDoc.updatedAt,
    });
  } catch (error: any) {
    appContext.logger.error('Error reloading schema:', error);
    res.status(500).json({
      error: 'Failed to reload schema: ' + (error.message || 'Unknown error'),
    });
  }
});

export default router;

