# Delivery API Alignment Guide
## Phase 2 UI ↔ Backend Integration

**Last Updated:** May 29, 2026  
**Status:** ✅ Fully Aligned  
**Build:** 0 TypeScript Errors  
**Architecture:** Separation of Concerns (Delivery Details Submitted Separately)

---

## Architecture: Separation of Concerns

The backend follows a **separation of concerns** pattern where:

1. **Request API** (`POST /api/services/{serviceId}/submit`) - Handles request parameters only
2. **Delivery API** (`POST /api/delivery/{requestId}/details`) - Handles delivery-specific data
3. **Delivery Status API** (`POST /api/delivery-status/{requestId}`) - Tracks delivery progress

**Why This Design:**
- ✅ Request can fail (approvals, payments) without affecting delivery data
- ✅ Clean responsibility boundaries
- ✅ Delivery details submitted on-demand, not upfront
- ✅ Backend controls when delivery data is used (during delivery envelope processing)

---

## Phase 2 UI Flow

## Phase 2 UI Flow

### Step 1: Submit Request (Parameters Only)
**Endpoint:** `POST /api/services/{serviceId}/submit`

**Request Body:**
```json
{
  "studentId": "2020-00123",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "documentTypes": ["academic_record", "official_transcript"],
  "purpose": "employment",
  "numberOfCopies": 2,
  "isUrgent": false,
  "remarks": "Please expedite if possible"
}
```

**What Happens (Backend):**
1. Parameters stored in `request.envelopes.request.parameters`
2. Delivery envelope initialized with `status: "pending"`, `method: undefined`
3. `deliveryHistory` initialized as empty array: `[]`
4. Request saved to MongoDB
5. Orchestrator starts pipeline (request → approval → payment → processing → delivery)

**Response:**
```json
{
  "id": "req-1234567-abc12345",
  "status": "queued",
  "message": "Request submitted successfully",
  "service": {
    "id": "comprehensive-student-document-v2",
    "name": "Comprehensive Student Document"
  }
}
```

---

### Step 2: Submit Delivery Details (Immediately After or Later)
**Endpoint:** `POST /api/delivery/{requestId}/details` (NEW)

**Request Body:**
```json
{
  "deliveryMethod": "physical_mail",
  "deliveryDetails": {
    "physical_mail": {
      "mailingAddress": "123 Main St, City, Province 12345"
    }
  }
}
```

Or for email delivery:
```json
{
  "deliveryMethod": "email",
  "deliveryDetails": {
    "email": {}
  }
}
```

**What Happens (Backend):**
1. Delivery details stored in `request.envelopes.delivery.details[method]`
2. Delivery method stored in `request.envelopes.delivery.method`
3. **Status remains "pending"** (NOT changed to in_progress)
4. Request saved to MongoDB
5. **Orchestrator NOT called** - details are stored for later use

**Response:**
```json
{
  "status": "success",
  "message": "Delivery details saved (physical_mail)",
  "requestId": "req-1234567-abc12345",
  "deliveryMethod": "physical_mail",
  "deliveryDetails": {
    "physical_mail": {
      "mailingAddress": "123 Main St, City, Province 12345"
    }
  }
}
```

---

### Step 3: Track Delivery Progress
**Endpoint:** `GET /api/delivery-status/{requestId}/current`

**Response:**
```json
{
  "requestId": "req-1234567-abc12345",
  "deliveryMethod": "physical_mail",
  "envelopeStatus": "in_progress",
  "currentStatus": "processing",
  "currentStatusCode": 0,
  "lastStatusUpdate": "2026-05-28T10:30:00Z",
  "lastUpdateDetails": {
    "statusCode": 0,
    "status": "processing",
    "timestamp": "2026-05-28T10:30:00Z",
    "location": "Registrar Office",
    "notes": "Preparing documents",
    "trackingId": "LBC123456789",
    "sequence": 1
  },
  "deliveryAttempts": 1,
  "deliveredAt": null
}
```

---

### Step 3: View Full Delivery History
**Endpoint:** `GET /api/delivery-status/{requestId}/history`

