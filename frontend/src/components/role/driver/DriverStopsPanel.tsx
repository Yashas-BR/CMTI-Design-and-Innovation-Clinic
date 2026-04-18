import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CheckCircle2,
  Clock3,
  LocateFixed,
  RefreshCw,
  SkipForward,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { extractApiErrorMessage } from "@/lib/authApi";

type DriverStopsPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type DriverStopItem = {
  id: number;
  route_id: number;
  stop_sequence: number;
  bin_id: number;
  planned_eta: string | null;
  planned_service_minutes: number | null;
  priority_snapshot: number | null;
  status: string;
  actual_arrival: string | null;
  actual_departure: string | null;
  skip_reason: string | null;
  route_code: string;
  route_date: string | null;
  route_status: string;
  assignment_id: number;
  assignment_status: string;
  vehicle_id: number | null;
  bin_code: string;
};

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

const LIST_LIMIT = 500;

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

function stopStatusBadgeClass(status: string): string {
  if (status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "arrived") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "serviced") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "skipped") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function routeStatusBadgeClass(status: string): string {
  if (status === "in_progress") {
    return "border-cyan-200 bg-cyan-50 text-cyan-700";
  }
  if (status === "published") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `driver-stop-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function DriverStopsPanel({ accessToken, apiBaseUrl }: DriverStopsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const [stopStatusFilter, setStopStatusFilter] = useState("all");
  const [routeStatusFilter, setRouteStatusFilter] = useState("all");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("all");

  const [stops, setStops] = useState<DriverStopItem[]>([]);
  const [totalStops, setTotalStops] = useState(0);
  const [skipDialogTarget, setSkipDialogTarget] = useState<{
    stopId: number;
    routeCode: string;
    stopSequence: number;
    binCode: string;
  } | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [skipReasonError, setSkipReasonError] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const fetchStops = useCallback(async () => {
    setRefreshing(true);
    setErrorMessage("");

    try {
      const response = await axios.get<ListResponse<DriverStopItem>>(
        `${apiBaseUrl}/operations/my-stops`,
        {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
            status: stopStatusFilter === "all" ? undefined : stopStatusFilter,
            route_status:
              routeStatusFilter === "all" ? undefined : routeStatusFilter,
            assignment_status:
              assignmentStatusFilter === "all"
                ? undefined
                : assignmentStatusFilter,
          },
        },
      );

      setStops(response.data.items);
      setTotalStops(response.data.total);
    } catch (error) {
      setStops([]);
      setTotalStops(0);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load my stops."),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    apiBaseUrl,
    assignmentStatusFilter,
    headers,
    routeStatusFilter,
    stopStatusFilter,
  ]);

  useEffect(() => {
    void fetchStops();
  }, [fetchStops]);

  const metrics = useMemo(() => {
    const pending = stops.filter((item) => item.status === "pending").length;
    const arrived = stops.filter((item) => item.status === "arrived").length;
    const serviced = stops.filter((item) => item.status === "serviced").length;
    const skipped = stops.filter((item) => item.status === "skipped").length;

    return { pending, arrived, serviced, skipped };
  }, [stops]);

  const runStopTransition = async (
    stopId: number,
    action: "arrive" | "service" | "skip",
    skipReasonValue?: string,
  ): Promise<boolean> => {
    setBusyKey(`stop-${action}-${stopId}`);
    setErrorMessage("");
    setNoticeMessage("");

    const idempotencyHeaders = {
      ...headers,
      "Idempotency-Key": createIdempotencyKey(),
    };

    try {
      if (action === "skip") {
        await axios.post(
          `${apiBaseUrl}/operations/stops/${stopId}/skip`,
          { reason: skipReasonValue },
          { headers: idempotencyHeaders },
        );
      } else {
        await axios.post(
          `${apiBaseUrl}/operations/stops/${stopId}/${action}`,
          {},
          { headers: idempotencyHeaders },
        );
      }

      const actionLabel =
        action === "arrive"
          ? "arrived"
          : action === "service"
            ? "serviced"
            : "skipped";
      setNoticeMessage(`Stop marked as ${actionLabel}.`);
      await fetchStops();
      return true;
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, `Failed to ${action} stop.`),
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const openSkipDialog = (stop: DriverStopItem) => {
    setSkipDialogTarget({
      stopId: stop.id,
      routeCode: stop.route_code,
      stopSequence: stop.stop_sequence,
      binCode: stop.bin_code,
    });
    setSkipReason("");
    setSkipReasonError("");
  };

  const closeSkipDialog = () => {
    setSkipDialogTarget(null);
    setSkipReason("");
    setSkipReasonError("");
  };

  const submitSkipStop = async () => {
    if (!skipDialogTarget) {
      return;
    }

    const reason = skipReason.trim();
    if (reason.length < 5) {
      setSkipReasonError("Provide at least 5 characters for skip reason.");
      return;
    }

    setSkipReasonError("");
    const ok = await runStopTransition(skipDialogTarget.stopId, "skip", reason);
    if (ok) {
      closeSkipDialog();
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
            <CardTitle>My Stops</CardTitle>
            <CardDescription>
              Driver stop execution board with scoped stop actions.
            </CardDescription>
          </div>
          <div className="flex w-full max-w-4xl gap-2">
            <Select
              value={stopStatusFilter}
              onValueChange={setStopStatusFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Stop status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stop status</SelectItem>
                <SelectItem value="pending">pending</SelectItem>
                <SelectItem value="arrived">arrived</SelectItem>
                <SelectItem value="serviced">serviced</SelectItem>
                <SelectItem value="skipped">skipped</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={routeStatusFilter}
              onValueChange={setRouteStatusFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Route status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All route status</SelectItem>
                <SelectItem value="published">published</SelectItem>
                <SelectItem value="in_progress">in_progress</SelectItem>
                <SelectItem value="completed">completed</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={assignmentStatusFilter}
              onValueChange={setAssignmentStatusFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Assignment status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignment status</SelectItem>
                <SelectItem value="assigned">assigned</SelectItem>
                <SelectItem value="accepted">accepted</SelectItem>
                <SelectItem value="rejected">rejected</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() => void fetchStops()}
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Total Stops
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {totalStops}
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Pending
            </p>
            <p className="mt-2 text-3xl font-semibold text-amber-700">
              {metrics.pending}
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Arrived
            </p>
            <p className="mt-2 text-3xl font-semibold text-sky-700">
              {metrics.arrived}
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Serviced
            </p>
            <p className="mt-2 text-3xl font-semibold text-emerald-700">
              {metrics.serviced}
            </p>
          </CardContent>
        </Card>
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Skipped
            </p>
            <p className="mt-2 text-3xl font-semibold text-red-700">
              {metrics.skipped}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/80 bg-white/85 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Stop Queue</CardTitle>
          <CardDescription>
            Rows are scoped to your assigned routes. Stop actions are
            idempotent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stops.length === 0 ? (
            <p className="text-sm text-slate-600">
              No stops found for selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Stop</TableHead>
                    <TableHead>Bin</TableHead>
                    <TableHead>ETA</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Route Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stops.map((stop) => {
                    const canActOnRoute =
                      stop.route_status === "in_progress" &&
                      (stop.assignment_status === "assigned" ||
                        stop.assignment_status === "accepted");
                    const canArrive =
                      canActOnRoute && stop.status === "pending";
                    const canService =
                      canActOnRoute && stop.status === "arrived";
                    const canSkip = canActOnRoute && stop.status === "arrived";

                    return (
                      <TableRow key={`${stop.route_id}-${stop.id}`}>
                        <TableCell>
                          <p className="font-medium text-slate-900">
                            {stop.route_code}
                          </p>
                          <p className="text-xs text-slate-500">
                            {stop.route_date ?? "n/a"} | Vehicle{" "}
                            {stop.vehicle_id ?? "n/a"}
                          </p>
                        </TableCell>
                        <TableCell>
                          #{stop.stop_sequence}
                          <p className="text-xs text-slate-500">ID {stop.id}</p>
                        </TableCell>
                        <TableCell>{stop.bin_code}</TableCell>
                        <TableCell>
                          {formatDateTime(stop.planned_eta)}
                        </TableCell>
                        <TableCell>
                          <Badge className={stopStatusBadgeClass(stop.status)}>
                            {stop.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={routeStatusBadgeClass(stop.route_status)}
                          >
                            {stop.route_status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void runStopTransition(stop.id, "arrive")
                              }
                              disabled={!canArrive || busyKey != null}
                            >
                              <LocateFixed className="mr-1 h-4 w-4" />
                              Arrive
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void runStopTransition(stop.id, "service")
                              }
                              disabled={!canService || busyKey != null}
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                              Service
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openSkipDialog(stop)}
                              disabled={!canSkip || busyKey != null}
                            >
                              <SkipForward className="mr-1 h-4 w-4" />
                              Skip
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
          <CardTitle className="text-base">Execution Notes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <Clock3 className="mr-1 inline h-4 w-4" />
            Pending stops can be marked arrived.
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <LocateFixed className="mr-1 inline h-4 w-4" />
            Arrive first to unlock service/skip.
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <CheckCircle2 className="mr-1 inline h-4 w-4" />
            Service marks the stop terminal.
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <Truck className="mr-1 inline h-4 w-4" />
            Complete route after all stops are terminal.
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={skipDialogTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            closeSkipDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skip Stop</DialogTitle>
            <DialogDescription>
              {skipDialogTarget
                ? `Route ${skipDialogTarget.routeCode}, stop #${skipDialogTarget.stopSequence} (${skipDialogTarget.binCode}).`
                : "Provide a reason to skip this stop."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="skip-reason">Skip reason</Label>
            <Textarea
              id="skip-reason"
              value={skipReason}
              onChange={(event) => {
                if (skipReasonError) {
                  setSkipReasonError("");
                }
                setSkipReason(event.target.value);
              }}
              placeholder="Example: Bin inaccessible due to blocked lane."
              className="min-h-24"
            />
            {skipReasonError ? (
              <p className="text-xs text-red-700">{skipReasonError}</p>
            ) : (
              <p className="text-xs text-slate-500">
                Minimum 5 characters. This reason is stored in stop history.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeSkipDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitSkipStop()}
              disabled={busyKey != null}
            >
              Confirm Skip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DriverStopsPanel;
