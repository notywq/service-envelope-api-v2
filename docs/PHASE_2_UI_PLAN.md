## Phase 2 UI Implementation Plan
### Service Envelope System - Dashboard & User Interface Layer

**Prepared for**: Development Team (React/Next.js Frontend Implementation)
**Status**: Ready for Implementation
**Backend API Version**: 1.0.0 (Fully Implemented)
**Database**: MongoDB (Service Envelope v2)

---

## 1. Overview & Architecture

The Phase 2 UI complements the completed 6-envelope backend orchestration system. The UI provides:

- **Requestor Dashboard**: Submit service requests, track progress, make payments, submit feedback
- **Approver Dashboard**: Review and approve/deny pending requests
- **Admin Dashboard**: Manage service definitions, monitor system health, view reports
- **Payment Integration**: MAYA payment gateway UI embedding
- **Email-Based Links**: Direct links from emails to action pages (no login required for feedback/payment)

### Envelope Flow Context
```
Requestor creates request 
    ↓
→ [Approval] → Approvers review & approve
    ↓
→ [Payment] → Requestor pays (MAYA gateway)
    ↓
→ [Processing] → Backend executes API tasks
    ↓
→ [Delivery] → Requestor selects delivery method
    ↓
→ [Feedback] → Requestor completes survey
    ↓
Request Complete
```

Each envelope sends start/end emails with emailTemplateStartEnvelope and emailTemplateEndEnvelope.

---

## 2. Core Pages & User Flows

### 2.1 Requestor Pages

#### 2.1.1 Home Dashboard (`/dashboard`)
- **Purpose**: Central hub for requestors
- **Features**:
  - List all submitted requests with status indicators
  - Search/filter by request ID, service type, status
  - Quick action buttons: View Details, Continue Payment, Submit Feedback
  - Status legend showing 6-envelope progression
  - Key metrics: Total requests, Pending actions, Completed

#### 2.1.2 Submit Service Request (`/requests/new`)
- **Purpose**: Create a new service request
- **Form Fields** (dynamic based on ServiceDefinition):
  - Service Type (dropdown from MongoDB)
  - First Name, Last Name
  - Email Address
  - Phone Number
  - Service-specific parameters (rendered from service definition)
    - Example for Course Enrollment: Courses list, Semester, etc.
    - Example for Room Rental: Dates, Capacity, Equipment needs
- **Validation**: Client-side + server validation before POST to `/api/requests`
- **Success**: Display request ID, confirmation email sent notification
- **Error Handling**: Clear messages for validation errors, server errors

#### 2.1.3 Request Details Page (`/requests/:requestId`)
- **Purpose**: Track request progress through 6 envelopes
- **Layout**:
  - Request header: ID, Created date, Service type, Current status
  - Timeline/Progress indicator showing 6 envelopes:
    - Request (Completed)
    - Approval (Completed/Pending/Failed)
    - Payment (Completed/Pending/Failed)
    - Processing (In Progress/Pending/Failed)
    - Delivery (Pending/In Progress/Completed)
    - Feedback (Pending/Completed)
  - Detailed envelope cards below timeline:
    - **Approval Envelope**: Status, approvers list, approval dates
    - **Payment Envelope**: Charges, status, transaction ID if paid
    - **Processing Envelope**: Task list with status
    - **Delivery Envelope**: Selected method, tracking info
    - **Feedback Envelope**: Survey link (if available), submission status
  - Call-to-action buttons:
    - "Complete Payment" (if payment pending)
    - "Select Delivery Method" (if awaiting selection)
    - "Submit Feedback" (if feedback pending)
  - Activity log: Timeline of all status changes

#### 2.1.4 Payment Page (`/payment?requestId=REQ-20250815-001`)
- **Purpose**: Complete payment via MAYA gateway
- **Features**:
  - Payment summary: Amount, Service, Request ID
  - MAYA payment form (embedded iframe or redirect)
  - Payment status: Pending → Processing → Completed
  - Error handling: Display MAYA error messages, retry options
  - Success: Confirmation email, redirect to request details
