# Smart Waste Backend: Routes and Functionality Status

Date: 2026-04-17
Scope: Current implementation status for API routes, related service behavior, and remaining gaps.

## 1. Current API Route Surface

| Method | Path                                             | Auth                      | Purpose                                         |
| ------ | ------------------------------------------------ | ------------------------- | ----------------------------------------------- |
| GET    | /api/v1/health                                   | No                        | Basic health status with app version            |
| GET    | /api/v1/health/live                              | No                        | Liveness probe                                  |
| GET    | /api/v1/health/ready                             | No                        | Readiness probe                                 |
| POST   | /api/v1/auth/login                               | No                        | Login and access/refresh token issue            |
| POST   | /api/v1/auth/refresh                             | No                        | Access token refresh from refresh token         |
| POST   | /api/v1/auth/drivers                             | Yes (authority only)      | Create driver user in caller organization       |
| GET    | /api/v1/users                                    | Yes (authority only)      | List users with filters/pagination              |
| GET    | /api/v1/users/{user_id}                          | Yes (authority only)      | Read one user                                   |
| POST   | /api/v1/users/{user_id}/roles/add                | Yes (authority only)      | Explicitly add role(s) to one user              |
| POST   | /api/v1/users/{user_id}/roles/remove             | Yes (authority only)      | Explicitly remove role(s) from one user         |
| POST   | /api/v1/users/{user_id}/deactivate               | Yes (authority only)      | Soft deactivate one user                        |
| POST   | /api/v1/users/{user_id}/password/reset           | Yes (authority only)      | Reset one user password                         |
| POST   | /api/v1/mqtt/ingest                              | Yes (X-API-Key required)  | Ingest one MQTT envelope and trigger evaluation |
| POST   | /api/v1/bins                                     | Yes (authority only)      | Create one bin                                  |
| GET    | /api/v1/bins                                     | Yes (authority or driver) | List bins with filters/pagination               |
| GET    | /api/v1/bins/search                              | Yes (authority or driver) | Search bins by code/name/address                |
| GET    | /api/v1/bins/{bin_id}                            | Yes (authority or driver) | Read one bin                                    |
| PATCH  | /api/v1/bins/{bin_id}                            | Yes (authority only)      | Update one bin                                  |
| POST   | /api/v1/bins/{bin_id}/deactivate                 | Yes (authority only)      | Soft deactivate one bin                         |
| GET    | /api/v1/bins/{bin_id}/assignments                | Yes (authority or driver) | Bin-device assignment history for one bin       |
| POST   | /api/v1/devices                                  | Yes (authority only)      | Create one device                               |
| GET    | /api/v1/devices                                  | Yes (authority or driver) | List devices with filters/pagination            |
| GET    | /api/v1/devices/search                           | Yes (authority or driver) | Search devices by uid/client id                 |
| GET    | /api/v1/devices/{device_id}                      | Yes (authority or driver) | Read one device                                 |
| PATCH  | /api/v1/devices/{device_id}                      | Yes (authority only)      | Update one device                               |
| POST   | /api/v1/devices/{device_id}/deactivate           | Yes (authority only)      | Soft deactivate one device                      |
| POST   | /api/v1/devices/{device_id}/assign               | Yes (authority only)      | Assign/reassign device to bin                   |
| GET    | /api/v1/devices/{device_id}/assignments          | Yes (authority or driver) | Assignment history for one device               |
| GET    | /api/v1/alerts                                   | Yes (authority or driver) | List/filter alerts                              |
| GET    | /api/v1/alerts/{alert_id}                        | Yes (authority or driver) | Read one alert                                  |
| POST   | /api/v1/alerts/{alert_id}/acknowledge            | Yes (authority or driver) | Acknowledge one alert                           |
| POST   | /api/v1/alerts/{alert_id}/resolve                | Yes (authority or driver) | Resolve one alert                               |
| POST   | /api/v1/alerts/{alert_id}/assign                 | Yes (authority or driver) | Assign/unassign one alert                       |
| GET    | /api/v1/alerts/{alert_id}/events                 | Yes (authority or driver) | Alert lifecycle event history                   |
| GET    | /api/v1/telemetry/bins/{bin_code}/latest         | Yes (authority or driver) | Latest computed state for one bin               |
| GET    | /api/v1/telemetry/bins/{bin_code}/history?limit= | Yes (authority or driver) | Recent telemetry points for one bin             |
| GET    | /api/v1/telemetry/live/summary                   | Yes (authority or driver) | Aggregate live counters for dashboard           |

