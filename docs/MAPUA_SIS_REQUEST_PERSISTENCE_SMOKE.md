# MAPUA SIS Request Persistence Smoke

## Purpose

The MAPUA SIS orchestrator now includes a Service Envelope request persistence smoke for the applicant-facing request-submission slice.

This is intentionally API-level proof. It confirms that MAPUA SIS can submit a real Service Envelope request and read it back through the running Service Envelope API.

## Command

Run from `C:\FOWL_STUDIOS\PROJECTS\MAPUA\MINERVA-ORCHESTRATOR`:

```powershell
npm run api:smoke:service-envelope -- --dry-run --summary
npm run api:smoke:service-envelope -- --execute --summary
```

## Latest Proof

- Dry-run: `3/3` checks passing.
- Execute: `7/7` checks passing.
- Latest smoke request: `REQ-20260705-217`.
- Service: `SERV-AV-RESERVATION` / `av-room-reservation`.

## Covered API Behavior

- `GET /health`
- `GET /api/services/{serviceId}`
- `POST /api/requests`
- `GET /api/requests/{requestId}`
- `GET /api/requests/{requestId}/history`
- `GET /api/requests?type={type}&limit=100`

The smoke uses requester-role access for submit/detail/history and orchestrator-role access for list readback.

## Boundaries

- The smoke uses a no-payment service so it stays separate from MAPUA TOS payment and receipt persistence.
- Persistence is Mongo-backed through the Service Envelope state manager.
- Browser UX, delivery completion, approval completion, and feedback completion are not proven by this smoke.
