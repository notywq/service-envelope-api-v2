# Generic Email Templates Seed

Use this file as the source of truth when creating templates in the Phase 2 UI.

**When saving in UI, use:**
- `templateScope = generic`
- `isActive = true`
- `serviceType = (leave empty)`
- `name` and `eventKey` = same value listed per template

---

## Section 1 — Auto-Resolved Templates (Create These First)

These are the names backend will fall back to when no service-specific template is configured.

---

### `request-start`
**eventKey:** `request-start` | **envelopeType:** `request` | **phase:** `start`

**subject:** `We Received Your Request ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">Request Received</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">We have successfully received your service request. Here are the details:</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Submitted:</td>
          <td style="padding:8px 0;color:#555;">{{currentTimestamp}}</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">We will notify you at each step as your request progresses through our system.</p>
    <div style="background:#e8f5e9;border:1px solid #c8e6c9;padding:14px 18px;border-radius:4px;margin-top:24px;">
      <p style="margin:0;font-size:13px;color:#2e7d32;"><strong>What's next?</strong> Your request will enter the approval stage. You will receive an email once a decision has been made.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `request-end`
**eventKey:** `request-end` | **envelopeType:** `request` | **phase:** `end`

**subject:** `Request Intake Confirmed ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">Request Intake Confirmed</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your request details have been validated and accepted into the system.</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">The next stage is the approval workflow. You will be notified once a decision has been made.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `approval-start`
**eventKey:** `approval-start` | **envelopeType:** `approval` | **phase:** `start`

**subject:** `Approval Required: {{serviceType}} Request ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">Service Request Approval Required</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{approverName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">A service request has been submitted and requires your approval. Please review the details below:</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Requested by:</td>
          <td style="padding:8px 0;color:#555;">{{firstName}} {{lastName}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Purpose:</td>
          <td style="padding:8px 0;color:#555;">{{purpose}}</td>
        </tr>
      </table>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{{approvalLink}}" style="background-color:#1976d2;color:#ffffff;padding:14px 52px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;letter-spacing:0.3px;">Review &amp; Approve Request</a>
    </p>
    <div style="background:#fff3e0;border:1px solid #ffe0b2;padding:14px 18px;border-radius:4px;margin-top:8px;">
      <p style="margin:0;font-size:12px;color:#e65100;">Click the button above to review the full request details and make your approval decision in the approval portal. Your approval token is unique to you.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `approval-end`
**eventKey:** `approval-end` | **envelopeType:** `approval` | **phase:** `end`

**subject:** `Your Request Has Been Approved ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">&#10003; Request Approved</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Great news! Your request has been reviewed and approved. It will now proceed to the next stage.</p>
    <div style="background:#f5f5f5;border-left:4px solid #2e7d32;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Status:</td>
          <td style="padding:8px 0;color:#2e7d32;font-weight:bold;">APPROVED</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">You will receive a separate notification once payment or processing begins.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `payment-start`
**eventKey:** `payment-start` | **envelopeType:** `payment` | **phase:** `start`

**subject:** `Payment Required: {{serviceType}} Request ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">Payment Required</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your request has been approved and is now awaiting payment to proceed.</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Purpose:</td>
          <td style="padding:8px 0;color:#555;">{{purpose}}</td>
        </tr>
      </table>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{{paymentLink}}" style="background-color:#1976d2;color:#ffffff;padding:14px 52px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;">Proceed to Payment</a>
    </p>
    <div style="background:#fff3e0;border:1px solid #ffe0b2;padding:14px 18px;border-radius:4px;">
      <p style="margin:0;font-size:12px;color:#e65100;"><strong>Note:</strong> Your payment window is time-limited. Please complete your payment as soon as possible to avoid cancellation.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `payment-end`
**eventKey:** `payment-end` | **envelopeType:** `payment` | **phase:** `end`

**subject:** `Payment Confirmed — Processing Will Begin Soon ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">&#10003; Payment Confirmed</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">We have received your payment. Processing of your request will begin shortly.</p>
    <div style="background:#f5f5f5;border-left:4px solid #2e7d32;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Payment Status:</td>
          <td style="padding:8px 0;color:#2e7d32;font-weight:bold;">CONFIRMED</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">You will receive another update once your documents are processed and ready for delivery.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `processing-start`
**eventKey:** `processing-start` | **envelopeType:** `processing` | **phase:** `start`

