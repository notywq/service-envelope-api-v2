#!/usr/bin/env pwsh
<#
.SYNOPSIS
Upload email templates to MongoDB via the admin API
.EXAMPLE
./upload-email-templates.ps1 -jsonPath "data/csd-email-templates.json" -baseUrl "http://localhost:8000"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$jsonPath,
    
    [Parameter(Mandatory=$false)]
    [string]$baseUrl = "http://localhost:8000"
)

# Read the JSON file
if (-not (Test-Path $jsonPath)) {
    Write-Host "❌ File not found: $jsonPath" -ForegroundColor Red
    exit 1
}

Write-Host "📖 Reading email templates from: $jsonPath" -ForegroundColor Cyan
$templates = Get-Content -Path $jsonPath -Raw | ConvertFrom-Json

Write-Host "📋 Found $($templates.Count) templates to upload" -ForegroundColor Yellow
Write-Host ""

$successCount = 0
$failureCount = 0

foreach ($template in $templates) {
    $templateId = $template.templateId
    $templateName = $template.subject
    
    Write-Host "📤 Uploading: $templateId" -ForegroundColor Cyan
    
    try {
        $response = Invoke-WebRequest `
            -Uri "$baseUrl/api/admin/email-templates" `
            -Method POST `
            -ContentType "application/json" `
            -Body ($template | ConvertTo-Json -Depth 10) `
            -ErrorAction Stop
        
        if ($response.StatusCode -eq 201) {
            Write-Host "   ✅ Success" -ForegroundColor Green
            $successCount++
        } else {
            Write-Host "   ⚠️  Unexpected response: $($response.StatusCode)" -ForegroundColor Yellow
            $failureCount++
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        $errorBody = $_.Exception.Response.Content.ReadAsStringAsync().Result
        $error = $errorBody | ConvertFrom-Json -ErrorAction SilentlyContinue
        
        Write-Host "   ❌ Failed (Status: $statusCode)" -ForegroundColor Red
        if ($error.error) {
            Write-Host "      Error: $($error.error)" -ForegroundColor Red
        }
        $failureCount++
    }
}

Write-Host ""
Write-Host "Upload Complete:" -ForegroundColor Green
$failColor = if ($failureCount -eq 0) { "Green" } else { "Red" }
Write-Host "   Success: $successCount" -ForegroundColor Green
Write-Host "   Failed: $failureCount" -ForegroundColor $failColor
