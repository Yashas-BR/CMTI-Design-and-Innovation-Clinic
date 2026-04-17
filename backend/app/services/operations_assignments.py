"""Route assignment services for collection operations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Route, RouteAssignment, Vehicle
from app.services.operations_audit import append_audit_log
from app.services.operations_common import ASSIGNMENT_TRANSITIONS, ensure_user_belongs_to_org, validate_transition


AUTHORITY_ROLES = {"authority_admin", "authority_operator"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_authority(actor_roles: set[str]) -> bool:
    return bool(AUTHORITY_ROLES.intersection(actor_roles))


def _assignment_to_dict(assignment: RouteAssignment) -> dict[str, Any]:
    return {
        "id": int(assignment.id),
        "route_id": int(assignment.route_id),
        "driver_user_id": assignment.driver_user_id,
        "vehicle_id": assignment.vehicle_id,
        "assigned_by": assignment.assigned_by,
        "assigned_at": assignment.assigned_at,
        "accepted_at": assignment.accepted_at,
        "rejected_at": assignment.rejected_at,
        "reject_reason": assignment.reject_reason,
        "status": assignment.status,
    }


async def _get_route_scoped(db: AsyncSession, org_id: int, route_id: int) -> Route:
    route = (
        await db.execute(select(Route).where(Route.id == route_id, Route.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if route is None:
        raise ValueError("route not found")
    return route


async def _get_assignment_scoped(db: AsyncSession, org_id: int, assignment_id: int) -> RouteAssignment:
    assignment = (
        await db.execute(
            select(RouteAssignment)
            .join(Route, Route.id == RouteAssignment.route_id)
            .where(RouteAssignment.id == assignment_id, Route.org_id == org_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise ValueError("assignment not found")
    return assignment


async def _ensure_vehicle_scoped(db: AsyncSession, org_id: int, vehicle_id: int) -> Vehicle:
    vehicle = (
        await db.execute(
            select(Vehicle)
            .where(Vehicle.id == vehicle_id, Vehicle.org_id == org_id, Vehicle.is_active.is_(True))
            .limit(1)
        )
    ).scalar_one_or_none()
    if vehicle is None:
        raise ValueError("vehicle not found or inactive")
    return vehicle


async def create_route_assignment(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    *,
    route_id: int,
    driver_user_id: int,
    vehicle_id: int | None,
) -> dict[str, Any]:
    """Create one route assignment for a published or in-progress route."""
    route = await _get_route_scoped(db, org_id, route_id)

    if route.status not in {"published", "in_progress"}:
        raise ValueError("route must be published or in_progress for assignment")

    await ensure_user_belongs_to_org(db, org_id=org_id, user_id=driver_user_id)
    if vehicle_id is not None:
        await _ensure_vehicle_scoped(db, org_id, vehicle_id)

    active_count = (
        await db.execute(
            select(func.count(RouteAssignment.id)).where(
                RouteAssignment.route_id == route.id,
                RouteAssignment.status.in_(["assigned", "accepted"]),
            )
        )
    ).scalar_one() or 0

    if int(active_count) > 0:
        raise ValueError("route already has an active assignment")

    assignment = RouteAssignment(
        route_id=route.id,
        driver_user_id=driver_user_id,
        vehicle_id=vehicle_id,
        assigned_by=actor_user_id,
        assigned_at=_now_utc(),
        accepted_at=None,
        rejected_at=None,
        reject_reason=None,
        status="assigned",
    )
    db.add(assignment)
    await db.flush()

    after_state = _assignment_to_dict(assignment)
    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="assignment_created",
        entity_type="route_assignment",
        entity_id=str(assignment.id),
        before_json=None,
        after_json=after_state,
    )

    await db.commit()
    await db.refresh(assignment)
    return _assignment_to_dict(assignment)


async def list_route_assignments(
    db: AsyncSession,
    org_id: int,
    *,
    route_id: int,
    limit: int = 50,
    offset: int = 0,
    driver_user_id: int | None = None,
) -> dict[str, Any]:
    """Return assignment history for one route with optional driver scoping."""
    route = await _get_route_scoped(db, org_id, route_id)

    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [RouteAssignment.route_id == route.id]
    if driver_user_id is not None:
        filters.append(RouteAssignment.driver_user_id == driver_user_id)

    total = (await db.execute(select(func.count(RouteAssignment.id)).where(*filters))).scalar_one() or 0

    rows = (
        await db.execute(
            select(RouteAssignment)
            .where(*filters)
            .order_by(RouteAssignment.assigned_at.desc(), RouteAssignment.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_assignment_to_dict(row) for row in rows],
    }


def _enforce_driver_scope(
    *,
    actor_user_id: int,
    actor_roles: set[str],
    assignment: RouteAssignment,
) -> None:
    if _is_authority(actor_roles):
        return
    if assignment.driver_user_id != actor_user_id:
        raise PermissionError("drivers can only act on their own assignments")


async def accept_route_assignment(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    assignment_id: int,
) -> dict[str, Any]:
    """Accept one assignment if transition and caller scope are valid."""
    assignment = await _get_assignment_scoped(db, org_id, assignment_id)
    _enforce_driver_scope(actor_user_id=actor_user_id, actor_roles=actor_roles, assignment=assignment)

    before_state = _assignment_to_dict(assignment)

    if assignment.status == "accepted":
        return before_state

    validate_transition(
        current_status=assignment.status,
        next_status="accepted",
        transitions=ASSIGNMENT_TRANSITIONS,
    )

    assignment.status = "accepted"
    assignment.accepted_at = _now_utc()
    assignment.rejected_at = None
    assignment.reject_reason = None

    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="assignment_accepted",
        entity_type="route_assignment",
        entity_id=str(assignment.id),
        before_json=before_state,
        after_json=_assignment_to_dict(assignment),
    )

    await db.commit()
    await db.refresh(assignment)
    return _assignment_to_dict(assignment)


async def reject_route_assignment(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    assignment_id: int,
    reject_reason: str,
) -> dict[str, Any]:
    """Reject one assignment if transition and caller scope are valid."""
    assignment = await _get_assignment_scoped(db, org_id, assignment_id)
    _enforce_driver_scope(actor_user_id=actor_user_id, actor_roles=actor_roles, assignment=assignment)

    before_state = _assignment_to_dict(assignment)

    if assignment.status == "rejected":
        return before_state

    validate_transition(
        current_status=assignment.status,
        next_status="rejected",
        transitions=ASSIGNMENT_TRANSITIONS,
    )

    assignment.status = "rejected"
    assignment.accepted_at = None
    assignment.rejected_at = _now_utc()
    assignment.reject_reason = reject_reason

    await append_audit_log(
        db,
        org_id=org_id,
        user_id=actor_user_id,
        action_type="assignment_rejected",
        entity_type="route_assignment",
        entity_id=str(assignment.id),
        before_json=before_state,
        after_json=_assignment_to_dict(assignment),
    )

    await db.commit()
    await db.refresh(assignment)
    return _assignment_to_dict(assignment)
