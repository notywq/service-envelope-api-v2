# Frontend UI Agent Handoff - Service Envelope API Changes

This handoff summarizes backend changes the frontend should support after the June 24, 2026 API update.

## Auth And OTP Login

The API now supports email OTP login and bearer tokens.

### Login Flow

1. User enters email.
2. Frontend calls:

```http
POST /api/OTP/send
Content-Type: application/json

{
  "email": "user@example.com"
}
```

3. If accepted, show an OTP input screen.
4. Frontend calls:

```http
POST /api/OTP/verify
Content-Type: application/json

{
  "email": "user@example.com",
  "code": "123456"
}
```

5. Successful response:

```json
{
  "accessToken": "jwt...",
  "tokenType": "Bearer",
  "expiresIn": "1h",
  "user": {
    "email": "user@example.com",
    "role": "requester",
    "name": "User"
  }
}
```

6. Store the token client-side and send it on protected API requests:

```http
Authorization: Bearer <accessToken>
```

### OTP UX States

Handle these responses:

- `202` from `/api/OTP/send`: OTP send accepted. The API intentionally returns a generic message for disallowed emails too.
- `429` from `/api/OTP/send`: OTP was sent recently. Use `retryAfterSeconds` for resend countdown.
- `401` from `/api/OTP/verify`: invalid code, expired code, disallowed user, or consumed challenge.
- `410` from `/api/OTP/verify`: OTP expired.
- `429` from `/api/OTP/verify`: too many attempts.

### Auth Helper Routes

- `GET /api/auth/me`: returns the bearer-token user.
- `POST /api/auth/verify`: validates the bearer token.
- `POST /api/auth/login`: disabled; returns `410 Gone`. Do not use password login.

### New And Changed API Checklist

Auth and OTP:

- `POST /api/OTP/send`: public. Body: `{ email, purpose? }`. Sends templated OTP email if the email exists in Mongo `authusers` and is active/OTP-enabled.
- `POST /api/OTP/verify`: public. Body: `{ email, code, purpose? }`. Returns `{ accessToken, tokenType, expiresIn, user }`.
- `POST /api/OTP/cancel`: public. Body: `{ email, purpose? }`. Cancels active OTP challenges for that email.
- `POST /api/OTP/flush`: protected. Requires `super_admin`. Deletes stale OTP challenge records.
- `POST /api/auth/login`: disabled. Returns `410`.
- `POST /api/auth/verify`: protected. Verifies current bearer token.
- `GET /api/auth/me`: protected. Returns current bearer user.

Auth-user management:

- `GET /api/admin/auth-users`: requires `super_admin`. Lists Mongo-backed OTP users.
- `POST /api/admin/auth-users`: requires `super_admin`. Creates/replaces an OTP user.
- `PUT /api/admin/auth-users/:email`: requires `super_admin`. Updates role/status/OTP access.
- `DELETE /api/admin/auth-users/:email`: requires `super_admin`. Deactivates OTP access without deleting history.

Request permission changes:

- `POST /api/requests`: `requester` role can submit only when submitted requester email matches token email.
- `GET /api/requests`: blocked for `requester`.
- `GET /api/requests/:requestId`: requester can read only owned requests.
- `GET /api/requests/:requestId/history`: requester can read only owned request history.
- `POST /api/requests/:requestId/resume`: blocked for `requester`.
- `DELETE /api/requests/:requestId`: blocked for `requester`.

### Allowed OTP Users

Allowed users are stored in MongoDB in the `authusers` collection. The OTP flow does not use env allowlist fallbacks. Two users were seeded:

- `barondimaranan@gmail.com`
- `drtiongco@gmail.com`

They are stored in Mongo as active OTP users with `role: super_admin`:

- `barondimaranan@gmail.com`
- `drtiongco@gmail.com`

Admin UI can manage allowed users through:

- `GET /api/admin/auth-users`
- `POST /api/admin/auth-users`
- `PUT /api/admin/auth-users/:email`
- `DELETE /api/admin/auth-users/:email`

These auth-user CRUD endpoints require `role: super_admin`.

Suggested admin form fields:

- `email`
- `name`
- `role`: `requester`, `admin`, or `orchestrator`
- `isActive`
- `allowedForOtp`

Reserved owner role:

- `super_admin`: can access admin routes and manage the OTP user allowlist. The UI may display this role for existing owner accounts, but should avoid casual promotion unless the user clearly intends to create another owner.

Role meaning:

- `requester`: can use normal authenticated request flows.
- `admin`: can access general API and admin CRUD routes, except auth-user/role CRUD.
- `orchestrator`: intended for internal/system API clients that call operational APIs and send emails on behalf of the service envelope. It should not see admin CRUD or user-role management UI.
- `super_admin`: owner role; includes admin access and auth-user CRUD.

### Permission Matrix For UI

Frontend should enforce the same permissions client-side for navigation, menus, buttons, and route guards. Backend remains the source of truth.

| Role | UI Access |
| --- | --- |
| `requester` | Service browser, request submission, own request detail/history, delivery method/details, payment completion/retry, feedback entry points. Hide admin, mock, schema, email-template, processing/admin operations, request list, direct resume, and direct cancel. |
| `admin` | All normal API/admin operations, service CRUD, schema tools, email template CRUD, request list/detail/history, delivery/payment/processing operations. Hide auth-user/user-role CRUD. |
| `orchestrator` | Internal/system operational surfaces only. No admin nav, no user-role management, no mock/admin tools. |
| `super_admin` | Full UI, including auth-user/user-role CRUD. |

Requester-specific backend rules:

