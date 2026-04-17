import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { extractApiErrorMessage } from "@/lib/authApi";

type OperatorOverviewPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type DateRangeDays = "7" | "30" | "90";

type TelemetryLiveSummary = {
  total_bins: number;
  bins_with_state: number;
  red_bins: number;
  yellow_bins: number;
  overflow_imminent_bins: number;
  offline_bins: number;
  open_alerts: number;
};

type EfficiencyAnalytics = {
  collections_per_hour: number;
  distance_per_collection_km: number;
  total_collections: number;
  total_routes: number;
  total_distance_km: number;
};

type SavingsAnalytics = {
  optimized_distance_km: number;
  naive_distance_km: number;
  distance_saved_km: number;
  distance_saved_pct: number;
  fuel_saved_l: number;
  fuel_saved_pct: number;
};

type EnvironmentalAnalytics = {
  co2_saved_kg: number;
  co2_reduction_pct: number;
};

type AlertItem = {
  id: number;
  title: string;
  severity: string;
  status: string;
  bin_code: string;
  opened_at: string;
};

type AlertListResponse = {
  total: number;
  items: AlertItem[];
};

type OperationsListResponse = {
  total: number;
};

type OverviewSnapshot = {
  liveSummary: TelemetryLiveSummary;
  efficiency: EfficiencyAnalytics;
  savings: SavingsAnalytics;
  environmental: EnvironmentalAnalytics;
  openAlerts: AlertListResponse;
  operations: {
    totalVehicles: number;
    totalRoutes: number;
    totalShifts: number;
  };
};

const PIE_COLORS = ["#0ea5e9", "#f59e0b", "#ef4444", "#64748b"];

