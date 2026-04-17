"""Unit tests for realtime bin-state websocket broadcaster helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services.bin_state_realtime import BinStateWebSocketManager, build_bin_current_state_event


class _DummyWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.sent: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)


class _DummyResult:
    def __init__(self, row: object) -> None:
        self._row = row

    def first(self) -> object:
        return self._row


@pytest.mark.asyncio
async def test_websocket_manager_connect_and_broadcast() -> None:
    """Manager should accept connections and fanout payloads to org subscribers."""
    manager = BinStateWebSocketManager()
    websocket = _DummyWebSocket()

    await manager.connect(1, websocket)
    await manager.broadcast_org(1, {"event": "bin_current_state_updated", "bin_id": 101})

    assert websocket.accepted is True
    assert len(websocket.sent) == 1
    assert websocket.sent[0]["bin_id"] == 101

    await manager.disconnect(1, websocket)


@pytest.mark.asyncio
async def test_build_bin_current_state_event_returns_serialized_payload() -> None:
    """Event builder should serialize one joined BinCurrentState + Bin row."""
    state = SimpleNamespace(
        last_measured_at=datetime(2026, 4, 18, 8, 30, tzinfo=timezone.utc),
        current_fill_pct=Decimal("75.50"),
        current_fill_rate_pct_per_min=Decimal("0.150"),
        current_ttf_min=Decimal("35.00"),
        current_priority_score=Decimal("88.20"),
        current_alert_level="YELLOW",
        overflow_imminent=False,
        device_connectivity_state="online",
        queued_count=0,
        updated_at=datetime(2026, 4, 18, 8, 31, tzinfo=timezone.utc),
    )
    bin_obj = SimpleNamespace(id=101, org_id=1, bin_code="BIN_101")

    db = SimpleNamespace(
        execute=lambda _stmt: None,
    )

    async def _execute(_stmt):
        return _DummyResult((state, bin_obj))

    db.execute = _execute

    payload = await build_bin_current_state_event(db, bin_id=101)

    assert payload is not None
    assert payload["event"] == "bin_current_state_updated"
    assert payload["org_id"] == 1
    assert payload["bin_code"] == "BIN_101"
    assert payload["current_fill_pct"] == 75.5
