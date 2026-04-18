import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  UserRoundCheck,
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

type DriverAlertsPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
  userId: number;
};

type AlertItem = {
  id: number;
  org_id: number;
  bin_id: number;
  bin_code: string;
  rule_id: number | null;
  alert_type: string;
  severity: string;
  status: string;
  opened_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  assigned_to_user_id: number | null;
  title: string;
  description: string | null;
  latest_telemetry_id: number | null;
  dedupe_key: string | null;
  created_at: string;
  updated_at: string;
};

type AlertListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: AlertItem[];
};

type AlertEventItem = {
  id: number;
  alert_id: number;
  event_type: string;
  actor_user_id: number | null;
  event_ts: string;
  note: string | null;
  payload_json: Record<string, unknown> | null;
};

type AlertEventListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: AlertEventItem[];
};

const LIST_LIMIT = 100;

function severityBadgeClass(severity: string): string {
  const value = severity.trim().toLowerCase();
  if (value === "critical" || value === "high") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (value === "warning" || value === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusBadgeClass(status: string): string {
  const value = status.trim().toLowerCase();
  if (value === "open") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (value === "acknowledged") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  if (value === "resolved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

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

function DriverAlertsPanel({
  accessToken,
  apiBaseUrl,
  userId,
}: DriverAlertsPanelProps) {
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [refreshingAlerts, setRefreshingAlerts] = useState(false);

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [totalAlerts, setTotalAlerts] = useState(0);

  const [statusFilter, setStatusFilter] = useState("open");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("mine");
  const [searchText, setSearchText] = useState("");

  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [events, setEvents] = useState<AlertEventItem[]>([]);

  const [actionNote, setActionNote] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const selectedAlert = useMemo(() => {
    if (selectedAlertId == null) {
      return null;
    }
    return alerts.find((item) => item.id === selectedAlertId) ?? null;
  }, [alerts, selectedAlertId]);

  const filteredAlerts = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return alerts;
    }

    return alerts.filter((item) => {
      const text =
        `${item.title} ${item.bin_code} ${item.alert_type} ${item.description ?? ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [alerts, searchText]);

  const counts = useMemo(() => {
    const mineOpen = alerts.filter(
      (item) =>
        item.status !== "resolved" && item.assigned_to_user_id === userId,
    ).length;
    const unassignedOpen = alerts.filter(
      (item) => item.status !== "resolved" && item.assigned_to_user_id == null,
    ).length;
    const resolved = alerts.filter((item) => item.status === "resolved").length;

    return { mineOpen, unassignedOpen, resolved };
  }, [alerts, userId]);

  const fetchAlerts = useCallback(async () => {
    setRefreshingAlerts(true);
    setErrorMessage("");

    try {
      const response = await axios.get<AlertListResponse>(
        `${apiBaseUrl}/alerts`,
        {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
            status: statusFilter === "all" ? undefined : statusFilter,
            severity: severityFilter === "all" ? undefined : severityFilter,
            alert_type: typeFilter === "all" ? undefined : typeFilter,
            assigned_to_user_id: scopeFilter === "mine" ? userId : undefined,
          },
        },
      );

      const nextAlerts = response.data.items;
      setAlerts(nextAlerts);
      setTotalAlerts(response.data.total);

      setSelectedAlertId((previousId) => {
        if (nextAlerts.length === 0) {
          return null;
        }
        if (previousId == null) {
          return nextAlerts[0].id;
        }
        return nextAlerts.some((item) => item.id === previousId)
          ? previousId
          : nextAlerts[0].id;
      });
    } catch (error) {
      setAlerts([]);
      setTotalAlerts(0);
      setSelectedAlertId(null);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load alerts list."),
      );
    } finally {
      setLoadingAlerts(false);
      setRefreshingAlerts(false);
    }
  }, [
    apiBaseUrl,
    headers,
    severityFilter,
    scopeFilter,
    statusFilter,
    typeFilter,
    userId,
  ]);

  const fetchAlertEvents = useCallback(
    async (alertId: number) => {
      setEventsLoading(true);
      try {
        const response = await axios.get<AlertEventListResponse>(
          `${apiBaseUrl}/alerts/${alertId}/events`,
          {
            headers,
            params: { limit: LIST_LIMIT, offset: 0 },
          },
        );
        setEvents(response.data.items);
      } catch (error) {
        setEvents([]);
        setErrorMessage(
          extractApiErrorMessage(error, "Failed to load alert events."),
        );
      } finally {
        setEventsLoading(false);
      }
    },
    [apiBaseUrl, headers],
  );

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    if (selectedAlertId == null) {
      setEvents([]);
      return;
    }
    void fetchAlertEvents(selectedAlertId);
  }, [fetchAlertEvents, selectedAlertId]);

  const claimAlertToMe = async () => {
    if (!selectedAlert) {
      return;
    }

    setActionBusy("claim");
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/alerts/${selectedAlert.id}/assign`,
        {
          assigned_to_user_id: userId,
          note: actionNote.trim() || null,
        },
        { headers },
      );

      setNoticeMessage("Alert assigned to you.");
      await fetchAlerts();
      await fetchAlertEvents(selectedAlert.id);
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to assign alert to you."),
      );
    } finally {
      setActionBusy(null);
    }
  };

  const runAlertAction = async (action: "acknowledge" | "resolve") => {
    if (!selectedAlert) {
      return;
    }

    setActionBusy(action);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/alerts/${selectedAlert.id}/${action}`,
        {
          note: actionNote.trim() || null,
        },
        { headers },
      );

      setNoticeMessage(`Alert ${action}d successfully.`);
      await fetchAlerts();
      await fetchAlertEvents(selectedAlert.id);
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, `Failed to ${action} alert.`),
      );
    } finally {
      setActionBusy(null);
    }
  };

  if (loadingAlerts) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const canAct =
    selectedAlert != null && selectedAlert.assigned_to_user_id === userId;

  return (
    <div className="space-y-5">
      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Driver Alerts</CardTitle>
            <CardDescription>
              Claim, acknowledge, and resolve alerts in your execution scope.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            onClick={() => void fetchAlerts()}
            disabled={refreshingAlerts}
          >
            <RefreshCw
              className={`mr-1 h-4 w-4 ${refreshingAlerts ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </CardHeader>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Returned Alerts
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">
              {totalAlerts}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Open Assigned To Me
            </p>
            <p className="mt-2 text-3xl font-semibold text-cyan-700">
              {counts.mineOpen}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Open Unassigned
            </p>
            <p className="mt-2 text-3xl font-semibold text-amber-700">
              {counts.unassignedOpen}
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Resolved
            </p>
            <p className="mt-2 text-3xl font-semibold text-emerald-700">
              {counts.resolved}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid w-full gap-3 lg:grid-cols-5">
        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mine">Assigned to me</SelectItem>
            <SelectItem value="all">All assignments</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="open">open</SelectItem>
            <SelectItem value="acknowledged">acknowledged</SelectItem>
            <SelectItem value="resolved">resolved</SelectItem>
          </SelectContent>
        </Select>

        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="critical">critical</SelectItem>
            <SelectItem value="high">high</SelectItem>
            <SelectItem value="warning">warning</SelectItem>
            <SelectItem value="medium">medium</SelectItem>
            <SelectItem value="low">low</SelectItem>
            <SelectItem value="info">info</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="fill_threshold">fill_threshold</SelectItem>
            <SelectItem value="overflow_imminent">overflow_imminent</SelectItem>
            <SelectItem value="device_offline">device_offline</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search title/bin/type"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </div>

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

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-700" />
              Alerts Queue
            </CardTitle>
            <CardDescription>
              Showing {filteredAlerts.length} / {totalAlerts} alerts for
              selected filters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {filteredAlerts.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No alerts match the selected filters.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Alert</TableHead>
                      <TableHead>Bin</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredAlerts.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-72">
                          <p
                            className="truncate font-medium"
                            title={item.title}
                          >
                            {item.title}
                          </p>
                          <p
                            className="truncate text-xs text-slate-500"
                            title={item.alert_type}
                          >
                            {item.alert_type}
                          </p>
                        </TableCell>
                        <TableCell>{item.bin_code}</TableCell>
                        <TableCell>
                          <Badge className={severityBadgeClass(item.severity)}>
                            {item.severity}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusBadgeClass(item.status)}>
                            {item.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.assigned_to_user_id == null
                            ? "unassigned"
                            : item.assigned_to_user_id === userId
                              ? "you"
                              : `user ${item.assigned_to_user_id}`}
                        </TableCell>
                        <TableCell>{formatDateTime(item.opened_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedAlertId(item.id)}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Alert Actions</CardTitle>
            <CardDescription>
              {selectedAlert
                ? `Alert #${selectedAlert.id} on ${selectedAlert.bin_code}`
                : "Select an alert to manage"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedAlert ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No alert selected.
              </p>
            ) : (
              <>
                <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                  <p className="font-medium text-slate-900">
                    {selectedAlert.title}
                  </p>
                  <p className="mt-1 text-slate-600">
                    {selectedAlert.description ?? "No description provided."}
                  </p>
                  <div className="mt-2 grid gap-1 text-xs text-slate-600">
                    <p>Opened: {formatDateTime(selectedAlert.opened_at)}</p>
                    <p>
                      Assigned:{" "}
                      {selectedAlert.assigned_to_user_id == null
                        ? "unassigned"
                        : selectedAlert.assigned_to_user_id === userId
                          ? "you"
                          : `user ${selectedAlert.assigned_to_user_id}`}
                    </p>
                  </div>
                </div>

                {!canAct ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    This alert is not assigned to you. Claim it before
                    acknowledge/resolve.
                  </p>
                ) : null}

                <div className="space-y-2">
                  <Label>Action note</Label>
                  <Textarea
                    value={actionNote}
                    onChange={(event) => setActionNote(event.target.value)}
                    placeholder="Optional note for event timeline"
                    className="min-h-20"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void claimAlertToMe()}
                    disabled={
                      actionBusy != null ||
                      selectedAlert.assigned_to_user_id === userId
                    }
                  >
                    <UserRoundCheck className="mr-1 h-4 w-4" />
                    Claim To Me
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void runAlertAction("acknowledge")}
                    disabled={
                      actionBusy != null ||
                      !canAct ||
                      selectedAlert.status === "resolved" ||
                      selectedAlert.status === "acknowledged"
                    }
                  >
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    Acknowledge
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void runAlertAction("resolve")}
                    disabled={
                      actionBusy != null ||
                      !canAct ||
                      selectedAlert.status === "resolved"
                    }
                  >
                    Resolve
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Alert Event Timeline</CardTitle>
            <CardDescription>Event history for selected alert.</CardDescription>
          </div>
          <Button
            variant="outline"
            disabled={selectedAlertId == null}
            onClick={() => {
              if (selectedAlertId != null) {
                void fetchAlertEvents(selectedAlertId);
              }
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh Events
          </Button>
        </CardHeader>
        <CardContent>
          {selectedAlertId == null ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Select an alert to view event timeline.
            </p>
          ) : eventsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : events.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No events available for this alert.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">
                        {event.event_type}
                      </TableCell>
                      <TableCell>
                        {event.actor_user_id == null
                          ? "system"
                          : event.actor_user_id === userId
                            ? "you"
                            : `user ${event.actor_user_id}`}
                      </TableCell>
                      <TableCell>{formatDateTime(event.event_ts)}</TableCell>
                      <TableCell
                        className="max-w-96 truncate"
                        title={event.note ?? ""}
                      >
                        {event.note ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default DriverAlertsPanel;