- **API Calls**:
  - GET `/api/requests/:requestId` (fetch payment envelope details)
  - POST `/api/payments/:requestId/complete` (after MAYA callback)

#### 2.1.5 Delivery Method Selection (`/requests/:requestId/delivery`)
- **Purpose**: Select delivery method after processing complete
- **Method Options**:
  - **Email**: 
    - Form: Recipient email (pre-filled from request)
    - Optional: Attachment URLs preview
  - **Physical Mail**:
    - Form: Address, Carrier (DHL, FedEx, etc.), Tracking info
    - Optional: Require signature checkbox, Estimated delivery days
  - **Pickup**:
    - Display: Pickup location(s), Hours of operation
    - Form: Preferred pickup date
    - Set 30-day pickup deadline
- **API Call**: POST `/api/delivery/:requestId/method` with selected method & details
- **Success**: Confirmation message, redirect to delivery tracking

#### 2.1.6 Feedback Survey Page (`/feedback/:token`)
- **Purpose**: Collect post-service feedback (public access, no login)
- **Features**:
  - Request summary: Service type, Completion date, Request ID (read-only)
  - Survey form (dynamic based on service definition):
    - Rating questions (1-5 stars or numeric scale)
    - Open-ended comment section
    - Optional: Net Promoter Score (NPS) question
  - Token-based access (no authentication required)
  - Expiry warning: "This survey expires on [date]"
  - Submit button with validation
  - Success page: Thank you message, email confirmation sent
- **API Calls**:
  - GET `/api/requests/:requestId/feedback` (fetch feedback status)
  - POST `/api/feedback/:requestId/submit` with token validation

---

### 2.2 Approver Pages

#### 2.2.1 Approver Dashboard (`/approver/dashboard`)
- **Purpose**: Manage pending approvals
- **Features**:
  - List pending approval requests (sorted by age)
  - Status indicators: Awaiting, Approved, Denied
  - Quick filters: All, Pending My Approval, Approved, Denied
  - Bulk actions: Mark reviewed
  - Search by request ID, requestor name

#### 2.2.2 Approval Request Details (`/approver/requests/:requestId`)
- **Purpose**: Review and approve/deny a request
- **Features**:
  - Request details: Requestor info, Service type, Parameters
  - Approval summary:
    - Rule type (all_must_approve, any_one, specific_approver, complex)
    - List of all approvers with their status
    - Current user's approval status
  - Justification form (textarea for approval/denial reasons)
  - Action buttons:
    - "Approve" - Mark approved, add comments
    - "Deny" - Mark denied, add rejection reason
    - "Comment" - Add feedback without approving
  - Status display: Updated in real-time
- **API Call**: POST `/api/approvals/:requestId/approve` or `/deny`

---

### 2.3 Admin Pages

#### 2.3.1 Admin Dashboard (`/admin/dashboard`)
- **Purpose**: System overview and management
- **Features**:
  - KPIs: Total requests, Completion rate, Avg processing time, Pending approvals
  - Charts: Request volume over time, Status distribution, Approval rates
  - Alerts: Failed requests, Stuck in pending_external, Payment failures
  - Quick links: Service management, Email templates, Monitor jobs

#### 2.3.2 Service Definition Manager (`/admin/services`)
- **Purpose**: Create and manage service definitions
- **Features**:
  - List all services with status (active/inactive)
  - Create/Edit service (YAML or form-based):
    - Basic info: Service name, number, description
    - Approval envelope: Required?, Approvers, Rules
    - Payment envelope: Required?, Charges, Auto-calculate option
    - Processing envelope: Required?, API tasks, Stop on failure
    - Delivery envelope: Required?, Default method, Details
    - Feedback envelope: Required?, Survey template, Expiry days
  - Publish/activate service
  - Version history

