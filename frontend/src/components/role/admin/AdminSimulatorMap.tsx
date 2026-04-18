/**
 * AdminSimulatorMap.tsx
 * ----------------------
 * Full-featured Leaflet map for the authority_admin IoT simulator.
 *
 * Features:
 *  - Bin markers (colored circles) with rich hover tooltips
 *  - Service area polygons (from boundary_geojson) or labeled circles
 *  - Clickable service areas to open the simulation control modal
 *  - Legend & stats bar
 *  - Live fill state reflected via WebSocket updates
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import type { BinRecord, ServiceArea } from "@/lib/adminSimulatorApi";
import { computeAlertLevel } from "@/lib/adminSimulatorApi";
import BinTooltipContent, { type LiveBinState } from "./BinTooltipContent";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AreaSimStatus = "idle" | "running" | "paused";

type Props = {
  bins: BinRecord[];
  areas: ServiceArea[];
  liveBinStates: Record<number, LiveBinState>; // keyed by bin.id
  areaSimStatus: Record<number, AreaSimStatus>; // keyed by area.id
  onAreaClick: (area: ServiceArea) => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fillColor(fillPct: number | null, green: number, yellow: number): string {
  if (fillPct === null) return "#94a3b8"; // slate-400 — no data
  const level = computeAlertLevel(fillPct, green, yellow);
  if (level === "RED") return "#ef4444";
  if (level === "YELLOW") return "#eab308";
  return "#22c55e";
}

function areaStatusColor(status: AreaSimStatus): string {
  if (status === "running") return "#06b6d4";  // cyan-500
  if (status === "paused")  return "#f59e0b";  // amber-500
  return "#64748b";                             // slate-500
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Auto-fit map bounds when bins/areas first load */
function MapAutoFit({ bins, areas }: { bins: BinRecord[]; areas: ServiceArea[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) return;

    const points: [number, number][] = [];

    for (const bin of bins) {
      if (bin.latitude && bin.longitude) points.push([bin.latitude, bin.longitude]);
    }
    for (const area of areas) {
      if (area.center_latitude && area.center_longitude)
        points.push([area.center_latitude, area.center_longitude]);
    }

    if (points.length > 0) {
      map.fitBounds(points, { padding: [48, 48], maxZoom: 14 });
      fitted.current = true;
    }
  }, [bins, areas, map]);

  return null;
}

/** Resize handler (for dialog/panel visibility changes) */
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

/** Drawing service areas from boundary_geojson */
function ServiceAreaLayer({
  area,
  simStatus,
  onClick,
}: {
  area: ServiceArea;
  simStatus: AreaSimStatus;
  onClick: () => void;
}) {
  const color = areaStatusColor(simStatus);
  const displayName = area.name;

  // If we have a GeoJSON boundary, draw it as a polygon
  if (area.boundary_geojson) {
    return (
      <GeoJSON
        key={`area-geo-${area.id}`}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data={area.boundary_geojson as any}
        style={{
          color,
          fillColor: color,
          fillOpacity: 0.12,
          weight: 2.5,
          dashArray: simStatus === "running" ? undefined : "6 4",
        }}
        eventHandlers={{ click: onClick }}
      >
        <Tooltip sticky>
          <AreaTooltipBody name={displayName} status={simStatus} />
        </Tooltip>
      </GeoJSON>
    );
  }

  // Fallback: circle marker for the area center
  if (area.center_latitude && area.center_longitude) {
    return (
      <CircleMarker
        key={`area-circle-${area.id}`}
        center={[area.center_latitude, area.center_longitude]}
        radius={28}
        pathOptions={{
          color,
          fillColor: color,
          fillOpacity: 0.15,
          weight: 2.5,
          dashArray: simStatus === "running" ? undefined : "6 4",
        }}
        eventHandlers={{ click: onClick }}
      >
        <Tooltip permanent direction="center" opacity={1}>
          <span className="text-[10px] font-semibold text-slate-700">{displayName}</span>
        </Tooltip>
      </CircleMarker>
    );
  }

  return null;
}

