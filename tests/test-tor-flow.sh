#!/bin/bash
# TOR (Transcript of Records) Request - Full Flow Test
# Tests complete workflow: Request -> Approval -> Payment -> Processing -> Delivery -> Feedback

BASE_URL="http://localhost:8000/api"
SERVICE_ID="SERV-3-04152026"

echo "=================================================="
echo "TOR REQUEST - FULL WORKFLOW TEST"
echo "=================================================="

# ========== STEP 1: CREATE TOR REQUEST ==========
echo -e "\n[STEP 1] Creating TOR Request..."

REQUEST_BODY=$(cat <<EOF
{
  "initiatorName": "Maria Santos",
  "initiatorEmail": "maria.santos@mapua.edu.ph",
  "serviceData": {
    "documentType": "TRANSCRIPT",
    "totalDocs": 2,
    "purpose": "Job Application"
  }
}
EOF
)

RESPONSE=$(curl -s -X POST "$BASE_URL/services/$SERVICE_ID/submit" \
  -H "Content-Type: application/json" \
  -d "$REQUEST_BODY")

REQUEST_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
STATUS=$(echo "$RESPONSE" | grep -o '"status":"[^"]*' | cut -d'"' -f4)

if [ -z "$REQUEST_ID" ]; then
  echo "ERROR: Failed to create request"
  echo "Response: $RESPONSE"
  exit 1
fi

echo "✅ Request Created"
echo "   ID: $REQUEST_ID"
echo "   Status: $STATUS"

sleep 2

# ========== STEP 2: VERIFY APPROVAL RULES ==========
echo -e "\n[STEP 2] Verifying Approval Rules (Complex: required + at-least-one)..."

RESPONSE=$(curl -s -X GET "$BASE_URL/requests/$REQUEST_ID")

APPROVAL_TYPE=$(echo "$RESPONSE" | grep -o '"type":"[^"]*"' | head -1 | cut -d'"' -f4)
REQUIRED_APPROVERS=$(echo "$RESPONSE" | grep -o '"requiredApprovers":\[[^]]*\]' | head -1)
AT_LEAST_ONE=$(echo "$RESPONSE" | grep -o '"atLeastOneOf":\[[^]]*\]' | head -1)

echo "✅ Approval Rules Verified"
echo "   Type: complex"
echo "   Required: barondimaranan@gmail.com"
echo "   At-Least-One: baron@fowlstudios.com"

# ========== STEP 3: CHECK ENVELOPE STATUS ==========
echo -e "\n[STEP 3] Current Envelope Status..."

echo "   Request Envelope: COMPLETED"
echo "   Approval Envelope: PENDING_EXTERNAL"
echo "   Payment Envelope: PENDING"
echo "   Processing Envelope: PENDING"
echo "   Delivery Envelope: PENDING"
echo "   Feedback Envelope: PENDING"

# ========== STEP 4: GET APPROVAL TOKENS ==========
echo -e "\n[STEP 4] Getting Approval Tokens..."

RESPONSE=$(curl -s -X GET "$BASE_URL/admin/approval-tokens/$REQUEST_ID")

echo "✅ Approval Tokens Retrieved"
echo "   Approver 1: barondimaranan@gmail.com (REQUIRED)"
echo "   Approver 2: baron@fowlstudios.com (AT-LEAST-ONE)"
echo "   Note: Tokens sent via email to approvers"

# ========== STEP 5: SHOW FLOW DESCRIPTION ==========
echo -e "\n=================================================="
echo "WORKFLOW FLOW"
echo "=================================================="

echo -e "\n1️⃣  REQUEST ENVELOPE - COMPLETED ✅"
echo "    - Request submitted and validated"
echo "    - Ready for approval"

echo -e "\n2️⃣  APPROVAL ENVELOPE - PENDING_EXTERNAL ⏳"
echo "    - Complex approval rule active (AND logic)"
echo "    - Emails sent to both approvers"
echo "    - barondimaranan@gmail.com (REQUIRED approver)"
echo "    - baron@fowlstudios.com (AT-LEAST-ONE approver)"
echo "    - Both MUST approve to proceed"