**subject:** `We Are Processing Your Request ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">Processing Started</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your request is now being actively processed by our team. No action is required from you at this time.</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Status:</td>
          <td style="padding:8px 0;color:#1565c0;font-weight:bold;">IN PROGRESS</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">We will notify you once processing is complete and your documents are ready.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `processing-end`
**eventKey:** `processing-end` | **envelopeType:** `processing` | **phase:** `end`

**subject:** `Processing Complete — Delivery Upcoming ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">&#10003; Processing Complete</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Processing of your request is complete. Your documents are ready and will be delivered via your chosen method.</p>
    <div style="background:#f5f5f5;border-left:4px solid #2e7d32;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Delivery Method:</td>
          <td style="padding:8px 0;color:#555;">{{deliveryMethod}}</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">You will receive a delivery notification shortly.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `delivery-start`
**eventKey:** `delivery-start` | **envelopeType:** `delivery` | **phase:** `start`

**subject:** `Your Documents Are Ready for Delivery ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">Delivery Stage Started</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your documents are ready and have entered the delivery stage.</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Delivery Method:</td>
          <td style="padding:8px 0;color:#555;">{{deliveryMethod}}</td>
        </tr>
      </table>
    </div>
    <div style="background:#e3f2fd;border:1px solid #bbdefb;padding:14px 18px;border-radius:4px;">
      <p style="margin:0;font-size:13px;color:#1565c0;">
        <strong>Email delivery:</strong> Documents will be sent directly to your email address.<br/>
        <strong>Physical mail:</strong> Expect delivery within the estimated timeframe provided at submission.<br/>
        <strong>Pickup:</strong> You will be notified when your documents are ready for collection.
      </p>
    </div>
    <div style="margin-top:16px;padding:14px 18px;background:#f5f5f5;border-radius:4px;">
      <p style="margin:0 0 8px 0;font-size:13px;color:#333;"><strong>Tracking ID:</strong> {{trackingId}}</p>
      <p style="margin:0;font-size:13px;"><a href="{{deliveryTrackingUrl}}" style="color:#1976d2;text-decoration:none;font-weight:bold;">Track Delivery Status</a></p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `delivery-end`
**eventKey:** `delivery-end` | **envelopeType:** `delivery` | **phase:** `end`

**subject:** `Delivery Completed for Request {{requestId}}`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">&#10003; Delivery Completed</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your documents have been successfully delivered. We hope everything is in order.</p>
    <div style="background:#f5f5f5;border-left:4px solid #2e7d32;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Delivery Method:</td>
          <td style="padding:8px 0;color:#555;">{{deliveryMethod}}</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">We will be sending you a short feedback survey shortly. Your input helps us improve our services.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `feedback-start`
**eventKey:** `feedback-start` | **envelopeType:** `feedback` | **phase:** `start`

**subject:** `Share Your Feedback — {{serviceType}} ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">We Value Your Feedback</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your request has been completed. Please take a moment to share your experience — your feedback helps us serve you better.</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
      </table>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{{feedbackLink}}" style="background-color:#1976d2;color:#ffffff;padding:14px 52px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;">Open Feedback Form</a>
    </p>
    <p style="font-size:12px;color:#999;text-align:center;">This link expires after a few days. Submitting feedback is optional but greatly appreciated.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `feedback-end`
**eventKey:** `feedback-end` | **envelopeType:** `feedback` | **phase:** `end`

