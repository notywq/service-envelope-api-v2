# Frontend Handoff: Machine API Client Management

Date: 2026-06-25

## Summary

The backend now supports machine-to-machine authentication with MongoDB-backed API clients.

Human users still use OTP:

- `POST /api/OTP/send`
- `POST /api/OTP/verify`

Machine integrations now use client credentials:

- `POST /api/auth/client-token`

API clients are stored in the live MongoDB `apiclients` collection. Client secrets are never stored in plaintext. The backend stores only salted hashes and returns the plaintext secret only once, on create or rotate.

## Admin UI Scope

Build an admin-only screen for `super_admin` users:

- Navigation item: API Clients
- Suggested route: `/admin/api-clients`
- Access: only show to users with `role === "super_admin"`

## API Endpoints

List clients:

```http
GET /api/admin/api-clients
Authorization: Bearer <super_admin_token>
```

List available scopes:

```http
GET /api/admin/api-client-scopes
Authorization: Bearer <super_admin_token>
```

Response shape:

```json
{
  "scopeGroups": [
    {
      "id": "requests",
      "label": "Requests",
      "description": "Create, inspect, resume, or cancel service requests.",
      "scopes": [
        {
          "scope": "requests:create",
          "label": "Create requests",
          "description": "Submit new service requests.",
          "endpoints": ["POST /api/requests"]
        }
      ]
    }
  ],
  "scopes": ["requests:create"],
  "total": 20
}
```

Create client:

```http
POST /api/admin/api-clients
Authorization: Bearer <super_admin_token>
Content-Type: application/json

{
  "name": "Student Portal Backend",
  "role": "orchestrator",
  "scopes": ["requests:create", "requests:read"],
  "isActive": true,
  "metadata": {}
}
```

The create response includes credentials once:

```json
{
  "success": true,
  "client": {
    "clientId": "cli_...",
    "name": "Student Portal Backend",
    "role": "orchestrator",
    "scopes": ["requests:create", "requests:read"],
    "isActive": true
  },
  "credentials": {
    "clientId": "cli_...",
    "clientSecret": "sec_..."
  },
  "message": "Store clientSecret now. It cannot be retrieved again after this response."
}
```

Get one client:

```http
GET /api/admin/api-clients/{clientId}
Authorization: Bearer <super_admin_token>
```

Update client:

```http
PUT /api/admin/api-clients/{clientId}
Authorization: Bearer <super_admin_token>
Content-Type: application/json

{
  "name": "Student Portal Backend",
  "role": "service",
  "scopes": ["requests:create"],
  "isActive": true,
  "metadata": {}
}
```

Rotate secret:

```http
POST /api/admin/api-clients/{clientId}/rotate-secret
Authorization: Bearer <super_admin_token>
```

Deactivate client:

```http
DELETE /api/admin/api-clients/{clientId}
Authorization: Bearer <super_admin_token>
```

Machine token exchange:

```http
POST /api/auth/client-token
Content-Type: application/json

{
  "clientId": "cli_...",
  "clientSecret": "sec_..."
}
```

OAuth-style field names are also accepted:

```json
{
  "grant_type": "client_credentials",
  "client_id": "cli_...",
  "client_secret": "sec_..."
}
```

## UI Requirements

API clients table:

- Columns: Name, Client ID, Role, Scopes, Active, Last Used, Created, Rotated
- Row actions: View/Edit, Rotate Secret, Deactivate
- Use status styling for active/inactive.
- Do not show any secret columns.

Create client modal/form:

- Name input
- Role select: `orchestrator`, `service`
- Scopes checklist generated from `GET /api/admin/api-client-scopes`
- Active toggle
- Metadata JSON editor or optional key/value section

Secret reveal modal after create:

- Show `clientId`
- Show `clientSecret`
- Copy buttons for both
- Warning text: this secret is shown once and cannot be recovered
- Require explicit close acknowledgement, such as a checkbox: "I have stored this secret"

Rotate secret flow:

- Confirmation modal explaining the old secret will stop working immediately
- On success, show the same one-time secret reveal modal
- Do not auto-close until the admin acknowledges storage

Deactivate flow:

- Confirmation modal
- After deactivation, refresh the list and mark inactive
- Existing JWTs already issued before deactivation remain valid until JWT expiry; new token exchanges fail

## Role Notes

API clients may use:

- `orchestrator`
- `service`

Both are allowed through authenticated non-admin APIs. They cannot access `/api/admin` or `/api/mock` through the general API middleware. API client management itself requires a `super_admin` bearer token.

Scopes are enforced for protected non-admin API routes when the bearer token was minted through `POST /api/auth/client-token`. Approval-token and feedback-token routes still remain public URL-token flows; their one-time/expiring URL tokens are the primary guard for those email-link actions.

## Console Logging

The backend logs machine-auth activity as structured JSON in the console. Secrets and bearer tokens are never logged.

Successful client-token exchange:

```json
{
  "event": "machine_auth_token_issued",
  "clientId": "cli_...",
  "name": "Student Portal Backend",
  "role": "orchestrator",
  "scopes": ["requests:create"],
  "ip": "::1",
  "forwardedFor": "",
  "userAgent": "..."
}
```

Successful machine-auth API access:

```json
{
  "event": "machine_auth_access",
  "clientId": "cli_...",
  "role": "orchestrator",
  "method": "POST",
  "path": "/api/requests",
  "requiredScope": "requests:create",
  "grantedScopes": ["requests:create"],
  "ip": "::1",
  "forwardedFor": "",
  "userAgent": "..."
}
```

## OpenAPI

The canonical contract is updated in `openapi.yaml`:

- `POST /api/auth/client-token`
- `GET /api/admin/api-client-scopes`
- `GET /api/admin/api-clients`
- `POST /api/admin/api-clients`
- `GET /api/admin/api-clients/{clientId}`
- `PUT /api/admin/api-clients/{clientId}`
- `POST /api/admin/api-clients/{clientId}/rotate-secret`
- `DELETE /api/admin/api-clients/{clientId}`

## Current Scope Catalog

The frontend should fetch this list from `GET /api/admin/api-client-scopes`; this section is a human-readable reference.

- `services:read`
- `services:delete`
- `requests:create`
- `requests:list`
- `requests:read`
- `requests:history`
- `requests:resume`
- `requests:cancel`
- `delivery:read`
- `delivery:update`
- `delivery-status:read`
- `delivery-status:update`
- `payments:complete`
- `payments:fail`
- `payments:webhook`
- `approvals:read`
- `approvals:submit`
- `feedback:read`
- `feedback:submit`
- `processing:read`
