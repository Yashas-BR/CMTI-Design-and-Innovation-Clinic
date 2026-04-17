"""Bin CRUD and query services."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bin_to_dict(bin_obj: Bin) -> dict[str, Any]:
    return {
        "id": bin_obj.id,
        "org_id": bin_obj.org_id,
        "bin_code": bin_obj.bin_code,
        "display_name": bin_obj.display_name,
        "address_line": bin_obj.address_line,
        "area_id": bin_obj.area_id,
        "depot_id": bin_obj.depot_id,
        "latitude": _to_float(bin_obj.latitude),
        "longitude": _to_float(bin_obj.longitude),
        "capacity_liters": _to_float(bin_obj.capacity_liters),
        "bin_height_cm": _to_float(bin_obj.bin_height_cm),
        "dead_zone_cm": _to_float(bin_obj.dead_zone_cm),
        "threshold_green": _to_float(bin_obj.threshold_green),
        "threshold_yellow": _to_float(bin_obj.threshold_yellow),
        "distance_factor": _to_float(bin_obj.distance_factor),
        "status": bin_obj.status,
        "installed_at": bin_obj.installed_at,
        "last_service_at": bin_obj.last_service_at,
        "is_active": bool(bin_obj.is_active),
        "created_at": bin_obj.created_at,
        "updated_at": bin_obj.updated_at,
    }


async def _get_bin_scoped(db: AsyncSession, org_id: int, bin_id: int) -> Bin:
    bin_obj = (
        await db.execute(select(Bin).where(Bin.id == bin_id, Bin.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if bin_obj is None:
        raise ValueError("bin not found")
    return bin_obj


async def create_bin(db: AsyncSession, org_id: int, actor_user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Create one bin for the authenticated organization."""
    bin_obj = Bin(
        org_id=org_id,
        bin_code=payload["bin_code"],
        display_name=payload.get("display_name"),
        address_line=payload.get("address_line"),
        area_id=payload.get("area_id"),
        depot_id=payload.get("depot_id"),
        latitude=payload.get("latitude"),
        longitude=payload.get("longitude"),
        capacity_liters=payload.get("capacity_liters"),
        bin_height_cm=payload.get("bin_height_cm", 60.0),
        dead_zone_cm=payload.get("dead_zone_cm", 5.0),
        threshold_green=payload.get("threshold_green", 50.0),
        threshold_yellow=payload.get("threshold_yellow", 80.0),
        distance_factor=payload.get("distance_factor", 0.5),
        status=payload.get("status", "active"),
        installed_at=payload.get("installed_at"),
        last_service_at=payload.get("last_service_at"),
        created_by=actor_user_id,
        updated_by=actor_user_id,
        is_active=payload.get("is_active", True),
    )
    db.add(bin_obj)
    await db.commit()
    await db.refresh(bin_obj)
    return _bin_to_dict(bin_obj)


async def get_bin(db: AsyncSession, org_id: int, bin_id: int) -> dict[str, Any]:
    """Fetch one org-scoped bin by id."""
    bin_obj = await _get_bin_scoped(db, org_id, bin_id)
    return _bin_to_dict(bin_obj)


async def update_bin(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    bin_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Partially update one org-scoped bin."""
    bin_obj = await _get_bin_scoped(db, org_id, bin_id)

    for key, value in payload.items():
        setattr(bin_obj, key, value)

    bin_obj.updated_by = actor_user_id
    await db.commit()
    await db.refresh(bin_obj)
    return _bin_to_dict(bin_obj)


async def deactivate_bin(db: AsyncSession, org_id: int, actor_user_id: int, bin_id: int) -> dict[str, Any]:
    """Soft deactivate one org-scoped bin."""
    bin_obj = await _get_bin_scoped(db, org_id, bin_id)
    bin_obj.is_active = False
    bin_obj.status = "inactive"
    bin_obj.updated_by = actor_user_id
    await db.commit()
    await db.refresh(bin_obj)
    return _bin_to_dict(bin_obj)


async def list_bins(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    is_active: bool | None = None,
    area_id: int | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """Return paginated bins with optional filters."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [Bin.org_id == org_id]
    if status:
        filters.append(Bin.status == status)
    if is_active is not None:
        filters.append(Bin.is_active.is_(is_active))
    if area_id is not None:
        filters.append(Bin.area_id == area_id)
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                Bin.bin_code.ilike(pattern),
                Bin.display_name.ilike(pattern),
                Bin.address_line.ilike(pattern),
            )
        )

    total = (await db.execute(select(func.count(Bin.id)).where(*filters))).scalar_one() or 0
    rows = (
        await db.execute(
            select(Bin)
            .where(*filters)
            .order_by(Bin.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_bin_to_dict(row) for row in rows],
    }


async def search_bins(
    db: AsyncSession,
    org_id: int,
    *,
    q: str,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
) -> dict[str, Any]:
    """Search bins by code/name/address."""
    if not q.strip():
        raise ValueError("query must not be empty")
    return await list_bins(
        db,
        org_id,
        limit=limit,
        offset=offset,
        status=status,
        q=q,
    )
