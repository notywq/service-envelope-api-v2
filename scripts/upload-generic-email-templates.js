#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import axios from 'axios';

const baseUrl = process.argv[2] || 'http://localhost:8000';
const seedPath = process.argv[3] || path.join(process.cwd(), 'docs', 'GENERIC_EMAIL_TEMPLATES_SEED.md');

function parseTemplates(markdown) {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const templates = [];

  const templateRegex = /###\s+`([^`]+)`\s*\n\*\*eventKey:\*\*\s*`([^`]+)`\s*\|\s*\*\*envelopeType:\*\*\s*`([^`]+)`\s*\|\s*\*\*phase:\*\*\s*`([^`]+)`\s*\n\s*\n\*\*subject:\*\*\s*`([^`]+)`\s*\n\s*\n```html\n([\s\S]*?)\n```/g;

  let match;
  while ((match = templateRegex.exec(normalized)) !== null) {
    const [, name, eventKey, envelopeType, phase, subject, htmlBody] = match;
    templates.push({
      id: name.trim(),
      name: name.trim(),
      eventKey: eventKey.trim(),
      envelopeType: envelopeType.trim(),
      phase: phase.trim(),
      templateScope: 'generic',
      isActive: true,
      subject: subject.trim(),
      htmlBody: htmlBody.trim(),
    });
  }

  return templates;
}

async function uploadTemplates(templates) {
  let success = 0;
  let failed = 0;

  for (const template of templates) {
    process.stdout.write(`Uploading ${template.name} ... `);
    try {
      const response = await axios.post(`${baseUrl}/api/admin/email-templates`, template, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.status === 201) {
        console.log('OK');
        success += 1;
      } else {
        console.log(`FAILED (${response.status})`);
        failed += 1;
      }
    } catch (error) {
      const status = error.response?.status ?? 'Unknown';
      const message = error.response?.data?.error || error.message;
      console.log(`FAILED (${status})`);
      if (message) {
        console.log(`  ${message}`);
      }
      failed += 1;
    }
  }

  return { success, failed };
}

async function main() {
  if (!fs.existsSync(seedPath)) {
    console.error(`Seed file not found: ${seedPath}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(seedPath, 'utf8');
  const templates = parseTemplates(markdown);

  if (templates.length === 0) {
    console.error('No templates parsed from seed markdown.');
    process.exit(1);
  }

  console.log(`Parsed ${templates.length} template(s) from ${seedPath}`);
  console.log(`Uploading to ${baseUrl}/api/admin/email-templates`);

  const { success, failed } = await uploadTemplates(templates);

  console.log('\nUpload summary:');
  console.log(`  Success: ${success}`);
  console.log(`  Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
