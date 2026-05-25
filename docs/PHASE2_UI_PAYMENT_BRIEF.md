# Phase 2 UI - Payment Implementation Brief

## 🎯 Context
After a user's service request gets **approved by all required approvers**, they receive an email with a link to Phase 2 UI for payment. Your role is to:
1. Display payment details (charges, total amount)
2. Handle Maya payment widget integration
3. Trigger payment completion API endpoint

---

## 📋 Input Data (from Email Link)

The approval email will contain a link like:
```
https://phase2-ui.mapua.edu.ph/payment?requestId=req-1779742711745-162f1070
```

**Query Parameters**:
- `requestId` - The service request ID (required)

**You must fetch request details first**:
```bash
GET http://localhost:8000/api/requests/{requestId}
```

**Response contains**:
```json
{
  "id": "req-1779742711745-162f1070",
  "envelopes": {
    "payment": {
      "required": true,
      "charges": [
        {
          "item": "Transcript Service Fee",
          "amount": 500.00,
          "currency": "PHP"
        }
      ],
      "paymentMethod": "credit_card"
    }
  }
}
```

---

## 💳 Payment Flow (Maya Widget Integration)

1. **Display Summary**
   - Item descriptions + amounts from `envelopes.payment.charges`
   - Total amount (sum of all charges)
   - Currency: PHP

2. **Render Maya Payment Widget**
   - Initialize with:
     - Amount: sum of charges
     - Currency: "PHP"
     - Reference: `{requestId}` (for webhook tracking)
     - Metadata: `{ requestId, initiatorEmail, etc }`
   - Use Maya's Web Checkout SDK
   - Handle payment success/failure callbacks

3. **On Payment Success** (Maya calls your callback)
   - Extract: `transactionId`, `amount`, `reference`, `timestamp`
   - Call **completion endpoint**:

---

## ✅ Payment Completion Endpoint

**When user successfully pays with Maya:**

```bash
POST http://localhost:8000/api/payments/{requestId}/complete
Content-Type: application/json

{
  "transactionId": "TXN-MAYA-20260525-001",
  "amount": 500,
  "method": "maya",
  "reference": "req-1779742711745-162f1070",
  "metadata": {
    "paymentTimestamp": "2026-05-25T21:01:57Z",
    "mayaCheckoutId": "CHK-ABC123",
    "browserInfo": "Chrome on Windows"
  }
}
```

**Response** (200 OK):
```json
{
  "requestId": "req-1779742711745-162f1070",
  "status": "completed",
  "transactionId": "TXN-MAYA-20260525-001",
  "nextStatus": "processing",
  "message": "Payment recorded and processing resumed"
}
```

**Action**: Show success message → Redirect to request status page or confirmation

---

## ❌ Payment Failure Endpoint

**When Maya payment fails or user cancels:**

```bash
POST http://localhost:8000/api/payments/{requestId}/failed
Content-Type: application/json

{
  "reason": "Card declined by issuer",
  "errorCode": "DECLINED",
  "metadata": {
    "mayaErrorCode": "CARD_DECLINED",
    "attemptNumber": 1,
    "failureTimestamp": "2026-05-25T21:02:00Z"
  }
}
```

**Response** (200 OK):
```json
{
  "requestId": "req-1779742711745-162f1070",
  "status": "failed",
  "reason": "Card declined by issuer",
  "nextStatus": "pending_payment",
  "message": "Payment failed - user can retry"
}
```

**Action**: Show error message → Allow user to retry payment (reload page or go back to payment form)

---

## 🔄 Retry Logic

- If payment fails, **request stays in `pending_payment` status**
- User can retry immediately without re-approval
- Track `attemptNumber` in metadata to prevent infinite loops
- Show message: "Payment failed. Please try again or contact support."

---

## 🚨 Error Handling

| Scenario | HTTP Status | Action |
|----------|------------|--------|
| Invalid requestId | 404 | Show "Request not found" |
| Missing transactionId | 400 | Show "Invalid payment data" |
| Request already paid | 409 | Show "This request is already paid" |
| Server error | 500 | Show "Server error, please try later" |

---

## 📧 Workflow Context (User Journey)

```
1. Student submits TOR request
   ↓
2. Both approvers receive email with approval links
   ↓
3. Both approvers approve ✅
   ↓
4. Student receives email: "Request Approved - Complete Payment"
   ↓
5. Student clicks link → Phase 2 UI loads payment screen
   ↓
6. Student enters card details via Maya widget
   ↓
7. Maya processes payment
   ↓
8. Your code calls POST /api/payments/{requestId}/complete
   ↓
9. Backend resumes processing → processing envelope starts
   ↓
10. Student gets processing confirmation email
```

---

## 🎨 UI Suggestions

**Payment Screen Layout**:
```
┌─────────────────────────────────────┐
│  Service Request Status              │
│  Request ID: req-1779742711745...   │
├─────────────────────────────────────┤
│  ✅ Request Submitted                │
│  ✅ Approved by All Approvers        │
│  💳 Payment Required (This Step)     │
│  ⏳ Processing                       │
├─────────────────────────────────────┤
│  Charges:                            │
│  • Transcript Service Fee    ₱500.00 │
│  ─────────────────────────────────   │
│  Total Amount Due:          ₱500.00  │
├─────────────────────────────────────┤
│  [ Maya Payment Widget Here ]        │
│  [ Pay with Maya Button ]            │
├─────────────────────────────────────┤
│  Status: Awaiting Payment            │
│  Last Updated: 2 min ago             │
└─────────────────────────────────────┘
```

---

## 🔐 Security Notes

- **Don't expose** full transactionId in browser console logs
- **Validate** requestId format before sending to backend
- **Use HTTPS** only (no http://)
- **Don't retry** automatically — let user control retries
- **Store** payment attempt details locally for user reference (not on backend)

---

## 📞 Backend Contact Points

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/requests/{requestId}` | GET | Fetch request + charge details |
| `/api/payments/{requestId}/complete` | POST | Mark payment as complete |
| `/api/payments/{requestId}/failed` | POST | Record payment failure |

**Base URL**: `http://localhost:8000` (dev) or your production URL

---

## ✨ Key Requirements

1. ✅ Fetch and display charges from request
2. ✅ Integrate Maya Web Checkout SDK
3. ✅ Send transaction data to completion endpoint
4. ✅ Handle success/failure responses
5. ✅ Support payment retry workflow
6. ✅ Show clear error messages to user
7. ✅ Track payment state (pending, completed, failed)

That's everything the Phase 2 UI needs to implement payment! 🚀