#### 2.3.3 Email Template Manager (`/admin/templates`)
- **Purpose**: Manage and test email templates
- **Features**:
  - List all templates: Preview, Edit, Test
  - Template editor (WYSIWYG HTML editor):
    - Toolbar for formatting
    - Placeholder browser: {{requestId}}, {{firstName}}, {{paymentLink}}, etc.
    - Preview pane with dynamic values
  - Test email: Send to admin email with sample data
  - Template naming: SERV-{serviceNumber}-{envelopeType}-{start|end}

#### 2.3.4 Request Monitoring (`/admin/requests`)
- **Purpose**: View all requests, troubleshoot issues
- **Features**:
  - Advanced search/filter: Status, Date range, Service type, Requestor
  - Detailed request view with full envelope data
  - Manual intervention options:
    - Mark envelope as completed (override)
    - Retry failed processing tasks
    - Force move to next envelope
  - Export requests to CSV/Excel
  - Request timeline view

#### 2.3.5 System Health (`/admin/health`)
- **Purpose**: Monitor backend services
- **Features**:
  - MongoDB connection status
  - Email service status
  - Payment gateway (MAYA) status
  - API task execution logs
  - Failed job queue
  - Performance metrics: API response times, Task execution times

---

## 3. API Endpoints Reference

### 3.1 Request Management

```
POST /api/requests
├─ Submit new service request
├─ Body: { type, initiator, parameters }
└─ Returns: { requestId, status, createdAt }

GET /api/requests/:requestId
├─ Fetch request details with all envelopes
└─ Returns: ServiceRequest with full envelope data

GET /api/requests
├─ List requests (with pagination, filters)
├─ Query: ?status=pending&serviceType=enrollment&page=1&limit=20
└─ Returns: { requests: [...], total, page, limit }
```

### 3.2 Approval Management

```
POST /api/approvals/:requestId/approve
├─ Approve a request
├─ Body: { approverId, justification }
└─ Returns: { status, approvedAt }

POST /api/approvals/:requestId/deny
├─ Deny a request
├─ Body: { approverId, reason }
└─ Returns: { status, deniedAt }

GET /api/approvals?status=pending
├─ List pending approvals
└─ Returns: { approvals: [...] }
```

### 3.3 Payment Management

```
GET /api/payments/:requestId
├─ Fetch payment envelope details
└─ Returns: { charges, status, transactionId }

POST /api/payments/:requestId/complete
├─ Mark payment as completed (called after MAYA callback)
├─ Body: { transactionId, amount, method, reference, metadata }
└─ Returns: { status, confirmedAt }

POST /api/payments/:requestId/failed
├─ Mark payment as failed
├─ Body: { transactionId, errorCode, errorMessage }
└─ Returns: { status, failedAt }

POST /api/payments/maya (webhook)
├─ MAYA payment gateway webhook
├─ Headers: X-MAYA-Signature validation required
└─ Updates request status via transactionId
```

### 3.4 Delivery Management

```
GET /api/delivery/:requestId
├─ Fetch delivery envelope status and options
└─ Returns: { status, availableMethods, details }

POST /api/delivery/:requestId/method
├─ Select delivery method
├─ Body: { method: 'email'|'physical_mail'|'pickup', details: {...} }
└─ Returns: { status, method, deliveryTrackingId }
```

### 3.5 Feedback Management

```
GET /api/feedback/:requestId
├─ Fetch feedback envelope (public - token not required if in email link)
└─ Returns: { feedbackLink, expiresAt, feedback: {...} }

POST /api/feedback/:requestId/submit
├─ Submit feedback survey
├─ Body: { ratings: {...}, comments, token? }
└─ Returns: { status, submittedAt }
```

### 3.6 Admin/Service Management

