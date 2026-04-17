# Collection Operations: Gap Analysis and Implementation Plan

Date: 2026-04-17
Scope: Vehicles, shifts, route planning, route assignments, and stop updates.

## 1. Executive Summary

Collection operations schema exists in DB migration `20260417_03_operations_prediction_audit.py`, but the backend application layer for that domain is mostly missing.

Current state in codebase:

- Database tables exist for operations.
- No operations routers are registered in API v1.
- No operations service modules exist.
- No operations schemas exist.
- No operations route-contract tests exist.

Primary risk:

- You have data structures ready for operations but no API control plane to schedule, assign, execute, and track collection runs safely and consistently.

## 2. What Exists vs What Is Missing

### 2.1 Database Schema Exists (Good)

Migration includes:

- `vehicles`
- `driver_shifts`
- `routes`
- `route_assignments`
- `route_stops`
- `collection_events`

Reference:

- `backend/alembic/versions/20260417_03_operations_prediction_audit.py`

### 2.2 Application Models Missing (Critical Gap)

`app/models/iot.py` currently contains IoT + auth + telemetry + alerts models only.
No ORM classes for:

- `Vehicle`
- `DriverShift`
- `Route`
- `RouteAssignment`
- `RouteStop`
- `CollectionEvent`

Impact:

- No type-safe ORM access for operations tables.
- No reusable domain logic without raw SQL.
- No export visibility in `app/models/__init__.py`.

References:

- `backend/app/models/iot.py`
- `backend/app/models/__init__.py`

### 2.3 API Route Surface Missing (Critical Gap)

API v1 router currently includes:

- health, mqtt, telemetry, alerts, auth, users, bins, devices

No operations routers are included.

Reference:

- `backend/app/api/v1/__init__.py`

Status document already flags this:

- "Collection operations routes (vehicles, shifts, route planning, route assignments, stop updates)."

Reference:

- `backend/ROUTES_IMPLEMENTATION_STATUS.md`

### 2.4 Service Layer Missing (Critical Gap)

No service modules for operations workflows:

- vehicle lifecycle
- shift scheduling and transitions
- route planning and publication
- assignment acceptance/rejection
- stop execution updates

Current services are auth/bin/device/assignment/telemetry/alerts/mqtt only.

Reference:

- `backend/app/services/`

### 2.5 Request/Response Schemas Missing (High Gap)

No schemas for operations payloads and responses.

Current schema modules include only auth/bin/device/alerts/mqtt/users/health.

Reference:

- `backend/app/schemas/`

### 2.6 Tests Missing (Critical Gap)

No tests for operations endpoints, workflow transitions, or role-based access.

Current tests cover auth/bins/devices/alerts/mqtt/telemetry only.

Reference:

- `backend/tests/`

## 3. Critical Business Gaps to Resolve

### 3.1 Start Point Determination for Driver Journey (Critical)

Problem:

- No implemented logic defines run start point per shift/route.

Schema hints available:

- Driver profile `home_depot_id` exists (migration 01).
- Route has `depot_id`.
- Bin has `depot_id` and `area_id`.
- Service area has center coordinates and boundary geojson.

Decision rule needed (recommended baseline):

1. Use route `depot_id` when set.
2. Else use assigned driver `home_depot_id`.
3. Else use dominant depot among route bins.
4. Else fallback to service-area center.
5. Else fail planning with explicit validation error.

This directly addresses your operational concern: where drivers start their journey.

### 3.2 Missing Workflow State Machines (Critical)

Required state transitions are not implemented:

- Shift: `scheduled -> started -> completed` (and cancellation path)
- Route: `draft -> published -> in_progress -> completed` (and cancellation path)
- Assignment: `assigned -> accepted|rejected -> reassigned`
- Stop: `pending -> arrived -> serviced|skipped`

Without enforced transitions, data consistency and auditability are weak.

### 3.3 Missing Route Planning Contract (Critical)

No endpoint/service to:

- create route drafts from candidate bins
- sequence stops
- estimate distance/time
- bind start point and planned ETAs

Even manual operations need this baseline contract before optimization features.

### 3.4 Missing Stop Update and Collection Evidence Contract (Critical)

No endpoint to update stop execution and write `collection_events` consistently.

Must include:

- actual arrival/departure
- event type (`arrived`, `emptied`, `skipped`, etc.)
- optional proof (`photo_url`, notes, GPS)
- fill-before/fill-after where available

### 3.5 Missing Access-Control Matrix for Operations (Critical)

Roles exist, but operations permissions are not implemented.

Recommended baseline:

- authority_admin/operator: full create/update/assign/publish/override
- driver: read assigned shifts/routes/stops; update own stop execution; accept/reject own assignment

## 4. Secondary but Important Gaps

### 4.1 Tenant Boundary Enforcement Pattern for Operations

