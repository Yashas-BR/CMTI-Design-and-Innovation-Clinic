# Smart Waste Dashboard — Backend API Route Document

**Version:** 1.0  
**Base URL:** `http://<host>/api/v1`  
**API Prefix set in backend config:** `/api/v1`  
**Interactive Docs:** `http://<host>/docs` (Swagger UI)  
**OpenAPI JSON:** `http://<host>/openapi.json`

---

## Table of Contents

1. [Authentication Model](#1-authentication-model)
2. [Roles Reference](#2-roles-reference)
3. [Common Conventions](#3-common-conventions)
4. [Health Check Routes](#4-health-check-routes) — _Public_
5. [Auth Routes](#5-auth-routes) — _Mixed_
6. [User Management Routes](#6-user-management-routes) — _Authority Only_
7. [Master Data Routes](#7-master-data-routes) — _Authority Only_
   - 7A. Depots
   - 7B. Service Areas
   - 7C. Driver Profiles
8. [Bin Routes](#8-bin-routes) — _Authority + Driver (read)_
9. [Device Routes](#9-device-routes) — _Authority + Driver (read)_
10. [Telemetry Routes](#10-telemetry-routes) — _Authority + Driver_
11. [Alert Routes](#11-alert-routes) — _Authority + Driver_
12. [Operations Routes](#12-operations-routes)
    - 12A. Vehicles — _Authority Only_
    - 12B. Shifts — _Authority + Driver_
    - 12C. Route Planning — _Authority Only_
    - 12D. Routes — _Authority Only / + Driver for progression_
    - 12E. Route Assignments — _Authority + Driver_
    - 12F. Route Stops — _Authority + Driver_
13. [Analytics Routes](#13-analytics-routes) — _Authority Only_
14. [Notification Routes](#14-notification-routes) — _Authority + Driver_
15. [Realtime Channels](#15-realtime-channels) — _Authority + Driver_
16. [MQTT Ingest Route](#16-mqtt-ingest-route) — _API Key Protected_
17. [Error Codes Reference](#17-error-codes-reference)
18. [Integration Workflow Guide](#18-integration-workflow-guide)

---

## 1. Authentication Model

All protected routes require a **Bearer JWT access token** in the `Authorization` header.

```
Authorization: Bearer <access_token>
```

**Token Lifecycle:**

1. Login → receive `access_token` + `refresh_token`
2. Use `access_token` for all API calls
3. When `access_token` expires → call `/api/v1/auth/refresh` with `refresh_token`
4. A new `access_token` is returned (along with a new `refresh_token`)

**MQTT Ingest Exception:** Uses a special `X-API-Key` header instead of Bearer JWT.

---

## 2. Roles Reference

| Role Key             | Description                      | Access Level                     |
| -------------------- | -------------------------------- | -------------------------------- |
| `authority_admin`    | Full admin of the organization   | Highest — all routes             |
| `authority_operator` | Operator within the organization | Same as admin for most routes    |
| `driver`             | Field driver                     | Limited read + own-scope actions |

> **Note:** `authority_admin` and `authority_operator` are treated identically (both called "authority user") for route access. The only distinction is the last-admin guard preventing removal of the last `authority_admin`.

---

## 3. Common Conventions

### Pagination

All list endpoints support:
| Parameter | Type | Default | Range | Description |
|---|---|---|---|---|
| `limit` | int | 50 | 1–100 | Max items per page |
| `offset` | int | 0 | ≥0 | Number of items to skip |

All paginated responses return:

```json
{
  "total": 120,
  "limit": 50,
  "offset": 0,
  "items": [...]
}
```

### Datetime Format

All datetime values use ISO 8601 format: `"2026-04-17T10:30:00"` or with timezone `"2026-04-17T10:30:00+05:30"`

### Date Format

Date-only fields use: `"2026-04-17"`

### PATCH Semantics

All `PATCH` endpoints support **partial updates** — only send the fields you want to change.  
At least one field must be provided, otherwise a `400 Bad Request` is returned.

### Organization Scoping

All data is automatically scoped to the authenticated user's organization (`org_id`). Frontend does not need to pass `org_id` — it is derived from the JWT.

---

## 4. Health Check Routes

> **Authentication:** None required

### 4.1 — GET `/api/v1/health`

**Purpose:** General health check with app version.

**Response `200 OK`:**

```json
{
  "status": "healthy",
  "message": "API is running",
  "version": "1.0.0"
}
```

---

### 4.2 — GET `/api/v1/health/live`

**Purpose:** Kubernetes/Docker liveness probe.

**Response `200 OK`:**

```json
{ "status": "alive" }
```

---

### 4.3 — GET `/api/v1/health/ready`

**Purpose:** Kubernetes/Docker readiness probe.

**Response `200 OK`:**

```json
{ "status": "ready" }
```

---

## 5. Auth Routes

> **Authentication:** None for login/refresh. Authority JWT for driver creation.

---

### 5.1 — POST `/api/v1/auth/login`

**Purpose:** Login for all user roles (driver, operator, admin). Returns JWT token pair.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

| Field      | Type           | Required | Constraints        |
| ---------- | -------------- | -------- | ------------------ |
| `email`    | string (email) | ✅       | Valid email format |
| `password` | string         | ✅       | 1–128 characters   |

**Response `200 OK`:**

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in_seconds": 3600,
  "role_keys": ["authority_admin"],
  "user_id": 42,
  "org_id": 7
}
```

| Field                | Type     | Description                          |
| -------------------- | -------- | ------------------------------------ |
| `access_token`       | string   | JWT to use in `Authorization` header |
| `refresh_token`      | string   | Opaque token to renew access         |
| `token_type`         | string   | Always `"bearer"`                    |
| `expires_in_seconds` | int      | Access token TTL in seconds          |
| `role_keys`          | string[] | Roles assigned to this user          |
| `user_id`            | int      | The logged-in user's ID              |
| `org_id`             | int      | The user's organization ID           |

**Error Responses:**
| Status | When |
|---|---|
| `401 Unauthorized` | Invalid credentials |
| `400 Bad Request` | Malformed payload |

---

### 5.2 — POST `/api/v1/auth/refresh`

**Purpose:** Issue a new access token using a valid refresh token.

**Request Body:**

```json
{
  "refresh_token": "eyJ..."
}
```

| Field           | Type   | Required | Constraints           |
| --------------- | ------ | -------- | --------------------- |
| `refresh_token` | string | ✅       | Minimum 10 characters |

**Response `200 OK`:** Same shape as login response (`LoginResponse`).

**Error Responses:**
| Status | When |
|---|---|
| `401 Unauthorized` | Invalid or expired refresh token |

---

### 5.3 — POST `/api/v1/auth/drivers`

**Purpose:** Create a driver user account within the caller's organization.

**Authentication:** Authority user (admin or operator) JWT required.

**Request Body:**

```json
{
  "full_name": "Ravi Kumar",
  "email": "ravi@example.com",
  "password": "SecurePass123",
  "phone": "+919876543210"
}
```

| Field       | Type           | Required | Constraints       |
| ----------- | -------------- | -------- | ----------------- |
| `full_name` | string         | ✅       | 1–150 characters  |
| `email`     | string (email) | ✅       | Valid email       |
| `password`  | string         | ✅       | 8–128 characters  |
| `phone`     | string         | ❌       | Max 30 characters |

**Response `201 Created`:**

```json
{
  "id": 15,
  "org_id": 7,
  "full_name": "Ravi Kumar",
  "email": "ravi@example.com",
  "phone": "+919876543210",
  "status": "active",
  "is_active": true,
  "role_keys": ["driver"],
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

**Error Responses:**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing/invalid JWT |
| `403 Forbidden` | Caller is not authority role |
| `409 Conflict` | Email already exists |

---

### 5.4 — GET `/api/v1/auth/me`

**Purpose:** Fetch the currently authenticated user's profile and role summary.

**Authentication:** Any valid JWT (driver, authority_operator, authority_admin).

**Request Body:** None

**Response `200 OK`:**

```json
{
  "id": 15,
  "org_id": 7,
  "full_name": "Ravi Kumar",
  "email": "ravi@example.com",
  "phone": "+919876543210",
  "status": "active",
  "is_active": true,
  "role_keys": ["driver"],
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

**Error Responses:**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing, invalid, or expired JWT |
| `404 Not Found` | User not found/inactive for token subject |

---

## 6. User Management Routes

> **Authentication:** Authority user JWT required for ALL routes below.

---

### 6.1 — GET `/api/v1/users`

**Purpose:** List all users in the caller's organization with optional filters.

**Query Parameters:**
| Param | Type | Default | Constraints | Description |
|---|---|---|---|---|
| `limit` | int | 50 | 1–100 | Page size |
| `offset` | int | 0 | ≥0 | Skip N items |
| `q` | string | — | Optional | Search by name or email |
| `role` | string | — | Optional | Filter by role key (e.g. `"driver"`) |
| `status` | string | — | Optional | Filter by user status string |
| `is_active` | bool | — | Optional | Filter active/inactive users |

**Response `200 OK`:**

```json
{
  "total": 5,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": 15,
      "org_id": 7,
      "full_name": "Ravi Kumar",
      "email": "ravi@example.com",
      "phone": null,
      "status": "active",
      "is_active": true,
      "role_keys": ["driver"],
      "created_at": "2026-04-17T10:00:00",
      "updated_at": "2026-04-17T10:00:00"
    }
  ]
}
```

---

### 6.2 — GET `/api/v1/users/{user_id}`

**Purpose:** Get full details of one user by ID.

**Path Parameter:** `user_id` (int) — The user's database ID

**Response `200 OK`:** Same as single item in the list above (`UserResponse`).

**Error Responses:**
| Status | When |
|---|---|
| `404 Not Found` | User not found in org |

---

### 6.3 — POST `/api/v1/users/{user_id}/roles/add`

**Purpose:** Add one or more roles to a user.

**Path Parameter:** `user_id` (int)

**Request Body:**

```json
{
  "role_keys": ["authority_operator"]
}
```

| Field       | Type     | Required | Constraints                        |
| ----------- | -------- | -------- | ---------------------------------- |
| `role_keys` | string[] | ✅       | Non-empty list of role key strings |

**Response `200 OK`:** Updated `UserResponse` with all current roles.

**Error Responses:**
| Status | When |
|---|---|
| `404 Not Found` | User not found |
| `409 Conflict` | Role assignment conflict |

---

### 6.4 — POST `/api/v1/users/{user_id}/roles/remove`

**Purpose:** Remove one or more roles from a user.

> **Important:** Cannot remove the last `authority_admin` from the organization.

**Path Parameter:** `user_id` (int)

**Request Body:** Same shape as role add (`UserRoleMutationRequest`):

```json
{ "role_keys": ["driver"] }
```

**Response `200 OK`:** Updated `UserResponse`.

**Error Responses:**
| Status | When |
|---|---|
| `404 Not Found` | User not found |
| `409 Conflict` | Attempt to remove last authority_admin |

---

### 6.5 — POST `/api/v1/users/{user_id}/deactivate`

**Purpose:** Soft-deactivate a user (sets `is_active = false`). Does **not** delete.

**Path Parameter:** `user_id` (int)

**Request Body:** None

**Response `200 OK`:** Updated `UserResponse` with `is_active: false`.

**Error Responses:**
| Status | When |
|---|---|
| `404 Not Found` | User not found |
| `409 Conflict` | Cannot deactivate last admin |

---

### 6.6 — POST `/api/v1/users/{user_id}/password/reset`

**Purpose:** Admin/operator resets a user's password (no forgot-password email flow needed).

**Path Parameter:** `user_id` (int)

**Request Body:**

```json
{ "new_password": "NewSecurePass123" }
```

| Field          | Type   | Required | Constraints      |
| -------------- | ------ | -------- | ---------------- |
| `new_password` | string | ✅       | 8–128 characters |

**Response `200 OK`:** Updated `UserResponse`.

---

## 7. Master Data Routes

> **Authentication:** Authority user JWT required for ALL master-data routes.

These routes manage the foundational reference data that other entities depend on.

---

### 7A. Depots

Depots are the physical base locations for vehicles and route start points.

---

### 7A.1 — POST `/api/v1/master-data/depots`

**Purpose:** Create one depot.

**Request Body:**

```json
{
  "name": "North Depot",
  "address": "123 Main Road, Chennai",
  "contact_phone": "+914420001122",
  "latitude": 13.0827,
  "longitude": 80.2707,
  "is_active": true
}
```

| Field           | Type   | Required | Constraints        |
| --------------- | ------ | -------- | ------------------ |
| `name`          | string | ✅       | 1–120 characters   |
| `address`       | string | ❌       | Max 255 characters |
| `contact_phone` | string | ❌       | Max 30 characters  |
| `latitude`      | float  | ❌       | GPS latitude       |
| `longitude`     | float  | ❌       | GPS longitude      |
| `is_active`     | bool   | ❌       | Default: `true`    |

**Response `201 Created`:**

```json
{
  "id": 3,
  "org_id": 7,
  "name": "North Depot",
  "address": "123 Main Road, Chennai",
  "contact_phone": "+914420001122",
  "latitude": 13.0827,
  "longitude": 80.2707,
  "is_active": true,
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

**Error Responses:**
| Status | When |
|---|---|
| `409 Conflict` | Depot name already exists in org |

---

### 7A.2 — GET `/api/v1/master-data/depots`

**Purpose:** List all depots for the caller's org.

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `limit` | int | Page size (default 50, max 100) |
| `offset` | int | Skip N items |
| `is_active` | bool | Filter by active status |
| `q` | string | Free-text search on name |

**Response `200 OK`:** Paginated `DepotListResponse` with depot items.

---

### 7A.3 — GET `/api/v1/master-data/depots/{depot_id}`

**Purpose:** Get one depot by ID.

**Response `200 OK`:** `DepotResponse`

**Error:** `404` if not found.

---

### 7A.4 — PATCH `/api/v1/master-data/depots/{depot_id}`

**Purpose:** Partial update of one depot.

**Request Body (partial — only include fields to change):**

```json
{
  "contact_phone": "+914420009999",
  "is_active": false
}
```

All fields optional. Same fields as create minus required `name`.

**Response `200 OK`:** Updated `DepotResponse`.

---

### 7A.5 — POST `/api/v1/master-data/depots/{depot_id}/deactivate`

**Purpose:** Soft-deactivate one depot (`is_active = false`).

**Request Body:** None

**Response `200 OK`:** Updated `DepotResponse` with `is_active: false`.

---

### 7B. Service Areas

Service areas define geographic zones that bins belong to.

---

### 7B.1 — POST `/api/v1/master-data/service-areas`

**Purpose:** Create one service area.

**Request Body:**

```json
{
  "name": "Zone A - North",
  "center_latitude": 13.09,
  "center_longitude": 80.27,
  "boundary_geojson": { "type": "Polygon", "coordinates": [[[...]]]} ,
  "priority_weight": 1.5,
  "is_active": true
}
```

| Field              | Type   | Required | Constraints                |
| ------------------ | ------ | -------- | -------------------------- |
| `name`             | string | ✅       | 1–120 characters           |
| `center_latitude`  | float  | ❌       | GPS latitude               |
| `center_longitude` | float  | ❌       | GPS longitude              |
| `boundary_geojson` | object | ❌       | GeoJSON geometry object    |
| `priority_weight`  | float  | ❌       | Default `1.0`, must be > 0 |
| `is_active`        | bool   | ❌       | Default `true`             |

**Response `201 Created`:**

```json
{
  "id": 5,
  "org_id": 7,
  "name": "Zone A - North",
  "center_latitude": 13.09,
  "center_longitude": 80.27,
  "boundary_geojson": null,
  "priority_weight": 1.5,
  "is_active": true,
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

---

### 7B.2 — GET `/api/v1/master-data/service-areas`

**Query Parameters:** `limit`, `offset`, `is_active` (bool), `q` (string search)

**Response `200 OK`:** Paginated `ServiceAreaListResponse`.

---

### 7B.3 — GET `/api/v1/master-data/service-areas/{area_id}`

**Response `200 OK`:** `ServiceAreaResponse`. `404` if not found.

---

### 7B.4 — PATCH `/api/v1/master-data/service-areas/{area_id}`

**Request Body (partial):** Same fields as create, all optional.

**Response `200 OK`:** Updated `ServiceAreaResponse`.

---

### 7B.5 — POST `/api/v1/master-data/service-areas/{area_id}/deactivate`

**Request Body:** None. **Response `200 OK`:** Updated record with `is_active: false`.

---

### 7C. Driver Profiles

Driver profiles extend user accounts with operational metadata (license, home depot, etc.).

---

### 7C.1 — POST `/api/v1/master-data/driver-profiles`

**Purpose:** Create an operational profile for a driver user.

> **Prerequisite:** The `user_id` must already exist and have the `driver` role.

**Request Body:**

```json
{
  "user_id": 15,
  "license_no": "TN-0120196012345",
  "license_expiry": "2028-12-31",
  "home_depot_id": 3,
  "employment_status": "full_time"
}
```

| Field               | Type   | Required | Constraints                                        |
| ------------------- | ------ | -------- | -------------------------------------------------- |
| `user_id`           | int    | ✅       | Must be a valid user in the org                    |
| `license_no`        | string | ❌       | Max 80 characters                                  |
| `license_expiry`    | date   | ❌       | ISO date `YYYY-MM-DD`                              |
| `home_depot_id`     | int    | ❌       | Valid depot ID                                     |
| `employment_status` | string | ✅       | 1–20 characters (e.g. `"full_time"`, `"contract"`) |

**Response `201 Created`:**

```json
{
  "id": 8,
  "org_id": 7,
  "user_id": 15,
  "license_no": "TN-0120196012345",
  "license_expiry": "2028-12-31",
  "home_depot_id": 3,
  "employment_status": "full_time",
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

---

### 7C.2 — GET `/api/v1/master-data/driver-profiles`

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `limit` | int | Page size |
| `offset` | int | Skip |
| `user_id` | int | Filter by specific user |
| `employment_status` | string | Filter by employment status |
| `q` | string | Free-text search |

**Response `200 OK`:** Paginated `DriverProfileListResponse`.

---

### 7C.3 — GET `/api/v1/master-data/driver-profiles/{profile_id}`

**Response `200 OK`:** `DriverProfileResponse`. `404` if not found.

---

### 7C.4 — PATCH `/api/v1/master-data/driver-profiles/{profile_id}`

**Request Body (partial):** `license_no`, `license_expiry`, `home_depot_id`, `employment_status` — all optional.

**Response `200 OK`:** Updated `DriverProfileResponse`.

---

### 7C.5 — DELETE `/api/v1/master-data/driver-profiles/{profile_id}`

**Purpose:** Hard delete one driver profile (not a soft deactivate).

**Response `200 OK`:**

```json
{ "id": 8, "deleted": true }
```

**Error:** `404` if not found.

---

## 8. Bin Routes

> **Authority users:** Full CRUD access.  
> **Drivers:** Read-only (list, get, search, assignments).

---

### 8.1 — POST `/api/v1/bins`

**Auth:** Authority only  
**Purpose:** Create one IoT waste bin record.

**Request Body:**

```json
{
  "bin_code": "BIN-A001",
  "display_name": "Anna Nagar Bin 1",
  "address_line": "12 Main Street, Anna Nagar",
  "area_id": 5,
  "depot_id": 3,
  "latitude": 13.085,
  "longitude": 80.21,
  "capacity_liters": 120.0,
  "bin_height_cm": 80.0,
  "dead_zone_cm": 5.0,
  "threshold_green": 50.0,
  "threshold_yellow": 80.0,
  "distance_factor": 0.5,
  "status": "active",
  "installed_at": "2026-01-15T08:00:00",
  "last_service_at": null
}
```

| Field              | Type     | Required | Constraints                                                   |
| ------------------ | -------- | -------- | ------------------------------------------------------------- |
| `bin_code`         | string   | ✅       | 1–50 chars, must be unique in org                             |
| `display_name`     | string   | ❌       | Max 120 chars                                                 |
| `address_line`     | string   | ❌       | Max 255 chars                                                 |
| `area_id`          | int      | ❌       | Service area ID                                               |
| `depot_id`         | int      | ❌       | Depot ID                                                      |
| `latitude`         | float    | ❌       | GPS latitude                                                  |
| `longitude`        | float    | ❌       | GPS longitude                                                 |
| `capacity_liters`  | float    | ❌       | Physical capacity                                             |
| `bin_height_cm`    | float    | ❌       | Default `60.0`, must be > 0                                   |
| `dead_zone_cm`     | float    | ❌       | Default `5.0`, must be ≥ 0                                    |
| `threshold_green`  | float    | ❌       | Default `50.0`, range 0–100. **Must be < `threshold_yellow`** |
| `threshold_yellow` | float    | ❌       | Default `80.0`, range 0–100                                   |
| `distance_factor`  | float    | ❌       | Default `0.5`, range 0–1                                      |
| `status`           | string   | ❌       | Default `"active"`, max 20 chars                              |
| `installed_at`     | datetime | ❌       | ISO datetime                                                  |
| `last_service_at`  | datetime | ❌       | ISO datetime                                                  |

**Response `201 Created`:**

```json
{
  "id": 101,
  "org_id": 7,
  "bin_code": "BIN-A001",
  "display_name": "Anna Nagar Bin 1",
  "address_line": "12 Main Street, Anna Nagar",
  "area_id": 5,
  "depot_id": 3,
  "latitude": 13.085,
  "longitude": 80.21,
  "capacity_liters": 120.0,
  "bin_height_cm": 80.0,
  "dead_zone_cm": 5.0,
  "threshold_green": 50.0,
  "threshold_yellow": 80.0,
  "distance_factor": 0.5,
  "status": "active",
  "installed_at": "2026-01-15T08:00:00",
  "last_service_at": null,
  "is_active": true,
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

**Error Responses:**
| Status | When |
|---|---|
| `409 Conflict` | `bin_code` already exists |
| `400 Bad Request` | `threshold_green >= threshold_yellow` |

---

### 8.2 — GET `/api/v1/bins`

**Auth:** Authority or Driver  
**Purpose:** List bins with optional filters.

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `limit` | int | Page size (default 50, max 100) |
| `offset` | int | Skip N items |
| `status` | string | Filter by bin status string |
| `is_active` | bool | Filter active/inactive |
| `area_id` | int | Filter by service area |
| `q` | string | Free-text search on code/name/address |

**Response `200 OK`:** `BinListResponse` (paginated list of `BinResponse`)

---

### 8.3 — GET `/api/v1/bins/search`

**Auth:** Authority or Driver  
**Purpose:** Dedicated text search for bins (used for autocomplete/search bars).

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | ✅ | Min 1 char — searches code, name, address |
| `limit` | int | ❌ | Default 50, max 100 |
| `offset` | int | ❌ | Default 0 |
| `status` | string | ❌ | Filter by status |

**Response `200 OK`:** `BinSearchResponse` (same shape as `BinListResponse`)

> **Note:** Call `/bins/search?q=BIN-A` for autocomplete. Call `/bins` for full paginated listing.

---

### 8.4 — GET `/api/v1/bins/{bin_id}`

**Auth:** Authority or Driver  
**Purpose:** Fetch one bin by its numeric database ID.

**Path Parameter:** `bin_id` (int)

**Response `200 OK`:** `BinResponse` (see structure in 8.1)

**Error:** `404` if not found.

---

### 8.5 — PATCH `/api/v1/bins/{bin_id}`

**Auth:** Authority only  
**Purpose:** Partial update of one bin.

**Path Parameter:** `bin_id` (int)

**Request Body (partial — all optional):**

```json
{
  "display_name": "Updated Bin Name",
  "latitude": 13.09,
  "longitude": 80.215,
  "threshold_yellow": 85.0,
  "is_active": true
}
```

Same fields as create except `bin_code` cannot be changed via PATCH.

**Response `200 OK`:** Updated `BinResponse`.

---

### 8.6 — POST `/api/v1/bins/{bin_id}/deactivate`

**Auth:** Authority only  
**Purpose:** Soft-deactivate one bin.

**Request Body:** None

**Response `200 OK`:** Updated `BinResponse` with `is_active: false`.

---

### 8.7 — GET `/api/v1/bins/{bin_id}/assignments`

**Auth:** Authority or Driver  
**Purpose:** View full history of which devices have been assigned to this bin.

**Query Parameters:** `limit` (default 50, max 100), `offset`

**Response `200 OK`:**

```json
{
  "total": 3,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": 22,
      "bin_id": 101,
      "device_id": 55,
      "active_from": "2026-01-15T08:00:00",
      "active_to": null,
      "notes": "Initial installation",
      "created_at": "2026-01-15T08:00:00"
    }
  ]
}
```

---

## 9. Device Routes

> **Authority users:** Full CRUD + assign.  
> **Drivers:** Read-only (list, get, search, assignments).

IoT sensor devices mounted on bins. Each device communicates via MQTT.

---

### 9.1 — POST `/api/v1/devices`

**Auth:** Authority only  
**Purpose:** Register one IoT device linked to a bin.

**Request Body:**

```json
{
  "bin_id": 101,
  "device_uid": "DEVICE-UID-XYZ-001",
  "mqtt_client_id": "smartbin-BIN-A001",
  "firmware_version": "2.1.4",
  "hardware_revision": "rev-B",
  "status": "online",
  "installed_at": "2026-01-15T08:00:00",
  "last_seen_at": null
}
```

| Field               | Type     | Required | Constraints                                |
| ------------------- | -------- | -------- | ------------------------------------------ |
| `bin_id`            | int      | ✅       | Valid bin ID in the org                    |
| `device_uid`        | string   | ✅       | 1–100 chars, unique identifier             |
| `mqtt_client_id`    | string   | ✅       | 1–100 chars, used in MQTT topic resolution |
| `firmware_version`  | string   | ❌       | Max 50 chars                               |
| `hardware_revision` | string   | ❌       | Max 50 chars                               |
| `status`            | string   | ❌       | Default `"online"`, max 20 chars           |
| `installed_at`      | datetime | ❌       | ISO datetime                               |
| `last_seen_at`      | datetime | ❌       | ISO datetime                               |

**Response `201 Created`:**

```json
{
  "id": 55,
  "bin_id": 101,
  "org_id": 7,
  "device_uid": "DEVICE-UID-XYZ-001",
  "mqtt_client_id": "smartbin-BIN-A001",
  "firmware_version": "2.1.4",
  "hardware_revision": "rev-B",
  "status": "online",
  "installed_at": "2026-01-15T08:00:00",
  "decommissioned_at": null,
  "last_seen_at": null,
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

**Error:** `409 Conflict` if device_uid or mqtt_client_id already exists.

---

### 9.2 — GET `/api/v1/devices`

**Auth:** Authority or Driver  
**Purpose:** List devices with filters.

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `limit` | int | Default 50, max 100 |
| `offset` | int | Skip N |
| `status` | string | Filter by device status |
| `bin_id` | int | Filter devices for a specific bin |
| `q` | string | Search by device_uid/mqtt_client_id |

**Response `200 OK`:** `DeviceListResponse` (paginated list of `DeviceResponse`)

---

### 9.3 — GET `/api/v1/devices/search`

**Auth:** Authority or Driver  
**Purpose:** Search devices by UID or MQTT client ID.

**Query Parameters:** `q` (required, min 1 char), `limit`, `offset`, `status`

**Response `200 OK`:** `DeviceListResponse`

---

### 9.4 — GET `/api/v1/devices/{device_id}`

**Auth:** Authority or Driver  
**Path Parameter:** `device_id` (int)

**Response `200 OK`:** `DeviceResponse`. `404` if not found.

---

### 9.5 — PATCH `/api/v1/devices/{device_id}`

**Auth:** Authority only  
**Purpose:** Partial update of device metadata.

**Request Body (partial):**

```json
{
  "firmware_version": "2.2.0",
  "status": "offline",
  "decommissioned_at": "2026-04-01T00:00:00"
}
```

Fields: `mqtt_client_id`, `firmware_version`, `hardware_revision`, `status`, `installed_at`, `decommissioned_at`, `last_seen_at` — all optional.

**Response `200 OK`:** Updated `DeviceResponse`.

---

### 9.6 — POST `/api/v1/devices/{device_id}/deactivate`

**Auth:** Authority only  
**Purpose:** Soft-deactivate one device.

**Response `200 OK`:** Updated `DeviceResponse`.

---

### 9.7 — POST `/api/v1/devices/{device_id}/assign`

**Auth:** Authority only  
**Purpose:** Assign or reassign a device to a bin. Records assignment history.

**Request Body:**

```json
{
  "bin_id": 102,
  "notes": "Moved from bin 101 due to malfunction",
  "active_from": "2026-04-17T09:00:00"
}
```

| Field         | Type     | Required | Constraints           |
| ------------- | -------- | -------- | --------------------- |
| `bin_id`      | int      | ✅       | Target bin in the org |
| `notes`       | string   | ❌       | Max 255 characters    |
| `active_from` | datetime | ❌       | Defaults to now       |

**Response `200 OK`:**

```json
{
  "id": 23,
  "bin_id": 102,
  "device_id": 55,
  "active_from": "2026-04-17T09:00:00",
  "active_to": null,
  "notes": "Moved from bin 101 due to malfunction",
  "created_at": "2026-04-17T09:00:00"
}
```

---

### 9.8 — GET `/api/v1/devices/{device_id}/assignments`

**Auth:** Authority or Driver  
**Purpose:** View assignment history for one device.

**Query Parameters:** `limit`, `offset`

**Response `200 OK`:** `AssignmentHistoryResponse` (same format as bin assignments)

---

## 10. Telemetry Routes

> **Authentication:** Authority or Driver JWT required.

Telemetry is the real-time sensor data coming from bins via MQTT.

---

### 10.1 — GET `/api/v1/telemetry/bins/{bin_code}/latest`

**Purpose:** Get the most recent computed state snapshot for one bin.

**Path Parameter:** `bin_code` (string) — The bin's unique `bin_code` (e.g. `"BIN-A001"`)

**Response `200 OK`:**

```json
{
  "bin_code": "BIN-A001",
  "last_measured_at": "2026-04-17T10:00:00",
  "current_fill_pct": 73.5,
  "current_fill_rate_pct_per_min": 0.12,
  "current_ttf_min": 224,
  "current_priority_score": 0.82,
  "current_alert_level": "YELLOW",
  "overflow_imminent": false,
  "device_connectivity_state": "online",
  "queued_count": 0
}
```

| Field                           | Type          | Description                           |
| ------------------------------- | ------------- | ------------------------------------- |
| `bin_code`                      | string        | The bin identifier                    |
| `last_measured_at`              | datetime/null | When last sensor reading was received |
| `current_fill_pct`              | float/null    | Current fill percentage 0–100         |
| `current_fill_rate_pct_per_min` | float/null    | Rate of fill increase                 |
| `current_ttf_min`               | float/null    | Time-to-full in minutes               |
| `current_priority_score`        | float/null    | Computed priority for routing         |
| `current_alert_level`           | string/null   | `"GREEN"`, `"YELLOW"`, `"RED"`        |
| `overflow_imminent`             | bool          | Whether overflow was flagged          |
| `device_connectivity_state`     | string        | `"online"` or `"offline"`             |
| `queued_count`                  | int           | Number of queued messages             |

**Error:** `404` if bin_code not found.

---

### 10.2 — GET `/api/v1/telemetry/bins/{bin_code}/history`

**Purpose:** Get recent telemetry history for charting/analysis.

**Path Parameter:** `bin_code` (string)

**Query Parameters:**
| Param | Type | Default | Constraints |
|---|---|---|---|
| `limit` | int | 100 | 1–1000 |

**Response `200 OK`:**

```json
{
  "bin_code": "BIN-A001",
  "items": [
    {
      "measured_at": "2026-04-17T10:00:00",
      "fill_pct": 73.5,
      "fill_rate_pct_per_min": 0.12,
      "ttf_min": 224.0,
      "priority_score": 0.82,
      "alert_level": "YELLOW",
      "overflow_imminent": false,
      "queued": false
    }
  ]
}
```

Items are returned in **descending order** (newest first).

---

### 10.3 — GET `/api/v1/telemetry/live/summary`

**Purpose:** Dashboard summary counters for all bins in the organization.

**Response `200 OK`:**

```json
{
  "total_bins": 150,
  "bins_with_state": 142,
  "red_bins": 12,
  "yellow_bins": 34,
  "overflow_imminent_bins": 5,
  "offline_bins": 8,
  "open_alerts": 17
}
```

| Field                    | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| `total_bins`             | All active bins in org                                 |
| `bins_with_state`        | Bins that have received at least one telemetry reading |
| `red_bins`               | Bins at RED alert level (critically full)              |
| `yellow_bins`            | Bins at YELLOW alert level (approaching full)          |
| `overflow_imminent_bins` | Bins with overflow flag set                            |
| `offline_bins`           | Bins with offline device status                        |
| `open_alerts`            | Total unresolved alerts                                |

---

## 11. Alert Routes

> **Authentication:** Authority or Driver JWT required.

Alerts are automatically created by the MQTT ingestion pipeline. Users can acknowledge, resolve, and assign them.

---

### 11.1 — GET `/api/v1/alerts`

**Purpose:** List alerts for the organization with rich filters.

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `limit` | int | Default 50, max 100 |
| `offset` | int | Skip N |
| `status` | string | Filter by alert status: `"open"`, `"acknowledged"`, `"resolved"` |
| `severity` | string | Filter by severity: `"low"`, `"medium"`, `"high"`, `"critical"` |
| `alert_type` | string | Filter by type: `"fill_threshold"`, `"overflow_imminent"`, `"device_offline"` |
| `bin_id` | int | Filter alerts for a specific bin |
| `assigned_to_user_id` | int | Filter alerts assigned to a specific user |
| `opened_from` | datetime | Filter by opened_at ≥ this timestamp |
| `opened_to` | datetime | Filter by opened_at ≤ this timestamp |

**Response `200 OK`:**

```json
{
  "total": 17,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": 88,
      "org_id": 7,
      "bin_id": 101,
      "bin_code": "BIN-A001",
      "rule_id": null,
      "alert_type": "fill_threshold",
      "severity": "high",
      "status": "open",
      "opened_at": "2026-04-17T09:30:00",
      "acknowledged_at": null,
      "resolved_at": null,
      "assigned_to_user_id": null,
      "title": "Fill level critical: BIN-A001",
      "description": "Bin fill level has reached RED threshold",
      "latest_telemetry_id": 5001,
      "dedupe_key": "fill_threshold:101",
      "created_at": "2026-04-17T09:30:00",
      "updated_at": "2026-04-17T09:30:00"
    }
  ]
}
```

**Alert Types:**

| `alert_type`        | Trigger                                          |
| ------------------- | ------------------------------------------------ |
| `fill_threshold`    | Bin fill level crossed GREEN or YELLOW threshold |
| `overflow_imminent` | Device reported overflow imminent flag           |
| `device_offline`    | No telemetry received beyond stale timeout       |

---

### 11.2 — GET `/api/v1/alerts/{alert_id}`

**Purpose:** Get full details of one alert.

**Path Parameter:** `alert_id` (int)

**Response `200 OK`:** `AlertResponse` (same as list item). `404` if not found.

---

### 11.3 — POST `/api/v1/alerts/{alert_id}/acknowledge`

**Purpose:** Mark an alert as acknowledged. Records the event with actor and optional note.

**Path Parameter:** `alert_id` (int)

**Request Body:**

```json
{ "note": "Dispatching a truck to this location" }
```

| Field  | Type   | Required | Constraints         |
| ------ | ------ | -------- | ------------------- |
| `note` | string | ❌       | Max 1000 characters |

**Response `200 OK`:** Updated `AlertResponse` with `acknowledged_at` populated and `status: "acknowledged"`.

**Error Responses:**
| Status | When |
|---|---|
| `403 Forbidden` | Driver attempting to acknowledge outside their scope |
| `404 Not Found` | Alert not found |

---

### 11.4 — POST `/api/v1/alerts/{alert_id}/resolve`

**Purpose:** Mark an alert as resolved. Records the event with actor and note.

**Request Body:** Same as acknowledge — `{ "note": "..." }`

**Response `200 OK`:** Updated `AlertResponse` with `resolved_at` populated and `status: "resolved"`.

---

### 11.5 — POST `/api/v1/alerts/{alert_id}/assign`

**Purpose:** Assign or unassign an alert to a specific user.

**Path Parameter:** `alert_id` (int)

**Request Body:**

```json
{
  "assigned_to_user_id": 15,
  "note": "Assigned to Ravi for immediate collection"
}
```

| Field                 | Type     | Required | Description                                    |
| --------------------- | -------- | -------- | ---------------------------------------------- |
| `assigned_to_user_id` | int/null | ❌       | The user to assign to. Pass `null` to unassign |
| `note`                | string   | ❌       | Max 1000 characters                            |

**Response `200 OK`:** Updated `AlertResponse` with `assigned_to_user_id` set.

**Error:** `403 Forbidden` if driver tries to assign to another user.

---

### 11.6 — GET `/api/v1/alerts/{alert_id}/events`

**Purpose:** View the full lifecycle event history for one alert (opened → acknowledged → resolved, etc.)

**Query Parameters:** `limit` (default 50, max 100), `offset`

**Response `200 OK`:**

```json
{
  "total": 3,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": 301,
      "alert_id": 88,
      "event_type": "opened",
      "actor_user_id": null,
      "event_ts": "2026-04-17T09:30:00",
      "note": null,
      "payload_json": { "fill_pct": 87.3, "alert_level": "RED" }
    },
    {
      "id": 302,
      "alert_id": 88,
      "event_type": "acknowledged",
      "actor_user_id": 42,
      "event_ts": "2026-04-17T09:45:00",
      "note": "Dispatching truck",
      "payload_json": null
    }
  ]
}
```

| Event Type     | Trigger                                     |
| -------------- | ------------------------------------------- |
| `opened`       | Alert first created by MQTT ingestion       |
| `updated`      | Telemetry updated the alert (fill increase) |
| `resolved`     | Alert auto-resolved or manually resolved    |
| `acknowledged` | User acknowledged the alert                 |
| `assigned`     | Alert assigned/unassigned to a user         |

---

## 12. Operations Routes

Operations manage the collection workflow: vehicles → shifts → routes → assignments → stops.

**Recommended Integration Order:** Vehicles → Shifts → Routes (Plan → Create → Publish → Assign → Start) → Stop Updates

---

### 12A. Vehicles

> **Authentication:** Authority only for all vehicle routes.

---

### 12A.1 — POST `/api/v1/operations/vehicles`

**Purpose:** Register a waste collection vehicle.

**Request Body:**

```json
{
  "vehicle_no": "TN-09-AB-1234",
  "vehicle_type": "compactor",
  "capacity_kg": 3500.0,
  "status": "active"
}
```

| Field          | Type   | Required | Constraints                                   |
| -------------- | ------ | -------- | --------------------------------------------- |
| `vehicle_no`   | string | ✅       | 1–50 chars, unique in org                     |
| `vehicle_type` | string | ❌       | Max 40 chars (e.g. `"compactor"`, `"tipper"`) |
| `capacity_kg`  | float  | ❌       | Must be > 0                                   |
| `status`       | string | ❌       | Default `"active"`, max 20 chars              |

**Response `201 Created`:**

```json
{
  "id": 9,
  "org_id": 7,
  "vehicle_no": "TN-09-AB-1234",
  "vehicle_type": "compactor",
  "capacity_kg": 3500.0,
  "status": "active",
  "is_active": true,
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

**Error:** `409 Conflict` if vehicle_no already exists.

---

### 12A.2 — GET `/api/v1/operations/vehicles`

**Query Parameters:** `limit`, `offset`, `status` (string), `is_active` (bool), `q` (search)

**Response `200 OK`:** Paginated `VehicleListResponse`.

---

### 12A.3 — GET `/api/v1/operations/vehicles/{vehicle_id}`

**Response `200 OK`:** `VehicleResponse`. `404` if not found.

---

### 12A.4 — PATCH `/api/v1/operations/vehicles/{vehicle_id}`

**Request Body (partial):** `vehicle_no`, `vehicle_type`, `capacity_kg`, `status`, `is_active` — all optional.

**Response `200 OK`:** Updated `VehicleResponse`.

---

### 12A.5 — POST `/api/v1/operations/vehicles/{vehicle_id}/deactivate`

**Request Body:** None. **Response `200 OK`:** Updated `VehicleResponse` with `is_active: false`.

---

### 12B. Shifts

> **Authority:** Create shifts, view all shifts.  
> **Driver:** Can only view/start/complete their own shifts.

---

### 12B.1 — POST `/api/v1/operations/shifts`

**Auth:** Authority only  
**Purpose:** Pre-schedule a driver's working shift.

**Request Body:**

```json
{
  "driver_user_id": 15,
  "vehicle_id": 9,
  "planned_start": "2026-04-18T06:00:00",
  "planned_end": "2026-04-18T14:00:00",
  "notes": "Morning shift for North Zone"
}
```

| Field            | Type     | Required | Constraints                       |
| ---------------- | -------- | -------- | --------------------------------- |
| `driver_user_id` | int      | ✅       | Valid driver user ID, must be > 0 |
| `vehicle_id`     | int      | ❌       | Optional vehicle assignment       |
| `planned_start`  | datetime | ✅       | ISO datetime                      |
| `planned_end`    | datetime | ✅       | Must be after `planned_start`     |
| `notes`          | string   | ❌       | Max 255 characters                |

**Response `201 Created`:**

```json
{
  "id": 14,
  "org_id": 7,
  "driver_user_id": 15,
  "vehicle_id": 9,
  "planned_start": "2026-04-18T06:00:00",
  "planned_end": "2026-04-18T14:00:00",
  "actual_start": null,
  "actual_end": null,
  "status": "scheduled",
  "notes": "Morning shift for North Zone",
  "created_at": "2026-04-17T10:00:00",
  "updated_at": "2026-04-17T10:00:00"
}
```

**Shift Status Flow:** `scheduled` → `active` → `completed`

**Error:** `400` if `planned_end <= planned_start`.

---

### 12B.2 — GET `/api/v1/operations/shifts`

**Auth:** Authority or Driver  
**Purpose:** List shifts. Drivers automatically see only their own shifts.

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `limit` | int | Page size |
| `offset` | int | Skip |
| `status` | string | Filter by shift status |
| `driver_user_id` | int | (**Authority only**) filter by specific driver |
| `vehicle_id` | int | Filter by vehicle |

> **Driver Scoping:** When a driver calls this, `driver_user_id` is automatically set to their own ID regardless of any query param passed.

**Response `200 OK`:** Paginated `ShiftListResponse`.

---

### 12B.3 — GET `/api/v1/operations/shifts/{shift_id}`

**Auth:** Authority or Driver  
**Purpose:** Get one shift by ID.

> **Driver Access:** Drivers can only get shifts assigned to them. Returns `403` otherwise.

**Response `200 OK`:** `ShiftResponse`. `403` if driver accesses someone else's shift.

---

### 12B.4 — POST `/api/v1/operations/shifts/{shift_id}/start`

**Auth:** Authority or owning Driver  
**Purpose:** Transition shift from `scheduled` to `active`. Sets `actual_start`.

**Request Body:** None

**Response `200 OK`:** Updated `ShiftResponse` with `status: "active"` and `actual_start` set.

**Error:** `403` if driver is not the shift's assigned driver.

---

### 12B.5 — POST `/api/v1/operations/shifts/{shift_id}/complete`

**Auth:** Authority or owning Driver  
**Purpose:** Transition shift from `active` to `completed`. Sets `actual_end`.

**Request Body:** None

**Response `200 OK`:** Updated `ShiftResponse` with `status: "completed"` and `actual_end` set.

---

### 12C. Route Planning (Preview Only)

> **Authentication:** Authority only.

This is a **non-persisting preview** endpoint. It calculates an optimized route plan without creating any database records.

---

### 12C.1 — POST `/api/v1/operations/routes/plan`

**Purpose:** Generate an optimized route plan preview. Use this to show operators what a route would look like before creating it.

**Request Body:**

```json
{
  "route_date": "2026-04-18",
  "depot_id": 3,
  "driver_user_id": 15,
  "include_bin_ids": null,
  "max_stops": 60,
  "min_fill_pct": 70.0,
  "overflow_only": false,
  "target_shift_minutes": 480,
  "avg_speed_kmph": 22.0,
  "service_minutes_per_stop": 4.0,
  "use_multi_vehicle": false,
  "vehicle_ids": null
}
```

| Field                      | Type  | Required | Constraints           | Description                                   |
| -------------------------- | ----- | -------- | --------------------- | --------------------------------------------- |
| `route_date`               | date  | ✅       | ISO date              | The date to plan the route for                |
| `depot_id`                 | int   | ❌       | Must be > 0           | Starting depot for route optimization         |
| `driver_user_id`           | int   | ❌       | Must be > 0           | Filter by driver's home depot for start point |
| `include_bin_ids`          | int[] | ❌       | Non-empty if provided | Force-include specific bins                   |
| `max_stops`                | int   | ❌       | 1–500, default 60     | Max stops in route                            |
| `min_fill_pct`             | float | ❌       | 0–100, default 70.0   | Only include bins at or above this fill %     |
| `overflow_only`            | bool  | ❌       | Default `false`       | Only include bins with overflow flag          |
| `target_shift_minutes`     | int   | ❌       | 60–1440, default 480  | Target shift duration in minutes              |
| `avg_speed_kmph`           | float | ❌       | 0–80, default 22.0    | Assumed travel speed                          |
| `service_minutes_per_stop` | float | ❌       | 0–60, default 4.0     | Time to service each bin                      |
| `use_multi_vehicle`        | bool  | ❌       | Default `false`       | Enable multi-vehicle optimization             |
| `vehicle_ids`              | int[] | ❌       | Non-empty if provided | Vehicles available for multi-vehicle          |

**Response `200 OK`:**

```json
{
  "algorithm": "greedy_nearest_neighbor",
  "route_date": "2026-04-18",
  "candidates_considered": 150,
  "selected_stops": 42,
  "skipped_due_to_shift": 8,
  "estimated_distance_km": 87.4,
  "estimated_duration_min": 312.0,
  "start_point": {
    "source": "depot",
    "depot_id": 3,
    "area_id": null,
    "latitude": 13.0827,
    "longitude": 80.2707
  },
  "items": [
    {
      "stop_sequence": 1,
      "bin_id": 101,
      "bin_code": "BIN-A001",
      "latitude": 13.085,
      "longitude": 80.21,
      "fill_pct": 82.3,
      "priority_score": 0.94,
      "estimated_load_kg": 98.5,
      "vehicle_id": null,
      "vehicle_no": null,
      "planned_leg_km": 2.3,
      "planned_cumulative_km": 2.3
    }
  ],
  "vehicle_routes": null,
  "unassigned_bin_ids": [205, 210],
  "total_estimated_load_kg": 3450.0
}
```

---

### 12D. Routes (Manage & Lifecycle)

> **Authority:** Create, list, get, publish, complete.  
> **Driver:** Can start and complete routes assigned to them.

**Route Status Flow:** `draft` → `published` → `in_progress` → `completed`

---

### 12D.1 — POST `/api/v1/operations/routes`

**Auth:** Authority only  
**Purpose:** Create a draft route with explicit ordered stop list.

> Typically used after reviewing `POST /operations/routes/plan` and confirming the stops.

**Request Body:**

```json
{
  "route_code": "ROUTE-2026-04-18-N01",
  "route_date": "2026-04-18",
  "depot_id": 3,
  "driver_user_id": 15,
  "stop_bin_ids": [101, 105, 108, 112, 120]
}
```

| Field            | Type   | Required | Constraints                     |
| ---------------- | ------ | -------- | ------------------------------- |
| `route_code`     | string | ✅       | 1–60 chars, unique in org       |
| `route_date`     | date   | ✅       | ISO date                        |
| `depot_id`       | int    | ❌       | Must be > 0                     |
| `driver_user_id` | int    | ❌       | Must be > 0                     |
| `stop_bin_ids`   | int[]  | ✅       | 1–500 items ordered by sequence |

**Response `201 Created`:**

```json
{
  "id": 77,
  "org_id": 7,
  "route_code": "ROUTE-2026-04-18-N01",
  "route_date": "2026-04-18",
  "depot_id": 3,
  "status": "draft",
  "total_distance_km": null,
  "estimated_duration_min": null,
  "optimization_run_id": null,
  "created_by": 42,
  "updated_by": null,
  "stops_count": 5,
  "start_point": {
    "source": "depot",
    "depot_id": 3,
    "area_id": null,
    "latitude": 13.0827,
    "longitude": 80.2707
  },
  "created_at": "2026-04-17T11:00:00",
  "updated_at": "2026-04-17T11:00:00"
}
```

**Error:** `409 Conflict` if `route_code` already exists.

---

### 12D.2 — GET `/api/v1/operations/routes`

**Auth:** Authority only  
**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `limit` | int | Default 50, max 100 |
| `offset` | int | Skip |
| `status` | string | Filter by route status |
| `route_date` | date | Filter by specific date |

**Response `200 OK`:** Paginated `RouteListResponse`.

---

### 12D.3 — GET `/api/v1/operations/routes/{route_id}`

**Auth:** Authority only  
**Path Parameter:** `route_id` (int)

**Query Parameters:**
| Param | Type | Description |
|---|---|---|
| `driver_user_id` | int | Optional — used for driver start-point resolution |

**Response `200 OK`:** `RouteResponse`. `404` if not found.

---

### 12D.4 — POST `/api/v1/operations/routes/{route_id}/publish`

**Auth:** Authority only  
**Purpose:** Publish a draft route, making it visible to assigned drivers.

> After publishing, assignments can be created and drivers can accept them.

**Request Body:**

```json
{ "driver_user_id": 15 }
```

| Field            | Type | Required | Description                                                |
| ---------------- | ---- | -------- | ---------------------------------------------------------- |
| `driver_user_id` | int  | ❌       | If provided, validates driver's home depot for start-point |

**Response `200 OK`:** Updated `RouteResponse` with `status: "published"`.

---

### 12D.5 — POST `/api/v1/operations/routes/{route_id}/start`

**Auth:** Authority or assigned Driver  
**Purpose:** Transition route from `published` to `in_progress`.

**Request Body:** None

**Response `200 OK`:** Updated `RouteResponse` with `status: "in_progress"`.

**Error:** `403` if driver is not assigned to this route.

---

### 12D.6 — POST `/api/v1/operations/routes/{route_id}/complete`

**Auth:** Authority or assigned Driver  
**Purpose:** Transition route from `in_progress` to `completed`.

**Request Body:** None

**Response `200 OK`:** Updated `RouteResponse` with `status: "completed"`.

---

### 12E. Route Assignments

> **Authority:** Create assignments.  
> **Driver:** Can accept/reject their own assignments, view assignments.

---

### 12E.1 — POST `/api/v1/operations/routes/{route_id}/assignments`

**Auth:** Authority only  
**Purpose:** Assign a driver (and optionally a vehicle) to a published or in-progress route.

**Request Body:**

```json
{
  "driver_user_id": 15,
  "vehicle_id": 9
}
```

| Field            | Type | Required | Constraints             |
| ---------------- | ---- | -------- | ----------------------- |
| `driver_user_id` | int  | ✅       | Must be > 0             |
| `vehicle_id`     | int  | ❌       | Must be > 0 if provided |

**Response `201 Created`:**

```json
{
  "id": 45,
  "route_id": 77,
  "driver_user_id": 15,
  "vehicle_id": 9,
  "assigned_by": 42,
  "assigned_at": "2026-04-17T11:30:00",
  "accepted_at": null,
  "rejected_at": null,
  "reject_reason": null,
  "status": "pending"
}
```

**Assignment Status Flow:** `pending` → `accepted` or `rejected`

**Error:** `409 Conflict` if duplicate assignment.

---

### 12E.2 — GET `/api/v1/operations/routes/{route_id}/assignments`

**Auth:** Authority or Driver  
**Purpose:** List assignments for a route.

**Query Parameters:** `limit`, `offset`, `driver_user_id` (authority only — drivers see only their own)

**Response `200 OK`:** Paginated `RouteAssignmentListResponse`.

---

### 12E.3 — POST `/api/v1/operations/assignments/{assignment_id}/accept`

**Auth:** Authority or owning Driver  
**Purpose:** Accept a pending assignment.

**Path Parameter:** `assignment_id` (int)

**Request Body:** None

**Response `200 OK`:** Updated `RouteAssignmentResponse` with `status: "accepted"` and `accepted_at` set.

**Error:** `403` if driver does not own this assignment.

---

### 12E.4 — POST `/api/v1/operations/assignments/{assignment_id}/reject`

**Auth:** Authority or owning Driver  
**Purpose:** Reject a pending assignment with a mandatory reason.

**Request Body:**

```json
{ "reject_reason": "Vehicle breakdown, cannot complete shift" }
```

| Field           | Type   | Required | Constraints      |
| --------------- | ------ | -------- | ---------------- |
| `reject_reason` | string | ✅       | 1–255 characters |

**Response `200 OK`:** Updated `RouteAssignmentResponse` with `status: "rejected"` and `rejected_at` set.

---

### 12F. Route Stops

> **Authority:** View all stops, update any stop.  
> **Driver:** View stops for their assigned routes only, update stops on active routes.

Route stops are the individual collection points within a route.

---

### 12F.1 — GET `/api/v1/operations/routes/{route_id}/stops`

**Auth:** Authority or Driver  
**Purpose:** List all stops on a route.

**Query Parameters:** `limit` (default 100, max 500), `offset`

> **Driver Scoping:** Drivers can only view stops for routes they are assigned to. Returns `403` otherwise.

**Response `200 OK`:**

```json
{
  "total": 5,
  "limit": 100,
  "offset": 0,
  "items": [
    {
      "id": 501,
      "route_id": 77,
      "stop_sequence": 1,
      "bin_id": 101,
      "planned_eta": "2026-04-18T06:30:00",
      "planned_service_minutes": 4.0,
      "priority_snapshot": 0.94,
      "status": "pending",
      "actual_arrival": null,
      "actual_departure": null,
      "skip_reason": null
    }
  ]
}
```

**Stop Status Flow:** `pending` → `arrived` → `serviced` or `skipped`

---

### 12F.2 — POST `/api/v1/operations/stops/{stop_id}/arrive`

**Auth:** Authority or Driver  
**Purpose:** Record arrival at a stop. Transitions stop status to `arrived`.

**Path Parameter:** `stop_id` (int)

**Headers:**
| Header | Description |
|---|---|
| `Idempotency-Key` | Optional unique key to prevent duplicate submissions on retry |

**Request Body:**

```json
{
  "actual_arrival": "2026-04-18T06:28:00",
  "gps_latitude": 13.0855,
  "gps_longitude": 80.2105,
  "notes": "Arrived on time"
}
```

| Field            | Type     | Required | Description                              |
| ---------------- | -------- | -------- | ---------------------------------------- |
| `actual_arrival` | datetime | ❌       | Defaults to server time if omitted       |
| `gps_latitude`   | float    | ❌       | Driver's GPS latitude at time of action  |
| `gps_longitude`  | float    | ❌       | Driver's GPS longitude at time of action |
| `notes`          | string   | ❌       | Optional note                            |

**Response `200 OK`:** Updated `RouteStopResponse` with `status: "arrived"` and `actual_arrival` set.

---

### 12F.3 — POST `/api/v1/operations/stops/{stop_id}/service`

**Auth:** Authority or Driver  
**Purpose:** Record completion of bin service. Transitions stop status to `serviced`.

**Headers:** `Idempotency-Key` (optional)

**Request Body:**

```json
{
  "actual_departure": "2026-04-18T06:35:00",
  "fill_before_pct": 82.5,
  "fill_after_pct": 3.0,
  "gps_latitude": 13.0855,
  "gps_longitude": 80.2105,
  "notes": "Bin emptied, slight overflow detected",
  "photo_url": "https://cdn.example.com/photos/stop-501.jpg"
}
```

| Field              | Type     | Required | Constraints                          |
| ------------------ | -------- | -------- | ------------------------------------ |
| `actual_departure` | datetime | ❌       | Defaults to server time              |
| `fill_before_pct`  | float    | ❌       | 0–100, fill % before collection      |
| `fill_after_pct`   | float    | ❌       | 0–100, fill % after collection       |
| `gps_latitude`     | float    | ❌       | GPS latitude                         |
| `gps_longitude`    | float    | ❌       | GPS longitude                        |
| `notes`            | string   | ❌       | Optional note                        |
| `photo_url`        | string   | ❌       | Max 255 chars, URL to evidence photo |

**Response `200 OK`:** Updated `RouteStopResponse` with `status: "serviced"`.

---

### 12F.4 — POST `/api/v1/operations/stops/{stop_id}/skip`

**Auth:** Authority or Driver  
**Purpose:** Mark a stop as skipped with a mandatory reason.

**Headers:** `Idempotency-Key` (optional)

**Request Body:**

```json
{
  "reason": "Road blocked due to construction",
  "actual_departure": "2026-04-18T06:32:00",
  "gps_latitude": 13.0855,
  "gps_longitude": 80.2105,
  "notes": "Will retry tomorrow"
}
```

| Field              | Type     | Required | Constraints             |
| ------------------ | -------- | -------- | ----------------------- |
| `reason`           | string   | ✅       | 1–255 characters        |
| `actual_departure` | datetime | ❌       | Defaults to server time |
| `gps_latitude`     | float    | ❌       | GPS latitude            |
| `gps_longitude`    | float    | ❌       | GPS longitude           |
| `notes`            | string   | ❌       | Additional notes        |

**Response `200 OK`:** Updated `RouteStopResponse` with `status: "skipped"` and `skip_reason` set.

---

## 13. Analytics Routes

> **Authentication:** Authority only (admin or operator).

All analytics routes require `from` and `to` timestamp parameters.

---

### 13.1 — GET `/api/v1/analytics/efficiency`

**Purpose:** Collection efficiency metrics for a time range.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `from` | datetime | ✅ | Start of time range (ISO datetime) |
| `to` | datetime | ✅ | End of time range (ISO datetime) |

**Response `200 OK`:**

```json
{
  "from_ts": "2026-04-01T00:00:00",
  "to_ts": "2026-04-17T00:00:00",
  "total_collections": 324,
  "total_routes": 28,
  "total_distance_km": 1842.6,
  "total_active_hours": 196.5,
  "collections_per_hour": 1.65,
  "distance_per_collection_km": 5.69
}
```

---

### 13.2 — GET `/api/v1/analytics/savings`

**Purpose:** Optimization savings compared to naive (sequential) routing.

**Query Parameters:** `from` (datetime, required), `to` (datetime, required)

**Response `200 OK`:**

```json
{
  "from_ts": "2026-04-01T00:00:00",
  "to_ts": "2026-04-17T00:00:00",
  "routes_analyzed": 28,
  "optimized_distance_km": 1842.6,
  "naive_distance_km": 2658.3,
  "distance_saved_km": 815.7,
  "distance_saved_pct": 30.7,
  "optimized_fuel_l": 368.5,
  "naive_fuel_l": 531.7,
  "fuel_saved_l": 163.2,
  "fuel_saved_pct": 30.7
}
```

---

### 13.3 — GET `/api/v1/analytics/environmental`

**Purpose:** Environmental impact (CO₂ reduction) from optimized routing.

**Query Parameters:** `from` (datetime, required), `to` (datetime, required)

**Response `200 OK`:**

```json
{
  "from_ts": "2026-04-01T00:00:00",
  "to_ts": "2026-04-17T00:00:00",
  "optimized_co2_kg": 975.3,
  "naive_co2_kg": 1406.8,
  "co2_saved_kg": 431.5,
  "co2_reduction_pct": 30.7,
  "fuel_saved_l": 163.2,
  "distance_saved_km": 815.7
}
```

---

## 14. Notification Routes

> **Authentication:** Authority or Driver JWT required.

In-app notifications are per-user alerts for events like new assignments, route publishes, and alert escalations.

---

### 14.1 — GET `/api/v1/notifications/in-app`

**Purpose:** Fetch the authenticated user's notifications.

**Query Parameters:**
| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | int | 50 | Page size (max 100) |
| `offset` | int | 0 | Skip N |
| `unread_only` | bool | false | Only return unread notifications |
| `severity` | string | — | Filter by severity level |
| `event_type` | string | — | Filter by event type |

**Response `200 OK`:**

```json
{
  "total": 8,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": 201,
      "org_id": 7,
      "user_id": 15,
      "event_type": "route_assignment",
      "severity": "info",
      "title": "New route assigned to you",
      "message": "You have been assigned route ROUTE-2026-04-18-N01",
      "payload_json": { "route_id": 77, "route_code": "ROUTE-2026-04-18-N01" },
      "is_read": false,
      "read_at": null,
      "created_at": "2026-04-17T11:30:00",
      "updated_at": "2026-04-17T11:30:00"
    }
  ]
}
```

---

### 14.2 — POST `/api/v1/notifications/in-app/{notification_id}/read`

**Purpose:** Mark one notification as read.

**Path Parameter:** `notification_id` (int)

**Request Body:** None

**Response `200 OK`:** Updated `InAppNotificationResponse` with `is_read: true` and `read_at` set.

**Error:** `404` if notification not found or doesn't belong to the caller.

---

### 14.3 — POST `/api/v1/notifications/in-app/read-all`

**Purpose:** Mark all of the caller's unread notifications as read in one shot.

**Request Body:** None

**Response `200 OK`:**

```json
{ "updated": 8 }
```

---

### 14.4 — GET `/api/v1/notifications/in-app/stream`

**Purpose:** Server-Sent Events (SSE) real-time stream for new notifications.

**Auth:** Bearer JWT passed either as `Authorization: Bearer <token>` header or `?token=<token>` query parameter.

**Media Type:** `text/event-stream`

**Events:**

```
event: connected
data: {"type":"connected","user_id":15}

event: notification
data: {"type":"notification","notification":{...InAppNotificationResponse...}}

event: heartbeat
data: {}
```

> **Integration Note:** Keep-alive heartbeats are sent every 20 seconds. Reconnect if the stream drops.

---

## 15. Realtime Channels

> **Authentication:** Bearer JWT required.

---

### 15.1 — WS `/api/v1/realtime/ws/bin-states`

**Purpose:** WebSocket stream delivering real-time bin state updates for all bins in the organization (pushed whenever a new MQTT telemetry message is ingested).

**Auth:** Pass JWT as either:

- Query parameter: `ws://host/api/v1/realtime/ws/bin-states?token=<access_token>`
- Or `Authorization: Bearer <token>` header on upgrade

**On Connect, server sends:**

```json
{
  "event": "connected",
  "org_id": 7,
  "user_id": 15,
  "message": "Subscribed to realtime bin state updates"
}
```

**Subsequent Messages (pushed by server on each telemetry update):**

```json
{
  "event": "bin_state_update",
  "bin_code": "BIN-A001",
  "org_id": 7,
  "fill_pct": 79.2,
  "alert_level": "YELLOW",
  "overflow_imminent": false,
  "device_connectivity_state": "online",
  "updated_at": "2026-04-17T10:05:00"
}
```

**Client can send:** Any text message (acts as a heartbeat/ping; server ignores content)

**Connection close codes:**
| Code | Reason |
|---|---|
| `1008 Policy Violation` | Invalid or missing token |

---

## 16. MQTT Ingest Route

> **Authentication:** `X-API-Key` header (not JWT Bearer).

This route is used by the MQTT bridge/adapter service. Frontend apps typically **do not** call this directly.

---

### 16.1 — POST `/api/v1/mqtt/ingest`

**Purpose:** Ingest one MQTT sensor message and trigger immediate telemetry evaluation and alert lifecycle updates.

**Headers:**

```
X-API-Key: <mqtt_ingest_api_key>
Content-Type: application/json
```

**Request Body:**

```json
{
  "topic": "smartbin/BIN-A001/data",
  "payload": {
    "fill_pct": 82.4,
    "fill_rate": 0.12,
    "ttf_min": 148,
    "priority": 0.91,
    "alert": "RED",
    "overflow_imminent": false,
    "queued": 0,
    "unix_ms": 1744892400000
  },
  "qos": 0,
  "retain": false,
  "received_at": "2026-04-17T10:00:00"
}
```

| Field         | Type     | Required | Constraints                                                          |
| ------------- | -------- | -------- | -------------------------------------------------------------------- |
| `topic`       | string   | ✅       | Pattern: `smartbin/{bin_token}/data` or `smartbin/{bin_token}/alert` |
| `payload`     | object   | ✅       | Key-value telemetry data                                             |
| `qos`         | int      | ❌       | Default `0`, range 0–2                                               |
| `retain`      | bool     | ❌       | Default `false`                                                      |
| `received_at` | datetime | ❌       | Defaults to server time                                              |

**Accepted Topic Patterns:**
| Pattern | Purpose |
|---|---|
| `smartbin/{bin_token}/data` | Telemetry update (fill %, rates, priority) |
| `smartbin/{bin_token}/alert` | Connectivity status or alert level change |

**Payload Fields for `/data` topic:**
| Field | Description |
|---|---|
| `fill_pct` | Current fill percentage (0–100) |
| `fill_rate` | Fill rate in % per minute |
| `ttf_min` | Time-to-full in minutes |
| `priority` | Computed priority score |
| `alert` | Alert level: `"GREEN"`, `"YELLOW"`, `"RED"` |
| `overflow_imminent` | Boolean flag |
| `queued` | Number of queued local readings |
| `unix_s` / `unix_ms` / `uptime_s` | Timestamp fields (one is used for inference) |

**Response `201 Created`:**

```json
{
  "status": "ok",
  "raw_message_id": 8821,
  "bin_code": "BIN-A001",
  "telemetry_id": 5023,
  "evaluation": {
    "fill_threshold_alert": "opened",
    "overflow_alert": null
  }
}
```

**Error Responses:**
| Status | When |
|---|---|
| `401 Unauthorized` | Missing or invalid `X-API-Key` |
| `400 Bad Request` | Invalid topic pattern or unresolvable bin token |

---

## 17. Error Codes Reference

| HTTP Status                | Meaning                         | Common Cause                                       |
| -------------------------- | ------------------------------- | -------------------------------------------------- |
| `200 OK`                   | Success                         | —                                                  |
| `201 Created`              | Resource created                | POST endpoints                                     |
| `400 Bad Request`          | Validation failed               | Missing required fields, constraint violations     |
| `401 Unauthorized`         | Not authenticated               | Missing/expired/invalid JWT or API key             |
| `403 Forbidden`            | Not authorized                  | Wrong role, driver accessing another driver's data |
| `404 Not Found`            | Resource not found              | Invalid ID, not in org                             |
| `409 Conflict`             | Duplicate / constraint conflict | Duplicate code/email, last-admin protection        |
| `422 Unprocessable Entity` | Schema validation failure       | FastAPI automatic Pydantic validation error        |

**Error Response Shape:**

```json
{
  "detail": "bin not found"
}
```

For `422` validation errors:

```json
{
  "detail": [
    {
      "loc": ["body", "email"],
      "msg": "value is not a valid email address",
      "type": "value_error.email"
    }
  ]
}
```

---

## 18. Integration Workflow Guide

### Setup Order (First-Time)

Implement in this exact order to avoid foreign-key dependency errors:

```
1. Auth: Login → store access_token + refresh_token
2. Master Data:
   a. Create Depots  (/master-data/depots)
   b. Create Service Areas  (/master-data/service-areas)
3. Users:
   a. Create Driver users  (/auth/drivers)
   b. Create Driver Profiles  (/master-data/driver-profiles)
4. Infrastructure:
   a. Create Bins  (/bins)
   b. Create Devices  (/devices)
   c. Assign Devices to Bins  (/devices/{id}/assign)
5. Operations:
   a. Create Vehicles  (/operations/vehicles)
   b. Create Shifts  (/operations/shifts)
   c. Plan Routes  (/operations/routes/plan) — preview
   d. Create Draft Routes  (/operations/routes)
   e. Publish Routes  (/operations/routes/{id}/publish)
   f. Create Assignments  (/operations/routes/{id}/assignments)
6. Dashboard:
   a. Connect WebSocket: ws://.../realtime/ws/bin-states
   b. Poll: GET /telemetry/live/summary (or use WebSocket)
   c. Poll: GET /alerts (filter status=open)
   d. Connect SSE: GET /notifications/in-app/stream
```

---

### Driver App Workflow

```
1. POST /auth/login  → get tokens
2. GET /operations/shifts?status=scheduled  → see upcoming shifts
3. POST /operations/shifts/{id}/start  → start the shift
4. GET /notifications/in-app/stream  → listen for assignment notifications
5. POST /operations/assignments/{id}/accept  → accept the route assignment
6. GET /operations/routes/{route_id}  → load route details
7. GET /operations/routes/{route_id}/stops  → load all stops
8. For each stop:
   a. POST /operations/stops/{stop_id}/arrive  → mark arrived
   b. POST /operations/stops/{stop_id}/service  → mark serviced (or skip)
9. POST /operations/routes/{route_id}/complete  → complete the route
10. POST /operations/shifts/{id}/complete  → complete the shift
```

---

### Authority Dashboard Workflow

```
1. POST /auth/login  → get tokens
2. GET /telemetry/live/summary  → dashboard cards
3. GET /alerts?status=open  → active alerts
4. WS /realtime/ws/bin-states  →  live updates
5. GET /analytics/efficiency?from=...&to=...  → reporting
6. GET /analytics/savings?from=...&to=...
7. GET /analytics/environmental?from=...&to=...
8. POST /operations/routes/plan  → plan a route
9. POST /operations/routes  → create from plan
10. POST /operations/routes/{id}/publish  → publish
11. POST /operations/routes/{id}/assignments  → assign driver + vehicle
```

---

### Token Refresh Strategy

```
On every API call:
  if response.status == 401:
    call POST /auth/refresh with stored refresh_token
    if success: store new access_token, retry original request
    if 401 again: redirect user to login screen
```

---

### Idempotency Keys (Stop Events)

For stop arrive/service/skip, pass `Idempotency-Key` header to safely retry on network failure:

```
Idempotency-Key: <uuid-v4>
```

Generate a unique UUID per action. If the same key is sent twice, the server will return the same response without duplicating the event.

---

_Document generated from source code on 2026-04-18. Covers backend version at commit state as of ROUTES_IMPLEMENTATION_STATUS.md dated 2026-04-17._
