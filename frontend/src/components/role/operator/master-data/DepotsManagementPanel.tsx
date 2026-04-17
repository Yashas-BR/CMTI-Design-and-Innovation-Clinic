import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { MapPin, PencilLine, PlusCircle, RefreshCw, UserX } from "lucide-react";

import DepotLocationPickerDialog from "@/components/role/operator/master-data/DepotLocationPickerDialog";
import type {
  DepotCreateFormPayload,
  DepotRecord,
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

type DepotsManagementPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
  onDataChanged: () => Promise<void>;
};

type DepotListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: DepotRecord[];
};

const LIST_LIMIT = 100;

const EMPTY_FORM: DepotCreateFormPayload = {
  name: "",
  address: "",
  contact_phone: "",
  latitude: "",
  longitude: "",
  is_active: "active",
};

function parseCoordinate(value: string): number | null {
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

function DepotsManagementPanel({
  accessToken,
  apiBaseUrl,
  onDataChanged,
}: DepotsManagementPanelProps) {
  const [loading, setLoading] = useState(true);
  const [depots, setDepots] = useState<DepotRecord[]>([]);
  const [totalDepots, setTotalDepots] = useState(0);

  const [queryText, setQueryText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingDepot, setEditingDepot] = useState<DepotRecord | null>(null);
  const [formState, setFormState] =
    useState<DepotCreateFormPayload>(EMPTY_FORM);

  const [submitting, setSubmitting] = useState(false);
  const [deactivatingDepotId, setDeactivatingDepotId] = useState<number | null>(
    null,
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const fetchDepots = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get<DepotListResponse>(
        `${apiBaseUrl}/master-data/depots`,
        {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
          },
        },
      );

      setDepots(response.data.items);
      setTotalDepots(response.data.total);
      setErrorMessage("");
    } catch (error) {
      setDepots([]);
      setTotalDepots(0);
      setErrorMessage(extractApiErrorMessage(error, "Failed to load depots."));
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, headers]);

  useEffect(() => {
    void fetchDepots();
  }, [fetchDepots]);

  const filteredDepots = useMemo(() => {
    const query = queryText.trim().toLowerCase();

    return depots.filter((depot) => {
      const passesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && depot.is_active) ||
        (statusFilter === "inactive" && !depot.is_active);

      if (!passesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text =
        `${depot.name} ${depot.address ?? ""} ${depot.contact_phone ?? ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [depots, queryText, statusFilter]);

  const resetForm = () => {
    setFormState(EMPTY_FORM);
    setEditingDepot(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setFormDialogOpen(true);
  };

  const openEditDialog = (depot: DepotRecord) => {
    setEditingDepot(depot);
    setFormState({
      name: depot.name,
      address: depot.address ?? "",
      contact_phone: depot.contact_phone ?? "",
      latitude: depot.latitude != null ? String(depot.latitude) : "",
      longitude: depot.longitude != null ? String(depot.longitude) : "",
      is_active: depot.is_active ? "active" : "inactive",
    });
    setFormDialogOpen(true);
  };

  const selectedPoint = useMemo<[number, number] | null>(() => {
    const latitude = parseCoordinate(formState.latitude);
    const longitude = parseCoordinate(formState.longitude);
    if (latitude == null || longitude == null) {
      return null;
    }
    return [latitude, longitude];
  }, [formState.latitude, formState.longitude]);

  const saveDepot = async () => {
    const latitude = parseCoordinate(formState.latitude);
    const longitude = parseCoordinate(formState.longitude);

    if ((latitude == null) !== (longitude == null)) {
      setErrorMessage(
        "Provide both latitude and longitude, or leave both empty.",
      );
      return;
    }

    if (!formState.name.trim()) {
      setErrorMessage("Depot name is required.");
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setNoticeMessage("");

    const payload = {
      name: formState.name.trim(),
      address: formState.address.trim() || null,
      contact_phone: formState.contact_phone.trim() || null,
      latitude,
      longitude,
      is_active: formState.is_active === "active",
    };

    try {
      if (editingDepot) {
        await axios.patch(
          `${apiBaseUrl}/master-data/depots/${editingDepot.id}`,
          payload,
          {
            headers,
          },
        );
        setNoticeMessage("Depot updated successfully.");
      } else {
        await axios.post(`${apiBaseUrl}/master-data/depots`, payload, {
          headers,
        });
        setNoticeMessage("Depot created successfully.");
      }

      setFormDialogOpen(false);
      resetForm();
      await fetchDepots();
      await onDataChanged();
    } catch (error) {
      setErrorMessage(extractApiErrorMessage(error, "Failed to save depot."));
    } finally {
      setSubmitting(false);
    }
  };

  const deactivateDepot = async (depot: DepotRecord) => {
    const confirmed = window.confirm(`Deactivate depot ${depot.name}?`);
    if (!confirmed) {
      return;
    }

    setDeactivatingDepotId(depot.id);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/master-data/depots/${depot.id}/deactivate`,
        {},
        { headers },
      );
      setNoticeMessage(`${depot.name} has been deactivated.`);
      await fetchDepots();
      await onDataChanged();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to deactivate depot."),
      );
    } finally {
      setDeactivatingDepotId(null);
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
            placeholder="Search depots by name, address, phone"
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

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void fetchDepots()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <PlusCircle className="mr-1 h-4 w-4" />
            Add Depot
          </Button>
        </div>
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

      <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Depots</CardTitle>
            <CardDescription>
              Manage depot registry, contact details, and location coordinates.
            </CardDescription>
          </div>
          <Badge variant="secondary">
            Showing {filteredDepots.length} / {totalDepots}
          </Badge>
        </CardHeader>
        <CardContent>
          {filteredDepots.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No depots match your current filter.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Coordinates</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDepots.map((depot) => {
                    const isDeactivating = deactivatingDepotId === depot.id;
                    return (
                      <TableRow key={depot.id}>
                        <TableCell className="font-medium">
                          {depot.name}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              depot.is_active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700"
                            }
                          >
                            {depot.is_active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>{depot.address ?? "n/a"}</TableCell>
                        <TableCell>{depot.contact_phone ?? "n/a"}</TableCell>
                        <TableCell>
                          {depot.latitude != null && depot.longitude != null
                            ? `${depot.latitude.toFixed(5)}, ${depot.longitude.toFixed(5)}`
                            : "n/a"}
                        </TableCell>
                        <TableCell>
                          {new Date(depot.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(depot)}
                            >
                              <PencilLine className="mr-1 h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={!depot.is_active || isDeactivating}
                              onClick={() => void deactivateDepot(depot)}
                            >
                              <UserX className="mr-1 h-4 w-4" />
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
            resetForm();
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingDepot ? "Edit Depot" : "Create Depot"}
            </DialogTitle>
            <DialogDescription>
              {editingDepot
                ? "Update depot details and coordinates."
                : "Add a new depot to your organization master data."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="depot-name">Depot Name</Label>
              <Input
                id="depot-name"
                value={formState.name}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="North Transfer Hub"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="depot-address">Address</Label>
              <Input
                id="depot-address"
                value={formState.address}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    address: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="depot-contact-phone">Contact Phone</Label>
              <Input
                id="depot-contact-phone"
                value={formState.contact_phone}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    contact_phone: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="depot-is-active">Status</Label>
              <Select
                value={formState.is_active}
                onValueChange={(value) =>
                  setFormState((prev) => ({ ...prev, is_active: value }))
                }
              >
                <SelectTrigger id="depot-is-active">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="depot-latitude">Latitude</Label>
              <Input
                id="depot-latitude"
                type="number"
                step="0.000001"
                value={formState.latitude}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    latitude: event.target.value,
                  }))
                }
                placeholder="12.971600"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="depot-longitude">Longitude</Label>
              <Input
                id="depot-longitude"
                type="number"
                step="0.000001"
                value={formState.longitude}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    longitude: event.target.value,
                  }))
                }
                placeholder="77.594600"
              />
            </div>
          </div>

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

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveDepot()} disabled={submitting}>
              {submitting
                ? "Saving..."
                : editingDepot
                  ? "Update Depot"
                  : "Create Depot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DepotLocationPickerDialog
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

export default DepotsManagementPanel;
