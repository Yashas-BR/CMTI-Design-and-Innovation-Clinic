"""Device CRUD and query services."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin, BinDevice


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _device_to_dict(device: BinDevice, org_id: int) -> dict[str, Any]:
    return {
        "id": device.id,
        "bin_id": device.bin_id,
        "org_id": org_id,
        "device_uid": device.device_uid,
        "mqtt_client_id": device.mqtt_client_id,
        "firmware_version": device.firmware_version,
        "hardware_revision": device.hardware_revision,
        "status": device.status,
        "installed_at": device.installed_at,
        "decommissioned_at": device.decommissioned_at,
        "last_seen_at": device.last_seen_at,
        "created_at": device.created_at,
        "updated_at": device.updated_at,
    }


async def _get_bin_scoped(db: AsyncSession, org_id: int, bin_id: int) -> Bin:
    bin_obj = (
        await db.execute(select(Bin).where(Bin.id == bin_id, Bin.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if bin_obj is None:
        raise ValueError("bin not found")
    return bin_obj


async def _get_device_scoped(db: AsyncSession, org_id: int, device_id: int) -> tuple[BinDevice, int]:
    row = (
        await db.execute(
            select(BinDevice, Bin.org_id)
            .join(Bin, Bin.id == BinDevice.bin_id)
            .where(BinDevice.id == device_id, Bin.org_id == org_id)
            .limit(1)
        )
    ).first()
    if row is None:
        raise ValueError("device not found")
    return row[0], int(row[1])


async def create_device(db: AsyncSession, org_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Create one device attached to a bin in the same organization."""
    target_bin = await _get_bin_scoped(db, org_id, int(payload["bin_id"]))

    device = BinDevice(
        bin_id=target_bin.id,
        device_uid=payload["device_uid"],
        mqtt_client_id=payload["mqtt_client_id"],
        firmware_version=payload.get("firmware_version"),
        hardware_revision=payload.get("hardware_revision"),
        status=payload.get("status", "online"),
        installed_at=payload.get("installed_at"),
        decommissioned_at=payload.get("decommissioned_at"),
        last_seen_at=payload.get("last_seen_at"),
    )

    db.add(device)
    await db.commit()
    await db.refresh(device)
    return _device_to_dict(device, org_id)


async def get_device(db: AsyncSession, org_id: int, device_id: int) -> dict[str, Any]:
    """Fetch one org-scoped device by id."""
    device, resolved_org_id = await _get_device_scoped(db, org_id, device_id)
    return _device_to_dict(device, resolved_org_id)


async def update_device(db: AsyncSession, org_id: int, device_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Partially update one org-scoped device."""
    device, resolved_org_id = await _get_device_scoped(db, org_id, device_id)

    for key, value in payload.items():
        setattr(device, key, value)

    await db.commit()
    await db.refresh(device)
    return _device_to_dict(device, resolved_org_id)


async def deactivate_device(db: AsyncSession, org_id: int, device_id: int) -> dict[str, Any]:
    """Soft deactivate one org-scoped device."""
    device, resolved_org_id = await _get_device_scoped(db, org_id, device_id)
    device.status = "decommissioned"
    device.decommissioned_at = device.decommissioned_at or _now_utc()
    await db.commit()
    await db.refresh(device)
    return _device_to_dict(device, resolved_org_id)


async def list_devices(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    bin_id: int | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """Return paginated devices with optional filters."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [Bin.org_id == org_id]
    if status:
        filters.append(BinDevice.status == status)
    if bin_id is not None:
        filters.append(BinDevice.bin_id == bin_id)
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                BinDevice.device_uid.ilike(pattern),
                BinDevice.mqtt_client_id.ilike(pattern),
            )
        )

    total = (
        await db.execute(
            select(func.count(BinDevice.id)).select_from(BinDevice).join(Bin, Bin.id == BinDevice.bin_id).where(*filters)
        )
    ).scalar_one() or 0

    rows = (
        await db.execute(
            select(BinDevice, Bin.org_id)
            .join(Bin, Bin.id == BinDevice.bin_id)
            .where(*filters)
            .order_by(BinDevice.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).all()

    items = [_device_to_dict(row[0], int(row[1])) for row in rows]
    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": items,
    }


async def search_devices(
    db: AsyncSession,
    org_id: int,
    *,
    q: str,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
) -> dict[str, Any]:
    """Search devices by device uid and mqtt client id."""
    if not q.strip():
        raise ValueError("query must not be empty")
    return await list_devices(
        db,
        org_id,
        limit=limit,
        offset=offset,
        status=status,
        q=q,
    )
