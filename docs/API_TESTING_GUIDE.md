# Approval Flow API Testing Guide

**API Base URL:** `http://localhost:8000/api`

## Test Scenario: Full Approval Workflow

### Step 1: Create Test Request
```powershell
$requestBody = @{
    type = "transcript_of_records"
    initiator = "2020-99999"
    parameters = @{
        studentId = "2020-99999"
        firstName = "Test"
        lastName = "Student"
        email = "test@mapua.edu.ph"
        program = "Test Program"
        numberOfCopies = 1
        purpose = "Testing"
        deliveryAddress = "Test Address"
    }
} | ConvertTo-Json -Depth 10

$response = Invoke-WebRequest -Uri "http://localhost:8000/api/requests" -Method POST `
    -ContentType "application/json" -UseBasicParsing -Body $requestBody

$request = $response.Content | ConvertFrom-Json
$requestId = $request.requestId

Write-Host "Created Request: $requestId"
Write-Host "Initial Status: $($request.envelopes.approval.status)"
Write-Host "Approval Rule: $($request.envelopes.approval.approvalRules.type)"
Write-Host "Approvers: $($request.envelopes.approval.approvers | ConvertTo-Json -Compress)"
```

**Expected Response:**
```json
{
  "requestId": "REQ-20260525-XXX",
  "overallStatus": "pending_approval",
  "envelopes": {
    "approval": {
      "status": "pending",
      "approvalRules": {
        "type": "all_must_approve"
      },
      "approvers": [
        {
          "id": "barondimaranan@gmail.com",
          "status": "pending"
        },
        {
          "id": "baron@fowlstudios.com",
          "status": "pending"
        }
      ]
    }
  }
}
```

---

### Step 2: Get Request Details via Phase 2 UI Endpoint

After extracting token from approval email, Phase 2 UI calls:

```powershell
$token = "your-approval-token-here"
$response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/$token/request" `
    -Method GET -UseBasicParsing

