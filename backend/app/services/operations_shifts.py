"""Driver shift services for collection operations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import DriverShift, Vehicle
from app.services.operations_common import SHIFT_TRANSITIONS, ensure_user_belongs_to_org, validate_transition


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _shift_to_dict(shift: DriverShift) -> dict[str, Any]:
    return {
        "id": int(shift.id),
        "org_id": shift.org_id,
        "driver_user_id": shift.driver_user_id,
        "vehicle_id": shift.vehicle_id,
        "planned_start": shift.planned_start,
        "planned_end": shift.planned_end,
        "actual_start": shift.actual_start,
        "actual_end": shift.actual_end,
        "status": shift.status,
        "notes": shift.notes,
        "created_at": shift.created_at,
        "updated_at": shift.updated_at,
    }


async def _get_shift_scoped(db: AsyncSession, org_id: int, shift_id: int) -> DriverShift:
    shift = (
        await db.execute(
            select(DriverShift).where(DriverShift.id == shift_id, DriverShift.org_id == org_id).limit(1)
        )
    ).scalar_one_or_none()
    if shift is None:
        raise ValueError("shift not found")
    return shift


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


async def create_shift(db: AsyncSession, org_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Create one driver shift in scheduled state."""
    await ensure_user_belongs_to_org(db, org_id=org_id, user_id=payload["driver_user_id"])

    if payload.get("vehicle_id") is not None:
        await _ensure_vehicle_scoped(db, org_id, int(payload["vehicle_id"]))

    shift = DriverShift(
        org_id=org_id,
        driver_user_id=payload["driver_user_id"],
        vehicle_id=payload.get("vehicle_id"),
        planned_start=payload["planned_start"],
        planned_end=payload["planned_end"],
        actual_start=None,
        actual_end=None,
        status="scheduled",
        notes=payload.get("notes"),
    )
    db.add(shift)
    await db.commit()
    await db.refresh(shift)
    return _shift_to_dict(shift)


async def get_shift(db: AsyncSession, org_id: int, shift_id: int) -> dict[str, Any]:
    """Fetch one org-scoped shift."""
    shift = await _get_shift_scoped(db, org_id, shift_id)
    return _shift_to_dict(shift)


async def start_shift(db: AsyncSession, org_id: int, shift_id: int) -> dict[str, Any]:
    """Transition one shift to started state."""
    shift = await _get_shift_scoped(db, org_id, shift_id)
    validate_transition(current_status=shift.status, next_status="started", transitions=SHIFT_TRANSITIONS)

    now = _now_utc()
    shift.status = "started"
    shift.actual_start = shift.actual_start or now
    await db.commit()
    await db.refresh(shift)
    return _shift_to_dict(shift)


async def complete_shift(db: AsyncSession, org_id: int, shift_id: int) -> dict[str, Any]:
    """Transition one shift to completed state."""
    shift = await _get_shift_scoped(db, org_id, shift_id)
    validate_transition(current_status=shift.status, next_status="completed", transitions=SHIFT_TRANSITIONS)

    now = _now_utc()
    shift.status = "completed"
    shift.actual_start = shift.actual_start or now
    shift.actual_end = now
    await db.commit()
    await db.refresh(shift)
    return _shift_to_dict(shift)


async def list_shifts(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    driver_user_id: int | None = None,
    vehicle_id: int | None = None,
) -> dict[str, Any]:
    """Return paginated organization-scoped shifts."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [DriverShift.org_id == org_id]
    if status:
        filters.append(DriverShift.status == status)
    if driver_user_id is not None:
        filters.append(DriverShift.driver_user_id == driver_user_id)
    if vehicle_id is not None:
        filters.append(DriverShift.vehicle_id == vehicle_id)

    total = (await db.execute(select(func.count(DriverShift.id)).where(*filters))).scalar_one() or 0
    rows = (
        await db.execute(
            select(DriverShift)
            .where(*filters)
            .order_by(DriverShift.planned_start.desc(), DriverShift.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_shift_to_dict(row) for row in rows],
    }
