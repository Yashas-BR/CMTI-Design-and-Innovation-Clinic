/**
 * AreaSimulatorModal.tsx
 * -----------------------
 * Modal dialog that opens when the admin clicks a service area on the map.
 *
 * Controls:
 *  - Fill Rate per tick (0.1–10%)
 *  - Tick Interval (5–120 s)
 *  - Fill Noise ±% (0–10%)
 *  - Battery Drain Rate (0–5% per tick)
 *  - Offline Probability (0–20%)
 *  - Randomize Min/Max bounds (for "Randomize Once")
 *  - Start / Stop Simulation
 *  - Randomize Once
 *
 * Bin status list: live fill bars for all bins in this area.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

import type { BinRecord, ServiceArea } from "@/lib/adminSimulatorApi";
import { computeAlertLevel } from "@/lib/adminSimulatorApi";
import type { LiveBinState } from "./BinTooltipContent";
import type { AreaSimStatus } from "./AdminSimulatorMap";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AreaSimConfig = {
  fillRatePctPerTick: number; // %/tick  [0.1–10]
  tickIntervalSec: number; // seconds [5–120]
  noisePercent: number; // ±%      [0–10]
  batteryDrainPct: number; // %/tick  [0–5]
  offlineProbability: number; // 0–0.20  [0–20%]
  randomizeMin: number; // fill %  [0–100]
  randomizeMax: number; // fill %  [0–100]
};

export const DEFAULT_SIM_CONFIG: AreaSimConfig = {
  fillRatePctPerTick: 2,
  tickIntervalSec: 15,
  noisePercent: 1,
  batteryDrainPct: 0.5,
  offlineProbability: 0.05,
  randomizeMin: 10,
  randomizeMax: 85,
};

type Props = {
  area: ServiceArea | null;
  areaBins: BinRecord[];
  liveBinStates: Record<number, LiveBinState>;
  simStatus: AreaSimStatus;
  simConfig: AreaSimConfig;
  onConfigChange: (config: AreaSimConfig) => void;
  onStart: () => void;
  onStop: () => void;
  onRandomize: () => void;
  onClose: () => void;
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-slate-700">{label}</Label>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 tabular-nums">
          {value.toFixed(step < 1 ? 1 : 0)}
          {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-slate-400">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </div>
    </div>
  );
}

function FillBar({
  fill,
  green,
  yellow,
}: {
  fill: number | null;
  green: number;
  yellow: number;
}) {
  if (fill === null) {
    return (
      <div className="h-2 w-full rounded-full bg-slate-200">
        <div className="h-full w-0" />
      </div>
    );
  }

  const level = computeAlertLevel(fill, green, yellow);
  const color =
    level === "RED"
      ? "bg-red-500"
      : level === "YELLOW"
        ? "bg-yellow-400"
        : "bg-emerald-500";

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
      <div
        className={`h-full rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${Math.min(100, fill)}%` }}
      />
    </div>
  );
}

function BinStatusRow({
  bin,
  live,
}: {
  bin: BinRecord;
  live: LiveBinState | null;
}) {
  const fill = live?.fill_pct ?? null;
  const alert = live?.alert_level ?? null;
  const offline = live?.connectivity === "offline";

  const alertColor =
    alert === "RED"
      ? "text-red-600"
      : alert === "YELLOW"
        ? "text-yellow-600"
        : alert === "GREEN"
          ? "text-emerald-600"
          : "text-slate-400";

  return (
    <div className="grid grid-cols-[1fr_auto_72px] items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-slate-800">
          {bin.bin_code}
        </p>
        {bin.address_line && (
          <p className="truncate text-[10px] text-slate-500">
            {bin.address_line}
          </p>
        )}
        <FillBar
          fill={fill}
          green={bin.threshold_green}
          yellow={bin.threshold_yellow}
        />
      </div>

      <div className="text-right">
        {fill !== null ? (
          <span className="text-xs font-bold tabular-nums text-slate-800">
            {fill.toFixed(1)}%
          </span>
        ) : (
          <span className="text-[10px] text-slate-400">—</span>
        )}
      </div>

      <div className="text-right">
        {offline ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600">
            Offline
          </span>
        ) : alert ? (
          <span className={`text-[10px] font-semibold ${alertColor}`}>
            {alert}
          </span>
        ) : (
          <span className="text-[10px] text-slate-400">No data</span>
        )}
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function AreaSimulatorModal({
  area,
  areaBins,
  liveBinStates,
  simStatus,
  simConfig,
  onConfigChange,
  onStart,
  onStop,
  onRandomize,
  onClose,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isRunning = simStatus === "running";

  if (!area) return null;

  function patch<K extends keyof AreaSimConfig>(
    key: K,
    value: AreaSimConfig[K],
  ) {
    onConfigChange({ ...simConfig, [key]: value });
  }

  const binsInArea = areaBins;
  const binsWithData = binsInArea.filter(
    (b) => liveBinStates[b.id]?.fill_pct !== null,
  );
  const avgFill =
    binsWithData.length > 0
      ? binsWithData.reduce(
          (s, b) => s + (liveBinStates[b.id]?.fill_pct ?? 0),
          0,
        ) / binsWithData.length
      : null;

  return (
    <Dialog
      open={!!area}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-3xl flex-col overflow-hidden p-0 gap-0">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-cyan-50 via-sky-50 to-indigo-50 px-6 py-5">
          <div>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">
                {area.name}
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500">
                Service Area Simulator — configure virtual ESP32 behaviour for
                all bins in this zone
              </DialogDescription>
            </DialogHeader>
          </div>
          <Badge
            className={`mt-0.5 flex-shrink-0 capitalize ${
              isRunning
                ? "bg-cyan-500 text-white"
                : "bg-slate-200 text-slate-600"
            }`}
          >
            {simStatus}
          </Badge>
        </div>

        {/* ── Stats bar ── */}
        <div className="flex divide-x divide-slate-100 border-b border-slate-100 bg-white/70 px-6 py-3 text-center">
          {[
            { label: "Bins in area", value: binsInArea.length },
            { label: "With live data", value: binsWithData.length },
            {
              label: "Avg fill %",
              value: avgFill !== null ? `${avgFill.toFixed(1)}%` : "—",
            },
            {
              label: "Tick interval",
              value: `${simConfig.tickIntervalSec}s`,
            },
          ].map(({ label, value }) => (
            <div key={label} className="flex-1 px-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {label}
              </p>
              <p className="mt-0.5 text-sm font-bold text-slate-800">{value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
          {/* ── Controls column ── */}
          <div className="flex w-full flex-col gap-4 overflow-y-auto border-b border-slate-100 px-5 py-5 sm:w-[280px] sm:border-b-0 sm:border-r">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Simulation Controls
            </p>

            <SliderControl
              label="Fill Rate per Tick"
              value={simConfig.fillRatePctPerTick}
              min={0.1}
              max={10}
              step={0.1}
              unit="%"
              onChange={(v) => patch("fillRatePctPerTick", v)}
            />

            <SliderControl
              label="Tick Interval"
              value={simConfig.tickIntervalSec}
              min={5}
              max={120}
              step={5}
              unit="s"
              onChange={(v) => patch("tickIntervalSec", v)}
            />

            <SliderControl
              label="Random Noise ±"
              value={simConfig.noisePercent}
              min={0}
              max={10}
              step={0.5}
              unit="%"
              onChange={(v) => patch("noisePercent", v)}
            />

            {/* Advanced toggle */}
            <button
              onClick={() => setShowAdvanced((x) => !x)}
              className="flex items-center gap-1 text-left text-[11px] font-medium text-cyan-600 hover:text-cyan-700"
            >
              <span>{showAdvanced ? "▾" : "▸"}</span>
              {showAdvanced ? "Hide advanced" : "Show advanced"}
            </button>

            {showAdvanced && (
              <div className="space-y-4 rounded-xl bg-slate-50/80 p-3">
                <SliderControl
                  label="Battery Drain / tick"
                  value={simConfig.batteryDrainPct}
                  min={0}
                  max={5}
                  step={0.1}
                  unit="%"
                  onChange={(v) => patch("batteryDrainPct", v)}
                />
                <SliderControl
                  label="Offline Probability"
                  value={simConfig.offlineProbability * 100}
                  min={0}
                  max={20}
                  step={1}
                  unit="%"
                  onChange={(v) => patch("offlineProbability", v / 100)}
                />
              </div>
            )}

            {/* Randomize bounds */}
            <div className="rounded-xl bg-indigo-50/60 p-3 space-y-3">
              <p className="text-[11px] font-semibold text-indigo-700">
                Randomize Once — Fill Bounds
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] text-slate-600">Min %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={99}
                    value={simConfig.randomizeMin}
                    onChange={(e) =>
                      patch("randomizeMin", Number(e.target.value))
                    }
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-600">Max %</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={simConfig.randomizeMax}
                    onChange={(e) =>
                      patch("randomizeMax", Number(e.target.value))
                    }
                    className="h-8 text-xs mt-1"
                  />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-2 pt-1">
              {isRunning ? (
                <Button
                  variant="outline"
                  className="w-full border-red-200 text-red-600 hover:bg-red-50"
                  onClick={onStop}
                >
                  ⏹ Stop Simulation
                </Button>
              ) : (
                <Button
                  className="w-full bg-cyan-600 hover:bg-cyan-700 text-white"
                  onClick={onStart}
                >
                  ▶ Start Simulation
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                onClick={onRandomize}
              >
                🎲 Randomize Once
              </Button>
            </div>
          </div>

          {/* ── Bin list column ── */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Bins in Area ({binsInArea.length})
              </p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {binsInArea.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm text-slate-400">
                    No bins are assigned to this area.
                  </p>
                </div>
              ) : (
                binsInArea.map((bin) => (
                  <BinStatusRow
                    key={bin.id}
                    bin={bin}
                    live={liveBinStates[bin.id] ?? null}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
