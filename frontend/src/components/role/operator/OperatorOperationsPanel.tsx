import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  GitBranchPlus,
  MapPinned,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Route,
  Send,
  SkipForward,
  Truck,
} from "lucide-react";

import type {
  BinRecord,
  DepotRecord,
  DriverUser,
  RouteAutoPlanResult,
  RouteAssignmentRecord,
  RoutePlanResult,
  RouteRecord,
  RouteStopRecord,
  ShiftRecord,
  VehicleRecord,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { extractApiErrorMessage } from "@/lib/authApi";

type OperatorOperationsTab =
  | "overview"
  | "vehicles"
  | "shifts"
  | "route-planner"
  | "routes"
  | "assignments"
  | "stops";

type OperatorOperationsPanelProps = {
  accessToken: string;
  apiBaseUrl: string;
  initialTab?: OperatorOperationsTab;
};

type ListResponse<T> = {
  total: number;
  limit: number;
  offset: number;
  items: T[];
};

type RoutePlanFormState = {
  route_date: string;
  depot_id: string;
  driver_user_id: string;
  include_bin_ids: string;
  max_stops: string;
  min_fill_pct: string;
  overflow_only: string;
  target_shift_minutes: string;
  avg_speed_kmph: string;
  service_minutes_per_stop: string;
  use_multi_vehicle: string;
  vehicle_ids: string;
};

type VehicleFormState = {
  vehicle_no: string;
  vehicle_type: string;
  capacity_kg: string;
  status: string;
};

type ShiftFormState = {
  driver_user_id: string;
  vehicle_id: string;
  planned_start: string;
  planned_end: string;
  notes: string;
};

type RouteDraftFormState = {
  route_code: string;
  route_date: string;
  depot_id: string;
  driver_user_id: string;
  stop_bin_ids: string;
};

type AssignmentCreateFormState = {
  driver_user_id: string;
  vehicle_id: string;
};

const LIST_LIMIT = 100;

const todayDateIso = new Date().toISOString().slice(0, 10);

const DEFAULT_VEHICLE_FORM: VehicleFormState = {
  vehicle_no: "",
  vehicle_type: "",
  capacity_kg: "",
  status: "active",
};

const DEFAULT_SHIFT_FORM: ShiftFormState = {
  driver_user_id: "__none__",
  vehicle_id: "__none__",
  planned_start: "",
  planned_end: "",
  notes: "",
};

const DEFAULT_ROUTE_PLAN_FORM: RoutePlanFormState = {
  route_date: todayDateIso,
  depot_id: "__none__",
  driver_user_id: "__none__",
  include_bin_ids: "",
  max_stops: "60",
  min_fill_pct: "70",
  overflow_only: "false",
  target_shift_minutes: "480",
  avg_speed_kmph: "22",
  service_minutes_per_stop: "4",
  use_multi_vehicle: "false",
  vehicle_ids: "",
};

const DEFAULT_ROUTE_DRAFT_FORM: RouteDraftFormState = {
  route_code: "",
  route_date: todayDateIso,
  depot_id: "__none__",
  driver_user_id: "__none__",
  stop_bin_ids: "",
};

const DEFAULT_ASSIGNMENT_FORM: AssignmentCreateFormState = {
  driver_user_id: "__none__",
  vehicle_id: "__none__",
};

function parseOptionalInt(value: string): number | null {
  if (value.trim() === "" || value === "__none__") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseOptionalFloat(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseCsvIntList(value: string): number[] {
  if (!value.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number.parseInt(item, 10))
    .filter((num) => Number.isFinite(num) && num > 0);
}

function toApiDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
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

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ops-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function RouteMapBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [26, 26] });
    }
  }, [map, points]);

  return null;
}

