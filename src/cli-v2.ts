#!/usr/bin/env node
/**
 * CLI entrypoint for the Service Envelope System
 */
import { Command } from 'commander';
import inquirer from 'inquirer';
import { join, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'fs';
import YAML from 'yaml';
import ora from 'ora';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createLogger } from './utils/logger';
import { StateManager } from './core/state-manager';
import { ServiceOrchestrator } from './core/service-orchestrator';
import { RequestProcessor } from './processors/request-processor';
import { ApprovalProcessor } from './processors/approval-processor';
import { PaymentProcessor } from './processors/payment-processor';
import { ProcessingProcessor } from './processors/processing-processor';
import { DeliveryProcessor } from './processors/delivery-processor';
import { FeedbackProcessor } from './processors/feedback-processor';
import { ThirdPartyService } from './services/third-party-service';
import { ServiceRequest } from './types/envelope.types';
import { firstValueFrom } from 'rxjs';

// --- Setup CLI ---
const program = new Command();
const logger = createLogger();
const stateManager = new StateManager('./data');

// --- JSON Schema validation setup ---
const ajv = new Ajv({ allErrors: true });
addFormats(ajv); // ✅ Adds "date-time", "email", "uri", etc.

import serviceRequestSchema from './schemas/service-request.schema.json';
const validateServiceRequest = ajv.compile(serviceRequestSchema);

// --- Init processors ---
const thirdPartyService = new ThirdPartyService(logger);
const orchestrator = new ServiceOrchestrator(
  new RequestProcessor(logger),
  new ApprovalProcessor(logger, thirdPartyService, stateManager),
  new PaymentProcessor(logger, thirdPartyService),
  new ProcessingProcessor(logger, thirdPartyService, stateManager),
  new DeliveryProcessor(logger, thirdPartyService),
  new FeedbackProcessor(logger, thirdPartyService),
  stateManager,
  logger
);

// --- Helper: Load YAML & validate ---
function loadServiceRequest(filePath: string): ServiceRequest {
  const resolvedPath = resolve(filePath);

  if (!existsSync(resolvedPath)) {
    console.error(`❌ File not found: ${resolvedPath}`);
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (err: any) {
    console.error(`❌ Failed to read file: ${err.message}`);
    process.exit(1);
  }

  let yamlData: unknown;
  try {
    yamlData = YAML.parse(raw);
  } catch (err: any) {
    console.error(`❌ Failed to parse YAML: ${err.message}`);
    process.exit(1);
  }

  if (!validateServiceRequest(yamlData)) {
    console.error('❌ Invalid YAML format:');
    console.error(validateServiceRequest.errors);
    process.exit(1);
  }

  return yamlData as unknown as ServiceRequest;
}

// --- COMMAND: process ---
program
  .command('process [yamlFile]')
  .description('Run a new service request from a YAML definition file')
  .action(async (yamlFile?: string) => {
    let filePath = yamlFile;
    if (!filePath) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'path',
          message: 'Enter the path to the service request YAML file:',
          validate: (input) => !!input || 'Path is required'
        }
      ]);
      filePath = answers.path;
    }

    const request = loadServiceRequest(filePath!);
    const spinner = ora(`Processing request ${request.id}...`).start();

    try {
      await firstValueFrom(orchestrator.processRequest(request));
      spinner.succeed(`Request ${request.id} completed successfully!`);
    } catch (err: any) {
      spinner.fail(`Processing failed: ${err.message}`);
    }
  });

// --- COMMAND: resume ---
program
  .command('resume <id>')
  .description('Resume processing a saved request from where it left off')
  .action(async (id: string) => {
    const saved = stateManager.loadRequest(id);
    if (!saved) {
      console.error(`❌ No saved request found with ID: ${id}`);
      process.exit(1);
    }

    if (saved.overallStatus === 'completed') {
      console.warn(`⚠️ Request ${id} is already completed.`);
      return;
    }

    const spinner = ora(`Resuming request ${id}...`).start();
    try {
      await firstValueFrom(orchestrator.processRequest(saved));
      spinner.succeed(`Request ${id} resumed successfully!`);
    } catch (err: any) {
      spinner.fail(`Resume failed: ${err.message}`);
    }
  });

