# Processing Tasks Reference Guide

This guide documents all supported processing task types in the Service Envelope System and how to build custom processing envelopes with the correct YAML format.

## Overview

The **Processing Envelope** executes business logic and external integrations sequentially after payment is confirmed. Tasks are executed in order, and each task can:
- Call external APIs
- Execute custom business logic functions
- Call webhooks
- Use built-in processing functions
- Process results for the next stage

Once all processing tasks complete successfully, the request moves to the **Delivery Envelope**.

---

## Task Types

### 1. `api_call` - External API Integration
Make HTTP requests to external systems (third-party APIs, microservices, webhooks).

**Use Case**: Verify data with external systems, fetch additional information, trigger integrations.

**YAML Example**:
```yaml
processing:
  tasks:
    - name: "Verify with External System"
      type: api_call
      apiCall:
        url: "https://api.external-system.com/verify"
        method: "POST"
        payload:
          studentId: "{{studentId}}"
          requestType: "{{requestType}}"
          semester: "current"
        timeout: 30000
        retries: 3
```

**Parameters**:
- `url` (required) - Full URL of the API endpoint
- `method` (required) - HTTP method: GET, POST, PUT, DELETE, PATCH
- `payload` (optional) - JSON body to send with the request
  - Supports template variables: `{{studentId}}`, `{{requestType}}`, `{{requestId}}`, etc.
- `timeout` (optional) - Milliseconds before request times out (default: 30000)
- `retries` (optional) - Number of retry attempts on failure (default: 3, uses exponential backoff: 1s, 2s, 4s)

**How it works**:
- Makes HTTP request to specified URL with given method and payload
- If request fails, automatically retries with exponential backoff
- Response stored in `task.apiResponse` for access by subsequent tasks
- Task succeeds if API returns 2xx status code
- Task fails if all retries exhausted or status code is not 2xx

**Response Example**:
```json
{
  "task": {
    "name": "Verify with External System",
    "type": "api_call",
    "status": "completed",
    "apiResponse": {
      "verified": true,
      "data": {
        "studentId": "STU-123456",
        "status": "active",
        "verifiedAt": "2026-05-26T10:30:00Z"
      }
    }
  }
}
```

---

### 2. `custom_function` - Built-in or Registered Custom Logic
Execute predefined or custom business logic functions written in TypeScript.

**Use Case**: Validate student status, generate documents, send notifications, perform complex calculations.

**YAML Example**:
```yaml
processing:
  tasks:
    - name: "Validate Student Enrollment"
      type: custom_function
      customFunction:
        function: verify_student
        parameters:
          threshold: 2.0
          includeInactive: false
```

**Parameters**:
- `function` (required) - Name of the registered custom function
- `parameters` (optional) - Object with function-specific parameters

**Built-in Functions**:

#### `verify_student`
Verifies if a student is enrolled and meets requirements.

**Parameters**:
- `threshold` (optional, number) - Minimum GPA threshold (default: 2.0)
- `includeInactive` (optional, boolean) - Include inactive students (default: false)

**Returns**:
```json
{
  "success": true,
  "data": {
    "studentId": "STU-123456",
    "name": "John Doe",
    "status": "active",
    "gpa": 3.5,
    "enrollmentStatus": "full-time",
    "verified": true
  }
}
```

#### `pull_transcript`
Retrieves student transcript information.

**Parameters**:
- None

**Returns**:
```json
{
  "success": true,
  "data": {
    "studentId": "STU-123456",
    "gpa": 3.45,
    "coursesCompleted": 48,
    "currentSemester": "Fall 2025",
    "transcript": "https://system.mapua.edu.ph/transcripts/STU-123456.pdf"
  }
}
```

#### `generate_document`
Generates a document (PDF, certificate, letter) and returns access URL.

**Parameters**:
- `documentType` (optional) - Type of document (default: "standard")

**Returns**:
```json
{
  "success": true,
  "data": {
    "documentId": "DOC-789456",
    "documentType": "transcript",
    "url": "https://documents.mapua.edu.ph/gen/DOC-789456.pdf",
    "generatedAt": "2026-05-26T10:30:00Z"
  }
}
```

#### `send_notification`
Sends email or SMS notification to a recipient.

**Parameters**:
- `recipient` (required) - Email or phone number
- `type` (optional) - Notification type: "email" or "sms" (default: "email")
- `subject` (optional) - Email subject
- `message` (optional) - Notification message

**Returns**:
```json
{
  "success": true,
  "data": {
    "notificationId": "NOTIF-123456",
    "type": "email",
    "recipient": "student@mapua.edu.ph",
    "sentAt": "2026-05-26T10:30:00Z"
  }
}
```

