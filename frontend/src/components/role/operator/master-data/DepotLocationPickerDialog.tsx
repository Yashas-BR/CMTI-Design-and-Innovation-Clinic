import { useEffect, useMemo, useState } from "react";

import {
  CircleMarker,
  MapContainer,
  Polygon,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type {
  DepotRecord,
  ServiceAreaRecord,
} from "@/components/role/operator/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DepotLocationPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPoint: [number, number] | null;
  existingDepots: DepotRecord[];
  existingServiceAreas: ServiceAreaRecord[];
  currentDepotId?: number | null;
  onApply: (latitude: number, longitude: number) => void;
};

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

function extractRawRing(candidate: unknown): unknown[] | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const shape = candidate as {
    type?: string;
    coordinates?: unknown;
    geometry?: unknown;
    features?: unknown;
  };

  if (shape.type === "Feature") {
    return extractRawRing(shape.geometry);
  }

  if (shape.type === "FeatureCollection") {
    const features = Array.isArray(shape.features) ? shape.features : [];
    for (const feature of features) {
      const ring = extractRawRing(feature);
      if (ring) {
        return ring;
      }
    }
    return null;
  }

  let rawRing: unknown[] | null = null;
  if (shape.type === "Polygon") {
    const coordinates = Array.isArray(shape.coordinates)
      ? shape.coordinates
      : null;
    if (!coordinates || !Array.isArray(coordinates[0])) {
      return null;
    }
    rawRing = coordinates[0] as unknown[];
  } else if (shape.type === "MultiPolygon") {
    const coordinates = Array.isArray(shape.coordinates)
      ? shape.coordinates
      : null;
    if (
      !coordinates ||
      !Array.isArray(coordinates[0]) ||
      !Array.isArray((coordinates[0] as unknown[])[0])
    ) {
      return null;
    }
    rawRing = (coordinates[0] as unknown[])[0] as unknown[];
  }

  return rawRing;
}

function parseBoundaryPoints(
  boundaryGeoJson: Record<string, unknown> | null,
): [number, number][] {
  if (!boundaryGeoJson) {
    return [];
  }

  const rawRing = extractRawRing(boundaryGeoJson);

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

function MapBounds({ points }: { points: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) {
      return;
    }

    map.fitBounds(points, { padding: [36, 36] });
  }, [map, points]);

  return null;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (point: [number, number]) => void;
}) {
  useMapEvents({
    click(event) {
      onMapClick([event.latlng.lat, event.latlng.lng]);
    },
  });

  return null;
}

