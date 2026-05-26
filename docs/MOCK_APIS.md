# Mock Service APIs for Testing
**Status**: ✅ **READY FOR END-TO-END TESTING**

---

## Overview

Mock APIs have been created to simulate the external services that the orchestrator calls during the **Processing Envelope**. These APIs return success responses for testing without requiring actual external service connections.

---

## Mock API Endpoints

All mock APIs are registered at `/api/mock/` prefix. The orchestrator will call these through the APITaskExecutor.

### 1. POST `/api/mock/students/verify`
**Purpose**: Mock SIS (Student Information System) - Verify student records exist

**Called by**: Processing Task #1 - "Verify Student Records"

**Request Body**:
```json
{
  "studentId": "2025-00123",
  "firstName": "Juan",
  "lastName": "Dela Cruz"
}
```

**Success Response (200)**:
```json
{
  "success": true,
  "studentId": "2025-00123",
  "firstName": "Juan",
  "lastName": "Dela Cruz",
  "status": "active",
  "verified": true,
  "verifiedAt": "2026-05-27T10:30:00Z",
  "message": "Student record verified successfully"
}
```

---

### 2. POST `/api/mock/documents/generate-record`
**Purpose**: Mock Registry API - Generate academic record document

**Called by**: Processing Task #2 - "Generate Academic Record"

**Request Body**:
```json
{
  "studentId": "2025-00123",
  "documentType": "academic_record",
  "numberOfCopies": 2
}
```

**Success Response (201)**:
```json
{
  "success": true,
  "studentId": "2025-00123",
  "documentType": "academic_record",
  "numberOfCopies": 2,
  "documentId": "DOC-1716903000000",
  "documentUrl": "https://documents.mapua.edu.ph/2025-00123/academic_record-1716903000000.pdf",
  "generatedAt": "2026-05-27T10:30:00Z",
  "status": "completed",
  "message": "academic_record generated successfully"
}
```

---

### 3. POST `/api/mock/documents/generate-transcript`
**Purpose**: Mock Registry API - Generate student transcript

**Called by**: Processing Task #3 - "Generate Transcript"

**Request Body**:
```json
{
  "studentId": "2025-00123",
  "numberOfCopies": 2
}
```

**Success Response (201)**:
```json
{
  "success": true,
  "studentId": "2025-00123",
  "numberOfCopies": 2,
  "transcriptId": "TXN-1716903000000",
  "transcriptUrl": "https://documents.mapua.edu.ph/2025-00123/transcript-1716903000000.pdf",
  "generatedAt": "2026-05-27T10:30:00Z",
  "status": "completed",
  "pages": 2,
  "gpa": "3.85",
  "message": "Transcript generated successfully"
}
```

---

### 4. POST `/api/mock/documents/prepare-delivery`
**Purpose**: Mock Registry API - Prepare delivery package

**Called by**: Processing Task #4 - "Prepare Delivery Package"

**Request Body**:
```json
{
  "studentId": "2025-00123",
  "documentTypes": ["academic_record", "official_transcript"],
  "deliveryMethod": "physical_mail",
  "numberOfCopies": 2
}
```

**Success Response (201)**:
```json
{
  "success": true,
  "studentId": "2025-00123",
  "documentTypes": ["academic_record", "official_transcript"],
  "deliveryMethod": "physical_mail",
  "numberOfCopies": 2,
  "packageId": "PKG-1716903000000",
  "packageUrl": "https://documents.mapua.edu.ph/2025-00123/package-1716903000000.zip",
  "preparedAt": "2026-05-27T10:30:00Z",
  "status": "ready_for_delivery",
  "estimatedDelivery": "2026-06-01T10:30:00Z",
  "message": "Delivery package prepared successfully"
}
```

---

## How It Works with the Orchestrator

### Request Flow