```
GET /api/admin/services
├─ List all service definitions
└─ Returns: { services: [...] }

POST /api/admin/services
├─ Create new service definition
├─ Body: { serviceNumber, name, definition: {...} }
└─ Returns: { serviceId, created }

PUT /api/admin/services/:serviceId
├─ Update service definition
└─ Returns: { updated }

GET /api/admin/templates
├─ List email templates
└─ Returns: { templates: [...] }

POST /api/admin/templates
├─ Create/update email template
├─ Body: { templateId, subject, htmlBody }
└─ Returns: { templateId, created }

GET /api/admin/health
├─ System health check
└─ Returns: { mongo, emailService, maya, timestamp }
```

---

## 4. State Management Strategy

### 4.1 Frontend State (Recommended: Redux/Zustand/TanStack Query)

```typescript
// Request state
{
  requests: {
    [requestId]: {
      id: string,
      type: string,
      status: 'queued'|'pending_*'|'completed'|'failed',
      envelopes: {...},
      lastUpdated: ISO8601
    }
  },
  loading: boolean,
  error: null | string
}

// Approvals state
{
  pendingApprovals: [...],
  myApprovals: {...},
  loading: boolean
}

// Payment state
{
  currentPayment: {
    requestId: string,
    amount: number,
    status: 'pending'|'processing'|'completed'|'failed'
  },
  mayaSession: string | null
}

// Feedback state
{
  feedbackToken: string,
  surveyExpires: ISO8601,
  submitted: boolean
}

// Admin state
{
  services: [...],
  templates: [...],
  healthStatus: {...},
  requests: [...] (admin view)
}
```

### 4.2 Caching Strategy

- **Requests**: Cache for 30 seconds (auto-refresh on actions)
- **Services**: Cache for 24 hours (refresh on admin edit)
- **Templates**: Cache for 24 hours (refresh on admin edit)
- **Health**: Cache for 1 minute

### 4.3 Real-Time Updates (Recommended: WebSockets)

- Status changes from backend
- Approval notifications
- Processing progress updates
- Delivery status updates

---

## 5. Email Integration

### 5.1 Email-Based Navigation

Emails contain direct links with optional parameters:

```
Approval Email:
  https://ui.example.com/approver/requests/REQ-20250815-001

Payment Email:
  https://ui.example.com/payment?requestId=REQ-20250815-001

Delivery Email:
  https://ui.example.com/requests/REQ-20250815-001/delivery

Feedback Email:
  https://ui.example.com/feedback/[unique-feedback-token]
  (No login required - token provides access)
```

### 5.2 Email Template Variables

Templates in MongoDB support these placeholders:

```
System Variables:
  {{requestId}} - Request ID
  {{currentTimestamp}} - Current date/time in ISO8601
  {{frontendBaseUrl}} - UI base URL for links

Request Parameters (service-specific):
  {{initiatorName}}, {{initiatorEmail}}, {{firstName}}, {{lastName}}
  {{serviceType}}, {{paymentAmount}}, {{approverName}}
  ...any custom parameter from request.envelopes.request.parameters

Envelope-Specific:
  [Approval] {{approvalDeadline}}, {{requiredApprovers}}
  [Payment] {{chargeAmount}}, {{paymentLink}}
  [Processing] {{taskCount}}, {{processingDeadline}}
  [Delivery] {{deliveryLink}}, {{estimatedDeliveryDate}}
  [Feedback] {{feedbackLink}}, {{surveyExpiryDate}}
```

---

## 6. Component Structure (React/Next.js)

### 6.1 Recommended Folder Structure