**Response:**
```json
{
  "requestId": "req-1234567-abc12345",
  "deliveryMethod": "physical_mail",
  "currentStatus": "out_for_delivery",
  "currentStatusCode": 2,
  "lastStatusUpdate": "2026-05-28T14:30:00Z",
  "totalStatusUpdates": 3,
  "history": [
    {
      "sequence": 1,
      "statusCode": 0,
      "status": "processing",
      "timestamp": "2026-05-28T10:30:00Z",
      "location": "Registrar Office",
      "notes": "Preparing documents",
      "trackingId": "LBC123456789"
    },
    {
      "sequence": 2,
      "statusCode": 1,
      "status": "ready_to_deliver",
      "timestamp": "2026-05-28T12:00:00Z",
      "location": "LBC Sorting Hub",
      "notes": "Ready for pickup",
      "trackingId": "LBC123456789"
    },
    {
      "sequence": 3,
      "statusCode": 2,
      "status": "out_for_delivery",
      "timestamp": "2026-05-28T14:30:00Z",
      "location": "En route to destination",
      "notes": "On delivery vehicle",
      "trackingId": "LBC123456789"
    }
  ]
}
```

---

### Step 4: Update Delivery Status (Backend/Admin)
**Endpoint:** `POST /api/delivery-status/{requestId}`

**Request Body:**
```json
{
  "status": 2,
  "location": "En route to destination",
  "notes": "On delivery vehicle",
  "trackingId": "LBC123456789"
}
```

**What Happens (Backend):**
1. Status code validated (0-3)
2. Status update object created with:
   - statusCode: 2
   - status: "out_for_delivery"
   - timestamp: current ISO time
   - location, notes, trackingId preserved
   - updateSequence: auto-incremented (next sequence number)
3. **ADDED TO deliveryHistory array** in MongoDB
4. Request saved with updated history
5. Orchestrator auto-resumes if status = 3 (delivered)

**Response:**
```json
{
  "requestId": "req-1234567-abc12345",
  "message": "Delivery status updated to: out_for_delivery (code: 2)",
  "delivery": {
    "currentStatus": "out_for_delivery",
    "currentStatusCode": 2,
    "lastStatusUpdate": "2026-05-28T14:30:00Z",
    "totalUpdates": 3,
    "envelopeStatus": "in_progress"
  },
  "statusUpdate": {
    "statusCode": 2,
    "status": "out_for_delivery",
    "notes": "On delivery vehicle",
    "location": "En route to destination",
    "timestamp": "2026-05-28T14:30:00Z",
    "updateSequence": 3
  }
}
```

---

## Delivery Status Code Reference

| Code | Status Name | Meaning |
|------|-------------|---------|
| 0 | `processing` | Preparing document for delivery |
| 1 | `ready_to_deliver` | Document ready, awaiting shipment |
| 2 | `out_for_delivery` | In transit to recipient |
| 3 | `delivered` | Document delivered successfully |

---

## Alternative: Select Delivery Method Later

If Phase 2 doesn't submit delivery details immediately, users can select method later when orchestrator reaches delivery envelope:

### Use POST /api/delivery/{requestId}/method
**Endpoint:** `POST /api/delivery/{requestId}/method`

When delivery envelope is reached (after approvals, payments, processing):

```json
{
  "method": "physical_mail",
  "details": {
    "physical_mail": {
      "mailingAddress": "123 Main St, City, Province 12345"
    }
  }
}
```

This is **optional** - if details were pre-submitted via Step 2, orchestrator uses them automatically.

---

## MongoDB Schema - Delivery Envelope

**Collection:** `requests`

