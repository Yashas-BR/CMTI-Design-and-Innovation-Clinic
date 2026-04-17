"""Route planning and route lifecycle services for collection operations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from math import atan2, cos, radians, sin, sqrt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin, BinCurrentState, Route, RouteStop
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


async def _get_candidate_bins(
    db: AsyncSession,
    org_id: int,
    *,
    include_bin_ids: list[int] | None,
    min_fill_pct: float,
    overflow_only: bool,
) -> list[CandidateBin]:
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
            )
        )

    candidates.sort(key=lambda row: (-row.priority_score, row.bin_id))
    return candidates


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
    speed_km_per_min = avg_speed_kmph / 60.0
    estimated_duration_min = (total_distance_km / speed_km_per_min) + (service_minutes_per_stop * len(stop_items))

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
