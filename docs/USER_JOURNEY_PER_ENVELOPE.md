SERVICE ENVELOPE USER JOURNEY - COMPLETE WALKTHROUGH
═══════════════════════════════════════════════════════════════════════════════

This guide explains each envelope from the USER's perspective, showing:
  • What happens at each step
  • What they receive in email
  • What they click
  • What API calls happen behind the scenes

Service: Transcript of Records (SERV-3-05262026)
Requestor: Juan Dela Cruz (juan.delacruz@mapua.edu.ph)

═══════════════════════════════════════════════════════════════════════════════
ENVELOPE 1: REQUEST ENVELOPE
═══════════════════════════════════════════════════════════════════════════════

USER ACTION:
────────────
Juan goes to the Portal and submits a Transcript of Records request:
  - Student ID: 2024-00456
  - Number of Copies: 2
  - Purpose: Scholarship and Employment
  - Delivery: Email

WHAT HAPPENS BEHIND THE SCENES:
───────────────────────────────

[STEP 1] User submits request via API:

  API ENDPOINT CALLED:
  POST /api/services/SERV-3-05262026/submit
  
  REQUEST BODY:
  {
    "initiatorName": "Juan Dela Cruz",
    "initiatorEmail": "juan.delacruz@mapua.edu.ph",
    "serviceData": {
      "studentId": "2024-00456",
      "numberOfCopies": 2,
      "purposes": "Scholarship and Employment",
      "deliveryMode": "Email"
    }
  }

[STEP 2] System validates request:
  ✓ Check all required fields present
  ✓ Validate student ID format
  ✓ Validate email address
  ✓ Check service exists (SERV-3-05262026)

[STEP 3] Create ServiceRequest document in MongoDB:
  ✓ Store initiator details
  ✓ Store service data
  ✓ Initialize all 6 envelopes (REQUEST, APPROVAL, PAYMENT, PROCESSING, DELIVERY, FEEDBACK)
  ✓ Generate unique requestId (e.g., "req-1779744508484-5a77fecc")

[STEP 4] Orchestrator starts processing:
  ✓ REQUEST envelope processed
  ✓ Validate all data
  ✓ Mark REQUEST envelope as COMPLETED
  ✓ Move to next envelope (APPROVAL)

WHAT USER RECEIVES:
────────────────────
✅ CONFIRMATION MESSAGE (on Portal):
   "Request submitted successfully. Request ID: req-1779744508484-5a77fecc"

📧 NO EMAIL YET (confirmation is only on portal)

REQUEST ENVELOPE STATUS:
  Before: pending
  After:  COMPLETED ✅

WHAT USER NEEDS TO DO NEXT:
────────────────────────────
Wait. The system is now routing the request to approvers.

═══════════════════════════════════════════════════════════════════════════════
ENVELOPE 2: APPROVAL ENVELOPE
═══════════════════════════════════════════════════════════════════════════════

WHO GETS INVOLVED:
──────────────────
3 Approvers receive approval requests:
  1. barondimaranan@gmail.com  (Head Teller) - REQUIRED
  2. baron@fowlstudios.com     (Sub Teller 1) - OPTIONAL (at-least-one)
  3. barbargbf@gmail.com       (Sub Teller 2) - OPTIONAL (at-least-one)

APPROVAL RULE: Complex
  ✓ barondimaranan@gmail.com MUST approve (required)
  ✓ At least ONE of (baron@fowlstudios.com OR barbargbf@gmail.com) must approve
  ✓ Both conditions required = AND logic

WHAT HAPPENS BEHIND THE SCENES:
───────────────────────────────

[STEP 1] Generate approval tokens for each approver:
  ✓ Create unique token for barondimaranan@gmail.com
  ✓ Create unique token for baron@fowlstudios.com
  ✓ Create unique token for barbargbf@gmail.com
  ✓ Save tokens in MongoDB ApprovalToken collection
  ✓ Set expiration (typically 24-48 hours)