function AreaTooltipBody({ name, status }: { name: string; status: AreaSimStatus }) {
  return (
    <div className="space-y-0.5 text-xs">
      <p className="font-semibold text-slate-800">{name}</p>
      <p className={`capitalize ${status === "running" ? "text-cyan-600" : status === "paused" ? "text-amber-600" : "text-slate-500"}`}>
        ● {status === "idle" ? "Idle — click to simulate" : status}
      </p>
    </div>
  );
}

/** Invisible map layer that intercepts area clicks */
function ClickBlocker() {
  useMapEvents({
    click() {
      // no-op — individual markers handle their own events
    },
  });
  return null;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function legendRow(color: string, label: string, dashed = false): string {
  return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
    <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};opacity:${dashed ? 0.7 : 1};flex-shrink:0"></span>
    <span style="color:#475569;font-size:11px">${label}</span>
  </div>`;
}

function Legend() {
  const map = useMap();

  useEffect(() => {
    const legend = new L.Control({ position: "bottomleft" });

    legend.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.style.cssText =
        "background:rgba(255,255,255,0.92);border-radius:12px;padding:10px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);font-family:sans-serif;min-width:180px;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,0.7)";
      div.innerHTML = `
        <p style="font-weight:600;font-size:12px;color:#334155;margin:0 0 8px 0">Legend</p>
        ${legendRow("#22c55e", "Bin — Normal")}
        ${legendRow("#eab308", "Bin — Warning")}
        ${legendRow("#ef4444", "Bin — Critical")}
        ${legendRow("#94a3b8", "Bin — No data")}
        <div style="border-top:1px solid #e2e8f0;margin:6px 0"></div>
        ${legendRow("#64748b", "Area — Idle", true)}
        ${legendRow("#06b6d4", "Area — Simulating")}
        ${legendRow("#f59e0b", "Area — Paused", true)}
      `;
      return div;
    };

    legend.addTo(map);
    return () => { legend.remove(); };
  }, [map]);

  return null;
}


// ─── Main Map ──────────────────────────────────────────────────────────────

export default function AdminSimulatorMap({
  bins,
  areas,
  liveBinStates,
  areaSimStatus,
  onAreaClick,
}: Props) {
  const defaultCenter: [number, number] = [12.9716, 77.5946]; // Bengaluru

  return (
    <div 
      className="h-full w-full overflow-hidden rounded-2xl border border-white/60 shadow-inner relative z-0"
      style={{ isolation: 'isolate' }}
    >
      <MapContainer
        center={defaultCenter}
        zoom={12}
        scrollWheelZoom={true}
        className="h-full w-full"
        style={{ background: "#e2e8f0" }}
      >
        <MapResizer />
        <ClickBlocker />
        <MapAutoFit bins={bins} areas={areas} />
        <Legend />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Service area zones (drawn beneath bins) */}
        {areas.map((area) => (
          <ServiceAreaLayer
            key={area.id}
            area={area}
            simStatus={areaSimStatus[area.id] ?? "idle"}
            onClick={() => onAreaClick(area)}
          />
        ))}

        {/* Bin markers */}
        {bins.map((bin) => {
          if (!bin.latitude || !bin.longitude) return null;
          const live = liveBinStates[bin.id] ?? null;
          const fill = live?.fill_pct ?? null;
          const color = fillColor(fill, bin.threshold_green, bin.threshold_yellow);
          const isOffline = live?.connectivity === "offline";

          return (
            <CircleMarker
              key={bin.id}
              center={[bin.latitude, bin.longitude]}
              radius={10}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: isOffline ? 0.3 : 0.75,
                weight: isOffline ? 1 : 2.5,
                dashArray: isOffline ? "4 3" : undefined,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                <BinTooltipContent bin={bin} live={live} />
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
