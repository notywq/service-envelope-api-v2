# Request Processing Lock Implementation

**Date**: May 28, 2026  
**Status**: Implementation In Progress  
**Purpose**: Ensure sequential envelope processing without erratic logging or race conditions

---

## Problem Statement

Multiple external events (approvals, payments, delivery updates) were triggering `orchestrator.processRequest()` simultaneously for the same request, causing:
- ❌ Concurrent modification of request state
- ❌ Erratic, interleaved logs
- ❌ Envelope state corruption
- ❌ Multiple orchestrator instances running for same request

## Solution: RequestProcessingLock

A **per-request mutex** that ensures only ONE orchestrator instance processes a specific request at any given time.

---

## Architecture

### Lock Manager (`src/utils/request-processing-lock.ts`)

```typescript
class RequestProcessingLock {
  private locks = new Map<string, Promise<void>>();
  private lockLog = new Logger('RequestProcessingLock');
  
  async acquire(requestId: string): Promise<LockHandle>
    → If requestId already locked, waits in queue
    → Returns LockHandle with release() method
    → Logs: [LOCK-ACQUIRED], [LOCK-QUEUED], [LOCK-RELEASED]
  
  async tryAcquire(requestId: string): Promise<LockHandle | null>
    → Returns lock immediately if available
    → Returns null if already locked (non-blocking)
}
```

### LockHandle

```typescript
interface LockHandle {
  requestId: string;
  acquiredAt: Date;
  release(): void;  // Releases lock and processes queued calls
}
```

---

## Request Flow with Lock

```
1. POST /requests (create)
   ├─ Lock: ACQUIRE req-001 ✓
   ├─ orchestrator.processRequest()
   ├─ Processes Request → Approval → PAUSES
   ├─ Lock: RELEASE req-001
   └─ Response: Ready for approval

2. POST /approvals/:token (approval 1)
   ├─ Lock: ACQUIRE req-001 ✓
   ├─ Update approver 1 status
   └─ (check if all approvals met)

3. POST /approvals/:token (approval 2) [SIMULTANEOUS]
   ├─ Lock: QUEUE req-001 (waiting)
   ├─ [Waits for lock to be released from step 2]
   ├─ Lock: ACQUIRE req-001 ✓
   ├─ Update approver 2 status
   ├─ Check if all approvals met → YES
   ├─ orchestrator.processRequest() → Auto-resumes to Payment
   ├─ Lock: RELEASE req-001
   └─ Response: Approval complete

4. POST /payments/complete
   ├─ Lock: ACQUIRE req-001 ✓
   ├─ Update payment status
   ├─ orchestrator.processRequest() → Auto-resumes to Processing
   ├─ Processes all API tasks sequentially
   ├─ Auto-resumes to Delivery → PAUSES
   ├─ Lock: RELEASE req-001
   └─ Response: Payment processed

5. POST /delivery/:id/method
   ├─ Lock: ACQUIRE req-001 ✓
   ├─ Update delivery method
   ├─ orchestrator.processRequest()
   ├─ (Email delivery → completes, auto-resumes to Feedback)
   ├─ Feedback → PAUSES (24h auto-close timer starts)
   ├─ Lock: RELEASE req-001
   └─ Response: Delivery processing started

6. POST /feedback/:id/submit
   ├─ Lock: ACQUIRE req-001 ✓
   ├─ Update feedback data
   ├─ orchestrator.processRequest() → Auto-resumes
   ├─ Feedback completes → Request marked COMPLETED
   ├─ Lock: RELEASE req-001
   └─ Response: Request completed
```

---

## Lock Log Examples

```
[LOCK-ACQUIRED] RequestId: req-001 | Processing request (acquired immediately)
[LOCK-QUEUED]   RequestId: req-001 | Request already processing, queued (2 queued)
[LOCK-RELEASED] RequestId: req-001 | Lock released after 3.2s | Next: 2 queued calls

[LOCK-ACQUIRED] RequestId: req-002 | Processing request (acquired immediately)
[LOCK-ACQUIRED] RequestId: req-003 | Processing request (acquired immediately)
[LOCK-RELEASED] RequestId: req-002 | Lock released after 1.8s | Next: 0 queued calls
[LOCK-RELEASED] RequestId: req-003 | Lock released after 1.5s | Next: 0 queued calls
```

---

## Files Modified

### New Files
- `src/utils/request-processing-lock.ts` - Lock manager implementation
- `src/types/lock.types.ts` - Lock-related type definitions

