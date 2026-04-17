import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Activity,
  Map as MapIcon,
  MapPin,
  PencilLine,
  PlusCircle,
  RefreshCw,
  Table2,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

import BinMap from "@/components/BinMap";
import BinLocationPickerDialog from "@/components/role/operator/master-data/BinLocationPickerDialog";
import type {
  BinFormPayload,
  BinRecord,
  DepotRecord,
  ServiceAreaRecord,
} from "@/components/role/operator/types";
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
import { extractApiErrorMessage } from "@/lib/authApi";
import type { DataRow } from "@/types/dashboard";

type BinsManagementPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type BinListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: BinRecord[];
};

type DepotListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: DepotRecord[];
};

type ServiceAreaListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: ServiceAreaRecord[];
};

type LiveBinState = {
  fill_pct: number | null;
  alert_level: string | null;
  overflow_imminent: boolean;
  device_connectivity_state: string | null;
  updated_at: string | null;
};

type WsState = "connecting" | "connected" | "disconnected";

const LIST_LIMIT = 100;

const EMPTY_FORM: BinFormPayload = {
  bin_code: "",
  display_name: "",
  address_line: "",
  area_id: "__none__",
  depot_id: "__none__",
  latitude: "",
  longitude: "",
  capacity_liters: "",
  bin_height_cm: "60",
  dead_zone_cm: "5",
  threshold_green: "50",
  threshold_yellow: "80",
  distance_factor: "0.5",
  status: "active",
  installed_at: "",
  last_service_at: "",
  is_active: "active",
};