function DepotLocationPickerDialog({
  open,
  onOpenChange,
  selectedPoint,
  existingDepots,
  existingServiceAreas,
  currentDepotId,
  onApply,
}: DepotLocationPickerDialogProps) {
  const [draftPoint, setDraftPoint] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (open) {
      setDraftPoint(selectedPoint);
    }
  }, [open, selectedPoint]);

  const selectedText = useMemo(() => {
    if (!draftPoint) {
      return "Click the map to choose coordinates.";
    }
    return `${draftPoint[0].toFixed(6)}, ${draftPoint[1].toFixed(6)}`;
  }, [draftPoint]);

  const referenceDepotPoints = useMemo(() => {
    return existingDepots
      .filter((depot) => depot.id !== currentDepotId)
      .map((depot) => {
        if (depot.latitude == null || depot.longitude == null) {
          return null;
        }
        return {
          id: depot.id,
          name: depot.name,
          isActive: depot.is_active,
          point: [depot.latitude, depot.longitude] as [number, number],
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [currentDepotId, existingDepots]);

  const referenceAreaPolygons = useMemo(() => {
    return existingServiceAreas
      .map((area) => ({
        id: area.id,
        name: area.name,
        isActive: area.is_active,
        points: parseBoundaryPoints(area.boundary_geojson),
      }))
      .filter((area) => area.points.length >= 3);
  }, [existingServiceAreas]);

  const referenceAreaCenters = useMemo(() => {
    return existingServiceAreas
      .map((area) => {
        if (area.center_latitude == null || area.center_longitude == null) {
          return null;
        }
        return {
          id: area.id,
          name: area.name,
          isActive: area.is_active,
          point: [area.center_latitude, area.center_longitude] as [
            number,
            number,
          ],
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [existingServiceAreas]);

  const boundsPoints = useMemo<[number, number][]>(() => {
    const points: [number, number][] = [];
    for (const depot of referenceDepotPoints) {
      points.push(depot.point);
    }
    for (const area of referenceAreaPolygons) {
      points.push(...area.points);
    }
    for (const area of referenceAreaCenters) {
      points.push(area.point);
    }
    if (draftPoint) {
      points.push(draftPoint);
    }
    return points;
  }, [
    draftPoint,
    referenceAreaCenters,
    referenceAreaPolygons,
    referenceDepotPoints,
  ]);

  const centerForMap = useMemo<[number, number]>(() => {
    if (draftPoint) {
      return draftPoint;
    }
    if (referenceDepotPoints.length > 0) {
      return referenceDepotPoints[0].point;
    }
    if (referenceAreaCenters.length > 0) {
      return referenceAreaCenters[0].point;
    }
    if (referenceAreaPolygons.length > 0) {
      return referenceAreaPolygons[0].points[0];
    }
    return [12.9716, 77.5946];
  }, [
    draftPoint,
    referenceAreaCenters,
    referenceAreaPolygons,
    referenceDepotPoints,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[88vh] w-[95vw] max-w-[calc(100vw-1.5rem)] overflow-y-auto sm:w-[92vw] sm:max-w-300">
        <DialogHeader>
          <DialogTitle>Select Depot Coordinates</DialogTitle>
          <DialogDescription>
            Click anywhere on the map to set latitude and longitude. Existing
            depots and service area boundaries are shown as references.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Selected: {selectedText}
        </p>

        <div className="h-85 overflow-hidden rounded-2xl border sm:h-107.5 lg:h-140">
          <MapContainer
            center={centerForMap}
            zoom={13}
            scrollWheelZoom={false}
            className="h-full w-full"
          >
            <MapResizeHandler />
            <MapBounds points={boundsPoints} />
            <MapClickHandler onMapClick={setDraftPoint} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {referenceAreaPolygons.map((area) => (
              <Polygon
                key={area.id}
                positions={area.points}
                pathOptions={{
                  color: area.isActive ? "#0f766e" : "#64748b",
                  fillColor: area.isActive ? "#2dd4bf" : "#94a3b8",
                  fillOpacity: 0.12,
                  weight: 2,
                  dashArray: area.isActive ? "" : "5, 7",
                }}
              >
                <Tooltip sticky>
                  {area.name} ({area.isActive ? "active" : "inactive"})
                </Tooltip>
              </Polygon>
            ))}

            {referenceAreaCenters.map((area) => (
              <CircleMarker
                key={`area-center-${area.id}`}
                center={area.point}
                radius={4}
                pathOptions={{
                  color: area.isActive ? "#0f766e" : "#64748b",
                  fillColor: area.isActive ? "#2dd4bf" : "#94a3b8",
                  fillOpacity: 0.75,
                  weight: 2,
                }}
              >
                <Tooltip sticky>
                  {area.name} center ({area.point[0].toFixed(5)},{" "}
                  {area.point[1].toFixed(5)})
                </Tooltip>
              </CircleMarker>
            ))}

            {referenceDepotPoints.map((depot) => (
              <CircleMarker
                key={depot.id}
                center={depot.point}
                radius={6}
                pathOptions={{
                  color: depot.isActive ? "#065f46" : "#475569",
                  fillColor: depot.isActive ? "#10b981" : "#94a3b8",
                  fillOpacity: 0.6,
                  weight: 2,
                }}
              >
                <Tooltip sticky>
                  {depot.name} ({depot.isActive ? "active" : "inactive"}) ({" "}
                  {depot.point[0].toFixed(5)}, {depot.point[1].toFixed(5)})
                </Tooltip>
              </CircleMarker>
            ))}

            {draftPoint ? (
              <CircleMarker
                center={draftPoint}
                radius={9}
                pathOptions={{
                  color: "#1d4ed8",
                  fillColor: "#60a5fa",
                  fillOpacity: 0.35,
                  weight: 3,
                }}
              >
                <Tooltip sticky>
                  Draft depot point ({draftPoint[0].toFixed(5)},{" "}
                  {draftPoint[1].toFixed(5)})
                </Tooltip>
              </CircleMarker>
            ) : null}
          </MapContainer>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!draftPoint) {
                return;
              }
              onApply(draftPoint[0], draftPoint[1]);
              onOpenChange(false);
            }}
            disabled={!draftPoint}
          >
            Use This Location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DepotLocationPickerDialog;
