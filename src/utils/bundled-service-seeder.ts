import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import type { Logger } from 'winston';
import type { MongoDBStateManager } from '../services/mongodb-state-manager.js';

function resolveServicesDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), 'services'),
    path.resolve(process.cwd(), '..', 'services'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function buildServiceDocument(filePath: string, yamlContent: string): any {
  const parsed = YAML.parse(yamlContent) as any;
  const fallbackId = path.basename(filePath, path.extname(filePath));

  return {
    id: parsed.id || parsed.serviceId || fallbackId,
    name: parsed.name,
    type: parsed.type,
    initiator: parsed.initiator,
    description: parsed.description || '',
    yaml: yamlContent,
    definition: parsed,
  };
}

export async function seedBundledServiceDefinitions(
  stateManager: MongoDBStateManager,
  logger: Logger,
): Promise<void> {
  const servicesDirectory = resolveServicesDirectory();

  if (!fs.existsSync(servicesDirectory)) {
    logger.warn(`BOOT | Services     | Bundled service seed skipped | missing=${servicesDirectory}`);
    return;
  }

  const serviceFiles = fs.readdirSync(servicesDirectory)
    .filter((fileName) => fileName.endsWith('.yaml') || fileName.endsWith('.yml'))
    .sort();

  let created = 0;
  let present = 0;

  for (const fileName of serviceFiles) {
    const filePath = path.join(servicesDirectory, fileName);
    const yamlContent = fs.readFileSync(filePath, 'utf-8');
    const serviceDocument = buildServiceDocument(filePath, yamlContent);

    if (!serviceDocument.id || !serviceDocument.name || !serviceDocument.type) {
      logger.warn(`BOOT | Services     | Bundled service seed skipped invalid file | file=${fileName}`);
      continue;
    }

    const existing = await stateManager.getServiceDefinition(serviceDocument.id);
    if (existing) {
      present += 1;
      continue;
    }

    await stateManager.saveServiceDefinition(serviceDocument);
    created += 1;
  }

  logger.info(`BOOT | Services     | Bundled seed complete | created=${created} | present=${present}`);
}
