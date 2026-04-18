import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  PlayCircle,
  RefreshCw,
  Truck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { extractApiErrorMessage } from "@/lib/authApi";

type DriverShiftsPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type ShiftItem = {
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

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

const LIST_LIMIT = 100;

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
    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  }
  if (status === "scheduled") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function DriverShiftsPanel({
  accessToken,
  apiBaseUrl,
}: DriverShiftsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("all");

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [totalShifts, setTotalShifts] = useState(0);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const fetchShifts = useCallback(async () => {
    setRefreshing(true);
    setErrorMessage("");

    try {
      const response = await axios.get<ListResponse<ShiftItem>>(
        `${apiBaseUrl}/operations/shifts`,
        {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
            status: statusFilter === "all" ? undefined : statusFilter,
          },
        },
      );

      setShifts(response.data.items);
      setTotalShifts(response.data.total);
    } catch (error) {
      setShifts([]);
      setTotalShifts(0);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load my shifts."),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl, headers, statusFilter]);

  useEffect(() => {
    void fetchShifts();
  }, [fetchShifts]);

  const metrics = useMemo(() => {
    const scheduled = shifts.filter(
      (item) => item.status === "scheduled",
    ).length;
    const active = shifts.filter((item) => item.status === "active").length;
    const completed = shifts.filter(
      (item) => item.status === "completed",
    ).length;

    return {
      scheduled,
      active,
      completed,
    };
  }, [shifts]);

  const nextScheduledShift = useMemo(() => {
    const items = shifts
      .filter((item) => item.status === "scheduled")
      .sort(
        (left, right) =>
          new Date(left.planned_start).getTime() -
          new Date(right.planned_start).getTime(),
      );
    return items[0] ?? null;
  }, [shifts]);

  const updateShiftStatus = async (
    shiftId: number,
    action: "start" | "complete",
  ) => {
    setBusyKey(`shift-${action}-${shiftId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/shifts/${shiftId}/${action}`,
        {},
        { headers },
      );
      setNoticeMessage(`Shift ${action}ed.`);
      await fetchShifts();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, `Failed to ${action} shift.`),
      );
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>My Shifts</CardTitle>
            <CardDescription>
              Driver shift timeline with start and complete actions.
            </CardDescription>
          </div>
          <div className="flex w-full max-w-md gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Shift status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All shift status</SelectItem>
                <SelectItem value="scheduled">scheduled</SelectItem>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="completed">completed</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => void fetchShifts()}
              disabled={refreshing}
            >
              <RefreshCw
                className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
      </Card>

      {errorMessage ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {noticeMessage ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {noticeMessage}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Total Shifts
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {totalShifts}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Scheduled
            </p>
            <p className="mt-2 text-3xl font-semibold text-amber-700">
              {metrics.scheduled}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Active
            </p>
            <p className="mt-2 text-3xl font-semibold text-cyan-700">
              {metrics.active}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Completed
            </p>
            <p className="mt-2 text-3xl font-semibold text-emerald-700">
              {metrics.completed}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Shift Timeline</CardTitle>
            <CardDescription>
              Sorted by planned start time, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <p className="text-sm text-slate-600">
                No shifts found for selected filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shift</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Planned</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shifts
                      .slice()
                      .sort(
                        (left, right) =>
                          new Date(right.planned_start).getTime() -
                          new Date(left.planned_start).getTime(),
                      )
                      .map((shift) => {
                        const canStart = shift.status === "scheduled";
                        const canComplete = shift.status === "active";

                        return (
                          <TableRow key={shift.id}>
                            <TableCell>
                              <p className="font-medium text-slate-900">
                                Shift #{shift.id}
                              </p>
                              <p className="text-xs text-slate-500">
                                Vehicle ID: {shift.vehicle_id ?? "unassigned"}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Badge
                                className={shiftStatusBadgeClass(shift.status)}
                              >
                                {shift.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <p>{formatDateTime(shift.planned_start)}</p>
                              <p className="text-xs text-slate-500">
                                to {formatDateTime(shift.planned_end)}
                              </p>
                            </TableCell>
                            <TableCell>
                              <p>Start: {formatDateTime(shift.actual_start)}</p>
                              <p className="text-xs text-slate-500">
                                End: {formatDateTime(shift.actual_end)}
                              </p>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void updateShiftStatus(shift.id, "start")
                                  }
                                  disabled={!canStart || busyKey != null}
                                >
                                  <PlayCircle className="mr-1 h-4 w-4" />
                                  Start
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    void updateShiftStatus(shift.id, "complete")
                                  }
                                  disabled={!canComplete || busyKey != null}
                                >
                                  <CheckCircle2 className="mr-1 h-4 w-4" />
                                  Complete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Current Focus</CardTitle>
            <CardDescription>
              Quick view of the next or active shift.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {metrics.active > 0 ? (
              <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                <p className="text-sm font-medium text-cyan-900">
                  Active shift in progress
                </p>
                <p className="text-xs text-cyan-800">
                  Complete this shift after finishing assigned route work.
                </p>
              </div>
            ) : null}

            {nextScheduledShift ? (
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-900">
                  Next scheduled shift
                </p>
                <p className="text-xs text-slate-700">
                  Shift #{nextScheduledShift.id}
                </p>
                <p className="text-xs text-slate-500">
                  Starts: {formatDateTime(nextScheduledShift.planned_start)}
                </p>
                <p className="text-xs text-slate-500">
                  Vehicle ID: {nextScheduledShift.vehicle_id ?? "unassigned"}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                No upcoming scheduled shift.
              </p>
            )}

            <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                <CalendarClock className="mr-1 inline h-4 w-4" />
                Start when status is scheduled.
              </p>
              <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                <Clock3 className="mr-1 inline h-4 w-4" />
                Complete when active work ends.
              </p>
              <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                <Truck className="mr-1 inline h-4 w-4" />
                Shift links with vehicle assignment.
              </p>
              <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                Completed shifts lock execution timeline.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default DriverShiftsPanel;