```
src/
├── pages/
│   ├── dashboard/
│   │   ├── index.tsx (Requestor dashboard)
│   │   └── [requestId].tsx (Request details)
│   ├── requests/
│   │   ├── new.tsx (Submit request)
│   │   └── [requestId]/
│   │       ├── index.tsx (Details)
│   │       ├── payment.tsx (Payment flow)
│   │       └── delivery.tsx (Delivery selection)
│   ├── feedback/
│   │   └── [token].tsx (Survey page - public)
│   ├── approver/
│   │   ├── dashboard.tsx
│   │   └── [requestId].tsx
│   ├── admin/
│   │   ├── dashboard.tsx
│   │   ├── services.tsx
│   │   ├── templates.tsx
│   │   ├── requests.tsx
│   │   └── health.tsx
│   ├── payment/
│   │   └── index.tsx
│   └── api/
│       ├── [...proxy].ts (Optional: backend proxy)
│       └── auth/
│           └── [...nextauth].ts (NextAuth implementation)
├── components/
│   ├── EnvelopeTimeline.tsx
│   ├── RequestForm.tsx
│   ├── PaymentForm.tsx
│   ├── ApprovalCard.tsx
│   ├── FeedbackSurvey.tsx
│   └── ...
├── hooks/
│   ├── useRequest.ts
│   ├── useApprovals.ts
│   └── ...
├── services/
│   ├── api.ts (Axios/Fetch wrapper)
│   ├── auth.ts
│   └── ...
├── store/
│   ├── requestSlice.ts
│   ├── approvalSlice.ts
│   └── ...
└── utils/
    ├── formatters.ts
    ├── validators.ts
    └── constants.ts
```

### 6.2 Key Reusable Components

- `EnvelopeTimeline`: Shows 6-envelope progress
- `RequestForm`: Dynamic form based on service definition
- `PaymentWidget`: MAYA payment embedding
- `ApprovalCard`: Approval request display & actions
- `FeedbackSurvey`: Dynamic survey form
- `StatusBadge`: Status indicator with color coding
- `RequestTable`: Paginated request list with sorting
- `TemplateEditor`: HTML template editing with preview

---

## 7. Security Considerations

### 7.1 Authentication

- **Requestor**: Email-based login with OTP or session token
- **Approver**: System authentication (SSO recommended)
- **Admin**: Role-based access control (RBAC)
- **Feedback**: Token-based access (no authentication)
- **Payment**: Session-based (MAYA handles payment security)

### 7.2 Authorization

- **Requestor**: Can only view/modify own requests
- **Approver**: Can only approve assigned requests
- **Admin**: Full access (audit logging recommended)
- **Feedback**: Token validation required (expires after 7 days)

### 7.3 Data Protection

- **CORS**: Configure for UI domain only
- **HTTPS**: Enforce for all API calls
- **Token Rotation**: Implement JWT refresh tokens if using JWT
- **Rate Limiting**: Prevent brute-force attacks
- **Input Validation**: Client + server side validation
- **XSS Prevention**: Sanitize all dynamic content
- **CSRF Protection**: Implement CSRF tokens

---

## 8. Performance Optimization

### 8.1 Frontend

- **Code Splitting**: Route-based code splitting
- **Image Optimization**: Use next/image
- **Lazy Loading**: Lazy load heavy components
- **Caching**: HTTP caching headers for static assets
- **Compression**: Enable gzip/brotli compression

### 8.2 API

- **Pagination**: Implement pagination for list endpoints
- **Filtering**: Server-side filtering for large datasets
- **Indexing**: MongoDB indexes on frequently queried fields
- **Query Optimization**: Minimize N+1 queries
- **Rate Limiting**: Prevent abuse

---

## 9. Error Handling & User Experience

### 9.1 Error Scenarios

```
User-Facing Errors:
- Request not found (404)
- Payment failed (Payment gateway error)
- Approval timeout (Custom error for pending >X days)
- Feedback expired (Token expired)
- Processing failed (Retry option)

Server Errors:
- MongoDB connection lost
- Email service unavailable
- MAYA gateway timeout
- Invalid service definition

Recovery Strategies:
- Automatic retry for transient errors
- User-friendly error messages
- Support contact information
- Error reporting (Sentry/LogRocket recommended)
```

### 9.2 Loading States

- Skeleton screens for page loads
- Loading spinners for async operations
- Disable buttons during API calls
- Show progress indicators for long operations

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Component logic (props, state, events)
- Utility functions (formatters, validators)
- Hooks (custom React hooks)

### 10.2 Integration Tests

