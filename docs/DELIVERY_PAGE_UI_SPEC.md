# Delivery Page UI Specification
**For:** Phase 2 UI Agent  
**Route:** `/requests/:requestId/delivery`  
**Backend:** Service Envelope API v2 — `http://localhost:8000`

---

## Step 1 — Load delivery state on page mount

```
GET /api/delivery/:requestId/method
```

**Response fields to read:**

| Field | Use |
|-------|-----|
| `deliveryMethod` | `EMAIL`, `PHYSICAL_MAIL`, `PICKUP`, or `null` |
| `status` | `pending_external`, `in_progress`, `completed`, `failed` |
| `details` | Method-specific stored details |
| `availableMethods` | Delivery method configs from service definition |

---

## Step 2 — No method selected yet (`deliveryMethod: null`)

Show a **method selection form**. Available options come from `availableMethods` in the GET response.

On submit:
```
POST /api/delivery/:requestId/method
Content-Type: application/json

{
  "method": "email" | "physical_mail" | "pickup",
  "details": {
    "email": {
      "recipient": "student@email.com",
      "subject": "Your Documents Are Ready"
    },
    "physical_mail": {
      "mailingAddress": "123 Main St, City, Province, Postal Code"
    },
    "pickup": {}
  }
}
```

After success → reload state → render method-specific panel (Step 3).

---

## Step 3 — Method-specific control panels

All manual status pushes go to:
```
POST /api/delivery-status/:requestId
Content-Type: application/json

{
  "status": <code: 0|1|2|3|4>  OR  <name: string>,
  "notes": "optional note",
  "location": "optional location (physical_mail)",
  "trackingId": "optional tracking ref (physical_mail)"
}
```

---

### EMAIL panel (`deliveryMethod === "EMAIL"`)

Email is **auto-sent and auto-completed** when the method is selected. No manual push needed.

- Show: recipient, subject, sent timestamp (read-only)
- If `status !== "completed"`: show a **"Confirm Delivery"** button → `{ status: 3 }`
- If `status === "completed"`: show green "Delivered" banner

---

### PHYSICAL MAIL panel (`deliveryMethod === "PHYSICAL_MAIL"`)

All steps are **manual**. Render a stepper UI:

| Step | Code | Name | Button label | Extra fields |
|------|------|------|--------------|--------------|
| 1 | `0` | `processing` | Mark Processing | — |
| 2 | `1` | `ready_to_deliver` | Mark Ready to Ship | — |
| 3 | `2` | `out_for_delivery` | Mark Out for Delivery | Location |
| 4 | `3` | `delivered` | Confirm Delivered | Tracking ID |

**Rules:**
- Only enable the **next** step button (current code + 1)
- Show location input when moving to step 3 (`status: 2`)
- Show tracking ID input when moving to step 4 (`status: 3`)
- Code `3` → orchestrator auto-resumes → feedback envelope starts

---

### PICKUP panel (`deliveryMethod === "PICKUP"`)

All steps are **manual**. Render a simpler stepper:

| Step | Code | Name | Button label |
|------|------|------|--------------|
| 1 | `0` | `processing` | Mark Processing |
| 2 | `1` | `ready_for_pickup` | Mark Ready for Pickup |
| 3 | `4` | `pickup_complete` | Confirm Pickup Complete |

**Display from `availableMethods.pickup`:**
- Location
- Hours of operation
- Pickup deadline (calculate: today + `pickupDeadlineDays`)

**Rules:**
- Only enable the next step button
- Code `4` → orchestrator auto-resumes → feedback envelope starts
- After code `4` confirmed: show "Customer has collected the document" banner

---

## Step 4 — Status history / audit trail

```
GET /api/delivery-status/:requestId/history
```

Render a **timeline** below the controls. Each entry:

| Field | Display |
|-------|---------|
| `sequence` | Step number |
| `status` | Status label |
| `statusCode` | Code badge |
| `timestamp` | Formatted date/time |
| `location` | Location (if set) |
| `notes` | Notes (if set) |
| `trackingId` | Tracking ref (if set) |

---

## Step 5 — Polling

Poll `GET /api/delivery-status/:requestId/current` every **10 seconds** while `envelopeStatus !== "completed"`.

When `envelopeStatus === "completed"`:
- Hide all action buttons
- Show **"Delivery Complete"** success banner with `deliveredAt` timestamp
- Stop polling

---

## Button enable/disable rules

```
button for step N is enabled when:
  currentStatusCode < N  AND  envelopeStatus !== "completed"

"Confirm Delivered" (code 3) / "Confirm Pickup Complete" (code 4):
  only enabled when currentStatusCode === previous step
  AND envelopeStatus !== "completed"
```

---

## API summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/delivery/:requestId/method` | Load method + status on mount |
| POST | `/api/delivery/:requestId/method` | Select delivery method + details |
| POST | `/api/delivery-status/:requestId` | Push next delivery status manually |
| GET | `/api/delivery-status/:requestId/history` | Full status timeline |
| GET | `/api/delivery-status/:requestId/current` | Poll for latest status |

---

## Status code reference

| Code | Name | Methods |
|------|------|---------|
| `0` | `processing` | All |
| `1` | `ready_to_deliver` / `ready_for_pickup` | All |
| `2` | `out_for_delivery` | physical_mail only |
| `3` | `delivered` | email, physical_mail — **triggers orchestrator** |
| `4` | `pickup_complete` | pickup only — **triggers orchestrator** |
