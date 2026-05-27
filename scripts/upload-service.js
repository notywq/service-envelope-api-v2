#!/usr/bin/env node
import fs from 'fs';
import axios from 'axios';

const yamlPath = process.argv[2] || 'services/comprehensive-student-document-v2.yaml';
const baseUrl = 'http://localhost:8000';

async function uploadService() {
  try {
    if (!fs.existsSync(yamlPath)) {
      console.error(`❌ YAML file not found: ${yamlPath}`);
      process.exit(1);
    }

    const yamlContent = fs.readFileSync(yamlPath, 'utf8');

    console.log(`📋 Reading service definition from: ${yamlPath}`);

    const response = await axios.post(`${baseUrl}/api/admin/services`, {
      name: 'Comprehensive Student Document Service',
      yaml: yamlContent,
      type: 'comprehensive-student-document',
      initiator: 'registrar',
    });

    if (response.status === 201) {
      console.log(`✅ Service uploaded successfully`);
      console.log(`   ID: ${response.data.service.id}`);
      console.log(`   Type: ${response.data.service.type}`);
      console.log(`   Created: ${response.data.service.createdAt}`);
    } else {
      console.log(`⚠️  Unexpected response: ${response.status}`);
    }
  } catch (error) {
    const status = error.response?.status || 'Unknown';
    const message = error.response?.data?.error || error.message;
    console.error(`❌ Failed to upload service (${status}): ${message}`);
    console.error(`Full error:`, JSON.stringify(error.response?.data || error, null, 2));
    process.exit(1);
  }
}

uploadService();
