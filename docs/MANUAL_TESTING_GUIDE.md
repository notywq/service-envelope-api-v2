SERVICE ORCHESTRATOR - MANUAL END-TO-END TEST GUIDE
=====================================================

This guide walks you through testing the complete Service Envelope workflow
using the Transcript of Records service with complex approval rules.

Service: Transcript of Records (transcriptOfRecords)
ID: SERV-3-05262026
Complex Rules: Required (barondimaranan@gmail.com) + At-Least-One (baron@fowlstudios.com OR barbargbf@gmail.com)

═══════════════════════════════════════════════════════════════════════════════

[STEP 1] CREATE TRANSCRIPT OF RECORDS REQUEST
═════════════════════════════════════════════════

This creates a new TOR request with all 6 envelopes initialized.

PowerShell:
-----------
$body = @{
    initiatorName = 'Juan Dela Cruz'
    initiatorEmail = 'juan.delacruz@mapua.edu.ph'
    serviceData = @{
        studentId = '2024-00456'
        firstName = 'Juan'
        lastName = 'Dela Cruz'
        numberOfCopies = 2
        purposes = 'Scholarship and Employment'
        deliveryMode = 'Email'
    }
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Uri 'http://localhost:8000/api/services/SERV-3-05262026/submit' `
    -Method POST -ContentType 'application/json' -Body $body

$requestId = $response.id
Write-Host "Request ID: $requestId"

CURL:
-----
curl -X POST http://localhost:8000/api/services/SERV-3-05262026/submit \
  -H "Content-Type: application/json" \
  -d '{
    "initiatorName": "Juan Dela Cruz",
    "initiatorEmail": "juan.delacruz@mapua.edu.ph",
    "serviceData": {
      "studentId": "2024-00456",
      "firstName": "Juan",
      "lastName": "Dela Cruz",
      "numberOfCopies": 2,
      "purposes": "Scholarship and Employment",
      "deliveryMode": "Email"
    }
  }'

Expected Response:
  - "id": "req-XXXXXXXXX" (save this as $requestId)
  - "status": "queued"
  - "message": "Request submitted successfully"

═══════════════════════════════════════════════════════════════════════════════

[STEP 2] VERIFY REQUEST DETAILS & ENVELOPE STATUS
══════════════════════════════════════════════════

This shows the current state of all 6 envelopes and approval rules.

PowerShell:
-----------
$req = Invoke-RestMethod -Uri "http://localhost:8000/api/requests/$requestId" -Method GET
$req | ConvertTo-Json -Depth 10 | Write-Host

CURL:
-----
curl http://localhost:8000/api/requests/<REQUEST_ID>

Expected to See:
  Request Envelope:     status = "completed"
  Approval Envelope:    status = "pending_external" (waiting for approvers)
  Payment Envelope:     status = "pending"
  Processing Envelope:  status = "pending"
  Delivery Envelope:    status = "pending"
  Feedback Envelope:    status = "pending"

Approval Rules:
  type: "complex"
  requiredApprovers: ["barondimaranan@gmail.com"]
  atLeastOneOf: ["baron@fowlstudios.com", "barbargbf@gmail.com"]

Payment Charges:
  - TOR processing fee: PHP 500
  - Printing and delivery: PHP 200
  Total: PHP 700

═══════════════════════════════════════════════════════════════════════════════

[STEP 3] GET APPROVAL TOKENS FOR BOTH APPROVERS
════════════════════════════════════════════════

This retrieves the approval tokens that will be used by approvers.

PowerShell:
-----------
$tokens = Invoke-RestMethod -Uri "http://localhost:8000/api/admin/approval-tokens/$requestId" -Method GET
$tokens | ConvertTo-Json -Depth 10 | Write-Host

CURL:
-----
curl http://localhost:8000/api/admin/approval-tokens/<REQUEST_ID>

Expected Response:
  {
    "approvers": [
      {
        "approverId": "barondimaranan@gmail.com",
        "approverRole": "Head Teller",
        "approverStatus": "pending"
      },
      {
        "approverId": "baron@fowlstudios.com",
        "approverRole": "Sub Teller 1",
        "approverStatus": "pending"
      },
      {
        "approverId": "barbargbf@gmail.com",
        "approverRole": "Sub Teller 2",
        "approverStatus": "pending"
      }
    ]
  }

Note: Tokens are generated when approval emails are sent. Check server logs or MongoDB
for actual token values.

═══════════════════════════════════════════════════════════════════════════════

[STEP 4] SIMULATE FIRST APPROVAL (REQUIRED APPROVER)
════════════════════════════════════════════════════

In real scenario, barondimaranan@gmail.com would click the approval link in email.
Here we simulate that by calling the API directly.

Step 4a: Get the actual token from MongoDB or server logs
────────────────────────────────────────────────────────
Check the server logs for:
  "🔐 Generated approval token for request <REQUEST_ID>"

Or query MongoDB:
  db.ApprovalToken.find({requestId: '<REQUEST_ID>'}).pretty()

Look for the token where approverId = "barondimaranan@gmail.com"

Step 4b: Call the approval endpoint
───────────────────────────────────

PowerShell:
-----------
$approveBody = @{
    decision = 'approved'
    comments = 'Approved for transcript release'
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8000/api/approvals/<TOKEN_FROM_STEP_4a>/approve" `
    -Method POST `
    -ContentType 'application/json' `
    -Body $approveBody

CURL:
-----
curl -X POST http://localhost:8000/api/approvals/<TOKEN_FROM_STEP_4a>/approve \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "comments": "Approved for transcript release"
  }'