```
1. Client submits request to POST /api/requests
   ├─ type: "comprehensive-student-document"
   ├─ parameters: { studentId, firstName, lastName, ... }
   └─ Orchestrator starts 6-envelope pipeline

2. Processing Envelope starts
   ├─ Reads tasks from YAML:
   │  ├─ Task 1: POST http://localhost:8000/api/mock/students/verify
   │  ├─ Task 2: POST http://localhost:8000/api/mock/documents/generate-record
   │  ├─ Task 3: POST http://localhost:8000/api/mock/documents/generate-transcript
   │  └─ Task 4: POST http://localhost:8000/api/mock/documents/prepare-delivery
   │
   ├─ APITaskExecutor executes Task 1
   │  ├─ Substitutes: {{studentId}}, {{firstName}}, {{lastName}} with actual values
   │  ├─ Calls: POST /api/mock/students/verify with { studentId: "2025-00123", ... }
   │  ├─ Receives: 200 success response
   │  ├─ Saves response to request state
   │  └─ Logs: "[PROCESSING-EXEC] Request REQ-20260527-123 | Task 1/4 'Verify Student Records' | Status: completed"
   │
   ├─ APITaskExecutor executes Task 2
   │  ├─ Substitutes parameters
   │  ├─ Calls: POST /api/mock/documents/generate-record
   │  ├─ Receives: 201 success response with documentId, documentUrl
   │  └─ Saves response to request state
   │
   ├─ APITaskExecutor executes Task 3
   │  ├─ Substitutes parameters
   │  ├─ Calls: POST /api/mock/documents/generate-transcript
   │  ├─ Receives: 201 success response with transcriptId, transcriptUrl
   │  └─ Saves response to request state
   │
   ├─ APITaskExecutor executes Task 4
   │  ├─ Substitutes: {{studentId}}, {{documentTypes}}, {{deliveryMethod}}, {{numberOfCopies}}
   │  ├─ Calls: POST /api/mock/documents/prepare-delivery
   │  ├─ Receives: 201 success response with packageId, packageUrl
   │  └─ Saves response to request state
   │
   └─ All tasks complete → Processing envelope status = "completed"

3. Delivery Envelope starts
   ├─ Uses availableMethods from YAML
   ├─ User selects method (email, physical_mail, or pickup)
   └─ Executes delivery

4. Feedback Envelope starts
   ├─ Sends feedback survey link
   └─ Request completes
```

---

## Key Features

### ✅ Realistic Response Data
- Mock APIs return realistic document IDs, URLs, timestamps
- Responses match expected structure from actual APIs
- Enables testing downstream processes (delivery, feedback)

### ✅ Parameter Substitution
- All `{{parameter}}` placeholders are substituted before calling mock APIs
- Orchestrator passes actual request parameters through the full pipeline
- Test data flows naturally through all 6 envelopes

### ✅ Logging Integration
- All mock API calls are logged to console with `[MOCK-XXX-API]` prefix
- Orchestrator can track task execution with request logging
- Full audit trail for end-to-end testing

### ✅ Error Handling
- Mock APIs follow same error patterns as real APIs
- Return 500 on exceptions (caught and handled)
- Orchestrator retry logic can be tested

### ✅ Configurable Port
- Mock APIs listen on localhost:8000 (configurable via PORT env var)
- YAML updated to use `http://localhost:8000/api/mock/*` URLs
- Easy to switch between mock and real APIs (just update YAML URLs)

---

## Testing Workflow

### Step 1: Start the Server
```bash
npm run build
npm start
# Server starts on http://localhost:8000
# Mock APIs available at http://localhost:8000/api/mock/*
```

### Step 2: Upload Service Definition to MongoDB
```bash
# Upload comprehensive-student-document-v2.yaml to MongoDB
# servicedefinitions collection with serviceId: "SERVICE-999"
# Now available as type: "comprehensive-student-document"
```

### Step 3: Upload Email Templates to MongoDB
```bash
# Upload csd-email-templates.json (11 templates)
# emailtemplates collection
# Templates referenced by their templateId (SERV-999-approval-start, etc.)
```

### Step 4: Submit Test Request
```bash
curl -X POST http://localhost:8000/api/requests \
  -H "Content-Type: application/json" \
  -d '{
    "type": "comprehensive-student-document",
    "initiator": "test-user",
    "parameters": {
      "studentId": "2025-00123",
      "firstName": "Juan",
      "lastName": "Dela Cruz",
      "email": "juan@mapua.edu.ph",
      "documentTypes": ["academic_record", "official_transcript"],
      "purpose": "employment",
      "numberOfCopies": 1,
      "deliveryMethod": "physical_mail",
      "mailingAddress": "123 Main St, Manila",
      "isUrgent": false,
      "remarks": "Test request"
    }
  }'

Response:
{
  "success": true,
  "requestId": "REQ-20260527-123",
  "status": "queued"
}
```

