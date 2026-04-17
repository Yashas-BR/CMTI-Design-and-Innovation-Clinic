"""Vehicle services for collection operations."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Vehicle


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _vehicle_to_dict(vehicle: Vehicle) -> dict[str, Any]:
    return {
        "id": vehicle.id,
        "org_id": vehicle.org_id,
        "vehicle_no": vehicle.vehicle_no,
        "vehicle_type": vehicle.vehicle_type,
        "capacity_kg": _to_float(vehicle.capacity_kg),
        "status": vehicle.status,
        "is_active": bool(vehicle.is_active),
        "created_at": vehicle.created_at,
        "updated_at": vehicle.updated_at,
    }


async def _get_vehicle_scoped(db: AsyncSession, org_id: int, vehicle_id: int) -> Vehicle:
    vehicle = (
        await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if vehicle is None:
        raise ValueError("vehicle not found")
    return vehicle


async def create_vehicle(db: AsyncSession, org_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Create one vehicle for caller organization."""
    vehicle = Vehicle(
        org_id=org_id,
        vehicle_no=payload["vehicle_no"],
        vehicle_type=payload.get("vehicle_type"),
        capacity_kg=payload.get("capacity_kg"),
        status=payload.get("status", "active"),
        is_active=payload.get("is_active", True),
    )
    db.add(vehicle)
    await db.commit()
    await db.refresh(vehicle)
    return _vehicle_to_dict(vehicle)


async def get_vehicle(db: AsyncSession, org_id: int, vehicle_id: int) -> dict[str, Any]:
    """Fetch one org-scoped vehicle."""
    vehicle = await _get_vehicle_scoped(db, org_id, vehicle_id)
    return _vehicle_to_dict(vehicle)


async def update_vehicle(db: AsyncSession, org_id: int, vehicle_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Partially update one org-scoped vehicle."""
    vehicle = await _get_vehicle_scoped(db, org_id, vehicle_id)

    for key, value in payload.items():
        setattr(vehicle, key, value)

    await db.commit()
    await db.refresh(vehicle)
    return _vehicle_to_dict(vehicle)


async def deactivate_vehicle(db: AsyncSession, org_id: int, vehicle_id: int) -> dict[str, Any]:
    """Soft deactivate one org-scoped vehicle."""
    vehicle = await _get_vehicle_scoped(db, org_id, vehicle_id)
    vehicle.is_active = False
    vehicle.status = "inactive"
    await db.commit()
    await db.refresh(vehicle)
    return _vehicle_to_dict(vehicle)


async def list_vehicles(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    is_active: bool | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """Return paginated organization-scoped vehicles."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [Vehicle.org_id == org_id]
    if status:
        filters.append(Vehicle.status == status)
    if is_active is not None:
        filters.append(Vehicle.is_active.is_(is_active))
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                Vehicle.vehicle_no.ilike(pattern),
                Vehicle.vehicle_type.ilike(pattern),
            )
        )

    total = (await db.execute(select(func.count(Vehicle.id)).where(*filters))).scalar_one() or 0
    rows = (
        await db.execute(
            select(Vehicle)
            .where(*filters)
            .order_by(Vehicle.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_vehicle_to_dict(row) for row in rows],
    }
