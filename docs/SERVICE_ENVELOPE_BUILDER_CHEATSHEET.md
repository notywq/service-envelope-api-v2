# 📋 Service Envelope Builder Cheat Sheet
## Rules, Flexibility & Examples

> **Core Concept**: Create ANY service you want by writing YAML definitions. Each service follows **one ruleset with infinite flexibility**. You define the rules for YOUR specific service.

---

## 🎯 The Core Idea

**You are NOT limited by templates.** You have a RULESET:

```
📝 REQUEST      → Define ANY fields you need (names, emails, numbers, dates, etc.)
✅ APPROVAL     → Define ANY approval workflow (one person, multiple people, hierarchies)
💰 PAYMENT      → Define ANY charges/fees (itemized, fixed, free)
⚙️  PROCESSING   → Define ANY backend work (validate, call APIs, generate documents, notify)
📦 DELIVERY     → Define ANY delivery method (email, pickup, mail, or let user choose)
⭐ FEEDBACK     → Define ANY survey questions
```

**You can create as many different services as you want.** Each one gets its own YAML file following these rules.

---

## 📑 What's Inside

1. [The Ruleset](#the-ruleset) - What tools you have
2. [TOR Example](#tor-example-solid-working-example) - A solid, tested service
3. [Simple Service](#simple-service-example) - Clinic Visit (easy to understand)
4. [Complex Service](#complex-service-example) - Room Rental (more features)
5. [Quick Reference](#quick-reference-tables) - Lookup tables
6. [Your Turn](#your-turn) - Build your own

---

# 🔧 The Ruleset

<a id="the-ruleset"></a>

## Every Service Has This Structure

```yaml
id: SERV-X-YYYYMMDD           # Unique ID
name: Service Name             # What users see
description: What it does
type: serviceType              # Internal type
serviceCode: CODE              # Short code (TOR, RR, etc)
initiator: Role               # Who typically requests it

envelopes:
  request:      { ... YOUR RULES ... }
  approval:     { ... YOUR RULES ... }
  payment:      { ... YOUR RULES ... }
  processing:   { ... YOUR RULES ... }
  delivery:     { ... YOUR RULES ... }
  feedback:     { ... YOUR RULES ... }
```

---

## 🎮 Your Tools - What You Can Do

### TOOL 1️⃣: Request Parameters - "What Do You Want To Ask?"

**YOU CAN:**
- Add ANY number of parameters (1, 5, 20, 100+)
- Use ANY data types: String, Number, Date, Boolean, List
- Make parameters required or optional
- Use parameters throughout the service (with `{{parameterName}}`)

**EXAMPLES:**
```yaml
# Simple (3 fields)
parameters:
  name: String
  email: String
  date: Date

# Complex (10+ fields)
parameters:
  studentId: String
  email: String
  firstName: String
  lastName: String
  numberOfCopies: Number (1-5)
  purposes: String (Scholarship, Employment, Transfer)
  deliveryMode: String (Pickup, Mail, Email)
  mailingAddress: String (optional)
  urgency: String (Regular, Rush)
  specialRequests: String (optional)
```

---

### TOOL 2️⃣: Approval Rules - "Who Decides?"

**YOU CAN:**
- Single person approval (`specific_approver`)
- First person to approve (`any_one`)
- Everyone approves (`all_must_approve`)
- Head person + at least one team member (`complex`)
- Set expiry times (24, 48, 72+ hours)
- Define any number of approvers

**EXAMPLES:**
```yaml
# Single decision-maker
approvalRules:
  type: specific_approver
  specificApprover: dean@mapua.edu.ph

# Any one director can approve
approvalRules:
  type: any_one

# Everyone must sign off
approvalRules:
  type: all_must_approve

# Head + team member (checks & balances)
approvalRules:
  type: complex
  requiredApprovers:
    - head@mapua.edu.ph
  atLeastOneOf:
    - member1@mapua.edu.ph
    - member2@mapua.edu.ph
    - member3@mapua.edu.ph
```

---

### TOOL 3️⃣: Payment Rules - "What's the Cost?"

**YOU CAN:**
- Free services (required: false)
- Fixed single price
- Multiple itemized charges
- Different payment providers (maya, stripe, internal)
- Any currency (PHP, USD, EUR)

**EXAMPLES:**
```yaml
# Free
payment:
  required: false

# Simple fee
payment:
  required: true
  paymentProvider: maya
  charges:
    - item: Service Fee
      amount: 150
      currency: PHP

# Itemized (multiple charges)
payment:
  required: true
  paymentProvider: maya
  charges:
    - item: Processing
      amount: 200
      currency: PHP
    - item: Document Printing
      amount: 100
      currency: PHP
    - item: Delivery Fee
      amount: 50
      currency: PHP
```

---

### TOOL 4️⃣: Processing Tasks - "What Happens Behind The Scenes?"

**YOU CAN:**
- Call custom functions (verify_student, generate_document, etc.)
- Call external APIs (registrar, document systems, etc.)
- Send webhooks to notify systems
- Chain tasks in sequence
- Configure retries & timeouts
- Use request parameters with `{{parameterName}}`

**TASK TYPES:**
```yaml
# Type 1: Custom Function (built-in business logic)
- name: "Verify Student"
  type: custom_function
  customFunction:
    function: verify_student
    parameters:
      threshold: 2.0

# Type 2: API Call (call external system)
- name: "Notify Registrar"
  type: api_call
  apiCall:
    url: "https://api.system.com/notify"
    method: POST
    payload:
      studentId: "{{studentId}}"
      requestId: "{{requestId}}"
    timeout: 30000
    retries: 3

# Type 3: Webhook (trigger external workflow)
- name: "Alert Team"
  type: webhook
  webhook:
    url: "https://internal.mapua.edu.ph/webhooks/alert"
    method: POST
    timeout: 15000
    retries: 2
```

**Built-in Functions Available:**
- `verify_student` - Check if student is enrolled
- `pull_transcript` - Get academic records
- `generate_document` - Create PDFs/documents
- `send_notification` - Send email/SMS
- `validate_address` - Validate mailing address

---

### TOOL 5️⃣: Delivery Methods - "How Do They Get It?"

**YOU CAN:**
- Email delivery (with attachments)
- Pickup at a location
- Mail to address
- Let user choose (dynamic)

**EXAMPLES:**
```yaml
# Email only
delivery:
  method: Email
  email:
    subject: "Your Document"
    recipient: "{{email}}"

# Pickup only
delivery:
  method: Pickup
  pickup:
    location: "Registrar's Office, 2nd Floor"
    hoursAvailable: "8 AM - 5 PM, Mon-Fri"

# User chooses
delivery:
  method: "{{deliveryMode}}"
  email: { ... }
  pickup: { ... }
  mail: { ... }
```

---

### TOOL 6️⃣: Feedback Surveys - "How Did We Do?"

**YOU CAN:**
- Ask any survey questions (3-5 typical)
- Mix satisfaction, quality, improvement questions

```yaml
feedback:
  surveyQuestions:
    - Was the service completed satisfactorily?
    - How would you rate the quality?
    - What could we improve?
```

---

# 📌 TOR Example: Solid Working Example

<a id="tor-example-solid-working-example"></a>

## Transcript of Records (SERV-3-05262026)

**What it does**: Student requests official transcript, 2 people approve, pays PHP 700, gets document via chosen method.

```yaml
id: SERV-3-05262026
name: Transcript of Records (TOR)
description: Request official transcript of records
type: transcriptOfRecords
serviceCode: TOR
initiator: Student

envelopes:
  request:
    required: true
    parameters:
      studentId: String (e.g., 2020-00123)
      email: String
      firstName: String
      lastName: String
      numberOfCopies: Number (1-5)
      purposes: String (Scholarship, Employment, Transfer)
      deliveryMode: String (Pickup, Mail, Email)
      mailingAddress: String (optional)

  approval:
    required: true
    emailTemplateId: SERV-3-approval
    approvers:
      - id: barondimaranan@gmail.com
        role: Head Teller (Required)
      - id: baron@fowlstudios.com
        role: Sub Teller 1
      - id: barbargbf@gmail.com
        role: Sub Teller 2
    approvalRules:
      type: complex
      requiredApprovers:
        - barondimaranan@gmail.com
      atLeastOneOf:
        - baron@fowlstudios.com
        - barbargbf@gmail.com
    expiryHours: 48

  payment:
    required: true
    paymentProvider: maya
    charges:
      - item: TOR processing fee
        amount: 500
        currency: PHP
      - item: Printing and delivery
        amount: 200
        currency: PHP
    emailTemplateId: SERV-3-payment

  processing:
    required: true
    stopOnFailure: true
    tasks:
      - name: verify_academic_record
        type: custom_function
        customFunction:
          function: verify_student
          parameters:
            threshold: 2.0

      - name: pull_transcript_data
        type: custom_function
        customFunction:
          function: pull_transcript

      - name: generate_transcript_document
        type: custom_function
        customFunction:
          function: generate_document
          parameters:
            documentType: "transcript"

      - name: notify_document_system
        type: api_call
        apiCall:
          url: https://registrar-api.mapua.edu.ph/transcripts/generate
          method: POST
          payload:
            requestId: "{{requestId}}"
            studentId: "{{studentId}}"
            copies: "{{numberOfCopies}}"
          timeout: 30000
          retries: 3

      - name: alert_delivery_team
        type: webhook
        webhook:
          url: https://internal.mapua.edu.ph/webhooks/delivery-ready
          method: POST

  delivery:
    required: true
    method: "{{deliveryMode}}"
    emailTemplateId: SERV-3-delivery
    email:
      subject: Your Transcript - MAPUA
      recipient: "{{email}}"
    pickup:
      location: "Registrar's Office, 2nd Floor"
      hoursAvailable: "8 AM - 5 PM, Mon-Fri"
    mail:
      address: "{{mailingAddress}}"

  feedback:
    required: true
    emailTemplateId: SERV-3-feedback
    surveyQuestions:
      - Did you receive your transcript on time?
      - Was the quality satisfactory?
      - Any suggestions?
```

---

# 🏥 Simple Service Example

<a id="simple-service-example"></a>

## Clinic Visit Request (SERV-6-05262026)

**What it does**: Student books a clinic visit, medical staff approves, no payment, gets reminder email.

**Why it's simple**: 
- Few parameters (just date & reason)
- Single approver (just medical staff)
- No payment
- Minimal processing (just send confirmation)

```yaml
id: SERV-6-05262026
name: Clinic Visit Request
description: Schedule an appointment with the student health clinic
type: clinicVisitRequest
serviceCode: CVR
initiator: Student

envelopes:
  request:
    required: true
    parameters:
      studentId: String (e.g., 2020-00123)
      email: String
      visitDate: Date (preferred appointment)
      reason: String (e.g., Regular Checkup, Vaccination, Consultation)
      notes: String (optional)

  approval:
    required: true
    emailTemplateId: SERV-6-approval
    approvers:
      - id: clinic.manager@mapua.edu.ph
        role: Clinic Manager
    approvalRules:
      type: specific_approver
      specificApprover: clinic.manager@mapua.edu.ph
    expiryHours: 24

  payment:
    required: false

  processing:
    required: true
    stopOnFailure: true
    tasks:
      - name: verify_student_status
        type: custom_function
        customFunction:
          function: verify_student
          parameters:
            includeInactive: true

      - name: confirm_appointment
        type: api_call
        apiCall:
          url: https://clinic-system.mapua.edu.ph/appointments/create
          method: POST
          payload:
            studentId: "{{studentId}}"
            visitDate: "{{visitDate}}"
            reason: "{{reason}}"
          timeout: 15000
          retries: 2

      - name: send_confirmation
        type: custom_function
        customFunction:
          function: send_notification
          parameters:
            recipient: "{{email}}"
            type: "email"
            subject: "Clinic Appointment Confirmed"

  delivery:
    required: true
    method: Email
    emailTemplateId: SERV-6-delivery
    email:
      subject: "Your Clinic Appointment is Scheduled"
      recipient: "{{email}}"

  feedback:
    required: true
    emailTemplateId: SERV-6-feedback
    surveyQuestions:
      - Was your appointment on time?
      - How was the clinic experience?
      - Would you recommend to other students?
```

---

# 🏨 Complex Service Example

<a id="complex-service-example"></a>

## Room Rental Service (SERV-4-05262026)

**What it does**: Student rents a room, multiple approvals needed (Head + Finance), complex pricing, multiple processing steps, flexible delivery.

**Why it's complex**:
- Many parameters (dates, room type, occupants, special requests)
- Multi-step approval (Head + Finance both required)
- Itemized payment (rental + deposit + insurance)
- Multiple processing tasks (verify student, check availability, generate contract, send to legal)
- Multiple delivery options (email contract or pickup)

```yaml
id: SERV-4-05262026
name: Room Rental Service
description: Rent a room for specified duration with approval and payment
type: roomRental
serviceCode: RR
initiator: Student

envelopes:
  request:
    required: true
    parameters:
      studentId: String
      email: String
      firstName: String
      lastName: String
      roomType: String (Single, Double, Suite)
      startDate: Date
      endDate: Date
      numberOfOccupants: Number (1-4)
      specialRequirements: String (optional, e.g., Pet, Accessibility)
      emergencyContact: String
      emergencyPhone: String

  approval:
    required: true
    emailTemplateId: SERV-4-approval
    approvers:
      - id: housing.head@mapua.edu.ph
        role: Housing Director (Required)
      - id: finance.head@mapua.edu.ph
        role: Finance Director (Required)
    approvalRules:
      type: all_must_approve
    expiryHours: 72

  payment:
    required: true
    paymentProvider: maya
    charges:
      - item: Monthly rental
        amount: 5000
        currency: PHP
      - item: Security deposit
        amount: 2000
        currency: PHP
      - item: Damage insurance
        amount: 500
        currency: PHP
    emailTemplateId: SERV-4-payment

  processing:
    required: true
    stopOnFailure: true
    tasks:
      - name: verify_student_eligibility
        type: custom_function
        customFunction:
          function: verify_student
          parameters:
            threshold: 1.5

      - name: check_room_availability
        type: api_call
        apiCall:
          url: https://housing-system.mapua.edu.ph/rooms/check-availability
          method: POST
          payload:
            roomType: "{{roomType}}"
            startDate: "{{startDate}}"
            endDate: "{{endDate}}"
          timeout: 30000
          retries: 3

      - name: generate_contract
        type: custom_function
        customFunction:
          function: generate_document
          parameters:
            documentType: "room_rental_contract"

      - name: send_to_legal_review
        type: webhook
        webhook:
          url: https://internal.mapua.edu.ph/webhooks/legal-review
          method: POST
          timeout: 20000
          retries: 2

      - name: create_occupancy_record
        type: api_call
        apiCall:
          url: https://housing-system.mapua.edu.ph/occupancy/create
          method: POST
          payload:
            studentId: "{{studentId}}"
            roomType: "{{roomType}}"
            startDate: "{{startDate}}"
            endDate: "{{endDate}}"
          timeout: 15000
          retries: 2

  delivery:
    required: true
    method: "{{deliveryMode}}"
    emailTemplateId: SERV-4-delivery
    email:
      subject: "Your Room Rental Contract"
      recipient: "{{email}}"
      attachmentInclude:
        - contract
    pickup:
      location: "Housing Office, Building C, 1st Floor"
      hoursAvailable: "9 AM - 5 PM"

  feedback:
    required: true
    emailTemplateId: SERV-4-feedback
    surveyQuestions:
      - Was the rental process smooth?
      - Was the room quality as expected?
      - How would you rate the Housing Office service?
      - Any improvements for next time?
```

---

# ⚡ Quick Reference Tables

<a id="quick-reference-tables"></a>

| Approval Type | When to Use | Setup |
|---------------|------------|-------|
| `specific_approver` | Single decision-maker | One email in `specificApprover` |
| `any_one` | Quick approval (any one person) | List multiple approvers |
| `all_must_approve` | Consensus (everyone signs) | List all approvers |
| `complex` | Head + team (checks & balances) | `requiredApprovers` + `atLeastOneOf` |

| Payment Type | Setup | Example |
|--------------|-------|---------|
| Free | `required: false` | - |
| Simple | One charge | PHP 150 |
| Itemized | Multiple charges | PHP 100 + 50 + 25 = 175 |

| Processing Task | Purpose | Use When |
|-----------------|---------|----------|
| `custom_function` | Business logic | Validate, generate, check status |
| `api_call` | External system | Call registrar, document system, etc |
| `webhook` | Notify another system | Alert team, trigger workflow |

| Delivery Method | Setup | Use When |
|-----------------|-------|----------|
| Email | Subject + recipient | Digital documents |
| Pickup | Location + hours | Physical items at location |
| Dynamic | Configure all three | User chooses |

---

# 🎯 Your Turn: Build Your Own

<a id="your-turn"></a>

**You have the tools. Pick a service idea and fill in:**

```yaml
id: SERV-X-YYYYMMDD
name: [Your Service]
description: [What it does]
type: [camelCase]
serviceCode: [CODE]
initiator: [Role]

envelopes:
  request:
    parameters:
      field1: Type
      field2: Type
      # ... as many as you need

  approval:
    approvers:
      - id: [email]
        role: [Role]
    approvalRules:
      type: [one of: specific_approver, any_one, all_must_approve, complex]

  payment:
    required: [true/false]
    charges:
      - item: [Description]
        amount: [Amount]

  processing:
    tasks:
      - name: [Task]
        type: [custom_function/api_call/webhook]
        # ... config

  delivery:
    method: [Email/Pickup/Mail/dynamic]

  feedback:
    surveyQuestions:
      - [Question 1?]
      - [Question 2?]
```

**That's it.** Save as `yourservice.yaml` in `services/` folder and you're done.

---

## Key Points

✅ **You control everything**: parameters, approvers, charges, processing, delivery  
✅ **Create unlimited services**: Each gets its own YAML file  
✅ **Reuse patterns**: Copy from TOR/Room Rental and modify  
✅ **Mix and match**: Simple services in 5 minutes, complex ones with full workflow  
✅ **Follow the rules**: Request → Approval → Payment → Processing → Delivery → Feedback  

---

**Last Updated**: 2026-05-26  
**Status**: Ready to build services