// --- COMMAND: list ---
program
  .command('list')
  .description('List all stored requests in the data directory')
  .action(() => {
    const ids = stateManager.listRequests();
    if (ids.length === 0) {
      console.log('No requests found.');
    } else {
      console.log('Stored requests:');
      ids.forEach((id) => console.log(`- ${id}`));
    }
  });

// --- COMMAND: show ---
program
  .command('show <id>')
  .description('Show details of a stored request in YAML format')
  .action((id: string) => {
    const req = stateManager.loadRequest(id);
    if (!req) {
      console.error(`❌ No request found with id: ${id}`);
      process.exit(1);
    }
    console.log(YAML.stringify(req));
  });

// --- COMMAND: delete ---
program
  .command('delete <id>')
  .description('Delete a stored request from the data directory')
  .action((id: string) => {
    if (stateManager.deleteRequest(id)) {
      console.log(`🗑 Deleted request ${id}`);
    } else {
      console.error(`❌ Request ${id} not found`);
    }
  });

// --- COMMAND: cancel ---
program
  .command('cancel <id>')
  .description('Cancel a stored request (archives without deleting)')
  .action((id: string) => {
    const req = stateManager.loadRequest(id);
    if (!req) {
      console.error(`❌ No request found with ID: ${id}`);
      process.exit(1);
    }

    if (req.overallStatus === 'cancelled') {
      console.warn(`⚠️ Request ${id} is already cancelled.`);
      return;
    }

 // Ensure archive folder exists
    const archiveDir = resolve('./data/archive');
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }

    // Update status & history
    req.overallStatus = 'cancelled';
    req.lastUpdated = new Date().toISOString();
    req.history.push({
      status: 'cancelled',
      timestamp: new Date().toISOString(),
      envelope: 'system',
      notes: 'Request manually cancelled via CLI and moved to archive'
    });

    // Save updated request in archive
    const archivePath = join(archiveDir, `${id}.json`);
    stateManager.saveRequest(req, archiveDir); // <-- we’ll need to tweak saveRequest to accept a custom path

    // Remove original file from /data
    const activePath = resolve('./data', `${id}.json`);
    if (existsSync(activePath)) {
      renameSync(activePath, archivePath);
    }

    console.log(`🛑 Request ${id} has been cancelled and archived to /data/archive.`);
  });
// --- COMMAND: list-archived ---
program
  .command('list-archived')
  .description('List all archived (cancelled) requests')
  .action(() => {
    const archiveDir = resolve('./data/archive');
    if (!existsSync(archiveDir)) {
      console.log('No archived requests found.');
      return;
    }

    const files = readdirSync(archiveDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));

    if (files.length === 0) {
      console.log('No archived requests found.');
    } else {
      console.log('Archived requests:');
      files.forEach(f => console.log(`- ${f}`));
    }
  });

  // --- COMMAND: show-archived ---
program
  .command('show-archived <id>')
  .description('Show details of an archived request in YAML format')
  .action((id: string) => {
    const archivePath = resolve('./data/archive', `${id}.json`);
    if (!existsSync(archivePath)) {
      console.error(`❌ No archived request found with id: ${id}`);
      process.exit(1);
    }

    const raw = readFileSync(archivePath, 'utf8');
    const req = JSON.parse(raw);
    console.log(YAML.stringify(req));
  });


// --- Global help info ---
program
  .name('mcmms-services')
  .description(`Service Envelope System CLI

Examples:
  $ mcmm-services process ./samples/sample-request-valid.yaml
  $ mcmm-services resume req-2025-001
  $ mcmm-services list
  $ mcmm-services show req-2025-001
  $ mcmm-services delete req-2025-001
  $ mcmm-services cancel req-2025-001
  $ mcmm-services list-archived req-2025-001
  $ mcmm-services show-archived req-2025-001`)
  .version('1.0.0');

// Show help if no args
// if (!process.argv.slice(2).length) {
//   program.outputHelp();
// }

program.parse(process.argv);
