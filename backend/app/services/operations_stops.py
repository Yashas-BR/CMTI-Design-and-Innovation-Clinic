"""Route stop execution and collection event services."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import CollectionEvent, Route, RouteAssignment, RouteStop
from app.services.operations_audit import append_audit_log, find_audit_by_request
from app.services.operations_common import STOP_TRANSITIONS, validate_transition


AUTHORITY_ROLES = {"authority_admin", "authority_operator"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_authority(actor_roles: set[str]) -> bool:
    return bool(AUTHORITY_ROLES.intersection(actor_roles))


def _stop_to_dict(stop: RouteStop) -> dict[str, Any]:
    return {
        "id": int(stop.id),
        "route_id": int(stop.route_id),
        "stop_sequence": stop.stop_sequence,
        "bin_id": stop.bin_id,
        "planned_eta": stop.planned_eta,
        "planned_service_minutes": float(stop.planned_service_minutes) if stop.planned_service_minutes is not None else None,
        "priority_snapshot": float(stop.priority_snapshot) if stop.priority_snapshot is not None else None,
        "status": stop.status,
        "actual_arrival": stop.actual_arrival,
        "actual_departure": stop.actual_departure,
        "skip_reason": stop.skip_reason,
    }


async def _get_route_scoped(db: AsyncSession, org_id: int, route_id: int) -> Route:
    route = (
        await db.execute(select(Route).where(Route.id == route_id, Route.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if route is None:
        raise ValueError("route not found")
    return route


async def _get_stop_scoped(db: AsyncSession, org_id: int, stop_id: int) -> tuple[RouteStop, Route]:
    row = (
        await db.execute(
            select(RouteStop, Route)
            .join(Route, Route.id == RouteStop.route_id)
            .where(RouteStop.id == stop_id, Route.org_id == org_id)
            .limit(1)
        )
    ).first()
    if row is None:
        raise ValueError("stop not found")
    return row[0], row[1]


async def _get_latest_active_assignment(
    db: AsyncSession,
    *,
    route_id: int,
) -> RouteAssignment | None:
    return (
        await db.execute(
            select(RouteAssignment)
            .where(
                RouteAssignment.route_id == route_id,
                RouteAssignment.status.in_(["assigned", "accepted"]),
            )
            .order_by(RouteAssignment.assigned_at.desc(), RouteAssignment.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


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
        raise PermissionError("driver can only access stops for assigned routes")
    return assignment


async def list_route_stops(
    db: AsyncSession,
    org_id: int,
    *,
    route_id: int,
    limit: int = 100,
    offset: int = 0,
    driver_user_id: int | None = None,
) -> dict[str, Any]:
    """List route stops with optional driver ownership enforcement."""
    route = await _get_route_scoped(db, org_id, route_id)

    if driver_user_id is not None:
        await _ensure_driver_route_scope(db, route_id=route.id, driver_user_id=driver_user_id)

    safe_limit = min(max(limit, 1), 500)
    safe_offset = max(offset, 0)

    total = (
        await db.execute(select(func.count(RouteStop.id)).where(RouteStop.route_id == route.id))
    ).scalar_one() or 0

    rows = (
        await db.execute(
            select(RouteStop)
            .where(RouteStop.route_id == route.id)
            .order_by(RouteStop.stop_sequence.asc(), RouteStop.id.asc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_stop_to_dict(row) for row in rows],
    }


async def _append_collection_event(
    db: AsyncSession,
    *,
    org_id: int,
    stop: RouteStop,
    route: Route,
    assignment: RouteAssignment | None,
    driver_user_id: int | None,
    event_type: str,
    event_ts: datetime,
    fill_before_pct: float | None = None,
    fill_after_pct: float | None = None,
    gps_latitude: float | None = None,
    gps_longitude: float | None = None,
    notes: str | None = None,
    photo_url: str | None = None,
) -> None:
    db.add(
        CollectionEvent(
            org_id=org_id,
            bin_id=stop.bin_id,
            route_id=route.id,
            route_stop_id=stop.id,
            driver_user_id=driver_user_id,
            vehicle_id=assignment.vehicle_id if assignment is not None else None,
            event_type=event_type,
            event_ts=event_ts,
            fill_before_pct=Decimal(str(fill_before_pct)) if fill_before_pct is not None else None,
            fill_after_pct=Decimal(str(fill_after_pct)) if fill_after_pct is not None else None,
            gps_latitude=Decimal(str(gps_latitude)) if gps_latitude is not None else None,
            gps_longitude=Decimal(str(gps_longitude)) if gps_longitude is not None else None,
            notes=notes,
            photo_url=photo_url,
            created_at=_now_utc(),
        )
    )


async def _resolve_assignment_for_action(
    db: AsyncSession,
    *,
    route_id: int,
    actor_user_id: int,
    actor_roles: set[str],
) -> tuple[RouteAssignment | None, int | None]:
    if _is_authority(actor_roles):
        assignment = await _get_latest_active_assignment(db, route_id=route_id)
        driver_user_id = assignment.driver_user_id if assignment is not None else None
        return assignment, driver_user_id

    assignment = await _ensure_driver_route_scope(db, route_id=route_id, driver_user_id=actor_user_id)
    return assignment, actor_user_id


async def arrive_stop(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    stop_id: int,
    actual_arrival: datetime | None,
    gps_latitude: float | None,
    gps_longitude: float | None,
    notes: str | None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Mark one stop as arrived and append collection event."""
    stop, route = await _get_stop_scoped(db, org_id, stop_id)

    if idempotency_key:
        existing = await find_audit_by_request(
            db,
            org_id=org_id,
            action_type="stop_arrive",
            entity_type="route_stop",
            entity_id=str(stop.id),
            request_id=idempotency_key,
        )
        if existing is not None:
            return _stop_to_dict(stop)

    assignment, driver_user_id = await _resolve_assignment_for_action(
        db,
        route_id=route.id,
        actor_user_id=actor_user_id,
        actor_roles=actor_roles,
    )

    before_state = _stop_to_dict(stop)

    if stop.status == "arrived":
        return before_state

    validate_transition(current_status=stop.status, next_status="arrived", transitions=STOP_TRANSITIONS)

    event_ts = actual_arrival or _now_utc()
    stop.status = "arrived"
    stop.actual_arrival = event_ts

    await _append_collection_event(
        db,
        org_id=org_id,
        stop=stop,
        route=route,
        assignment=assignment,
        driver_user_id=driver_user_id,
        event_type="arrived",
        event_ts=event_ts,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
        notes=notes,
    )

    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="stop_arrive",
        entity_type="route_stop",
        entity_id=str(stop.id),
        before_json=before_state,
        after_json=_stop_to_dict(stop),
        request_id=idempotency_key,
    )

    await db.commit()
    await db.refresh(stop)
    return _stop_to_dict(stop)


