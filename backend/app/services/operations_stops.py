"""Route stop execution and collection event services."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Alert, AlertEvent, Bin, BinCurrentState, CollectionEvent, Route, RouteAssignment, RouteStop
from app.services.bin_state_realtime import broadcast_bin_current_state_update
from app.services.operations_audit import append_audit_log, find_audit_by_request
from app.services.operations_common import STOP_TRANSITIONS, validate_transition
from app.services.operations_routes import auto_complete_route_if_terminal


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


async def list_driver_stops(
    db: AsyncSession,
    org_id: int,
    *,
    driver_user_id: int,
    limit: int = 100,
    offset: int = 0,
    status: str | None = None,
    route_status: str | None = None,
    route_date: date | None = None,
    assignment_status: str | None = None,
) -> dict[str, Any]:
    """List stops across routes assigned to one driver with route and assignment context."""
    safe_limit = min(max(limit, 1), 500)
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

    filters = [Route.org_id == org_id]
    if status:
        filters.append(RouteStop.status == status)
    if route_status:
        filters.append(Route.status == route_status)
    if route_date is not None:
        filters.append(Route.route_date == route_date)
    if assignment_status:
        filters.append(RouteAssignment.status == assignment_status)

    base_query = (
        select(
            RouteStop,
            Route,
            RouteAssignment,
            Bin.bin_code,
        )
        .join(Route, Route.id == RouteStop.route_id)
        .join(
            latest_assignment_subquery,
            latest_assignment_subquery.c.route_id == Route.id,
        )
        .join(
            RouteAssignment,
            RouteAssignment.id == latest_assignment_subquery.c.assignment_id,
        )
        .join(Bin, Bin.id == RouteStop.bin_id)
        .where(*filters)
    )

    total = (
        await db.execute(select(func.count()).select_from(base_query.subquery()))
    ).scalar_one() or 0

    rows = (
        await db.execute(
            base_query
            .order_by(Route.route_date.desc(), Route.id.desc(), RouteStop.stop_sequence.asc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).all()

    items: list[dict[str, Any]] = []
    for stop, route, assignment, bin_code in rows:
        stop_payload = _stop_to_dict(stop)
        stop_payload.update(
            {
                "route_code": route.route_code,
                "route_date": route.route_date,
                "route_status": route.status,
                "assignment_id": int(assignment.id),
                "assignment_status": assignment.status,
                "vehicle_id": assignment.vehicle_id,
                "bin_code": bin_code,
            }
        )
        items.append(stop_payload)

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": items,
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


def _derive_alert_level(fill_pct: float, *, threshold_green: float, threshold_yellow: float) -> str:
    if fill_pct >= threshold_yellow:
        return "RED"
    if fill_pct >= threshold_green:
        return "YELLOW"
    return "GREEN"


async def _sync_bin_state_after_service(
    db: AsyncSession,
    *,
    org_id: int,
    stop: RouteStop,
    event_ts: datetime,
    fill_after_pct: float | None,
    actor_user_id: int,
) -> None:
    bin_obj = (
        await db.execute(
            select(Bin)
            .where(Bin.id == stop.bin_id, Bin.org_id == org_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if bin_obj is None:
        return

    effective_fill_after = max(0.0, min(100.0, fill_after_pct if fill_after_pct is not None else 0.0))
    alert_level = _derive_alert_level(
        effective_fill_after,
        threshold_green=float(bin_obj.threshold_green),
        threshold_yellow=float(bin_obj.threshold_yellow),
    )

    state = (
        await db.execute(select(BinCurrentState).where(BinCurrentState.bin_id == stop.bin_id).limit(1))
    ).scalar_one_or_none()
    now = _now_utc()
    if state is None:
        db.add(
            BinCurrentState(
                bin_id=stop.bin_id,
                last_telemetry_id=None,
                device_id=None,
                last_measured_at=event_ts,
                current_fill_pct=Decimal(str(effective_fill_after)),
                current_fill_rate_pct_per_min=None,
                current_ttf_min=None,
                current_priority_score=None,
                current_alert_level=alert_level,
                overflow_imminent=False,
                device_connectivity_state="unknown",
                queued_count=0,
                updated_at=now,
            )
        )
    else:
        state.last_measured_at = event_ts
        state.current_fill_pct = Decimal(str(effective_fill_after))
        state.current_fill_rate_pct_per_min = None
        state.current_ttf_min = None
        state.current_priority_score = None
        state.current_alert_level = alert_level
        state.overflow_imminent = False
        state.queued_count = 0
        state.updated_at = now

    bin_obj.last_service_at = event_ts
    bin_obj.updated_by = actor_user_id


async def _resolve_service_related_alerts(
    db: AsyncSession,
    *,
    org_id: int,
    stop: RouteStop,
    actor_user_id: int,
    event_ts: datetime,
) -> None:
    open_alerts = (
        await db.execute(
            select(Alert).where(
                Alert.org_id == org_id,
                Alert.bin_id == stop.bin_id,
                Alert.status == "open",
                Alert.alert_type.in_(["fill_threshold", "overflow_imminent"]),
            )
        )
    ).scalars().all()

    if not open_alerts:
        return

    now = _now_utc()
    for alert in open_alerts:
        alert.status = "resolved"
        alert.resolved_at = now
        alert.acknowledged_at = alert.acknowledged_at or now
        alert.updated_at = now
        db.add(
            AlertEvent(
                alert_id=alert.id,
                event_type="resolved",
                actor_user_id=actor_user_id,
                event_ts=event_ts,
                note="Resolved automatically after stop was serviced.",
                payload_json={"source": "stop_service", "route_stop_id": int(stop.id)},
            )
        )


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

    await _sync_bin_state_after_service(
        db,
        org_id=org_id,
        stop=stop,
        event_ts=event_ts,
        fill_after_pct=fill_after_pct,
        actor_user_id=actor_user_id,
    )

    await _resolve_service_related_alerts(
        db,
        org_id=org_id,
        stop=stop,
        actor_user_id=actor_user_id,
        event_ts=event_ts,
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

    await auto_complete_route_if_terminal(
        db,
        org_id=org_id,
        route_id=route.id,
        actor_user_id=actor_user_id,
    )

    await db.commit()
    await db.refresh(stop)
    await broadcast_bin_current_state_update(db, bin_id=stop.bin_id)
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

    await auto_complete_route_if_terminal(
        db,
        org_id=org_id,
        route_id=route.id,
        actor_user_id=actor_user_id,
    )

    await db.commit()
    await db.refresh(stop)
    return _stop_to_dict(stop)