function parseOptionalNumber(value: string): number | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function buildRealtimeWsUrl(apiBaseUrl: string, accessToken: string): string {
  const url = new URL(apiBaseUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const path = url.pathname.replace(/\/$/, "");
  return `${protocol}//${url.host}${path}/realtime/ws/bin-states?token=${encodeURIComponent(accessToken)}`;
}

function toInputDateTime(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function BinsManagementPanel({
  accessToken,
  apiBaseUrl,
}: BinsManagementPanelProps) {
  const [loading, setLoading] = useState(true);
  const [bins, setBins] = useState<BinRecord[]>([]);
  const [depots, setDepots] = useState<DepotRecord[]>([]);
  const [serviceAreas, setServiceAreas] = useState<ServiceAreaRecord[]>([]);

  const [queryText, setQueryText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingBin, setEditingBin] = useState<BinRecord | null>(null);
  const [formState, setFormState] = useState<BinFormPayload>(EMPTY_FORM);

  const [submitting, setSubmitting] = useState(false);
  const [deactivatingBinId, setDeactivatingBinId] = useState<number | null>(
    null,
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [fetchWarning, setFetchWarning] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "map">("table");

  const [wsState, setWsState] = useState<WsState>("connecting");
  const [liveStateByBinCode, setLiveStateByBinCode] = useState<
    Record<string, LiveBinState>
  >({});

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const depotNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const depot of depots) {
      map.set(depot.id, depot.name);
    }
    return map;
  }, [depots]);

  const serviceAreaNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const area of serviceAreas) {
      map.set(area.id, area.name);
    }
    return map;
  }, [serviceAreas]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchWarning("");
    try {
      const [binsResult, depotsResult, areasResult] = await Promise.allSettled([
        axios.get<BinListResponse>(`${apiBaseUrl}/bins`, {
          headers,
          params: { limit: LIST_LIMIT, offset: 0 },
        }),
        axios.get<DepotListResponse>(`${apiBaseUrl}/master-data/depots`, {
          headers,
          params: { limit: LIST_LIMIT, offset: 0 },
        }),
        axios.get<ServiceAreaListResponse>(
          `${apiBaseUrl}/master-data/service-areas`,
          {
            headers,
            params: { limit: LIST_LIMIT, offset: 0 },
          },
        ),
      ]);

      if (binsResult.status === "rejected") {
        throw binsResult.reason;
      }

      setBins(binsResult.value.data.items);

      if (depotsResult.status === "fulfilled") {
        setDepots(depotsResult.value.data.items);
      } else {
        setDepots([]);
      }

      if (areasResult.status === "fulfilled") {
        setServiceAreas(areasResult.value.data.items);
      } else {
        setServiceAreas([]);
      }

      if (
        depotsResult.status === "rejected" ||
        areasResult.status === "rejected"
      ) {
        setFetchWarning(
          "Loaded bins, but related depots/service areas could not be fetched. Relationship labels may be incomplete.",
        );
      }

      setErrorMessage("");
    } catch (error) {
      setBins([]);
      setDepots([]);
      setServiceAreas([]);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load bins data."),
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, headers]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const wsUrl = buildRealtimeWsUrl(apiBaseUrl, accessToken);
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }

      setWsState("connecting");
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (!disposed) {
          setWsState("connected");
        }
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            event?: string;
            bin_code?: string;
            fill_pct?: number | null;
            current_fill_pct?: number | null;
            alert_level?: string | null;
            current_alert_level?: string | null;
            overflow_imminent?: boolean;
            device_connectivity_state?: string | null;
            updated_at?: string | null;
            last_measured_at?: string | null;
          };

          const isLegacyEvent = data.event === "bin_state_update";
          const isCurrentStateEvent =
            data.event === "bin_current_state_updated";

          if ((!isLegacyEvent && !isCurrentStateEvent) || !data.bin_code) {
            return;
          }

          setLiveStateByBinCode((prev) => ({
            ...prev,
            [data.bin_code!]: {
              fill_pct: data.fill_pct ?? data.current_fill_pct ?? null,
              alert_level: data.alert_level ?? data.current_alert_level ?? null,
              overflow_imminent: Boolean(data.overflow_imminent),
              device_connectivity_state: data.device_connectivity_state ?? null,
              updated_at: data.updated_at ?? data.last_measured_at ?? null,
            },
          }));
        } catch {
          // Ignore malformed realtime event payloads.
        }
      };

      socket.onclose = () => {
        if (disposed) {
          return;
        }
        setWsState("disconnected");
        reconnectTimer = window.setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        if (!disposed) {
          setWsState("disconnected");
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
      }
      if (socket) {
        const socketToClose = socket;
        if (
          socketToClose.readyState === WebSocket.OPEN ||
          socketToClose.readyState === WebSocket.CLOSING
        ) {
          socketToClose.close();
        } else if (socketToClose.readyState === WebSocket.CONNECTING) {
          socketToClose.addEventListener(
            "open",
            () => {
              socketToClose.close();
            },
            { once: true },
          );
        }
      }
    };
  }, [accessToken, apiBaseUrl]);

  const filteredBins = useMemo(() => {
    const query = queryText.trim().toLowerCase();

    return bins.filter((bin) => {
      const passesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && bin.is_active) ||
        (statusFilter === "inactive" && !bin.is_active);

      if (!passesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text =
        `${bin.bin_code} ${bin.display_name ?? ""} ${bin.address_line ?? ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [bins, queryText, statusFilter]);

  const mapRows = useMemo<DataRow[]>(() => {
    return filteredBins.map((bin) => {
      const live = liveStateByBinCode[bin.bin_code];
      return {
        Bin_ID: bin.bin_code,
        Latitude: bin.latitude ?? 0,
        Longitude: bin.longitude ?? 0,
        Location: bin.address_line ?? bin.display_name ?? bin.bin_code,
        Ward:
          bin.area_id != null
            ? (serviceAreaNameById.get(bin.area_id) ?? `Area ${bin.area_id}`)
            : "Unassigned",
        "Fill%": live?.fill_pct ?? 0,
        Status: live?.alert_level ?? bin.status,
        Priority: live?.overflow_imminent ? 100 : (live?.fill_pct ?? 0),
      };
    });
  }, [filteredBins, liveStateByBinCode, serviceAreaNameById]);

  const mappableBinsCount = useMemo(() => {
    return filteredBins.filter(
      (bin) => bin.latitude != null && bin.longitude != null,
    ).length;
  }, [filteredBins]);

  const selectedPoint = useMemo<[number, number] | null>(() => {
    const latitude = parseOptionalNumber(formState.latitude);
    const longitude = parseOptionalNumber(formState.longitude);
    if (latitude == null || longitude == null) {
      return null;
    }
    return [latitude, longitude];
  }, [formState.latitude, formState.longitude]);

  const openCreateDialog = () => {
    setEditingBin(null);
    setFormState(EMPTY_FORM);
    setFormDialogOpen(true);
  };

  const openEditDialog = (bin: BinRecord) => {
    setEditingBin(bin);
    setFormState({
      bin_code: bin.bin_code,
      display_name: bin.display_name ?? "",
      address_line: bin.address_line ?? "",
      area_id: bin.area_id != null ? String(bin.area_id) : "__none__",
      depot_id: bin.depot_id != null ? String(bin.depot_id) : "__none__",
      latitude: bin.latitude != null ? String(bin.latitude) : "",
      longitude: bin.longitude != null ? String(bin.longitude) : "",
      capacity_liters:
        bin.capacity_liters != null ? String(bin.capacity_liters) : "",
      bin_height_cm: String(bin.bin_height_cm),
      dead_zone_cm: String(bin.dead_zone_cm),
      threshold_green: String(bin.threshold_green),
      threshold_yellow: String(bin.threshold_yellow),
      distance_factor: String(bin.distance_factor),
      status: bin.status,
      installed_at: toInputDateTime(bin.installed_at),
      last_service_at: toInputDateTime(bin.last_service_at),
      is_active: bin.is_active ? "active" : "inactive",
    });
    setFormDialogOpen(true);
  };

  const saveBin = async () => {
    const thresholdGreen = parseOptionalNumber(formState.threshold_green);
    const thresholdYellow = parseOptionalNumber(formState.threshold_yellow);

    if (
      thresholdGreen != null &&
      thresholdYellow != null &&
      thresholdGreen >= thresholdYellow
    ) {
      setErrorMessage("Threshold green must be less than threshold yellow.");
      return;
    }

    if (!editingBin && !formState.bin_code.trim()) {
      setErrorMessage("Bin code is required.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setNoticeMessage("");

    const basePayload: Record<string, unknown> = {
      display_name: formState.display_name.trim() || null,
      address_line: formState.address_line.trim() || null,
      area_id:
        formState.area_id === "__none__"
          ? null
          : Number.parseInt(formState.area_id, 10),
      depot_id:
        formState.depot_id === "__none__"
          ? null
          : Number.parseInt(formState.depot_id, 10),
      latitude: parseOptionalNumber(formState.latitude),
      longitude: parseOptionalNumber(formState.longitude),
      capacity_liters: parseOptionalNumber(formState.capacity_liters),
      bin_height_cm: parseOptionalNumber(formState.bin_height_cm),
      dead_zone_cm: parseOptionalNumber(formState.dead_zone_cm),
      threshold_green: thresholdGreen,
      threshold_yellow: thresholdYellow,
      distance_factor: parseOptionalNumber(formState.distance_factor),
      status: formState.status.trim() || "active",
      installed_at: formState.installed_at || null,
      last_service_at: formState.last_service_at || null,
    };

    try {
      if (editingBin) {
        await axios.patch(
          `${apiBaseUrl}/bins/${editingBin.id}`,
          {
            ...basePayload,
            is_active: formState.is_active === "active",
          },
          { headers },
        );
        setNoticeMessage("Bin updated successfully.");
      } else {
        await axios.post(
          `${apiBaseUrl}/bins`,
          {
            ...basePayload,
            bin_code: formState.bin_code.trim(),
          },
          { headers },
        );
        setNoticeMessage("Bin created successfully.");
      }

      setFormDialogOpen(false);
      setFormState(EMPTY_FORM);
      setEditingBin(null);
      await fetchData();
    } catch (error) {
      setErrorMessage(extractApiErrorMessage(error, "Failed to save bin."));
    } finally {
      setSubmitting(false);
    }
  };

  const deactivateBin = async (bin: BinRecord) => {
    const confirmed = window.confirm(`Deactivate bin ${bin.bin_code}?`);
    if (!confirmed) {
      return;
    }

    setDeactivatingBinId(bin.id);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/bins/${bin.id}/deactivate`,
        {},
        { headers },
      );
      setNoticeMessage(`${bin.bin_code} has been deactivated.`);
      await fetchData();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to deactivate bin."),
      );
    } finally {
      setDeactivatingBinId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:max-w-xl sm:flex-row">
          <Input
            placeholder="Search bins by code/name/address"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            onClick={() => setViewMode("table")}
          >
            <Table2 className="mr-1 h-4 w-4" />
            Table
          </Button>
          <Button
            variant={viewMode === "map" ? "default" : "outline"}
            onClick={() => setViewMode("map")}
          >
            <MapIcon className="mr-1 h-4 w-4" />
            Map
          </Button>
          <Button variant="outline" onClick={() => void fetchData()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <PlusCircle className="mr-1 h-4 w-4" />
            Add Bin
          </Button>
        </div>
      </div>

      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Bins</CardTitle>
            <CardDescription>
              Manage bin registry and monitor live state updates through
              WebSocket.
            </CardDescription>
          </div>
          <Badge
            variant="secondary"
            className={
              wsState === "connected"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : wsState === "connecting"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-red-200 bg-red-50 text-red-700"
            }
          >
            {wsState === "connected" ? (
              <Wifi className="mr-1 h-4 w-4" />
            ) : (
              <WifiOff className="mr-1 h-4 w-4" />
            )}
            Realtime {wsState}
          </Badge>
        </CardHeader>
        <CardContent>
          {errorMessage ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </p>
          ) : null}

          {noticeMessage ? (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {noticeMessage}
            </p>
          ) : null}

          {fetchWarning ? (
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {fetchWarning}
            </p>
          ) : null}

          {viewMode === "map" ? (
            <div className="space-y-3">
              {filteredBins.length === 0 ? (
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  No bins found for the current organization or filter.
                </p>
              ) : mappableBinsCount === 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  Bins are available but none have coordinates to place on map.
                </p>
              ) : null}
              <BinMap rows={mapRows} title="Bins Map View" />
            </div>
          ) : filteredBins.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No bins found for the current organization or filter.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bin Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Live Fill</TableHead>
                    <TableHead>Connectivity</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Depot</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBins.map((bin) => {
                    const live = liveStateByBinCode[bin.bin_code];
                    const isDeactivating = deactivatingBinId === bin.id;

                    return (
                      <TableRow key={bin.id}>
                        <TableCell>
                          <div className="font-medium">{bin.bin_code}</div>
                          <div className="text-xs text-muted-foreground">
                            {bin.display_name ?? "No display name"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              bin.is_active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700"
                            }
                          >
                            {bin.is_active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {live?.fill_pct != null ? (
                            <div className="text-sm">
                              <div className="inline-flex items-center gap-1 font-medium">
                                <Activity className="h-4 w-4" />
                                {live.fill_pct.toFixed(1)}%
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {live.alert_level ?? "N/A"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No live data
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {live?.device_connectivity_state ? (
                            <Badge
                              className={
                                live.device_connectivity_state.toLowerCase() ===
                                "online"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-red-200 bg-red-50 text-red-700"
                              }
                            >
                              {live.device_connectivity_state}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              unknown
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {bin.area_id != null
                            ? (serviceAreaNameById.get(bin.area_id) ??
                              `#${bin.area_id}`)
                            : "n/a"}
                        </TableCell>
                        <TableCell>
                          {bin.depot_id != null
                            ? (depotNameById.get(bin.depot_id) ??
                              `#${bin.depot_id}`)
                            : "n/a"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(bin)}
                            >
                              <PencilLine className="mr-1 h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!bin.is_active || isDeactivating}
                              onClick={() => void deactivateBin(bin)}
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              {isDeactivating
                                ? "Deactivating..."
                                : "Deactivate"}
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

      <Dialog
        open={formDialogOpen}
        onOpenChange={(open) => {
          setFormDialogOpen(open);
          if (!open) {
            setEditingBin(null);
            setFormState(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingBin ? "Edit Bin" : "Create Bin"}</DialogTitle>
            <DialogDescription>
              {editingBin
                ? "Update bin metadata and thresholds."
                : "Register a new bin in your organization."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bin-code">Bin Code</Label>
              <Input
                id="bin-code"
                value={formState.bin_code}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    bin_code: event.target.value,
                  }))
                }
                disabled={Boolean(editingBin)}
                placeholder="BIN-A001"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-display-name">Display Name</Label>
              <Input
                id="bin-display-name"
                value={formState.display_name}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    display_name: event.target.value,
                  }))
                }
                placeholder="Anna Nagar Bin 1"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="bin-address">Address</Label>
              <Input
                id="bin-address"
                value={formState.address_line}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    address_line: event.target.value,
                  }))
                }
                placeholder="Street, area, landmark"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-service-area">Service Area</Label>
              <Select
                value={formState.area_id}
                onValueChange={(value) =>
                  setFormState((prev) => ({ ...prev, area_id: value }))
                }
              >
                <SelectTrigger id="bin-service-area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No service area</SelectItem>
                  {serviceAreas.map((area) => (
                    <SelectItem key={area.id} value={String(area.id)}>
                      {area.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-depot">Depot</Label>
              <Select
                value={formState.depot_id}
                onValueChange={(value) =>
                  setFormState((prev) => ({ ...prev, depot_id: value }))
                }
              >
                <SelectTrigger id="bin-depot">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No depot</SelectItem>
                  {depots.map((depot) => (
                    <SelectItem key={depot.id} value={String(depot.id)}>
                      {depot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-latitude">Latitude</Label>
              <Input
                id="bin-latitude"
                type="number"
                step="0.000001"
                value={formState.latitude}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    latitude: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-longitude">Longitude</Label>
              <Input
                id="bin-longitude"
                type="number"
                step="0.000001"
                value={formState.longitude}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    longitude: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm text-slate-700">
                  Selected coordinates:{" "}
                  {selectedPoint
                    ? `${selectedPoint[0].toFixed(6)}, ${selectedPoint[1].toFixed(6)}`
                    : "not set"}
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={() => setLocationDialogOpen(true)}
                >
                  <MapPin className="mr-1 h-4 w-4" />
                  Open Location Selector
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-capacity">Capacity (liters)</Label>
              <Input
                id="bin-capacity"
                type="number"
                step="0.1"
                value={formState.capacity_liters}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    capacity_liters: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-status">Status</Label>
              <Input
                id="bin-status"
                value={formState.status}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    status: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-active">Active State</Label>
              <Select
                value={formState.is_active}
                onValueChange={(value) =>
                  setFormState((prev) => ({ ...prev, is_active: value }))
                }
              >
                <SelectTrigger id="bin-active">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-threshold-green">Threshold Green</Label>
              <Input
                id="bin-threshold-green"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={formState.threshold_green}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    threshold_green: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-threshold-yellow">Threshold Yellow</Label>
              <Input
                id="bin-threshold-yellow"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={formState.threshold_yellow}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    threshold_yellow: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-installed-at">Installed At</Label>
              <Input
                id="bin-installed-at"
                type="datetime-local"
                value={formState.installed_at}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    installed_at: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bin-last-service">Last Service At</Label>
              <Input
                id="bin-last-service"
                type="datetime-local"
                value={formState.last_service_at}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    last_service_at: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveBin()} disabled={submitting}>
              {submitting
                ? "Saving..."
                : editingBin
                  ? "Update Bin"
                  : "Create Bin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BinLocationPickerDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        selectedPoint={selectedPoint}
        onApply={(latitude, longitude) => {
          setFormState((prev) => ({
            ...prev,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6),
          }));
        }}
      />
    </div>
  );
}

export default BinsManagementPanel;
