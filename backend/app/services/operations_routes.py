"""Route planning and route lifecycle services for collection operations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from importlib import import_module
from math import atan2, cos, radians, sin, sqrt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin, BinCurrentState, Route, RouteAssignment, RouteStop, Vehicle
from app.services.operations_audit import append_audit_log
from app.services.operations_common import (
    ROUTE_TRANSITIONS,
    resolve_route_start_point,
    resolve_start_point_for_planning,
    start_point_to_dict,
    validate_transition,
)
from app.services.operations_routing import RoutingPoint, build_travel_cost_matrix


@dataclass(slots=True)
class CandidateBin:
    """Candidate bin representation for route planning."""

    point_id: str
    bin_id: int
    bin_code: str
    latitude: float
    longitude: float
    fill_pct: float | None
    priority_score: float
    estimated_load_kg: float


@dataclass(slots=True)
class PlanningVehicle:
    """Vehicle input used by multi-vehicle planner."""

    vehicle_id: int
    vehicle_no: str
    capacity_kg: float | None


@dataclass(slots=True)
class StartPoint:
    """Start point tuple used for geometric calculations."""

    point_id: str
    latitude: float
    longitude: float


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _route_to_dict(
    route: Route,
    *,
    stops_count: int | None = None,
    start_point: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": int(route.id),
        "org_id": route.org_id,
        "route_code": route.route_code,
        "route_date": route.route_date,
        "depot_id": route.depot_id,
        "status": route.status,
        "total_distance_km": _to_float(route.total_distance_km),
        "estimated_duration_min": _to_float(route.estimated_duration_min),
        "optimization_run_id": route.optimization_run_id,
        "created_by": route.created_by,
        "updated_by": route.updated_by,
        "stops_count": stops_count,
        "start_point": start_point,
        "created_at": route.created_at,
        "updated_at": route.updated_at,
    }


AUTHORITY_ROLES = {"authority_admin", "authority_operator"}


def _is_authority(actor_roles: set[str]) -> bool:
    return bool(AUTHORITY_ROLES.intersection(actor_roles))


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate road distance proxy using great-circle distance."""
    radius_km = 6371.0

    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return radius_km * c


def _distance_from(
    start: StartPoint,
    candidate: CandidateBin,
    distance_lookup: dict[tuple[str, str], float],
) -> float:
    return distance_lookup.get(
        (start.point_id, candidate.point_id),
        _haversine_km(start.latitude, start.longitude, candidate.latitude, candidate.longitude),
    )


def _path_distance_km(
    start: StartPoint,
    ordered_bins: list[CandidateBin],
    distance_lookup: dict[tuple[str, str], float],
) -> float:
    if not ordered_bins:
        return 0.0

    total = 0.0
    current = start
    for stop in ordered_bins:
        total += _distance_from(current, stop, distance_lookup)
        current = StartPoint(
            point_id=stop.point_id,
            latitude=stop.latitude,
            longitude=stop.longitude,
        )
    return total


def _two_opt_improve(
    start: StartPoint,
    ordered_bins: list[CandidateBin],
    distance_lookup: dict[tuple[str, str], float],
) -> list[CandidateBin]:
    """Apply 2-opt local search for route distance reduction."""
    if len(ordered_bins) < 4:
        return ordered_bins

    best = ordered_bins[:]
    best_distance = _path_distance_km(start, best, distance_lookup)

    improved = True
    while improved:
        improved = False
        for i in range(0, len(best) - 1):
            for k in range(i + 1, len(best)):
                candidate = best[:i] + list(reversed(best[i : k + 1])) + best[k + 1 :]
                candidate_distance = _path_distance_km(start, candidate, distance_lookup)
                if candidate_distance + 1e-6 < best_distance:
                    best = candidate
                    best_distance = candidate_distance
                    improved = True
    return best


def _compute_priority(*, fill_pct: float | None, overflow_imminent: bool, telemetry_priority: float | None, ttf_min: float | None) -> float:
    base = 0.0
    if fill_pct is not None:
        base += min(max(fill_pct, 0.0), 100.0) * 0.5

    if overflow_imminent:
        base += 50.0

    if telemetry_priority is not None:
        base += telemetry_priority * 0.3

    if ttf_min is not None and ttf_min >= 0:
        base += max(0.0, (240.0 - min(ttf_min, 240.0)) / 6.0)

    return round(base, 3)


