# Bin and Device APIs: Implementation Plan

Date: 2026-04-17
Scope: Plan implementation for Bin CRUD, Device CRUD, and bin-device assignment history APIs in current FastAPI backend.

## 1. Current Codebase Context (validated)

1. Existing API pattern

- Versioned routes under `app/api/v1` with per-domain router files.
- Dependency injection style: `AsyncSession = Depends(get_db)` and role guards from `app/api/deps/auth.py`.
- Service functions hold DB logic (example: `app/services/telemetry.py`).

2. Existing tables relevant to this scope

- `bins`
- `bin_devices`
- `bin_device_history`

3. Existing model mismatch that must be fixed first

- Migration `20260417_01_core_master_data.py` defines many fields on `bins` and `bin_devices` plus full `bin_device_history`.
- ORM class `Bin` in `app/models/iot.py` currently contains only a subset of `bins` columns.
- ORM class `BinDevice` in `app/models/iot.py` currently contains only a subset of `bin_devices` columns.
- `BinDeviceHistory` ORM model does not exist yet in `app/models/iot.py`.

This mismatch is a blocker for robust CRUD and list/search features and should be addressed before route implementation.

## 2. Target API Surface

## 2.1 Bin APIs

- `POST /api/v1/bins`
  - Create a bin in caller organization.
  - Auth: authority roles only.

- `GET /api/v1/bins/{bin_id}`
  - Fetch one bin by numeric id (org-scoped).
  - Auth: authority or driver (read-only).

- `PATCH /api/v1/bins/{bin_id}`
  - Partial update of mutable bin fields.
  - Auth: authority roles only.

- `POST /api/v1/bins/{bin_id}/deactivate`
  - Soft deactivate (`is_active=false`, `status=inactive`).
  - Auth: authority roles only.

- `GET /api/v1/bins`
  - List bins with filters and pagination.
  - Auth: authority or driver.

- `GET /api/v1/bins/search`
  - Search by bin code/display name/address with optional status filters.
  - Auth: authority or driver.

## 2.2 Device APIs

- `POST /api/v1/devices`
  - Create/register device and optionally attach to bin.
  - Auth: authority roles only.

- `GET /api/v1/devices/{device_id}`
  - Fetch one device.
  - Auth: authority or driver.

- `PATCH /api/v1/devices/{device_id}`
  - Partial update (firmware, status, mqtt id if allowed by policy, etc.).
  - Auth: authority roles only.

- `POST /api/v1/devices/{device_id}/deactivate`
  - Soft decommission device.
  - Auth: authority roles only.

- `GET /api/v1/devices`
  - List devices with filters (status, bin_id, org_id implicit, last_seen range).
  - Auth: authority or driver.

- `GET /api/v1/devices/search`
  - Search by `device_uid` or `mqtt_client_id`.
  - Auth: authority or driver.

## 2.3 Assignment History APIs

- `POST /api/v1/devices/{device_id}/assign`
  - Assign or reassign device to a bin.
  - Closes previous active history row and opens new history row.
  - Auth: authority roles only.

- `GET /api/v1/bins/{bin_id}/assignments`
  - Bin assignment history (latest first).
  - Auth: authority or driver.

- `GET /api/v1/devices/{device_id}/assignments`
  - Device assignment history (latest first).
  - Auth: authority or driver.

## 3. Data Contracts (Pydantic)

Add new schema modules:

- `app/schemas/bin.py`
- `app/schemas/device.py`

Suggested models:

- `BinCreateRequest`
- `BinUpdateRequest`
- `BinResponse`
- `BinListResponse`
- `BinSearchResponse`
- `DeviceCreateRequest`
- `DeviceUpdateRequest`
- `DeviceResponse`
- `DeviceListResponse`
- `AssignmentCreateRequest`
- `AssignmentHistoryItem`
- `AssignmentHistoryResponse`

Validation rules:

- `threshold_green < threshold_yellow`
- `distance_factor` in [0, 1]
- Non-empty `bin_code`, `device_uid`, `mqtt_client_id`
- Update schemas use optional fields and reject empty PATCH payloads