#### `validate_address`
Validates a delivery address format and postal requirements.

**Parameters**:
- `address` (required) - Full address string
- `includeGeocoding` (optional) - Include GPS coordinates (default: false)

**Returns**:
```json
{
  "success": true,
  "data": {
    "valid": true,
    "address": "123 Main St, Manila, Metro Manila 1000",
    "postal_code": "1000",
    "city": "Manila"
  }
}
```

**How it works**:
- Function is called with provided parameters
- Context passed to function includes: request data, task info, logger
- Result stored in `task.customFunctionResponse`
- Task succeeds if function returns `success: true`
- Task fails if function returns `success: false`

**YAML Example with Result Processing**:
```yaml
processing:
  tasks:
    - name: "Step 1: Validate Student"
      type: custom_function
      customFunction:
        function: verify_student
        parameters:
          threshold: 2.0

    - name: "Step 2: Pull Transcript"
      type: custom_function
      customFunction:
        function: pull_transcript

    - name: "Step 3: Generate Document"
      type: custom_function
      customFunction:
        function: generate_document
        parameters:
          documentType: "transcript"

    - name: "Step 4: Notify Registrar"
      type: custom_function
      customFunction:
        function: send_notification
        parameters:
          recipient: "registrar@mapua.edu.ph"
          type: "email"
          subject: "Request Processed"
          message: "Student transcript generated and ready"
```

---

### 3. `webhook` - External Webhooks
Send POST requests to external webhooks for notifications and integrations.

**Use Case**: Notify external systems of processing completion, trigger downstream workflows.

**YAML Example**:
```yaml
processing:
  tasks:
    - name: "Notify Document System"
      type: webhook
      webhook:
        url: "https://documents.internal.mapua.edu.ph/webhooks/process-complete"
        method: "POST"
        retries: 2
        timeout: 15000
```

**Parameters**:
- `url` (required) - Full URL of the webhook endpoint
- `method` (optional) - HTTP method (default: "POST")
- `timeout` (optional) - Milliseconds before timeout (default: 30000)
- `retries` (optional) - Number of retry attempts (default: 3)

**How it works**:
- Sends HTTP request to webhook URL
- Automatic retries on failure
- Response stored in `task.webhookResponse`
- Task succeeds if webhook returns 2xx status code

---

### 4. `built_in` - System Built-in Processing
Use system predefined processing logic.

**Use Case**: Email notifications, logging, audit trails.

**YAML Example**:
```yaml
processing:
  tasks:
    - name: "Log Processing"
      type: built_in
      builtIn:
        action: "log_audit"
        details: "Request processed successfully"
```

**How it works**:
- Executes predefined system action
- Result stored in task response
- Used for internal system operations

---

### 5. `generic` - No-Op / Placeholder
Placeholder task type that does nothing; useful for documentation or conditional skipping.

**Use Case**: Documentation, conditionally disabled tasks, workflow templates.

**YAML Example**:
```yaml
processing:
  tasks:
    - name: "Optional step (disabled)"
      type: generic
      description: "This step is currently disabled but can be activated in future"
```

**How it works**:
- Task is skipped automatically
- Does not affect workflow
- Useful for documenting future enhancements

---

## Complete Service Example

### Transcript of Records (SERV-3) - Full Processing Pipeline

```yaml
id: SERV-3
name: Transcript of Records
description: Request official transcript with validation and delivery

approval:
  required: true
  emailTemplateId: SERV-3-approval
  approvers:
    - id: barondimaranan@gmail.com
      role: Head Teller (Required)
    - id: baron@fowlstudios.com
      role: Sub Teller 1
    - id: barbargbf@gmail.com
      role: Sub Teller 2
  approvalRules:
    type: complex
    requiredApprovers:
      - barondimaranan@gmail.com
    atLeastOneOf:
      - baron@fowlstudios.com
      - barbargbf@gmail.com
  expiryHours: 48

payment:
  required: true
  currency: PHP
  amount: 150
  emailTemplateId: SERV-3-payment

processing:
  tasks:
    - name: "Step 1: Validate Student Status"
      type: custom_function
      customFunction:
        function: verify_student
        parameters:
          threshold: 2.0
          includeInactive: false

    - name: "Step 2: Pull Academic Transcript"
      type: custom_function
      customFunction:
        function: pull_transcript

    - name: "Step 3: Generate Official Document"
      type: custom_function
      customFunction:
        function: generate_document
        parameters:
          documentType: "transcript"

    - name: "Step 4: Validate Delivery Address"
      type: custom_function
      customFunction:
        function: validate_address

    - name: "Step 5: Notify External Document System"
      type: api_call
      apiCall:
        url: "https://documents.mapua.edu.ph/api/process"
        method: "POST"
        payload:
          requestId: "{{requestId}}"
          studentId: "{{studentId}}"
          documentType: "transcript"
          copies: "{{numberOfCopies}}"
        timeout: 30000
        retries: 3

    - name: "Step 6: Alert Document Delivery Team"
      type: webhook
      webhook:
        url: "https://internal.mapua.edu.ph/webhooks/delivery-alert"
        method: "POST"
        timeout: 15000
        retries: 2

delivery:
  required: true
  method: email
  emailTemplateId: SERV-3-delivery

feedback:
  required: true
  emailTemplateId: SERV-3-feedback
```