### Updated Files
- `src/api/server.ts` - Initialize lock manager in appContext
- `src/api/routes/approvals.ts` - Use lock before orchestrator.processRequest()
- `src/api/routes/payments.ts` - Use lock before orchestrator.processRequest()
- `src/api/routes/requests.ts` - Use lock before orchestrator.processRequest()
- `src/api/routes/services.ts` - Use lock before orchestrator.processRequest()
- `src/api/routes/delivery.ts` - Restore orchestrator.processRequest() with lock
- `src/api/routes/feedback.ts` - Restore orchestrator.processRequest() with lock
- `src/api/routes/delivery-status.ts` - Restore orchestrator.processRequest() with lock

---

## Implementation Pattern

All routes follow this pattern:

```typescript
const lock = await appContext.requestProcessingLock.acquire(requestId);

try {
  // Update request state
  await appContext.stateManager.saveRequest(request);
  
  // Check if envelope complete → auto-resume
  if (envelopeCompleted) {
    appContext.logger.info(`   ℹ️ Auto-resuming orchestrator...`);
    
    appContext.orchestrator.processRequest(request).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request auto-resumed: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error in auto-resume: ${err.message}`);
      },
      complete: () => {
        lock.release();  // Release lock when orchestrator finishes
        appContext.logger.info(`[LOCK-RELEASED] RequestId: ${requestId}`);
      }
    });
  } else {
    lock.release();  // Release lock if no auto-resume needed
    appContext.logger.info(`[LOCK-RELEASED] RequestId: ${requestId}`);
  }
} catch (error) {
  lock.release();  // Always release on error
  throw error;
}
```

---

## Benefits

✅ **Sequential Execution** - No concurrent modification of same request  
✅ **Parallel Processing** - Multiple requests process independently  
✅ **Auto-Progression** - Orchestrator flows through envelopes automatically  
✅ **Clean Logs** - Sequential, non-interleaved output  
✅ **Dev Tool** - `/resume` endpoint still available for manual control  
✅ **Race Condition Prevention** - Queue handles simultaneous events  
✅ **Observable** - Lock acquisition/release logged for debugging  

---

## Testing Scenarios

**Scenario 1: Multiple Approvals Simultaneously**
- 3 approvers approve at same time
- First approval acquires lock
- Second & third queued
- When first finishes, orchestrator resumes automatically
- Logs show sequential processing

**Scenario 2: Concurrent Requests**
- 5 students submit requests simultaneously
- Each gets own lock (req-001, req-002, req-003, req-004, req-005)
- All process in parallel without interference
- Logs from each request separated by requestId

**Scenario 3: Payment Callback During Approval**
- Approver completes while payment callback arrives
- Approver: acquires lock, orchestrator starts processing
- Callback: queued until approval's orchestrator finishes
- Clean sequential progression

---

## Migration from Previous State

**Before (Problematic)**:
```typescript
// Multiple subscribe() calls causing concurrent execution
appContext.orchestrator.processRequest(request).subscribe({...});
```

**After (With Lock)**:
```typescript
// Single orchestrator instance at a time
const lock = await appContext.requestProcessingLock.acquire(requestId);
appContext.orchestrator.processRequest(request).subscribe({
  complete: () => lock.release()
});
```

---

## Configuration

Lock manager is stateless and requires no configuration. However, logs can be controlled via Winston logger settings:

```typescript
// In server.ts initialization
const requestProcessingLock = new RequestProcessingLock(logger);
appContext.requestProcessingLock = requestProcessingLock;
```

---

## Monitoring & Debugging

To track lock behavior in production:

1. **Lock Duration**: Check logs for [LOCK-ACQUIRED] → [LOCK-RELEASED] timing
2. **Queue Depth**: Logs show "queued X calls" when releasing
3. **Request State**: Compare orchestrator logs with lock release times
4. **Performance**: Long lock durations indicate slow orchestrator processing

Example monitoring:
```
[LOCK-ACQUIRED] req-001 | 14:32:15.234
  (orchestrator processing...)
[LOCK-RELEASED] req-001 | 14:32:18.567 | Duration: 3.3s | Queued: 2
```

---

## Future Enhancements

- [ ] Timeout for stuck locks (auto-release after N seconds)
- [ ] Metrics/stats on lock contention
- [ ] Lock history per request for debugging
- [ ] Configurable log level for lock operations
