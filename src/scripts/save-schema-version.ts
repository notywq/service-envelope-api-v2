/**
 * Save Schema Version to MongoDB
 * Run with: npx ts-node --loader ts-node/esm src/scripts/save-schema-version.ts
 */

import { MongoDBStateManager } from '../services/mongodb-state-manager.js';
import winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
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

async function saveSchemaVersion() {
  try {
    logger.info('🔄 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/service-envelope';
    const stateManager = new MongoDBStateManager(logger);
    await stateManager.connect(mongoUri);

    logger.info('📖 Loading schema from file...');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const schemaPath = path.join(__dirname, '../schemas/service-definition.schema.json');
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const schema = JSON.parse(schemaContent);

    logger.info('💾 Saving schema version to MongoDB...');
    
    // Extract version from title if not present as property (e.g., "Service Definition Schema v1.0.1")
    const versionMatch = schema.title?.match(/v(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : '1.0.1';
    
    await stateManager.saveSchemaVersion(
      version,
      schema.title,
      schema,
      schema.description
    );

    logger.info(`✅ Schema v${version} saved to MongoDB successfully`);
    
    logger.info('📋 Retrieving all schema versions from MongoDB...');
    const allVersions = await (stateManager as any).getAllSchemaVersions();
    logger.info(`Found ${allVersions.length} schema version(s):`);
    allVersions.forEach((v: any) => {
      logger.info(`  - v${v.version}: ${v.name}`);
    });

    await stateManager.disconnect();
    logger.info('✨ Complete!');
    process.exit(0);
  } catch (err) {
    logger.error('❌ Error:', err);
    process.exit(1);
  }
}

saveSchemaVersion();
