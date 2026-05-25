# Script to artificially approve all pending approvals for a request and proceed through payment
# Usage: .\approve-all.ps1 "req-1779749513313-8442dc5f"

param(
    [Parameter(Mandatory=$true)]
    [string]$RequestId
)

# MongoDB connection (adjust as needed)
$mongoUri = "mongodb+srv://mapua_user:mapua_password_phase2@mapua-cluster.mongodb.net/service-envelope-dev"
$headers = @{"Content-Type" = "application/json"}

Write-Host "🔍 Fetching approval tokens for request: $RequestId" -ForegroundColor Cyan

# Use MongoDB CLI or npm script to query tokens
# For now, we'll query the API to get request details first
$requestUrl = "http://localhost:8000/api/requests/$RequestId"
$request = Invoke-WebRequest -Uri $requestUrl -Method GET -Headers $headers -UseBasicParsing | ConvertFrom-Json

if (-not $request) {
    Write-Host "❌ Request not found: $RequestId" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Request found: $($request.id)" -ForegroundColor Green
Write-Host "   Status: $($request.overallStatus)" -ForegroundColor Yellow
Write-Host "   Approvers: $($request.envelopes.approval.approvers.Count)" -ForegroundColor Yellow

# Since we need tokens from MongoDB, use mongo shell or Node script
# Creating a MongoDB query script
$mongoScript = @"
use('service-envelope-dev');
db.approvalTokens.find({ requestId: '$RequestId' }).toArray();
"@

Write-Host ""
Write-Host "⚠️  To approve using the API, we need the approval tokens from MongoDB:" -ForegroundColor Yellow
Write-Host "1. Run MongoDB to fetch tokens:" -ForegroundColor Cyan
Write-Host "   mongosh --connectionString 'mongodb+srv://mapua_user:mapua_password_phase2@mapua-cluster.mongodb.net/service-envelope-dev'" -ForegroundColor Gray
Write-Host "   > use('service-envelope-dev')" -ForegroundColor Gray
Write-Host "   > db.approvalTokens.find({ requestId: '$RequestId' }).toArray()" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Once you have the tokens, approve using:" -ForegroundColor Cyan
Write-Host "   `$token = 'PASTE_TOKEN_HERE'" -ForegroundColor Gray
Write-Host "   Invoke-WebRequest -Uri 'http://localhost:8000/api/approvals/`$token/approve' -Method POST -Headers @{'Content-Type'='application/json'} -Body '{}' -UseBasicParsing" -ForegroundColor Gray
Write-Host ""
Write-Host "OR use the Node.js script to approve all pending:" -ForegroundColor Cyan
Write-Host "   node approve-all.js '$RequestId'" -ForegroundColor Gray