[STEP 2] Send approval emails to each approver:

  EMAIL #1 - To: barondimaranan@gmail.com
  ──────────────────────────────────────────
  Subject: New Approval Request - Transcript of Records
  
  Body includes:
    • Request ID: req-1779744508484-5a77fecc
    • Requestor: Juan Dela Cruz
    • Service: Transcript of Records
    • Details: 2 copies for Scholarship and Employment
    
    [APPROVE BUTTON/LINK in email]
    └─ Clicking opens: /api/approvals/<UNIQUE_TOKEN>/approve?decision=approve
    
    [DENY BUTTON/LINK in email]
    └─ Clicking opens: /api/approvals/<UNIQUE_TOKEN>/approve?decision=deny

  EMAIL #2 - To: baron@fowlstudios.com
  ──────────────────────────────────────
  Same format as Email #1

  EMAIL #3 - To: barbargbf@gmail.com
  ──────────────────────────────────────
  Same format as Email #1

WHAT APPROVERS SEE IN EMAIL:
─────────────────────────────
────────────────────────────────────────────────
REQUEST ID: req-1779744508484-5a77fecc
REQUESTOR: Juan Dela Cruz
SERVICE: Transcript of Records
STATUS: Pending Approval

REQUEST DETAILS:
  Student ID: 2024-00456
  Copies: 2
  Purpose: Scholarship and Employment
  Delivery: Email

APPROVAL ACTION NEEDED:
  [APPROVE] - Click to approve
  [DENY]    - Click to deny

Your Role: Head Teller (REQUIRED)
Note: Your approval is REQUIRED for this request to proceed.
────────────────────────────────────────────────

WHAT APPROVERS DO:
───────────────────

SCENARIO A: barondimaranan@gmail.com clicks [APPROVE]
─────────────────────────────────────────────────────

[APPROVER 1 ACTION]
  1. Receives email from system
  2. Reviews request details
  3. Clicks [APPROVE] button in email
  4. Email link sends to: /api/approvals/<TOKEN_1>/approve

[SYSTEM PROCESSES]
  API ENDPOINT CALLED:
  POST /api/approvals/<TOKEN_1>/approve
  
  • Verify token is valid
  • Verify token not expired
  • Verify token matches requestId
  • Mark approval as "approved" in MongoDB
  • Save approval details (who, when, comments if any)

[RESULT]
  ✓ Approval #1 recorded
  ✓ System checks: Have all REQUIRED approvers approved?
    → NO (only 1 of 1 required approver done)
  ✓ System checks: Have AT-LEAST-ONE from optional set approved?
    → NO (waiting for baron@fowlstudios.com or barbargbf@gmail.com)
  ✓ APPROVAL ENVELOPE STATUS: Still "pending_external" (waiting for more approvals)

[APPROVER SEES]
  ✅ "Your approval has been recorded" message

SCENARIO B: baron@fowlstudios.com clicks [APPROVE]
───────────────────────────────────────────────────

[APPROVER 2 ACTION]
  1. Receives email from system
  2. Reviews request details
  3. Clicks [APPROVE] button in email
  4. Email link sends to: /api/approvals/<TOKEN_2>/approve

[SYSTEM PROCESSES]
  API ENDPOINT CALLED:
  POST /api/approvals/<TOKEN_2>/approve
  
  • Verify token is valid
  • Mark approval as "approved"
  • Save approval details

[CRITICAL CHECK]
  ✓ System checks: Have all REQUIRED approvers approved?
    → YES (barondimaranan@gmail.com = 1/1 required)
  ✓ System checks: Have AT-LEAST-ONE from optional set approved?
    → YES (baron@fowlstudios.com = 1/2 optional)
  ✓ BOTH CONDITIONS MET = APPROVAL COMPLETE! 🎉

[WHAT HAPPENS NEXT - AUTOMATIC]
  1. Approval envelope transitions to COMPLETED ✅
  2. System AUTOMATICALLY sends PAYMENT NOTIFICATION EMAIL to Juan
  3. Orchestrator resumes pipeline

APPROVAL ENVELOPE STATUS:
  Before: pending_external
  After:  COMPLETED ✅

═══════════════════════════════════════════════════════════════════════════════
ENVELOPE 3: PAYMENT ENVELOPE
═══════════════════════════════════════════════════════════════════════════════

WHAT HAPPENS BEHIND THE SCENES:
───────────────────────────────

[STEP 1] Approval is complete → System sends payment email to REQUESTOR (Juan):

  EMAIL TO: juan.delacruz@mapua.edu.ph
  ─────────────────────────────────────
  Subject: Your Request Has Been Approved - Payment Required

  Body includes:
    ✅ Request Approved!
    
    CHARGES:
      • TOR processing fee: PHP 500
      • Printing and delivery: PHP 200
      ─────────────────
      TOTAL: PHP 700
    
    [PROCEED TO PAYMENT]
    └─ Click button → Opens Phase 2 UI payment portal
       URL: http://localhost:3000/payment?requestId=req-1779744508484-5a77fecc