Expected Response:
  {
    "status": "approved",
    "message": "Approval recorded",
    "requestId": "<REQUEST_ID>"
  }

Server Logs:
  You should see: "✅ Approval received for request <REQUEST_ID>"

═══════════════════════════════════════════════════════════════════════════════

[STEP 5] SIMULATE SECOND APPROVAL (AT-LEAST-ONE APPROVER)
═════════════════════════════════════════════════════════

Now we need one of the optional approvers to approve.
Let's use baron@fowlstudios.com

Step 5a: Get token for baron@fowlstudios.com
─────────────────────────────────────────────
From MongoDB:
  db.ApprovalToken.find({requestId: '<REQUEST_ID>', approverId: 'baron@fowlstudios.com'}).pretty()

Step 5b: Call the approval endpoint
───────────────────────────────────

PowerShell:
-----------
$approveBody = @{
    decision = 'approved'
    comments = 'Approved'
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:8000/api/approvals/<TOKEN_FROM_STEP_5a>/approve" `
    -Method POST `
    -ContentType 'application/json' `
    -Body $approveBody

CURL:
-----
curl -X POST http://localhost:8000/api/approvals/<TOKEN_FROM_STEP_5a>/approve \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "comments": "Approved"
  }'

CRITICAL POINT: After both approvals
────────────────────────────────────
When BOTH approvers approve:

1. Approval envelope transitions to COMPLETED
2. ApprovalProcessor automatically sends PAYMENT NOTIFICATION EMAIL to requestor
   - Email sent to: juan.delacruz@mapua.edu.ph
   - Contains: Phase 2 UI payment link + total charges (PHP 700)
   - Link format: http://localhost:3000/payment?requestId=<REQUEST_ID>
3. Orchestrator resumes pipeline

Server Logs to expect:
  "📧 Payment notification email sent to juan.delacruz@mapua.edu.ph"
  "[SUCCESS] - Processed Approval envelope"

═══════════════════════════════════════════════════════════════════════════════

[STEP 6] CHECK REQUEST STATUS AFTER BOTH APPROVALS
═══════════════════════════════════════════════════

Verify approval is complete and payment notification was sent.

PowerShell:
-----------
$req = Invoke-RestMethod -Uri "http://localhost:8000/api/requests/$requestId" -Method GET
Write-Host "Approval Status: $($req.envelopes.approval.status)"
Write-Host "Payment Status: $($req.envelopes.payment.status)"
Write-Host "Processing Status: $($req.envelopes.processing.status)"

CURL:
-----
curl http://localhost:8000/api/requests/<REQUEST_ID> | jq '.envelopes | {approval: .approval.status, payment: .payment.status, processing: .processing.status}'

Expected Status:
  Approval Envelope:    status = "completed"
  Payment Envelope:     status = "pending"
  Processing Envelope:  status = "pending"

═══════════════════════════════════════════════════════════════════════════════

[STEP 7] SIMULATE PAYMENT COMPLETION
═════════════════════════════════════

Now the requestor has clicked the payment link and completed payment via Phase 2 UI.
We simulate this by calling the payment completion endpoint.