---

## Task Response Structure

After all processing tasks execute, responses are stored in the request object:

```json
{
  "requestId": "req-1234567890",
  "envelopes": {
    "processing": {
      "status": "completed",
      "startedAt": "2026-05-26T10:30:00Z",
      "completedAt": "2026-05-26T10:35:45Z",
      "tasks": [
        {
          "name": "Validate Student Status",
          "type": "custom_function",
          "status": "completed",
          "startedAt": "2026-05-26T10:30:00Z",
          "completedAt": "2026-05-26T10:30:05Z",
          "customFunctionResponse": {
            "success": true,
            "data": {
              "studentId": "STU-123456",
              "status": "active",
              "verified": true
            }
          }
        },
        {
          "name": "Notify External System",
          "type": "api_call",
          "status": "completed",
          "startedAt": "2026-05-26T10:30:06Z",
          "completedAt": "2026-05-26T10:30:15Z",
          "apiResponse": {
            "status": 200,
            "data": {
              "processId": "PROC-789456"
            }
          }
        }
      ]
    }
  }
}
```

---

## Monitoring & Logging

All task execution is logged with timestamps and status indicators:

```
✅ Custom function task 'Validate Student Status' completed (5ms)
  Result: { verified: true, gpa: 3.45 }

🔗 API call task 'Notify External System' completed (9ms)
  Response: { status: 200, processId: 'PROC-789456' }

⏱️ Processing envelope completed (15.04s total)
  Tasks executed: 6/6 successful
```

---

## Creating Custom Functions

### TypeScript Implementation

To add a new custom function, register it in [src/services/custom-functions.ts](../src/services/custom-functions.ts):

```typescript
registerCustomFunction('my_custom_function', async (context) => {
  const { request, task, logger } = context;
  
  try {
    logger.info(`⚡ Executing custom function: ${task.customFunction?.function}`);
    
    // Your business logic here
    const result = await doSomething(request.envelopes.request.parameters);
    
    logger.info(`✅ Custom function completed successfully`);
    return {
      success: true,
      data: result
    };
  } catch (error) {
    logger.error(`❌ Custom function failed: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
});
```

### Using in YAML

```yaml
processing:
  tasks:
    - name: "Execute Custom Logic"
      type: custom_function
      customFunction:
        function: my_custom_function
        parameters:
          key1: value1
          key2: value2
```

---

## API Endpoints

### Get Request with Processing Status
```
GET /api/requests/{requestId}

Response: {
  request: { complete request object with all processing task results },
  status: "pending_delivery" | "completed" | "failed",
  processing: {
    tasks: [ { name, type, status, responses } ]
  }
}
```

### Manual Task Execution (for testing)
```
POST /api/processing/execute-task
Body: {
  requestId: string,
  taskName: string,
  taskConfig: { type, customFunction | apiCall | webhook }
}

Response: {
  success: boolean,
  taskResponse: any,
  executionTime: number
}
```

---

## Common Scenarios

### Scenario 1: Simple Validation + Document Generation
```yaml
processing:
  tasks:
    - name: "Validate Student"
      type: custom_function
      customFunction:
        function: verify_student

    - name: "Generate Transcript"
      type: custom_function
      customFunction:
        function: generate_document
        parameters:
          documentType: "transcript"
```

---

### Scenario 2: Multi-System Integration (SIS + Document + Notification)
```yaml
processing:
  tasks:
    - name: "Check SIS System"
      type: api_call
      apiCall:
        url: "https://sis.mapua.edu.ph/api/student/verify"
        method: "POST"
        payload:
          studentId: "{{studentId}}"
        timeout: 30000
        retries: 3

    - name: "Generate Document"
      type: custom_function
      customFunction:
        function: generate_document

    - name: "Notify Delivery Team"
      type: webhook
      webhook:
        url: "https://internal.mapua.edu.ph/webhooks/delivery"
        method: "POST"

    - name: "Send Student Notification"
      type: custom_function
      customFunction:
        function: send_notification
        parameters:
          type: "email"
          subject: "Your document is ready"