Org scoping exists in bins/devices/users/alerts services, but must be replicated for operations services and joins.

### 4.2 Idempotency and Concurrency

Stop updates and assignment responses need idempotency keys or optimistic checks to prevent double writes from mobile retries.

### 4.3 Operational Telemetry

No metrics for:

- route plan generation duration
- assignment acceptance latency
- stop execution throughput
- exception rates

### 4.4 Audit Integration

`audit_logs` table exists but operations actions are not writing to it.

## 5. Proposed API Surface (Phase 1 Scope)

### 5.1 Vehicles

- `POST /api/v1/operations/vehicles`
- `GET /api/v1/operations/vehicles`
- `GET /api/v1/operations/vehicles/{vehicle_id}`
- `PATCH /api/v1/operations/vehicles/{vehicle_id}`
- `POST /api/v1/operations/vehicles/{vehicle_id}/deactivate`

### 5.2 Driver Shifts

- `POST /api/v1/operations/shifts`
- `GET /api/v1/operations/shifts`
- `GET /api/v1/operations/shifts/{shift_id}`
- `POST /api/v1/operations/shifts/{shift_id}/start`
- `POST /api/v1/operations/shifts/{shift_id}/complete`

### 5.3 Route Planning + Routes

- `POST /api/v1/operations/routes/plan`
- `POST /api/v1/operations/routes`
- `GET /api/v1/operations/routes`
- `GET /api/v1/operations/routes/{route_id}`
- `POST /api/v1/operations/routes/{route_id}/publish`

### 5.4 Route Assignments

- `POST /api/v1/operations/routes/{route_id}/assignments`
- `GET /api/v1/operations/routes/{route_id}/assignments`
- `POST /api/v1/operations/assignments/{assignment_id}/accept`
- `POST /api/v1/operations/assignments/{assignment_id}/reject`

### 5.5 Stop Updates + Collection Events

- `GET /api/v1/operations/routes/{route_id}/stops`
- `POST /api/v1/operations/stops/{stop_id}/arrive`
- `POST /api/v1/operations/stops/{stop_id}/service`
- `POST /api/v1/operations/stops/{stop_id}/skip`

## 6. File-Level Implementation Plan

### 6.1 Models

Update `backend/app/models/iot.py` with:

- `Vehicle`
- `DriverShift`
- `Route`
- `RouteAssignment`
- `RouteStop`
- `CollectionEvent`

Update exports in `backend/app/models/__init__.py`.

### 6.2 Schemas

Add:

- `backend/app/schemas/operations_vehicle.py`
- `backend/app/schemas/operations_shift.py`
- `backend/app/schemas/operations_route.py`
- `backend/app/schemas/operations_assignment.py`
- `backend/app/schemas/operations_stop.py`

Update `backend/app/schemas/__init__.py` exports.

### 6.3 Services

Add:

- `backend/app/services/operations_vehicles.py`
- `backend/app/services/operations_shifts.py`
- `backend/app/services/operations_routes.py`
- `backend/app/services/operations_assignments.py`
- `backend/app/services/operations_stops.py`

Include shared helper:

- org scoping helpers
- start-point resolver
- transition validators

### 6.4 Routes

Add:

- `backend/app/api/v1/operations.py`

Register in:

- `backend/app/api/v1/__init__.py`

### 6.5 Tests

Add contract tests:

- `backend/tests/test_operations_vehicle_shift_routes.py`
- `backend/tests/test_operations_assignments_stops.py`

Add service-level workflow tests for transitions and scoping.

## 7. Phased Delivery Sequence

### Phase A - Foundation (must-do first)

1. Add operations ORM models + exports.
2. Add operations schemas.
3. Add start-point resolver and transition enums/helpers.

### Phase B - Core CRUD and Scheduling

1. Vehicle endpoints.
2. Shift create/list/start/complete endpoints.

### Phase C - Route Planning and Assignment

1. Route draft/create/plan/publish.
2. Assignment create/accept/reject.

### Phase D - Stop Execution

1. Stop status updates.
2. Collection event writes.
3. Driver-scoped access checks.

### Phase E - Hardening

1. Idempotency for stop updates.
2. Audit log writes for operations actions.
3. Metrics and alerting hooks.
4. Integration tests (end-to-end route execution).

## 8. Acceptance Criteria (Minimum for "Operationally Usable")

- Start point is deterministically resolved for every published route.
- Every assignment has valid lifecycle transitions.
- Drivers can only mutate their assigned runs/stops.
- Stop updates create both status changes and `collection_events`.
- All operations reads/writes are org-scoped.
- Route-contract tests pass for all operations endpoints.

## 9. Immediate Next Step Recommendation

Start with Phase A + Phase B in one implementation batch to unblock real scheduling workflows quickly.
That gives practical value early while keeping risk controlled.
