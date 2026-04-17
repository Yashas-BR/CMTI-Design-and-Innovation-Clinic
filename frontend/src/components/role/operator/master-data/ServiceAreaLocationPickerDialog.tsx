import { useEffect, useMemo, useState } from "react";

import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ServiceAreaLocationPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPoint: [number, number] | null;
  initialBoundaryGeoJson: string;
  onApply: (payload: {
    center: [number, number] | null;
    boundaryGeoJson: string;
  }) => void;
};

type PickerMode = "center" | "boundary";

function isSamePoint(
  left: [number, number],
  right: [number, number],
  epsilon = 0.000001,
): boolean {
  return (
    Math.abs(left[0] - right[0]) <= epsilon &&
    Math.abs(left[1] - right[1]) <= epsilon
  );
}

function parseBoundaryPoints(boundaryGeoJson: string): [number, number][] {
  const text = boundaryGeoJson.trim();
  if (!text) {
    return [];
  }

  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const candidate = parsed as {
    type?: string;
    coordinates?: unknown;
  };

  let rawRing: unknown[] | null = null;
  if (candidate.type === "Polygon") {
    const coordinates = Array.isArray(candidate.coordinates)
      ? candidate.coordinates
      : null;
    if (!coordinates || !Array.isArray(coordinates[0])) {
      return [];
    }
    rawRing = coordinates[0] as unknown[];
  } else if (candidate.type === "MultiPolygon") {
    const coordinates = Array.isArray(candidate.coordinates)
      ? candidate.coordinates
      : null;
    if (
      !coordinates ||
      !Array.isArray(coordinates[0]) ||
      !Array.isArray((coordinates[0] as unknown[])[0])
    ) {
      return [];
    }
    rawRing = (coordinates[0] as unknown[])[0] as unknown[];
  }

  if (!rawRing) {
    return [];
  }

  const points: [number, number][] = [];
  for (const rawCoordinate of rawRing) {
    if (!Array.isArray(rawCoordinate) || rawCoordinate.length < 2) {
      continue;
    }

    const longitude = Number(rawCoordinate[0]);
    const latitude = Number(rawCoordinate[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }
    points.push([latitude, longitude]);
  }

  if (points.length >= 2 && isSamePoint(points[0], points[points.length - 1])) {
    points.pop();
  }

  return points;
}

function polygonGeoJsonFromPoints(points: [number, number][]): string {
  const ring = points.map(([latitude, longitude]) => [longitude, latitude]);
  const closedRing = [...ring, ring[0]];
  return JSON.stringify(
    {
      type: "Polygon",
      coordinates: [closedRing],
    },
    null,
    2,
  );
}

function polygonCenter(points: [number, number][]): [number, number] | null {
  if (points.length === 0) {
    return null;
  }
  const latitudeTotal = points.reduce((sum, point) => sum + point[0], 0);
  const longitudeTotal = points.reduce((sum, point) => sum + point[1], 0);
  return [latitudeTotal / points.length, longitudeTotal / points.length];
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const refreshSize = () => {
      map.invalidateSize();
    };

    const frame = window.requestAnimationFrame(refreshSize);
    const timeout = window.setTimeout(refreshSize, 180);

    const observer = new ResizeObserver(() => {
      refreshSize();
    });
    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

function MapBounds({
  points,
  center,
}: {
  points: [number, number][];
  center: [number, number] | null;
}) {
  const map = useMap();

  useEffect(() => {
    const boundsPoints = [...points];
    if (center) {
      boundsPoints.push(center);
    }

    if (boundsPoints.length === 0) {
      return;
    }

    map.fitBounds(boundsPoints, { padding: [36, 36] });
  }, [center, map, points]);

  return null;
}

function MapClickHandler({
  mode,
  onSetCenter,
  onAddBoundaryPoint,
}: {
  mode: PickerMode;
  onSetCenter: (point: [number, number]) => void;
  onAddBoundaryPoint: (point: [number, number]) => void;
}) {
  useMapEvents({
    click(event) {
      const point: [number, number] = [event.latlng.lat, event.latlng.lng];
      if (mode === "center") {
        onSetCenter(point);
        return;
      }
      onAddBoundaryPoint(point);
    },
  });

  return null;
}

function ServiceAreaLocationPickerDialog({
  open,
  onOpenChange,
  selectedPoint,
  initialBoundaryGeoJson,
  onApply,
}: ServiceAreaLocationPickerDialogProps) {
  const [mode, setMode] = useState<PickerMode>("boundary");
  const [draftPoint, setDraftPoint] = useState<[number, number] | null>(null);
  const [draftBoundaryPoints, setDraftBoundaryPoints] = useState<
    [number, number][]
  >([]);
  const [boundaryWarning, setBoundaryWarning] = useState("");
  const [boundaryWasCleared, setBoundaryWasCleared] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("boundary");
      setDraftPoint(selectedPoint);
      setBoundaryWasCleared(false);
      try {
        setDraftBoundaryPoints(parseBoundaryPoints(initialBoundaryGeoJson));
        setBoundaryWarning("");
      } catch {
        setDraftBoundaryPoints([]);
        setBoundaryWarning(
          "Current boundary GeoJSON could not be parsed for preview. You can draw a new boundary.",
        );
      }
    }
  }, [initialBoundaryGeoJson, open, selectedPoint]);

  const selectedCenterText = useMemo(() => {
    if (!draftPoint) {
      return "Click the map to choose area center coordinates.";
    }
    return `${draftPoint[0].toFixed(6)}, ${draftPoint[1].toFixed(6)}`;
  }, [draftPoint]);

  const centerForMap = useMemo<[number, number]>(() => {
    if (draftPoint) {
      return draftPoint;
    }
    if (draftBoundaryPoints.length > 0) {
      return draftBoundaryPoints[0];
    }
    return [12.9716, 77.5946];
  }, [draftBoundaryPoints, draftPoint]);

  const boundaryGeoJsonPreview = useMemo(() => {
    if (draftBoundaryPoints.length < 3) {
      if (boundaryWasCleared) {
        return "";
      }
      return initialBoundaryGeoJson.trim();
    }
    return polygonGeoJsonFromPoints(draftBoundaryPoints);
  }, [boundaryWasCleared, draftBoundaryPoints, initialBoundaryGeoJson]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[88vh] w-[95vw] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:w-[92vw] sm:max-w-300">
        <DialogHeader>
          <DialogTitle>Service Area Map Editor</DialogTitle>
          <DialogDescription>
            Draw boundary points and set area center using the interactive map.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mode === "boundary" ? "default" : "outline"}
            onClick={() => setMode("boundary")}
          >
            Draw Boundary
          </Button>
          <Button
            type="button"
            variant={mode === "center" ? "default" : "outline"}
            onClick={() => setMode("center")}
          >
            Set Center
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftBoundaryPoints((prev) => prev.slice(0, -1));
              setBoundaryWasCleared(false);
            }}
            disabled={draftBoundaryPoints.length === 0}
          >
            Undo Last Point
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftBoundaryPoints([]);
              setBoundaryWasCleared(true);
            }}
            disabled={
              draftBoundaryPoints.length === 0 && !initialBoundaryGeoJson.trim()
            }
          >
            Clear Boundary
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const center = polygonCenter(draftBoundaryPoints);
              if (center) {
                setDraftPoint(center);
              }
            }}
            disabled={draftBoundaryPoints.length < 3}
          >
            Center From Polygon
          </Button>
        </div>

        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Mode: {mode === "boundary" ? "Draw Boundary" : "Set Center"} | Center:{" "}
          {selectedCenterText}
        </p>

        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Boundary points: {draftBoundaryPoints.length} (minimum 3 to create
          polygon)
        </p>

        {boundaryWarning ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {boundaryWarning}
          </p>
        ) : null}

        <div className="h-85 overflow-hidden rounded-2xl border sm:h-107.5 lg:h-140">
          <MapContainer
            center={centerForMap}
            zoom={13}
            scrollWheelZoom={false}
            className="h-full w-full"
          >
            <MapResizeHandler />
            <MapBounds points={draftBoundaryPoints} center={draftPoint} />
            <MapClickHandler
              mode={mode}
              onSetCenter={setDraftPoint}
              onAddBoundaryPoint={(point) => {
                setDraftBoundaryPoints((prev) => [...prev, point]);
                setBoundaryWasCleared(false);
              }}
            />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {draftBoundaryPoints.length >= 3 ? (
              <Polygon
                positions={draftBoundaryPoints}
                pathOptions={{
                  color: "#0f766e",
                  fillColor: "#14b8a6",
                  fillOpacity: 0.2,
                  weight: 3,
                }}
              />
            ) : draftBoundaryPoints.length > 1 ? (
              <Polyline
                positions={draftBoundaryPoints}
                pathOptions={{
                  color: "#0f766e",
                  weight: 3,
                  dashArray: "5, 8",
                }}
              />
            ) : null}

            {draftBoundaryPoints.map((point, index) => (
              <CircleMarker
                key={`${point[0]}-${point[1]}-${index}`}
                center={point}
                radius={6}
                pathOptions={{
                  color: "#0f766e",
                  fillColor: "#14b8a6",
                  fillOpacity: 0.85,
                  weight: 2,
                }}
              />
            ))}

            {draftPoint ? (
              <CircleMarker
                center={draftPoint}
                radius={10}
                pathOptions={{
                  color: mode === "center" ? "#1d4ed8" : "#334155",
                  fillColor: mode === "center" ? "#60a5fa" : "#64748b",
                  fillOpacity: 0.35,
                  weight: 3,
                }}
              />
            ) : null}
          </MapContainer>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">
            Boundary GeoJSON Preview
          </p>
          <textarea
            readOnly
            value={boundaryGeoJsonPreview}
            className={cn(
              "min-h-28 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700",
              "focus:outline-none",
            )}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const hasDrawnPolygon = draftBoundaryPoints.length >= 3;
              const center = hasDrawnPolygon
                ? (polygonCenter(draftBoundaryPoints) ?? draftPoint)
                : draftPoint;

              if (!center) {
                return;
              }

              const boundaryGeoJson = hasDrawnPolygon
                ? polygonGeoJsonFromPoints(draftBoundaryPoints)
                : boundaryWasCleared
                  ? ""
                  : initialBoundaryGeoJson.trim();

              onApply({
                center,
                boundaryGeoJson,
              });
              onOpenChange(false);
            }}
            disabled={!draftPoint && draftBoundaryPoints.length < 3}
          >
            Use Map Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ServiceAreaLocationPickerDialog;
