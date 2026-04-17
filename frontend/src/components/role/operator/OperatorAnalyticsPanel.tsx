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
import { Leaf, RefreshCw, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { extractApiErrorMessage } from "@/lib/authApi";

type OperatorAnalyticsPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type EfficiencyAnalytics = {
  from_ts: string;
  to_ts: string;
  total_collections: number;
  total_routes: number;
  total_distance_km: number;
  total_active_hours: number;
  collections_per_hour: number;
  distance_per_collection_km: number;
};

type SavingsAnalytics = {
  from_ts: string;
  to_ts: string;
  routes_analyzed: number;
  optimized_distance_km: number;
  naive_distance_km: number;
  distance_saved_km: number;
  distance_saved_pct: number;
  optimized_fuel_l: number;
  naive_fuel_l: number;
  fuel_saved_l: number;
  fuel_saved_pct: number;
};

type EnvironmentalAnalytics = {
  from_ts: string;
  to_ts: string;
  optimized_co2_kg: number;
  naive_co2_kg: number;
  co2_saved_kg: number;
  co2_reduction_pct: number;
  fuel_saved_l: number;
  distance_saved_km: number;
};

function todayDateText(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateDaysAgoText(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toRangeIso(dateText: string, endOfDay: boolean): string {
  return `${dateText}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

function formatMetric(value: number, digits = 2): string {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function OperatorAnalyticsPanel({
  accessToken,
  apiBaseUrl,
}: OperatorAnalyticsPanelProps) {
  const [rangePreset, setRangePreset] = useState("30");
  const [fromDate, setFromDate] = useState(() => dateDaysAgoText(30));
  const [toDate, setToDate] = useState(() => todayDateText());

  const [loading, setLoading] = useState(true);
  const [efficiency, setEfficiency] = useState<EfficiencyAnalytics | null>(
    null,
  );
  const [savings, setSavings] = useState<SavingsAnalytics | null>(null);
  const [environmental, setEnvironmental] =
    useState<EnvironmentalAnalytics | null>(null);

  const [errorMessage, setErrorMessage] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  useEffect(() => {
    if (rangePreset === "custom") {
      return;
    }
    const days = Number.parseInt(rangePreset, 10);
    if (!Number.isFinite(days)) {
      return;
    }
    setFromDate(dateDaysAgoText(days));
    setToDate(todayDateText());
  }, [rangePreset]);

  const fetchAnalytics = useCallback(async () => {
    if (!fromDate || !toDate) {
      setErrorMessage("From and To dates are required.");
      return;
    }

    if (fromDate > toDate) {
      setErrorMessage("From date cannot be after To date.");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    const fromIso = toRangeIso(fromDate, false);
    const toIso = toRangeIso(toDate, true);

    try {
      const [efficiencyRes, savingsRes, environmentalRes] = await Promise.all([
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
      ]);

      setEfficiency(efficiencyRes.data);
      setSavings(savingsRes.data);
      setEnvironmental(environmentalRes.data);
    } catch (error) {
      setEfficiency(null);
      setSavings(null);
      setEnvironmental(null);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load analytics metrics."),
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, fromDate, headers, toDate]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  const impactBarData = useMemo(() => {
    if (!savings || !environmental) {
      return [] as Array<{ name: string; value: number }>;
    }
    return [
      { name: "Distance Saved (km)", value: savings.distance_saved_km },
      { name: "Fuel Saved (L)", value: savings.fuel_saved_l },
      { name: "CO2 Saved (kg)", value: environmental.co2_saved_kg },
      { name: "Routes Analyzed", value: savings.routes_analyzed },
    ];
  }, [environmental, savings]);

  const distanceSplitData = useMemo(() => {
    if (!savings) {
      return [] as Array<{ name: string; value: number; color: string }>;
    }
    return [
      {
        name: "Optimized",
        value: Math.max(savings.optimized_distance_km, 0),
        color: "#0ea5e9",
      },
      {
        name: "Saved",
        value: Math.max(savings.distance_saved_km, 0),
        color: "#10b981",
      },
    ];
  }, [savings]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader>
          <CardTitle>Analytics Controls</CardTitle>
          <CardDescription>
            Compare route efficiency, savings, and environmental impact over a
            selected range.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label>Range preset</Label>
            <Select value={rangePreset} onValueChange={setRangePreset}>
              <SelectTrigger>
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="analytics_from">From</Label>
            <Input
              id="analytics_from"
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setRangePreset("custom");
              }}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="analytics_to">To</Label>
            <Input
              id="analytics_to"
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                setRangePreset("custom");
              }}
            />
          </div>

          <div className="flex items-end lg:col-span-2">
            <Button onClick={() => void fetchAnalytics()}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Refresh Analytics
            </Button>
          </div>
        </CardContent>
      </Card>

      {errorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {efficiency && savings && environmental ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-white/80 bg-white/85 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Collections / Hour
                </CardDescription>
                <CardTitle className="text-2xl">
                  {formatMetric(efficiency.collections_per_hour, 3)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-slate-600">
                Total collections: {efficiency.total_collections}
              </CardContent>
            </Card>

            <Card className="border-white/80 bg-white/85 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>Distance / Collection</CardDescription>
                <CardTitle className="text-2xl">
                  {formatMetric(efficiency.distance_per_collection_km)} km
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-slate-600">
                Total distance: {formatMetric(efficiency.total_distance_km)} km
              </CardContent>
            </Card>

            <Card className="border-white/80 bg-white/85 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription>Fuel Saved</CardDescription>
                <CardTitle className="text-2xl">
                  {formatMetric(savings.fuel_saved_l)} L
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-slate-600">
                {formatMetric(savings.fuel_saved_pct, 1)}% reduction
              </CardContent>
            </Card>

            <Card className="border-white/80 bg-white/85 shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <Leaf className="h-4 w-4" />
                  CO2 Saved
                </CardDescription>
                <CardTitle className="text-2xl">
                  {formatMetric(environmental.co2_saved_kg)} kg
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-slate-600">
                {formatMetric(environmental.co2_reduction_pct, 1)}% reduction
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
              <CardHeader>
                <CardTitle>Impact Snapshot</CardTitle>
                <CardDescription>
                  Savings and impact metrics from route optimization.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={impactBarData}
                      margin={{ top: 12, right: 12, left: 2, bottom: 24 }}
                    >
                      <CartesianGrid strokeDasharray="4 4" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="name"
                        angle={-18}
                        textAnchor="end"
                        interval={0}
                        height={58}
                      />
                      <YAxis />
                      <Tooltip
                        formatter={(value) =>
                          Number(value ?? 0).toLocaleString(undefined, {
                            maximumFractionDigits: 3,
                          })
                        }
                      />
                      <Bar
                        dataKey="value"
                        fill="#0ea5e9"
                        radius={[8, 8, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
              <CardHeader>
                <CardTitle>Distance Composition</CardTitle>
                <CardDescription>
                  Optimized travel distance versus saved distance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distanceSplitData}
                        dataKey="value"
                        nameKey="name"
                        outerRadius={95}
                        cx="50%"
                        cy="50%"
                        label
                      >
                        {distanceSplitData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) =>
                          Number(value ?? 0).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
            <CardHeader>
              <CardTitle>Raw Metric Summary</CardTitle>
              <CardDescription>
                Reporting window:{" "}
                {new Date(efficiency.from_ts).toLocaleString()} to{" "}
                {new Date(efficiency.to_ts).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Total Routes</p>
                <p className="font-semibold text-slate-900">
                  {efficiency.total_routes}
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Active Hours</p>
                <p className="font-semibold text-slate-900">
                  {formatMetric(efficiency.total_active_hours)} hrs
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Distance Saved</p>
                <p className="font-semibold text-slate-900">
                  {formatMetric(savings.distance_saved_km)} km
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Naive Fuel</p>
                <p className="font-semibold text-slate-900">
                  {formatMetric(savings.naive_fuel_l)} L
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Optimized CO2</p>
                <p className="font-semibold text-slate-900">
                  {formatMetric(environmental.optimized_co2_kg)} kg
                </p>
              </div>
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                <p className="text-slate-500">Naive CO2</p>
                <p className="font-semibold text-slate-900">
                  {formatMetric(environmental.naive_co2_kg)} kg
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

export default OperatorAnalyticsPanel;
