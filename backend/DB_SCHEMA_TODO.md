# Smart Bin Database Schema TODO

## Phase 0 - Precheck

- [x] Confirm PostgreSQL is running and `DATABASE_URL` points to `smart_waste_db`
- [x] Ensure `alembic current` runs without errors
- [ ] Create DB backup if working on shared environment

## Phase 1 - Core Master Data (Identity + Assets)

- [x] Apply migration: `20260417_01_core_master_data`
- [x] Verify tables: organizations, users, roles, user_roles
- [x] Verify tables: depots, service_areas, bins
- [x] Verify tables: bin_devices, bin_device_history
- [x] Verify tables: driver_profiles, authority_profiles
- [ ] Seed initial role mappings for authority/driver users

## Phase 2 - Telemetry + Alerts

- [x] Apply migration: `20260417_02_telemetry_alerts`
- [x] Verify MQTT raw ingestion table and indexes
- [x] Verify telemetry history and current state tables
- [x] Verify connectivity event table
- [x] Verify alert_rules, alerts, alert_events
- [ ] Connect MQTT consumer to write into these tables

## Phase 3 - Routes + Collection + Prediction + Audit

- [x] Apply migration: `20260417_03_operations_prediction_audit`
- [x] Verify vehicles, shifts, routes, route_stops, route_assignments
- [x] Verify collection_events
- [x] Verify prediction_models, fill_forecasts, optimization_runs
- [x] Verify audit_logs and query indexes

## Phase 4 - Validation

- [x] Run `alembic history` and `alembic current`
- [ ] Insert one org, one authority, one driver, one bin, one device
- [ ] Publish one sample MQTT payload and verify telemetry ingest
- [ ] Create one alert and one route assignment flow end-to-end
