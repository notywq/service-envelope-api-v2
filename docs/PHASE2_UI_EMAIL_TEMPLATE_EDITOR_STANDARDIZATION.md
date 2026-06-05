# Phase 2 UI: Email Template Editor Standardization

## Goal
Move to a single template-driven email system where:
- Backend email transport is generic (no hardcoded approval/denial HTML in service layer).
- Templates come from MongoDB.
- Templates support both envelope-specific and generic cross-envelope events.

## Backend Changes Implemented

### 1) Transport-only email service
- `src/services/email-service.ts` now only handles `sendEmail({ to, subject, html, replyTo })`.
- Hardcoded methods for approval/denial email HTML were removed.

### 2) Template resolution fallback in orchestrator
- `src/core/service-orchestrator.ts` now resolves templates using prioritized candidates.
- Envelope email candidate order for each phase:
  1. Envelope-configured template name from service definition (`emailTemplateStartEnvelope` / `emailTemplateEndEnvelope`)
  2. Service-specific generic name: `{serviceType}-{envelopeType}-{phase}`
  3. Global generic name: `{envelopeType}-{phase}`

### 3) Cancellation/denial generic fallback
- Cancellation/denial emails now resolve templates in this order:
  1. Envelope-configured cancellation template (`emailTemplateCancelEnvelope`)
  2. Service-specific generic key (`{serviceType}-request-denied` or `{serviceType}-request-cancelled`)
  3. Global generic key (`request-denied` or `request-cancelled`)

### 4) Approval deny route standardized
- `src/api/routes/approvals.ts` now sends denial notifications via Mongo templates (not hardcoded HTML).
- Removed legacy direct payment email send from approvals route to avoid drift from orchestrator-driven flow.

### 5) Email template metadata support
- `src/api/routes/admin.ts` now accepts and returns additional email template fields:
  - `templateScope`: `generic | envelope | service`
  - `eventKey`: string (examples: `request-cancelled`, `request-denied`, `approval-start`)
  - `serviceType`: optional service type for service-specific overrides
  - `isActive`: boolean
- `GET /api/admin/email-templates` now supports filters via query params:
  - `templateScope`, `eventKey`, `envelopeType`, `phase`, `serviceType`, `isActive`

## API Contract for UI

## Create template
`POST /api/admin/email-templates`

Request body:
```json
{
  "id": "tmpl-request-cancelled-global",
  "name": "request-cancelled",
  "subject": "Request Cancelled: {{requestId}}",
  "htmlBody": "<p>Hi {{firstName}}, your request {{requestId}} was cancelled.</p>",
  "description": "Generic cancellation template",
  "templateScope": "generic",
  "eventKey": "request-cancelled",
  "serviceType": null,
  "isActive": true,
  "envelopeType": "approval",
  "phase": "cancel"
}
```

## Update template
`PUT /api/admin/email-templates/:templateId`

Same fields as create, except `id` is path-based.

## List templates
`GET /api/admin/email-templates`

Optional filters:
- `templateScope=generic|envelope|service`
- `eventKey=request-cancelled|request-denied|approval-start|...`
- `envelopeType=request|approval|payment|processing|delivery|feedback`
- `phase=start|end|cancel|...`
- `serviceType=<service-type>`
- `isActive=true|false`

Response shape:
```json
{
  "templates": [
    {
      "id": "tmpl-request-cancelled-global",
      "name": "request-cancelled",
      "subject": "...",
      "htmlBody": "...",
      "description": "...",
      "templateScope": "generic",
      "eventKey": "request-cancelled",
      "serviceType": null,
      "isActive": true,
      "envelopeType": "approval",
      "phase": "cancel",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 1
}
```

## Get template
`GET /api/admin/email-templates/:templateId`

Returns one template object with the same fields.

## UI Editor Changes Required

### 1) Add metadata fields to editor form
Add these fields to Create/Edit Template:
- Template Scope (`templateScope`):
  - Generic
  - Envelope
  - Service-specific
- Event Key (`eventKey`): free-text or dropdown with known keys
- Service Type (`serviceType`): optional, shown only when scope is service-specific
- Active toggle (`isActive`)

Keep existing fields:
- `id`, `name`, `subject`, `htmlBody`, `description`, `envelopeType`, `phase`

### 2) Add list filters and grouping
In the templates table/list:
- Filter chips/dropdowns for `templateScope`, `eventKey`, `envelopeType`, `phase`, `serviceType`, `isActive`.
- Suggested tabs:
  - Generic
  - Envelope-specific
  - Service-specific

### 3) Add naming guidance in UI
Show helper text in editor:
- Generic template names should be stable event keys:
  - `request-cancelled`
  - `request-denied`
  - `approval-start`
  - `approval-end`
  - `payment-start`
  - `payment-end`
  - `processing-start`
  - `processing-end`
  - `delivery-start`
  - `delivery-end`
  - `feedback-start`
  - `feedback-end`
- Service override pattern:
  - `{serviceType}-{eventKey}`
  - Example: `transcript-request-cancelled`

### 4) Add variable helper panel
Use template `variables` (auto-extracted by backend) or parse placeholders client-side and show:
- Known variables from orchestration context:
  - `requestId`, `serviceType`, `studentId`, `firstName`, `lastName`, `email`
  - `approverName`, `approverEmail`, `approvalToken`, `approvalLink`
  - `paymentLink`
  - `feedbackLink`, `feedbackToken`
  - `documentTypes`, `purpose`, `numberOfCopies`, `deliveryMethod`, `isUrgent`, `remarks`
  - cancellation/denial context: `failedTask`, `failureDetails`, `cancellationReason`, `currentTimestamp`

### 5) Validation UX
Client-side checks before save:
- Require: `id`, `name`, `subject`, `htmlBody`.
- If `templateScope=service`, require `serviceType`.
- Warn (not block) if `eventKey` is empty for generic/service scope.
- Warn if template `name` does not follow expected naming pattern.

### 6) Backward compatibility behavior in UI
- Existing templates with missing `templateScope` can be displayed as `envelope` if `envelopeType` exists; otherwise default display to `generic` with a warning badge "legacy metadata".

## Suggested Seed Templates (Generic)
Create these templates in Mongo through UI/admin API:
- `request-cancelled`
- `request-denied`
- `approval-start`
- `approval-end`
- `payment-start`
- `payment-end`
- `processing-start`
- `processing-end`
- `delivery-start`
- `delivery-end`
- `feedback-start`
- `feedback-end`

## Notes for UI Agent
- No new endpoint path is required.
- Existing admin email template endpoints are reused, with expanded payload fields and list filters.
- Keep editor future-proof by treating `eventKey` as first-class, not only envelope/phase.
- The backend now prefers template names resolved by candidate order, so naming consistency is critical.