function OperatorOperationsPanel({
  accessToken,
  apiBaseUrl,
  initialTab = "overview",
}: OperatorOperationsPanelProps) {
  const [activeTab, setActiveTab] = useState<OperatorOperationsTab>(initialTab);

  const [loadingCore, setLoadingCore] = useState(true);
  const [globalActionKey, setGlobalActionKey] = useState<string | null>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverUser[]>([]);
  const [depots, setDepots] = useState<DepotRecord[]>([]);
  const [bins, setBins] = useState<BinRecord[]>([]);

  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(null);

  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignments, setAssignments] = useState<RouteAssignmentRecord[]>([]);

  const [stopsLoading, setStopsLoading] = useState(false);
  const [stops, setStops] = useState<RouteStopRecord[]>([]);
  const [selectedRouteRoadPolyline, setSelectedRouteRoadPolyline] = useState<
    Array<[number, number]>
  >([]);
  const [selectedRoutePathSource, setSelectedRoutePathSource] = useState<
    "road" | "direct"
  >("direct");
  const [selectedRoutePathLoading, setSelectedRoutePathLoading] =
    useState(false);

  const [vehicleForm, setVehicleForm] =
    useState<VehicleFormState>(DEFAULT_VEHICLE_FORM);
  const [editingVehicleId, setEditingVehicleId] = useState<number | null>(null);

  const [shiftForm, setShiftForm] =
    useState<ShiftFormState>(DEFAULT_SHIFT_FORM);

  const [routePlanForm, setRoutePlanForm] = useState<RoutePlanFormState>(
    DEFAULT_ROUTE_PLAN_FORM,
  );
  const [routePlanResult, setRoutePlanResult] =
    useState<RoutePlanResult | null>(null);
  const [autoPlanResult, setAutoPlanResult] =
    useState<RouteAutoPlanResult | null>(null);

  const [routeDraftForm, setRouteDraftForm] = useState<RouteDraftFormState>(
    DEFAULT_ROUTE_DRAFT_FORM,
  );
  const [routeStatusFilter, setRouteStatusFilter] = useState("all");
  const [routeDateFilter, setRouteDateFilter] = useState("");

  const [assignmentCreateForm, setAssignmentCreateForm] =
    useState<AssignmentCreateFormState>(DEFAULT_ASSIGNMENT_FORM);

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${accessToken}` }),
    [accessToken],
  );

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const setBusy = (key: string | null) => setGlobalActionKey(key);

  const driverNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const driver of drivers) {
      map.set(driver.id, driver.full_name);
    }
    return map;
  }, [drivers]);

  const vehicleNoById = useMemo(() => {
    const map = new Map<number, string>();
    for (const vehicle of vehicles) {
      map.set(vehicle.id, vehicle.vehicle_no);
    }
    return map;
  }, [vehicles]);

  const depotNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const depot of depots) {
      map.set(depot.id, depot.name);
    }
    return map;
  }, [depots]);

  const binCodeById = useMemo(() => {
    const map = new Map<number, string>();
    for (const bin of bins) {
      map.set(bin.id, bin.bin_code);
    }
    return map;
  }, [bins]);

  const binCoordinatesById = useMemo(() => {
    const map = new Map<number, [number, number]>();
    for (const bin of bins) {
      if (bin.latitude == null || bin.longitude == null) {
        continue;
      }
      map.set(bin.id, [bin.latitude, bin.longitude]);
    }
    return map;
  }, [bins]);

  const selectedRoute = useMemo(() => {
    if (selectedRouteId == null) {
      return null;
    }
    return routes.find((route) => route.id === selectedRouteId) ?? null;
  }, [routes, selectedRouteId]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((route) => {
      const statusOk =
        routeStatusFilter === "all" || route.status === routeStatusFilter;
      const dateOk = !routeDateFilter || route.route_date === routeDateFilter;
      return statusOk && dateOk;
    });
  }, [routes, routeStatusFilter, routeDateFilter]);

  const selectedRoutePolyline = useMemo<Array<[number, number]>>(() => {
    return stops
      .slice()
      .sort((left, right) => left.stop_sequence - right.stop_sequence)
      .map((stop) => binCoordinatesById.get(stop.bin_id) ?? null)
      .filter((item): item is [number, number] => item != null);
  }, [stops, binCoordinatesById]);

  const selectedRouteDirectPath = useMemo<Array<[number, number]>>(() => {
    const path: Array<[number, number]> = [];

    if (
      selectedRoute?.start_point?.latitude != null &&
      selectedRoute?.start_point?.longitude != null
    ) {
      path.push([
        selectedRoute.start_point.latitude,
        selectedRoute.start_point.longitude,
      ]);
    }

    path.push(...selectedRoutePolyline);
    return path;
  }, [selectedRoute, selectedRoutePolyline]);

  const selectedRoutePathPolyline = useMemo<Array<[number, number]>>(() => {
    if (selectedRouteRoadPolyline.length > 1) {
      return selectedRouteRoadPolyline;
    }
    return selectedRouteDirectPath;
  }, [selectedRouteRoadPolyline, selectedRouteDirectPath]);

  const selectedRouteMapCenter = useMemo<[number, number]>(() => {
    if (
      selectedRoute?.start_point?.latitude != null &&
      selectedRoute?.start_point?.longitude != null
    ) {
      return [
        selectedRoute.start_point.latitude,
        selectedRoute.start_point.longitude,
      ];
    }
    if (selectedRoutePolyline.length > 0) {
      return selectedRoutePolyline[0];
    }
    return [12.9716, 77.5946];
  }, [selectedRoute, selectedRoutePolyline]);

  useEffect(() => {
    let active = true;

    const fetchRoadSnappedPath = async () => {
      if (selectedRouteId == null || selectedRouteDirectPath.length < 2) {
        if (active) {
          setSelectedRouteRoadPolyline([]);
          setSelectedRoutePathSource("direct");
          setSelectedRoutePathLoading(false);
        }
        return;
      }

      setSelectedRoutePathLoading(true);

      try {
        const coordinateList = selectedRouteDirectPath
          .map(([latitude, longitude]) => `${longitude},${latitude}`)
          .join(";");

        const response = await axios.get<{
          code: string;
          routes?: Array<{
            geometry?: {
              coordinates?: Array<[number, number]>;
            };
          }>;
        }>(
          `https://router.project-osrm.org/route/v1/driving/${coordinateList}`,
          {
            params: {
              overview: "full",
              geometries: "geojson",
              alternatives: false,
              steps: false,
            },
            timeout: 12000,
          },
        );

        const geometry = response.data.routes?.[0]?.geometry?.coordinates ?? [];
        const roadPoints = geometry
          .map(([longitude, latitude]) => {
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
              return null;
            }
            return [latitude, longitude] as [number, number];
          })
          .filter((item): item is [number, number] => item != null);

        if (!active) {
          return;
        }

        if (response.data.code === "Ok" && roadPoints.length > 1) {
          setSelectedRouteRoadPolyline(roadPoints);
          setSelectedRoutePathSource("road");
        } else {
          setSelectedRouteRoadPolyline([]);
          setSelectedRoutePathSource("direct");
        }
      } catch {
        if (!active) {
          return;
        }
        setSelectedRouteRoadPolyline([]);
        setSelectedRoutePathSource("direct");
      } finally {
        if (active) {
          setSelectedRoutePathLoading(false);
        }
      }
    };

    void fetchRoadSnappedPath();

    return () => {
      active = false;
    };
  }, [selectedRouteId, selectedRouteDirectPath]);

  const overviewMetrics = useMemo(() => {
    const activeShifts = shifts.filter(
      (item) => item.status === "active",
    ).length;
    const scheduledShifts = shifts.filter(
      (item) => item.status === "scheduled",
    ).length;
    const publishedRoutes = routes.filter(
      (item) => item.status === "published",
    ).length;
    const inProgressRoutes = routes.filter(
      (item) => item.status === "in_progress",
    ).length;
    const pendingAssignments = assignments.filter(
      (item) => item.status === "assigned",
    ).length;
    const servicedStops = stops.filter(
      (item) => item.status === "serviced",
    ).length;
    const skippedStops = stops.filter(
      (item) => item.status === "skipped",
    ).length;

    return {
      activeShifts,
      scheduledShifts,
      publishedRoutes,
      inProgressRoutes,
      pendingAssignments,
      servicedStops,
      skippedStops,
      activeVehicles: vehicles.filter((item) => item.is_active).length,
      totalVehicles: vehicles.length,
    };
  }, [vehicles, shifts, routes, assignments, stops]);

  const triggerAutoPlanning = useCallback(async () => {
    try {
      const response = await axios.post<RouteAutoPlanResult>(
        `${apiBaseUrl}/operations/routes/auto-plan`,
        {
          route_date: todayDateIso,
          force: false,
        },
        { headers },
      );

      setAutoPlanResult(response.data);

      if (response.data.created_count > 0) {
        setNoticeMessage(
          `Auto-planner created ${response.data.created_count} optimized draft route(s).`,
        );
      }
    } catch (error) {
      setAutoPlanResult(null);
      setErrorMessage(
        extractApiErrorMessage(
          error,
          "Failed to run automatic intelligent planning.",
        ),
      );
    }
  }, [apiBaseUrl, headers]);

  const fetchCoreResources = useCallback(
    async (options?: { triggerAutoPlan?: boolean }) => {
      setLoadingCore(true);
      setErrorMessage("");

      try {
        if (options?.triggerAutoPlan) {
          await triggerAutoPlanning();
        }

        const [
          vehiclesRes,
          shiftsRes,
          routesRes,
          driversRes,
          depotsRes,
          binsRes,
        ] = await Promise.all([
          axios.get<ListResponse<VehicleRecord>>(
            `${apiBaseUrl}/operations/vehicles`,
            {
              headers,
              params: { limit: LIST_LIMIT, offset: 0 },
            },
          ),
          axios.get<ListResponse<ShiftRecord>>(
            `${apiBaseUrl}/operations/shifts`,
            {
              headers,
              params: { limit: LIST_LIMIT, offset: 0 },
            },
          ),
          axios.get<ListResponse<RouteRecord>>(
            `${apiBaseUrl}/operations/routes`,
            {
              headers,
              params: { limit: LIST_LIMIT, offset: 0 },
            },
          ),
          axios.get<ListResponse<DriverUser>>(`${apiBaseUrl}/users`, {
            headers,
            params: {
              role: "driver",
              is_active: true,
              limit: LIST_LIMIT,
              offset: 0,
            },
          }),
          axios.get<ListResponse<DepotRecord>>(
            `${apiBaseUrl}/master-data/depots`,
            {
              headers,
              params: { is_active: true, limit: LIST_LIMIT, offset: 0 },
            },
          ),
          axios.get<ListResponse<BinRecord>>(`${apiBaseUrl}/bins`, {
            headers,
            params: { is_active: true, limit: LIST_LIMIT, offset: 0 },
          }),
        ]);

        const nextVehicles = vehiclesRes.data.items;
        const nextShifts = shiftsRes.data.items;
        const nextRoutes = routesRes.data.items;

        setVehicles(nextVehicles);
        setShifts(nextShifts);
        setRoutes(nextRoutes);
        setDrivers(driversRes.data.items);
        setDepots(depotsRes.data.items);
        setBins(binsRes.data.items);

        if (nextRoutes.length === 0) {
          setSelectedRouteId(null);
        } else if (
          selectedRouteId == null ||
          !nextRoutes.some((item) => item.id === selectedRouteId)
        ) {
          setSelectedRouteId(nextRoutes[0].id);
        }
      } catch (error) {
        setErrorMessage(
          extractApiErrorMessage(error, "Failed to load operations data."),
        );
        setVehicles([]);
        setShifts([]);
        setRoutes([]);
        setDrivers([]);
        setDepots([]);
        setBins([]);
        setSelectedRouteId(null);
      } finally {
        setLoadingCore(false);
      }
    },
    [apiBaseUrl, headers, selectedRouteId, triggerAutoPlanning],
  );

  const fetchAssignmentsForRoute = useCallback(
    async (routeId: number) => {
      setAssignmentsLoading(true);
      try {
        const response = await axios.get<ListResponse<RouteAssignmentRecord>>(
          `${apiBaseUrl}/operations/routes/${routeId}/assignments`,
          {
            headers,
            params: { limit: LIST_LIMIT, offset: 0 },
          },
        );
        setAssignments(response.data.items);
      } catch (error) {
        setAssignments([]);
        setErrorMessage(
          extractApiErrorMessage(error, "Failed to load route assignments."),
        );
      } finally {
        setAssignmentsLoading(false);
      }
    },
    [apiBaseUrl, headers],
  );

  const fetchStopsForRoute = useCallback(
    async (routeId: number) => {
      setStopsLoading(true);
      try {
        const response = await axios.get<ListResponse<RouteStopRecord>>(
          `${apiBaseUrl}/operations/routes/${routeId}/stops`,
          {
            headers,
            params: { limit: LIST_LIMIT, offset: 0 },
          },
        );
        setStops(response.data.items);
      } catch (error) {
        setStops([]);
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
    void fetchCoreResources({ triggerAutoPlan: true });
  }, [fetchCoreResources]);

  useEffect(() => {
    if (selectedRouteId == null) {
      setAssignments([]);
      setStops([]);
      return;
    }

    void fetchAssignmentsForRoute(selectedRouteId);
    void fetchStopsForRoute(selectedRouteId);
  }, [selectedRouteId, fetchAssignmentsForRoute, fetchStopsForRoute]);

  const refreshRouteScopedData = useCallback(async () => {
    if (selectedRouteId == null) {
      return;
    }
    await Promise.all([
      fetchAssignmentsForRoute(selectedRouteId),
      fetchStopsForRoute(selectedRouteId),
    ]);
  }, [selectedRouteId, fetchAssignmentsForRoute, fetchStopsForRoute]);

  const startVehicleEdit = (vehicle: VehicleRecord) => {
    setEditingVehicleId(vehicle.id);
    setVehicleForm({
      vehicle_no: vehicle.vehicle_no,
      vehicle_type: vehicle.vehicle_type ?? "",
      capacity_kg:
        vehicle.capacity_kg != null ? String(vehicle.capacity_kg) : "",
      status: vehicle.status,
    });
  };

  const resetVehicleForm = () => {
    setEditingVehicleId(null);
    setVehicleForm(DEFAULT_VEHICLE_FORM);
  };

  const saveVehicle = async () => {
    if (!vehicleForm.vehicle_no.trim()) {
      setErrorMessage("Vehicle number is required.");
      return;
    }

    const capacityKg = parseOptionalFloat(vehicleForm.capacity_kg);
    if (vehicleForm.capacity_kg.trim() && capacityKg == null) {
      setErrorMessage("Capacity must be a valid number.");
      return;
    }

    setBusy("vehicle-save");
    setErrorMessage("");
    setNoticeMessage("");

    const payload = {
      vehicle_no: vehicleForm.vehicle_no.trim(),
      vehicle_type: vehicleForm.vehicle_type.trim() || null,
      capacity_kg: capacityKg,
      status: vehicleForm.status,
    };

    try {
      if (editingVehicleId != null) {
        await axios.patch(
          `${apiBaseUrl}/operations/vehicles/${editingVehicleId}`,
          payload,
          { headers },
        );
        setNoticeMessage("Vehicle updated.");
      } else {
        await axios.post(`${apiBaseUrl}/operations/vehicles`, payload, {
          headers,
        });
        setNoticeMessage("Vehicle created.");
      }

      resetVehicleForm();
      await fetchCoreResources();
    } catch (error) {
      setErrorMessage(extractApiErrorMessage(error, "Failed to save vehicle."));
    } finally {
      setBusy(null);
    }
  };

  const deactivateVehicle = async (vehicle: VehicleRecord) => {
    const confirmed = window.confirm(`Deactivate ${vehicle.vehicle_no}?`);
    if (!confirmed) {
      return;
    }

    setBusy(`vehicle-deactivate-${vehicle.id}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/vehicles/${vehicle.id}/deactivate`,
        {},
        { headers },
      );
      setNoticeMessage(`Vehicle ${vehicle.vehicle_no} deactivated.`);
      await fetchCoreResources();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to deactivate vehicle."),
      );
    } finally {
      setBusy(null);
    }
  };

  const createShift = async () => {
    const driverUserId = parseOptionalInt(shiftForm.driver_user_id);
    if (driverUserId == null) {
      setErrorMessage("Select a driver for shift creation.");
      return;
    }

    const plannedStartIso = toApiDateTime(shiftForm.planned_start);
    const plannedEndIso = toApiDateTime(shiftForm.planned_end);

    if (!plannedStartIso || !plannedEndIso) {
      setErrorMessage("Planned start and end are required.");
      return;
    }

    setBusy("shift-create");
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/shifts`,
        {
          driver_user_id: driverUserId,
          vehicle_id: parseOptionalInt(shiftForm.vehicle_id),
          planned_start: plannedStartIso,
          planned_end: plannedEndIso,
          notes: shiftForm.notes.trim() || null,
        },
        { headers },
      );

      setShiftForm(DEFAULT_SHIFT_FORM);
      setNoticeMessage("Shift created.");
      await fetchCoreResources();
    } catch (error) {
      setErrorMessage(extractApiErrorMessage(error, "Failed to create shift."));
    } finally {
      setBusy(null);
    }
  };

  const updateShiftStatus = async (
    shiftId: number,
    action: "start" | "complete",
  ) => {
    setBusy(`shift-${action}-${shiftId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/shifts/${shiftId}/${action}`,
        {},
        { headers },
      );
      setNoticeMessage(`Shift ${action}ed.`);
      await fetchCoreResources();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, `Failed to ${action} shift.`),
      );
    } finally {
      setBusy(null);
    }
  };

  const runRoutePlan = async () => {
    const maxStops = Number.parseInt(routePlanForm.max_stops, 10);
    const minFillPct = Number.parseFloat(routePlanForm.min_fill_pct);
    const targetShiftMinutes = Number.parseInt(
      routePlanForm.target_shift_minutes,
      10,
    );
    const avgSpeedKmph = Number.parseFloat(routePlanForm.avg_speed_kmph);
    const serviceMinutesPerStop = Number.parseFloat(
      routePlanForm.service_minutes_per_stop,
    );

    if (!routePlanForm.route_date) {
      setErrorMessage("Route date is required for planning.");
      return;
    }

    if (
      !Number.isFinite(maxStops) ||
      !Number.isFinite(minFillPct) ||
      !Number.isFinite(targetShiftMinutes) ||
      !Number.isFinite(avgSpeedKmph) ||
      !Number.isFinite(serviceMinutesPerStop)
    ) {
      setErrorMessage("Planner numeric fields must be valid numbers.");
      return;
    }

    const includeBinIds = parseCsvIntList(routePlanForm.include_bin_ids);
    const vehicleIds = parseCsvIntList(routePlanForm.vehicle_ids);

    setBusy("route-plan");
    setErrorMessage("");
    setNoticeMessage("");

    try {
      const response = await axios.post<RoutePlanResult>(
        `${apiBaseUrl}/operations/routes/plan`,
        {
          route_date: routePlanForm.route_date,
          depot_id: parseOptionalInt(routePlanForm.depot_id),
          driver_user_id: parseOptionalInt(routePlanForm.driver_user_id),
          include_bin_ids: includeBinIds.length > 0 ? includeBinIds : null,
          max_stops: maxStops,
          min_fill_pct: minFillPct,
          overflow_only: routePlanForm.overflow_only === "true",
          target_shift_minutes: targetShiftMinutes,
          avg_speed_kmph: avgSpeedKmph,
          service_minutes_per_stop: serviceMinutesPerStop,
          use_multi_vehicle: routePlanForm.use_multi_vehicle === "true",
          vehicle_ids: vehicleIds.length > 0 ? vehicleIds : null,
        },
        { headers },
      );

      setRoutePlanResult(response.data);
      setNoticeMessage("Route plan generated.");
    } catch (error) {
      setRoutePlanResult(null);
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to generate route plan."),
      );
    } finally {
      setBusy(null);
    }
  };

  const createRouteDraft = async () => {
    if (!routeDraftForm.route_code.trim()) {
      setErrorMessage("Route code is required.");
      return;
    }

    if (!routeDraftForm.route_date) {
      setErrorMessage("Route date is required.");
      return;
    }

    const stopBinIds = parseCsvIntList(routeDraftForm.stop_bin_ids);
    if (stopBinIds.length === 0) {
      setErrorMessage("Provide at least one bin id in stop sequence.");
      return;
    }

    setBusy("route-create");
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/routes`,
        {
          route_code: routeDraftForm.route_code.trim(),
          route_date: routeDraftForm.route_date,
          depot_id: parseOptionalInt(routeDraftForm.depot_id),
          driver_user_id: parseOptionalInt(routeDraftForm.driver_user_id),
          stop_bin_ids: stopBinIds,
        },
        { headers },
      );

      setRouteDraftForm(DEFAULT_ROUTE_DRAFT_FORM);
      setNoticeMessage("Draft route created.");
      await fetchCoreResources();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to create draft route."),
      );
    } finally {
      setBusy(null);
    }
  };

  const routeTransition = async (
    routeId: number,
    action: "publish" | "start" | "complete",
  ) => {
    setBusy(`route-${action}-${routeId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      if (action === "publish") {
        await axios.post(
          `${apiBaseUrl}/operations/routes/${routeId}/publish`,
          {},
          { headers },
        );
      } else {
        await axios.post(
          `${apiBaseUrl}/operations/routes/${routeId}/${action}`,
          {},
          { headers },
        );
      }

      setNoticeMessage(`Route ${action}ed.`);
      await fetchCoreResources();
      await refreshRouteScopedData();
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, `Failed to ${action} route.`),
      );
    } finally {
      setBusy(null);
    }
  };

  const createAssignment = async () => {
    if (selectedRouteId == null) {
      setErrorMessage("Select a route before creating assignments.");
      return;
    }

    const driverUserId = parseOptionalInt(assignmentCreateForm.driver_user_id);
    if (driverUserId == null) {
      setErrorMessage("Driver is required for assignment creation.");
      return;
    }

    setBusy("assignment-create");
    setErrorMessage("");
    setNoticeMessage("");

    try {
      await axios.post(
        `${apiBaseUrl}/operations/routes/${selectedRouteId}/assignments`,
        {
          driver_user_id: driverUserId,
          vehicle_id: parseOptionalInt(assignmentCreateForm.vehicle_id),
        },
        { headers },
      );
      setAssignmentCreateForm(DEFAULT_ASSIGNMENT_FORM);
      setNoticeMessage("Route assignment created.");
      await fetchAssignmentsForRoute(selectedRouteId);
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, "Failed to create assignment."),
      );
    } finally {
      setBusy(null);
    }
  };

  const assignmentTransition = async (
    assignmentId: number,
    action: "accept" | "reject",
  ) => {
    setBusy(`assignment-${action}-${assignmentId}`);
    setErrorMessage("");
    setNoticeMessage("");

    try {
      if (action === "accept") {
        await axios.post(
          `${apiBaseUrl}/operations/assignments/${assignmentId}/accept`,
          {},
          { headers },
        );
      } else {
        const reason =
          window.prompt("Enter rejection reason:", "")?.trim() ?? "";
        if (!reason) {
          setBusy(null);
          return;
        }
        await axios.post(
          `${apiBaseUrl}/operations/assignments/${assignmentId}/reject`,
          { reject_reason: reason },
          { headers },
        );
      }

      setNoticeMessage(`Assignment ${action}ed.`);
      if (selectedRouteId != null) {
        await fetchAssignmentsForRoute(selectedRouteId);
      }
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, `Failed to ${action} assignment.`),
      );
    } finally {
      setBusy(null);
    }
  };

  const stopTransition = async (
    stopId: number,
    action: "arrive" | "service" | "skip",
  ) => {
    setBusy(`stop-${action}-${stopId}`);
    setErrorMessage("");
    setNoticeMessage("");

    const idempotencyHeaders = {
      ...headers,
      "Idempotency-Key": createIdempotencyKey(),
    };

    try {
      if (action === "skip") {
        const reason = window.prompt("Enter skip reason:", "")?.trim() ?? "";
        if (!reason) {
          setBusy(null);
          return;
        }

        await axios.post(
          `${apiBaseUrl}/operations/stops/${stopId}/skip`,
          { reason },
          { headers: idempotencyHeaders },
        );
      } else {
        await axios.post(
          `${apiBaseUrl}/operations/stops/${stopId}/${action}`,
          {},
          { headers: idempotencyHeaders },
        );
      }

      setNoticeMessage(`Stop marked as ${action}d.`);
      if (selectedRouteId != null) {
        await fetchStopsForRoute(selectedRouteId);
      }
    } catch (error) {
      setErrorMessage(
        extractApiErrorMessage(error, `Failed to ${action} stop.`),
      );
    } finally {
      setBusy(null);
    }
  };

  if (loadingCore) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as OperatorOperationsTab)}
      className="space-y-5"
    >
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        <TabsTrigger value="shifts">Shifts</TabsTrigger>
        <TabsTrigger value="route-planner">Route Planner</TabsTrigger>
        <TabsTrigger value="routes">Routes</TabsTrigger>
        <TabsTrigger value="assignments">Assignments</TabsTrigger>
        <TabsTrigger value="stops">Stops</TabsTrigger>
      </TabsList>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Operations data uses list API limit {LIST_LIMIT}. If records exceed
          this, apply filters or paging in a future iteration.
        </p>
        <Button
          variant="outline"
          onClick={() => void fetchCoreResources({ triggerAutoPlan: true })}
        >
          <RefreshCw className="mr-1 h-4 w-4" />
          Refresh Operations Data
        </Button>
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

      <TabsContent value="overview" className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-white/80 bg-white/85 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Shifts
              </CardDescription>
              <CardTitle className="text-2xl">
                {overviewMetrics.activeShifts}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-slate-600">
              Scheduled: {overviewMetrics.scheduledShifts}
            </CardContent>
          </Card>

          <Card className="border-white/80 bg-white/85 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Route className="h-4 w-4" />
                Routes In Progress
              </CardDescription>
              <CardTitle className="text-2xl">
                {overviewMetrics.inProgressRoutes}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-slate-600">
              Published: {overviewMetrics.publishedRoutes}
            </CardContent>
          </Card>

          <Card className="border-white/80 bg-white/85 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Open Assignments
              </CardDescription>
              <CardTitle className="text-2xl">
                {overviewMetrics.pendingAssignments}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-slate-600">
              Based on selected route assignments.
            </CardContent>
          </Card>

          <Card className="border-white/80 bg-white/85 shadow-sm">
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Active Vehicles
              </CardDescription>
              <CardTitle className="text-2xl">
                {overviewMetrics.activeVehicles}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-slate-600">
              Total: {overviewMetrics.totalVehicles}
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>
              Jump directly to operational workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setActiveTab("shifts")}>
              Create Shift
            </Button>
            <Button
              variant="outline"
              onClick={() => setActiveTab("route-planner")}
            >
              Plan Route
            </Button>
            <Button variant="outline" onClick={() => setActiveTab("routes")}>
              Create Route
            </Button>
            <Button
              variant="outline"
              onClick={() => setActiveTab("assignments")}
            >
              Manage Assignments
            </Button>
            <Button variant="outline" onClick={() => setActiveTab("stops")}>
              Monitor Stops
            </Button>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Selected Route Context</CardTitle>
            <CardDescription>
              Route-scoped KPIs for assignments and stops.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <p className="text-slate-500">Route</p>
              <p className="font-semibold text-slate-900">
                {selectedRoute
                  ? `${selectedRoute.route_code} (${selectedRoute.status})`
                  : "No route selected"}
              </p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <p className="text-slate-500">Serviced Stops</p>
              <p className="font-semibold text-slate-900">
                {overviewMetrics.servicedStops}
              </p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <p className="text-slate-500">Skipped Stops</p>
              <p className="font-semibold text-slate-900">
                {overviewMetrics.skippedStops}
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="vehicles" className="space-y-4">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>
              {editingVehicleId != null ? "Edit Vehicle" : "Create Vehicle"}
            </CardTitle>
            <CardDescription>
              Register and maintain collection vehicles.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="vehicle_no">Vehicle No</Label>
              <Input
                id="vehicle_no"
                value={vehicleForm.vehicle_no}
                onChange={(event) =>
                  setVehicleForm((prev) => ({
                    ...prev,
                    vehicle_no: event.target.value,
                  }))
                }
                placeholder="TN-09-AB-1234"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vehicle_type">Vehicle Type</Label>
              <Input
                id="vehicle_type"
                value={vehicleForm.vehicle_type}
                onChange={(event) =>
                  setVehicleForm((prev) => ({
                    ...prev,
                    vehicle_type: event.target.value,
                  }))
                }
                placeholder="compactor"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="capacity_kg">Capacity (kg)</Label>
              <Input
                id="capacity_kg"
                value={vehicleForm.capacity_kg}
                onChange={(event) =>
                  setVehicleForm((prev) => ({
                    ...prev,
                    capacity_kg: event.target.value,
                  }))
                }
                placeholder="3500"
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                value={vehicleForm.status}
                onValueChange={(value) =>
                  setVehicleForm((prev) => ({ ...prev, status: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="maintenance">maintenance</SelectItem>
                  <SelectItem value="inactive">inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 lg:col-span-4 flex gap-2">
              <Button
                onClick={() => void saveVehicle()}
                disabled={globalActionKey === "vehicle-save"}
              >
                <Send className="mr-1 h-4 w-4" />
                {editingVehicleId != null ? "Update Vehicle" : "Create Vehicle"}
              </Button>
              {editingVehicleId != null ? (
                <Button variant="outline" onClick={resetVehicleForm}>
                  Cancel Edit
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Vehicles</CardTitle>
            <CardDescription>
              Active and inactive fleet inventory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {vehicles.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No vehicles available.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((vehicle) => (
                    <TableRow key={vehicle.id}>
                      <TableCell className="font-medium">
                        {vehicle.vehicle_no}
                      </TableCell>
                      <TableCell>{vehicle.vehicle_type ?? "n/a"}</TableCell>
                      <TableCell>
                        {vehicle.capacity_kg != null
                          ? `${vehicle.capacity_kg.toFixed(1)} kg`
                          : "n/a"}
                      </TableCell>
                      <TableCell>{vehicle.status}</TableCell>
                      <TableCell>
                        <Badge
                          className={
                            vehicle.is_active
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700"
                          }
                        >
                          {vehicle.is_active ? "active" : "inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startVehicleEdit(vehicle)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={
                              !vehicle.is_active ||
                              globalActionKey ===
                                `vehicle-deactivate-${vehicle.id}`
                            }
                            onClick={() => void deactivateVehicle(vehicle)}
                          >
                            Deactivate
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="shifts" className="space-y-4">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Create Shift</CardTitle>
            <CardDescription>
              Schedule shifts for drivers and optional vehicles.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label>Driver</Label>
              <Select
                value={shiftForm.driver_user_id}
                onValueChange={(value) =>
                  setShiftForm((prev) => ({ ...prev, driver_user_id: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select driver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select driver</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={String(driver.id)}>
                      {driver.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Vehicle (optional)</Label>
              <Select
                value={shiftForm.vehicle_id}
                onValueChange={(value) =>
                  setShiftForm((prev) => ({ ...prev, vehicle_id: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vehicle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned vehicle</SelectItem>
                  {vehicles
                    .filter((vehicle) => vehicle.is_active)
                    .map((vehicle) => (
                      <SelectItem key={vehicle.id} value={String(vehicle.id)}>
                        {vehicle.vehicle_no}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="planned_start">Planned Start</Label>
              <Input
                id="planned_start"
                type="datetime-local"
                value={shiftForm.planned_start}
                onChange={(event) =>
                  setShiftForm((prev) => ({
                    ...prev,
                    planned_start: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="planned_end">Planned End</Label>
              <Input
                id="planned_end"
                type="datetime-local"
                value={shiftForm.planned_end}
                onChange={(event) =>
                  setShiftForm((prev) => ({
                    ...prev,
                    planned_end: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="shift_notes">Notes</Label>
              <Input
                id="shift_notes"
                value={shiftForm.notes}
                onChange={(event) =>
                  setShiftForm((prev) => ({
                    ...prev,
                    notes: event.target.value,
                  }))
                }
                placeholder="Morning shift for Zone A"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <Button
                onClick={() => void createShift()}
                disabled={globalActionKey === "shift-create"}
              >
                <CalendarClock className="mr-1 h-4 w-4" />
                Create Shift
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Shifts</CardTitle>
            <CardDescription>
              Start and complete scheduled shifts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No shifts found.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Planned Window</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shifts.map((shift) => (
                    <TableRow key={shift.id}>
                      <TableCell className="font-medium">#{shift.id}</TableCell>
                      <TableCell>
                        {driverNameById.get(shift.driver_user_id) ??
                          `User ${shift.driver_user_id}`}
                      </TableCell>
                      <TableCell>
                        {shift.vehicle_id != null
                          ? (vehicleNoById.get(shift.vehicle_id) ??
                            `Vehicle ${shift.vehicle_id}`)
                          : "unassigned"}
                      </TableCell>
                      <TableCell>{shift.status}</TableCell>
                      <TableCell>
                        <div className="text-xs text-slate-700">
                          <div>{formatDateTime(shift.planned_start)}</div>
                          <div>{formatDateTime(shift.planned_end)}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              globalActionKey === `shift-start-${shift.id}` ||
                              shift.status !== "scheduled"
                            }
                            onClick={() =>
                              void updateShiftStatus(shift.id, "start")
                            }
                          >
                            <PlayCircle className="mr-1 h-4 w-4" />
                            Start
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              globalActionKey ===
                                `shift-complete-${shift.id}` ||
                              shift.status !== "active"
                            }
                            onClick={() =>
                              void updateShiftStatus(shift.id, "complete")
                            }
                          >
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                            Complete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="route-planner" className="space-y-4">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Route Planner (Preview)</CardTitle>
            <CardDescription>
              Generate route optimization previews before creating draft routes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="plan_route_date">Route Date</Label>
              <Input
                id="plan_route_date"
                type="date"
                value={routePlanForm.route_date}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    route_date: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Depot</Label>
              <Select
                value={routePlanForm.depot_id}
                onValueChange={(value) =>
                  setRoutePlanForm((prev) => ({ ...prev, depot_id: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Auto by context" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Auto / none</SelectItem>
                  {depots.map((depot) => (
                    <SelectItem key={depot.id} value={String(depot.id)}>
                      {depot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Driver</Label>
              <Select
                value={routePlanForm.driver_user_id}
                onValueChange={(value) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    driver_user_id: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Any driver</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={String(driver.id)}>
                      {driver.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="plan_max_stops">Max Stops</Label>
              <Input
                id="plan_max_stops"
                value={routePlanForm.max_stops}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    max_stops: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="plan_min_fill">Min Fill %</Label>
              <Input
                id="plan_min_fill"
                value={routePlanForm.min_fill_pct}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    min_fill_pct: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="plan_shift_minutes">Shift Minutes</Label>
              <Input
                id="plan_shift_minutes"
                value={routePlanForm.target_shift_minutes}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    target_shift_minutes: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="plan_speed">Avg Speed (kmph)</Label>
              <Input
                id="plan_speed"
                value={routePlanForm.avg_speed_kmph}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    avg_speed_kmph: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="plan_service_mins">Service mins/stop</Label>
              <Input
                id="plan_service_mins"
                value={routePlanForm.service_minutes_per_stop}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    service_minutes_per_stop: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="include_bin_ids">Include Bin IDs (csv)</Label>
              <Input
                id="include_bin_ids"
                value={routePlanForm.include_bin_ids}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    include_bin_ids: event.target.value,
                  }))
                }
                placeholder="101,105,108"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="vehicle_ids">
                Vehicle IDs for Multi-Vehicle (csv)
              </Label>
              <Input
                id="vehicle_ids"
                value={routePlanForm.vehicle_ids}
                onChange={(event) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    vehicle_ids: event.target.value,
                  }))
                }
                placeholder="9,12"
              />
            </div>

            <div className="space-y-1">
              <Label>Overflow Only</Label>
              <Select
                value={routePlanForm.overflow_only}
                onValueChange={(value) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    overflow_only: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">false</SelectItem>
                  <SelectItem value="true">true</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Use Multi Vehicle</Label>
              <Select
                value={routePlanForm.use_multi_vehicle}
                onValueChange={(value) =>
                  setRoutePlanForm((prev) => ({
                    ...prev,
                    use_multi_vehicle: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">false</SelectItem>
                  <SelectItem value="true">true</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="sm:col-span-2 lg:col-span-4">
              <Button
                onClick={() => void runRoutePlan()}
                disabled={globalActionKey === "route-plan"}
              >
                <MapPinned className="mr-1 h-4 w-4" />
                Generate Plan
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Plan Result</CardTitle>
            <CardDescription>
              Latest optimization preview output.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!routePlanResult ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No route plan generated yet.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Algorithm</p>
                    <p className="font-medium text-slate-900">
                      {routePlanResult.algorithm}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Selected Stops</p>
                    <p className="font-medium text-slate-900">
                      {routePlanResult.selected_stops}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Distance</p>
                    <p className="font-medium text-slate-900">
                      {routePlanResult.estimated_distance_km.toFixed(2)} km
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Duration</p>
                    <p className="font-medium text-slate-900">
                      {routePlanResult.estimated_duration_min.toFixed(1)} min
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Recommended Start</p>
                    <p className="font-medium text-slate-900">
                      {formatDateTime(routePlanResult.recommended_start_at)}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Baseline Distance</p>
                    <p className="font-medium text-slate-900">
                      {routePlanResult.baseline_distance_km != null
                        ? `${routePlanResult.baseline_distance_km.toFixed(2)} km`
                        : "n/a"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">
                      Estimated Fuel Saved
                    </p>
                    <p className="font-medium text-slate-900">
                      {routePlanResult.estimated_fuel_saved_liters != null
                        ? `${routePlanResult.estimated_fuel_saved_liters.toFixed(2)} L`
                        : "n/a"}
                    </p>
                  </div>
                </div>

                {routePlanResult.efficiency_reasoning.length > 0 ? (
                  <div className="rounded-lg border bg-emerald-50/80 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Why This Plan Is Efficient
                    </p>
                    <ul className="space-y-1 text-sm text-emerald-900">
                      {routePlanResult.efficiency_reasoning.map((reason) => (
                        <li key={reason}>- {reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Seq</TableHead>
                      <TableHead>Bin</TableHead>
                      <TableHead>Fill %</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Leg km</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {routePlanResult.items.map((item) => (
                      <TableRow key={`${item.stop_sequence}-${item.bin_id}`}>
                        <TableCell>{item.stop_sequence}</TableCell>
                        <TableCell>{item.bin_code}</TableCell>
                        <TableCell>
                          {item.fill_pct != null
                            ? item.fill_pct.toFixed(1)
                            : "n/a"}
                        </TableCell>
                        <TableCell>{item.priority_score.toFixed(2)}</TableCell>
                        <TableCell>{item.planned_leg_km.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="routes" className="space-y-4">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Automatic Intelligent Planner</CardTitle>
            <CardDescription>
              Continuously monitors live bins and drafts efficient routes by
              depot/service context.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!autoPlanResult ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Auto-planner has not reported a run in this session.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Route Date</p>
                    <p className="font-medium text-slate-900">
                      {autoPlanResult.route_date}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Drafts Created</p>
                    <p className="font-medium text-slate-900">
                      {autoPlanResult.created_count}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Skipped Clusters</p>
                    <p className="font-medium text-slate-900">
                      {autoPlanResult.skipped_count}
                    </p>
                  </div>
                </div>
                {autoPlanResult.reasons.length > 0 ? (
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Auto-Plan Decisions
                    </p>
                    <ul className="space-y-1 text-sm text-slate-800">
                      {autoPlanResult.reasons.slice(0, 6).map((reason) => (
                        <li key={reason}>- {reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Create Draft Route</CardTitle>
            <CardDescription>
              Persist a draft route from manually chosen ordered bin stops.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="route_code">Route Code</Label>
              <Input
                id="route_code"
                value={routeDraftForm.route_code}
                onChange={(event) =>
                  setRouteDraftForm((prev) => ({
                    ...prev,
                    route_code: event.target.value,
                  }))
                }
                placeholder="ROUTE-2026-04-18-N01"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="route_date">Route Date</Label>
              <Input
                id="route_date"
                type="date"
                value={routeDraftForm.route_date}
                onChange={(event) =>
                  setRouteDraftForm((prev) => ({
                    ...prev,
                    route_date: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>Depot</Label>
              <Select
                value={routeDraftForm.depot_id}
                onValueChange={(value) =>
                  setRouteDraftForm((prev) => ({ ...prev, depot_id: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {depots.map((depot) => (
                    <SelectItem key={depot.id} value={String(depot.id)}>
                      {depot.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Driver (optional)</Label>
              <Select
                value={routeDraftForm.driver_user_id}
                onValueChange={(value) =>
                  setRouteDraftForm((prev) => ({
                    ...prev,
                    driver_user_id: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={String(driver.id)}>
                      {driver.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="stop_bin_ids">Stop Bin IDs (ordered csv)</Label>
              <Textarea
                id="stop_bin_ids"
                value={routeDraftForm.stop_bin_ids}
                onChange={(event) =>
                  setRouteDraftForm((prev) => ({
                    ...prev,
                    stop_bin_ids: event.target.value,
                  }))
                }
                placeholder="101,105,108,112"
              />
              <p className="text-xs text-muted-foreground">
                Available bins:{" "}
                {bins
                  .slice(0, 20)
                  .map((bin) => `${bin.id}:${bin.bin_code}`)
                  .join(", ")}
                {bins.length > 20 ? " ..." : ""}
              </p>
            </div>

            <div className="sm:col-span-2 lg:col-span-4">
              <Button
                onClick={() => void createRouteDraft()}
                disabled={globalActionKey === "route-create"}
              >
                <GitBranchPlus className="mr-1 h-4 w-4" />
                Create Draft Route
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Routes Lifecycle</CardTitle>
              <CardDescription>
                Publish, start, complete, and choose route context for
                assignments/stops.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select
                value={routeStatusFilter}
                onValueChange={setRouteStatusFilter}
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="draft">draft</SelectItem>
                  <SelectItem value="published">published</SelectItem>
                  <SelectItem value="in_progress">in_progress</SelectItem>
                  <SelectItem value="completed">completed</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={routeDateFilter}
                onChange={(event) => setRouteDateFilter(event.target.value)}
                className="w-44"
              />
            </div>
          </CardHeader>
          <CardContent>
            {filteredRoutes.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No routes match the current filter.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Depot</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Stops</TableHead>
                    <TableHead>Start</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoutes.map((route) => (
                    <TableRow key={route.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{route.route_code}</span>
                          {route.auto_generated ? (
                            <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                              auto
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{route.route_date}</TableCell>
                      <TableCell>
                        {route.depot_id != null
                          ? (depotNameById.get(route.depot_id) ??
                            `Depot ${route.depot_id}`)
                          : "n/a"}
                      </TableCell>
                      <TableCell>{route.status}</TableCell>
                      <TableCell>{route.stops_count ?? "n/a"}</TableCell>
                      <TableCell>
                        {formatDateTime(
                          route.optimization_summary?.recommended_start_at ??
                            null,
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedRouteId(route.id)}
                          >
                            Use Context
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              globalActionKey === `route-publish-${route.id}` ||
                              route.status !== "draft"
                            }
                            onClick={() =>
                              void routeTransition(route.id, "publish")
                            }
                          >
                            Confirm Plan
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              globalActionKey === `route-start-${route.id}` ||
                              route.status !== "published"
                            }
                            onClick={() =>
                              void routeTransition(route.id, "start")
                            }
                          >
                            Start
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              globalActionKey ===
                                `route-complete-${route.id}` ||
                              route.status !== "in_progress"
                            }
                            onClick={() =>
                              void routeTransition(route.id, "complete")
                            }
                          >
                            Complete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Selected Route Intelligence</CardTitle>
            <CardDescription>
              Efficiency rationale, recommended dispatch time, and planned path
              map.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedRoute ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Select a route from the lifecycle table to view intelligent
                planning details and map.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Route</p>
                    <p className="font-medium text-slate-900">
                      {selectedRoute.route_code}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Planner</p>
                    <p className="font-medium text-slate-900">
                      {selectedRoute.optimization_summary?.planner_type ??
                        "manual"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Recommended Start</p>
                    <p className="font-medium text-slate-900">
                      {formatDateTime(
                        selectedRoute.optimization_summary
                          ?.recommended_start_at ?? null,
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Estimated Distance</p>
                    <p className="font-medium text-slate-900">
                      {selectedRoute.optimization_summary
                        ?.estimated_distance_km != null
                        ? `${selectedRoute.optimization_summary.estimated_distance_km.toFixed(2)} km`
                        : selectedRoute.total_distance_km != null
                          ? `${selectedRoute.total_distance_km.toFixed(2)} km`
                          : "n/a"}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Fuel Saved</p>
                    <p className="font-medium text-slate-900">
                      {selectedRoute.optimization_summary
                        ?.estimated_fuel_saved_liters != null
                        ? `${selectedRoute.optimization_summary.estimated_fuel_saved_liters.toFixed(2)} L`
                        : "n/a"}
                    </p>
                  </div>
                </div>

                {selectedRoute.optimization_summary?.efficiency_reasoning
                  ?.length ? (
                  <div className="rounded-lg border bg-emerald-50/80 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Why This Is Efficient
                    </p>
                    <ul className="space-y-1 text-sm text-emerald-900">
                      {selectedRoute.optimization_summary.efficiency_reasoning.map(
                        (reason) => (
                          <li key={reason}>- {reason}</li>
                        ),
                      )}
                    </ul>
                  </div>
                ) : null}

                <div className="h-90 overflow-hidden rounded-xl border bg-white">
                  <MapContainer
                    center={selectedRouteMapCenter}
                    zoom={13}
                    scrollWheelZoom={false}
                    className="h-full w-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {selectedRoutePathPolyline.length > 0 ? (
                      <RouteMapBounds points={selectedRoutePathPolyline} />
                    ) : null}
                    {selectedRoutePathPolyline.length > 1 ? (
                      <Polyline
                        positions={selectedRoutePathPolyline}
                        pathOptions={{
                          color: "#0f766e",
                          weight: 4,
                          opacity: 0.75,
                        }}
                      />
                    ) : null}
                    {selectedRoutePolyline.map((point, index) => (
                      <CircleMarker
                        key={`${point[0]}-${point[1]}-${index}`}
                        center={point}
                        radius={8}
                        pathOptions={{
                          color: "#0f766e",
                          fillColor: "#14b8a6",
                          fillOpacity: 0.65,
                          weight: 2,
                        }}
                      >
                        <Tooltip>Stop {index + 1}</Tooltip>
                      </CircleMarker>
                    ))}
                    {selectedRoute?.start_point?.latitude != null &&
                    selectedRoute?.start_point?.longitude != null ? (
                      <CircleMarker
                        center={[
                          selectedRoute.start_point.latitude,
                          selectedRoute.start_point.longitude,
                        ]}
                        radius={10}
                        pathOptions={{
                          color: "#1d4ed8",
                          fillColor: "#60a5fa",
                          fillOpacity: 0.7,
                          weight: 2,
                        }}
                      >
                        <Tooltip>Start Depot / Start Point</Tooltip>
                      </CircleMarker>
                    ) : null}
                  </MapContainer>
                </div>

                <p className="text-xs text-slate-500">
                  {selectedRoutePathLoading
                    ? "Snapping path to real road network..."
                    : selectedRoutePathSource === "road"
                      ? "Showing road-following route path (OSRM free routing)."
                      : "Road path unavailable, showing direct fallback path."}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="assignments" className="space-y-4">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Route Context</CardTitle>
            <CardDescription>
              Choose a route for assignment management.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>Selected Route</Label>
              <Select
                value={
                  selectedRouteId != null ? String(selectedRouteId) : "__none__"
                }
                onValueChange={(value) =>
                  setSelectedRouteId(
                    value === "__none__" ? null : Number.parseInt(value, 10),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select route" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No route selected</SelectItem>
                  {routes.map((route) => (
                    <SelectItem key={route.id} value={String(route.id)}>
                      {route.route_code} ({route.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                disabled={selectedRouteId == null}
                onClick={() => {
                  if (selectedRouteId != null) {
                    void fetchAssignmentsForRoute(selectedRouteId);
                  }
                }}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Refresh Assignments
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Create Assignment</CardTitle>
            <CardDescription>
              Assign one driver and optional vehicle to selected route.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label>Driver</Label>
              <Select
                value={assignmentCreateForm.driver_user_id}
                onValueChange={(value) =>
                  setAssignmentCreateForm((prev) => ({
                    ...prev,
                    driver_user_id: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select driver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select driver</SelectItem>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={String(driver.id)}>
                      {driver.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Vehicle (optional)</Label>
              <Select
                value={assignmentCreateForm.vehicle_id}
                onValueChange={(value) =>
                  setAssignmentCreateForm((prev) => ({
                    ...prev,
                    vehicle_id: value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vehicle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned vehicle</SelectItem>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={String(vehicle.id)}>
                      {vehicle.vehicle_no}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={() => void createAssignment()}
                disabled={
                  globalActionKey === "assignment-create" ||
                  selectedRouteId == null
                }
              >
                <Send className="mr-1 h-4 w-4" />
                Create Assignment
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Assignments</CardTitle>
            <CardDescription>
              Accept or reject assignments when required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedRouteId == null ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Select a route to view assignments.
              </p>
            ) : assignmentsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : assignments.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No assignments for this route.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map((assignment) => (
                    <TableRow key={assignment.id}>
                      <TableCell className="font-medium">
                        #{assignment.id}
                      </TableCell>
                      <TableCell>
                        {driverNameById.get(assignment.driver_user_id) ??
                          `User ${assignment.driver_user_id}`}
                      </TableCell>
                      <TableCell>
                        {assignment.vehicle_id != null
                          ? (vehicleNoById.get(assignment.vehicle_id) ??
                            `Vehicle ${assignment.vehicle_id}`)
                          : "unassigned"}
                      </TableCell>
                      <TableCell>{assignment.status}</TableCell>
                      <TableCell>
                        {formatDateTime(assignment.assigned_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              assignment.status !== "assigned" ||
                              globalActionKey ===
                                `assignment-accept-${assignment.id}`
                            }
                            onClick={() =>
                              void assignmentTransition(assignment.id, "accept")
                            }
                          >
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              assignment.status !== "assigned" ||
                              globalActionKey ===
                                `assignment-reject-${assignment.id}`
                            }
                            onClick={() =>
                              void assignmentTransition(assignment.id, "reject")
                            }
                          >
                            <PauseCircle className="mr-1 h-4 w-4" />
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="stops" className="space-y-4">
        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Route Context</CardTitle>
            <CardDescription>
              Choose a route to monitor and update stops.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <Label>Selected Route</Label>
              <Select
                value={
                  selectedRouteId != null ? String(selectedRouteId) : "__none__"
                }
                onValueChange={(value) =>
                  setSelectedRouteId(
                    value === "__none__" ? null : Number.parseInt(value, 10),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select route" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No route selected</SelectItem>
                  {routes.map((route) => (
                    <SelectItem key={route.id} value={String(route.id)}>
                      {route.route_code} ({route.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                disabled={selectedRouteId == null}
                onClick={() => {
                  if (selectedRouteId != null) {
                    void fetchStopsForRoute(selectedRouteId);
                  }
                }}
              >
                <RefreshCw className="mr-1 h-4 w-4" />
                Refresh Stops
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
          <CardHeader>
            <CardTitle>Route Stops</CardTitle>
            <CardDescription>
              Arrive, service, or skip stops with idempotent requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedRouteId == null ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                Select a route to view stops.
              </p>
            ) : stopsLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : stops.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                No stops found for selected route.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seq</TableHead>
                    <TableHead>Bin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Planned ETA</TableHead>
                    <TableHead>Actual Arrival</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stops.map((stop) => (
                    <TableRow key={stop.id}>
                      <TableCell className="font-medium">
                        {stop.stop_sequence}
                      </TableCell>
                      <TableCell>
                        {binCodeById.get(stop.bin_id) ?? `Bin ${stop.bin_id}`}
                      </TableCell>
                      <TableCell>{stop.status}</TableCell>
                      <TableCell>{formatDateTime(stop.planned_eta)}</TableCell>
                      <TableCell>
                        {formatDateTime(stop.actual_arrival)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              (stop.status !== "pending" &&
                                stop.status !== "arrived") ||
                              globalActionKey === `stop-arrive-${stop.id}`
                            }
                            onClick={() =>
                              void stopTransition(stop.id, "arrive")
                            }
                          >
                            <PlayCircle className="mr-1 h-4 w-4" />
                            Arrive
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              (stop.status !== "arrived" &&
                                stop.status !== "pending") ||
                              globalActionKey === `stop-service-${stop.id}`
                            }
                            onClick={() =>
                              void stopTransition(stop.id, "service")
                            }
                          >
                            <CheckCircle2 className="mr-1 h-4 w-4" />
                            Service
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              stop.status === "serviced" ||
                              stop.status === "skipped" ||
                              globalActionKey === `stop-skip-${stop.id}`
                            }
                            onClick={() => void stopTransition(stop.id, "skip")}
                          >
                            <SkipForward className="mr-1 h-4 w-4" />
                            Skip
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export default OperatorOperationsPanel;