## 2. Implemented Functionalities (with explanation)

### 2.1 Health Routes

- Returns standard health payload for uptime monitoring and API checks.
- Separate live and ready probes are available for deployment/runtime checks.

### 2.2 MQTT Ingestion Route

The `POST /api/v1/mqtt/ingest` route is implemented with full service-layer processing:

0. Route access guard

- Requires `X-API-Key` header matched against backend config (`mqtt_ingest_api_key`).

1. Topic parsing and validation

- Accepts only topics shaped like `smartbin/{bin_token}/data` or `smartbin/{bin_token}/alert`.
- Rejects unsupported topic structures with HTTP 400.

2. Bin/device resolution

- Resolves bin by `bin_devices.mqtt_client_id` first, then by `bins.bin_code`.
- Rejects messages when token cannot map to a known bin.

3. Raw message persistence

- Stores each incoming message in `mqtt_raw_messages` with metadata:
  - `topic`, `qos`, `retain`, `payload_json`, `received_at`, hash, parse status.

4. Data channel normalization (`.../data`)

- Extracts telemetry fields (`fill_pct`, `fill_rate`, `ttf_min`, `priority`, `alert`, `overflow_imminent`, `queued`).
- Handles timestamp inference (`unix_s`, `unix_ms`, `uptime_s`, `unknown`).
- Inserts normalized record into `bin_telemetry`.
- Upserts snapshot row in `bin_current_state`.

5. Alert evaluation

- Threshold alerts: opens/updates/resolves `fill_threshold` alert based on GREEN/YELLOW/RED.
- Overflow alerts: opens/updates/resolves `overflow_imminent` based on flag.
- Writes lifecycle events into `alert_events`.

6. Alert channel handling (`.../alert`)

- Connectivity mode: accepts status `online/offline`, writes `connectivity_events`, updates current connectivity state, opens/resolves `device_offline` alert.
- Alert-level mode: accepts GREEN/YELLOW/RED and updates threshold alert lifecycle.
- Unknown alert payloads are stored as partial parse, not discarded.

### 2.3 Telemetry Query Routes

- `latest`: returns computed snapshot from `bin_current_state`.
- `history`: returns descending telemetry points from `bin_telemetry` with safe limit bounds (1-1000).
- `live/summary`: returns aggregate counters:
  - total bins, bins with state, red bins, yellow bins, overflow-imminent bins, offline bins, open alerts.

### 2.4 Auth and Role Guards

Implemented dependency-based JWT guard flow:

- Parses bearer token and verifies signature using configured security settings.
- Resolves user by `user_id`, `email`, or `auth_subject` from token claims.
- Loads role keys from `user_roles` + `roles`.
- Enforces role access for telemetry routes:
  - authority_admin
  - authority_operator
  - driver

### 2.5 Background Functionalities Supporting Route Behavior

1. MQTT consumer worker

- Auto-subscribes to configured topic patterns when enabled.
- Forwards broker messages into same ingestion pipeline used by API route.
- Uses thread-safe scheduling onto the app event loop (cross-loop asyncpg crash fix applied).

2. Stale bin checker

- Runs periodically.
- Opens `device_offline` alerts when telemetry inactivity crosses configured threshold.
- Resolves offline alerts when telemetry resumes.