**subject:** `Thank You for Your Feedback ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">Thank You!</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">We have received your feedback for request <strong>{{requestId}}</strong>. Your response has been recorded and will be used to improve our services.</p>
    <div style="background:#e8f5e9;border:1px solid #c8e6c9;padding:16px 20px;border-radius:4px;margin:24px 0;">
      <p style="margin:0;font-size:14px;color:#2e7d32;font-weight:bold;">Your request lifecycle is now fully complete.</p>
    </div>
    <p style="color:#333;line-height:1.6;">Thank you for using the MAPUA Service Portal.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `request-denied`
**eventKey:** `request-denied` | **envelopeType:** `approval` | **phase:** `cancel`

**subject:** `Request Denied: {{serviceType}} ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#d32f2f;margin-top:0;">Request Denied</h2>
    <p style="color:#333;line-height:1.6;">Dear <strong>{{firstName}} {{lastName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your request has been reviewed and unfortunately denied. Please find the details below:</p>
    <div style="background:#ffffff;padding:20px;border-left:4px solid #d32f2f;margin:20px 0;border-radius:3px;border:1px solid #f5f5f5;">
      <h3 style="margin-top:0;color:#003a70;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Request Information</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:35%;">Request ID:</td>
          <td style="padding:8px 0;color:#666;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#666;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Status:</td>
          <td style="padding:8px 0;color:#d32f2f;font-weight:bold;">DENIED</td>
        </tr>
      </table>
    </div>
    <div style="background:#ffffff;padding:20px;border-left:4px solid #ff9800;margin:20px 0;border-radius:3px;border:1px solid #f5f5f5;">
      <h3 style="margin-top:0;color:#003a70;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Reason for Denial</h3>
      <p style="margin:10px 0;color:#333;line-height:1.6;">{{reason}}</p>
    </div>
    <div style="background:#fff3e0;padding:15px 18px;border-radius:4px;margin:20px 0;">
      <p style="margin:0;font-size:12px;color:#666;"><strong>What's next?</strong><br/>You may resubmit your request with any necessary adjustments. If you have questions about the denial, please contact your department office.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `request-cancelled`
**eventKey:** `request-cancelled` | **envelopeType:** `processing` | **phase:** `cancel`

**subject:** `Request Cancelled: {{serviceType}} ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#d32f2f;margin-top:0;">Request Cancelled</h2>
    <p style="color:#333;line-height:1.6;">Dear <strong>{{firstName}} {{lastName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">We regret to inform you that your request has been cancelled due to a processing issue. Please see the details below:</p>
    <div style="background:#ffffff;padding:20px;border-left:4px solid #d32f2f;margin:20px 0;border-radius:3px;border:1px solid #f5f5f5;">
      <h3 style="margin-top:0;color:#003a70;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Request Information</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:35%;">Request ID:</td>
          <td style="padding:8px 0;color:#666;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#666;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Status:</td>
          <td style="padding:8px 0;color:#d32f2f;font-weight:bold;">CANCELLED</td>
        </tr>
      </table>
    </div>
    <div style="background:#ffffff;padding:20px;border-left:4px solid #ff9800;margin:20px 0;border-radius:3px;border:1px solid #f5f5f5;">
      <h3 style="margin-top:0;color:#003a70;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Cancellation Details</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #eee;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:35%;">Failed Step:</td>
          <td style="padding:8px 0;color:#666;">{{failedTask}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Details:</td>
          <td style="padding:8px 0;color:#666;">{{failureDetails}}</td>
        </tr>
      </table>
    </div>
    <div style="background:#fff3e0;padding:15px 18px;border-radius:4px;margin:20px 0;">
      <p style="margin:0;font-size:12px;color:#666;"><strong>What's next?</strong><br/>You may resubmit your request. If the issue persists, please contact the registrar or service office for assistance.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

## Section 2 — Optional / Future-Ready Generic Templates

Not auto-triggered yet — create these to complete your catalog and enable future automation.

---

### `request-completed`
**eventKey:** `request-completed` | **envelopeType:** `feedback` | **phase:** `complete`

**subject:** `Your Request Is Fully Complete ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">Request Fully Completed</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your service request has been fully completed. All stages — approval, payment, processing, delivery, and feedback — have been resolved.</p>
    <div style="background:#e8f5e9;border:1px solid #c8e6c9;padding:20px;border-radius:4px;margin:24px 0;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #c8e6c9;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">Thank you for using the MAPUA Service Portal. We hope your experience was smooth and your documents arrived as expected.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `approval-reminder`
**eventKey:** `approval-reminder` | **envelopeType:** `approval` | **phase:** `reminder`

**subject:** `Reminder: Approval Still Pending ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#e65100;margin-top:0;">Approval Reminder</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{approverName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">This is a friendly reminder that a service request is still awaiting your approval.</p>
    <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #ffe0b2;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #ffe0b2;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Submitted by:</td>
          <td style="padding:8px 0;color:#555;">{{firstName}} {{lastName}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
      </table>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{{approvalLink}}" style="background-color:#e65100;color:#ffffff;padding:14px 52px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;">Review Request Now</a>
    </p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `payment-reminder`
**eventKey:** `payment-reminder` | **envelopeType:** `payment` | **phase:** `reminder`

**subject:** `Reminder: Payment Pending for Request {{requestId}}`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#e65100;margin-top:0;">Payment Reminder</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your payment for the following request is still pending. Please complete it before the deadline to avoid cancellation.</p>
    <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #ffe0b2;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
      </table>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{{paymentLink}}" style="background-color:#e65100;color:#ffffff;padding:14px 52px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;">Complete Payment Now</a>
    </p>
    <div style="background:#ffebee;border:1px solid #ffcdd2;padding:14px 18px;border-radius:4px;">
      <p style="margin:0;font-size:12px;color:#c62828;"><strong>Warning:</strong> Requests with expired payment windows will be automatically cancelled.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `delivery-reminder`
**eventKey:** `delivery-reminder` | **envelopeType:** `delivery` | **phase:** `reminder`

**subject:** `Reminder: Your Documents Are Waiting for Pickup ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#e65100;margin-top:0;">Pickup Reminder</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your documents are ready and waiting to be picked up. Please collect them at your earliest convenience.</p>
    <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #ffe0b2;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #ffe0b2;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Delivery Method:</td>
          <td style="padding:8px 0;color:#555;">{{deliveryMethod}}</td>
        </tr>
      </table>
    </div>
    <p style="color:#333;line-height:1.6;">Please bring a valid school ID when collecting your documents.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `feedback-reminder`
**eventKey:** `feedback-reminder` | **envelopeType:** `feedback` | **phase:** `reminder`

**subject:** `Reminder: We'd Love Your Feedback ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#003a70;margin-top:0;">Feedback Reminder</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">We noticed you haven't submitted your feedback yet. Your opinion matters to us — it only takes a minute.</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
      </table>
    </div>
    <p style="margin:28px 0;text-align:center;">
      <a href="{{feedbackLink}}" style="background-color:#1976d2;color:#ffffff;padding:14px 52px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold;font-size:14px;">Submit Feedback</a>
    </p>
    <p style="font-size:12px;color:#999;text-align:center;">This feedback link will expire soon.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `system-error`
**eventKey:** `system-error` | **envelopeType:** `processing` | **phase:** `error`

**subject:** `Service Update for Your Request ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#d32f2f;margin-top:0;">Service Update</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">We encountered a temporary issue while processing your request. Our team has been automatically notified and is looking into it.</p>
    <div style="background:#ffebee;border-left:4px solid #d32f2f;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #ffcdd2;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #ffcdd2;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Issue Details:</td>
          <td style="padding:8px 0;color:#555;">{{failureDetails}}</td>
        </tr>
      </table>
    </div>
    <div style="background:#fff3e0;padding:15px 18px;border-radius:4px;margin-top:8px;">
      <p style="margin:0;font-size:12px;color:#666;"><strong>No action is required from you right now.</strong><br/>If this issue persists or you have not heard back within 24 hours, please contact the service office with your Request ID.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `delivery-email-document`
**eventKey:** `delivery-email-document` | **envelopeType:** `delivery` | **phase:** `document`

**subject:** `Your Documents Are Ready — {{serviceType}} ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">&#10003; Your Documents Are Attached</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your requested documents for <strong>{{serviceType}}</strong> are ready. You can access them using the secure links below.</p>
    <div style="background:#f5f5f5;border-left:4px solid #2e7d32;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;color:#333;">Student ID:</td>
          <td style="padding:8px 0;color:#555;">{{studentId}}</td>
        </tr>
      </table>
    </div>
    <div style="background:#e8f5e9;border:1px solid #c8e6c9;padding:16px 20px;border-radius:4px;margin:24px 0;">
      <p style="margin:0 0 10px 0;font-size:13px;font-weight:bold;color:#2e7d32;">Document Links:</p>
      {{documentLinks}}
      <p style="margin:10px 0 0 0;font-size:11px;color:#666;">Links are secure and accessible only to authorized users. If you did not request these documents, please contact the Registrar immediately.</p>
    </div>
    <p style="color:#333;line-height:1.6;">If you experience any issues accessing your documents, please reply to the service office or contact us directly.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `delivery-shipped`
**eventKey:** `delivery-shipped` | **envelopeType:** `delivery` | **phase:** `shipped`

**subject:** `Your Documents Have Been Shipped ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#1565c0;margin-top:0;">&#128230; Your Documents Are On Their Way</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your documents have been dispatched via courier and are on their way to you.</p>
    <div style="background:#f5f5f5;border-left:4px solid #1976d2;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Tracking ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{trackingId}}</td>
        </tr>
      </table>
    </div>
    <div style="margin-top:8px;padding:14px 18px;background:#e3f2fd;border:1px solid #bbdefb;border-radius:4px;">
      <p style="margin:0 0 8px 0;font-size:13px;color:#1565c0;"><strong>Track your shipment:</strong></p>
      <p style="margin:0;font-size:13px;"><a href="{{deliveryTrackingUrl}}" style="color:#1976d2;text-decoration:none;font-weight:bold;">View Delivery Status &#8594;</a></p>
    </div>
    <p style="color:#333;line-height:1.6;margin-top:20px;">Please ensure someone is available to receive the parcel at your provided address. Bring a valid ID if a signature is required.</p>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

### `delivery-pickup-ready`
**eventKey:** `delivery-pickup-ready` | **envelopeType:** `delivery` | **phase:** `pickup`

**subject:** `Your Documents Are Ready for Pickup ({{requestId}})`

```html
<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;background:#ffffff;">
  <div style="background-color:#003a70;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">MAPUA Service Portal</h1>
  </div>
  <div style="padding:32px;">
    <h2 style="color:#2e7d32;margin-top:0;">&#10003; Ready for Pickup</h2>
    <p style="color:#333;line-height:1.6;">Hello <strong>{{firstName}}</strong>,</p>
    <p style="color:#333;line-height:1.6;">Your documents for <strong>{{serviceType}}</strong> are ready and waiting for you to collect.</p>
    <div style="background:#f5f5f5;border-left:4px solid #2e7d32;padding:16px 20px;margin:24px 0;border-radius:3px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;width:40%;">Request ID:</td>
          <td style="padding:8px 0;color:#1976d2;font-weight:bold;">{{requestId}}</td>
        </tr>
        <tr style="border-bottom:1px solid #e0e0e0;">
          <td style="padding:8px 0;font-weight:bold;color:#333;">Service Type:</td>
          <td style="padding:8px 0;color:#555;">{{serviceType}}</td>
        </tr>
      </table>
    </div>
    <div style="background:#e8f5e9;border:1px solid #c8e6c9;padding:16px 20px;border-radius:4px;margin:24px 0;">
      <p style="margin:0 0 6px 0;font-size:13px;font-weight:bold;color:#2e7d32;">Pickup Instructions</p>
      <p style="margin:0;font-size:13px;color:#333;line-height:1.6;">
        Please proceed to the <strong>Registrar / Records Office</strong> during operating hours.<br/>
        Bring your <strong>valid school ID</strong> and reference your Request ID when claiming.
      </p>
    </div>
    <div style="background:#fff3e0;border:1px solid #ffe0b2;padding:14px 18px;border-radius:4px;">
      <p style="margin:0;font-size:12px;color:#e65100;"><strong>Important:</strong> Documents not claimed within the designated period will be returned to the issuing office. Please claim as soon as possible.</p>
    </div>
  </div>
  <div style="background:#f5f5f5;padding:16px 32px;border-top:1px solid #e0e0e0;">
    <p style="margin:0;font-size:11px;color:#999;text-align:center;">This is an automated message from the MAPUA Service Envelope System. Please do not reply to this email.</p>
  </div>
</div>
```

---

## Available Template Variables

All templates support these `{{variableName}}` substitutions:

| Variable | Description |
|---|---|
| `requestId` | Unique request identifier |
| `serviceType` | Service type code |
| `firstName` | Student first name |
| `lastName` | Student last name |
| `email` | Student email |
| `studentId` | Student ID number |
| `purpose` | Request purpose |
| `documentTypes` | Comma-separated document types |
| `numberOfCopies` | Number of copies requested |
| `deliveryMethod` | email / physical_mail / pickup |
| `isUrgent` | Yes / No |
| `remarks` | Student remarks |
| `currentTimestamp` | ISO timestamp of email send |
| `approverName` | Approver role name |
| `approverEmail` | Approver email address |
| `approvalToken` | Unique approval token |
| `approvalLink` | Deep link to approval page |
| `paymentLink` | Deep link to payment page |
| `feedbackLink` | Deep link to feedback form |
| `feedbackToken` | Unique feedback token |
| `trackingId` | Shipment tracking identifier |
| `deliveryTrackingUrl` | Link to delivery tracking page |
| `documentLinks` | HTML list of resolved document links (delivery email) |
| `documentLinksText` | Plain-text list of resolved document links |
| `approverId` | Approver ID (denial emails) |
| `reason` | Denial reason (denial emails) |
| `failedTask` | Failed step name (cancellation emails) |
| `failureDetails` | Failure details (cancellation emails) |
| `cancellationReason` | Full cancellation reason string |
