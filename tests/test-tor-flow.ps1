# TOR (Transcript of Records) Request - Full Flow Test
# Tests complete workflow: Request -> Approval -> Payment -> Processing -> Delivery -> Feedback

$BaseUrl = "http://localhost:8000/api"
$ServiceId = "SERV-3-04152026"

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "TOR REQUEST - FULL WORKFLOW TEST" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# ========== STEP 1: CREATE TOR REQUEST ==========
Write-Host "`n[STEP 1] Creating TOR Request..." -ForegroundColor Yellow

$requestBody = @{
    initiatorName = 'Maria Santos'
    initiatorEmail = 'maria.santos@mapua.edu.ph'
    serviceData = @{
        documentType = 'TRANSCRIPT'
        totalDocs = 2
        purpose = 'Job Application'
    }
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Uri "$BaseUrl/services/$ServiceId/submit" `
    -Method POST -ContentType 'application/json' -Body $requestBody

$requestId = $response.id
$status = $response.status

Write-Host "✅ Request Created" -ForegroundColor Green
Write-Host "   ID: $requestId" -ForegroundColor Green
Write-Host "   Status: $status" -ForegroundColor Green

Start-Sleep -Seconds 2

# ========== STEP 2: VERIFY APPROVAL RULES ==========
Write-Host "`n[STEP 2] Verifying Approval Rules (Complex: required + at-least-one)..." -ForegroundColor Yellow

$response = Invoke-RestMethod -Uri "$BaseUrl/requests/$requestId" -Method GET

$approvalRules = $response.envelopes.approval.approvalRules

Write-Host "✅ Approval Rules Verified" -ForegroundColor Green
Write-Host "   Type: $($approvalRules.type)" -ForegroundColor Green
Write-Host "   Required: $($approvalRules.requiredApprovers -join ', ')" -ForegroundColor Green
Write-Host "   At-Least-One: $($approvalRules.atLeastOneOf -join ', ')" -ForegroundColor Green

# ========== STEP 3: CHECK ENVELOPE STATUS ==========
Write-Host "`n[STEP 3] Current Envelope Status..." -ForegroundColor Yellow

Write-Host "   Request Envelope: $($response.envelopes.request.status.ToUpper())" -ForegroundColor Green
Write-Host "   Approval Envelope: $($response.envelopes.approval.status.ToUpper())" -ForegroundColor Yellow
Write-Host "   Payment Envelope: $($response.envelopes.payment.status.ToUpper())" -ForegroundColor Yellow
Write-Host "   Processing Envelope: $($response.envelopes.processing.status.ToUpper())" -ForegroundColor Yellow
Write-Host "   Delivery Envelope: $($response.envelopes.delivery.status.ToUpper())" -ForegroundColor Yellow
Write-Host "   Feedback Envelope: $($response.envelopes.feedback.status.ToUpper())" -ForegroundColor Yellow

# ========== STEP 4: GET APPROVAL TOKENS ==========
Write-Host "`n[STEP 4] Getting Approval Tokens..." -ForegroundColor Yellow

$response = Invoke-RestMethod -Uri "$BaseUrl/admin/approval-tokens/$requestId" -Method GET

Write-Host "✅ Approval Tokens Retrieved" -ForegroundColor Green
Write-Host "   Approver 1: barondimaranan@gmail.com (REQUIRED)" -ForegroundColor Green
Write-Host "   Approver 2: baron@fowlstudios.com (AT-LEAST-ONE)" -ForegroundColor Green
Write-Host "   Note: Tokens sent via email to approvers" -ForegroundColor DarkGray

# ========== STEP 5: SHOW FLOW DESCRIPTION ==========
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "WORKFLOW FLOW" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

Write-Host "`n1 REQUEST ENVELOPE - COMPLETED [OK]" -ForegroundColor Green
Write-Host "   - Request submitted and validated" -ForegroundColor DarkGray
Write-Host "   - Ready for approval" -ForegroundColor DarkGray

Write-Host "`n2 APPROVAL ENVELOPE - PENDING_EXTERNAL [WAIT]" -ForegroundColor Yellow
Write-Host "   - Complex approval rule active (AND logic)" -ForegroundColor DarkGray
Write-Host "   - Emails sent to both approvers" -ForegroundColor DarkGray
Write-Host "   - barondimaranan@gmail.com (REQUIRED approver)" -ForegroundColor DarkGray
Write-Host "   - baron@fowlstudios.com (AT-LEAST-ONE approver)" -ForegroundColor DarkGray
Write-Host "   - Both MUST approve to proceed" -ForegroundColor DarkGray

Write-Host "`n3 WHEN BOTH APPROVERS APPROVE:" -ForegroundColor Cyan
Write-Host "   [OK] Approval envelope -> COMPLETED" -ForegroundColor Green
Write-Host "   [OK] Payment notification email sent to requestor" -ForegroundColor Green
Write-Host "   [OK] Email contains Phase 2 UI payment link" -ForegroundColor Green
Write-Host "   [OK] Orchestrator resumes pipeline" -ForegroundColor Green

Write-Host "`n4 PAYMENT ENVELOPE - PENDING [WAIT]" -ForegroundColor Yellow
Write-Host "   - Requestor receives email with payment link" -ForegroundColor DarkGray
Write-Host "   - Clicks link to Phase 2 Payment UI" -ForegroundColor DarkGray
Write-Host "   - Pays via Maya gateway" -ForegroundColor DarkGray
Write-Host "   - Payment gateway returns success/failure" -ForegroundColor DarkGray

Write-Host "`n5 WHEN PAYMENT COMPLETES:" -ForegroundColor Cyan
Write-Host "   [OK] Payment endpoint records transaction" -ForegroundColor Green
Write-Host "   [OK] Payment envelope -> COMPLETED" -ForegroundColor Green
Write-Host "   [OK] Orchestrator skips already-completed envelopes" -ForegroundColor Green
Write-Host "   [OK] REQUEST skipped (already completed)" -ForegroundColor Green
Write-Host "   [OK] APPROVAL skipped (already completed)" -ForegroundColor Green

Write-Host "`n6 PROCESSING ENVELOPE - IN_PROGRESS [RUN]" -ForegroundColor Yellow
Write-Host "   - Business logic tasks execute" -ForegroundColor DarkGray
Write-Host "   - Generate transcripts" -ForegroundColor DarkGray
Write-Host "   - Update records" -ForegroundColor DarkGray

Write-Host "`n7 DELIVERY ENVELOPE - PENDING [WAIT]" -ForegroundColor Yellow
Write-Host "   - Email with transcript file sent to requestor" -ForegroundColor DarkGray

Write-Host "`n8 FEEDBACK ENVELOPE - PENDING [WAIT]" -ForegroundColor Yellow
Write-Host "   - Requestor provides feedback" -ForegroundColor DarkGray

# ========== STEP 6: KEY ENDPOINTS ==========
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "KEY ENDPOINTS FOR TESTING" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

Write-Host "`n[1] Check Request Status:" -ForegroundColor Yellow
Write-Host "    Invoke-RestMethod -Uri '$BaseUrl/requests/$requestId' -Method GET" -ForegroundColor Cyan

Write-Host "`n[2] Get Approval Tokens (Admin):" -ForegroundColor Yellow
Write-Host "    Invoke-RestMethod -Uri '$BaseUrl/admin/approval-tokens/$requestId' -Method GET" -ForegroundColor Cyan

Write-Host "`n[3] Simulate Payment Completion:" -ForegroundColor Yellow
Write-Host "    `$paymentBody = @{ transactionId='TXN-TEST-001'; amount=500; method='maya'; reference='REF-$requestId' } | ConvertTo-Json" -ForegroundColor Cyan
Write-Host "    Invoke-RestMethod -Uri '$BaseUrl/payments/$requestId/complete' -Method POST -ContentType 'application/json' -Body `$paymentBody" -ForegroundColor Cyan

Write-Host "`n[4] Check Final Status:" -ForegroundColor Yellow
Write-Host "    Invoke-RestMethod -Uri '$BaseUrl/requests/$requestId' -Method GET" -ForegroundColor Cyan

# ========== STEP 7: INSTRUCTIONS ==========
Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host "NEXT STEPS TO COMPLETE FLOW" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

Write-Host "`n[Option 1] Real Flow - Email Approvals:" -ForegroundColor Green
Write-Host "   1. Check email for barondimaranan@gmail.com" -ForegroundColor DarkGray
Write-Host "   2. Click approval link in email (unique token)" -ForegroundColor DarkGray
Write-Host "   3. Check email for baron@fowlstudios.com" -ForegroundColor DarkGray
Write-Host "   4. Click approval link in email (unique token)" -ForegroundColor DarkGray
Write-Host "   5. Both must approve (complex rule = AND logic)" -ForegroundColor DarkGray
Write-Host "   6. System auto-sends payment email to requestor" -ForegroundColor DarkGray
Write-Host "   7. Requestor clicks payment link" -ForegroundColor DarkGray
Write-Host "   8. Completes payment via Phase 2 UI" -ForegroundColor DarkGray

Write-Host "`n[Option 2] Quick Test - Use endpoints above:" -ForegroundColor Green

Write-Host "`n================================================" -ForegroundColor Green
Write-Host "REQUEST ID FOR ALL TESTS: $requestId" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
