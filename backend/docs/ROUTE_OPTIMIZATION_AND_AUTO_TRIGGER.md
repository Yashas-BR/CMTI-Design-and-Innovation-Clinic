# Route Optimization and Auto-Optimization Trigger

## Purpose

This document explains how route optimization is implemented in the backend and how automatic optimization is triggered from live MQTT ingestion events.

It is designed for architecture walkthrough and jury presentation.

## Scope

- Manual route optimization preview
- Auto route draft generation from live state
- MQTT-triggered auto optimization
- Key database tables and fields involved
- Runtime configuration controls

## 1) High-Level Flow

### 1.1 Manual Planning Flow

1. Authority user calls POST /api/v1/operations/routes/plan.
2. Backend selects candidate bins from live bin state and filters by threshold parameters.
3. Backend resolves route start point (depot or fallback strategy).
4. Backend builds a travel matrix (OSRM/local graph/haversine fallback).
5. Backend solves route order:
   - Single vehicle: greedy nearest-neighbor + 2-opt improvement.
   - Multi-vehicle: OR-Tools VRP, with greedy fallback if OR-Tools is unavailable.
6. Backend returns a plan preview (no route persistence in this endpoint).

### 1.2 Auto Planning Flow

1. Trigger can come from:
   - POST /api/v1/operations/routes/auto-plan (manual trigger), or
   - MQTT data ingestion pipeline (automatic trigger).
2. Backend checks planner enabled/cooldown guards.
3. Backend selects threshold-matching bins from live state.
4. Bins are clustered by (depot_id, area_id).
5. Each cluster is optimized using the same plan_route logic.
6. Overlap guard prevents creating near-duplicate active routes.
7. Backend persists:
   - optimization_runs record,
   - draft routes,
   - ordered route_stops.

## 2) Where It Is Implemented

### 2.1 API Endpoints

- Operations endpoints: backend/app/api/v1/operations.py
  - POST /operations/routes/plan
  - POST /operations/routes/auto-plan
  - POST /operations/routes (create draft)

### 2.2 Planning Service

- Core planning + auto generation: backend/app/services/operations_routes.py
  - plan_route(...)
  - auto_plan_routes_from_live_state(...)

### 2.3 Matrix Provider Layer

- Routing matrix provider logic: backend/app/services/operations_routing.py
  - OSRM table provider
  - local_dijkstra provider
  - haversine fallback

### 2.4 Start Point Resolution

- Start-point decision chain: backend/app/services/operations_common.py
  - resolve_start_point_for_planning(...)
  - resolve_route_start_point(...)

### 2.5 MQTT Auto Trigger

- Ingestion pipeline trigger point: backend/app/services/mqtt_ingestion.py
  - After successful data-channel state update and commit, auto planner is invoked when enabled.

## 3) Manual Route Optimization Details

## 3.1 Candidate Bin Selection

Function: \_get_candidate_bins(...)

Source tables:

- bins
- bin_current_state (left join)

Candidate filters:

- bins.org_id == caller org
- bins.is_active == true
- optional include_bin_ids
- threshold logic:
  - overflow_only=true: only overflow_imminent bins
  - else: overflow_imminent OR fill_pct >= min_fill_pct

Priority scoring combines:

- fill percentage,
- overflow flag,
- current telemetry priority score,
- time-to-full pressure.

## 3.2 Start Point Resolution Order

Function: resolve_start_point_for_planning(...)

Fallback order:

1. Explicit route depot (if provided).
2. Driver home depot.
3. Dominant depot among candidate bins.
4. Dominant service area center among candidate bins.
5. Error if none can resolve with coordinates.

## 3.3 Travel Cost Matrix

Function: build_travel_cost_matrix(...)

Provider behavior:

- route_matrix_provider=osrm:
  - Calls OSRM table API for pairwise distance.
- route_matrix_provider=local_dijkstra:
  - Computes shortest paths on local graph JSON.
- If provider fails/unavailable:
  - Falls back to haversine matrix.

## 3.4 Solver Strategy

### Single Vehicle

- Build route with greedy nearest-neighbor under shift-duration constraints.
- Apply 2-opt local search to reduce total path distance.

### Multi Vehicle

- Preferred: OR-Tools VRP model with dimensions:
  - arc travel cost,
  - capacity,
  - stop count,
  - time budget.
- If OR-Tools is unavailable/fails:
  - Greedy multi-vehicle assignment fallback.

## 3.5 Output Metrics

RoutePlanResponse includes:

- algorithm
- candidates_considered
- selected_stops
- skipped_due_to_shift
- estimated_distance_km
- estimated_duration_min
- baseline_distance_km (when available)
- estimated_fuel_saved_liters
- recommended_start_at
- efficiency_reasoning[]

