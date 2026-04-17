"""Unit tests for telemetry retention background worker."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import telemetry_retention


class _SessionContext:
    def __init__(self, session: SimpleNamespace) -> None:
        self._session = session

    async def __aenter__(self) -> SimpleNamespace:
        return self._session

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


@pytest.mark.asyncio
async def test_run_once_deletes_raw_and_telemetry_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retention pass should issue delete statements for both configured windows."""
    worker = telemetry_retention.TelemetryRetentionWorker()

    session = SimpleNamespace(
        execute=AsyncMock(
            side_effect=[
                SimpleNamespace(rowcount=11),
                SimpleNamespace(rowcount=7),
            ]
        ),
        commit=AsyncMock(),
    )

    monkeypatch.setattr(telemetry_retention, "SessionLocal", lambda: _SessionContext(session))
    monkeypatch.setattr(telemetry_retention.settings, "mqtt_raw_retention_days", 30)
    monkeypatch.setattr(telemetry_retention.settings, "bin_telemetry_retention_days", 90)

    summary = await worker.run_once(now=datetime(2026, 4, 18, 10, 0, tzinfo=timezone.utc))

    assert summary == {"deleted_raw_messages": 11, "deleted_telemetry_rows": 7}
    assert session.execute.await_count == 2
    assert session.commit.await_count == 1


@pytest.mark.asyncio
async def test_run_once_noop_when_retention_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retention pass should skip DB interaction when both windows are disabled."""
    worker = telemetry_retention.TelemetryRetentionWorker()

    session = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())

    monkeypatch.setattr(telemetry_retention, "SessionLocal", lambda: _SessionContext(session))
    monkeypatch.setattr(telemetry_retention.settings, "mqtt_raw_retention_days", 0)
    monkeypatch.setattr(telemetry_retention.settings, "bin_telemetry_retention_days", 0)

    summary = await worker.run_once(now=datetime(2026, 4, 18, 10, 0, tzinfo=timezone.utc))

    assert summary == {"deleted_raw_messages": 0, "deleted_telemetry_rows": 0}
    assert session.execute.await_count == 0
    assert session.commit.await_count == 0
