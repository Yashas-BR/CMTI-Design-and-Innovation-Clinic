/**
 * AdminSimulatorPanel.tsx
 * -----------------------
 * Root orchestration component for the authority_admin dashboard simulator panel.
 *
 * Responsibilities:
 *  - Fetch all bins and service areas on mount
 *  - Maintain a WebSocket connection to /realtime/ws/bin-states for live state
 *  - Keep per-area simulation state (config + running interval refs)
 *  - Render the map + area modal
 *  - Execute simulation ticks: increment fill, call backend pushBulkTelemetry
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAllBins,
  fetchAllServiceAreas,
  pushBulkTelemetry,
  pushTelemetry,
  clamp,
  randBetween,
  fillRatePerMin,
  computeTtfMin,
  computeAlertLevel,
  type BinRecord,
  type ServiceArea,
  type SimTelemetryPayload,
} from "@/lib/adminSimulatorApi";
import AdminSimulatorMap, { type AreaSimStatus } from "./AdminSimulatorMap";
import AreaSimulatorModal, {
  DEFAULT_SIM_CONFIG,
  type AreaSimConfig,
} from "./AreaSimulatorModal";
import type { LiveBinState } from "./BinTooltipContent";

// ─── Types ───────────────────────────────────────────────────────────────────

type Props = {
  accessToken: string;
  apiBaseUrl: string;
};

type PerAreaState = {
  config: AreaSimConfig;
  status: AreaSimStatus;
  // local optimistic fill tracking (before WebSocket confirms)
  localFill: Record<number, number>; // bin.id -> fill %
};

type LngLat = [number, number];
type PolygonRings = LngLat[][];

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function asLngLat(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = value[0];
  const lat = value[1];
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function ringContainsPoint(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  const [px, py] = point;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi || Number.EPSILON) + xi;

    if (intersects) inside = !inside;
  }

  return inside;
}

function polygonContainsPoint(point: LngLat, polygon: PolygonRings): boolean {
  if (polygon.length === 0) return false;

  const [outerRing, ...holes] = polygon;
  if (!outerRing || outerRing.length < 3) return false;
  if (!ringContainsPoint(point, outerRing)) return false;

  for (const hole of holes) {
    if (hole.length >= 3 && ringContainsPoint(point, hole)) {
      return false;
    }
  }

  return true;
}

function toPolygonRings(value: unknown): PolygonRings | null {
  if (!Array.isArray(value)) return null;

  const rings: PolygonRings = [];
  for (const maybeRing of value) {
    if (!Array.isArray(maybeRing)) continue;
    const ring: LngLat[] = [];
    for (const maybePoint of maybeRing) {
      const point = asLngLat(maybePoint);
      if (point) ring.push(point);
    }
    if (ring.length >= 3) {
      rings.push(ring);
    }
  }

  return rings.length > 0 ? rings : null;
}

function extractAreaPolygons(boundary: unknown): PolygonRings[] {
  const obj = asObject(boundary);
  if (!obj) return [];

  const type = obj.type;
  if (type === "Feature") {
    return extractAreaPolygons(obj.geometry);
  }

  if (type === "FeatureCollection" && Array.isArray(obj.features)) {
    const polygons: PolygonRings[] = [];
    for (const feature of obj.features) {
      polygons.push(...extractAreaPolygons(feature));
    }
    return polygons;
  }

  if (type === "Polygon") {
    const polygon = toPolygonRings(obj.coordinates);
    return polygon ? [polygon] : [];
  }

  if (type === "MultiPolygon" && Array.isArray(obj.coordinates)) {
    const polygons: PolygonRings[] = [];
    for (const maybePolygon of obj.coordinates) {
      const polygon = toPolygonRings(maybePolygon);
      if (polygon) polygons.push(polygon);
    }
    return polygons;
  }

  return [];
}

function getBinsForArea(area: ServiceArea, allBins: BinRecord[]): BinRecord[] {
  const assignedBins = allBins.filter((bin) => bin.area_id === area.id);
  if (assignedBins.length > 0) {
    return assignedBins;
  }

  const polygons = extractAreaPolygons(area.boundary_geojson);
  if (polygons.length === 0) {
    return [];
  }

  return allBins.filter((bin) => {
    if (bin.latitude == null || bin.longitude == null) return false;
    const point: LngLat = [bin.longitude, bin.latitude];
    return polygons.some((polygon) => polygonContainsPoint(point, polygon));
  });
}

// ─── WebSocket live-state reducer ─────────────────────────────────────────────

function parseLiveBinEvent(
  event: MessageEvent,
): Record<number, Partial<LiveBinState>> | null {
  try {
    const data = JSON.parse(event.data as string);

    // The ws/bin-states event sends individual bin_current_state updates
    if (data.event === "bin_state_update" && data.bin_id) {
      return {
        [data.bin_id as number]: {
          fill_pct: data.current_fill_pct ?? null,
          alert_level: data.current_alert_level ?? null,
          last_measured_at: data.last_measured_at ?? null,
          connectivity: data.device_connectivity_state ?? "unknown",
        },
      };
    }

    // Batch update
    if (Array.isArray(data.states)) {
      const updates: Record<number, Partial<LiveBinState>> = {};
      for (const s of data.states as Array<{
        bin_id: number;
        current_fill_pct: number | null;
        current_alert_level: string | null;
        last_measured_at: string | null;
        device_connectivity_state: string;
      }>) {
        updates[s.bin_id] = {
          fill_pct: s.current_fill_pct ?? null,
          alert_level: s.current_alert_level ?? null,
          last_measured_at: s.last_measured_at ?? null,
          connectivity: s.device_connectivity_state ?? "unknown",
        };
      }
      return updates;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminSimulatorPanel({
  accessToken,
  apiBaseUrl,
}: Props) {
  const apiBase = apiBaseUrl;

  // ── Data state ──────────────────────────────────────────────────────────────
  const [bins, setBins] = useState<BinRecord[]>([]);
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Live bin state from WebSocket ────────────────────────────────────────────
  const [liveBinStates, setLiveBinStates] = useState<
    Record<number, LiveBinState>
  >({});

  // ── Per-area simulator state ─────────────────────────────────────────────────
  const [areaStates, setAreaStates] = useState<Record<number, PerAreaState>>(
    {},
  );
  const intervalRefs = useRef<Record<number, ReturnType<typeof setInterval>>>(
    {},
  );

  // ── Modal state ──────────────────────────────────────────────────────────────
  const [selectedArea, setSelectedArea] = useState<ServiceArea | null>(null);

  // ── WebSocket ref ────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const wsHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Fetch initial data ────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [binsData, areasData] = await Promise.all([
          fetchAllBins(apiBase, accessToken),
          fetchAllServiceAreas(apiBase, accessToken),
        ]);
        setBins(binsData);
        setAreas(areasData);

        // Initialize per-area state
        const initial: Record<number, PerAreaState> = {};
        for (const area of areasData) {
          initial[area.id] = {
            config: { ...DEFAULT_SIM_CONFIG },
            status: "idle",
            localFill: {},
          };
        }
        setAreaStates(initial);
      } catch (err) {
        setLoadError("Failed to load bins or service areas. Please refresh.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [apiBase, accessToken]);

  // ─── WebSocket connection for live bin state ────────────────────────────────

  useEffect(() => {
    const wsBase = apiBase
      .replace(/^http:\/\//, "ws://")
      .replace(/^https:\/\//, "wss://");
    const wsUrl = `${wsBase}/realtime/ws/bin-states?token=${accessToken}`;

    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let shouldReconnect = true;

    function clearHeartbeat() {
      if (wsHeartbeatRef.current) {
        clearInterval(wsHeartbeatRef.current);
        wsHeartbeatRef.current = null;
      }
    }

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!shouldReconnect) {
          return;
        }

        clearHeartbeat();
        // Start heartbeat
        wsHeartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("ping");
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        const updates = parseLiveBinEvent(event);
        if (updates) {
          setLiveBinStates((prev) => {
            const next = { ...prev };
            for (const [idStr, partial] of Object.entries(updates)) {
              const id = Number(idStr);
              next[id] = { ...prev[id], ...partial } as LiveBinState;
            }
            return next;
          });
        }
      };

      ws.onclose = (event) => {
        clearHeartbeat();

        if (!shouldReconnect) {
          return;
        }

        if (event.code === 1008) {
          console.error(
            "[SimulatorWS] Connection rejected (1008 Policy Violation). Check access token validity/roles.",
          );
          return;
        }

        console.warn(
          `[SimulatorWS] Disconnected (code=${event.code}). Reconnecting in 4s...`,
        );

        reconnectTimeout = setTimeout(connect, 4000);
      };

      ws.onerror = (event) => {
        console.warn("[SimulatorWS] Socket error", event);
      };
    }

    connect();

    return () => {
      shouldReconnect = false;

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      clearHeartbeat();

      if (!ws) {
        return;
      }

      // Detach handlers first so a deliberate teardown does not trigger reconnect.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      // In React StrictMode dev cycle, cleanup can happen before handshake completes.
      // Avoid closing CONNECTING sockets to prevent noisy "closed before established" logs.
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "component-unmount");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, accessToken]);

  // ─── Cleanup all intervals on unmount ─────────────────────────────────────

  useEffect(() => {
    return () => {
      for (const id of Object.values(intervalRefs.current)) {
        clearInterval(id);
      }
    };
  }, []);

  // ─── Simulation tick ───────────────────────────────────────────────────────

  const runTick = useCallback(
    async (areaId: number, binsInArea: BinRecord[], config: AreaSimConfig) => {
      const areaState = areaStates[areaId];
      if (!areaState) return;

      const ratePerMin = fillRatePerMin(
        config.fillRatePctPerTick,
        config.tickIntervalSec,
      );
      const readings: SimTelemetryPayload[] = [];
      const nextLocalFill = { ...areaState.localFill };

      for (const bin of binsInArea) {
        // Use WebSocket confirmed fill if available, else local optimistic
        const liveState = liveBinStates[bin.id];
        const baseFill = liveState?.fill_pct ?? nextLocalFill[bin.id] ?? 0;

        // Check offline probability
        const goOffline = Math.random() < config.offlineProbability;

        if (goOffline) {
          readings.push({
            bin_code: bin.bin_code,
            connectivity_status: "offline",
          });
          continue;
        }

        // Compute new fill with noise
        const noise = (Math.random() * 2 - 1) * config.noisePercent;
        const newFill = clamp(baseFill + config.fillRatePctPerTick + noise);
        nextLocalFill[bin.id] = newFill;

        const alert = computeAlertLevel(
          newFill,
          bin.threshold_green,
          bin.threshold_yellow,
        );
        const ttf = computeTtfMin(newFill, ratePerMin);
        const priority = newFill / 100;
        const overflowImminent = ttf < 10;

        readings.push({
          bin_code: bin.bin_code,
          fill_pct: Math.round(newFill * 10) / 10,
          fill_rate: Math.round(ratePerMin * 100) / 100,
          ttf_min: Math.round(ttf * 10) / 10,
          priority: Math.round(priority * 1000) / 1000,
          alert,
          overflow_imminent: overflowImminent,
          queued: false,
        });
      }

      setAreaStates((prev) => ({
        ...prev,
        [areaId]: { ...prev[areaId], localFill: nextLocalFill },
      }));

      if (readings.length > 0) {
        try {
          await pushBulkTelemetry(apiBase, accessToken, readings);
        } catch (err) {
          console.warn("[SimTick] Failed to push bulk telemetry:", err);
        }
      }
    },
    [apiBase, accessToken, areaStates, liveBinStates],
  );

  const runTickRef = useRef(runTick);
  useEffect(() => {
    runTickRef.current = runTick;
  }, [runTick]);

  const binsByAreaId = useMemo(() => {
    const areaBinsMap: Record<number, BinRecord[]> = {};
    for (const area of areas) {
      areaBinsMap[area.id] = getBinsForArea(area, bins);
    }
    return areaBinsMap;
  }, [areas, bins]);

  // ─── Start / Stop / Randomize ──────────────────────────────────────────────

  const startSimulation = useCallback(
    (areaId: number) => {
      const areaState = areaStates[areaId];
      if (!areaState || areaState.status === "running") return;

      const binsInArea = binsByAreaId[areaId] ?? [];
      if (binsInArea.length === 0) {
        console.warn(
          "[Simulator] Cannot start: no bins resolved for selected area",
          areaId,
        );
        return;
      }

      const config = areaState.config;

      // Immediate first tick
      void runTickRef.current(areaId, binsInArea, config);

      const ivId = setInterval(() => {
        void runTickRef.current(areaId, binsInArea, config);
      }, config.tickIntervalSec * 1000);

      intervalRefs.current[areaId] = ivId;

      setAreaStates((prev) => ({
        ...prev,
        [areaId]: { ...prev[areaId], status: "running" },
      }));
    },
    [areaStates, binsByAreaId, runTick],
  );

  const stopSimulation = useCallback((areaId: number) => {
    if (intervalRefs.current[areaId]) {
      clearInterval(intervalRefs.current[areaId]);
      delete intervalRefs.current[areaId];
    }
    setAreaStates((prev) => ({
      ...prev,
      [areaId]: { ...prev[areaId], status: "idle" },
    }));
  }, []);

  const randomizeOnce = useCallback(
    async (areaId: number) => {
      const areaState = areaStates[areaId];
      if (!areaState) return;
      const config = areaState.config;

      const binsInArea = binsByAreaId[areaId] ?? [];
      if (binsInArea.length === 0) return;

      const ratePerMin = fillRatePerMin(
        config.fillRatePctPerTick,
        config.tickIntervalSec,
      );

      const nextLocalFill: Record<number, number> = {};
      const readingsPromises = binsInArea.map(async (bin) => {
        const fill = clamp(
          randBetween(config.randomizeMin, config.randomizeMax),
        );
        nextLocalFill[bin.id] = fill;
        const alert = computeAlertLevel(
          fill,
          bin.threshold_green,
          bin.threshold_yellow,
        );
        const ttf = computeTtfMin(fill, ratePerMin);
        const priority = fill / 100;

        try {
          await pushTelemetry(apiBase, accessToken, {
            bin_code: bin.bin_code,
            fill_pct: Math.round(fill * 10) / 10,
            fill_rate: Math.round(ratePerMin * 100) / 100,
            ttf_min: Math.round(ttf * 10) / 10,
            priority: Math.round(priority * 1000) / 1000,
            alert,
            overflow_imminent: ttf < 10,
            queued: false,
          });
        } catch (e) {
          console.warn("[Randomize] Failed push for", bin.bin_code, e);
        }
      });

      await Promise.allSettled(readingsPromises);

      setAreaStates((prev) => ({
        ...prev,
        [areaId]: {
          ...prev[areaId],
          localFill: { ...prev[areaId].localFill, ...nextLocalFill },
        },
      }));
    },
    [apiBase, accessToken, areaStates, binsByAreaId],
  );

  // ─── Area state config update ──────────────────────────────────────────────

  const updateAreaConfig = useCallback(
    (areaId: number, config: AreaSimConfig) => {
      setAreaStates((prev) => ({
        ...prev,
        [areaId]: { ...prev[areaId], config },
      }));

      // If simulation was running, restart with new interval
      if (areaStates[areaId]?.status === "running") {
        stopSimulation(areaId);
        // Will restart with new config on next render via startSimulation
        setTimeout(() => startSimulation(areaId), 100);
      }
    },
    [areaStates, stopSimulation, startSimulation],
  );

  // ─── Derived values ────────────────────────────────────────────────────────

  const areaSimStatusMap: Record<number, AreaSimStatus> = {};
  for (const [idStr, state] of Object.entries(areaStates)) {
    areaSimStatusMap[Number(idStr)] = state.status;
  }

  const selectedAreaBins = selectedArea
    ? (binsByAreaId[selectedArea.id] ?? [])
    : [];

  const selectedAreaState = selectedArea ? areaStates[selectedArea.id] : null;

  // ─── Stats for header ──────────────────────────────────────────────────────

  const totalBins = bins.length;
  const binsWithData = bins.filter(
    (b) => liveBinStates[b.id]?.fill_pct !== null,
  ).length;
  const simulatingAreas = Object.values(areaStates).filter(
    (s) => s.status === "running",
  ).length;

  const fillValues = bins
    .map((b) => liveBinStates[b.id]?.fill_pct)
    .filter((v): v is number => v !== null && v !== undefined);
  const avgFill =
    fillValues.length > 0
      ? (fillValues.reduce((a, b) => a + b, 0) / fillValues.length).toFixed(1)
      : "—";

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="space-y-3 text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-cyan-200 border-t-cyan-600" />
          <p className="text-sm text-slate-500">
            Loading bins &amp; service areas…
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="max-w-sm rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">{loadError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Bins", value: totalBins, accent: "text-slate-900" },
          {
            label: "With Live Data",
            value: binsWithData,
            accent: "text-emerald-700",
          },
          {
            label: "Simulating Areas",
            value: simulatingAreas,
            accent: "text-cyan-700",
          },
          { label: "Avg Fill %", value: avgFill, accent: "text-amber-700" },
        ].map(({ label, value, accent }) => (
          <div
            key={label}
            className="rounded-2xl border border-white/70 bg-white/80 px-5 py-4 shadow-sm backdrop-blur"
          >
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {label}
            </p>
            <p className={`mt-1 text-2xl font-bold tabular-nums ${accent}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* ── Guide callout ── */}
      <div className="flex items-start gap-3 rounded-2xl border border-cyan-200/60 bg-cyan-50/60 px-5 py-3 text-sm text-cyan-800 shadow-sm">
        <span className="mt-0.5 text-lg">💡</span>
        <span>
          <strong>Click any service area</strong> on the map to open the
          simulation panel. Bins are shown as colored circles — green (normal),
          yellow (warning), red (critical), grey (no data). Simulated telemetry
          is pushed to the backend as if from real ESP32 devices.
        </span>
      </div>

      {/* ── Map ── */}
      <div
        className="overflow-hidden rounded-3xl border border-white/60 shadow-lg"
        style={{ height: "clamp(420px, 60vh, 720px)" }}
      >
        <AdminSimulatorMap
          bins={bins}
          areas={areas}
          liveBinStates={liveBinStates}
          areaSimStatus={areaSimStatusMap}
          onAreaClick={setSelectedArea}
        />
      </div>

      {/* ── Area info list ── */}
      {areas.length > 0 && (
        <div className="rounded-2xl border border-white/70 bg-white/80 shadow-sm backdrop-blur overflow-hidden">
          <div className="border-b border-slate-100 px-6 py-4">
            <h3 className="text-sm font-semibold text-slate-800">
              Service Areas
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click a row or the map to start simulation
            </p>
          </div>
          <div className="divide-y divide-slate-50">
            {areas.map((area) => {
              const status = areaStates[area.id]?.status ?? "idle";
              const binsInArea = binsByAreaId[area.id] ?? [];
              const areaBinCount = binsInArea.length;
              const areaFills = binsInArea
                .map((b) => liveBinStates[b.id]?.fill_pct)
                .filter((v): v is number => v !== null && v !== undefined);
              const areaAvg =
                areaFills.length > 0
                  ? (
                      areaFills.reduce((a, b) => a + b, 0) / areaFills.length
                    ).toFixed(1)
                  : null;

              return (
                <button
                  key={area.id}
                  className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-slate-50/80"
                  onClick={() => setSelectedArea(area)}
                >
                  <div
                    className="h-3 w-3 flex-shrink-0 rounded-full"
                    style={{
                      background:
                        status === "running"
                          ? "#06b6d4"
                          : status === "paused"
                            ? "#f59e0b"
                            : "#94a3b8",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {area.name}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {areaBinCount} bin{areaBinCount !== 1 ? "s" : ""}
                      {areaAvg !== null && ` · avg ${areaAvg}%`}
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span
                      className={`text-xs font-medium capitalize ${
                        status === "running"
                          ? "text-cyan-600"
                          : status === "paused"
                            ? "text-amber-600"
                            : "text-slate-400"
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modal ── */}
      {selectedArea && selectedAreaState && (
        <AreaSimulatorModal
          area={selectedArea}
          areaBins={selectedAreaBins}
          liveBinStates={liveBinStates}
          simStatus={selectedAreaState.status}
          simConfig={selectedAreaState.config}
          onConfigChange={(config) => updateAreaConfig(selectedArea.id, config)}
          onStart={() => startSimulation(selectedArea.id)}
          onStop={() => stopSimulation(selectedArea.id)}
          onRandomize={() => void randomizeOnce(selectedArea.id)}
          onClose={() => setSelectedArea(null)}
        />
      )}
    </div>
  );
}
