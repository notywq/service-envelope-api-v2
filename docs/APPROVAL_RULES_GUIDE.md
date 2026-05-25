# Approval Rules Reference Guide

This guide documents all supported approval rule types in the Service Envelope System.

## Simple Rules

### 1. `all_must_approve` (Default)
All approvers in the list must explicitly approve before the request can proceed.

**Use Case**: Payments requiring multiple signatures, or requests needing consensus from all stakeholders.

**YAML Example**:
```yaml
approvalRules:
  type: all_must_approve
```

**How it works**:
- Pipeline pauses until every approver in the `approvers` list has approved
- If ANY approver denies, request is cancelled
- All approvers must act

---

### 2. `any_one`
First approval completes the approval envelope; request immediately proceeds.

**Use Case**: Notifications or acknowledgments, quick turnaround approvals, escalation chains.

**YAML Example**:
```yaml
approvalRules:
  type: any_one
```

**How it works**:
- Pipeline pauses and resumes as soon as ANY one approver approves
- If an approver denies, request is cancelled
- Only one action needed

---

### 3. `specific_approver`
Only a designated approver can approve; others' actions are ignored.

**Use Case**: Hierarchical workflows, designated decision maker, compliance requirements.

**YAML Example**:
```yaml
approvalRules:
  type: specific_approver
  specificApprover: head.of.department@mapua.edu.ph
```

**How it works**:
- Only the specified approver's action matters
- Other approvers in the list are notified but their approvals/denials don't affect outcome
- Request proceeds only when the specific approver approves
- If specific approver denies, request is cancelled

---

## Complex Rules

### 4. `complex` - Required + At-Least-One Pattern
Combines required approvers (all must approve) with a group where at least one must approve.

**Use Case**: 
- TOR approvals: Head teller (required) + at least one sub teller
- Course enrollment: Department chair (required) + at least one from faculty review board
- Budget approvals: Finance officer (required) + at least one department manager
- Access requests: Security team (required) + at least one manager

**YAML Example**:
```yaml
approvalRules:
  type: complex
  requiredApprovers:
    - barondimaranan@gmail.com          # Head Teller - MUST approve
  atLeastOneOf:
    - baron@fowlstudios.com             # Sub Teller 1
    - barbargbf@gmail.com               # Sub Teller 2
```

**Full Service Example** (Transcript of Records):
```yaml
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
```

**How it works**:
- ALL approvers in `requiredApprovers` must approve
- AND at least ONE approver from `atLeastOneOf` must approve
- Request proceeds only when both conditions are met
- If any approver (required or optional) denies, request is cancelled
- All-or-nothing: can't proceed with just required approvers, and can't proceed with just one optional

**Denial Logic Across All Types**:
- Single denial from any approver (required or optional) cancels the entire request
- Request status changes to `cancelled`
- Denial email is sent to the requestor
- Pipeline does not resume

---

## Approval Status Tracking

### Request Status Flow

1. **queued** → Request created, waiting to enter approval
2. **pending_approval** → In approval envelope, waiting for approvers
3. **pending_payment** → Approval complete, waiting for payment
4. **pending_delivery** → Processing complete, waiting for delivery
5. **pending_feedback** → Delivery complete, waiting for feedback
6. **processing** → Feedback complete, pipeline done
7. **completed** → All envelopes processed successfully
8. **cancelled** → Denied by any approver or explicit cancellation
9. **failed** → Technical error in processing
10. **process_pending** → Paused at a stage awaiting external condition

### Approval Token Management

- Tokens expire after configured hours (default 24 hours)
- Tokens are stored in MongoDB `ApprovalToken` collection
- Once used (approved/denied), token cannot be reused
- Each token is tied to a specific request and approver

---

## API Endpoints for Approvals

### Approve a Request
```
POST /api/approvals/{token}/approve
Body: { comment?: string }

Response: {
  success: boolean,
  message: string,
  approvalComplete: boolean,
  ruleType: string,
  nextStatus: string,
  request: { ... }
}
```

### Deny a Request
```
POST /api/approvals/{token}/deny
Body: { reason: string }

Response: {
  success: boolean,
  message: string,
  request: { ... }
}
```

