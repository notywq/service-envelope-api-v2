#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import https from 'http';
import axios from 'axios';

const jsonPath = 'data/csd-email-templates.json';
const baseUrl = 'http://localhost:8000';

async function uploadTemplates() {
  try {
    // Read JSON file
    const templates = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    console.log(`Reading email templates from: ${jsonPath}`);
    console.log(`Found ${templates.length} templates to upload\n`);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (const template of templates) {
      const templateId = template.templateId;
      process.stdout.write(`Uploading: ${templateId} ... `);
      
      // Map templateId to id and extract subject as name
      const payload = {
        id: template.templateId,
        name: `${template.envelopeType} - ${template.phase}`,
        subject: template.subject,
        htmlBody: template.htmlBody,
        ...template // Include all other fields
      };
      
      try {
        const response = await axios.post(
          `${baseUrl}/api/admin/email-templates`,
          payload,
          { headers: { 'Content-Type': 'application/json' } }
        );
        
        if (response.status === 201) {
          console.log('SUCCESS');
          successCount++;
        } else {
          console.log(`FAILED (Status: ${response.status})`);
          failureCount++;
        }
      } catch (error) {
        const status = error.response?.status || 'Unknown';
        const errMsg = error.response?.data?.error || error.message;
        console.log(`FAILED (${status})`);
        if (errMsg) console.log(`  Error: ${errMsg}`);
        failureCount++;
      }
    }
    
    console.log('\n' + '='.repeat(40));
    console.log('Upload Complete:');
    console.log(`  Success: ${successCount}`);
    console.log(`  Failed: ${failureCount}`);
    console.log('='.repeat(40));
    
    process.exit(failureCount > 0 ? 1 : 0);
  } catch (error) {
    console.error('Error reading or processing file:', error.message);
    process.exit(1);
  }
}

uploadTemplates();
