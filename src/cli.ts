#!/usr/bin/env node
/**
 * CLI entrypoint for the Service Envelope System
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import ora from 'ora';
import Ajv from 'ajv';
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

// TODO: Import/define your JSON schema for ServiceRequest
import serviceRequestSchema from './schemas/service-request.schema.json';
const validateServiceRequest = ajv.compile(serviceRequestSchema);

// --- Init processors ---
const thirdPartyService = new ThirdPartyService(logger);
const orchestrator = new ServiceOrchestrator(
  new RequestProcessor(logger),
  new ApprovalProcessor(logger, thirdPartyService),
  new PaymentProcessor(logger, thirdPartyService),
  new ProcessingProcessor(logger, thirdPartyService),
  new DeliveryProcessor(logger, thirdPartyService),
  new FeedbackProcessor(logger, thirdPartyService),
  stateManager,
  logger
);

// --- Helper: Load YAML & validate ---
function loadServiceRequest(filePath: string): ServiceRequest {
  const raw = readFileSync(filePath, 'utf8');
  const yamlData = YAML.parse(raw);

  if (!validateServiceRequest(yamlData)) {
    console.error('❌ Invalid YAML format:');
    console.error(validateServiceRequest.errors);
    process.exit(1);
  }
  return yamlData as ServiceRequest;
}

// --- COMMAND: process ---
program
  .command('process [yamlFile]')
  .description('Process a service request YAML file')
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

// --- COMMAND: list ---
program
  .command('list')
  .description('List all stored requests')
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
  .description('Show details of a stored request')
  .action((id: string) => {
    const req = stateManager.loadRequest(id);
    if (!req) {
      console.error(`No request found with id: ${id}`);
      process.exit(1);
    }
    console.log(YAML.stringify(req));
  });

// --- COMMAND: delete ---
program
  .command('delete <id>')
  .description('Delete a stored request')
  .action((id: string) => {
    if (stateManager.deleteRequest(id)) {
      console.log(`Deleted request ${id}`);
    } else {
      console.error(`Request ${id} not found`);
    }
  });

program.parse(process.argv);