Audit:

- route_plan_preview audit entry is written when actor_user_id is available.

## 4) Auto Optimization Details

Function: auto_plan_routes_from_live_state(...)

## 4.1 Trigger Conditions

- route_auto_plan_enabled must be true (unless force=true).
- Cooldown guard checks recent completed auto runs in optimization_runs.

## 4.2 Candidate and Cluster Preparation

- Candidate bins fetched from live state using auto thresholds:
  - route_auto_plan_min_fill_pct
  - route_auto_plan_overflow_only
- Cluster key: (depot_id, area_id)
- Clusters below route_auto_plan_min_stops are skipped.

## 4.3 Cluster Planning

For each eligible cluster:

1. Call plan_route(...) with include_bin_ids = cluster bins.
2. Enforce minimum optimized stop count.
3. Apply overlap guard against active routes for same date:
   - Active statuses considered: draft, published, in_progress.
   - Skip if overlap ratio >= route_auto_plan_overlap_threshold (unless force).

## 4.4 Persistence

For each accepted cluster:

1. Create optimization_runs record with:
   - algorithm_name = auto_monitoring_route_planner
   - input snapshot and result summary JSON.
2. Create draft route using create_route_draft(...).
3. Insert ordered route_stops.
4. Return summary with created_count, skipped_count, reasons, created_routes.

Auto route code format:

- AUTO-YYYYMMDD-<cluster-token>-<hhmmss>-<seq>

## 5) MQTT-Driven Auto Trigger

In backend/app/services/mqtt_ingestion.py:

1. ESP32 payload is ingested and validated.
2. Data is persisted to:
   - mqtt_raw_messages,
   - bin_telemetry,
   - bin_current_state (upsert).
3. If state changed:
   - realtime broadcast is emitted,
   - then auto planner is invoked if:
     - channel == data,
     - current_state_changed == true,
     - route_auto_plan_enabled == true.

Auto trigger call:

- auto_plan_routes_from_live_state(
  org_id=bin_obj.org_id,
  actor_user_id=settings.route_auto_plan_system_user_id
  )

The ingest response may include:

- auto_plan.triggered
- auto_plan.created_count
- auto_plan.skipped_count

## 6) Database Tables and Key Fields

## 6.1 Input and Live State

- bins
  - id
  - org_id
  - bin_code
  - depot_id
  - area_id
  - is_active
  - latitude, longitude
- bin_current_state
  - bin_id
  - current_fill_pct
  - current_priority_score
  - current_ttf_min
  - overflow_imminent

## 6.2 Optimization and Route Persistence

- optimization_runs
  - id
  - org_id
  - algorithm_name
  - algorithm_version
  - input_snapshot_json
  - result_summary_json
  - status
  - run_started_at, run_completed_at
- routes
  - id
  - org_id
  - route_code
  - route_date
  - depot_id
  - status
  - optimization_run_id
- route_stops
  - id
  - route_id
  - stop_sequence
  - bin_id
  - status

## 6.3 Trigger Source (MQTT)

- mqtt_raw_messages
- bin_telemetry

## 7) Runtime Configuration (Important for Demo)

From backend/app/core/config.py:

- route_matrix_provider
- route_matrix_osrm_base_url
- route_matrix_osrm_profile
- route_matrix_timeout_seconds
- route_matrix_local_graph_file

Auto planner controls:

- route_auto_plan_enabled
- route_auto_plan_min_fill_pct
- route_auto_plan_overflow_only
- route_auto_plan_min_stops
- route_auto_plan_max_stops
- route_auto_plan_target_shift_minutes
- route_auto_plan_avg_speed_kmph
- route_auto_plan_service_minutes_per_stop
- route_auto_plan_cooldown_minutes
- route_auto_plan_overlap_threshold
- route_auto_plan_default_start_hour_utc
- route_auto_plan_system_user_id
- route_plan_efficiency_baseline_km_per_liter

## 8) Suggested Jury Demo Script

1. Show a manual planning call to /operations/routes/plan with custom parameters.
2. Explain candidate selection and start-point resolution from live state.
3. Show algorithm and output metrics (distance, duration, recommended start).
4. Trigger /operations/routes/auto-plan and show created draft routes.
5. Explain overlap and cooldown guards to avoid duplicate plans.
6. Send one MQTT data payload and show that ingestion can invoke auto planning.
7. Show created optimization_runs metadata and linked routes.

## 9) Why This Design Is Production-Friendly

- Deterministic preview endpoint for explainable planning output.
- Multiple matrix providers with fallback for resiliency.
- OR-Tools integration with graceful fallback path.
- Overlap and cooldown guards for operational safety.
- Automatic route generation can react to live telemetry events.
- Audit and optimization metadata preserved for traceability.
