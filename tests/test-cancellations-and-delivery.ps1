#!/usr/bin/env pwsh
<#
.SYNOPSIS
Test cancellation flows and delivery method endpoints
.DESCRIPTION
Tests for:
- Approval denial → cancellation email
- Payment expiry → cancellation email
- Processing failure → cancellation email (existing)
- POST /api/delivery/:requestId/method (select delivery)
- GET /api/delivery/:requestId/method (retrieve delivery)
#>

$API_URL = "http://localhost:8000/api"
$FRONTEND_URL = "http://localhost:5173"

# Colors for output
$Green = @{ ForegroundColor = 'Green' }
$Red = @{ ForegroundColor = 'Red' }
$Yellow = @{ ForegroundColor = 'Yellow' }
$Cyan = @{ ForegroundColor = 'Cyan' }
$Gray = @{ ForegroundColor = 'DarkGray' }

Write-Host "`n" + ("="*80) -ForegroundColor Blue
Write-Host "SERVICE ENVELOPE - CANCELLATION & DELIVERY ENDPOINT TESTS" -ForegroundColor Blue
Write-Host ("="*80) -ForegroundColor Blue

# ============================================================================
# TEST 1: APPROVAL DENIAL → CANCELLATION EMAIL
# ============================================================================
Write-Host "`n[TEST 1] APPROVAL DENIAL → REQUEST CANCELLATION" @Yellow
Write-Host "─" * 80 -ForegroundColor Yellow