$request = $response.Content | ConvertFrom-Json
Write-Host (ConvertTo-Json $request -Depth 10)
```

**Expected Response:**
```json
{
  "requestId": "REQ-20260525-XXX",
  "type": "transcript_of_records",
  "status": "pending_approval",
  "approverId": "barondimaranan@gmail.com",
  "used": false,
  "expiresAt": "2026-05-26T19:42:04.688Z",
  "parameters": {
    "studentId": "2020-99999",
    "firstName": "Test",
    "lastName": "Student",
    "email": "test@mapua.edu.ph",
    "program": "Test Program",
    "numberOfCopies": 1,
    "purpose": "Testing",
    "deliveryAddress": "Test Address"
  },
  "approvalStatus": "pending_external",
  "approvers": [
    { "id": "barondimaranan@gmail.com", "status": "pending" },
    { "id": "baron@fowlstudios.com", "status": "pending" }
  ]
}
```

---

### Step 3: TEST - Partial Approval (First Approver)

**Test Goal:** Verify that approving with one approver keeps status as `pending_external`

```powershell
$token1 = "token-from-barondimaranan@gmail.com-email"
$approveBody = @{
    comment = "Looks good"
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/$token1/approve" `
    -Method POST -ContentType "application/json" -UseBasicParsing -Body $approveBody

$result = $response.Content | ConvertFrom-Json
Write-Host (ConvertTo-Json $result)
```

**Expected Response:**
```json
{
  "requestId": "REQ-20260525-XXX",
  "status": "approved",
  "message": "Approval recorded - awaiting other approvers",
  "allApproved": false,
  "nextStatus": "pending"
}
```

**✅ VERIFY**: `allApproved: false` - tells UI that approval was recorded but waiting for others

---

### Step 4: Check Request Status After First Approval

```powershell
$response = Invoke-WebRequest -Uri "http://localhost:8000/api/requests/REQ-20260525-XXX" `
    -Method GET -UseBasicParsing

$request = $response.Content | ConvertFrom-Json
Write-Host "Approval Status: $($request.envelopes.approval.status)"
Write-Host "Approver 1: $($request.envelopes.approval.approvers[0].status)"
Write-Host "Approver 2: $($request.envelopes.approval.approvers[1].status)"
```

**Expected:**
```
Approval Status: pending_external
Approver 1: approved
Approver 2: pending
```

✅ **VERIFIED**: Status remains `pending_external` (not moved to Payment envelope yet)

---

### Step 5: TEST - Complete Approval (Second Approver)

**Test Goal:** Verify that second approval completes and resumes pipeline

```powershell
$token2 = "token-from-baron@fowlstudios.com-email"
$approveBody = @{
    comment = "Approved"
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/$token2/approve" `
    -Method POST -ContentType "application/json" -UseBasicParsing -Body $approveBody

$result = $response.Content | ConvertFrom-Json
Write-Host (ConvertTo-Json $result)
```

**Expected Response:**
```json
{
  "requestId": "REQ-20260525-XXX",
  "status": "approved",
  "message": "All approvers approved - processing will resume",
  "allApproved": true,
  "nextStatus": "processing"
}
```

**✅ VERIFY**: `allApproved: true` - tells UI that all approvals complete, pipeline resuming

---

### Step 6: Verify Pipeline Resumed to Payment Envelope

```powershell
Start-Sleep -Seconds 2
$response = Invoke-WebRequest -Uri "http://localhost:8000/api/requests/REQ-20260525-XXX" `
    -Method GET -UseBasicParsing

$request = $response.Content | ConvertFrom-Json
Write-Host "Overall Status: $($request.overallStatus)"
Write-Host "Approval Status: $($request.envelopes.approval.status)"
Write-Host "Payment Status: $($request.envelopes.payment.status)"
```

**Expected:**
```
Overall Status: pending_payment
Approval Status: completed
Payment Status: in_progress (or pending_external if MAYA payment takes time)
```

✅ **VERIFIED**: Pipeline resumed from Approval → Payment envelope

---

## Denial Flow Tests

### Step 7: TEST - Denial Endpoint

**Test Goal:** Verify denial sets status to cancelled and sends email

Create a fresh request first:

```powershell
# Create new request (see Step 1)
# Get token from email

$denyBody = @{
    reason = "Missing documentation. Please resubmit with complete supporting documents."
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/$denyToken/deny" `
    -Method POST -ContentType "application/json" -UseBasicParsing -Body $denyBody

$result = $response.Content | ConvertFrom-Json
Write-Host (ConvertTo-Json $result)
```

**Expected Response:**
```json
{
  "requestId": "REQ-20260525-XXX",
  "status": "cancelled",
  "message": "Request has been cancelled and requestor has been notified",
  "reason": "Missing documentation. Please resubmit with complete supporting documents."
}
```

✅ **VERIFY**: Status is `cancelled` (not `failed`)

---

### Step 8: Verify Token is Expired After Denial

**Test Goal:** Verify that using the same token again fails

```powershell
# Try to use the same denied token again
$approveBody = @{ comment = "Approve" } | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/$denyToken/approve" `
        -Method POST -ContentType "application/json" -UseBasicParsing -Body $approveBody
    Write-Host "❌ ERROR: Token should have been marked as used!"
} catch {
    $result = $_.Exception.Response.Content | ConvertFrom-Json
    Write-Host "✅ Token correctly expired: $($result.error)"
}
```

**Expected:**
```
✅ Token correctly expired: "Approval token already used"
```

✅ **VERIFIED**: Token is immediately expired after denial

---

### Step 9: Verify Denial Email Sent

**Test Goal:** Check that requestor received cancellation email

Email should be sent to: `test@mapua.edu.ph` (from request parameters)

**Email Contents:**
- Subject: `Request Cancelled: transcript_of_records Request (REQ-20260525-XXX)`
- Body contains:
  - "Request Denied" heading
  - Request ID, Service Type, Status: CANCELLED
  - "REASON FOR DENIAL" section with the provided reason
  - "What's next?" section explaining resubmission process

✅ **VERIFY**: Email received by requestor with cancellation reason

---

### Step 10: Verify Request Status is Cancelled

```powershell
$response = Invoke-WebRequest -Uri "http://localhost:8000/api/requests/REQ-20260525-XXX" `
    -Method GET -UseBasicParsing

$request = $response.Content | ConvertFrom-Json
Write-Host "Overall Status: $($request.overallStatus)"
Write-Host "Approval Status: $($request.envelopes.approval.status)"
Write-Host "Approver Status: $($request.envelopes.approval.approvers[0].status)"
```

**Expected:**
```
Overall Status: cancelled
Approval Status: cancelled
Approver Status: denied
```

✅ **VERIFIED**: Full request marked as cancelled

---

## Error Handling Tests

### Test 11: Expired Token

```powershell
# Use a token that's past expiration (24 hours old)
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/$expiredToken/request" `
        -Method GET -UseBasicParsing
} catch {
    Write-Host "Error: $($_.Exception.Response.StatusCode)"
}
```

**Expected:** 400 Bad Request - "Approval token expired"

---

### Test 12: Invalid Token

```powershell
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/invalid-token/request" `
        -Method GET -UseBasicParsing
} catch {
    Write-Host "Error: $($_.Exception.Response.StatusCode)"
}
```

**Expected:** 404 Not Found - "Approval token not found"

---

### Test 13: Missing Reason on Deny

```powershell
try {
    $denyBody = @{} | ConvertTo-Json  # No reason field
    $response = Invoke-WebRequest -Uri "http://localhost:8000/api/approvals/$token/deny" `
        -Method POST -ContentType "application/json" -UseBasicParsing -Body $denyBody
} catch {
    $result = $_.Exception.Response.Content | ConvertFrom-Json
    Write-Host "✅ Validation working: $($result.error)"
}
```

**Expected:** 400 Bad Request - "Reason for denial required"

---

## Summary

This test guide verifies:

✅ all_must_approve rule enforced
✅ Partial approval keeps status as pending_external  
✅ Complete approval moves to next envelope
✅ Denial cancels request and sends email
✅ Tokens expire immediately after deny
✅ Error handling for invalid/expired tokens
✅ Validation for required fields

