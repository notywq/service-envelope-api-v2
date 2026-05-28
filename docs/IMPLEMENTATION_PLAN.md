# Service Envelope - Cancellation & Delivery Implementation Plan

**Status**: Implementation Complete | Testing Deferred
**Date**: May 27, 2026
**Focus Areas**: Cancellation Email System + Delivery Method Endpoints

---

## Executive Summary

Successfully implemented:
- ✅ **3-Point Cancellation System** (Approval Denial, Payment Expiry, Processing Failure)
- ✅ **Delivery Method Selection Endpoints** (POST/GET for UI routing)
- ✅ **Unified Email Architecture** (Orchestrator as single email source)
- ✅ **Comprehensive API Task Logging** (Individual task execution details)
- ✅ **Approval Token System** (Unique tokens per approver, stored + emailed)

Build Status: **✅ 0 TypeScript Errors**

---

## PART 1: CANCELLATION EMAIL SYSTEM

### Architecture

**Request Cancellation Flow:**
```
Request enters 6-envelope pipeline → Failure at specific point → 
Set request.overallStatus='cancelled' → Send cancellation email → Halt pipeline
```

**3 Cancellation Triggers:**

#### 1. **Approval Denial Cancellation**
- **Location**: `src/core/service-orchestrator.ts` → `continueEnvelopeProcessing()` (line ~250)
- **Trigger**: When approval envelope fails (`envelope.status === 'failed'`)
- **Detection**: Finds approver with `status === 'denied'`
- **Action**:
  - Extracts denier info: `deniedApprover = approvalEnvelope.approvers.find(a => a.status === 'denied')`
  - Sets `request.overallStatus = 'cancelled'`
  - Calls `sendCancellationEmail(request, 'Approval Process', reason)`
  - Reason template: `"Your request was denied by {role} ({approverId})"`
- **Email Template**: `"SERV-999-request-cancelled"`
- **Log Marker**: `[REQUEST CANCELLED]`

#### 2. **Payment Expiry Cancellation**
- **Location**: `src/core/service-orchestrator.ts` → `checkPaymentExpiry()` (line ~130)
- **Trigger**: When payment envelope status is `pending_external` AND 7+ days have passed
- **Detection Logic**:
  1. Get service definition: `serviceDefinition = await stateManager.getServiceDefinitionByType(request.type)`
  2. Extract expiry: `expiryDays = serviceDefinition.envelopes.payment.expiryDays` (default 7)
  3. Get init time: `paymentInitiatedAt = new Date(paymentEnvelope.timestamp)`
  4. Calculate: `daysSinceInitiation = (Date.now() - paymentInitiatedAt) / (1000 * 60 * 60 * 24)`
  5. Check: `if (daysSinceInitiation > expiryDays)`
- **Action**:
  - Sets `request.overallStatus = 'cancelled'`
  - Calls `sendCancellationEmail(request, 'Payment Processing', 'Payment window expired (7 days)')`
- **Email Template**: `"SERV-999-request-cancelled"`
- **Log Marker**: `[REQUEST CANCELLED]`
- **YAML Config** (comprehensive-student-document-v2.yaml):
  ```yaml
  payment:
    expiryDays: 7
    emailTemplateCancelEnvelope: "SERV-999-request-cancelled"
  ```

#### 3. **Processing Failure Cancellation** ✅ (Already Implemented)
- **Location**: `src/core/service-orchestrator.ts` → `continueEnvelopeProcessing()` (line ~260)
- **Trigger**: When processing envelope fails (task execution error)
- **Detection**: Finds failed task: `failedTask = processingEnvelope.tasks.find(t => t.status === 'failed')`
- **Action**:
  - Extracts error: `failureDetails = failedTask.responseError`
  - Sets `request.overallStatus = 'cancelled'`
  - Calls `sendCancellationEmail(request, failedTask.name, failureDetails)`
