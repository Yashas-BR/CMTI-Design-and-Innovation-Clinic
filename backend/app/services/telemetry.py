"""Telemetry read services for dashboard APIs."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Alert, Bin, BinCurrentState, BinTelemetry

LOGGER = logging.getLogger(__name__)


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bin_code_candidates(bin_code: str) -> list[str]:
    """Return bin-code lookup candidates preserving input priority."""
    normalized = bin_code.strip()
    if not normalized:
        return []

    candidates = [normalized]
    separator_swaps = (
        normalized.replace("-", "_"),
        normalized.replace("_", "-"),
    )
    for candidate in separator_swaps:
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    return candidates


async def _get_bin_by_code(db: AsyncSession, bin_code: str, org_id: int | None = None) -> Bin:
    """Fetch a bin by code, optionally scoped to an organization."""
    lookup_codes = _bin_code_candidates(bin_code)
    if not lookup_codes:
        raise ValueError(f"bin not found: {bin_code}")

    for lookup_code in lookup_codes:
        stmt = select(Bin).where(Bin.bin_code == lookup_code)
        if org_id is not None:
            stmt = stmt.where(Bin.org_id == org_id)
        bin_obj = (await db.execute(stmt.limit(1))).scalar_one_or_none()
        if bin_obj is not None:
            return bin_obj

    lowered_codes: list[str] = []
    for lookup_code in lookup_codes:
        lowered = lookup_code.lower()
        if lowered in lowered_codes:
            continue
        lowered_codes.append(lowered)

    for lowered in lowered_codes:
        stmt = select(Bin).where(func.lower(Bin.bin_code) == lowered)
        if org_id is not None:
            stmt = stmt.where(Bin.org_id == org_id)
        bin_obj = (await db.execute(stmt.limit(1))).scalar_one_or_none()
        if bin_obj is not None:
            return bin_obj

    raise ValueError(f"bin not found: {bin_code}")


async def get_bin_latest_state(db: AsyncSession, bin_code: str, org_id: int | None = None) -> dict[str, Any]:
    """Return latest state from bin_current_state for one bin.

    Pass org_id to scope the lookup to the caller's organization and prevent
    cross-organization data leaks.

    Fallback chain:
    1. ``bin_current_state`` — fastest, updated on every MQTT ingest.
    2. Latest ``bin_telemetry`` row — used when the current-state upsert did not
       run yet (e.g. first boot after the migration, or legacy data).
    3. All-null sentinel — no data has been ingested for this bin yet.
    """
    bin_obj = await _get_bin_by_code(db, bin_code, org_id=org_id)
    state = (
        await db.execute(
            select(BinCurrentState)
            .where(BinCurrentState.bin_id == bin_obj.id)
            .limit(1)
        )
    ).scalar_one_or_none()

    if state is not None:
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

    # --- Fallback: read the most recent bin_telemetry row -------------------------
    latest_row = (
        await db.execute(
            select(BinTelemetry)
            .where(BinTelemetry.bin_id == bin_obj.id)
            .order_by(BinTelemetry.measured_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if latest_row is not None:
        LOGGER.info(
            "bin_current_state missing for bin %s — serving latest bin_telemetry row id=%s",
            bin_obj.bin_code,
            latest_row.id,
        )
        return {
            "bin_code": bin_obj.bin_code,
            "last_measured_at": latest_row.measured_at,
            "current_fill_pct": _to_float(latest_row.fill_pct),
            "current_fill_rate_pct_per_min": _to_float(latest_row.fill_rate_pct_per_min),
            "current_ttf_min": _to_float(latest_row.ttf_min),
            "current_priority_score": _to_float(latest_row.priority_score),
            "current_alert_level": latest_row.alert_level,
            "overflow_imminent": bool(latest_row.overflow_imminent),
            "device_connectivity_state": "unknown",
            "queued_count": 1 if latest_row.queued else 0,
        }

    # --- No data at all for this bin ---------------------------------------------
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


async def get_bin_history(db: AsyncSession, bin_code: str, limit: int = 100, org_id: int | None = None) -> dict[str, Any]:
    """Return latest telemetry history rows for one bin."""
    safe_limit = min(max(limit, 1), 1000)
    bin_obj = await _get_bin_by_code(db, bin_code, org_id=org_id)

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


async def get_live_summary(db: AsyncSession, org_id: int | None = None) -> dict[str, int]:
    """Return aggregated counters for live cards, optionally scoped to one org."""
    bin_filter = [Bin.org_id == org_id] if org_id is not None else []
    state_filter = (
        [BinCurrentState.bin_id.in_(select(Bin.id).where(*bin_filter))]
        if org_id is not None
        else []
    )
    alert_filter = [Alert.org_id == org_id] if org_id is not None else []

    total_bins = (await db.execute(select(func.count(Bin.id)).where(*bin_filter))).scalar_one() or 0
    bins_with_state = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(*state_filter)
        )
    ).scalar_one() or 0

    red_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(
                BinCurrentState.current_alert_level == "RED", *state_filter
            )
        )
    ).scalar_one() or 0
    yellow_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(
                BinCurrentState.current_alert_level == "YELLOW", *state_filter
            )
        )
    ).scalar_one() or 0
    overflow_imminent_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(
                BinCurrentState.overflow_imminent.is_(True), *state_filter
            )
        )
    ).scalar_one() or 0
    offline_bins = (
        await db.execute(
            select(func.count(BinCurrentState.bin_id)).where(
                BinCurrentState.device_connectivity_state == "offline", *state_filter
            )
        )
    ).scalar_one() or 0

    open_alerts = (
        await db.execute(
            select(func.count(Alert.id)).where(Alert.status == "open", *alert_filter)
        )
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
