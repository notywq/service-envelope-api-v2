/**
 * Template Renderer Utility
 * Renders email templates with variable substitution
 */

/**
 * Render an email template by replacing {{variableName}} with actual values
 * @param template - Template object with subject and htmlBody
 * @param variables - Object containing variable values
 * @returns Rendered template with subject and htmlBody
 */
export function renderEmailTemplate(
  template: { subject: string; htmlBody: string },
  variables: Record<string, any>
): { subject: string; htmlBody: string } {
  let subject = template.subject;
  let htmlBody = template.htmlBody;

  // Replace variables in both subject and body
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`;
    const valueStr = String(value || '');
    subject = subject.split(placeholder).join(valueStr);
    htmlBody = htmlBody.split(placeholder).join(valueStr);
  });

  return { subject, htmlBody };
}

/**
 * Extract variable names from template text
 * @param text - Template text containing {{variableName}} placeholders
 * @returns Array of unique variable names
 */
export function extractTemplateVariables(text: string): string[] {
  const matches = text.match(/\{\{(\w+)\}\}/g) || [];
  const variables = matches.map(match => match.replace(/\{\{|\}\}/g, ''));
  return [...new Set(variables)];
}

/**
 * Validate that all required variables are provided
 * @param templateVariables - Variables defined in template
 * @param providedVariables - Variables provided for rendering
 * @returns Array of missing variable names, empty if all provided
 */
export function validateTemplateVariables(
  templateVariables: string[],
  providedVariables: Record<string, any>
): string[] {
  return templateVariables.filter(
    variable => !(variable in providedVariables) || providedVariables[variable] === undefined
  );
}

/**
 * Sanitize HTML in template variables to prevent XSS
 * @param variables - Variables to sanitize
 * @returns Sanitized variables object
 */
export function sanitizeTemplateVariables(variables: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  Object.entries(variables).forEach(([key, value]) => {
    if (typeof value === 'string') {
      // Escape HTML special characters
      sanitized[key] = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    } else {
      sanitized[key] = value;
    }
  });

  return sanitized;
}