```javascript
{
  _id: ObjectId(...),
  id: "req-1234567-abc12345",
  type: "comprehensive-student-document-v2",
  initiator: "john@example.com",
  overallStatus: "pending_delivery",
  
  // ... other envelope data ...
  
  envelopes: {
    // ... request, approval, payment, processing ...
    
    delivery: {
      status: "in_progress",                    // queued | in_progress | completed | failed
      method: "physical_mail",                  // email | physical_mail | pickup
      details: {
        physical_mail: {
          mailingAddress: "123 Main St..."
        }
      },
      availableMethods: { ... },
      deliveryAttempts: 1,
      timestamp: "2026-05-28T10:00:00Z",
      
      // NEW: Delivery History Tracking
      deliveryHistory: [
        {
          statusCode: 0,
          status: "processing",
          timestamp: "2026-05-28T10:30:00Z",
          location: "Registrar Office",
          notes: "Preparing documents",
          trackingId: "LBC123456789",
          updateSequence: 1
        },
        {
          statusCode: 1,
          status: "ready_to_deliver",
          timestamp: "2026-05-28T12:00:00Z",
          location: "LBC Sorting Hub",
          notes: "Ready for pickup",
          trackingId: "LBC123456789",
          updateSequence: 2
        },
        {
          statusCode: 2,
          status: "out_for_delivery",
          timestamp: "2026-05-28T14:30:00Z",
          location: "En route to destination",
          notes: "On delivery vehicle",
          trackingId: "LBC123456789",
          updateSequence: 3
        }
      ],
      
      // Status tracking
      currentStatus: "out_for_delivery",        // Latest status from history
      currentStatusCode: 2,                     // Latest code (0-3)
      lastStatusUpdate: "2026-05-28T14:30:00Z", // Latest timestamp
      
      // Legacy fields
      lastAttemptAt: "2026-05-28T14:30:00Z",
      deliveredAt: null
    }
  }
}
```

---

## Implementation Updates (May 29, 2026)

### ✅ Architecture Refactor: Separation of Concerns
**Rationale:** 
- Request and delivery are separate concerns
- Request can fail without affecting delivery data
- Backend controls when delivery details are used

**Changes Made:**

1. **Reverted Request APIs** (`requests.ts`, `services.ts`)
   - Removed `deliveryMethod` and `deliveryDetails` from request submission
   - Request API now accepts **parameters only**
   - Delivery envelope initialized with `status: "pending"`, `method: undefined`

2. **Created New Endpoint** (`POST /api/delivery/{requestId}/details`)
   - Allows Phase 2 UI to submit delivery details **separately** from request
   - Details stored in `request.envelopes.delivery.details[method]`
   - Delivery status remains `"pending"` (NOT changed to in_progress)
   - Orchestrator NOT called (no side effects)

3. **Updated Delivery Processor** (`delivery-processor.ts`)
   - Now checks for pre-stored delivery details in `pending` status
   - If details found: proceeds directly to `in_progress` → delivery execution
   - If no details: waits in `pending_external` for user selection via UI
   - Added logging to track when pre-stored details are used

**Fixes From Previous Session (May 28):**

1. Initialize deliveryHistory array when delivery envelope created
2. Ensure delivery history persists to MongoDB
3. All status updates properly added to history

---

## Testing Checklist

- [ ] Submit request (parameters only) → No delivery data in response
- [ ] POST /api/delivery/{requestId}/details → Verify details stored in MongoDB
- [ ] Get delivery status → Verify pre-stored method is loaded
- [ ] Orchestrator reaches delivery → Verify uses pre-stored details (logs: "DELIVERY-DETAILS-FOUND")
- [ ] Update status with POST → Verify entry added to history
- [ ] Get history → Verify all entries returned in sequence
- [ ] Request fails (approval denied) → Verify delivery data still exists (no cascade delete)
- [ ] Submit without pre-storing delivery → Verify orchestrator waits at pending_external
- [ ] Then POST /api/delivery/{requestId}/method → Verify method selected on-demand
- [ ] Multiple status updates → Verify `updateSequence` increments correctly
- [ ] Status code 3 (delivered) → Verify orchestrator auto-resumes and request completes

---

## Phase 2 UI Implementation Notes

**Expected Behavior (Two-Step Submission):**

1. **Step 1 - Request:** User fills form with parameters only
   ```javascript
   POST /api/services/{serviceId}/submit
   { studentId, firstName, lastName, ... }
   ```

2. **Step 2 - Delivery:** User selects delivery method
   ```javascript
   POST /api/delivery/{requestId}/details
   { deliveryMethod, deliveryDetails }
   ```

3. **Progress Tracking:** Poll delivery status
   ```javascript
   GET /api/delivery-status/{requestId}/current
   GET /api/delivery-status/{requestId}/history
   ```

4. **Advantages:**
   - ✅ Clean separation: request API ≠ delivery API
   - ✅ Request can fail without affecting delivery data
   - ✅ Delivery details used only when delivery envelope reached
   - ✅ Flexible: details can be updated before delivery processing starts
   - ✅ No premature data submission

**Database:** All data persists to MongoDB with full history for audit trail and compliance
