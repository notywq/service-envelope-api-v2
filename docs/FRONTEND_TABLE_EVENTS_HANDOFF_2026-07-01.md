# Frontend Handoff: Paginated Table Events

Date: 2026-07-01

## Backend Contract

Paginated table endpoints now include a cache validation signal:

```json
{
  "requests": [],
  "total": 90,
  "count": 20,
  "limit": 20,
  "offset": 0,
  "hasMore": true,
  "nextOffset": 20,
  "meta": {
    "version": "requests:1720000000000:1"
  }
}
```

Implemented resources:

- `GET /api/requests` returns `meta.version` for `requests`
- `GET /api/services` returns `meta.version` for `services`
- `GET /api/services/ids` returns `meta.version` for `services`
- `GET /api/admin/services` returns `meta.version` for `services`

## SSE Endpoint

Listen on:

```http
GET /api/table-events
Authorization: Bearer <token>
Accept: text/event-stream
```

Events are emitted as plain SSE `data:` messages:

```json
{
  "resource": "requests",
  "event": "updated",
  "version": "requests:1720000000000:2",
  "ids": ["REQ-20260701-001"]
}
```

`resource` is one of:

- `requests`
- `services`

`event` is one of:

- `created`
- `updated`
- `deleted`
- `changed`

The version string should be treated as opaque. Compare it for equality only.

## Frontend Usage

Cache paginated pages by resource and query params, including `limit`, `offset`, filters, and sorting if present.

When an SSE event arrives:

- If `event.resource === "requests"`, invalidate request table queries whose cached `meta.version` differs from the event `version`.
- If `event.resource === "services"`, invalidate services table queries whose cached `meta.version` differs from the event `version`.
- Use `ids` for optional row-level optimistic updates, but still refetch affected table pages because totals and pagination can shift.

Native browser `EventSource` cannot send an `Authorization` header. Use an SSE helper that supports headers, such as a fetch-based event source, when `AUTH_REQUIRED=true`.
