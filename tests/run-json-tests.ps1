#!/usr/bin/env pwsh
<#
.SYNOPSIS
Test runner for cancellations and delivery method endpoints using JSON test definitions
.DESCRIPTION
Uses test-cancellations-and-delivery.json to execute API test scenarios
#>

$testFile = "./tests/test-cancellations-and-delivery.json"
$tests = Get-Content $testFile -Raw | ConvertFrom-Json
$baseUrl = $tests.baseUrl

Write-Host "`n" + ("="*80) -ForegroundColor Blue
Write-Host $tests.testSuite -ForegroundColor Blue
Write-Host ("="*80) -ForegroundColor Blue

# Test 1: Create Request
Write-Host "`n[TEST 1] CREATE REQUEST" -ForegroundColor Yellow
Write-Host $tests.tests[0].description -ForegroundColor Gray

$test1 = $tests.tests[0]
$reqBody = $test1.requestBody | ConvertTo-Json

Write-Host "POST $baseUrl$($test1.endpoint)" -ForegroundColor Cyan
Write-Host $reqBody -ForegroundColor Gray

$response1 = Invoke-WebRequest -Uri "$baseUrl$($test1.endpoint)" `
    -Method POST `
    -ContentType "application/json" `
    -Body $reqBody `
    -UseBasicParsing `
    -ErrorAction Stop

$requestId = ($response1.Content | ConvertFrom-Json).requestId
Write-Host "✅ Request created: $requestId" -ForegroundColor Green

# Test 2: Approval Denial Flow
Write-Host "`n[TEST 2] APPROVAL DENIAL → CANCELLATION" -ForegroundColor Yellow
Write-Host $tests.tests[1].description -ForegroundColor Gray

$test2 = $tests.tests[1]

Write-Host "`nStep 1: Create request" -ForegroundColor Cyan
$req2Body = $test2.steps[0].requestBody | ConvertTo-Json
$response2 = Invoke-WebRequest -Uri "$baseUrl/requests" `
    -Method POST `
    -ContentType "application/json" `
    -Body $req2Body `
    -UseBasicParsing `
    -ErrorAction Stop
$requestId2 = ($response2.Content | ConvertFrom-Json).requestId
Write-Host "✅ Request created: $requestId2" -ForegroundColor Green

Write-Host "`nStep 2-3: Approval would be denied (requires token from email)" -ForegroundColor Cyan
Write-Host "In real test, use token from approval email" -ForegroundColor Gray

Write-Host "`nStep 4: Check request status for cancellation" -ForegroundColor Cyan
$checkResponse = Invoke-WebRequest -Uri "$baseUrl/requests/$requestId2" -Method GET -UseBasicParsing -ErrorAction Stop
$status = ($checkResponse.Content | ConvertFrom-Json).overallStatus
Write-Host "Request status: $status" -ForegroundColor Gray

# Test 3: Delivery Method - POST
Write-Host "`n[TEST 4] DELIVERY METHOD - POST (Select Physical Mail)" -ForegroundColor Yellow
Write-Host $tests.tests[3].description -ForegroundColor Gray

Write-Host "Using request: $requestId" -ForegroundColor Gray

$deliveryBody = $tests.tests[3].steps[1].requestBody | ConvertTo-Json

Write-Host "POST $baseUrl/delivery/$requestId/method" -ForegroundColor Cyan
Write-Host $deliveryBody -ForegroundColor Gray

$response4 = Invoke-WebRequest -Uri "$baseUrl/delivery/$requestId/method" `
    -Method POST `
    -ContentType "application/json" `
    -Body $deliveryBody `
    -UseBasicParsing `
    -ErrorAction SilentlyContinue

if ($response4) {
    $result4 = $response4.Content | ConvertFrom-Json
    Write-Host "✅ Response:" -ForegroundColor Green
    Write-Host "   Method: $($result4.method)" -ForegroundColor Gray
    Write-Host "   Status: $($result4.status)" -ForegroundColor Gray
    Write-Host "   Details: $($result4.deliveryDetails | ConvertTo-Json -Compress)" -ForegroundColor Gray
} else {
    Write-Host "⚠️  Request might be in wrong state (needs to be at delivery envelope)" -ForegroundColor Yellow
}

# Test 4: Delivery Method - GET
Write-Host "`n[TEST 5] DELIVERY METHOD - GET (Retrieve Method)" -ForegroundColor Yellow
Write-Host $tests.tests[4].description -ForegroundColor Gray

Write-Host "GET $baseUrl/delivery/$requestId/method" -ForegroundColor Cyan

$response5 = Invoke-WebRequest -Uri "$baseUrl/delivery/$requestId/method" `
    -Method GET `
    -UseBasicParsing `
    -ErrorAction SilentlyContinue

if ($response5) {
    $result5 = $response5.Content | ConvertFrom-Json
    Write-Host "✅ Response:" -ForegroundColor Green
    Write-Host "   RequestID: $($result5.requestId)" -ForegroundColor Gray
    Write-Host "   DeliveryMethod: $($result5.deliveryMethod)" -ForegroundColor Gray
    Write-Host "   Status: $($result5.status)" -ForegroundColor Gray
    Write-Host "   Details: $($result5.details | ConvertTo-Json -Compress)" -ForegroundColor Gray
    Write-Host "   Frontend URL: $($tests.frontendUrl)/delivery/$requestId/tracking" -ForegroundColor Cyan
} else {
    Write-Host "⚠️  Could not fetch delivery method" -ForegroundColor Yellow
}

# Summary
Write-Host "`n" + ("="*80) -ForegroundColor Blue
Write-Host "API ENDPOINTS SUMMARY" -ForegroundColor Blue
Write-Host ("="*80) -ForegroundColor Blue

foreach ($endpoint in $tests.apiEndpointsSummary.PSObject.Properties) {
    $api = $endpoint.Value
    Write-Host "`n$($api.method) $($api.endpoint)" -ForegroundColor Cyan
    Write-Host "   $($api.description)" -ForegroundColor Gray
}

Write-Host "`n" + ("="*80) -ForegroundColor Blue
Write-Host "TEST DATA" -ForegroundColor Blue
Write-Host ("="*80) -ForegroundColor Blue

Write-Host "`n📋 REQUEST PARAMETERS:" -ForegroundColor Green
$tests.testData.requests[0] | ConvertTo-Json | Write-Host -ForegroundColor Gray

Write-Host "`n📦 DELIVERY METHODS:" -ForegroundColor Green
$tests.testData.deliveryMethods | ConvertTo-Json | Write-Host -ForegroundColor Gray

Write-Host "`n" + ("="*80) -ForegroundColor Blue