- **Email Template**: `"SERV-999-request-cancelled"`
- **Log Marker**: `[REQUEST CANCELLED]`

### Email Template: `SERV-999-request-cancelled`

**Structure** (from data/csd-email-templates.json):
```json
{
  "templateId": "csd-request-cancelled",
  "envelopeType": "request",
  "phase": "cancellation",
  "subject": "Your Document Request Has Been Cancelled - {{requestId}}",
  "htmlBody": {
    "header": "⚠️ Request Cancelled",
    "cancellationDetails": {
      "requestId": "{{requestId}}",
      "cancelledAt": "{{currentDate}}",
      "reason": "{{failureReason}}"
    },
    "whatHappened": {
      "failedProcess": "{{failedTask}}",
      "errorDetails": "{{errorMessage}}"
    },
    "refundInfo": "₱800 within 3-5 business days",
    "requestSummary": "Shows original request details",
    "contactSupport": "Email support with questions"
  }
}
```

### Orchestrator Cancellation Methods

**Method 1: `processEnvelope<K>()`** (line ~110)
- Routes to `checkPaymentExpiry()` for payment envelopes before processing
- Detects approval/processing failures in `continueEnvelopeProcessing()`

**Method 2: `checkPaymentExpiry()`** (line ~130)
- Async method that checks payment timestamp vs expiry days
- Returns `boolean` indicating if expired
- Called via `from()` RxJS operator to convert Promise to Observable

**Method 3: `continueEnvelopeProcessing<K>()`** (line ~180)
- Main processing pipeline
- Detects failures: `if (envelope.status === 'failed')`
- Routes by type: approval → deny check, processing → task error check
- Calls `sendCancellationEmail()` with failure context

**Method 4: `sendCancellationEmail()`** (line ~625)
- Signature: `sendCancellationEmail(request: ServiceRequest, failedTask: string, failureDetails: string)`
- Gets cancellation template from MongoDB
- Builds email context with:
  - `failedTask`: Name of process that failed
  - `failureDetails`: Error message or denial reason
  - `requestId`, `requesterEmail`, request summary
- Sends via orchestrator's unified email system (fire-and-forget)
- Logs: `[CANCELLATION-EMAIL-SENT]`

---

## PART 2: DELIVERY METHOD ENDPOINTS

### New API Endpoints