async def _get_route_scoped(db: AsyncSession, org_id: int, route_id: int) -> Route:
    route = (
        await db.execute(select(Route).where(Route.id == route_id, Route.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if route is None:
        raise ValueError("route not found")
    return route


async def _ensure_driver_route_scope(
    db: AsyncSession,
    *,
    route_id: int,
    driver_user_id: int,
) -> RouteAssignment:
    assignment = (
        await db.execute(
            select(RouteAssignment)
            .where(
                RouteAssignment.route_id == route_id,
                RouteAssignment.driver_user_id == driver_user_id,
                RouteAssignment.status.in_(["assigned", "accepted"]),
            )
            .order_by(RouteAssignment.assigned_at.desc(), RouteAssignment.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise PermissionError("driver can only act on assigned routes")
    return assignment


async def _get_candidate_bins(
    db: AsyncSession,
    org_id: int,
    *,
    include_bin_ids: list[int] | None,
    min_fill_pct: float,
    overflow_only: bool,
) -> list[CandidateBin]:
    default_waste_density_kg_per_liter = 0.12
    default_bin_load_kg = 15.0

    filters = [Bin.org_id == org_id, Bin.is_active.is_(True)]
    if include_bin_ids:
        filters.append(Bin.id.in_(include_bin_ids))

    rows = (
        await db.execute(
            select(Bin, BinCurrentState)
            .outerjoin(BinCurrentState, BinCurrentState.bin_id == Bin.id)
            .where(*filters)
        )
    ).all()

    candidates: list[CandidateBin] = []
    for bin_obj, current_state in rows:
        lat = _to_float(bin_obj.latitude)
        lon = _to_float(bin_obj.longitude)
        if lat is None or lon is None:
            continue

        fill_pct = _to_float(current_state.current_fill_pct) if current_state is not None else None
        telemetry_priority = _to_float(current_state.current_priority_score) if current_state is not None else None
        ttf_min = _to_float(current_state.current_ttf_min) if current_state is not None else None
        overflow_imminent = bool(current_state.overflow_imminent) if current_state is not None else False

        if overflow_only:
            if not overflow_imminent:
                continue
        else:
            if not overflow_imminent and (fill_pct is None or fill_pct < min_fill_pct):
                continue

        capacity_liters = _to_float(bin_obj.capacity_liters)
        if capacity_liters is not None and fill_pct is not None:
            estimated_load_kg = (
                max(0.0, min(fill_pct, 100.0))
                / 100.0
                * capacity_liters
                * default_waste_density_kg_per_liter
            )
        else:
            estimated_load_kg = default_bin_load_kg

        candidates.append(
            CandidateBin(
                point_id=f"bin:{bin_obj.id}",
                bin_id=bin_obj.id,
                bin_code=bin_obj.bin_code,
                latitude=lat,
                longitude=lon,
                fill_pct=fill_pct,
                priority_score=_compute_priority(
                    fill_pct=fill_pct,
                    overflow_imminent=overflow_imminent,
                    telemetry_priority=telemetry_priority,
                    ttf_min=ttf_min,
                ),
                estimated_load_kg=round(max(estimated_load_kg, 0.0), 3),
            )
        )

    candidates.sort(key=lambda row: (-row.priority_score, row.bin_id))
    return candidates


async def _get_planning_vehicles(
    db: AsyncSession,
    org_id: int,
    *,
    vehicle_ids: list[int] | None,
) -> list[PlanningVehicle]:
    filters = [Vehicle.org_id == org_id, Vehicle.is_active.is_(True)]
    if vehicle_ids:
        filters.append(Vehicle.id.in_(vehicle_ids))

    rows = (
        await db.execute(
            select(Vehicle)
            .where(*filters)
            .order_by(Vehicle.id.asc())
        )
    ).scalars().all()

    vehicles = [
        PlanningVehicle(
            vehicle_id=int(row.id),
            vehicle_no=row.vehicle_no,
            capacity_kg=_to_float(row.capacity_kg),
        )
        for row in rows
    ]

    if vehicle_ids:
        found_ids = {item.vehicle_id for item in vehicles}
        missing_ids = [vehicle_id for vehicle_id in vehicle_ids if vehicle_id not in found_ids]
        if missing_ids:
            raise ValueError(f"one or more vehicle ids are not found or inactive: {missing_ids}")

    return vehicles


def _distance_between_points(
    *,
    from_point_id: str,
    from_lat: float,
    from_lon: float,
    to_point_id: str,
    to_lat: float,
    to_lon: float,
    distance_lookup: dict[tuple[str, str], float],
) -> float:
    return distance_lookup.get(
        (from_point_id, to_point_id),
        _haversine_km(from_lat, from_lon, to_lat, to_lon),
    )


def _path_distance_with_return_km(
    start: StartPoint,
    ordered_bins: list[CandidateBin],
    distance_lookup: dict[tuple[str, str], float],
) -> float:
    if not ordered_bins:
        return 0.0

    forward = _path_distance_km(start, ordered_bins, distance_lookup)
    last = ordered_bins[-1]
    back_to_start = _distance_between_points(
        from_point_id=last.point_id,
        from_lat=last.latitude,
        from_lon=last.longitude,
        to_point_id=start.point_id,
        to_lat=start.latitude,
        to_lon=start.longitude,
        distance_lookup=distance_lookup,
    )
    return forward + back_to_start


def _estimate_duration_min(
    *,
    travel_distance_km: float,
    stops_count: int,
    avg_speed_kmph: float,
    service_minutes_per_stop: float,
) -> float:
    speed_km_per_min = avg_speed_kmph / 60.0
    if speed_km_per_min <= 0:
        return float("inf")
    return (travel_distance_km / speed_km_per_min) + (service_minutes_per_stop * stops_count)


def _normalize_vehicle_capacity_kg(
    *,
    capacity_kg: float | None,
    total_candidate_load_kg: float,
) -> int:
    if capacity_kg is None or capacity_kg <= 0:
        return max(int(round(total_candidate_load_kg)), 1)
    return max(int(round(capacity_kg)), 1)


def _load_ortools_modules() -> tuple[Any | None, Any | None]:
    try:
        constraint_solver = import_module("ortools.constraint_solver")
    except Exception:  # pragma: no cover - optional runtime dependency
        return None, None

    pywrapcp_module = getattr(constraint_solver, "pywrapcp", None)
    enums_module = getattr(constraint_solver, "routing_enums_pb2", None)
    return pywrapcp_module, enums_module


def _solve_vrp_with_ortools(
    *,
    start: StartPoint,
    candidates: list[CandidateBin],
    vehicles: list[PlanningVehicle],
    max_stops: int,
    target_shift_minutes: int,
    avg_speed_kmph: float,
    service_minutes_per_stop: float,
    distance_lookup: dict[tuple[str, str], float],
) -> tuple[list[list[CandidateBin]], list[int]] | None:
    pywrapcp, routing_enums_pb2 = _load_ortools_modules()
    if pywrapcp is None or routing_enums_pb2 is None:
        return None
    if not candidates or not vehicles:
        return [], []

    speed_km_per_min = avg_speed_kmph / 60.0
    if speed_km_per_min <= 0:
        return None

    total_candidate_load_kg = sum(candidate.estimated_load_kg for candidate in candidates)
    node_points: list[tuple[str, float, float]] = [
        (start.point_id, start.latitude, start.longitude),
        *[(item.point_id, item.latitude, item.longitude) for item in candidates],
    ]

    manager = pywrapcp.RoutingIndexManager(len(node_points), len(vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)

        from_point_id, from_lat, from_lon = node_points[from_node]
        to_point_id, to_lat, to_lon = node_points[to_node]
        distance_km = _distance_between_points(
            from_point_id=from_point_id,
            from_lat=from_lat,
            from_lon=from_lon,
            to_point_id=to_point_id,
            to_lat=to_lat,
            to_lon=to_lon,
            distance_lookup=distance_lookup,
        )
        return int(round(distance_km * 1000.0))

    distance_cb_idx = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(distance_cb_idx)

    def demand_callback(from_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        if from_node == 0:
            return 0
        return max(int(round(candidates[from_node - 1].estimated_load_kg)), 0)

    demand_cb_idx = routing.RegisterUnaryTransitCallback(demand_callback)
    vehicle_capacities = [
        _normalize_vehicle_capacity_kg(
            capacity_kg=vehicle.capacity_kg,
            total_candidate_load_kg=total_candidate_load_kg,
        )
        for vehicle in vehicles
    ]
    routing.AddDimensionWithVehicleCapacity(
        demand_cb_idx,
        0,
        vehicle_capacities,
        True,
        "Capacity",
    )

    def stop_callback(from_index: int) -> int:
        return 0 if manager.IndexToNode(from_index) == 0 else 1

    stop_cb_idx = routing.RegisterUnaryTransitCallback(stop_callback)
    routing.AddDimensionWithVehicleCapacity(
        stop_cb_idx,
        0,
        [max_stops for _ in vehicles],
        True,
        "Stops",
    )

    def time_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)

        from_point_id, from_lat, from_lon = node_points[from_node]
        to_point_id, to_lat, to_lon = node_points[to_node]
        leg_km = _distance_between_points(
            from_point_id=from_point_id,
            from_lat=from_lat,
            from_lon=from_lon,
            to_point_id=to_point_id,
            to_lat=to_lat,
            to_lon=to_lon,
            distance_lookup=distance_lookup,
        )
        travel_minutes = leg_km / speed_km_per_min
        service_minutes = service_minutes_per_stop if from_node != 0 else 0.0
        return int(round((travel_minutes + service_minutes) * 10.0))

    time_cb_idx = routing.RegisterTransitCallback(time_callback)
    routing.AddDimensionWithVehicleCapacity(
        time_cb_idx,
        0,
        [target_shift_minutes * 10 for _ in vehicles],
        True,
        "Time",
    )

    penalty = 5_000_000
    for node in range(1, len(node_points)):
        routing.AddDisjunction([manager.NodeToIndex(node)], penalty)

    search_params = pywrapcp.DefaultRoutingSearchParameters()
    search_params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    search_params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search_params.time_limit.FromSeconds(4)

    solution = routing.SolveWithParameters(search_params)
    if solution is None:
        return None

    routes: list[list[CandidateBin]] = []
    for vehicle_index in range(len(vehicles)):
        index = routing.Start(vehicle_index)
        ordered_bins: list[CandidateBin] = []
        while not routing.IsEnd(index):
            next_index = solution.Value(routing.NextVar(index))
            next_node = manager.IndexToNode(next_index)
            if next_node != 0:
                ordered_bins.append(candidates[next_node - 1])
            index = next_index
        routes.append(ordered_bins)

    dropped_indexes: list[int] = []
    for node in range(1, len(node_points)):
        node_index = manager.NodeToIndex(node)
        if solution.Value(routing.NextVar(node_index)) == node_index:
            dropped_indexes.append(node - 1)

    return routes, dropped_indexes


def _solve_multi_vehicle_greedy(
    *,
    start: StartPoint,
    candidates: list[CandidateBin],
    vehicles: list[PlanningVehicle],
    max_stops: int,
    target_shift_minutes: int,
    avg_speed_kmph: float,
    service_minutes_per_stop: float,
    distance_lookup: dict[tuple[str, str], float],
) -> tuple[list[list[CandidateBin]], list[int]]:
    if not candidates or not vehicles:
        return [], []

    speed_km_per_min = avg_speed_kmph / 60.0
    if speed_km_per_min <= 0:
        return [[] for _ in vehicles], list(range(len(candidates)))

    total_candidate_load_kg = sum(candidate.estimated_load_kg for candidate in candidates)
    vehicle_capacity_lookup = {
        idx: float(
            _normalize_vehicle_capacity_kg(
                capacity_kg=vehicle.capacity_kg,
                total_candidate_load_kg=total_candidate_load_kg,
            )
        )
        for idx, vehicle in enumerate(vehicles)
    }

    routes: list[list[CandidateBin]] = [[] for _ in vehicles]
    route_load_kg: dict[int, float] = {idx: 0.0 for idx in range(len(vehicles))}

    dropped_indexes: list[int] = []
    ordered_pairs = list(enumerate(candidates))
    ordered_pairs.sort(key=lambda pair: (-pair[1].priority_score, pair[1].bin_id))

    for candidate_index, candidate in ordered_pairs:
        best_vehicle_index: int | None = None
        best_cost = float("inf")

        for vehicle_index in range(len(vehicles)):
            route_bins = routes[vehicle_index]
            if len(route_bins) >= max_stops:
                continue

            projected_load = route_load_kg[vehicle_index] + candidate.estimated_load_kg
            if projected_load > vehicle_capacity_lookup[vehicle_index] + 1e-6:
                continue

            if route_bins:
                current = route_bins[-1]
                leg_km = _distance_between_points(
                    from_point_id=current.point_id,
                    from_lat=current.latitude,
                    from_lon=current.longitude,
                    to_point_id=candidate.point_id,
                    to_lat=candidate.latitude,
                    to_lon=candidate.longitude,
                    distance_lookup=distance_lookup,
                )
            else:
                leg_km = _distance_from(start, candidate, distance_lookup)

            projected_bins = route_bins + [candidate]
            total_distance_with_return_km = _path_distance_with_return_km(
                start,
                projected_bins,
                distance_lookup,
            )
            projected_duration = _estimate_duration_min(
                travel_distance_km=total_distance_with_return_km,
                stops_count=len(projected_bins),
                avg_speed_kmph=avg_speed_kmph,
                service_minutes_per_stop=service_minutes_per_stop,
            )
            if projected_duration > target_shift_minutes:
                continue

            if leg_km < best_cost:
                best_cost = leg_km
                best_vehicle_index = vehicle_index

        if best_vehicle_index is None:
            dropped_indexes.append(candidate_index)
            continue

        routes[best_vehicle_index].append(candidate)
        route_load_kg[best_vehicle_index] += candidate.estimated_load_kg

    for vehicle_index in range(len(routes)):
        routes[vehicle_index] = _two_opt_improve(start, routes[vehicle_index], distance_lookup)

    return routes, dropped_indexes


def _build_route_greedy(
    *,
    start: StartPoint,
    candidates: list[CandidateBin],
    max_stops: int,
    target_shift_minutes: int,
    avg_speed_kmph: float,
    service_minutes_per_stop: float,
    distance_lookup: dict[tuple[str, str], float],
) -> tuple[list[CandidateBin], int]:
    """Greedy nearest-neighbor construction under shift-duration constraint."""
    if not candidates:
        return [], 0

    remaining = candidates[:]
    selected: list[CandidateBin] = []
    skipped_due_to_shift = 0

    speed_km_per_min = avg_speed_kmph / 60.0
    current = StartPoint(
        point_id=start.point_id,
        latitude=start.latitude,
        longitude=start.longitude,
    )
    total_distance = 0.0
    total_service_minutes = 0.0

    while remaining and len(selected) < max_stops:
        nearest = min(remaining, key=lambda row: _distance_from(current, row, distance_lookup))
        leg_distance = _distance_from(current, nearest, distance_lookup)
        projected_distance = total_distance + leg_distance
        projected_service = total_service_minutes + service_minutes_per_stop
        projected_duration = projected_service + (projected_distance / speed_km_per_min)

        if projected_duration > target_shift_minutes:
            skipped_due_to_shift += len(remaining)
            break

        selected.append(nearest)
        total_distance = projected_distance
        total_service_minutes = projected_service
        current = StartPoint(
            point_id=nearest.point_id,
            latitude=nearest.latitude,
            longitude=nearest.longitude,
        )
        remaining.remove(nearest)

    return selected, skipped_due_to_shift


def _build_stop_items(
    start: StartPoint,
    ordered_bins: list[CandidateBin],
    distance_lookup: dict[tuple[str, str], float],
    *,
    vehicle_id: int | None = None,
    vehicle_no: str | None = None,
) -> tuple[list[dict[str, Any]], float]:
    """Create stop response items with leg and cumulative distances."""
    items: list[dict[str, Any]] = []
    cumulative_distance = 0.0
    current = start

    for index, candidate in enumerate(ordered_bins, start=1):
        leg_km = _distance_from(current, candidate, distance_lookup)
        cumulative_distance += leg_km
        items.append(
            {
                "stop_sequence": index,
                "bin_id": candidate.bin_id,
                "bin_code": candidate.bin_code,
                "latitude": candidate.latitude,
                "longitude": candidate.longitude,
                "fill_pct": candidate.fill_pct,
                "priority_score": candidate.priority_score,
                "estimated_load_kg": candidate.estimated_load_kg,
                "vehicle_id": vehicle_id,
                "vehicle_no": vehicle_no,
                "planned_leg_km": round(leg_km, 3),
                "planned_cumulative_km": round(cumulative_distance, 3),
            }
        )
        current = StartPoint(
            point_id=candidate.point_id,
            latitude=candidate.latitude,
            longitude=candidate.longitude,
        )

    return items, cumulative_distance


async def plan_route(
    db: AsyncSession,
    org_id: int,
    *,
    route_date: date,
    depot_id: int | None,
    driver_user_id: int | None,
    include_bin_ids: list[int] | None,
    max_stops: int,
    min_fill_pct: float,
    overflow_only: bool,
    target_shift_minutes: int,
    avg_speed_kmph: float,
    service_minutes_per_stop: float,
    use_multi_vehicle: bool = False,
    vehicle_ids: list[int] | None = None,
    actor_user_id: int | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict[str, Any]:
    """Generate one deterministic route plan preview from live bin state."""
    candidates = await _get_candidate_bins(
        db,
        org_id,
        include_bin_ids=include_bin_ids,
        min_fill_pct=min_fill_pct,
        overflow_only=overflow_only,
    )

    candidate_bin_ids = [candidate.bin_id for candidate in candidates]
    start_point_resolved = await resolve_start_point_for_planning(
        db,
        org_id=org_id,
        route_depot_id=depot_id,
        driver_user_id=driver_user_id,
        bin_ids=candidate_bin_ids,
    )

    if start_point_resolved.latitude is None or start_point_resolved.longitude is None:
        raise ValueError("unable to resolve start point coordinates")

    start = StartPoint(
        point_id="__start__",
        latitude=float(start_point_resolved.latitude),
        longitude=float(start_point_resolved.longitude),
    )

    matrix_points = [
        RoutingPoint(point_id=start.point_id, latitude=start.latitude, longitude=start.longitude),
        *[
            RoutingPoint(point_id=candidate.point_id, latitude=candidate.latitude, longitude=candidate.longitude)
            for candidate in candidates
        ],
    ]
    distance_lookup = await build_travel_cost_matrix(matrix_points)
    should_plan_multi_vehicle = use_multi_vehicle or bool(vehicle_ids)

    if should_plan_multi_vehicle:
        vehicles = await _get_planning_vehicles(
            db,
            org_id,
            vehicle_ids=vehicle_ids,
        )
        if not vehicles:
            raise ValueError("no active vehicles available for multi-vehicle planning")

        ortools_solution = _solve_vrp_with_ortools(
            start=start,
            candidates=candidates,
            vehicles=vehicles,
            max_stops=max_stops,
            target_shift_minutes=target_shift_minutes,
            avg_speed_kmph=avg_speed_kmph,
            service_minutes_per_stop=service_minutes_per_stop,
            distance_lookup=distance_lookup,
        )
        if ortools_solution is None:
            routes_per_vehicle, dropped_candidate_indexes = _solve_multi_vehicle_greedy(
                start=start,
                candidates=candidates,
                vehicles=vehicles,
                max_stops=max_stops,
                target_shift_minutes=target_shift_minutes,
                avg_speed_kmph=avg_speed_kmph,
                service_minutes_per_stop=service_minutes_per_stop,
                distance_lookup=distance_lookup,
            )
            algorithm = "vrp_multi_vehicle_greedy_v1"
        else:
            routes_per_vehicle, dropped_candidate_indexes = ortools_solution
            algorithm = "vrp_multi_vehicle_ortools_v1"

        vehicle_routes: list[dict[str, Any]] = []
        all_items: list[dict[str, Any]] = []
        fleet_distance_km = 0.0
        fleet_duration_min = 0.0
        total_assigned_load_kg = 0.0

        for vehicle, route_bins in zip(vehicles, routes_per_vehicle, strict=False):
            stop_items, path_distance_km = _build_stop_items(
                start,
                route_bins,
                distance_lookup,
                vehicle_id=vehicle.vehicle_id,
                vehicle_no=vehicle.vehicle_no,
            )
            distance_with_return_km = _path_distance_with_return_km(start, route_bins, distance_lookup)
            route_duration_min = _estimate_duration_min(
                travel_distance_km=distance_with_return_km,
                stops_count=len(route_bins),
                avg_speed_kmph=avg_speed_kmph,
                service_minutes_per_stop=service_minutes_per_stop,
            )
            assigned_load_kg = sum(item.estimated_load_kg for item in route_bins)

            vehicle_routes.append(
                {
                    "vehicle_id": vehicle.vehicle_id,
                    "vehicle_no": vehicle.vehicle_no,
                    "capacity_kg": vehicle.capacity_kg,
                    "assigned_stops": len(route_bins),
                    "assigned_load_kg": round(assigned_load_kg, 3),
                    "estimated_distance_km": round(distance_with_return_km, 3),
                    "estimated_duration_min": round(route_duration_min, 2),
                    "items": stop_items,
                }
            )

            all_items.extend(stop_items)
            fleet_distance_km += distance_with_return_km
            fleet_duration_min += route_duration_min
            total_assigned_load_kg += assigned_load_kg

        dropped_candidate_index_set = set(dropped_candidate_indexes)
        unassigned_bins = [
            candidate
            for index, candidate in enumerate(candidates)
            if index in dropped_candidate_index_set
        ]

        result = {
            "algorithm": algorithm,
            "route_date": route_date,
            "candidates_considered": len(candidates),
            "selected_stops": len(all_items),
            "skipped_due_to_shift": len(unassigned_bins),
            "estimated_distance_km": round(fleet_distance_km, 3),
            "estimated_duration_min": round(fleet_duration_min, 2),
            "start_point": start_point_to_dict(start_point_resolved),
            "items": all_items,
            "vehicle_routes": vehicle_routes,
            "unassigned_bin_ids": [candidate.bin_id for candidate in unassigned_bins],
            "total_estimated_load_kg": round(total_assigned_load_kg, 3),
        }
    else:
        greedy_selected, skipped_due_to_shift = _build_route_greedy(
            start=start,
            candidates=candidates,
            max_stops=max_stops,
            target_shift_minutes=target_shift_minutes,
            avg_speed_kmph=avg_speed_kmph,
            service_minutes_per_stop=service_minutes_per_stop,
            distance_lookup=distance_lookup,
        )

        optimized_selected = _two_opt_improve(start, greedy_selected, distance_lookup)
        stop_items, total_distance_km = _build_stop_items(start, optimized_selected, distance_lookup)
        estimated_duration_min = _estimate_duration_min(
            travel_distance_km=total_distance_km,
            stops_count=len(stop_items),
            avg_speed_kmph=avg_speed_kmph,
            service_minutes_per_stop=service_minutes_per_stop,
        )

        result = {
            "algorithm": "greedy_nn_2opt_v1",
            "route_date": route_date,
            "candidates_considered": len(candidates),
            "selected_stops": len(stop_items),
            "skipped_due_to_shift": skipped_due_to_shift,
            "estimated_distance_km": round(total_distance_km, 3),
            "estimated_duration_min": round(estimated_duration_min, 2),
            "start_point": start_point_to_dict(start_point_resolved),
            "items": stop_items,
            "vehicle_routes": None,
            "unassigned_bin_ids": [],
            "total_estimated_load_kg": round(
                sum(item.estimated_load_kg for item in optimized_selected),
                3,
            ),
        }

    if actor_user_id is not None:
        await append_audit_log(
            db,
            org_id=org_id,
            user_id=actor_user_id,
            action_type="route_plan_preview",
            entity_type="route_plan",
            entity_id=str(route_date),
            before_json={
                "route_date": str(route_date),
                "depot_id": depot_id,
                "driver_user_id": driver_user_id,
                "include_bin_ids": include_bin_ids,
                "max_stops": max_stops,
                "min_fill_pct": min_fill_pct,
                "overflow_only": overflow_only,
                "target_shift_minutes": target_shift_minutes,
                "avg_speed_kmph": avg_speed_kmph,
                "service_minutes_per_stop": service_minutes_per_stop,
                "use_multi_vehicle": use_multi_vehicle,
                "vehicle_ids": vehicle_ids,
            },
            after_json={
                "algorithm": result.get("algorithm"),
                "selected_stops": result.get("selected_stops"),
                "estimated_distance_km": result.get("estimated_distance_km"),
                "estimated_duration_min": result.get("estimated_duration_min"),
            },
            ip_address=ip_address,
            user_agent=user_agent,
            auto_commit=True,
        )

    return result


async def create_route_draft(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    *,
    route_code: str,
    route_date: date,
    depot_id: int | None,
    stop_bin_ids: list[int],
    driver_user_id: int | None,
) -> dict[str, Any]:
    """Create one draft route and its ordered route stops."""
    unique_stop_ids = list(dict.fromkeys(stop_bin_ids))
    if not unique_stop_ids:
        raise ValueError("at least one stop bin id is required")

    rows = (
        await db.execute(
            select(Bin.id)
            .where(Bin.org_id == org_id, Bin.id.in_(unique_stop_ids), Bin.is_active.is_(True))
        )
    ).scalars().all()

    if len(set(int(row) for row in rows)) != len(unique_stop_ids):
        raise ValueError("one or more bins are not found or inactive")

    route = Route(
        org_id=org_id,
        route_code=route_code,
        route_date=route_date,
        depot_id=depot_id,
        status="draft",
        total_distance_km=None,
        estimated_duration_min=None,
        optimization_run_id=None,
        created_by=actor_user_id,
        updated_by=actor_user_id,
    )
    db.add(route)
    await db.flush()

    for index, bin_id in enumerate(unique_stop_ids, start=1):
        db.add(
            RouteStop(
                route_id=route.id,
                stop_sequence=index,
                bin_id=bin_id,
                planned_eta=None,
                planned_service_minutes=None,
                priority_snapshot=None,
                status="pending",
                actual_arrival=None,
                actual_departure=None,
                skip_reason=None,
            )
        )

    start_point_resolved = await resolve_start_point_for_planning(
        db,
        org_id=org_id,
        route_depot_id=depot_id,
        driver_user_id=driver_user_id,
        bin_ids=unique_stop_ids,
    )

    after_state = _route_to_dict(
        route,
        stops_count=len(unique_stop_ids),
        start_point=start_point_to_dict(start_point_resolved),
    )

    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="route_draft_created",
        entity_type="route",
        entity_id=str(route.id),
        before_json=None,
        after_json=after_state,
    )

    await db.commit()
    await db.refresh(route)

    return after_state


async def list_routes(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    route_date: date | None = None,
) -> dict[str, Any]:
    """Return paginated organization-scoped routes."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [Route.org_id == org_id]
    if status:
        filters.append(Route.status == status)
    if route_date is not None:
        filters.append(Route.route_date == route_date)

    count_subquery = (
        select(RouteStop.route_id, func.count(RouteStop.id).label("stops_count"))
        .group_by(RouteStop.route_id)
        .subquery()
    )

    total = (await db.execute(select(func.count(Route.id)).where(*filters))).scalar_one() or 0
    rows = (
        await db.execute(
            select(Route, count_subquery.c.stops_count)
            .outerjoin(count_subquery, count_subquery.c.route_id == Route.id)
            .where(*filters)
            .order_by(Route.route_date.desc(), Route.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [
            _route_to_dict(row[0], stops_count=int(row[1] or 0))
            for row in rows
        ],
    }


async def list_driver_routes(
    db: AsyncSession,
    org_id: int,
    *,
    driver_user_id: int,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    route_date: date | None = None,
    assignment_status: str | None = None,
) -> dict[str, Any]:
    """Return paginated routes assigned to one driver with assignment metadata."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    latest_assignment_subquery = (
        select(
            RouteAssignment.route_id.label("route_id"),
            func.max(RouteAssignment.id).label("assignment_id"),
        )
        .where(RouteAssignment.driver_user_id == driver_user_id)
        .group_by(RouteAssignment.route_id)
        .subquery()
    )

    route_stops_count_subquery = (
        select(RouteStop.route_id, func.count(RouteStop.id).label("stops_count"))
        .group_by(RouteStop.route_id)
        .subquery()
    )

    filters = [Route.org_id == org_id]
    if status:
        filters.append(Route.status == status)
    if route_date is not None:
        filters.append(Route.route_date == route_date)
    if assignment_status:
        filters.append(RouteAssignment.status == assignment_status)

    base_query = (
        select(
            Route,
            RouteAssignment,
            route_stops_count_subquery.c.stops_count,
        )
        .join(
            latest_assignment_subquery,
            latest_assignment_subquery.c.route_id == Route.id,
        )
        .join(
            RouteAssignment,
            RouteAssignment.id == latest_assignment_subquery.c.assignment_id,
        )
        .outerjoin(
            route_stops_count_subquery,
            route_stops_count_subquery.c.route_id == Route.id,
        )
        .where(*filters)
    )

    total = (
        await db.execute(
            select(func.count())
            .select_from(base_query.subquery())
        )
    ).scalar_one() or 0

    rows = (
        await db.execute(
            base_query
            .order_by(Route.route_date.desc(), Route.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).all()

    items: list[dict[str, Any]] = []
    for route, assignment, stops_count in rows:
        route_payload = _route_to_dict(route, stops_count=int(stops_count or 0))
        route_payload.update(
            {
                "assignment_id": int(assignment.id),
                "assignment_status": assignment.status,
                "assigned_at": assignment.assigned_at,
                "accepted_at": assignment.accepted_at,
                "rejected_at": assignment.rejected_at,
                "reject_reason": assignment.reject_reason,
                "vehicle_id": assignment.vehicle_id,
            }
        )
        items.append(route_payload)

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": items,
    }


async def get_route(
    db: AsyncSession,
    org_id: int,
    route_id: int,
    *,
    driver_user_id: int | None = None,
) -> dict[str, Any]:
    """Fetch one org-scoped route with stops count and resolved start point."""
    route = await _get_route_scoped(db, org_id, route_id)

    stops_count = (
        await db.execute(select(func.count(RouteStop.id)).where(RouteStop.route_id == route.id))
    ).scalar_one() or 0

    start_point: dict[str, Any] | None = None
    if stops_count > 0:
        try:
            start_point_obj = await resolve_route_start_point(
                db,
                org_id=org_id,
                route_id=route.id,
                driver_user_id=driver_user_id,
            )
            start_point = start_point_to_dict(start_point_obj)
        except ValueError:
            start_point = None

    return _route_to_dict(route, stops_count=int(stops_count), start_point=start_point)


async def publish_route(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    route_id: int,
    *,
    driver_user_id: int | None = None,
) -> dict[str, Any]:
    """Publish one draft route after transition and start-point validation."""
    route = await _get_route_scoped(db, org_id, route_id)

    before_state = _route_to_dict(route)

    if route.status == "published":
        return before_state

    validate_transition(current_status=route.status, next_status="published", transitions=ROUTE_TRANSITIONS)

    stops_rows = (
        await db.execute(
            select(RouteStop, Bin)
            .join(Bin, Bin.id == RouteStop.bin_id)
            .where(RouteStop.route_id == route.id, Bin.org_id == org_id)
            .order_by(RouteStop.stop_sequence.asc())
        )
    ).all()

    if not stops_rows:
        raise ValueError("route has no stops")

    start_point_obj = await resolve_route_start_point(
        db,
        org_id=org_id,
        route_id=route.id,
        driver_user_id=driver_user_id,
    )

    if start_point_obj.latitude is None or start_point_obj.longitude is None:
        raise ValueError("unable to resolve start point coordinates")

    start = StartPoint(
        point_id="__start__",
        latitude=float(start_point_obj.latitude),
        longitude=float(start_point_obj.longitude),
    )

    ordered_candidates: list[CandidateBin] = []
    for _, bin_obj in stops_rows:
        lat = _to_float(bin_obj.latitude)
        lon = _to_float(bin_obj.longitude)
        if lat is None or lon is None:
            continue
        ordered_candidates.append(
            CandidateBin(
                point_id=f"bin:{bin_obj.id}",
                bin_id=bin_obj.id,
                bin_code=bin_obj.bin_code,
                latitude=lat,
                longitude=lon,
                fill_pct=None,
                priority_score=0.0,
                estimated_load_kg=0.0,
            )
        )

    matrix_points = [
        RoutingPoint(point_id=start.point_id, latitude=start.latitude, longitude=start.longitude),
        *[
            RoutingPoint(point_id=candidate.point_id, latitude=candidate.latitude, longitude=candidate.longitude)
            for candidate in ordered_candidates
        ],
    ]
    distance_lookup = await build_travel_cost_matrix(matrix_points)

    total_distance_km = _path_distance_km(start, ordered_candidates, distance_lookup)
    estimated_duration_min = (total_distance_km / (22.0 / 60.0)) + (4.0 * len(ordered_candidates))

    route.status = "published"
    route.updated_by = actor_user_id
    route.total_distance_km = round(total_distance_km, 2)
    route.estimated_duration_min = round(estimated_duration_min, 2)

    after_state = _route_to_dict(
        route,
        stops_count=len(stops_rows),
        start_point=start_point_to_dict(start_point_obj),
    )
    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="route_published",
        entity_type="route",
        entity_id=str(route.id),
        before_json=before_state,
        after_json=after_state,
    )

    await db.commit()
    await db.refresh(route)

    return after_state


async def start_route(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    route_id: int,
) -> dict[str, Any]:
    """Transition one published route to in_progress state."""
    route = await _get_route_scoped(db, org_id, route_id)

    if not _is_authority(actor_roles):
        await _ensure_driver_route_scope(db, route_id=route.id, driver_user_id=actor_user_id)

    before_state = _route_to_dict(route)

    if route.status == "in_progress":
        return before_state

    validate_transition(current_status=route.status, next_status="in_progress", transitions=ROUTE_TRANSITIONS)

    route.status = "in_progress"
    route.updated_by = actor_user_id

    after_state = _route_to_dict(route)
    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="route_started",
        entity_type="route",
        entity_id=str(route.id),
        before_json=before_state,
        after_json=after_state,
    )

    await db.commit()
    await db.refresh(route)

    return after_state


async def _complete_route_in_session(
    db: AsyncSession,
    *,
    route: Route,
    org_id: int,
    actor_user_id: int,
    action_type: str,
) -> dict[str, Any]:
    before_state = _route_to_dict(route)
    route.status = "completed"
    route.updated_by = actor_user_id

    after_state = _route_to_dict(route)
    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type=action_type,
        entity_type="route",
        entity_id=str(route.id),
        before_json=before_state,
        after_json=after_state,
    )
    return after_state


async def complete_route(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    route_id: int,
) -> dict[str, Any]:
    """Transition one in-progress route to completed when all stops are terminal."""
    route = await _get_route_scoped(db, org_id, route_id)

    if not _is_authority(actor_roles):
        await _ensure_driver_route_scope(db, route_id=route.id, driver_user_id=actor_user_id)

    if route.status == "completed":
        return _route_to_dict(route)

    validate_transition(current_status=route.status, next_status="completed", transitions=ROUTE_TRANSITIONS)

    total_stops = (
        await db.execute(select(func.count(RouteStop.id)).where(RouteStop.route_id == route.id))
    ).scalar_one() or 0
    terminal_stops = (
        await db.execute(
            select(func.count(RouteStop.id)).where(
                RouteStop.route_id == route.id,
                RouteStop.status.in_(["serviced", "skipped"]),
            )
        )
    ).scalar_one() or 0

    if int(total_stops) == 0:
        raise ValueError("route has no stops")
    if int(terminal_stops) != int(total_stops):
        raise ValueError("route has pending stops")

    after_state = await _complete_route_in_session(
        db,
        route=route,
        org_id=org_id,
        actor_user_id=actor_user_id,
        action_type="route_completed",
    )

    await db.commit()
    await db.refresh(route)
    return after_state


async def auto_complete_route_if_terminal(
    db: AsyncSession,
    *,
    org_id: int,
    route_id: int,
    actor_user_id: int,
) -> dict[str, Any] | None:
    """Auto-complete in-progress route when all stops are in terminal states."""
    route = await _get_route_scoped(db, org_id, route_id)
    if route.status != "in_progress":
        return None

    total_stops = (
        await db.execute(select(func.count(RouteStop.id)).where(RouteStop.route_id == route.id))
    ).scalar_one() or 0
    if int(total_stops) == 0:
        return None

    terminal_stops = (
        await db.execute(
            select(func.count(RouteStop.id)).where(
                RouteStop.route_id == route.id,
                RouteStop.status.in_(["serviced", "skipped"]),
            )
        )
    ).scalar_one() or 0
    if int(terminal_stops) != int(total_stops):
        return None

    return await _complete_route_in_session(
        db,
        route=route,
        org_id=org_id,
        actor_user_id=actor_user_id,
        action_type="route_auto_completed",
    )