### Check Token Status
```
GET /api/approvals/{token}

Response: {
  token: string,
  status: 'active' | 'used' | 'expired',
  expiresAt: string,
  requestId: string,
  approverId: string
}
```

### Get Request Details for Review
```
GET /api/approvals/{token}/request

Response: {
  request: { complete request object },
  approvalInfo: {
    token: string,
    approverId: string,
    expiresAt: string,
    ruleType: string,
    requiredApprovers?: string[],
    atLeastOneOf?: string[],
    currentApprovals: { [email]: status }
  }
}
```

---

## Decision Matrix

| Rule Type | All Approve? | At Least 1? | Specific? | Proceed? |
|-----------|-------------|------------|-----------|----------|
| all_must_approve | ✓ | N/A | N/A | ✓ |
| any_one | ✗ | ✓ | N/A | ✓ |
| specific_approver | ✗ | ✗ | ✓ | ✓ |
| complex | ✓ | ✓ | N/A | ✓ |

---

## Common Scenarios

### Scenario 1: Treasurer + Account Manager
**Rule**: `complex`
```yaml
requiredApprovers:
  - treasurer@mapua.edu.ph
atLeastOneOf:
  - account.manager.1@mapua.edu.ph
  - account.manager.2@mapua.edu.ph
```
**Meaning**: Treasurer must approve + at least one account manager must approve

---

### Scenario 2: Dean + Any Faculty Review Board Member
**Rule**: `complex`
```yaml
requiredApprovers:
  - dean@mapua.edu.ph
atLeastOneOf:
  - faculty.1@mapua.edu.ph
  - faculty.2@mapua.edu.ph
  - faculty.3@mapua.edu.ph
```
**Meaning**: Dean must approve + at least one faculty board member must approve

---

### Scenario 3: Department Head Only
**Rule**: `specific_approver`
```yaml
requiredApprovers: []
atLeastOneOf: []
specificApprover: dept.head@mapua.edu.ph
```
**Meaning**: Only department head can approve; others' actions don't matter

---

### Scenario 4: Any Director Can Approve
**Rule**: `any_one`
```yaml
# All directors in approvers list, but only one needs to act
approvers:
  - id: director.1@mapua.edu.ph
    role: Director
  - id: director.2@mapua.edu.ph
    role: Director
  - id: director.3@mapua.edu.ph
    role: Director
approvalRules:
  type: any_one
```
**Meaning**: Pipeline resumes after first director approves

---

### Scenario 5: Consensus Required
**Rule**: `all_must_approve`
```yaml
approvers:
  - id: stakeholder.1@mapua.edu.ph
    role: Stakeholder
  - id: stakeholder.2@mapua.edu.ph
    role: Stakeholder
  - id: stakeholder.3@mapua.edu.ph
    role: Stakeholder
approvalRules:
  type: all_must_approve
```
**Meaning**: All stakeholders must explicitly approve

---

## Implementation Notes

### TypeScript Type
```typescript
export interface ApprovalRules {
  type: 'all_must_approve' | 'any_one' | 'specific_approver' | 'complex';
  specificApprover?: string;
  requiredApprovers?: string[];
  atLeastOneOf?: string[];
}
```

### Approval Token Persistence
- Stored in MongoDB `ApprovalToken` collection
- Indexed by token ID for fast lookups
- Contains: token, requestId, approverId, expiresAt, used flag

### Email Templates
Each approval rule type should have corresponding email templates:
- Template variables available: `{{requestId}}`, `{{approverName}}`, `{{approvalLink}}`, etc.
- Different messaging for complex rules showing what's needed

---

## Testing Complex Approval Rules

### Test Case: TOR with Head Teller + Sub Teller
1. Create TOR request with transcriptOfRecords service
2. Get approval tokens for head teller and both sub tellers
3. Test scenario A: Sub teller 1 approves first (should NOT complete)
4. Test scenario B: Head teller approves (should NOT complete without sub teller)
5. Test scenario C: Both head teller + sub teller 1 approve (should complete)
6. Verify pipeline resumes to Payment envelope