async def service_stop(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    stop_id: int,
    actual_departure: datetime | None,
    fill_before_pct: float | None,
    fill_after_pct: float | None,
    gps_latitude: float | None,
    gps_longitude: float | None,
    notes: str | None,
    photo_url: str | None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Mark one stop as serviced and append collection event."""
    stop, route = await _get_stop_scoped(db, org_id, stop_id)

    if idempotency_key:
        existing = await find_audit_by_request(
            db,
            org_id=org_id,
            action_type="stop_service",
            entity_type="route_stop",
            entity_id=str(stop.id),
            request_id=idempotency_key,
        )
        if existing is not None:
            return _stop_to_dict(stop)

    assignment, driver_user_id = await _resolve_assignment_for_action(
        db,
        route_id=route.id,
        actor_user_id=actor_user_id,
        actor_roles=actor_roles,
    )

    before_state = _stop_to_dict(stop)

    if stop.status == "serviced":
        return before_state

    validate_transition(current_status=stop.status, next_status="serviced", transitions=STOP_TRANSITIONS)

    if fill_before_pct is not None and fill_after_pct is not None and fill_after_pct > fill_before_pct:
        raise ValueError("fill_after_pct must be less than or equal to fill_before_pct")

    event_ts = actual_departure or _now_utc()
    stop.status = "serviced"
    stop.actual_arrival = stop.actual_arrival or event_ts
    stop.actual_departure = event_ts
    stop.skip_reason = None

    await _append_collection_event(
        db,
        org_id=org_id,
        stop=stop,
        route=route,
        assignment=assignment,
        driver_user_id=driver_user_id,
        event_type="emptied",
        event_ts=event_ts,
        fill_before_pct=fill_before_pct,
        fill_after_pct=fill_after_pct,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
        notes=notes,
        photo_url=photo_url,
    )

    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="stop_service",
        entity_type="route_stop",
        entity_id=str(stop.id),
        before_json=before_state,
        after_json=_stop_to_dict(stop),
        request_id=idempotency_key,
    )

    await db.commit()
    await db.refresh(stop)
    return _stop_to_dict(stop)


async def skip_stop(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    stop_id: int,
    reason: str,
    actual_departure: datetime | None,
    gps_latitude: float | None,
    gps_longitude: float | None,
    notes: str | None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """Mark one stop as skipped and append collection event."""
    stop, route = await _get_stop_scoped(db, org_id, stop_id)

    if idempotency_key:
        existing = await find_audit_by_request(
            db,
            org_id=org_id,
            action_type="stop_skip",
            entity_type="route_stop",
            entity_id=str(stop.id),
            request_id=idempotency_key,
        )
        if existing is not None:
            return _stop_to_dict(stop)

    assignment, driver_user_id = await _resolve_assignment_for_action(
        db,
        route_id=route.id,
        actor_user_id=actor_user_id,
        actor_roles=actor_roles,
    )

    before_state = _stop_to_dict(stop)

    if stop.status == "skipped":
        return before_state

    validate_transition(current_status=stop.status, next_status="skipped", transitions=STOP_TRANSITIONS)

    event_ts = actual_departure or _now_utc()
    stop.status = "skipped"
    stop.actual_arrival = stop.actual_arrival or event_ts
    stop.actual_departure = event_ts
    stop.skip_reason = reason

    full_notes = reason if not notes else f"{reason} | {notes}"
    await _append_collection_event(
        db,
        org_id=org_id,
        stop=stop,
        route=route,
        assignment=assignment,
        driver_user_id=driver_user_id,
        event_type="skipped",
        event_ts=event_ts,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
        notes=full_notes,
    )

    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="stop_skip",
        entity_type="route_stop",
        entity_id=str(stop.id),
        before_json=before_state,
        after_json=_stop_to_dict(stop),
        request_id=idempotency_key,
    )

    await db.commit()
    await db.refresh(stop)
    return _stop_to_dict(stop)
