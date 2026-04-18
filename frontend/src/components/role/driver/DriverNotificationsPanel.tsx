import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";

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

type DriverNotificationsPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type NotificationItem = {
  id: number;
  org_id: number;
  user_id: number;
  event_type: string;
  severity: string;
  title: string;
  message: string | null;
  payload_json: Record<string, unknown> | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

type NotificationListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: NotificationItem[];
};

type NotificationReadAllResponse = {
  updated: number;
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

function DriverNotificationsPanel({
  accessToken,
  apiBaseUrl,
}: DriverNotificationsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);

  const [unreadFilter, setUnreadFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [autoRefresh, setAutoRefresh] = useState("on");

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const fetchNotifications = useCallback(async () => {
    setRefreshing(true);
    setErrorMessage("");

    try {
      const response = await axios.get<NotificationListResponse>(
        `${apiBaseUrl}/notifications/in-app`,
        {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
            unread_only: unreadFilter === "unread" ? true : undefined,
            severity: severityFilter === "all" ? undefined : severityFilter,
            event_type: eventTypeFilter === "all" ? undefined : eventTypeFilter,
          },
        },
      );

      setNotifications(response.data.items);
      setTotal(response.data.total);
    } catch (error) {
      setNotifications([]);
      setTotal(0);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load notifications."),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl, eventTypeFilter, headers, severityFilter, unreadFilter]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (autoRefresh !== "on") {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchNotifications();
    }, 20000);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefresh, fetchNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );

  const filteredNotifications = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return notifications;
    }

    return notifications.filter((item) => {
      const text =
        `${item.title} ${item.message ?? ""} ${item.event_type}`.toLowerCase();
      return text.includes(query);
    });
  }, [notifications, searchText]);

  const markOneRead = async (notificationId: number) => {
    setBusyKey(`read-${notificationId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/notifications/in-app/${notificationId}/read`,
        {},
        { headers },
      );
      setNoticeMessage("Notification marked as read.");
      await fetchNotifications();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to mark notification as read."),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const markAllRead = async () => {
    setBusyKey("read-all");
    setErrorMessage("");
    setNoticeMessage("");

    try {
      const response = await axios.post<NotificationReadAllResponse>(
        `${apiBaseUrl}/notifications/in-app/read-all`,
        {},
        { headers },
      );
      setNoticeMessage(
        `Marked ${response.data.updated} notifications as read.`,
      );
      await fetchNotifications();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to mark all notifications read."),
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
            <CardTitle>Driver Notifications</CardTitle>
            <CardDescription>
              Monitor route and alert events, then mark them read as you
              complete work.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void fetchNotifications()}
              disabled={refreshing}
            >
              <RefreshCw
                className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Button
              onClick={() => void markAllRead()}
              disabled={busyKey != null}
            >
              <CheckCheck className="mr-1 h-4 w-4" />
              Mark All Read
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select value={unreadFilter} onValueChange={setUnreadFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Read filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread only</SelectItem>
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

        <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            <SelectItem value="route_assigned">route_assigned</SelectItem>
            <SelectItem value="alert_opened">alert_opened</SelectItem>
            <SelectItem value="route_status_changed">
              route_status_changed
            </SelectItem>
            <SelectItem value="alert_updated">alert_updated</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search title/message"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />

        <Select value={autoRefresh} onValueChange={setAutoRefresh}>
          <SelectTrigger>
            <SelectValue placeholder="Auto refresh" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="on">Auto refresh on</SelectItem>
            <SelectItem value="off">Auto refresh off</SelectItem>
          </SelectContent>
        </Select>
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Total Notifications
            </CardDescription>
            <CardTitle className="text-2xl">{total}</CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Unread</CardDescription>
            <CardTitle className="text-2xl">{unreadCount}</CardTitle>
          </CardHeader>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Refresh Mode</CardDescription>
            <CardTitle className="text-2xl">
              {autoRefresh === "on" ? "Live Poll" : "Manual"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-600">
            {autoRefresh === "on"
              ? "Polling every 20 seconds"
              : "Refresh on demand"}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader>
          <CardTitle>In-App Notifications</CardTitle>
          <CardDescription>
            Showing {filteredNotifications.length} / {total} notifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredNotifications.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No notifications match the selected filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredNotifications.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium">{item.event_type}</p>
                        <p
                          className="max-w-72 truncate text-xs text-slate-500"
                          title={item.title}
                        >
                          {item.title}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge className={severityBadgeClass(item.severity)}>
                          {item.severity}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="max-w-96 truncate"
                        title={item.message ?? ""}
                      >
                        {item.message ?? "-"}
                      </TableCell>
                      <TableCell>{formatDateTime(item.created_at)}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            item.is_read
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }
                        >
                          {item.is_read ? "read" : "unread"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={item.is_read || busyKey != null}
                          onClick={() => void markOneRead(item.id)}
                        >
                          Mark Read
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
    </div>
  );
}

export default DriverNotificationsPanel;