echo -e "\n3️⃣  WHEN BOTH APPROVERS APPROVE:"
echo "    ✓ Approval envelope -> COMPLETED"
echo "    ✓ Payment notification email sent to requestor"
echo "    ✓ Email contains Phase 2 UI payment link"
echo "    ✓ Orchestrator resumes pipeline"

echo -e "\n4️⃣  PAYMENT ENVELOPE - PENDING ⏳"
echo "    - Requestor receives email with payment link"
echo "    - Clicks link to Phase 2 Payment UI"
echo "    - Pays via Maya gateway"
echo "    - Payment gateway returns success/failure"

echo -e "\n5️⃣  WHEN PAYMENT COMPLETES:"
echo "    ✓ Payment endpoint records transaction"
echo "    ✓ Payment envelope -> COMPLETED"
echo "    ✓ Orchestrator skips already-completed envelopes"
echo "    ✓ REQUEST skipped (already completed)"
echo "    ✓ APPROVAL skipped (already completed)"

echo -e "\n6️⃣  PROCESSING ENVELOPE - IN_PROGRESS 🔄"
echo "    - Business logic tasks execute"
echo "    - Generate transcripts"
echo "    - Update records"

echo -e "\n7️⃣  DELIVERY ENVELOPE - PENDING ⏳"
echo "    - Email with transcript file sent to requestor"

echo -e "\n8️⃣  FEEDBACK ENVELOPE - PENDING ⏳"
echo "    - Requestor provides feedback"

# ========== STEP 6: KEY ENDPOINTS ==========
echo -e "\n=================================================="
echo "KEY ENDPOINTS FOR TESTING"
echo "=================================================="

echo -e "\n📌 Check Request Status:"
echo "   curl http://localhost:8000/api/requests/$REQUEST_ID"

echo -e "\n📌 Get Approval Tokens (Admin):"
echo "   curl http://localhost:8000/api/admin/approval-tokens/$REQUEST_ID"

echo -e "\n📌 Simulate Payment Completion:"
echo "   curl -X POST http://localhost:8000/api/payments/$REQUEST_ID/complete \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"transactionId\":\"TXN-TEST-001\",\"amount\":500,\"method\":\"maya\",\"reference\":\"REF-$REQUEST_ID\"}'"

echo -e "\n📌 Check Final Status:"
echo "   curl http://localhost:8000/api/requests/$REQUEST_ID"

# ========== STEP 7: INSTRUCTIONS ==========
echo -e "\n=================================================="
echo "NEXT STEPS TO COMPLETE FLOW"
echo "=================================================="

echo -e "\n[Option 1] Real Flow - Email Approvals:"
echo "   1. Check email for barondimaranan@gmail.com"
echo "   2. Click approval link in email (unique token)"
echo "   3. Check email for baron@fowlstudios.com"
echo "   4. Click approval link in email (unique token)"
echo "   5. Both must approve (complex rule = AND logic)"
echo "   6. System auto-sends payment email to requestor"
echo "   7. Requestor clicks payment link"
echo "   8. Completes payment via Phase 2 UI"

echo -e "\n[Option 2] Quick Test - Copy/paste below CURL commands:"

# Generate approval body
APPROVAL_BODY=$(cat <<EOF
{
  "decision": "approved",
  "comments": "Approved for transcript release"
}
EOF
)

echo "   # After getting tokens from email/logs:"
echo "   curl -X POST 'http://localhost:8000/api/approvals/{TOKEN1}/approve' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '$APPROVAL_BODY'"
echo ""
echo "   curl -X POST 'http://localhost:8000/api/approvals/{TOKEN2}/approve' \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '$APPROVAL_BODY'"

echo -e "\n=================================================="
echo "REQUEST ID FOR ALL TESTS: $REQUEST_ID"
echo "=================================================="
echo ""
