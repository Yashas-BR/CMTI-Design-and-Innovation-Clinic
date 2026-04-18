/**
 * adminSimulatorApi.ts
 * ---------------------
 * API helpers for the authority_admin IoT simulator dashboard.
 * All functions call the new /simulator backend routes (bearer-auth only,
 * no MQTT ingest key needed from the browser).
 */

import axios from "axios";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BinRecord {
  id: number;
  bin_code: string;
  display_name: string | null;
  address_line: string | null;
  area_id: number | null;
  latitude: number | null;
  longitude: number | null;
  capacity_liters: number | null;
  threshold_green: number;
  threshold_yellow: number;
  status: string;
  is_active: boolean;
}

export interface ServiceArea {
  id: number;
  name: string;
  center_latitude: number | null;
  center_longitude: number | null;
  boundary_geojson: object | null;
  priority_weight: number;
  is_active: boolean;
}

export interface SimTelemetryPayload {
  bin_code: string;
  fill_pct?: number | null;
  fill_rate?: number | null;
  ttf_min?: number | null;
  priority?: number | null;
  alert?: "GREEN" | "YELLOW" | "RED" | null;
  overflow_imminent?: boolean;
  queued?: boolean;
  connectivity_status?: "online" | "offline" | null;
  uptime_s?: number | null;
}

export interface SimPushResponse {
  status: string;
  raw_message_id: number;
  bin_code: string | null;
  telemetry_id: number | null;
  evaluation: Record<string, unknown>;
}

export interface SimBulkPushResponse {
  pushed: number;
  failed: number;
  errors: Array<{ bin_code: string; error: string }>;
}

// ─── Master-data fetchers ────────────────────────────────────────────────────

export async function fetchAllBins(
  apiBase: string,
  accessToken: string,
): Promise<BinRecord[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  // paginate through all bins (max 100 per request)
  const allBins: BinRecord[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data } = await axios.get<{ total: number; items: BinRecord[] }>(
      `${apiBase}/bins`,
      { headers, params: { limit, offset, is_active: true } },
    );
    allBins.push(...data.items);
    if (allBins.length >= data.total) break;
    offset += limit;
  }
  return allBins;
}

export async function fetchAllServiceAreas(
  apiBase: string,
  accessToken: string,
): Promise<ServiceArea[]> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const allAreas: ServiceArea[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data } = await axios.get<{
      total: number;
      items: ServiceArea[];
    }>(`${apiBase}/master-data/service-areas`, {
      headers,
      params: { limit, offset, is_active: true },
    });
    allAreas.push(...data.items);
    if (allAreas.length >= data.total) break;
    offset += limit;
  }
  return allAreas;
}

// ─── Simulator push helpers ──────────────────────────────────────────────────

export async function pushTelemetry(
  apiBase: string,
  accessToken: string,
  payload: SimTelemetryPayload,
): Promise<SimPushResponse> {
  const { data } = await axios.post<SimPushResponse>(
    `${apiBase}/simulator/push-telemetry`,
    payload,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return data;
}

export async function pushBulkTelemetry(
  apiBase: string,
  accessToken: string,
  readings: SimTelemetryPayload[],
): Promise<SimBulkPushResponse> {
  const { data } = await axios.post<SimBulkPushResponse>(
    `${apiBase}/simulator/push-bulk-telemetry`,
    { readings },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return data;
}

// ─── Telemetry computation helpers ──────────────────────────────────────────

/** Derive alert level from fill % and bin thresholds. */
export function computeAlertLevel(
  fillPct: number,
  thresholdGreen: number,
  thresholdYellow: number,
): "GREEN" | "YELLOW" | "RED" {
  if (fillPct >= thresholdYellow) return "RED";
  if (fillPct >= thresholdGreen) return "YELLOW";
  return "GREEN";
}

/** Derive fill-rate in % per minute from % per tick and tick interval seconds. */
export function fillRatePerMin(fillRatePctPerTick: number, tickIntervalSec: number): number {
  if (tickIntervalSec <= 0) return 0;
  return (fillRatePctPerTick / tickIntervalSec) * 60;
}

/** Time to full in minutes from current fill and fill rate per min. */
export function computeTtfMin(currentFill: number, ratePerMin: number): number {
  if (ratePerMin <= 0) return 9999;
  return Math.max(0, (100 - currentFill) / ratePerMin);
}

/** Clamp value between [0, 100] */
export function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Generate a random number in [min, max] */
export function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
