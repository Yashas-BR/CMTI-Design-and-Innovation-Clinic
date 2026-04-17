"""Bin-device assignment history services."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin, BinDevice, BinDeviceHistory


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _history_to_dict(row: BinDeviceHistory) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "bin_id": row.bin_id,
        "device_id": row.device_id,
        "active_from": row.active_from,
        "active_to": row.active_to,
        "notes": row.notes,
        "created_at": row.created_at,
    }


async def _get_bin_scoped(db: AsyncSession, org_id: int, bin_id: int) -> Bin:
    bin_obj = (
        await db.execute(select(Bin).where(Bin.id == bin_id, Bin.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if bin_obj is None:
        raise ValueError("bin not found")
    return bin_obj


async def _get_device_scoped(db: AsyncSession, org_id: int, device_id: int) -> BinDevice:
    row = (
        await db.execute(
            select(BinDevice)
            .join(Bin, Bin.id == BinDevice.bin_id)
            .where(BinDevice.id == device_id, Bin.org_id == org_id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise ValueError("device not found")
    return row


async def assign_device_to_bin(
    db: AsyncSession,
    org_id: int,
    *,
    device_id: int,
    bin_id: int,
    notes: str | None = None,
    active_from: datetime | None = None,
) -> dict[str, Any]:
    """Assign or reassign a device to a bin and update history."""
    device = await _get_device_scoped(db, org_id, device_id)
    target_bin = await _get_bin_scoped(db, org_id, bin_id)

    if device.bin_id == target_bin.id:
        raise ValueError("device already assigned to this bin")

    assigned_from = active_from or _now_utc()

    open_history_rows = (
        await db.execute(
            select(BinDeviceHistory)
            .where(BinDeviceHistory.device_id == device.id, BinDeviceHistory.active_to.is_(None))
            .order_by(BinDeviceHistory.active_from.desc())
        )
    ).scalars().all()

    for history in open_history_rows:
        history.active_to = assigned_from

    device.bin_id = target_bin.id

    new_history = BinDeviceHistory(
        bin_id=target_bin.id,
        device_id=device.id,
        active_from=assigned_from,
        active_to=None,
        notes=notes,
        created_at=_now_utc(),
    )
    db.add(new_history)

    await db.commit()
    await db.refresh(new_history)
    return _history_to_dict(new_history)


async def list_bin_assignments(
    db: AsyncSession,
    org_id: int,
    *,
    bin_id: int,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Return assignment history for one org-scoped bin."""
    await _get_bin_scoped(db, org_id, bin_id)

    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    total = (
        await db.execute(
            select(func.count(BinDeviceHistory.id))
            .select_from(BinDeviceHistory)
            .join(Bin, Bin.id == BinDeviceHistory.bin_id)
            .where(Bin.org_id == org_id, BinDeviceHistory.bin_id == bin_id)
        )
    ).scalar_one() or 0

    rows = (
        await db.execute(
            select(BinDeviceHistory)
            .join(Bin, Bin.id == BinDeviceHistory.bin_id)
            .where(Bin.org_id == org_id, BinDeviceHistory.bin_id == bin_id)
            .order_by(BinDeviceHistory.active_from.desc(), BinDeviceHistory.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_history_to_dict(row) for row in rows],
    }


async def list_device_assignments(
    db: AsyncSession,
    org_id: int,
    *,
    device_id: int,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """Return assignment history for one org-scoped device."""
    device = await _get_device_scoped(db, org_id, device_id)

    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    total = (
        await db.execute(
            select(func.count(BinDeviceHistory.id)).where(BinDeviceHistory.device_id == device.id)
        )
    ).scalar_one() or 0

    rows = (
        await db.execute(
            select(BinDeviceHistory)
            .where(BinDeviceHistory.device_id == device.id)
            .order_by(BinDeviceHistory.active_from.desc(), BinDeviceHistory.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_history_to_dict(row) for row in rows],
    }
