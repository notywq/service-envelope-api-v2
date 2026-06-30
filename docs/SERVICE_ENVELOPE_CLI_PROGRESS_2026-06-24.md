# Service Envelope CLI Progress - June 24, 2026

This document summarizes the work completed during the service-envelope audit and production-hardening pass.

## Email Delivery And Template Control

- Fixed requester email resolution across the orchestrator and processors by adding a shared resolver that checks `email`, `emailAddress`, common requester/contact aliases, nested `serviceData`, and `request.initiator`.
- Confirmed the reported `service-ticketing` issue was caused by requests using `emailAddress` while email senders expected `email`.
- Updated request, payment, processing, delivery, approval denial, and template-rendering paths to use the shared requester email resolver.
- Removed the legacy hardcoded payment receipt email from `POST /api/payments/:requestId/complete`.
- Added payment completion template context fields: `transactionId`, `paymentTransactionId`, `paymentAmount`, `paymentCurrency`, `paymentMethod`, `paymentReference`, and `paymentTimestamp`.
- Created and attached the editable Mongo email template `SERV-999-payment-end` for payment completion receipts.
- Restored core generic email fallback behavior outside YAML:
  - Lifecycle emails resolve YAML override, YAML default, `{serviceType}-{envelope}-{phase}`, then `{envelope}-{phase}`.
  - Cancellation emails resolve YAML cancel template, YAML cancel default, service-scoped generic, then global generic.
  - Approval denial prefers `request-denied`, with `request-cancelled` as a broader fallback.
  - Delivery document email falls back to `delivery-email-document`.
  - Pickup notification falls back to `delivery-pickup-ready`.
- Verified active Mongo generic templates exist for core events including `request-end`, `payment-end`, `request-denied`, `request-cancelled`, `delivery-email-document`, and `delivery-pickup-ready`.
- Added the generic `otp-login` email template to Mongo and to `docs/GENERIC_EMAIL_TEMPLATES_SEED.md`.
- Configured the local `.env` email sender for the shared Office365/Mapua processor mailbox so OTP and service-envelope emails use the same universal SMTP sender.

## Envelope Behavior And Failure Handling

- Fixed optional or waived envelopes so they do not send start emails.
- Fixed already-completed envelope skip handling so end emails can still be sent when an envelope was externally completed.
- Changed sent-email markers to persist only after all sends succeed.
- Reloaded the latest request before saving email sent markers to reduce stale overwrites.
- Fixed `ProcessingProcessor` to honor `required: false`.
- Fixed processing task failure with `stopOnFailure: true` so the envelope fails and the request can cancel cleanly instead of throwing past the orchestrator.
- Added rule-aware approval denial behavior:
  - `all_must_approve`: any denial fails the approval envelope.
  - `specific_approver`: denial by the specific approver fails the approval envelope.
  - `any_one`: denial only fails when every eligible approver has denied and none approved.
  - `complex`: required approver denial fails; delegated-group denial only fails when all delegated options are exhausted.
- Kept token-link approval and feedback paths public because they are already protected by one-time tokens and are opened from email links.

## Schema And Validator Updates

- Updated the canonical schema from `1.0.3` to `1.0.4` for service-defined lifecycle email fields and editable payment completion templates.
- Updated the canonical schema from `1.0.4` to `1.0.5` to document the intended model: service YAML can override templates, while core generic fallback templates remain system-level records in Mongo.
- Added request envelope email fields:
  - `emailTemplateStartEnvelope`
  - `emailTemplateEndEnvelope`
  - `defaultEmailTemplateStartEnvelope`
  - `defaultEmailTemplateEndEnvelope`
- Added default lifecycle template fields across approval, payment, processing, delivery, and feedback envelopes.
- Updated validator startup defaults in `src/api/server.ts` and schema upload defaults in `src/api/routes/admin.ts`.
- Uploaded and activated schema `1.0.5` through the API.
- Saved and verified schema `1.0.5` in online MongoDB for future service validation.

## Production Auth And OTP Work

- Added bearer-token middleware for protected API routes.
- Added production auth configuration validation:
  - Production requires a strong `JWT_SECRET`.
- Added `OtpChallenge` Mongo collection for temporary login state.
- OTP records store hashed codes, not plaintext OTPs.
- Added OTP state fields for expiry, cancellation, consumption, attempt count, IP address, and user agent.
- Added OTP cleanup helper to flush stale, expired, consumed, or cancelled records.
- Added `AuthUser` Mongo collection as the source of truth for the OTP allowlist and user roles.
- Added admin endpoints to manage OTP-enabled users:
  - `GET /api/admin/auth-users`
  - `POST /api/admin/auth-users`
  - `PUT /api/admin/auth-users/:email`
  - `DELETE /api/admin/auth-users/:email`
- Seeded super admins in Mongo:
  - `barondimaranan@gmail.com`
  - `drtiongco@gmail.com`