#### **POST /api/delivery/:requestId/method**
- **Purpose**: Select delivery method after processing completes
- **Status**: ✅ Implemented in [src/api/routes/delivery.ts](src/api/routes/delivery.ts#L14)
- **Request Body Format**:
  ```json
  {
    "method": "email|physical_mail|pickup",
    "details": {
      "[method]": {
        "mailingAddress": "optional for physical_mail"
      }
    }
  }
  ```
- **Response** (200):
  ```json
  {
    "status": "success",
    "message": "Delivery method [method] selected and processing started",
    "requestId": "req-xxx",
    "method": "physical_mail",
    "deliveryDetails": {
      "physical_mail": {
        "mailingAddress": "123 Main St..."
      }
    }
  }
  ```
- **Logic**:
  1. Validate method is one of: email, physical_mail, pickup
  2. Load request, verify delivery envelope exists
  3. Check envelope status is `pending_external` (waits for user selection)
  4. Extract `details[method]` → store as `delivery.details[method]`
  5. Set `delivery.status = 'in_progress'`, save request
  6. Trigger orchestrator to process delivery
- **Error Cases**:
  - 400: Invalid method, missing envelope, wrong status
  - 404: Request not found

#### **GET /api/delivery/:requestId/method**
- **Purpose**: Retrieve delivery method for frontend UI routing
- **Status**: ✅ Implemented in [src/api/routes/delivery.ts](src/api/routes/delivery.ts#L104)
- **Response** (200):
  ```json
  {
    "requestId": "req-xxx",
    "deliveryMethod": "EMAIL|PHYSICAL_MAIL|PICKUP|null",
    "status": "pending_external|in_progress|completed|failed",
    "details": {
      "physical_mail": {
        "mailingAddress": "..."
      }
    },
    "availableMethods": {
      "email": {},
      "physical_mail": {},
      "pickup": {}
    },
    "timestamp": "ISO",
    "lastAttemptAt": "ISO or null"
  }
  ```
- **Frontend Usage**:
  - URL: `http://localhost:5173/delivery/req-xxx/tracking`
  - Call: `GET /api/delivery/req-xxx/method`
  - Use `deliveryMethod` to determine UI:
    - `EMAIL` → Show email recipient form
    - `PHYSICAL_MAIL` → Show address input, carrier, tracking
    - `PICKUP` → Show location, hours, pickup deadline
    - `null` → Show method selection radio buttons

### Delivery Methods Configuration (YAML)

From [services/comprehensive-student-document-v2.yaml](services/comprehensive-student-document-v2.yaml):

```yaml
delivery:
  emailTemplateStartEnvelope: "SERV-999-delivery-start"
  emailTemplateEndEnvelope: "SERV-999-delivery-complete"
  deliveryMethods:
    email:
      enabled: true
      subject: "Your Student Documents - {{firstName}} {{lastName}}"
      recipient: "{{email}}"
      attachmentUrls:
        - "https://documents.mapua.edu.ph/{{requestId}}/documents.pdf"
      fields: {}
    
    physical_mail:
      enabled: true
      carrier: "LBC"
      estimatedDays: 5
      costPercentage: 15
      requiresApprovalBeforeShip: true
      requiresSignature: false
      trackingEnabled: true
      fields:
        mailingAddress:
          type: String
          required: true
          label: "Mailing Address"
          maxLength: 300
          placeholder: "Street Address, City, Province, Postal Code"
    
    pickup:
      enabled: true
      location: "MAPUA Registrar's Office, Room 201, Ground Floor, MAPUA Campus"
      hoursOfOperation: "Monday-Friday, 8:00 AM - 5:00 PM"
      requiresIDVerification: true
      pickupDeadlineDays: 30
      notificationRequired: true
      fields: {}
```

### Delivery Envelope Data Model

**From** [src/types/envelope.types.ts](src/types/envelope.types.ts#L140):
```typescript
interface DeliveryEnvelope extends BaseEnvelope {
  method?: DeliveryMethod;  // email | physical_mail | pickup
  details?: DeliveryDetails;
  availableMethods?: Record<string, any>;
  deliveryAttempts: number;
  lastAttemptAt?: string;
  currentStatus?: string;  // in_transit, out_for_delivery, received, failed
  lastStatusUpdate?: string;
  deliveryHistory?: DeliveryStatusUpdate[];
}

interface DeliveryDetails {
  email?: {
    recipient: string;
    subject: string;
    templateId?: string;
    attachmentUrls?: string[];
  };
  physical_mail?: {
    address: string;
    carrier?: string;
    trackingId?: string;
    requiresSignature?: boolean;
    estimatedDays?: number;
    shippedAt?: string;
  };
  pickup?: {
    location: string;
    hoursOfOperation?: string;
    pickedUpAt?: string;
    pickupDeadlineAt?: string;
  };
}
```

---

## PART 3: UNIFIED EMAIL ARCHITECTURE

### Orchestrator as Single Email Source

**All emails sent from**: `src/core/service-orchestrator.ts` → `sendEnvelopeEmailTemplate()`

**Key Features**:
- ✅ Approval token generation before email send
- ✅ Per-approver unique tokens (UUID)
- ✅ Token storage in MongoDB ApprovalTokenModel
- ✅ Approval links built: `${FRONTEND_BASE_URL}/approvals/{token}`
- ✅ Tokens included in email context: `{{approvalToken}}`, `{{approvalLink}}`

**Flow**:
1. Processor completes → Orchestrator calls `sendEnvelopeEmailTemplate()`
2. Fetches template by name from MongoDB
3. Generates approval tokens (if approval envelope)
4. Builds email context with substitutions
5. Sends via Nodemailer (fire-and-forget)
6. No processor-level email methods (all removed)

---

## PART 4: API TASK LOGGING

### Processing Task Execution Logging

**Location**: [src/utils/api-task-executor.ts](src/utils/api-task-executor.ts) + [src/processors/processing-processor.ts](src/processors/processing-processor.ts)

**Task Execution Flow**:
```
processingProcessor.processTasks() {
  concatMap(tap for logging) → executeTask() for each task
}

For each task:
  - Log task index (1/4, 2/4, etc.)
  - Substitute {{parameters}} in URL, headers, payload
  - Attempt 1/3, 2/3, 3/3 with exponential backoff
  - Log HTTP status, timing, success/failure
  - Return task with status, responseData, responseError

Final: Log summary - "✅ 3/4 succeeded, ❌ 1/4 failed"
```

**Log Output Example**:
```
🚀 PROCESSING TASK 1/4: Verify Student Records
  ├─ Method: POST
  ├─ URL: http://localhost:8000/api/mock/students/verify
  ├─ Attempt 1/3
  ├─ Status: 200 OK
  └─ Duration: 145ms ✅

🚀 PROCESSING TASK 2/4: Generate Academic Record
  ├─ Method: POST
  ├─ URL: http://localhost:8000/api/mock/documents/generate-record
  ├─ Attempt 1/3
  ├─ Status: 201 Created
  └─ Duration: 312ms ✅

[PROCESSING-SUMMARY] Tasks completed: 4 total | ✅ 4 succeeded | ❌ 0 failed
```

---

## PART 5: UPDATED REQUEST PARAMETERS

### Added to YAML

**File**: [services/comprehensive-student-document-v2.yaml](services/comprehensive-student-document-v2.yaml)

**New Parameter**:
```yaml
deliveryMethod:
  type: Radio
  required: true
  description: "How to receive the documents"
  options:
    - label: "Email"
      value: "email"
    - label: "Physical Mail"
      value: "physical_mail"
    - label: "Pick-up in Person"
      value: "pickup"
  default: "email"
```

**Purpose**: Frontend collects delivery preference during initial request submission. Later, during delivery envelope, user can refine or change method via POST endpoint.

---

## Test Coverage

### Test Files Created

**1. [tests/test-cancellations-and-delivery.json](tests/test-cancellations-and-delivery.json)**
- Comprehensive JSON test suite
- 7 test scenarios covering all new functionality
- Expected requests, responses, email templates
- Test data matching YAML structure
- Ready to execute via test runner

**2. [tests/run-json-tests.ps1](tests/run-json-tests.ps1)**
- PowerShell test runner
- Executes JSON test suite
- Makes actual HTTP calls
- Displays request/response details
- Color-coded output

### Test Scenarios

```json
Test 1: Create Request
  POST /requests with comprehensive-student-document params

Test 2: Approval Denial → Cancellation
  - Create request
  - Deny approval
  - Verify request.overallStatus = 'cancelled'
  - Verify cancellation email sent

Test 3: Payment Expiry → Cancellation
  - Create request
  - Simulate 7+ days elapsed
  - Verify cancellation triggered
  - Verify cancellation email sent

Test 4: POST Delivery Method
  - Create request reaching delivery envelope
  - Select physical_mail delivery
  - Verify method stored and processing triggered

Test 5: GET Delivery Method
  - Retrieve delivery method for UI
  - Verify method, status, details returned
  - Frontend uses to route to correct UI

Test 6: Email Delivery Method

Test 7: Pickup Delivery Method
```

---

## Code Changes Summary

### Modified Files

| File | Changes | Lines |
|------|---------|-------|
| `src/core/service-orchestrator.ts` | Added payment expiry check, approval denial detection, cancellation routing | +120 |
| `src/api/routes/delivery.ts` | Added POST/GET delivery method endpoints | +80 |
| `services/comprehensive-student-document-v2.yaml` | Added deliveryMethod param, delivery config, expiry settings | +40 |
| `src/types/envelope.types.ts` | Updated imports (added ApprovalEnvelope, PaymentEnvelope) | +2 |

### New Files

| File | Purpose |
|------|---------|
| `tests/test-cancellations-and-delivery.json` | Test suite definition |
| `tests/run-json-tests.ps1` | Test runner |

### Build Status
- **TypeScript Errors**: ✅ **0**
- **Compile Command**: `npm run build`
- **Last Build**: ✅ Passed

---

## Database Requirements

### Collections Used

**1. servicedefinitions**
- Stores service YAML as JSON
- Key: `comprehensive-student-document`
- Contains: All envelope configs, parameters, email templates

**2. requests**
- Stores request documents
- Fields: `id`, `type`, `parameters`, `envelopes`, `overallStatus`, `lastUpdated`, `history`

**3. emailtemplates**
- Email template library
- Templates: SERV-999-approval-start, SERV-999-payment-start, SERV-999-request-cancelled, etc.

**4. approvaltokens**
- Approval token tracking
- Fields: `token` (UUID), `requestId`, `approverId`, `expiryAt`, `usedAt`

---

## Known Dependencies

- **RxJS**: Observable pipeline (switchMap, concatMap, tap)
- **Nodemailer**: Email sending (fire-and-forget pattern)
- **MongoDB**: All persistence
- **Express.js**: REST API
- **TypeScript**: Type safety (ES modules, NodeNext module resolution)

---

## Testing Instructions (Deferred)

### Prerequisites
1. Start MongoDB (Atlas or local)
2. Start backend: `npm run dev` (port 8000)
3. Load service definition into `servicedefinitions` collection
4. Ensure email templates in database

### Run Tests
```pwsh
cd ./tests
./run-json-tests.ps1
```

### Manual Testing
```bash
# Test 1: Create request
curl -X POST http://localhost:8000/api/requests \
  -H "Content-Type: application/json" \
  -d '{
    "type": "comprehensive-student-document",
    "initiator": "system",
    "parameters": { ... }
  }'

# Test 2: Get delivery method
curl http://localhost:8000/api/delivery/{requestId}/method

# Test 3: Select delivery method
curl -X POST http://localhost:8000/api/delivery/{requestId}/method \
  -H "Content-Type: application/json" \
  -d '{
    "method": "physical_mail",
    "details": {
      "physical_mail": {
        "mailingAddress": "123 Main St, City, Province"
      }
    }
  }'
```

---

## Future Enhancements

1. **Delivery Status Tracking** - Real-time tracking updates from carriers
2. **Approval Timeout** - Auto-deny if not approved within 48 hours
3. **Payment Webhook** - Handle payment provider callbacks
4. **Feedback Reminders** - Auto-send feedback survey reminders
5. **Request History Export** - Bulk download/export request records
6. **Analytics Dashboard** - Request success rates, avg processing time, etc.

---

## References

- **Orchestrator**: [src/core/service-orchestrator.ts](src/core/service-orchestrator.ts)
- **Delivery Endpoints**: [src/api/routes/delivery.ts](src/api/routes/delivery.ts)
- **Types**: [src/types/envelope.types.ts](src/types/envelope.types.ts)
- **Service YAML**: [services/comprehensive-student-document-v2.yaml](services/comprehensive-student-document-v2.yaml)
- **Test Suite**: [tests/test-cancellations-and-delivery.json](tests/test-cancellations-and-delivery.json)
- **Test Runner**: [tests/run-json-tests.ps1](tests/run-json-tests.ps1)

---

**Last Updated**: May 27, 2026
**Status**: Ready for Testing