```

---

### Scenario 3: Conditional Processing (with Generic Placeholders)
```yaml
processing:
  tasks:
    - name: "Validate Request"
      type: custom_function
      customFunction:
        function: verify_student

    - name: "Step for future use (disabled)"
      type: generic
      description: "Will be enabled in Phase 3"

    - name: "Generate Document"
      type: custom_function
      customFunction:
        function: generate_document

    - name: "Alert Processing Team"
      type: api_call
      apiCall:
        url: "https://processing.mapua.edu.ph/api/complete"
        method: "POST"
        timeout: 15000
        retries: 2
```

---

### Scenario 4: Complex Multi-Step with Retries
```yaml
processing:
  tasks:
    - name: "Primary System Check"
      type: api_call
      apiCall:
        url: "https://primary-system.mapua.edu.ph/verify"
        method: "POST"
        timeout: 30000
        retries: 5  # Aggressive retry for critical system

    - name: "Fallback Verification"
      type: custom_function
      customFunction:
        function: verify_student
        parameters:
          threshold: 2.0

    - name: "Generate Official Document"
      type: custom_function
      customFunction:
        function: generate_document

    - name: "Secondary System Notification"
      type: api_call
      apiCall:
        url: "https://secondary-system.mapua.edu.ph/notify"
        method: "POST"
        timeout: 15000
        retries: 2

    - name: "Send Completion Alert"
      type: webhook
      webhook:
        url: "https://alerts.mapua.edu.ph/processing-complete"
        timeout: 10000
```

---

## Decision Matrix - Task Type Selection

| Task Type | External System | Reusable Logic | Notification | Use Case |
|-----------|-----------------|----------------|--------------|----------|
| api_call | ✓ | ✗ | Optional | REST APIs, microservices, third-party integrations |
| custom_function | Optional | ✓ | Optional | Business logic, validation, transformation |
| webhook | ✓ | ✗ | ✓ | Notify external systems, trigger workflows |
| built_in | ✗ | ✓ | ✓ | System operations, logging, audit |
| generic | ✗ | ✗ | ✗ | Placeholders, documentation, templates |

---

## Best Practices

### 1. **Task Naming**
Use clear, descriptive names that indicate what the task does:
```yaml
❌ Bad:  name: "task1"
✓ Good: name: "Validate Student Enrollment Status"
```

### 2. **Error Handling**
Always configure appropriate retries for external calls:
```yaml
tasks:
  - name: "Call Critical System"
    type: api_call
    apiCall:
      url: "https://critical.system.com/api"
      retries: 5      # More retries for critical systems
      timeout: 30000  # Longer timeout

  - name: "Call Optional Service"
    type: api_call
    apiCall:
      url: "https://optional.service.com/api"
      retries: 2      # Fewer retries for optional calls
      timeout: 15000
```

### 3. **Logging and Monitoring**
Built-in logging automatically captures:
- Task start/end time
- Execution duration
- Success/failure status
- Response data

Review logs in the request history for debugging.

### 4. **Security**
- Never hardcode credentials; use environment variables
- API payloads are logged; avoid logging sensitive data
- Validate all external API responses

### 5. **Performance**
- Tasks execute sequentially; minimize timeout values for faster feedback
- Use retries strategically: aggressive for critical systems, minimal for optional
- Consider breaking long processing into multiple smaller steps for better tracking

### 6. **Testing**
Test processing configuration:
```bash
# Create a test request
POST /api/requests
Body: { serviceId: "SERV-3", initiatorEmail: "test@mapua.edu.ph", ... }

# Approve all tokens
POST /api/approvals/{token}/approve

# Complete payment
POST /api/payments/{requestId}/complete

# Monitor processing logs
# Check request status: GET /api/requests/{requestId}
```

---

## Troubleshooting

### Task Fails with Timeout
- Increase `timeout` value in task configuration
- Check if external system is responsive
- Increase `retries` count

### API Call Returns 4xx Error
- Verify URL and method are correct
- Check payload matches API expectations
- Ensure API credentials/keys are configured

### Custom Function Not Found
- Verify function name matches registered name exactly
- Check [src/services/custom-functions.ts](../src/services/custom-functions.ts) for available functions
- Ensure function was registered with `registerCustomFunction()`

### Processing Hangs
- Check external system connectivity
- Monitor logs for infinite retry loops
- Increase timeout if external system is slow

---

## Examples Repository

See the following files for complete working examples:

- **TOR Service**: [services/requestTOR.yaml](../services/requestTOR.yaml)
- **Room Rental Service**: [services/roomRental.yaml](../services/roomRental.yaml)
- **Course Enrollment Service**: [services/courseEnrollment.yaml](../services/courseEnrollment.yaml)

All include real processing configurations with custom functions, API calls, and webhooks.