PowerShell:
-----------
$paymentBody = @{
    transactionId = 'TXN-TOR-' + (Get-Date -Format 'yyyyMMddHHmmss')
    amount = 700
    method = 'maya'
    reference = "REF-$requestId"
    metadata = @{
        source = 'phase2_ui'
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
    }
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Uri "http://localhost:8000/api/payments/$requestId/complete" `
    -Method POST `
    -ContentType 'application/json' `
    -Body $paymentBody

Write-Host $response | ConvertTo-Json

CURL:
-----
curl -X POST http://localhost:8000/api/payments/<REQUEST_ID>/complete \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "TXN-TOR-20260526120000",
    "amount": 700,
    "method": "maya",
    "reference": "REF-<REQUEST_ID>",
    "metadata": {
      "source": "phase2_ui",
      "timestamp": "2026-05-26T12:00:00Z"
    }
  }'

Expected Response:
  {
    "status": "completed",
    "message": "Payment recorded and processing resumed",
    "transactionId": "TXN-TOR-20260526120000",
    "nextStatus": "processing"
  }

Server Logs to expect:
  "💳 Payment completed for request <REQUEST_ID>: Transaction TXN-TOR-20260526120000"
  "Starting orchestration for request <REQUEST_ID>"
  "Skipping REQUEST (status: COMPLETED)"
  "Skipping APPROVAL (status: COMPLETED)"
  "Processing Payment envelope for request <REQUEST_ID>"

CRITICAL: ORCHESTRATOR SKIP LOGIC
──────────────────────────────────
This demonstrates the skip feature:
  ✓ REQUEST envelope: SKIPPED (already completed)
  ✓ APPROVAL envelope: SKIPPED (already completed)
  ✓ PAYMENT envelope: COMPLETED
  ✓ PROCESSING envelope: STARTS NOW

═══════════════════════════════════════════════════════════════════════════════

[STEP 8] VERIFY FINAL STATUS (ALL ENVELOPES PROGRESSING)
═════════════════════════════════════════════════════════

Check the final state after payment completes and orchestrator resumes.

PowerShell:
-----------
$req = Invoke-RestMethod -Uri "http://localhost:8000/api/requests/$requestId" -Method GET

Write-Host "=== FINAL ENVELOPE STATUS ===" -ForegroundColor Cyan
Write-Host "Request Envelope:     $($req.envelopes.request.status)" -ForegroundColor Green
Write-Host "Approval Envelope:    $($req.envelopes.approval.status)" -ForegroundColor Green
Write-Host "Payment Envelope:     $($req.envelopes.payment.status)" -ForegroundColor Green
Write-Host "Processing Envelope:  $($req.envelopes.processing.status)" -ForegroundColor Yellow
Write-Host "Delivery Envelope:    $($req.envelopes.delivery.status)" -ForegroundColor Yellow
Write-Host "Feedback Envelope:    $($req.envelopes.feedback.status)" -ForegroundColor Yellow

Write-Host "`n=== TRANSACTION DATA ===" -ForegroundColor Cyan
Write-Host "Payment Transaction ID: $($req.envelopes.payment.paymentGatewayResponse.transactionId)"
Write-Host "Payment Amount: $($req.envelopes.payment.paymentGatewayResponse.amount)"
Write-Host "Payment Method: $($req.envelopes.payment.paymentGatewayResponse.method)"

CURL:
-----
curl http://localhost:8000/api/requests/<REQUEST_ID> | jq '.envelopes | {request: .request.status, approval: .approval.status, payment: .payment.status, processing: .processing.status, delivery: .delivery.status, feedback: .feedback.status}'

Expected Final Status:
  Request Envelope:     "completed"       ✅
  Approval Envelope:    "completed"       ✅
  Payment Envelope:     "completed"       ✅
  Processing Envelope:  "in_progress"     🔄 (or "completed" if tasks finished)
  Delivery Envelope:    "pending"         ⏳
  Feedback Envelope:    "pending"         ⏳

═══════════════════════════════════════════════════════════════════════════════

[SUMMARY] WHAT WE TESTED
═════════════════════════

✅ Complex Approval Rules (AND logic)
   - Both required approver approved
   - At least one optional approver approved
   - Request moved to next phase

✅ Automatic Payment Notification Email
   - Sent immediately after approval completion
   - Contains Phase 2 UI payment link
   - Includes total charges (PHP 700)

✅ Payment Completion Workflow
   - User clicks Phase 2 UI link
   - Completes payment via Maya
   - Sends transaction to completion endpoint

✅ Orchestrator Skip Logic
   - REQUEST envelope skipped (already completed)
   - APPROVAL envelope skipped (already completed)
   - PAYMENT envelope marked as completed
   - PROCESSING envelope initiated (moved to in_progress)

✅ 6-Envelope Sequential Pipeline
   1. REQUEST   → COMPLETED
   2. APPROVAL  → COMPLETED
   3. PAYMENT   → COMPLETED
   4. PROCESSING → IN_PROGRESS
   5. DELIVERY  → PENDING
   6. FEEDBACK  → PENDING

═══════════════════════════════════════════════════════════════════════════════

[TROUBLESHOOTING]
═════════════════

Issue: Approval token not found
→ Check server logs for "Generated approval token" messages
→ Query MongoDB: db.ApprovalToken.find({requestId: '<REQUEST_ID>'})
→ Ensure you used the correct token format (from MongoDB)

Issue: Payment email not sent
→ Check ApprovalProcessor is initialized with EmailService
→ Check server logs for "Payment notification email sent"
→ Verify approveEmail sent successfully before assuming payment email

Issue: Orchestrator not resuming after payment
→ Check payment endpoint was called correctly (with transactionId and amount)
→ Check server logs for "Starting orchestration"
→ Verify previous envelopes are marked as completed

Issue: Processing envelope not starting
→ Verify all previous envelopes are completed
→ Check that payment endpoint returned success response
→ Check server logs for orchestrator status

═══════════════════════════════════════════════════════════════════════════════