WHAT JUAN SEES IN EMAIL:
────────────────────────
────────────────────────────────────────────────
Your Request Has Been Approved - Payment Required

Hello Juan,

Great news! Your service request has been approved by all required approvers.

REQUEST ID: req-1779744508484-5a77fecc
TOTAL AMOUNT DUE: PHP 700
STATUS: Ready for Payment

Please complete the payment using the secure payment gateway below:

[PROCEED TO PAYMENT]

This payment is required to complete your service request processing. 
Once payment is received, your request will be processed and you will receive 
confirmation via email.

Payment link expires in 7 days.
────────────────────────────────────────────────

WHAT JUAN DOES:
────────────────

[STEP 1] Juan clicks [PROCEED TO PAYMENT] in email

  Link opens: http://localhost:3000/payment?requestId=req-1779744508484-5a77fecc
  
  This connects to PHASE 2 UI (separate React application)

[STEP 2] Phase 2 UI displays payment summary:

  PHASE 2 UI SCREEN:
  ──────────────────
  ┌─────────────────────────────────────┐
  │ Payment Summary                     │
  │ Request ID: req-1779744508484...   │
  │                                     │
  │ Charges:                            │
  │  • TOR processing fee: PHP 500      │
  │  • Printing and delivery: PHP 200   │
  │  ─────────────────────────────      │
  │  TOTAL: PHP 700                     │
  │                                     │
  │ [CANCEL]  [PAY WITH MAYA]          │
  └─────────────────────────────────────┘

[STEP 3] Juan clicks [PAY WITH MAYA]

  Phase 2 UI calls Maya Payment Gateway
  User redirected to Maya payment page
  User enters card details
  Payment processed

[STEP 4] Maya returns success/failure

  If SUCCESS:
    • Maya sends webhook to: POST /api/webhooks/maya
    • OR Phase 2 UI calls: POST /api/payments/<REQUEST_ID>/complete
    
  If FAILURE:
    • Maya returns error
    • Phase 2 UI shows retry option
    • Juan can try again or use different payment method

[SUCCESS PATH] Juan's payment succeeds:
──────────────────────────────────────

[SYSTEM PROCESSES]
  API ENDPOINT CALLED (from Phase 2 UI):
  POST /api/payments/req-1779744508484-5a77fecc/complete
  
  REQUEST BODY:
  {
    "transactionId": "TXN-MAYA-20260526-001",
    "amount": 700,
    "method": "maya",
    "reference": "REF-req-1779744508484-5a77fecc",
    "metadata": {
      "source": "phase2_ui",
      "timestamp": "2026-05-26T12:00:00Z"
    }
  }

[SYSTEM PROCESSING]
  ✓ Verify request exists
  ✓ Verify payment amount matches charges
  ✓ Record transaction: TXN-MAYA-20260526-001
  ✓ Mark PAYMENT envelope as COMPLETED
  ✓ Save transaction details to MongoDB
  ✓ Trigger Orchestrator to resume pipeline

[JUAN SEES]
  ✅ "Payment Successful" message
  ✅ Confirmation page with receipt

[EMAIL TO JUAN]
  📧 Payment Confirmation Email
  Subject: Payment Received - Request Processing Started
  
  Your payment of PHP 700 has been received.
  Your request will now be processed.

PAYMENT ENVELOPE STATUS:
  Before: pending
  After:  COMPLETED ✅

═══════════════════════════════════════════════════════════════════════════════
ENVELOPE 4: PROCESSING ENVELOPE
═══════════════════════════════════════════════════════════════════════════════

WHAT HAPPENS BEHIND THE SCENES:
───────────────────────────────

[AUTOMATIC - No user action needed]

[STEP 1] Orchestrator resumes after payment:

  CRITICAL: Skip already-completed envelopes
  ✓ REQUEST envelope: SKIPPED (already completed)
  ✓ APPROVAL envelope: SKIPPED (already completed)
  ✓ PAYMENT envelope: Already completed
  ✓ PROCESSING envelope: NOW START