### Step 5: Monitor Processing
```bash
# Watch request progress
curl http://localhost:8000/api/requests/REQ-20260527-123

# Monitor processing tasks
curl http://localhost:8000/api/processing/REQ-20260527-123

# Get detailed task info
curl http://localhost:8000/api/processing/REQ-20260527-123/tasks/Verify%20Student%20Records
```

### Step 6: Verify All Envelopes
```
Request Envelope:       ✅ Parameters stored
Approval Envelope:      ✅ Approvers initialized from YAML rules
Payment Envelope:       ✅ Charges calculated from YAML
Processing Envelope:    ✅ 4 mock API tasks executed successfully
                           - Task 1: Mock SIS verify
                           - Task 2: Mock generate record
                           - Task 3: Mock generate transcript
                           - Task 4: Mock prepare delivery
Delivery Envelope:      ✅ Methods available for selection
Feedback Envelope:      ✅ Survey token generated
```

---

## Example Console Output

When a request is processed through the orchestrator:

```
2026-05-27 10:30:00.123 [INFO]: POST /api/requests
2026-05-27 10:30:00.234 [INFO]: 📝 New request created: REQ-20260527-123 | Type: comprehensive-student-document
2026-05-27 10:30:00.345 [INFO]: Starting orchestration for request REQ-20260527-123

[REQUEST-INIT] Request REQ-20260527-123 | Envelope initialized

[APPROVAL-INIT] Request REQ-20260527-123 | Sending approval emails
✅ [APPROVAL-EMAIL] Start email sent for request REQ-20260527-123
[APPROVAL-WAIT] Request REQ-20260527-123 | Waiting for approvers...

[PAYMENT-INIT] Request REQ-20260527-123 | Calculating charges: PHP 800
✅ [PAYMENT-EMAIL-SENT] Request REQ-20260527-123 | Payment notification sent

[PROCESSING-INIT] Request REQ-20260527-123 | Starting 4 tasks
[MOCK-SIS-API] ✅ Verifying student: 2025-00123 (Juan Dela Cruz)
[PROCESSING-EXEC] Request REQ-20260527-123 | Task 1/4 "Verify Student Records" | Status: completed
[MOCK-REGISTRY-API] ✅ Generating academic_record for student 2025-00123 (1 copies)
[PROCESSING-EXEC] Request REQ-20260527-123 | Task 2/4 "Generate Academic Record" | Status: completed
[MOCK-REGISTRY-API] ✅ Generating transcript for student 2025-00123 (1 copies)
[PROCESSING-EXEC] Request REQ-20260527-123 | Task 3/4 "Generate Transcript" | Status: completed
[MOCK-REGISTRY-API] ✅ Preparing delivery for student 2025-00123 via physical_mail
[PROCESSING-EXEC] Request REQ-20260527-123 | Task 4/4 "Prepare Delivery Package" | Status: completed
[PROCESSING-COMPLETE] Request REQ-20260527-123 | All tasks completed successfully

[DELIVERY-INIT] Request REQ-20260527-123 | Ready for delivery (3 methods available)
[DELIVERY-WAIT] Request REQ-20260527-123 | Awaiting delivery method selection

✅ Request processing: REQ-20260527-123 -> paused (waiting for external input)
```

---

## Files Modified

| File | Changes |
|------|---------|
| `src/api/routes/mock-service-apis.ts` | **NEW** — 4 mock API endpoints for testing |
| `src/api/server.ts` | Added mock APIs route registration |
| `services/comprehensive-student-document-v2.yaml` | Updated task URLs to use localhost mock APIs |

---

## Next Steps

1. ✅ **Mock APIs created** — All 4 processing tasks have mock endpoints
2. ✅ **Server updated** — Routes registered and available
3. ✅ **YAML updated** — Task URLs point to localhost mock APIs
4. ⏭️ **Upload service definition** to MongoDB
5. ⏭️ **Upload email templates** to MongoDB
6. ⏭️ **Test end-to-end** by submitting request to `/api/requests`
7. ⏭️ **Monitor pipeline** via `/api/requests/{requestId}`
8. ⏭️ **Verify task responses** via `/api/processing/{requestId}`

---

## Build Status

```
✅ TypeScript: 0 errors
✅ Mock APIs: Ready
✅ Orchestrator: Ready to execute mock APIs
✅ Production: Ready for end-to-end testing
```