- Form submissions
- API call flows
- State management updates

### 10.3 E2E Tests

- Full request submission flow
- Payment gateway integration
- Approval workflow
- Feedback submission

### 10.4 Test Coverage Goals

- Components: 80%+
- Utilities: 90%+
- Hooks: 85%+
- E2E: Critical user paths 100%

---

## 11. Deployment & DevOps

### 11.1 Build & Deploy

- **Framework**: Next.js (recommended for SSR/SSG)
- **Deployment**: Vercel, AWS Amplify, or Docker/K8s
- **CI/CD**: GitHub Actions or GitLab CI
- **Environment Variables**: Separate configs for dev/staging/prod

### 11.2 Monitoring

- **Analytics**: Google Analytics, Mixpanel
- **Error Tracking**: Sentry, Rollbar
- **Performance**: Web Vitals, Lighthouse
- **Uptime**: UptimeRobot or similar

---

## 12. Phase 2 Implementation Roadmap

### Sprint 1: Core Pages (Week 1-2)
- [ ] Requestor Dashboard
- [ ] Request Details Page
- [ ] Request Submission Form

### Sprint 2: Approval & Payment (Week 3-4)
- [ ] Approver Dashboard
- [ ] Approval Details Page
- [ ] Payment Page with MAYA integration

### Sprint 3: Delivery & Feedback (Week 5-6)
- [ ] Delivery Method Selection Page
- [ ] Feedback Survey Page (public access)
- [ ] Delivery Tracking

### Sprint 4: Admin & Polish (Week 7-8)
- [ ] Admin Dashboard
- [ ] Service Definition Manager
- [ ] Email Template Manager
- [ ] System Health Monitoring

### Sprint 5: Testing & Optimization (Week 9-10)
- [ ] E2E Testing
- [ ] Performance Optimization
- [ ] Security Audit
- [ ] Bug Fixes & Polish

---

## 13. Key Integration Points

### 13.1 MAYA Payment Gateway

```typescript
// Payment flow
1. GET /api/payments/:requestId (fetch amount, charges)
2. Render MAYA payment form
3. User completes payment on MAYA dashboard
4. MAYA redirects to success URL
5. POST /api/payments/:requestId/complete (confirm payment)
6. Update envelope status → Processing
7. Trigger backend orchestrator
```

### 13.2 Email System

```
Template Flow:
1. Admin creates template in MongoDB via template manager
2. Backend fetches template when envelope processes
3. Backend substitutes {{placeholders}} with request data
4. Backend sends email via email service
5. Email contains direct link to relevant UI page
6. User clicks link → Direct to action page (feedback, payment, approval)
```

### 13.3 Status Synchronization

```
Real-Time Updates (WebSocket recommended):
Backend Event → WebSocket Event → Frontend Update
- Payment completed → Update payment status
- Processing started → Update processing progress
- Delivery method selected → Enable delivery tracking
- Feedback received → Show thank you page
```

---

## 14. Glossary & Key Terms

| Term | Definition |
|------|-----------|
| **Envelope** | A processing stage in the 6-envelope pipeline |
| **pending_external** | Waiting for user action (payment, approval, feedback) |
| **emailTemplateStartEnvelope** | Sent when envelope processing begins |
| **emailTemplateEndEnvelope** | Sent when envelope completes |
| **Service Definition** | Configuration YAML defining an entire service workflow |
| **Request State** | Current status across all 6 envelopes |
| **Feedback Token** | Unique token for public feedback survey access |
| **MAYA Gateway** | Third-party payment processing service |

---

## 15. Support & Contact

For questions about:
- **Backend API**: Contact Backend Team
- **Database Schema**: Contact DevOps/DBA
- **MAYA Integration**: Contact Payment Systems Team
- **UI/UX**: Contact Design Team
- **Deployment**: Contact DevOps Team

---

**Document Version**: 1.0
**Last Updated**: 2025-08-15
**Status**: Ready for Implementation