function safeNumber(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function formatMetric(value: number, digits = 1): string {
  return safeNumber(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatAlertSeverity(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  return normalized;
}

function severityBadgeClass(severity: string): string {
  if (severity === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (severity === "high") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (severity === "medium") {
    return "border-yellow-200 bg-yellow-50 text-yellow-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function OperatorOverviewPanel({
  accessToken,
  apiBaseUrl,
}: OperatorOverviewPanelProps) {
  const [dateRangeDays, setDateRangeDays] = useState<DateRangeDays>("30");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);

  const fetchOverviewSnapshot = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const headers = { Authorization: `Bearer ${accessToken}` };
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - Number.parseInt(dateRangeDays, 10));

    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    try {
      const [
        liveSummaryRes,
        efficiencyRes,
        savingsRes,
        environmentalRes,
        openAlertsRes,
        vehiclesRes,
        routesRes,
        shiftsRes,
      ] = await Promise.all([
        axios.get<TelemetryLiveSummary>(
          `${apiBaseUrl}/telemetry/live/summary`,
          {
            headers,
          },
        ),
        axios.get<EfficiencyAnalytics>(`${apiBaseUrl}/analytics/efficiency`, {
          headers,
          params: { from: fromIso, to: toIso },
        }),
        axios.get<SavingsAnalytics>(`${apiBaseUrl}/analytics/savings`, {
          headers,
          params: { from: fromIso, to: toIso },
        }),
        axios.get<EnvironmentalAnalytics>(
          `${apiBaseUrl}/analytics/environmental`,
          {
            headers,
            params: { from: fromIso, to: toIso },
          },
        ),
        axios.get<AlertListResponse>(`${apiBaseUrl}/alerts`, {
          headers,
          params: { status: "open", limit: 20, offset: 0 },
        }),
        axios.get<OperationsListResponse>(`${apiBaseUrl}/operations/vehicles`, {
          headers,
          params: { limit: 1, offset: 0 },
        }),
        axios.get<OperationsListResponse>(`${apiBaseUrl}/operations/routes`, {
          headers,
          params: { limit: 1, offset: 0 },
        }),
        axios.get<OperationsListResponse>(`${apiBaseUrl}/operations/shifts`, {
          headers,
          params: { limit: 1, offset: 0 },
        }),
      ]);

      setSnapshot({
        liveSummary: liveSummaryRes.data,
        efficiency: efficiencyRes.data,
        savings: savingsRes.data,
        environmental: environmentalRes.data,
        openAlerts: openAlertsRes.data,
        operations: {
          totalVehicles: safeNumber(vehiclesRes.data.total),
          totalRoutes: safeNumber(routesRes.data.total),
          totalShifts: safeNumber(shiftsRes.data.total),
        },
      });
    } catch (error) {
      setSnapshot(null);
      setErrorMessage(
        extractApiErrorMessage(
          error,
          "Failed to load operator overview. Verify backend services and try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, apiBaseUrl, dateRangeDays]);

  useEffect(() => {
    void fetchOverviewSnapshot();
  }, [fetchOverviewSnapshot]);

  const severityDistribution = useMemo(() => {
    if (!snapshot) {
      return [] as Array<{ name: string; value: number }>;
    }

    const counts = snapshot.openAlerts.items.reduce<Record<string, number>>(
      (acc, item) => {
        const key = formatAlertSeverity(item.severity);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );

    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value);
  }, [snapshot]);

  const binHealthDistribution = useMemo(() => {
    if (!snapshot) {
      return [] as Array<{ name: string; value: number }>;
    }

    const totalBins = safeNumber(snapshot.liveSummary.total_bins);
    const redBins = safeNumber(snapshot.liveSummary.red_bins);
    const yellowBins = safeNumber(snapshot.liveSummary.yellow_bins);
    const trackedBins = Math.max(totalBins - redBins - yellowBins, 0);
    const offlineBins = safeNumber(snapshot.liveSummary.offline_bins);

    return [
      { name: "Tracked", value: trackedBins },
      { name: "Yellow", value: yellowBins },
      { name: "Red", value: redBins },
      { name: "Offline", value: offlineBins },
    ];
  }, [snapshot]);

  const performanceBars = useMemo(() => {
    if (!snapshot) {
      return [] as Array<{ name: string; value: number }>;
    }

    return [
      {
        name: "Collections/hr",
        value: safeNumber(snapshot.efficiency.collections_per_hour),
      },
      {
        name: "Fuel Saved (L)",
        value: safeNumber(snapshot.savings.fuel_saved_l),
      },
      {
        name: "CO2 Saved (kg)",
        value: safeNumber(snapshot.environmental.co2_saved_kg),
      },
      {
        name: "Distance Saved (km)",
        value: safeNumber(snapshot.savings.distance_saved_km),
      },
    ];
  }, [snapshot]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <Card className="border-red-200 bg-red-50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-red-900">Overview Unavailable</CardTitle>
          <CardDescription className="text-red-700">
            {errorMessage || "Could not load overview metrics."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Operator Overview</CardTitle>
            <CardDescription>
              Unified operational pulse across telemetry, alerts, routes,
              shifts, and impact analytics.
            </CardDescription>
          </div>
          <div className="w-full max-w-55">
            <Select
              value={dateRangeDays}
              onValueChange={(value) =>
                setDateRangeDays(value as DateRangeDays)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Total Bins
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {snapshot.liveSummary.total_bins}
            </p>
            <p className="text-xs text-slate-600">
              Live bins with state: {snapshot.liveSummary.bins_with_state}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Open Alerts
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {snapshot.liveSummary.open_alerts}
            </p>
            <p className="text-xs text-slate-600">
              Overflow imminent: {snapshot.liveSummary.overflow_imminent_bins}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Routes & Shifts
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {snapshot.operations.totalRoutes}
            </p>
            <p className="text-xs text-slate-600">
              Shifts: {snapshot.operations.totalShifts}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Fleet
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {snapshot.operations.totalVehicles}
            </p>
            <p className="text-xs text-slate-600">
              Distance saved: {formatMetric(snapshot.savings.distance_saved_km)}{" "}
              km
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Bin Health Distribution</CardTitle>
            <CardDescription>
              Live state counters from telemetry summary.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={binHealthDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    label
                  >
                    {binHealthDistribution.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => Number(value ?? 0).toLocaleString()}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Performance Snapshot</CardTitle>
            <CardDescription>
              Efficiency, fuel and environmental savings in selected range.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={performanceBars}
                  margin={{ top: 12, right: 12, left: 4, bottom: 24 }}
                >
                  <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="name"
                    angle={-20}
                    textAnchor="end"
                    interval={0}
                    height={56}
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => formatMetric(Number(value ?? 0), 2)}
                  />
                  <Bar dataKey="value" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Open Alert Severity</CardTitle>
            <CardDescription>
              Distribution over currently open alerts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {severityDistribution.length === 0 ? (
              <p className="text-sm text-slate-600">
                No open alerts in this range.
              </p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={severityDistribution}
                    margin={{ top: 12, right: 12, left: 4, bottom: 16 }}
                  >
                    <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                    <XAxis dataKey="name" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(value) => Number(value ?? 0).toLocaleString()}
                    />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {severityDistribution.map((entry) => (
                        <Cell
                          key={entry.name}
                          fill={
                            entry.name === "critical"
                              ? "#ef4444"
                              : entry.name === "high"
                                ? "#f97316"
                                : entry.name === "medium"
                                  ? "#f59e0b"
                                  : "#64748b"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent Open Alerts</CardTitle>
            <CardDescription>
              Quick triage queue for the operator.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.openAlerts.items.length === 0 ? (
              <p className="text-sm text-slate-600">
                No active alerts right now.
              </p>
            ) : (
              snapshot.openAlerts.items.slice(0, 6).map((alert) => {
                const severity = formatAlertSeverity(alert.severity);
                return (
                  <div
                    key={alert.id}
                    className="rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {alert.title}
                      </p>
                      <Badge className={severityBadgeClass(severity)}>
                        {severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-600">
                      Bin: {alert.bin_code}
                    </p>
                    <p className="text-xs text-slate-500">
                      Opened: {new Date(alert.opened_at).toLocaleString()}
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/80 bg-white/85 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Key Analytics Numbers</CardTitle>
          <CardDescription>
            Core metrics for executive demo and operational briefing.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Collections / Hour
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatMetric(snapshot.efficiency.collections_per_hour, 2)}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Distance / Collection
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatMetric(snapshot.efficiency.distance_per_collection_km, 2)}{" "}
              km
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Fuel Saved
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatMetric(snapshot.savings.fuel_saved_l, 2)} L
            </p>
            <p className="text-xs text-slate-600">
              {formatMetric(snapshot.savings.fuel_saved_pct, 1)}%
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              CO2 Reduction
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {formatMetric(snapshot.environmental.co2_saved_kg, 2)} kg
            </p>
            <p className="text-xs text-slate-600">
              {formatMetric(snapshot.environmental.co2_reduction_pct, 1)}%
            </p>
          </div>
        </CardContent>
      </Card>

      {errorMessage ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export default OperatorOverviewPanel;
