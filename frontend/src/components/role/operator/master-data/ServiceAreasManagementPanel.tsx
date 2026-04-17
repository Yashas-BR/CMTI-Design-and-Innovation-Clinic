import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  MapPin,
  PencilLine,
  PlusCircle,
  RefreshCw,
  Shapes,
  UserX,
} from "lucide-react";

import ServiceAreaLocationPickerDialog from "@/components/role/operator/master-data/ServiceAreaLocationPickerDialog";
import type {
  ServiceAreaFormPayload,
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
import { Textarea } from "@/components/ui/textarea";
import { extractApiErrorMessage } from "@/lib/authApi";

type ServiceAreasManagementPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
  onDataChanged: () => Promise<void>;
};

type ServiceAreaListResponse = {
  total: number;
  limit: number;
  offset: number;
  items: ServiceAreaRecord[];
};

const LIST_LIMIT = 100;

const EMPTY_FORM: ServiceAreaFormPayload = {
  name: "",
  center_latitude: "",
  center_longitude: "",
  boundary_geojson: "",
  priority_weight: "1",
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

function parsePositiveNumber(value: string): number | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseBoundaryGeoJson(value: string): Record<string, unknown> | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Boundary GeoJSON must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function ServiceAreasManagementPanel({
  accessToken,
  apiBaseUrl,
  onDataChanged,
}: ServiceAreasManagementPanelProps) {
  const [loading, setLoading] = useState(true);
  const [areas, setAreas] = useState<ServiceAreaRecord[]>([]);
  const [totalAreas, setTotalAreas] = useState(0);

  const [queryText, setQueryText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingArea, setEditingArea] = useState<ServiceAreaRecord | null>(
    null,
  );
  const [formState, setFormState] =
    useState<ServiceAreaFormPayload>(EMPTY_FORM);

  const [submitting, setSubmitting] = useState(false);
  const [deactivatingAreaId, setDeactivatingAreaId] = useState<number | null>(
    null,
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  const fetchAreas = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get<ServiceAreaListResponse>(
        `${apiBaseUrl}/master-data/service-areas`,
        {
          headers,
          params: {
            limit: LIST_LIMIT,
            offset: 0,
          },
        },
      );

      setAreas(response.data.items);
      setTotalAreas(response.data.total);
      setErrorMessage("");
    } catch (error) {
      setAreas([]);
      setTotalAreas(0);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to load service areas."),
      );
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, headers]);

  useEffect(() => {
    void fetchAreas();
  }, [fetchAreas]);

  const filteredAreas = useMemo(() => {
    const query = queryText.trim().toLowerCase();

    return areas.filter((area) => {
      const passesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && area.is_active) ||
        (statusFilter === "inactive" && !area.is_active);

      if (!passesStatus) {
        return false;
      }

      if (!query) {
        return true;
      }

      return area.name.toLowerCase().includes(query);
    });
  }, [areas, queryText, statusFilter]);

  const selectedPoint = useMemo<[number, number] | null>(() => {
    const latitude = parseCoordinate(formState.center_latitude);
    const longitude = parseCoordinate(formState.center_longitude);
    if (latitude == null || longitude == null) {
      return null;
    }
    return [latitude, longitude];
  }, [formState.center_latitude, formState.center_longitude]);

  const resetForm = () => {
    setFormState(EMPTY_FORM);
    setEditingArea(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setFormDialogOpen(true);
  };

  const openEditDialog = (area: ServiceAreaRecord) => {
    setEditingArea(area);
    setFormState({
      name: area.name,
      center_latitude:
        area.center_latitude != null ? String(area.center_latitude) : "",
      center_longitude:
        area.center_longitude != null ? String(area.center_longitude) : "",
      boundary_geojson: area.boundary_geojson
        ? JSON.stringify(area.boundary_geojson, null, 2)
        : "",
      priority_weight: String(area.priority_weight),
      is_active: area.is_active ? "active" : "inactive",
    });
    setFormDialogOpen(true);
  };

  const saveArea = async () => {
    const centerLatitude = parseCoordinate(formState.center_latitude);
    const centerLongitude = parseCoordinate(formState.center_longitude);

    if ((centerLatitude == null) !== (centerLongitude == null)) {
      setErrorMessage(
        "Provide both center latitude and center longitude, or leave both empty.",
      );
      return;
    }

    const priorityWeight = parsePositiveNumber(formState.priority_weight);
    if (priorityWeight == null) {
      setErrorMessage("Priority weight must be a number greater than 0.");
      return;
    }

    if (!formState.name.trim()) {
      setErrorMessage("Service area name is required.");
      return;
    }

    let boundaryGeoJson: Record<string, unknown> | null = null;
    try {
      boundaryGeoJson = parseBoundaryGeoJson(formState.boundary_geojson);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Invalid boundary GeoJSON.",
      );
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    setNoticeMessage("");

    const payload = {
      name: formState.name.trim(),
      center_latitude: centerLatitude,
      center_longitude: centerLongitude,
      boundary_geojson: boundaryGeoJson,
      priority_weight: priorityWeight,
      is_active: formState.is_active === "active",
    };

    try {
      if (editingArea) {
        await axios.patch(
          `${apiBaseUrl}/master-data/service-areas/${editingArea.id}`,
          payload,
          {
            headers,
          },
        );
        setNoticeMessage("Service area updated successfully.");
      } else {
        await axios.post(`${apiBaseUrl}/master-data/service-areas`, payload, {
          headers,
        });
        setNoticeMessage("Service area created successfully.");
      }

      setFormDialogOpen(false);
      resetForm();
      await fetchAreas();
      await onDataChanged();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to save service area."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const deactivateArea = async (area: ServiceAreaRecord) => {
    const confirmed = window.confirm(`Deactivate service area ${area.name}?`);
    if (!confirmed) {
      return;
    }

    setDeactivatingAreaId(area.id);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/master-data/service-areas/${area.id}/deactivate`,
        {},
        { headers },
      );
      setNoticeMessage(`${area.name} has been deactivated.`);
      await fetchAreas();
      await onDataChanged();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to deactivate service area."),
      );
    } finally {
      setDeactivatingAreaId(null);
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
            placeholder="Search service areas by name"
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
          <Button variant="outline" onClick={() => void fetchAreas()}>
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreateDialog}>
            <PlusCircle className="mr-1 h-4 w-4" />
            Add Service Area
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
            <CardTitle>Service Areas</CardTitle>
            <CardDescription>
              Manage coverage zones, area centers, and optional boundary
              GeoJSON.
            </CardDescription>
          </div>
          <Badge variant="secondary">
            Showing {filteredAreas.length} / {totalAreas}
          </Badge>
        </CardHeader>
        <CardContent>
          {filteredAreas.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              No service areas match your current filter.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Center</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Boundary</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAreas.map((area) => {
                    const isDeactivating = deactivatingAreaId === area.id;
                    return (
                      <TableRow key={area.id}>
                        <TableCell className="font-medium">
                          {area.name}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              area.is_active
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700"
                            }
                          >
                            {area.is_active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {area.center_latitude != null &&
                          area.center_longitude != null
                            ? `${area.center_latitude.toFixed(5)}, ${area.center_longitude.toFixed(5)}`
                            : "n/a"}
                        </TableCell>
                        <TableCell>{area.priority_weight}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <Shapes className="h-4 w-4 text-slate-500" />
                            {area.boundary_geojson ? "Defined" : "None"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {new Date(area.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(area)}
                            >
                              <PencilLine className="mr-1 h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={!area.is_active || isDeactivating}
                              onClick={() => void deactivateArea(area)}
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
              {editingArea ? "Edit Service Area" : "Create Service Area"}
            </DialogTitle>
            <DialogDescription>
              {editingArea
                ? "Update service area details, center, and optional boundary."
                : "Add a new service area in master data."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="area-name">Area Name</Label>
              <Input
                id="area-name"
                value={formState.name}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                placeholder="Ward 12 East Zone"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="area-priority-weight">Priority Weight</Label>
              <Input
                id="area-priority-weight"
                type="number"
                step="0.1"
                min="0.1"
                value={formState.priority_weight}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    priority_weight: event.target.value,
                  }))
                }
                placeholder="1.0"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="area-is-active">Status</Label>
              <Select
                value={formState.is_active}
                onValueChange={(value) =>
                  setFormState((prev) => ({ ...prev, is_active: value }))
                }
              >
                <SelectTrigger id="area-is-active">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="area-center-latitude">Center Latitude</Label>
              <Input
                id="area-center-latitude"
                type="number"
                step="0.000001"
                value={formState.center_latitude}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    center_latitude: event.target.value,
                  }))
                }
                placeholder="12.971600"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="area-center-longitude">Center Longitude</Label>
              <Input
                id="area-center-longitude"
                type="number"
                step="0.000001"
                value={formState.center_longitude}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    center_longitude: event.target.value,
                  }))
                }
                placeholder="77.594600"
              />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="area-boundary-geojson">Boundary GeoJSON</Label>
              <Textarea
                id="area-boundary-geojson"
                value={formState.boundary_geojson}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    boundary_geojson: event.target.value,
                  }))
                }
                placeholder='Optional JSON object, for example {"type":"Polygon","coordinates":[...]}'
                className="min-h-36 font-mono text-xs"
              />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-700">
              Selected center:{" "}
              {selectedPoint
                ? `${selectedPoint[0].toFixed(6)}, ${selectedPoint[1].toFixed(6)}`
                : "not set"}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Boundary:{" "}
              {formState.boundary_geojson.trim() ? "defined" : "not set"}
            </p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => setLocationDialogOpen(true)}
            >
              <MapPin className="mr-1 h-4 w-4" />
              Open Map Editor (Center + Boundary)
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveArea()} disabled={submitting}>
              {submitting
                ? "Saving..."
                : editingArea
                  ? "Update Service Area"
                  : "Create Service Area"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ServiceAreaLocationPickerDialog
        open={locationDialogOpen}
        onOpenChange={setLocationDialogOpen}
        selectedPoint={selectedPoint}
        initialBoundaryGeoJson={formState.boundary_geojson}
        onApply={({ center, boundaryGeoJson }) => {
          setFormState((prev) => ({
            ...prev,
            center_latitude: center ? center[0].toFixed(6) : "",
            center_longitude: center ? center[1].toFixed(6) : "",
            boundary_geojson: boundaryGeoJson,
          }));
        }}
      />
    </div>
  );
}

export default ServiceAreasManagementPanel;
