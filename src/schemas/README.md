# Schemas Source of Truth

## Canonical Schema
- `service-definition.schema.json` is the canonical schema for service definitions.
- Runtime validation uses the latest schema version stored in MongoDB (`SchemaVersion` collection).
- Local file `src/schemas/service-definition.schema.json` is the canonical file used for seeding/uploading new schema versions.

## Runtime Usage Flow
1. Server starts (`src/api/server.ts`).
2. Backend ensures target schema version exists in MongoDB.
3. Backend loads the latest schema from MongoDB.
4. AJV validator is initialized via `initializeValidator()` using that schema.
5. Admin routes validate service definitions using the active validator.

## Schema Management Endpoints
- `POST /api/admin/schema/upload`: upload a schema version and activate it.
- `GET /api/admin/schema`: fetch latest schema for UI/builder.
- `GET /api/admin/schema/versions`: list versions.
- `GET /api/admin/schema/versions/latest`: fetch latest version metadata.
- `POST /api/admin/schema/reload`: reload validator from latest Mongo schema.

## Deprecated
- `service-request.schema.json` was removed because it was not wired into runtime validation and had become redundant with the canonical schema flow.
