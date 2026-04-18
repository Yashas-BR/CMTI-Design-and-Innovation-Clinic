import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Clock3,
  RefreshCw,
  Truck,
} from "lucide-react";
import { Link } from "react-router-dom";

import type { ShiftRecord } from "@/components/role/operator/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { extractApiErrorMessage } from "@/lib/authApi";
import { DRIVER_DASHBOARD_PATH } from "@/lib/roleRouting";

type DriverOverviewPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
  userId: number;
};

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

type NotificationItem = {
  id: number;
  title: string;
  message: string | null;
  severity: string;
  event_type: string;
  is_read: boolean;
  created_at: string;
};

type AlertItem = {
  id: number;
  title: string;
  severity: string;
  status: string;
  alert_type: string;
  bin_code: string;
  opened_at: string;
};

type TelemetryLiveSummary = {
  total_bins: number;
  bins_with_state: number;
  red_bins: number;
  yellow_bins: number;
  overflow_imminent_bins: number;
  offline_bins: number;
  open_alerts: number;
};

type DriverOverviewSnapshot = {
  shifts: ShiftRecord[];
  unreadNotifications: NotificationItem[];
  unreadTotal: number;
  openAlerts: AlertItem[];
  openAlertsTotal: number;
  liveSummary: TelemetryLiveSummary | null;
};

const LIST_LIMIT = 100;
const SUMMARY_LIMIT = 8;
const AUTO_REFRESH_MS = 20_000;

