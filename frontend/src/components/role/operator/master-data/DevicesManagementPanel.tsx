import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Link2, PencilLine, PlusCircle, RefreshCw, Trash2 } from "lucide-react";

import type {
  BinRecord,
  DeviceFormPayload,
  DeviceRecord,
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
import { Textarea } from "@/components/ui/textarea";
import { extractApiErrorMessage } from "@/lib/authApi";

type DevicesManagementPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
};

type DeviceListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: DeviceRecord[];
};

type BinListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: BinRecord[];
};

const LIST_LIMIT = 100;

const EMPTY_FORM: DeviceFormPayload = {
  bin_id: "__none__",
  device_uid: "",
  mqtt_client_id: "",
  firmware_version: "",
  hardware_revision: "",
  status: "online",
  installed_at: "",
  decommissioned_at: "",
  last_seen_at: "",
};

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

function DevicesManagementPanel({
  accessToken,
  apiBaseUrl,
}: DevicesManagementPanelProps) {
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [bins, setBins] = useState<BinRecord[]>([]);

  const [queryText, setQueryText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceRecord | null>(null);
  const [formState, setFormState] = useState<DeviceFormPayload>(EMPTY_FORM);

  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assigningDevice, setAssigningDevice] = useState<DeviceRecord | null>(
    null,
  );
  const [assignBinId, setAssignBinId] = useState("__none__");
  const [assignNotes, setAssignNotes] = useState("");
  const [assignActiveFrom, setAssignActiveFrom] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [deactivatingDeviceId, setDeactivatingDeviceId] = useState<
    number | null
  >(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [fetchWarning, setFetchWarning] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const binCodeById = useMemo(() => {
    const map = new Map<number, string>();
    for (const bin of bins) {
      map.set(bin.id, bin.bin_code);
    }
    return map;
  }, [bins]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchWarning("");
    try {
      const [devicesResult, binsResult] = await Promise.allSettled([
        axios.get<DeviceListResponse>(`${apiBaseUrl}/devices`, {
          headers,
          params: { limit: LIST_LIMIT, offset: 0 },
        }),
        axios.get<BinListResponse>(`${apiBaseUrl}/bins`, {
          headers,
          params: { limit: LIST_LIMIT, offset: 0 },
        }),
      ]);

      if (devicesResult.status === "rejected") {
        throw devicesResult.reason;
      }

      setDevices(devicesResult.value.data.items);

      if (binsResult.status === "fulfilled") {
        setBins(binsResult.value.data.items);
      } else {
        setBins([]);
        setFetchWarning(
          "Loaded devices, but bins could not be fetched. Assignment labels may show IDs.",
        );
      }

      setErrorMessage("");
    } catch (error) {
      setDevices([]);
      setBins([]);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load device management data."),
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, headers]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filteredDevices = useMemo(() => {
    const query = queryText.trim().toLowerCase();

    return devices.filter((device) => {
      const passesStatus =
        statusFilter === "all" ||
        device.status.toLowerCase() === statusFilter.toLowerCase();

      if (!passesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text =
        `${device.device_uid} ${device.mqtt_client_id} ${device.status}`.toLowerCase();
      return text.includes(query);
    });
  }, [devices, queryText, statusFilter]);

  const openCreateDialog = () => {
    setEditingDevice(null);
    setFormState(EMPTY_FORM);
    setFormDialogOpen(true);
  };

  const openEditDialog = (device: DeviceRecord) => {
    setEditingDevice(device);
    setFormState({
      bin_id: String(device.bin_id),
      device_uid: device.device_uid,
      mqtt_client_id: device.mqtt_client_id,
      firmware_version: device.firmware_version ?? "",
      hardware_revision: device.hardware_revision ?? "",
      status: device.status,
      installed_at: toInputDateTime(device.installed_at),
      decommissioned_at: toInputDateTime(device.decommissioned_at),
      last_seen_at: toInputDateTime(device.last_seen_at),
    });
    setFormDialogOpen(true);
  };

  const saveDevice = async () => {
    if (!editingDevice && formState.bin_id === "__none__") {
      setErrorMessage("Select a bin before creating a device.");
      return;
    }

    if (!editingDevice && !formState.device_uid.trim()) {
      setErrorMessage("Device UID is required.");
      return;
    }

    if (!formState.mqtt_client_id.trim()) {
      setErrorMessage("MQTT client ID is required.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      if (editingDevice) {
        await axios.patch(
          `${apiBaseUrl}/devices/${editingDevice.id}`,
          {
            mqtt_client_id: formState.mqtt_client_id.trim(),
            firmware_version: formState.firmware_version.trim() || null,
            hardware_revision: formState.hardware_revision.trim() || null,
            status: formState.status.trim() || "online",
            installed_at: formState.installed_at || null,
            decommissioned_at: formState.decommissioned_at || null,
            last_seen_at: formState.last_seen_at || null,
          },
          { headers },
        );
        setNoticeMessage("Device updated successfully.");
      } else {
        await axios.post(
          `${apiBaseUrl}/devices`,
          {
            bin_id: Number.parseInt(formState.bin_id, 10),
            device_uid: formState.device_uid.trim(),
            mqtt_client_id: formState.mqtt_client_id.trim(),
            firmware_version: formState.firmware_version.trim() || null,
            hardware_revision: formState.hardware_revision.trim() || null,
            status: formState.status.trim() || "online",
            installed_at: formState.installed_at || null,
            last_seen_at: formState.last_seen_at || null,
          },
          { headers },
        );
        setNoticeMessage("Device created successfully.");
      }

      setFormDialogOpen(false);
      setFormState(EMPTY_FORM);
      setEditingDevice(null);
      await fetchData();
    } catch (error) {
      setErrorMessage(extractApiErrorMessage(error, "Failed to save device."));
    } finally {
      setSubmitting(false);
    }
  };

  const openAssignDialog = (device: DeviceRecord) => {
    setAssigningDevice(device);
    setAssignBinId(String(device.bin_id));
    setAssignNotes("");
    setAssignActiveFrom("");
    setAssignDialogOpen(true);
  };

  const assignDevice = async () => {
    if (!assigningDevice || assignBinId === "__none__") {
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/devices/${assigningDevice.id}/assign`,
        {
          bin_id: Number.parseInt(assignBinId, 10),
          notes: assignNotes.trim() || null,
          active_from: assignActiveFrom || null,
        },
        { headers },
      );

      setAssignDialogOpen(false);
      setAssigningDevice(null);
      setNoticeMessage("Device assigned successfully.");
      await fetchData();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to assign device."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const deactivateDevice = async (device: DeviceRecord) => {
    const confirmed = window.confirm(`Deactivate device ${device.device_uid}?`);
    if (!confirmed) {
      return;
    }

    setDeactivatingDeviceId(device.id);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/devices/${device.id}/deactivate`,
        {},
        { headers },
      );
      setNoticeMessage(`${device.device_uid} has been deactivated.`);
      await fetchData();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to deactivate device."),
      );
    } finally {
      setDeactivatingDeviceId(null);
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
            placeholder="Search devices by UID / MQTT ID / status"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="offline">Offline</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="decommissioned">Decommissioned</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void fetchData()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <PlusCircle className="mr-1 h-4 w-4" />
            Add Device
          </Button>
        </div>
      </div>

      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader>
          <CardTitle>Devices</CardTitle>
          <CardDescription>
            Register sensors, update metadata, and reassign devices to bins.
          </CardDescription>
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

          {filteredDevices.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No devices match your current filter.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device UID</TableHead>
                    <TableHead>MQTT Client ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Current Bin</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDevices.map((device) => {
                    const isDeactivating = deactivatingDeviceId === device.id;

                    return (
                      <TableRow key={device.id}>
                        <TableCell className="font-medium">
                          {device.device_uid}
                        </TableCell>
                        <TableCell>{device.mqtt_client_id}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{device.status}</Badge>
                        </TableCell>
                        <TableCell>
                          {binCodeById.get(device.bin_id) ??
                            `#${device.bin_id}`}
                        </TableCell>
                        <TableCell>
                          {device.last_seen_at
                            ? new Date(device.last_seen_at).toLocaleString()
                            : "n/a"}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openAssignDialog(device)}
                            >
                              <Link2 className="mr-1 h-4 w-4" />
                              Assign
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(device)}
                            >
                              <PencilLine className="mr-1 h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={isDeactivating}
                              onClick={() => void deactivateDevice(device)}
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
            setFormState(EMPTY_FORM);
            setEditingDevice(null);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingDevice ? "Edit Device" : "Create Device"}
            </DialogTitle>
            <DialogDescription>
              {editingDevice
                ? "Update device metadata and connectivity details."
                : "Register a new IoT device."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="device-bin">Bin</Label>
              <Select
                value={formState.bin_id}
                onValueChange={(value) =>
                  setFormState((prev) => ({ ...prev, bin_id: value }))
                }
                disabled={Boolean(editingDevice)}
              >
                <SelectTrigger id="device-bin">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select Bin</SelectItem>
                  {bins.map((bin) => (
                    <SelectItem key={bin.id} value={String(bin.id)}>
                      {bin.bin_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="device-status">Status</Label>
              <Input
                id="device-status"
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
              <Label htmlFor="device-uid">Device UID</Label>
              <Input
                id="device-uid"
                value={formState.device_uid}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    device_uid: event.target.value,
                  }))
                }
                disabled={Boolean(editingDevice)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mqtt-client-id">MQTT Client ID</Label>
              <Input
                id="mqtt-client-id"
                value={formState.mqtt_client_id}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    mqtt_client_id: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="firmware-version">Firmware Version</Label>
              <Input
                id="firmware-version"
                value={formState.firmware_version}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    firmware_version: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hardware-revision">Hardware Revision</Label>
              <Input
                id="hardware-revision"
                value={formState.hardware_revision}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    hardware_revision: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="device-installed-at">Installed At</Label>
              <Input
                id="device-installed-at"
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
              <Label htmlFor="device-last-seen">Last Seen At</Label>
              <Input
                id="device-last-seen"
                type="datetime-local"
                value={formState.last_seen_at}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    last_seen_at: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="device-decommissioned">Decommissioned At</Label>
              <Input
                id="device-decommissioned"
                type="datetime-local"
                value={formState.decommissioned_at}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    decommissioned_at: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveDevice()} disabled={submitting}>
              {submitting
                ? "Saving..."
                : editingDevice
                  ? "Update Device"
                  : "Create Device"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignDialogOpen}
        onOpenChange={(open) => {
          setAssignDialogOpen(open);
          if (!open) {
            setAssigningDevice(null);
            setAssignBinId("__none__");
            setAssignNotes("");
            setAssignActiveFrom("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Device To Bin</DialogTitle>
            <DialogDescription>
              Reassign {assigningDevice?.device_uid ?? "device"} to a target
              bin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assign-bin">Target Bin</Label>
              <Select value={assignBinId} onValueChange={setAssignBinId}>
                <SelectTrigger id="assign-bin">
                  <SelectValue placeholder="Select target bin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select Bin</SelectItem>
                  {bins.map((bin) => (
                    <SelectItem
                      key={`assign-bin-${bin.id}`}
                      value={String(bin.id)}
                    >
                      {bin.bin_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="assign-active-from">Active From (optional)</Label>
              <Input
                id="assign-active-from"
                type="datetime-local"
                value={assignActiveFrom}
                onChange={(event) => setAssignActiveFrom(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="assign-notes">Notes (optional)</Label>
              <Textarea
                id="assign-notes"
                value={assignNotes}
                onChange={(event) => setAssignNotes(event.target.value)}
                className="min-h-24"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAssignDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void assignDevice()}
              disabled={submitting || assignBinId === "__none__"}
            >
              {submitting ? "Assigning..." : "Assign Device"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DevicesManagementPanel;
