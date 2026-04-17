import { useEffect, useMemo } from 'react'
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { DataRow, RouteStop } from '@/types/dashboard'

type BinMapProps = {
  rows: DataRow[]
  routeStops?: RouteStop[]
  title?: string
}

type MapPoint = {
  binId: string
  latitude: number
  longitude: number
  location: string
  ward: string
  fill: number
  status: string
  priority: number
}

function MapBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap()

  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [36, 36] })
    }
  }, [map, points])

  return null
}

function fillColor(status: string) {
  const value = status.toLowerCase()
  if (value.includes('low')) return '#34d399'
  if (value.includes('medium')) return '#fbbf24'
  return '#f87171'
}

function BinMap({ rows, routeStops, title = 'Dustbin Map View' }: BinMapProps) {
  const points = useMemo<MapPoint[]>(() => {
    return rows
      .map((row) => ({
        binId: String(row.Bin_ID ?? ''),
        latitude: Number(row.Latitude ?? 0),
        longitude: Number(row.Longitude ?? 0),
        location: String(row.Location ?? 'Unknown location'),
        ward: String(row.Ward ?? 'Unknown ward'),
        fill: Number(row['Fill%'] ?? 0),
        status: String(row.Status ?? 'Unknown'),
        priority: Number(row.Priority ?? 0),
      }))
      .filter((point) => point.latitude !== 0 && point.longitude !== 0)
  }, [rows])

  const routePath = useMemo<Array<[number, number]>>(() => {
    if (!routeStops?.length) return []

    return routeStops
      .map((stop) => [Number(stop.Latitude ?? 0), Number(stop.Longitude ?? 0)] as [number, number])
      .filter(([lat, lng]) => lat !== 0 && lng !== 0)
  }, [routeStops])

  const center: [number, number] = points.length > 0 ? [points[0].latitude, points[0].longitude] : [12.9716, 77.5946]

  const bounds = points.map((point) => [point.latitude, point.longitude] as [number, number])

  return (
    <Card className="border-white/70 bg-white/80 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[440px] overflow-hidden rounded-2xl border">
          <MapContainer center={center} zoom={13} className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {bounds.length > 0 ? <MapBounds points={bounds} /> : null}

            {routePath.length > 1 ? (
              <Polyline positions={routePath} pathOptions={{ color: '#0f766e', weight: 4, opacity: 0.7 }} />
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
                <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent>
                  <span className="text-xs font-semibold text-slate-800">{point.binId}</span>
                </Tooltip>
                <Popup>
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-slate-900">{point.binId}</p>
                    <p>{point.location}</p>
                    <p>{point.ward}</p>
                    <p>Status: {point.status}</p>
                    <p>Fill: {point.fill.toFixed(1)}%</p>
                    <p>Priority: {point.priority.toFixed(2)}</p>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export default BinMap