## 4. Service Layer Design

Add domain services:

- `app/services/bins.py`
- `app/services/devices.py`
- `app/services/assignments.py`

Service responsibilities:

- Org-scoped read/write queries.
- Unique constraint checks with user-friendly errors.
- Soft-delete/deactivate semantics.
- Assignment transaction semantics:
  - ensure at most one active history row per device
  - close previous row with `active_to=now`
  - update `bin_devices.bin_id`
  - create new `bin_device_history` row
- Shared pagination helper and consistent response structures.

## 5. Route Layer Design

Add route files:

- `app/api/v1/bins.py`
- `app/api/v1/devices.py`

Router registration:

- Update `app/api/v1/__init__.py` to include new routers.

Error mapping pattern:

- `ValueError` -> 400 or 404 depending on reason.
- `PermissionError` -> 403.
- DB integrity conflict (unique) -> 409.

## 6. Model and Migration Alignment Work

Before API implementation, align ORM to current migration shape.

Required updates in `app/models/iot.py`:

- Expand `Bin` with missing fields defined in migration (display/address/area/depot/location/capacity/geometry/factors/audit/is_active).
- Expand `BinDevice` with firmware/hardware/install/decommission fields.
- Add `BinDeviceHistory` model class.

If any migration-table drift exists beyond ORM:

- Add a new migration only if DB schema needs change.
- If DB schema is correct already, only ORM class alignment is needed.

## 7. Authorization and Tenant Scoping

Use existing dependencies:

- write operations: `require_authority_user`
- read operations: `require_authority_or_driver_user`

Enforce org boundary on every read/write:

- filter by `org_id == auth_user.org_id` for bins and related joins.
- for devices, join through bin and enforce same org.

## 8. Testing Plan

Add test module(s):

- `tests/test_bin_device_routes.py`

Minimum route-contract coverage:

- bin create success and duplicate conflict
- bin list with filters and pagination
- bin update and deactivate
- device create success and duplicate conflict
- device assign/reassign writes history transitions
- assignment history endpoints return ordered records
- auth: 401 without token, 403 with wrong role
- org isolation: cannot access cross-org bin/device by id

Use existing testing style:

- `httpx.AsyncClient` with dependency overrides for auth.
- `AsyncMock` patching for first-pass contract tests.

Follow-up integration tests:

- real DB-backed tests for assignment transaction behavior.

## 9. Phased Delivery Plan

Phase A: Foundation alignment

1. Align ORM models with migration schema.
2. Add schema modules for bins/devices/assignments.
3. Add service skeletons and shared helpers.

Phase B: Bin APIs

1. Implement create/get/update/deactivate/list/search service functions.
2. Implement `app/api/v1/bins.py`.
3. Add route-contract tests for bin endpoints.

Phase C: Device APIs

1. Implement create/get/update/deactivate/list/search service functions.
2. Implement `app/api/v1/devices.py`.
3. Add route-contract tests for device endpoints.

Phase D: Assignment history APIs

1. Implement assignment transaction flow and history readers.
2. Add assignment endpoints in `devices.py` and/or dedicated assignment router.
3. Add route-contract + integration tests for history transitions.

Phase E: Hardening

1. Add conflict/error normalization.
2. Add query performance checks and indexes validation.
3. Update status docs.

## 10. Open Decisions (confirm before coding)

1. Primary identifier policy for external API

- Keep numeric `id` in path or prefer `bin_code`/`device_uid` path variants.

2. Device lifecycle semantics

- On deactivate, should current assignment remain open or be auto-closed.

3. Search API shape

- Separate `/search` endpoints vs query param on list endpoint.

4. Role permissions

- Confirm if driver should have read access to all org bins/devices or only assigned route scope (future).

## 11. Suggested Immediate Next Execution

1. Implement Phase A (ORM alignment + new schemas) first.
2. Then implement Bin APIs end-to-end with tests.
3. Then implement Device + assignment APIs with tests.

This sequence minimizes rework because ingestion, telemetry, and new CRUD routes will all share the same corrected ORM model definitions.