function formatDateTime(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function shiftStatusBadgeClass(status: string): string {
  if (status === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "scheduled") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "completed") {
    return "border-slate-200 bg-slate-50 text-slate-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function alertSeverityBadgeClass(severity: string): string {
  const value = severity.trim().toLowerCase();
  if (value === "critical") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (value === "high") {
    return "border-orange-200 bg-orange-50 text-orange-700";
  }
  if (value === "medium" || value === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function DriverOverviewPanel({
  accessToken,
  apiBaseUrl,
  userId,
}: DriverOverviewPanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [snapshot, setSnapshot] = useState<DriverOverviewSnapshot | null>(null);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const fetchSnapshot = useCallback(async () => {
    setRefreshing(true);
    setErrorMessage("");

    const [shiftsResult, notificationsResult, alertsResult, summaryResult] =
      await Promise.allSettled([
        axios.get<ListResponse<ShiftRecord>>(
          `${apiBaseUrl}/operations/shifts`,
          {
            headers,
            params: { limit: LIST_LIMIT, offset: 0 },
          },
        ),
        axios.get<ListResponse<NotificationItem>>(
          `${apiBaseUrl}/notifications/in-app`,
          {
            headers,
            params: {
              limit: SUMMARY_LIMIT,
              offset: 0,
              unread_only: true,
            },
          },
        ),
        axios.get<ListResponse<AlertItem>>(`${apiBaseUrl}/alerts`, {
          headers,
          params: {
            status: "open",
            assigned_to_user_id: userId,
            limit: SUMMARY_LIMIT,
            offset: 0,
          },
        }),
        axios.get<TelemetryLiveSummary>(
          `${apiBaseUrl}/telemetry/live/summary`,
          {
            headers,
          },
        ),
      ]);

    let failedBlocks = 0;
    const warningMessages: string[] = [];

    if (shiftsResult.status === "rejected") {
      failedBlocks += 1;
      warningMessages.push(
        extractApiErrorMessage(shiftsResult.reason, "Shifts unavailable"),
      );
    }
    if (notificationsResult.status === "rejected") {
      failedBlocks += 1;
      warningMessages.push(
        extractApiErrorMessage(
          notificationsResult.reason,
          "Notifications unavailable",
        ),
      );
    }
    if (alertsResult.status === "rejected") {
      failedBlocks += 1;
      warningMessages.push(
        extractApiErrorMessage(alertsResult.reason, "Alerts unavailable"),
      );
    }
    if (summaryResult.status === "rejected") {
      failedBlocks += 1;
      warningMessages.push(
        extractApiErrorMessage(
          summaryResult.reason,
          "Live telemetry summary unavailable",
        ),
      );
    }

    if (failedBlocks === 4) {
      setSnapshot(null);
      setErrorMessage(
        "Failed to load driver overview. Verify backend services and try again.",
      );
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setSnapshot({
      shifts:
        shiftsResult.status === "fulfilled"
          ? shiftsResult.value.data.items
          : [],
      unreadNotifications:
        notificationsResult.status === "fulfilled"
          ? notificationsResult.value.data.items
          : [],
      unreadTotal:
        notificationsResult.status === "fulfilled"
          ? notificationsResult.value.data.total
          : 0,
      openAlerts:
        alertsResult.status === "fulfilled"
          ? alertsResult.value.data.items
          : [],
      openAlertsTotal:
        alertsResult.status === "fulfilled" ? alertsResult.value.data.total : 0,
      liveSummary:
        summaryResult.status === "fulfilled" ? summaryResult.value.data : null,
    });

    if (warningMessages.length > 0) {
      setErrorMessage(warningMessages[0]);
    }

    setLoading(false);
    setRefreshing(false);
  }, [apiBaseUrl, headers, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSnapshot();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [fetchSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void fetchSnapshot();
    }, AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchSnapshot]);

  const activeShift = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    return (
      snapshot.shifts
        .filter((shift) => shift.status === "active")
        .sort(
          (left, right) =>
            new Date(right.updated_at).getTime() -
            new Date(left.updated_at).getTime(),
        )[0] ?? null
    );
  }, [snapshot]);

  const nextScheduledShift = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    const upcoming = snapshot.shifts
      .filter((shift) => shift.status === "scheduled")
      .sort(
        (left, right) =>
          new Date(left.planned_start).getTime() -
          new Date(right.planned_start).getTime(),
      );

    return upcoming[0] ?? null;
  }, [snapshot]);

  const completedToday = useMemo(() => {
    if (!snapshot) {
      return 0;
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

    return snapshot.shifts.filter((shift) => {
      if (shift.status !== "completed" || !shift.actual_end) {
        return false;
      }
      const completedDate = new Date(shift.actual_end);
      const completedKey = `${completedDate.getFullYear()}-${completedDate.getMonth()}-${completedDate.getDate()}`;
      return completedKey === todayKey;
    }).length;
  }, [snapshot]);

  const recentShifts = useMemo(() => {
    if (!snapshot) {
      return [] as ShiftRecord[];
    }

    return [...snapshot.shifts]
      .sort(
        (left, right) =>
          new Date(right.planned_start).getTime() -
          new Date(left.planned_start).getTime(),
      )
      .slice(0, 5);
  }, [snapshot]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <Card className="border-red-200 bg-red-50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-red-900">
            Driver Overview Unavailable
          </CardTitle>
          <CardDescription className="text-red-700">
            {errorMessage || "Could not load driver overview metrics."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void fetchSnapshot()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Driver Overview</CardTitle>
            <CardDescription>
              Live pulse for your shift, assigned alerts, and route-readiness.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => void fetchSnapshot()}
            disabled={refreshing}
          >
            <RefreshCw
              className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </CardHeader>
      </Card>

      {errorMessage ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {errorMessage}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Active Shift
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {activeShift ? "1" : "0"}
            </p>
            <p className="text-xs text-slate-600">
              {activeShift
                ? `Shift #${activeShift.id} in progress`
                : "No active shift right now"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Next Scheduled Shift
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {nextScheduledShift
                ? formatDateTime(nextScheduledShift.planned_start)
                : "Not scheduled"}
            </p>
            <p className="text-xs text-slate-600">
              Completed today: {completedToday}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              My Open Alerts
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {snapshot.openAlertsTotal}
            </p>
            <p className="text-xs text-slate-600">
              Requires acknowledgement or resolution
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Unread Notifications
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {snapshot.unreadTotal}
            </p>
            <p className="text-xs text-slate-600">Auto refresh every 20 sec</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent Shifts</CardTitle>
            <CardDescription>
              Latest shifts in your timeline (newest first).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentShifts.length === 0 ? (
              <p className="text-sm text-slate-600">No shifts found.</p>
            ) : (
              recentShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      Shift #{shift.id}
                    </p>
                    <Badge className={shiftStatusBadgeClass(shift.status)}>
                      {shift.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600">
                    Planned: {formatDateTime(shift.planned_start)} -{" "}
                    {formatDateTime(shift.planned_end)}
                  </p>
                  <p className="text-xs text-slate-500">
                    Vehicle ID: {shift.vehicle_id ?? "unassigned"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">
              Open Alerts Assigned To You
            </CardTitle>
            <CardDescription>
              Prioritized list of current assigned alerts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {snapshot.openAlerts.length === 0 ? (
              <p className="text-sm text-slate-600">
                No assigned open alerts right now.
              </p>
            ) : (
              snapshot.openAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      {alert.title}
                    </p>
                    <Badge className={alertSeverityBadgeClass(alert.severity)}>
                      {alert.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600">
                    Bin: {alert.bin_code} - Type: {alert.alert_type}
                  </p>
                  <p className="text-xs text-slate-500">
                    Opened: {formatDateTime(alert.opened_at)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <CardDescription>
              Jump to the next task in your workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <Button asChild variant="outline" className="justify-start">
              <Link to={`${DRIVER_DASHBOARD_PATH}/my-shifts`}>
                <CalendarClock className="mr-2 h-4 w-4" />
                My Shifts
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to={`${DRIVER_DASHBOARD_PATH}/my-routes`}>
                <Truck className="mr-2 h-4 w-4" />
                My Routes
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to={`${DRIVER_DASHBOARD_PATH}/my-stops`}>
                <Clock3 className="mr-2 h-4 w-4" />
                My Stops
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link to={`${DRIVER_DASHBOARD_PATH}/alerts`}>
                <AlertTriangle className="mr-2 h-4 w-4" />
                Alerts
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="justify-start sm:col-span-2"
            >
              <Link to={`${DRIVER_DASHBOARD_PATH}/notifications`}>
                <Bell className="mr-2 h-4 w-4" />
                Notifications
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Live Network Context</CardTitle>
            <CardDescription>
              Telemetry situation across the organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {snapshot.liveSummary ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Total Bins
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {snapshot.liveSummary.total_bins}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Red Bins
                  </p>
                  <p className="mt-1 text-xl font-semibold text-red-700">
                    {snapshot.liveSummary.red_bins}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Yellow Bins
                  </p>
                  <p className="mt-1 text-xl font-semibold text-amber-700">
                    {snapshot.liveSummary.yellow_bins}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Offline Bins
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-700">
                    {snapshot.liveSummary.offline_bins}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Live telemetry summary is not available right now.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default DriverOverviewPanel;
