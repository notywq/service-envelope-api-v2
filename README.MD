# Service Envelope System CLI - v2

## Authentication

The API supports two bearer-token paths:

- Human users authenticate with email OTP via `POST /api/OTP/send` and `POST /api/OTP/verify`.
- Machine integrations authenticate with client credentials via `POST /api/auth/client-token`.

Machine API clients are stored in MongoDB in the `apiclients` collection. A `super_admin` manages them through:

- `GET /api/admin/api-clients`
- `GET /api/admin/api-client-scopes`
- `POST /api/admin/api-clients`
- `GET /api/admin/api-clients/:clientId`
- `PUT /api/admin/api-clients/:clientId`
- `POST /api/admin/api-clients/:clientId/rotate-secret`
- `DELETE /api/admin/api-clients/:clientId`

Client secrets are returned only when a client is created or rotated. The backend stores only salted secret hashes.

A **TypeScript + RxJS-powered orchestration engine** for processing complex, multi-step service requests in a **configurable, dynamic, and future-proof way**.

This system executes "envelopes" that simulate a pipeline (discrete processing stages) such as:
- Request validation
- Approval routing
- Payment handling
- Processing tasks
- Delivery of outputs
- Feedback collection

Envelopes are **defined dynamically** in YAML and can be extended with **fluid parameters** that don’t require code changes.

---

## 📜 Introduction

The **Service Envelope System** is designed as the engine for Mapua Services, a core feature of the MINERVA PROJECT. **reliable, auditable, and modular automation**.

It uses:
- **TypeScript** for strong typing and maintainability
- **RxJS** for reactive, observable-based pipelines
- **Winston** for structured logging
- **YAML** for human-friendly configuration
- **AJV** for JSON schema validation
- **Inquirer** for interactive prompts

It supports:
- **Dynamic parameters** per request type
- **Optional/Skipped envelopes** (`required: false`)
- **Retry logic** for transient failures
- **Pluggable third-party integrations** (payment, notifications, etc.)

---

## 📦 Installation

```bash
# Clone the repo
git clone https://github.com/your-username/service-envelope-cli.git
cd service-envelope-cli

# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Link CLI globally (optional)
npm link
