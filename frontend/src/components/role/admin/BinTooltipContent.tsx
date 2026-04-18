/**
 * BinTooltipContent.tsx
 * Reusable tooltip / popover body for a single bin on the simulator map.
 */

import type { BinRecord } from "@/lib/adminSimulatorApi";
import { computeAlertLevel } from "@/lib/adminSimulatorApi";

export type LiveBinState = {
  fill_pct: number | null;
  alert_level: string | null;
  last_measured_at: string | null;
  connectivity: string;
};

type Props = {
  bin: BinRecord;
  live: LiveBinState | null;
};

function alertBadge(level: string | null) {
  if (!level) return null;
  const map: Record<string, { bg: string; text: string; label: string }> = {
    RED:    { bg: "bg-red-100",    text: "text-red-700",    label: "🔴 Critical" },
    YELLOW: { bg: "bg-yellow-100", text: "text-yellow-700", label: "🟡 Warning" },
    GREEN:  { bg: "bg-green-100",  text: "text-green-700",  label: "🟢 Normal" },
  };
  const key = level.toUpperCase();
  const style = map[key] ?? { bg: "bg-slate-100", text: "text-slate-600", label: level };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
      {style.label}
    </span>
  );
}

function FillBar({ pct, green, yellow }: { pct: number; green: number; yellow: number }) {
  const derived = computeAlertLevel(pct, green, yellow);
  const color =
    derived === "RED" ? "bg-red-500" :
    derived === "YELLOW" ? "bg-yellow-400" :
    "bg-emerald-500";

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-0.5">
        <span>Fill Level</span>
        <span className="font-semibold text-slate-800">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

export default function BinTooltipContent({ bin, live }: Props) {
  const fill = live?.fill_pct ?? null;
  const alert = live?.alert_level ?? null;
  const connectivity = live?.connectivity ?? "unknown";
  const measuredAt = live?.last_measured_at
    ? new Date(live.last_measured_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="min-w-[200px] space-y-2 p-1 text-xs">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold text-slate-900 leading-tight">{bin.bin_code}</p>
          {bin.display_name && (
            <p className="text-[10px] text-slate-500">{bin.display_name}</p>
          )}
        </div>
        {alertBadge(alert)}
      </div>

      {/* Address */}
      {bin.address_line && (
        <p className="text-[10px] text-slate-500 leading-snug">{bin.address_line}</p>
      )}

      {/* Fill bar */}
      {fill !== null ? (
        <FillBar pct={fill} green={bin.threshold_green} yellow={bin.threshold_yellow} />
      ) : (
        <p className="text-[10px] italic text-slate-400">No telemetry yet</p>
      )}

      {/* Connectivity + last update */}
      <div className="flex items-center justify-between pt-0.5 border-t border-slate-100">
        <span className={`flex items-center gap-1 text-[10px] ${connectivity === "online" ? "text-emerald-600" : connectivity === "offline" ? "text-red-500" : "text-slate-400"}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${connectivity === "online" ? "bg-emerald-500" : connectivity === "offline" ? "bg-red-500" : "bg-slate-300"}`} />
          {connectivity}
        </span>
        {measuredAt && (
          <span className="text-[10px] text-slate-400">{measuredAt}</span>
        )}
      </div>

      {/* Thresholds hint */}
      <p className="text-[9px] text-slate-300">
        Thresholds: {bin.threshold_green}% / {bin.threshold_yellow}%
      </p>
    </div>
  );
}
