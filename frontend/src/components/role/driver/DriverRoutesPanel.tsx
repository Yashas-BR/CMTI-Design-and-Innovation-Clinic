import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CheckCircle2,
  ClipboardList,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  StopCircle,
  XCircle,
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

type DriverRoutesPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type DriverRouteItem = {
  id: number;
  org_id: number;
  route_code: string;
  route_date: string;
  depot_id: number | null;
  status: string;
  total_distance_km: number | null;
  estimated_duration_min: number | null;
  optimization_run_id: number | null;
  created_by: number | null;
  updated_by: number | null;
  stops_count: number | null;
  start_point: {
    source: string;
    depot_id: number | null;
    area_id: number | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  assignment_id: number;
  assignment_status: string;
  assigned_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  vehicle_id: number | null;
  created_at: string;
  updated_at: string;
};

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

type RouteStopItem = {
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

function assignmentStatusBadgeClass(status: string): string {
  if (status === "accepted") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "assigned") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (status === "rejected") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function DriverRoutesPanel({
  accessToken,
  apiBaseUrl,
}: DriverRoutesPanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [routeStatusFilter, setRouteStatusFilter] = useState("all");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState("all");

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [routes, setRoutes] = useState<DriverRouteItem[]>([]);
  const [totalRoutes, setTotalRoutes] = useState(0);

  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);
  const [selectedRouteStops, setSelectedRouteStops] = useState<RouteStopItem[]>(
    [],
  );
  const [stopsLoading, setStopsLoading] = useState(false);
  const [rejectDialogTarget, setRejectDialogTarget] = useState<{
    assignmentId: number;
    routeCode: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectReasonError, setRejectReasonError] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const selectedRoute = useMemo(() => {
    if (selectedRouteId == null) {
      return null;
    }
    return routes.find((route) => route.id === selectedRouteId) ?? null;
  }, [routes, selectedRouteId]);

  const fetchRoutes = useCallback(async () => {
    setRefreshing(true);
    setErrorMessage("");

    try {
      const response = await axios.get<ListResponse<DriverRouteItem>>(
        `${apiBaseUrl}/operations/my-routes`,
        {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
            status: routeStatusFilter === "all" ? undefined : routeStatusFilter,
            assignment_status:
              assignmentStatusFilter === "all"
                ? undefined
                : assignmentStatusFilter,
          },
        },
      );

      setRoutes(response.data.items);
      setTotalRoutes(response.data.total);

      setSelectedRouteId((current) => {
        if (
          current != null &&
          response.data.items.some((item) => item.id === current)
        ) {
          return current;
        }
        return response.data.items[0]?.id ?? null;
      });
    } catch (error) {
      setRoutes([]);
      setTotalRoutes(0);
      setSelectedRouteId(null);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load my routes."),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl, assignmentStatusFilter, headers, routeStatusFilter]);

  const fetchStopsForRoute = useCallback(
    async (routeId: number) => {
      setStopsLoading(true);
      try {
        const response = await axios.get<ListResponse<RouteStopItem>>(
          `${apiBaseUrl}/operations/routes/${routeId}/stops`,
          {
            headers,
            params: { limit: 500, offset: 0 },
          },
        );
        setSelectedRouteStops(response.data.items);
      } catch (error) {
        setSelectedRouteStops([]);
        setErrorMessage(
          extractApiErrorMessage(error, "Failed to load route stops."),
        );
      } finally {
        setStopsLoading(false);
      }
    },
    [apiBaseUrl, headers],
  );

  useEffect(() => {
    void fetchRoutes();
  }, [fetchRoutes]);

  useEffect(() => {
    if (selectedRouteId == null) {
      setSelectedRouteStops([]);
      return;
    }
    void fetchStopsForRoute(selectedRouteId);
  }, [fetchStopsForRoute, selectedRouteId]);

  const metrics = useMemo(() => {
    const published = routes.filter(
      (item) => item.status === "published",
    ).length;
    const inProgress = routes.filter(
      (item) => item.status === "in_progress",
    ).length;
    const completed = routes.filter(
      (item) => item.status === "completed",
    ).length;
    const pendingAccept = routes.filter(
      (item) => item.assignment_status === "assigned",
    ).length;

    return { published, inProgress, completed, pendingAccept };
  }, [routes]);

  const selectedRouteProgress = useMemo(() => {
    const serviced = selectedRouteStops.filter(
      (item) => item.status === "serviced",
    ).length;
    const skipped = selectedRouteStops.filter(
      (item) => item.status === "skipped",
    ).length;
    const terminal = serviced + skipped;
    const total = selectedRouteStops.length;

    return { serviced, skipped, terminal, total };
  }, [selectedRouteStops]);

  const acceptAssignment = async (assignmentId: number) => {
    setBusyKey(`accept-${assignmentId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/assignments/${assignmentId}/accept`,
        {},
        { headers },
      );
      setNoticeMessage("Assignment accepted.");
      await fetchRoutes();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to accept assignment."),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const openRejectDialog = (assignmentId: number, routeCode: string) => {
    setRejectDialogTarget({ assignmentId, routeCode });
    setRejectReason("");
    setRejectReasonError("");
  };

  const closeRejectDialog = () => {
    setRejectDialogTarget(null);
    setRejectReason("");
    setRejectReasonError("");
  };

  const submitRejectAssignment = async () => {
    if (!rejectDialogTarget) {
      return;
    }

    const reason = rejectReason.trim();
    if (reason.length < 5) {
      setRejectReasonError(
        "Provide at least 5 characters for rejection reason.",
      );
      return;
    }

    const assignmentId = rejectDialogTarget.assignmentId;
    setBusyKey(`reject-${assignmentId}`);
    setErrorMessage("");
    setNoticeMessage("");
    setRejectReasonError("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/assignments/${assignmentId}/reject`,
        { reject_reason: reason },
        { headers },
      );
      setNoticeMessage("Assignment rejected.");
      closeRejectDialog();
      await fetchRoutes();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to reject assignment."),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const startRoute = async (routeId: number) => {
    setBusyKey(`start-${routeId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/routes/${routeId}/start`,
        {},
        { headers },
      );
      setNoticeMessage("Route started.");
      await fetchRoutes();
      await fetchStopsForRoute(routeId);
    } catch (error) {
      setErrorMessage(extractApiErrorMessage(error, "Failed to start route."));
    } finally {
      setBusyKey(null);
    }
  };

  const completeRoute = async (routeId: number) => {
    setBusyKey(`complete-${routeId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/routes/${routeId}/complete`,
        {},
        { headers },
      );
      setNoticeMessage("Route completed.");
      await fetchRoutes();
      await fetchStopsForRoute(routeId);
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(
          error,
          "Failed to complete route. Ensure all stops are serviced or skipped.",
        ),
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
            <CardTitle>My Routes</CardTitle>
            <CardDescription>
              Manage assignment acceptance and route lifecycle from one view.
            </CardDescription>
          </div>
          <div className="flex w-full max-w-md gap-2">
            <Select
              value={routeStatusFilter}
              onValueChange={setRouteStatusFilter}
            >
              <SelectTrigger>
                <SelectValue placeholder="Route status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All route status</SelectItem>
                <SelectItem value="draft">draft</SelectItem>
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
              onClick={() => void fetchRoutes()}
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
              Total Routes
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {totalRoutes}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Pending Accept
            </p>
            <p className="mt-2 text-3xl font-semibold text-amber-700">
              {metrics.pendingAccept}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              In Progress
            </p>
            <p className="mt-2 text-3xl font-semibold text-cyan-700">
              {metrics.inProgress}
            </p>
            <p className="text-xs text-slate-600">
              Published: {metrics.published}
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

      <Card className="border-white/80 bg-white/85 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Assigned Route List</CardTitle>
          <CardDescription>
            Select a route row to inspect stop progress and perform actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {routes.length === 0 ? (
            <p className="text-sm text-slate-600">
              No assigned routes for selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Route Status</TableHead>
                    <TableHead>Assignment</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Stops</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routes.map((route) => {
                    const canAccept = route.assignment_status === "assigned";
                    const canReject = route.assignment_status === "assigned";
                    const canStart =
                      route.status === "published" &&
                      (route.assignment_status === "accepted" ||
                        route.assignment_status === "assigned");
                    const canComplete = route.status === "in_progress";
                    const isSelected = selectedRouteId === route.id;

                    return (
                      <TableRow
                        key={`${route.id}-${route.assignment_id}`}
                        className={isSelected ? "bg-cyan-50/50" : undefined}
                        onClick={() => setSelectedRouteId(route.id)}
                      >
                        <TableCell>
                          <p className="font-medium text-slate-900">
                            {route.route_code}
                          </p>
                          <p className="text-xs text-slate-500">
                            Assigned: {formatDateTime(route.assigned_at)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={routeStatusBadgeClass(route.status)}
                          >
                            {route.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={assignmentStatusBadgeClass(
                              route.assignment_status,
                            )}
                          >
                            {route.assignment_status}
                          </Badge>
                        </TableCell>
                        <TableCell>{route.route_date}</TableCell>
                        <TableCell>{route.stops_count ?? 0}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(event) => {
                                event.stopPropagation();
                                void acceptAssignment(route.assignment_id);
                              }}
                              disabled={!canAccept || busyKey != null}
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(event) => {
                                event.stopPropagation();
                                openRejectDialog(
                                  route.assignment_id,
                                  route.route_code,
                                );
                              }}
                              disabled={!canReject || busyKey != null}
                            >
                              <XCircle className="mr-1 h-4 w-4" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(event) => {
                                event.stopPropagation();
                                void startRoute(route.id);
                              }}
                              disabled={!canStart || busyKey != null}
                            >
                              <PlayCircle className="mr-1 h-4 w-4" />
                              Start
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(event) => {
                                event.stopPropagation();
                                void completeRoute(route.id);
                              }}
                              disabled={!canComplete || busyKey != null}
                            >
                              <StopCircle className="mr-1 h-4 w-4" />
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
          <CardTitle className="text-base">Selected Route Progress</CardTitle>
          <CardDescription>
            {selectedRoute
              ? `Route ${selectedRoute.route_code} stop execution status`
              : "Select a route to view progress"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedRoute ? (
            <p className="text-sm text-slate-600">No route selected.</p>
          ) : stopsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Total Stops
                  </p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {selectedRouteProgress.total}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Serviced
                  </p>
                  <p className="mt-1 text-xl font-semibold text-emerald-700">
                    {selectedRouteProgress.serviced}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Skipped
                  </p>
                  <p className="mt-1 text-xl font-semibold text-amber-700">
                    {selectedRouteProgress.skipped}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Terminal
                  </p>
                  <p className="mt-1 text-xl font-semibold text-cyan-700">
                    {selectedRouteProgress.terminal}
                  </p>
                </div>
              </div>

              {selectedRouteStops.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No stops found for this route.
                </p>
              ) : (
                <div className="grid gap-2">
                  {selectedRouteStops.slice(0, 10).map((stop) => (
                    <div
                      key={stop.id}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          Stop #{stop.stop_sequence} (Bin {stop.bin_id})
                        </p>
                        <p className="text-xs text-slate-500">
                          ETA: {formatDateTime(stop.planned_eta)}
                        </p>
                      </div>
                      <Badge className={routeStatusBadgeClass(stop.status)}>
                        {stop.status}
                      </Badge>
                    </div>
                  ))}
                  {selectedRouteStops.length > 10 ? (
                    <p className="text-xs text-slate-500">
                      Showing 10 of {selectedRouteStops.length} stops.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {selectedRoute?.assignment_status === "rejected" ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <ShieldAlert className="mr-1 inline h-4 w-4" />
              Rejection reason:{" "}
              {selectedRoute.reject_reason ?? "No reason recorded."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-white/80 bg-white/85 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Driver Route Workflow</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <ClipboardList className="mr-1 inline h-4 w-4" />
            1. Accept route assignment
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <PlayCircle className="mr-1 inline h-4 w-4" />
            2. Start route when ready
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <CheckCircle2 className="mr-1 inline h-4 w-4" />
            3. Service or skip all stops
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
            <StopCircle className="mr-1 inline h-4 w-4" />
            4. Complete route
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={rejectDialogTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            closeRejectDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Route Assignment</DialogTitle>
            <DialogDescription>
              {rejectDialogTarget
                ? `Route ${rejectDialogTarget.routeCode} assignment will be rejected.`
                : "Provide a clear reason for rejection."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(event) => {
                if (rejectReasonError) {
                  setRejectReasonError("");
                }
                setRejectReason(event.target.value);
              }}
              placeholder="Example: Vehicle issue prevents safe execution for this shift."
              className="min-h-24"
            />
            {rejectReasonError ? (
              <p className="text-xs text-red-700">{rejectReasonError}</p>
            ) : (
              <p className="text-xs text-slate-500">
                Minimum 5 characters. This reason is visible in assignment
                history.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeRejectDialog}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitRejectAssignment()}
              disabled={busyKey != null}
            >
              Submit Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DriverRoutesPanel;
