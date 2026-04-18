import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CollectionCenter, DataRow, RouteStop } from "@/types/dashboard";

type BinMapProps = {
  rows: DataRow[];
  collectionCenters?: CollectionCenter[];
  routeStops?: RouteStop[];
  title?: string;
  heightClassName?: string;
  scrollWheelZoom?: boolean;
  onMapClick?: (latitude: number, longitude: number) => void;
  selectedPoint?: [number, number] | null;
};

type MapPoint = {
  binId: string;
  latitude: number;
  longitude: number;
  location: string;
  ward: string;
  fill: number;
  status: string;
  priority: number;
};

function MapBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [36, 36] });
    }
  }, [map, points]);

  return null;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick?: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click(event) {
      if (onMapClick) {
        onMapClick(event.latlng.lat, event.latlng.lng);
      }
    },
  });

  return null;
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

function fillColor(status: string) {
  const value = status.toLowerCase();
  if (value.includes("low")) return "#22c55e";
  if (value.includes("medium")) return "#facc15";
  return "#ef4444";
}

function BinMap({
  rows,
  collectionCenters,
  routeStops,
  title = "Dustbin Map View",
  heightClassName = "h-[440px]",
  scrollWheelZoom = false,
  onMapClick,
  selectedPoint,
}: BinMapProps) {
  const points = useMemo<MapPoint[]>(() => {
    return rows
      .map((row) => ({
        binId: String(row.Bin_ID ?? ""),
        latitude: Number(row.Latitude ?? 0),
        longitude: Number(row.Longitude ?? 0),
        location: String(row.Location ?? "Unknown location"),
        ward: String(row.Ward ?? "Unknown ward"),
        fill: Number(row["Fill%"] ?? 0),
        status: String(row.Status ?? "Unknown"),
        priority: Number(row.Priority ?? 0),
      }))
      .filter((point) => point.latitude !== 0 && point.longitude !== 0);
  }, [rows]);

  const routePath = useMemo<Array<[number, number]>>(() => {
    if (!routeStops?.length) return [];

    return routeStops
      .map(
        (stop) =>
          [Number(stop.Latitude ?? 0), Number(stop.Longitude ?? 0)] as [
            number,
            number,
          ],
      )
      .filter(([lat, lng]) => lat !== 0 && lng !== 0);
  }, [routeStops]);

  const centerPoints = useMemo(() => {
    return (collectionCenters ?? [])
      .map((center) => ({
        centerId: String(center.Center_ID ?? ""),
        name: String(center.Name ?? "Collection Center"),
        ward: String(center.Ward ?? "Unknown ward"),
        address: String(center.Address ?? ""),
        latitude: Number(center.Latitude ?? 0),
        longitude: Number(center.Longitude ?? 0),
      }))
      .filter((center) => center.latitude !== 0 && center.longitude !== 0);
  }, [collectionCenters]);

  const center: [number, number] =
    points.length > 0
      ? [points[0].latitude, points[0].longitude]
      : [12.9716, 77.5946];

  const bounds = points.map(
    (point) => [point.latitude, point.longitude] as [number, number],
  );
  const centerBounds = centerPoints.map(
    (centerPoint) =>
      [centerPoint.latitude, centerPoint.longitude] as [number, number],
  );

  return (
    <Card className="border-white/70 bg-white/80 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`${heightClassName} overflow-hidden rounded-2xl border`}
        >
          <MapContainer
            center={center}
            zoom={13}
            scrollWheelZoom={scrollWheelZoom}
            className="h-full w-full"
          >
            <MapResizeHandler />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {bounds.length > 0 || centerBounds.length > 0 ? (
              <MapBounds points={[...bounds, ...centerBounds]} />
            ) : null}
            {onMapClick ? <MapClickHandler onMapClick={onMapClick} /> : null}

            {routePath.length > 1 ? (
              <Polyline
                positions={routePath}
                pathOptions={{ color: "#0f766e", weight: 4, opacity: 0.7 }}
              />
            ) : null}

            {points.map((point) => (
              <CircleMarker
                key={point.binId}
                center={[point.latitude, point.longitude]}
                radius={11}
                pathOptions={{
                  color: fillColor(point.status),
                  fillColor: fillColor(point.status),
                  fillOpacity: 0.65,
                  weight: 2,
                }}
              >
                <Tooltip
                  direction="top"
                  offset={[0, -8]}
                  opacity={1}
                  permanent={false}
                >
                  <div className="space-y-0.5 text-xs text-slate-800">
                    <p className="font-semibold">{point.binId}</p>
                    <p>{point.location}</p>
                    <p>Fill: {point.fill.toFixed(1)}%</p>
                    <p>Status: {point.status}</p>
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}

            {centerPoints.map((centerPoint) => (
              <CircleMarker
                key={centerPoint.centerId}
                center={[centerPoint.latitude, centerPoint.longitude]}
                radius={13}
                pathOptions={{
                  color: "#7c3aed",
                  fillColor: "#8b5cf6",
                  fillOpacity: 0.55,
                  weight: 2,
                }}
              >
                <Tooltip
                  direction="top"
                  offset={[0, -8]}
                  opacity={1}
                  permanent={false}
                >
                  <div className="space-y-0.5 text-xs text-slate-800">
                    <p className="font-semibold">{centerPoint.centerId}</p>
                    <p>{centerPoint.name}</p>
                    <p>{centerPoint.address || "No address provided"}</p>
                    <p>Fill: N/A (Collection Center)</p>
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}

            {selectedPoint ? (
              <CircleMarker
                center={selectedPoint}
                radius={14}
                pathOptions={{
                  color: "#2563eb",
                  fillColor: "#60a5fa",
                  fillOpacity: 0.35,
                  weight: 3,
                }}
              />
            ) : null}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default BinMap;