- `POST /api/requests` is allowed only when the submitted requester email matches the authenticated user email.
- `GET /api/requests` is blocked for requester accounts.
- `GET /api/requests/:requestId` and `GET /api/requests/:requestId/history` are allowed only for the request owner's email.
- `POST /api/requests/:requestId/resume` and `DELETE /api/requests/:requestId` are blocked for requester accounts.

## Route Protection

When auth is enabled, most `/api/*` endpoints require bearer auth.

Public exceptions:

- `POST /api/OTP/send`
- `POST /api/OTP/verify`
- `POST /api/OTP/cancel`
- Approval email-link routes that already use approval tokens:
  - `GET /api/approvals/:token`
  - `GET /api/approvals/:token/request`
  - `POST /api/approvals/:token/approve`
  - `POST /api/approvals/:token/deny`
- Feedback email-link routes that already use feedback tokens:
  - `GET /api/feedback/token/:token`
  - `POST /api/feedback/token/:token/submit`

Admin and mock routes require `role: admin` or `role: super_admin` when auth is enabled. Auth-user CRUD requires `role: super_admin`.

## Email Template Changes

Email sending is now more template-driven.

### Generic Template Fallbacks

The backend resolves lifecycle email templates in this order:

1. Service YAML override, e.g. `emailTemplateStartEnvelope`
2. Service YAML default, e.g. `defaultEmailTemplateStartEnvelope`
3. Service-scoped generic template: `{serviceType}-{envelope}-{phase}`
4. Global generic template: `{envelope}-{phase}`

Cancellation and denial emails resolve:

1. Envelope cancel template from service YAML
2. Envelope cancel default from service YAML
3. `{serviceType}-request-denied` or `{serviceType}-request-cancelled`
4. `request-denied` or `request-cancelled`

Delivery-specific fallbacks:

- Document email: `delivery-email-document`
- Pickup notification: `delivery-pickup-ready`

OTP email uses Mongo templates too:

1. `OTP_EMAIL_TEMPLATE_ID`
2. `otp-login`
3. `auth-otp`

`otp-login` supports:

- `{{otpCode}}`
- `{{code}}`
- `{{expiryMinutes}}`
- `{{expiresInMinutes}}`
- `{{email}}`
- `{{currentTimestamp}}`

## Payment Email Change

The hardcoded payment receipt was removed. Payment completion email now comes from the orchestrator using `payment.emailTemplateEndEnvelope` or generic fallback.

The service `comprehensive-student-document` has a payment completion template attached:

- `SERV-999-payment-end`

Payment templates can use:

- `{{transactionId}}`
- `{{paymentTransactionId}}`
- `{{paymentAmount}}`
- `{{paymentCurrency}}`
- `{{paymentMethod}}`
- `{{paymentReference}}`
- `{{paymentTimestamp}}`
- Standard request fields such as `{{requestId}}`, `{{firstName}}`, `{{lastName}}`, and `{{email}}`

## Request Email Resolution

The backend now accepts requester email from several fields, including:

- `email`
- `emailAddress`
- `requesterEmail`
- `requestorEmail`
- `initiatorEmail`
- `studentEmail`
- `contactEmail`
- nested `serviceData`
- `request.initiator`

Frontend should still prefer sending a canonical `email` field where possible, but existing forms using `emailAddress` are now supported.

## Envelope Failure Behavior

Approval denial is now rule-aware:

- `all_must_approve`: one denial fails/cancels the approval envelope.
- `specific_approver`: that approver denying fails/cancels the envelope.
- `any_one`: one denial does not fail if another approver can still approve.
- `complex`: required approver denial fails; delegated group only fails when all options deny.

Processing failures:

- If `stopOnFailure: true`, a failed processing task fails the processing envelope and cancels the request path.
- If `stopOnFailure: false`, failed tasks can be skipped according to processor behavior.

UI should distinguish:

- pending approvals
- failed approval
- cancelled request
- processing failed
- completed envelope
- waived/skipped optional envelope

## Schema Version

Active service definition schema is now `1.0.5`.

Schema additions relevant to UI builders:

- Request envelope:
  - `emailTemplateStartEnvelope`
  - `emailTemplateEndEnvelope`
  - `defaultEmailTemplateStartEnvelope`
  - `defaultEmailTemplateEndEnvelope`
- Lifecycle envelopes:
  - `defaultEmailTemplateStartEnvelope`
  - `defaultEmailTemplateEndEnvelope`
  - `defaultEmailTemplateCancelEnvelope`
- Delivery method email template fields now support generic fallback if omitted.

UI text should explain that service templates are optional overrides; core generic templates keep required system emails working.

## Recommended UI Updates

- Add OTP login screens: email entry, code entry, resend countdown, error states.
- Add token storage and attach `Authorization: Bearer ...` to protected API calls.
- Add auth expiration handling: on `401`, clear token and return to login.
- Add admin view for allowed OTP users.
- Update email-template manager to show `templateScope`, `eventKey`, `envelopeType`, `phase`, and active state.
- Add or verify template editor support for `otp-login`.
- Update service-definition builder for schema `1.0.5` email fields and default template fields.
- Show template resolution hints: YAML override, YAML default, service generic, global generic.
- Update payment completion UI expectations: payment receipt email is backend-orchestrator-driven, not sent by `/api/payments/:requestId/complete` directly.
- Support `emailAddress` in existing forms, but prefer canonical `email` for new forms.

## Environment Notes

Local development is configured with:

- `NODE_ENV=development`
- `AUTH_REQUIRED=false`
- Office365/Mapua processor mailbox as universal sender
- `OTP_EMAIL_TEMPLATE_ID=otp-login`

When production enables auth, frontend must assume bearer tokens are required for protected routes.