### 2.6 Bin, Device, and Assignment APIs

- Bin CRUD routes are implemented for create/list/search/get/update/deactivate.
- Device CRUD routes are implemented for create/list/search/get/update/deactivate.
- Assignment endpoints are implemented:
  - assign/reassign device to bin
  - list bin assignment history
  - list device assignment history
- Organization scoping is enforced in service-layer queries for these resources.

### 2.7 Auth Management Routes

- `POST /api/v1/auth/login` implemented for driver, authority_operator, and authority_admin.
- `POST /api/v1/auth/refresh` implemented for refresh-token based access token renewal.
- `POST /api/v1/auth/drivers` implemented for authority roles to create driver users and assign `driver` role.

### 2.8 User Administration Routes

- User administration routes are implemented:
  - list users
  - get one user
  - explicit role add
  - explicit role remove
  - user deactivate
  - user password reset (admin/operator initiated)
- Authority roles (`authority_admin` and `authority_operator`) share the same access level for these routes.
- Explicit safeguards are included to prevent removal/deactivation of the last `authority_admin` user in an organization.

### 2.9 Alert Management Routes

- Alert management routes are implemented for list/get/acknowledge/resolve/assign/events.
- Drivers are allowed to perform alert actions with service-layer scope checks.
- Manual alert actions append `alert_events` entries with `actor_user_id` for auditability.

### 2.10 Current Test Coverage (implemented)

- Route-contract tests for:
  - MQTT ingest success response
  - telemetry latest response
  - telemetry summary response
  - telemetry auth rejection when no credentials
  - auth login response contract
  - auth refresh response contract
  - driver creation response contract
  - auth guard rejection for driver creation
  - bin route contracts (create/list)
  - assignment route contract (assign device)
  - user list response contract
  - explicit role add response contract
  - password reset response contract
  - alert list response contract
  - alert acknowledge response contract
  - alert assign forbidden contract (driver scope violation)

## 3. Known Remaining Gaps / Missing Functionalities

### 3.1 Route Surface Gaps

Not yet exposed as API endpoints:

- Collection operations routes (vehicles, shifts, route planning, route assignments, stop updates).
- Prediction/optimization routes (forecasts, optimization runs, model controls).
- Audit log query routes.

### 3.2 Security and Access Control Gaps

- MQTT ingest route is intentionally open right now (no auth/API key/signature guard).
- Route-level organization scoping and tenant boundary checks are not fully enforced across all potential resources.

### 3.3 Data and Query Gaps

- Telemetry queries do not yet support rich filters (time window, from/to, area, paging cursor, org-level rollups).
- No explicit duplicate-message idempotency policy for repeated broker deliveries beyond raw hash storage.

### 3.4 Operational and Reliability Gaps

- Lifespan event migration pending (`on_event` startup/shutdown currently used and deprecated).
- No dedicated dead-letter/retry policy and no explicit ingestion backpressure controls.
- No formal metrics endpoint/log correlation/tracing for ingestion latency and failure diagnostics.

### 3.5 Testing Gaps

- No full integration test that publishes MQTT to broker and asserts DB persistence end-to-end.
- No focused automated tests yet for stale checker behavior (`run_once`) with stale/fresh transitions.
- No high-volume/performance benchmark tests integrated into CI.

## 4. Current Readiness Notes

What is working now:

- Core route set for health, ingestion, telemetry reads, bin/device CRUD, and assignment history.
- Auth routes for login, refresh token, authority-driven driver creation, and user administration workflows.
- Alert management routes for operational lifecycle actions and event history.
- Alert lifecycle updates from ingestion.
- Role-guarded telemetry routes.
- MQTT worker loop scheduling fix for async loop safety.

What still needs completion for production readiness:

- Broader route coverage for operations and admin workflows.
- Stronger ingest security.
- End-to-end broker + DB automated test coverage.
- Observability and reliability hardening.