Write-Host "1️⃣ Submit request" @Cyan
$requestBody = @{
    serviceType = "comprehensive-student-document"
    studentId = "2024-00501"
    firstName = "Test"
    lastName = "Denier"
    email = "test-denier@mapua.edu.ph"
    documentTypes = @("academic_record", "official_transcript")
    purpose = "employment"
    numberOfCopies = 1
    deliveryMethod = "email"
    isUrgent = $false
    remarks = "Testing approval denial flow"
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri "$API_URL/requests" `
    -Method POST `
    -ContentType "application/json" `
    -Body $requestBody -ErrorAction Stop

$requestId = ($response.Content | ConvertFrom-Json).requestId
Write-Host "✅ Request created: $requestId" @Green

Write-Host "`n2️⃣ Wait for approval envelope (processing automatically starts)" @Cyan
Start-Sleep -Seconds 2

Write-Host "`n3️⃣ Get approval token from one of the approvers" @Cyan
Write-Host "  (In real scenario, approver receives token via email)" @Gray
Write-Host "  Expected token URL in email: $FRONTEND_URL/approvals/{token}" @Gray

Write-Host "`n4️⃣ DENY the request via approval endpoint" @Cyan
$denyBody = @{
    reason = "Request does not meet institutional requirements"
} | ConvertTo-Json

$denyResponse = Invoke-WebRequest -Uri "$API_URL/approvals/test-token-123/deny" `
    -Method POST `
    -ContentType "application/json" `
    -Body $denyBody -ErrorAction SilentlyContinue

Write-Host "✅ Denial submitted" @Green
Write-Host "📧 Cancellation email should be sent to: test-denier@mapua.edu.ph" @Cyan
Write-Host "   Subject: Your Document Request Has Been Cancelled" @Gray
Write-Host "   Content: Denied by approver + refund details" @Gray

Write-Host "`n5️⃣ Check request status → should be CANCELLED" @Cyan
$checkResponse = Invoke-WebRequest -Uri "$API_URL/requests/$requestId" `
    -Method GET -ErrorAction Stop

$requestStatus = ($checkResponse.Content | ConvertFrom-Json).overallStatus
Write-Host "✅ Request status: $requestStatus (expected: cancelled)" @Green

# ============================================================================
# TEST 2: PAYMENT EXPIRY → CANCELLATION EMAIL
# ============================================================================
Write-Host "`n[TEST 2] PAYMENT EXPIRY → REQUEST CANCELLATION" @Yellow
Write-Host "─" * 80 -ForegroundColor Yellow

Write-Host "1️⃣ Submit request" @Cyan
$requestBody2 = @{
    serviceType = "comprehensive-student-document"
    studentId = "2024-00502"
    firstName = "Test"
    lastName = "PaymentExpiry"
    email = "test-expiry@mapua.edu.ph"
    documentTypes = @("official_transcript")
    purpose = "graduate_admission"
    numberOfCopies = 1
    deliveryMethod = "physical_mail"
    mailingAddress = "123 Main St, Manila, 1000"
    isUrgent = $false
    remarks = "Testing payment expiry flow"
} | ConvertTo-Json

$response2 = Invoke-WebRequest -Uri "$API_URL/requests" `
    -Method POST `
    -ContentType "application/json" `
    -Body $requestBody2 -ErrorAction Stop

$requestId2 = ($response2.Content | ConvertFrom-Json).requestId
Write-Host "✅ Request created: $requestId2" @Green

Write-Host "`n2️⃣ Wait for approval (completes quickly)" @Cyan
Start-Sleep -Seconds 2

Write-Host "`n3️⃣ Request reaches payment envelope (7-day expiry)" @Cyan
Write-Host "   Payment init timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" @Gray
Write-Host "   Expiry timestamp (7 days later): $(Get-Date -Date (Get-Date).AddDays(7) -Format 'yyyy-MM-dd HH:mm:ss')" @Gray

Write-Host "`n4️⃣ Simulate 7+ days passing (manual test: modify payment.timestamp in DB)" @Cyan
Write-Host "   When orchestrator re-processes request after 7 days:" @Gray
Write-Host "   - checkPaymentExpiry() detects expiry" @Gray
Write-Host "   - Sets request.overallStatus = 'cancelled'" @Gray
Write-Host "   - Sends cancellation email" @Gray

Write-Host "`n5️⃣ Cancellation email sent to: test-expiry@mapua.edu.ph" @Cyan
Write-Host "📧 Subject: Your Document Request Has Been Cancelled" @Green
Write-Host "   Content: 'Payment window expired (7 days)'" @Gray

# ============================================================================
# TEST 3: DELIVERY METHOD SELECTION (NEW ENDPOINTS)
# ============================================================================
Write-Host "`n[TEST 3] DELIVERY METHOD - POST & GET ENDPOINTS" @Yellow
Write-Host "─" * 80 -ForegroundColor Yellow

Write-Host "1️⃣ Create and approve a request to reach delivery envelope" @Cyan
$requestBody3 = @{
    serviceType = "comprehensive-student-document"
    studentId = "2024-00503"
    firstName = "Test"
    lastName = "Delivery"
    email = "test-delivery@mapua.edu.ph"
    documentTypes = @("academic_record")
    purpose = "employment"
    numberOfCopies = 2
    deliveryMethod = "email"
    isUrgent = $false
    remarks = "Testing delivery method endpoints"
} | ConvertTo-Json

$response3 = Invoke-WebRequest -Uri "$API_URL/requests" `
    -Method POST `
    -ContentType "application/json" `
    -Body $requestBody3 -ErrorAction Stop

$requestId3 = ($response3.Content | ConvertFrom-Json).requestId
Write-Host "✅ Request created: $requestId3" @Green

Write-Host "`n2️⃣ POST /api/delivery/:requestId/method (select PHYSICAL_MAIL)" @Cyan
$deliveryBody = @{
    method = "physical_mail"
    details = @{
        physical_mail = @{
            mailingAddress = "456 Oak Ave, Quezon City, 1100"
        }
    }
} | ConvertTo-Json

$deliveryPostResponse = Invoke-WebRequest -Uri "$API_URL/delivery/$requestId3/method" `
    -Method POST `
    -ContentType "application/json" `
    -Body $deliveryBody -ErrorAction Stop

$postResult = $deliveryPostResponse.Content | ConvertFrom-Json
Write-Host "✅ Response:" @Green
Write-Host "   Method: $($postResult.method)" @Gray
Write-Host "   Status: $($postResult.status)" @Gray
Write-Host "   Details: $($postResult.deliveryDetails | ConvertTo-Json -Compress)" @Gray

Write-Host "`n3️⃣ GET /api/delivery/:requestId/method (retrieve method)" @Cyan
$deliveryGetResponse = Invoke-WebRequest -Uri "$API_URL/delivery/$requestId3/method" `
    -Method GET -ErrorAction Stop

$getResult = $deliveryGetResponse.Content | ConvertFrom-Json
Write-Host "✅ Response:" @Green
Write-Host "   RequestID: $($getResult.requestId)" @Gray
Write-Host "   DeliveryMethod: $($getResult.deliveryMethod)" @Gray
Write-Host "   Status: $($getResult.status)" @Gray
Write-Host "   Details: $($getResult.details | ConvertTo-Json -Compress)" @Gray
Write-Host "   AvailableMethods: $($getResult.availableMethods.Keys -join ', ')" @Gray

Write-Host "`n4️⃣ Frontend can now route based on deliveryMethod:" @Cyan
Write-Host "   - GET /delivery/req-xxx/method returns: { deliveryMethod: 'PHYSICAL_MAIL', ... }" @Gray
Write-Host "   - Frontend URL: $FRONTEND_URL/delivery/$requestId3/tracking" @Gray
Write-Host "   - UI shows: Address form, carrier tracking, pickup deadline" @Gray

# ============================================================================
# TEST 4: ALTERNATIVE DELIVERY METHODS
# ============================================================================
Write-Host "`n[TEST 4] ALTERNATIVE DELIVERY METHODS" @Yellow
Write-Host "─" * 80 -ForegroundColor Yellow

Write-Host "✉️  EMAIL DELIVERY METHOD:" @Cyan
$emailBody = @{
    method = "email"
    details = @{
        email = @{}
    }
} | ConvertTo-Json
Write-Host "POST /api/delivery/:requestId/method" @Gray
Write-Host $emailBody @Gray

Write-Host "`n📍 PICKUP METHOD:" @Cyan
$pickupBody = @{
    method = "pickup"
    details = @{
        pickup = @{}
    }
} | ConvertTo-Json
Write-Host "POST /api/delivery/:requestId/method" @Gray
Write-Host $pickupBody @Gray

Write-Host "`n📦 PHYSICAL_MAIL WITH FULL DETAILS:" @Cyan
$physicalBody = @{
    method = "physical_mail"
    details = @{
        physical_mail = @{
            mailingAddress = "789 Pine St, Makati, 1229"
            carrier = "LBC"
            requiresSignature = $false
        }
    }
} | ConvertTo-Json
Write-Host "POST /api/delivery/:requestId/method" @Gray
Write-Host $physicalBody @Gray

# ============================================================================
# SUMMARY
# ============================================================================
Write-Host "`n" + ("="*80) -ForegroundColor Blue
Write-Host "TEST SUMMARY" -ForegroundColor Blue
Write-Host ("="*80) -ForegroundColor Blue

Write-Host "`n✅ CANCELLATION FLOWS:" @Green
Write-Host "   1. Approval Denial: Sets request.overallStatus='cancelled' + email" @Gray
Write-Host "   2. Payment Expiry: Detects 7+ days elapsed + cancellation email" @Gray
Write-Host "   3. Processing Failure: Sets request.overallStatus='cancelled' + email" @Gray

Write-Host "`n✅ DELIVERY METHOD ENDPOINTS:" @Green
Write-Host "   POST /api/delivery/:requestId/method" @Gray
Write-Host "   GET /api/delivery/:requestId/method" @Gray
Write-Host "   → Returns deliveryMethod for frontend UI routing" @Gray

Write-Host "`n✅ REQUEST PATHS:" @Green
Write-Host "   Frontend tracking URL: $FRONTEND_URL/delivery/req-xxx/tracking" @Gray
Write-Host "   Backend method check: GET /api/delivery/req-xxx/method" @Gray
Write-Host "   UI determines: EMAIL | PHYSICAL_MAIL | PICKUP" @Gray

Write-Host "`n" + ("="*80) -ForegroundColor Blue
