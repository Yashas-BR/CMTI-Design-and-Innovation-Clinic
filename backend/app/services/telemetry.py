"""Telemetry read services for dashboard APIs."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Alert, Bin, BinCurrentState, BinTelemetry


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


async def _get_bin_by_code(db: AsyncSession, bin_code: str) -> Bin:
    bin_obj = (await db.execute(select(Bin).where(Bin.bin_code == bin_code).limit(1))).scalar_one_or_none()
    if bin_obj is None:
        raise ValueError(f"bin not found: {bin_code}")
    return bin_obj


async def get_bin_latest_state(db: AsyncSession, bin_code: str) -> dict[str, Any]:
    """Return latest state from bin_current_state for one bin."""
    bin_obj = await _get_bin_by_code(db, bin_code)
    state = (await db.execute(select(BinCurrentState).where(BinCurrentState.bin_id == bin_obj.id))).scalar_one_or_none()

    if state is None:
        return {
            "bin_code": bin_obj.bin_code,
            "last_measured_at": None,
            "current_fill_pct": None,
            "current_fill_rate_pct_per_min": None,
            "current_ttf_min": None,
            "current_priority_score": None,
            "current_alert_level": None,
            "overflow_imminent": False,
            "device_connectivity_state": "unknown",
            "queued_count": 0,
        }

    return {
        "bin_code": bin_obj.bin_code,
        "last_measured_at": state.last_measured_at,
        "current_fill_pct": _to_float(state.current_fill_pct),
        "current_fill_rate_pct_per_min": _to_float(state.current_fill_rate_pct_per_min),
        "current_ttf_min": _to_float(state.current_ttf_min),
        "current_priority_score": _to_float(state.current_priority_score),
        "current_alert_level": state.current_alert_level,
        "overflow_imminent": bool(state.overflow_imminent),
        "device_connectivity_state": state.device_connectivity_state,
        "queued_count": int(state.queued_count),
    }


async def get_bin_history(db: AsyncSession, bin_code: str, limit: int = 100) -> dict[str, Any]:
    """Return latest telemetry history rows for one bin."""
    safe_limit = min(max(limit, 1), 1000)
    bin_obj = await _get_bin_by_code(db, bin_code)

    rows = (
        await db.execute(
            select(BinTelemetry)
            .where(BinTelemetry.bin_id == bin_obj.id)
            .order_by(BinTelemetry.measured_at.desc())
            .limit(safe_limit)
        )
    ).scalars().all()

    items = [
        {
            "measured_at": row.measured_at,
            "fill_pct": _to_float(row.fill_pct),
            "fill_rate_pct_per_min": _to_float(row.fill_rate_pct_per_min),
            "ttf_min": _to_float(row.ttf_min),
            "priority_score": _to_float(row.priority_score),
            "alert_level": row.alert_level,
            "overflow_imminent": bool(row.overflow_imminent),
            "queued": bool(row.queued),
        }
        for row in rows
    ]

    return {
        "bin_code": bin_obj.bin_code,
        "items": items,
    }


async def get_live_summary(db: AsyncSession) -> dict[str, int]:
    """Return aggregated counters for live cards."""
    total_bins = (await db.execute(select(func.count(Bin.id)))).scalar_one() or 0
    bins_with_state = (await db.execute(select(func.count(BinCurrentState.bin_id)))).scalar_one() or 0

    red_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(BinCurrentState.current_alert_level == "RED")
        )
    ).scalar_one() or 0
    yellow_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(BinCurrentState.current_alert_level == "YELLOW")
        )
    ).scalar_one() or 0
    overflow_imminent_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(BinCurrentState.overflow_imminent.is_(True))
        )
    ).scalar_one() or 0
    offline_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(BinCurrentState.device_connectivity_state == "offline")
        )
    ).scalar_one() or 0

    open_alerts = (
        await db.execute(select(func.count(Alert.id)).where(Alert.status == "open"))
    ).scalar_one() or 0

    return {
        "total_bins": int(total_bins),
        "bins_with_state": int(bins_with_state),
        "red_bins": int(red_bins),
        "yellow_bins": int(yellow_bins),
        "overflow_imminent_bins": int(overflow_imminent_bins),
        "offline_bins": int(offline_bins),
        "open_alerts": int(open_alerts),
    }