[STEP 2] Processing Processor executes business logic:

  Tasks executed:
  ✓ Verify student is in good academic standing
  ✓ Generate official transcript document
  ✓ Sign and seal document
  ✓ Store in document management system
  ✓ Prepare delivery package

[STEP 3] Processing tasks complete:

  Mark PROCESSING envelope as COMPLETED
  Move to next envelope (DELIVERY)

[JUAN SEES]
  📧 Processing Update Email (optional)
  Subject: Your Request is Being Processed
  
  Your request is now being processed. You will receive your transcript 
  documents via the delivery method you selected.

PROCESSING ENVELOPE STATUS:
  Before: pending
  After:  COMPLETED ✅ (or in_progress if async tasks still running)

═══════════════════════════════════════════════════════════════════════════════
ENVELOPE 5: DELIVERY ENVELOPE
═══════════════════════════════════════════════════════════════════════════════

WHAT HAPPENS:
──────────────

[AUTOMATIC - No user action needed]

[STEP 1] Delivery Processor executes:

  Based on selected delivery method (Email in this case):
  ✓ Prepare transcript documents (2 copies)
  ✓ Package for email delivery
  ✓ Generate secure link for download
  ✓ Send delivery email

[STEP 2] Juan receives delivery email:

  EMAIL TO: juan.delacruz@mapua.edu.ph
  ─────────────────────────────────────
  Subject: Your Transcript of Records Ready for Download
  
  Body includes:
    Your requested transcript documents are ready!
    
    REQUEST ID: req-1779744508484-5a77fecc
    COPIES: 2
    
    [DOWNLOAD TRANSCRIPT]
    └─ Secure link expires in 7 days
    
    Files included:
    • Transcript_2024-00456_Copy1.pdf
    • Transcript_2024-00456_Copy2.pdf

[WHAT JUAN DOES]
  1. Receives email with transcript
  2. Clicks [DOWNLOAD TRANSCRIPT] to download PDF
  3. Saves files to computer
  4. Can use for job applications, further studies, etc.

[SYSTEM COMPLETES]
  ✓ Mark DELIVERY envelope as COMPLETED
  ✓ Move to final envelope (FEEDBACK)

DELIVERY ENVELOPE STATUS:
  Before: pending
  After:  COMPLETED ✅

═══════════════════════════════════════════════════════════════════════════════
ENVELOPE 6: FEEDBACK ENVELOPE
═══════════════════════════════════════════════════════════════════════════════

WHAT HAPPENS:
──────────────

[STEP 1] System sends feedback request email:

  EMAIL TO: juan.delacruz@mapua.edu.ph
  ─────────────────────────────────────
  Subject: We'd Love Your Feedback - Transcript Service

  Body includes:
    We'd like to know about your experience with our service.
    
    REQUEST ID: req-1779744508484-5a77fecc
    
    [PROVIDE FEEDBACK]
    └─ Opens feedback survey form
    
    Questions:
    ✓ How satisfied were you with the service? (1-5 stars)
    ✓ Was the process easy? (Yes/No)
    ✓ Any comments or suggestions?
    ✓ Would you recommend this service? (Yes/No)

[WHAT JUAN DOES - OPTIONAL]
  1. Receives feedback email
  2. Clicks [PROVIDE FEEDBACK] (optional)
  3. Fills out survey form
  4. Submits feedback
  
  OR
  
  Juan ignores email (feedback is optional)

[SYSTEM PROCESSING]
  If Juan provides feedback:
    ✓ Store feedback in MongoDB
    ✓ Create FeedbackToken record
    ✓ Mark FEEDBACK envelope as COMPLETED
  
  If Juan doesn't respond:
    ✓ After 7 days, auto-close FEEDBACK envelope
    ✓ Mark as WAIVED

FEEDBACK ENVELOPE STATUS:
  Before: pending
  After:  COMPLETED or WAIVED ✅

═══════════════════════════════════════════════════════════════════════════════
COMPLETE USER JOURNEY TIMELINE
═══════════════════════════════════════════════════════════════════════════════

📅 DAY 1 - Morning
──────────────────
Juan submits Transcript request via Portal
  → REQUEST envelope COMPLETED ✅
  → APPROVAL envelope starts (emails sent to 3 approvers)

📅 DAY 1 - Afternoon
────────────────────
Approvers receive 3 approval emails
  → barondimaranan@gmail.com clicks [APPROVE]
  → Approval recorded

