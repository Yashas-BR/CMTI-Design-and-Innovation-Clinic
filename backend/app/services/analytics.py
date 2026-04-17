"""Analytics services for efficiency, savings, and environmental reporting."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from math import atan2, cos, radians, sin, sqrt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin, CollectionEvent, Depot, Route, RouteAssignment, RouteStop, Vehicle


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_window(from_ts: datetime, to_ts: datetime) -> tuple[datetime, datetime]:
    safe_from = from_ts if from_ts.tzinfo is not None else from_ts.replace(tzinfo=timezone.utc)
    safe_to = to_ts if to_ts.tzinfo is not None else to_ts.replace(tzinfo=timezone.utc)
    if safe_from > safe_to:
        raise ValueError("'from' must be earlier than or equal to 'to'")
    return safe_from, safe_to


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_km = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return radius_km * c


def _distance_roundtrip_km(start: tuple[float, float], stops: list[tuple[float, float]]) -> float:
    if not stops:
        return 0.0

    total = 0.0
    current_lat, current_lon = start
    for stop_lat, stop_lon in stops:
        total += _haversine_km(current_lat, current_lon, stop_lat, stop_lon)
        current_lat, current_lon = stop_lat, stop_lon
    total += _haversine_km(current_lat, current_lon, start[0], start[1])
    return total


def _distance_naive_star_km(start: tuple[float, float], stops: list[tuple[float, float]]) -> float:
    total = 0.0
    for stop_lat, stop_lon in stops:
        total += _haversine_km(start[0], start[1], stop_lat, stop_lon)
        total += _haversine_km(stop_lat, stop_lon, start[0], start[1])
    return total


def _fuel_l_per_km(vehicle_type: str | None) -> float:
    if not vehicle_type:
        return 0.33

    lowered = vehicle_type.strip().lower()
    if "ev" in lowered or "electric" in lowered:
        return 0.0
    if "compactor" in lowered:
        return 0.42
    if "tipper" in lowered:
        return 0.34
    if "mini" in lowered:
        return 0.24
    if "truck" in lowered:
        return 0.36
    return 0.33


async def get_efficiency_analytics(
    db: AsyncSession,
    org_id: int,
    *,
    from_ts: datetime,
    to_ts: datetime,
) -> dict[str, Any]:
    """Return collection efficiency metrics for a time window."""
    safe_from, safe_to = _normalize_window(from_ts, to_ts)

    row = (
        await db.execute(
            select(
                func.count(CollectionEvent.id),
                func.min(CollectionEvent.event_ts),
                func.max(CollectionEvent.event_ts),
            ).where(
                CollectionEvent.org_id == org_id,
                CollectionEvent.event_type == "serviced",
                CollectionEvent.event_ts >= safe_from,
                CollectionEvent.event_ts <= safe_to,
            )
        )
    ).one()

    total_collections = int(row[0] or 0)
    min_event_ts = row[1]
    max_event_ts = row[2]

    route_ids = [
        int(route_id)
        for route_id in (
            await db.execute(
                select(func.distinct(CollectionEvent.route_id)).where(
                    CollectionEvent.org_id == org_id,
                    CollectionEvent.event_type == "serviced",
                    CollectionEvent.event_ts >= safe_from,
                    CollectionEvent.event_ts <= safe_to,
                    CollectionEvent.route_id.is_not(None),
                )
            )
        ).scalars().all()
        if route_id is not None
    ]

    total_routes = 0
    total_distance_km = 0.0
    if route_ids:
        route_stats = (
            await db.execute(
                select(
                    func.count(Route.id),
                    func.coalesce(func.sum(Route.total_distance_km), 0),
                ).where(
                    Route.org_id == org_id,
                    Route.id.in_(route_ids),
                )
            )
        ).one()
        total_routes = int(route_stats[0] or 0)
        total_distance_km = float(route_stats[1] or 0.0)

    window_hours = max((safe_to - safe_from).total_seconds() / 3600.0, 0.0)
    if min_event_ts is not None and max_event_ts is not None and total_collections > 1:
        active_hours = max((max_event_ts - min_event_ts).total_seconds() / 3600.0, 0.0)
    else:
        active_hours = window_hours

    collections_per_hour = (total_collections / active_hours) if active_hours > 0 else 0.0
    distance_per_collection_km = (
        total_distance_km / total_collections if total_collections > 0 else 0.0
    )

    return {
        "from_ts": safe_from,
        "to_ts": safe_to,
        "total_collections": total_collections,
        "total_routes": total_routes,
        "total_distance_km": round(total_distance_km, 3),
        "total_active_hours": round(active_hours, 3),
        "collections_per_hour": round(collections_per_hour, 3),
        "distance_per_collection_km": round(distance_per_collection_km, 3),
    }


@dataclass(slots=True)
class _RouteSavingsInput:
    route_id: int
    optimized_distance_km: float
    naive_distance_km: float
    fuel_rate_l_per_km: float


async def _build_route_savings_inputs(
    db: AsyncSession,
    org_id: int,
    *,
    from_ts: datetime,
    to_ts: datetime,
) -> list[_RouteSavingsInput]:
    routes_rows = (
        await db.execute(
            select(
                Route.id,
                Route.route_code,
                Route.total_distance_km,
                Depot.latitude,
                Depot.longitude,
            )
            .outerjoin(Depot, Depot.id == Route.depot_id)
            .where(
                Route.org_id == org_id,
                Route.route_date >= from_ts.date(),
                Route.route_date <= to_ts.date(),
                Route.status.in_(["published", "in_progress", "completed"]),
            )
            .order_by(Route.route_date.asc(), Route.id.asc())
        )
    ).all()

    if not routes_rows:
        return []

    route_ids = [int(row[0]) for row in routes_rows]

    assignment_rows = (
        await db.execute(
            select(
                RouteAssignment.route_id,
                Vehicle.vehicle_type,
                RouteAssignment.assigned_at,
                RouteAssignment.id,
            )
            .outerjoin(Vehicle, Vehicle.id == RouteAssignment.vehicle_id)
            .where(
                RouteAssignment.route_id.in_(route_ids),
                RouteAssignment.status.in_(["assigned", "accepted"]),
            )
            .order_by(
                RouteAssignment.route_id.asc(),
                RouteAssignment.assigned_at.desc(),
                RouteAssignment.id.desc(),
            )
        )
    ).all()

    vehicle_type_by_route: dict[int, str | None] = {}
    for row in assignment_rows:
        route_id = int(row[0])
        if route_id not in vehicle_type_by_route:
            vehicle_type_by_route[route_id] = row[1]

    stops_rows = (
        await db.execute(
            select(
                RouteStop.route_id,
                RouteStop.stop_sequence,
                Bin.latitude,
                Bin.longitude,
            )
            .join(Bin, Bin.id == RouteStop.bin_id)
            .where(
                RouteStop.route_id.in_(route_ids),
                Bin.org_id == org_id,
            )
            .order_by(RouteStop.route_id.asc(), RouteStop.stop_sequence.asc())
        )
    ).all()

    stops_by_route: dict[int, list[tuple[float, float]]] = {}
    for row in stops_rows:
        route_id = int(row[0])
        lat = _to_float(row[2])
        lon = _to_float(row[3])
        if lat is None or lon is None:
            continue
        stops_by_route.setdefault(route_id, []).append((lat, lon))

    inputs: list[_RouteSavingsInput] = []
    for row in routes_rows:
        route_id = int(row[0])
        total_distance_km = _to_float(row[2])
        depot_lat = _to_float(row[3])
        depot_lon = _to_float(row[4])

        stops = stops_by_route.get(route_id, [])
        if not stops:
            continue

        if depot_lat is not None and depot_lon is not None:
            start_point = (depot_lat, depot_lon)
        else:
            start_point = stops[0]

        derived_optimized_km = _distance_roundtrip_km(start_point, stops)
        optimized_distance_km = (
            float(total_distance_km)
            if total_distance_km is not None and total_distance_km > 0
            else derived_optimized_km
        )
        naive_distance_km = _distance_naive_star_km(start_point, stops)

        vehicle_type = vehicle_type_by_route.get(route_id)
        inputs.append(
            _RouteSavingsInput(
                route_id=route_id,
                optimized_distance_km=max(optimized_distance_km, 0.0),
                naive_distance_km=max(naive_distance_km, 0.0),
                fuel_rate_l_per_km=_fuel_l_per_km(vehicle_type),
            )
        )

    return inputs


async def get_savings_analytics(
    db: AsyncSession,
    org_id: int,
    *,
    from_ts: datetime,
    to_ts: datetime,
) -> dict[str, Any]:
    """Return optimization savings compared with naive star routing."""
    safe_from, safe_to = _normalize_window(from_ts, to_ts)

    route_inputs = await _build_route_savings_inputs(
        db,
        org_id,
        from_ts=safe_from,
        to_ts=safe_to,
    )

    optimized_distance_km = sum(item.optimized_distance_km for item in route_inputs)
    naive_distance_km = sum(item.naive_distance_km for item in route_inputs)

    optimized_fuel_l = sum(
        item.optimized_distance_km * item.fuel_rate_l_per_km for item in route_inputs
    )
    naive_fuel_l = sum(
        item.naive_distance_km * item.fuel_rate_l_per_km for item in route_inputs
    )

    distance_saved_km = naive_distance_km - optimized_distance_km
    fuel_saved_l = naive_fuel_l - optimized_fuel_l

    distance_saved_pct = (
        (distance_saved_km / naive_distance_km * 100.0) if naive_distance_km > 0 else 0.0
    )
    fuel_saved_pct = (
        (fuel_saved_l / naive_fuel_l * 100.0) if naive_fuel_l > 0 else 0.0
    )

    return {
        "from_ts": safe_from,
        "to_ts": safe_to,
        "routes_analyzed": len(route_inputs),
        "optimized_distance_km": round(optimized_distance_km, 3),
        "naive_distance_km": round(naive_distance_km, 3),
        "distance_saved_km": round(distance_saved_km, 3),
        "distance_saved_pct": round(distance_saved_pct, 3),
        "optimized_fuel_l": round(optimized_fuel_l, 3),
        "naive_fuel_l": round(naive_fuel_l, 3),
        "fuel_saved_l": round(fuel_saved_l, 3),
        "fuel_saved_pct": round(fuel_saved_pct, 3),
    }


async def get_environmental_analytics(
    db: AsyncSession,
    org_id: int,
    *,
    from_ts: datetime,
    to_ts: datetime,
) -> dict[str, Any]:
    """Return estimated CO2 reduction derived from estimated fuel savings."""
    savings = await get_savings_analytics(
        db,
        org_id,
        from_ts=from_ts,
        to_ts=to_ts,
    )

    optimized_fuel_l = float(savings["optimized_fuel_l"])
    naive_fuel_l = float(savings["naive_fuel_l"])

    # Approximation for diesel combustion emissions.
    co2_factor_kg_per_liter = 2.68
    optimized_co2_kg = optimized_fuel_l * co2_factor_kg_per_liter
    naive_co2_kg = naive_fuel_l * co2_factor_kg_per_liter
    co2_saved_kg = naive_co2_kg - optimized_co2_kg
    co2_reduction_pct = (co2_saved_kg / naive_co2_kg * 100.0) if naive_co2_kg > 0 else 0.0

    return {
        "from_ts": savings["from_ts"],
        "to_ts": savings["to_ts"],
        "optimized_co2_kg": round(optimized_co2_kg, 3),
        "naive_co2_kg": round(naive_co2_kg, 3),
        "co2_saved_kg": round(co2_saved_kg, 3),
        "co2_reduction_pct": round(co2_reduction_pct, 3),
        "fuel_saved_l": savings["fuel_saved_l"],
        "distance_saved_km": savings["distance_saved_km"],
    }
