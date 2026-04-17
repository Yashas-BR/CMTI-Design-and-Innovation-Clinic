"""Realtime bin current-state broadcasting utilities."""

from __future__ import annotations

import asyncio
import logging
from decimal import Decimal
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin, BinCurrentState


LOGGER = logging.getLogger(__name__)


def _to_float(value: Decimal | float | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


class BinStateWebSocketManager:
    """Tracks websocket subscribers by organization for bin-state fanout."""

    def __init__(self) -> None:
        self._connections_by_org: dict[int, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, org_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections_by_org.setdefault(org_id, set()).add(websocket)

    async def disconnect(self, org_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections_by_org.get(org_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections_by_org.pop(org_id, None)

    async def broadcast_org(self, org_id: int, message: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._connections_by_org.get(org_id, set()))

        if not sockets:
            return

        stale: list[WebSocket] = []
        for websocket in sockets:
            try:
                await websocket.send_json(message)
            except Exception:
                stale.append(websocket)

        for websocket in stale:
            await self.disconnect(org_id, websocket)


bin_state_ws_manager = BinStateWebSocketManager()


async def build_bin_current_state_event(db: AsyncSession, *, bin_id: int) -> dict[str, Any] | None:
    """Build one websocket payload from latest bin_current_state row."""
    row = (
        await db.execute(
            select(BinCurrentState, Bin)
            .join(Bin, Bin.id == BinCurrentState.bin_id)
            .where(BinCurrentState.bin_id == bin_id)
            .limit(1)
        )
    ).first()
    if row is None:
        return None

    state, bin_obj = row
    return {
        "event": "bin_current_state_updated",
        "org_id": int(bin_obj.org_id),
        "bin_id": int(bin_obj.id),
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
        "updated_at": state.updated_at,
    }


async def broadcast_bin_current_state_update(db: AsyncSession, *, bin_id: int) -> None:
    """Broadcast latest state of one bin to all org websocket subscribers."""
    event = await build_bin_current_state_event(db, bin_id=bin_id)
    if event is None:
        return

    org_id = int(event["org_id"])
    try:
        await bin_state_ws_manager.broadcast_org(org_id, event)
    except Exception:
        LOGGER.exception("Failed to broadcast bin current state update")