- Added OTP endpoints:
  - `POST /api/OTP/send`
  - `POST /api/OTP/verify`
  - `POST /api/OTP/cancel`
  - `POST /api/OTP/flush`
- `POST /api/OTP/verify` returns a short-lived JWT access token.
- Bearer token usage:
  - Clients send `Authorization: Bearer <accessToken>` on protected API requests.
  - Tokens expire according to `JWT_ACCESS_TOKEN_EXPIRES_IN`, defaulting to `1h`.
- Added token inspection helpers:
  - `GET /api/auth/me`
  - `POST /api/auth/verify`
- Disabled legacy mock password login with a `410 Gone` response pointing clients to OTP login.
- Removed env-based OTP allowlist/role fallbacks. Allowed OTP users and their roles are managed in Mongo only.
- Admin routes require admin or super-admin role when auth is enabled. Mock API routes are unauthenticated local/testing utilities.
- The admin approval-token debug route now requires admin role.
- Added role-based API restrictions:
  - `requester` can use the request lifecycle only and cannot list, resume, or cancel all requests.
  - `admin` can access normal admin/API operations, but not auth-user role CRUD.
  - `orchestrator` can access operational APIs, but not admin/user-management routes.
  - `super_admin` can access all routes including auth-user role CRUD.
- Added requester ownership checks for request create/detail/history routes.
- OTP email sending now resolves an editable Mongo template:
  - `OTP_EMAIL_TEMPLATE_ID`
  - `otp-login`
  - `auth-otp`
- Added frontend handoff documentation in `docs/FRONTEND_UI_AGENT_HANDOFF_2026-06-24.md`.
- Updated `openapi.yaml` to document OTP auth, bearer verification, auth-user CRUD, roles, and 403 permission responses.

## Machine-To-Machine Auth Addendum - June 25, 2026

- Added MongoDB-backed API clients in the `apiclients` collection.
- Added salted hashing for API client secrets. Plaintext secrets are returned only on create and rotate.
- Added client credentials bearer-token exchange:
  - `POST /api/auth/client-token`
- Added super-admin API client management endpoints:
  - `GET /api/admin/api-client-scopes`
  - `GET /api/admin/api-clients`
  - `POST /api/admin/api-clients`
  - `GET /api/admin/api-clients/:clientId`
  - `PUT /api/admin/api-clients/:clientId`
  - `POST /api/admin/api-clients/:clientId/rotate-secret`
  - `DELETE /api/admin/api-clients/:clientId`
- API clients can use `orchestrator` or `service` roles for authenticated non-admin machine access.
- API client scopes are enforced for protected non-admin API routes when the bearer token was minted through client credentials.
- Added frontend handoff documentation in `docs/FRONTEND_API_CLIENTS_HANDOFF_2026-06-25.md`.
- Updated `openapi.yaml` to document client credentials and API client management.

## Environment Additions

Added production auth/OTP settings to `.env.example`:

```env
AUTH_REQUIRED=false
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_ACCESS_TOKEN_EXPIRES_IN=1h
JWT_ISSUER=service-envelope-api
JWT_AUDIENCE=service-envelope-clients
OTP_SECRET=change-this-otp-hmac-secret-in-production
OTP_CODE_LENGTH=6
OTP_TTL_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5
OTP_EMAIL_TEMPLATE_ID=otp-login
OTP_ECHO_IN_RESPONSE=false
```

Machine API clients do not need env allowlists. They are created and managed in MongoDB through `/api/admin/api-clients`.

Email delivery is configured through the standard shared sender variables:

```env
EMAIL_HOST=smtp-legacy.office365.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=processor@mapua.edu.ph
EMAIL_FROM=processor@mapua.edu.ph
ENABLE_EMAIL=true
```

## Current Login Flow

1. Client calls `POST /api/OTP/send` with `{ "email": "user@domain.edu" }`.
2. API validates the email against the Mongo `authusers` collection.
3. API creates a hashed OTP challenge in Mongo.
4. API sends the OTP email using the Mongo template `otp-login`.
5. Client calls `POST /api/OTP/verify` with `{ "email": "...", "code": "123456" }`.
6. API consumes the OTP challenge and returns:

```json
{
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": "1h",
  "user": {
    "email": "user@domain.edu",
    "role": "requester",
    "name": "user"
  }
}
```

7. Client includes `Authorization: Bearer <accessToken>` on protected API calls.

## Verification Completed

- `npm run build` passed after the email/orchestrator/schema work.
- `npm run build` passed after adding OTP, auth middleware, Mongo OTP storage, and templated OTP email support.
- Verified through the local API that schema `1.0.5` is active in Mongo.
- Verified through online MongoDB that schema `1.0.5` is saved as the latest schema version.
- Verified through the local API that all core generic templates exist and are active.
- Created the Mongo template `otp-login`.
