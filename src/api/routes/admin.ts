/**
 * Admin Routes
 * Handles admin operations like service creation and system management
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import YAML from 'yaml';

const router = Router();

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

    // Validate required envelope structure
    const requiredEnvelopes = ['request', 'approval', 'payment', 'processing', 'delivery', 'feedback'];
    const missingEnvelopes = requiredEnvelopes.filter(env => !(env in parsedYaml.envelopes || {}));

    if (missingEnvelopes.length > 0) {
      return res.status(400).json({
        error: `Missing required envelopes: ${missingEnvelopes.join(', ')}`,
      });
    }

    // Create service definition - merge parsed YAML properties into root level
    // so that service.envelopes works (not service.definition.envelopes)
    const serviceDefinition = {
      ...parsedYaml, // Spread YAML properties (id, name, envelopes, etc.)
      name: name, // Override name from form
      type,
      initiator,
      description: parsedYaml.description || name,
      yaml: yamlContent,
      definition: parsedYaml, // Keep original for reference
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    appContext.logger.info(`📝 Creating new service: ${type} (${name})`);

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

    // Validate required envelope structure
    const requiredEnvelopes = ['request', 'approval', 'payment', 'processing', 'delivery', 'feedback'];
    const missingEnvelopes = requiredEnvelopes.filter(env => !(env in parsedYaml.envelopes || {}));

    if (missingEnvelopes.length > 0) {
      return res.status(400).json({
        error: `Missing required envelopes: ${missingEnvelopes.join(', ')}`,
      });
    }

    // Create updated service definition - merge parsed YAML properties into root level
    const serviceDefinition = {
      ...parsedYaml, // Spread YAML properties (id, name, envelopes, etc.)
      name: name, // Override name from form
      type,
      initiator,
      description: parsedYaml.description || name,
      yaml: yamlContent,
      definition: parsedYaml, // Keep original for reference
      updatedAt: new Date().toISOString(),
    };

    appContext.logger.info(`📝 Updating service: ${serviceId}`);

    // Save to MongoDB
    try {
      await appContext.stateManager.saveServiceDefinition(serviceDefinition);
      appContext.logger.info(`✅ Service "${name}" updated in MongoDB`);
    } catch (err) {
      appContext.logger.error(`❌ Failed to update service in MongoDB:`, err);
      return res.status(500).json({
        error: 'Failed to update service in database',
      });
    }

    // Also update in ServiceRegistry for immediate use
    appContext.serviceRegistry.registerService(serviceDefinition);
    
    res.status(200).json({
      success: true,
      message: `Service "${name}" updated successfully`,
      service: {
        id: serviceDefinition.id,
        name: serviceDefinition.name,
        type: serviceDefinition.type,
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
    const { id, name, subject, htmlBody, description } = req.body;

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
        createdAt: template.createdAt,
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
    res.json({
      templates,
      total: templates.length,
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
    
    res.json(template);
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
    const { name, subject, htmlBody, description } = req.body;

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

export default router;