📅 DAY 1 - Late Afternoon
─────────────────────────
baron@fowlstudios.com clicks [APPROVE]
  → BOTH APPROVAL CONDITIONS MET ✅
  → APPROVAL envelope COMPLETED ✅
  → PAYMENT EMAIL SENT TO JUAN 📧

📅 DAY 1 - Evening
──────────────────
Juan receives payment email with link
  → [PROCEED TO PAYMENT]
  → Phase 2 UI opens
  → Clicks [PAY WITH MAYA]
  → Enters card details
  → Payment processed: PHP 700 ✅
  → PAYMENT envelope COMPLETED ✅
  → PROCESSING envelope starts automatically

📅 DAY 2 - Morning
──────────────────
System processes request
  → Generate 2 copies of transcript
  → PROCESSING envelope COMPLETED ✅
  → DELIVERY envelope starts

📅 DAY 2 - Afternoon
────────────────────
Juan receives delivery email with transcript download
  → Clicks [DOWNLOAD TRANSCRIPT]
  → Saves 2 PDF files
  → DELIVERY envelope COMPLETED ✅
  → FEEDBACK envelope starts

📅 DAY 2 - Late Afternoon (Optional)
─────────────────────────────────────
Juan receives feedback email (optional)
  → May or may not complete
  → After 7 days, auto-closed
  → FEEDBACK envelope COMPLETED or WAIVED ✅

═══════════════════════════════════════════════════════════════════════════════
API CALLS & EMAIL SUMMARY
═══════════════════════════════════════════════════════════════════════════════

ENVELOPE #1 - REQUEST
  API Calls (Backend):
    POST /api/services/SERV-3-05262026/submit (User makes this)
  Emails Sent: None (confirmation on portal only)
  User Clicks: "Submit Request" button on portal

ENVELOPE #2 - APPROVAL
  API Calls (Backend):
    POST /api/approvals/{TOKEN_1}/approve (Approver 1 clicks email link)
    POST /api/approvals/{TOKEN_2}/approve (Approver 2 clicks email link)
  Emails Sent: 3 approval emails to approvers
  User Clicks: [APPROVE] buttons in approval emails

ENVELOPE #3 - PAYMENT
  API Calls:
    POST /api/payments/{REQUEST_ID}/complete (Phase 2 UI calls after Maya success)
  Emails Sent: 1 payment notification email to requestor
  User Clicks: [PROCEED TO PAYMENT] → Phase 2 UI → [PAY WITH MAYA] → Maya payment

ENVELOPE #4 - PROCESSING
  API Calls: None (automatic backend processing)
  Emails Sent: Optional processing update email
  User Clicks: Nothing (automatic)

ENVELOPE #5 - DELIVERY
  API Calls: None (automatic backend processing)
  Emails Sent: 1 delivery email with transcript download link
  User Clicks: [DOWNLOAD TRANSCRIPT] button in email

ENVELOPE #6 - FEEDBACK
  API Calls: None (user provides feedback via form)
  Emails Sent: 1 feedback survey email
  User Clicks: [PROVIDE FEEDBACK] button (optional)

═══════════════════════════════════════════════════════════════════════════════
KEY POINTS
═══════════════════════════════════════════════════════════════════════════════

✅ REQUEST ENVELOPE
   • User submits
   • System validates
   • Completed immediately
   • Moves to approval

✅ APPROVAL ENVELOPE
   • Complex rule enforced (BOTH conditions required)
   • Emails sent to 3 approvers
   • Approvers click [APPROVE] in email
   • When complete → Auto-send payment email

✅ PAYMENT ENVELOPE
   • User receives email with payment link
   • User clicks link → Phase 2 UI opens
   • User pays via Maya
   • Phase 2 UI calls payment completion API
   • When complete → Auto-start processing

✅ PROCESSING ENVELOPE
   • No user interaction (automatic)
   • Business logic executes (generate transcript)
   • System completes

✅ DELIVERY ENVELOPE
   • No user interaction needed to trigger
   • User receives email with download link
   • User clicks link to download transcript
   • User completes

✅ FEEDBACK ENVELOPE
   • User receives optional feedback email
   • User can complete feedback survey or skip
   • Auto-closes after 7 days if not completed

═══════════════════════════════════════════════════════════════════════════════
