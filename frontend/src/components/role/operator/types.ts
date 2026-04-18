export type DriverUser = {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  role_keys: string[];
};

export type DriverProfile = {
  id: number;
  user_id: number;
  license_no: string | null;
  license_expiry: string | null;
  home_depot_id: number | null;
  employment_status: string;
  created_at: string;
  updated_at: string;
};

export type DepotItem = {
  id: number;
  name: string;
};

export type DriverRow = {
  user: DriverUser;
  profile: DriverProfile | null;
  homeDepotName: string | null;
};

export type CreateDriverFormPayload = {
  full_name: string;
  email: string;
  password: string;
  phone: string;
  employment_status: string;
  license_no: string;
  license_expiry: string;
  home_depot_id: string;
};

export type DriverProfileFormPayload = {
  employment_status: string;
  license_no: string;
  license_expiry: string;
  home_depot_id: string;
};

export type DepotRecord = {
  id: number;
  org_id: number;
  name: string;
  address: string | null;
  contact_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DepotCreateFormPayload = {
  name: string;
  address: string;
  contact_phone: string;
  latitude: string;
  longitude: string;
  is_active: string;
};

export type ServiceAreaRecord = {
  id: number;
  org_id: number;
  name: string;
  center_latitude: number | null;
  center_longitude: number | null;
  boundary_geojson: Record<string, unknown> | null;
  priority_weight: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ServiceAreaFormPayload = {
  name: string;
  center_latitude: string;
  center_longitude: string;
  boundary_geojson: string;
  priority_weight: string;
  is_active: string;
};

export type BinRecord = {
  id: number;
  org_id: number;
  bin_code: string;
  display_name: string | null;
  address_line: string | null;
  area_id: number | null;
  depot_id: number | null;
  latitude: number | null;
  longitude: number | null;
  capacity_liters: number | null;
  bin_height_cm: number;
  dead_zone_cm: number;
  threshold_green: number;
  threshold_yellow: number;
  distance_factor: number;
  status: string;
  installed_at: string | null;
  last_service_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BinFormPayload = {
  bin_code: string;
  display_name: string;
  address_line: string;
  area_id: string;
  depot_id: string;
  latitude: string;
  longitude: string;
  capacity_liters: string;
  bin_height_cm: string;
  dead_zone_cm: string;
  threshold_green: string;
  threshold_yellow: string;
  distance_factor: string;
  status: string;
  installed_at: string;
  last_service_at: string;
  is_active: string;
};

export type DeviceRecord = {
  id: number;
  bin_id: number;
  org_id: number;
  device_uid: string;
  mqtt_client_id: string;
  firmware_version: string | null;
  hardware_revision: string | null;
  status: string;
  installed_at: string | null;
  decommissioned_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceFormPayload = {
  bin_id: string;
  device_uid: string;
  mqtt_client_id: string;
  firmware_version: string;
  hardware_revision: string;
  status: string;
  installed_at: string;
  decommissioned_at: string;
  last_seen_at: string;
};

export type VehicleRecord = {
  id: number;
  org_id: number;
  vehicle_no: string;
  vehicle_type: string | null;
  capacity_kg: number | null;
  status: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ShiftRecord = {
  id: number;
  org_id: number;
  driver_user_id: number;
  vehicle_id: number | null;
  planned_start: string;
  planned_end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RouteStartPoint = {
  source: string;
  depot_id: number | null;
  area_id: number | null;
  latitude: number | null;
  longitude: number | null;
};

export type RouteOptimizationSummary = {
  planner_type: string;
  algorithm: string;
  recommended_start_at: string | null;
  baseline_distance_km: number | null;
  estimated_distance_km: number | null;
  estimated_fuel_saved_liters: number | null;
  selected_stops: number | null;
  candidates_considered: number | null;
  skipped_due_to_shift: number | null;
  cluster_depot_id: number | null;
  cluster_area_id: number | null;
  efficiency_reasoning: string[];
};

export type RouteRecord = {
  id: number;
  org_id: number;
  route_code: string;
  route_date: string;
  depot_id: number | null;
  status: string;
  total_distance_km: number | null;
  estimated_duration_min: number | null;
  optimization_run_id: number | null;
  created_by: number | null;
  updated_by: number | null;
  stops_count: number | null;
  start_point: RouteStartPoint | null;
  auto_generated: boolean;
  optimization_summary: RouteOptimizationSummary | null;
  created_at: string;
  updated_at: string;
};

export type RoutePlanStopRecord = {
  stop_sequence: number;
  bin_id: number;
  bin_code: string;
  latitude: number;
  longitude: number;
  fill_pct: number | null;
  priority_score: number;
  estimated_load_kg: number | null;
  vehicle_id: number | null;
  vehicle_no: string | null;
  planned_leg_km: number;
  planned_cumulative_km: number;
};

export type RoutePlanResult = {
  algorithm: string;
  route_date: string;
  candidates_considered: number;
  selected_stops: number;
  skipped_due_to_shift: number;
  estimated_distance_km: number;
  estimated_duration_min: number;
  start_point: RouteStartPoint;
  items: RoutePlanStopRecord[];
  unassigned_bin_ids: number[];
  total_estimated_load_kg: number | null;
  baseline_distance_km: number | null;
  estimated_fuel_saved_liters: number | null;
  recommended_start_at: string | null;
  efficiency_reasoning: string[];
};

export type RouteAutoPlanResult = {
  route_date: string;
  triggered: boolean;
  created_count: number;
  skipped_count: number;
  created_routes: RouteRecord[];
  reasons: string[];
};

export type RouteAssignmentRecord = {
  id: number;
  route_id: number;
  driver_user_id: number;
  vehicle_id: number | null;
  assigned_by: number | null;
  assigned_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  status: string;
};

export type RouteStopRecord = {
  id: number;
  route_id: number;
  stop_sequence: number;
  bin_id: number;
  planned_eta: string | null;
  planned_service_minutes: number | null;
  priority_snapshot: number | null;
  status: string;
  actual_arrival: string | null;
  actual_departure: string | null;
  skip_reason: string | null;
};
