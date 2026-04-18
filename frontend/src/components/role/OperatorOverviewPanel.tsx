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
import { Skeleton } from "@/components/ui/skeleton";
import { extractApiErrorMessage } from "@/lib/authApi";

type OperatorOverviewPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

type ListQueryParams = Record<string, string | number | boolean>;

const LIST_LIMIT = 100;

type TelemetryLiveSummary = {
  total_bins: number;
  bins_with_state: number;
  red_bins: number;
  yellow_bins: number;
  overflow_imminent_bins: number;
  offline_bins: number;
  open_alerts: number;
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

type BinRecord = {
  area_id: number | null;
};

type ServiceAreaRecord = {
  id: number;
  name: string;
};

type OverviewSnapshot = {
  liveSummary: TelemetryLiveSummary;
  openAlerts: AlertListResponse;
  topServiceAreas: Array<{ name: string; value: number }>;
  operations: {
    totalRoutes: number;
    totalShifts: number;
  };
};

const PIE_COLORS = ["#ef4444", "#f59e0b", "#22c55e"];

function safeNumber(value: number | undefined | null): number {
  return Number.isFinite(value) ? Number(value) : 0;
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

async function fetchAllPaginatedItems<T>(
  url: string,
  headers: { Authorization: string },
  params: ListQueryParams = {},
): Promise<T[]> {
  const allItems: T[] = [];
  let offset = 0;

  while (true) {
    const response = await axios.get<ListResponse<T>>(url, {
      headers,
      params: {
        ...params,
        limit: LIST_LIMIT,
        offset,
      },
    });

    allItems.push(...response.data.items);

    if (
      response.data.items.length === 0 ||
      allItems.length >= response.data.total
    ) {
      break;
    }

    offset += LIST_LIMIT;
  }

  return allItems;
}

function OperatorOverviewPanel({
  accessToken,
  apiBaseUrl,
}: OperatorOverviewPanelProps) {
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);

  const fetchOverviewSnapshot = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    const headers = { Authorization: `Bearer ${accessToken}` };

    try {
      const [
        liveSummaryRes,
        openAlertsRes,
        routesRes,
        shiftsRes,
        bins,
        serviceAreas,
      ] = await Promise.all([
        axios.get<TelemetryLiveSummary>(
          `${apiBaseUrl}/telemetry/live/summary`,
          {
            headers,
          },
        ),
        axios.get<AlertListResponse>(`${apiBaseUrl}/alerts`, {
          headers,
          params: { status: "open", limit: 20, offset: 0 },
        }),
        axios.get<OperationsListResponse>(`${apiBaseUrl}/operations/routes`, {
          headers,
          params: { limit: 1, offset: 0 },
        }),
        axios.get<OperationsListResponse>(`${apiBaseUrl}/operations/shifts`, {
          headers,
          params: { limit: 1, offset: 0 },
        }),
        fetchAllPaginatedItems<BinRecord>(`${apiBaseUrl}/bins`, headers, {
          is_active: true,
        }),
        fetchAllPaginatedItems<ServiceAreaRecord>(
          `${apiBaseUrl}/master-data/service-areas`,
          headers,
          { is_active: true },
        ),
      ]);

      const areaNameById = new Map<number, string>();
      for (const area of serviceAreas) {
        areaNameById.set(area.id, area.name);
      }

      const serviceAreaBinCount = new Map<string, number>();
      for (const bin of bins) {
        const label =
          bin.area_id != null
            ? (areaNameById.get(bin.area_id) ?? `Area ${bin.area_id}`)
            : "Unassigned";
        serviceAreaBinCount.set(
          label,
          (serviceAreaBinCount.get(label) ?? 0) + 1,
        );
      }

      const topServiceAreas = [...serviceAreaBinCount.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 5);

      setSnapshot({
        liveSummary: liveSummaryRes.data,
        openAlerts: openAlertsRes.data,
        topServiceAreas,
        operations: {
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
  }, [accessToken, apiBaseUrl]);

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

    const binsWithState = safeNumber(snapshot.liveSummary.bins_with_state);
    const redBins = safeNumber(snapshot.liveSummary.red_bins);
    const yellowBins = safeNumber(snapshot.liveSummary.yellow_bins);
    const lowBins = Math.max(binsWithState - redBins - yellowBins, 0);

    return [
      { name: "High (Red)", value: redBins },
      { name: "Medium (Yellow)", value: yellowBins },
      { name: "Low (Green)", value: lowBins },
    ];
  }, [snapshot]);

  const performanceBars = useMemo(() => {
    if (!snapshot) {
      return [] as Array<{ name: string; value: number }>;
    }

    return snapshot.topServiceAreas;
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
        <CardHeader>
          <div>
            <CardTitle>Operator Overview</CardTitle>
            <CardDescription>
              Unified operational pulse across telemetry, alerts, routes,
              shifts, and impact analytics.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Bin Health Distribution</CardTitle>
            <CardDescription>
              Count of bins in high, medium, and low fill from telemetry live
              summary.
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
              Top 5 service areas by number of bins available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {performanceBars.length === 0 ? (
              <p className="text-sm text-slate-600">
                No service area bin data available.
              </p>
            ) : (
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
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(value) => Number(value ?? 0).toLocaleString()}
                    />
                    <Bar dataKey="value" fill="#0f766e" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
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

      {errorMessage ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export default OperatorOverviewPanel;
