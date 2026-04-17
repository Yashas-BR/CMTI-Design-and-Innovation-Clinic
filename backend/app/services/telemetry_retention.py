"""Periodic retention worker for high-volume telemetry tables."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging

from sqlalchemy import delete

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.iot import BinTelemetry, MqttRawMessage

logger = logging.getLogger(__name__)


class TelemetryRetentionWorker:
    """Background task that purges old IoT rows by retention policy."""

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._running = False

    def start(self) -> None:
        """Start retention loop if not already active."""
        if self._task is not None and not self._task.done():
            return

        self._running = True
        self._task = asyncio.create_task(self._run_loop(), name="telemetry-retention-worker")
        logger.info(
            "Telemetry retention worker started (interval=%ss, raw_days=%s, telemetry_days=%s)",
            settings.telemetry_retention_interval_seconds,
            settings.mqtt_raw_retention_days,
            settings.bin_telemetry_retention_days,
        )

    async def stop(self) -> None:
        """Stop retention loop gracefully."""
        self._running = False
        if self._task is None:
            return

        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None
            logger.info("Telemetry retention worker stopped")

    async def _run_loop(self) -> None:
        while self._running:
            try:
                await self.run_once()
            except Exception as exc:  # pragma: no cover - defensive background guard
                logger.exception("Telemetry retention iteration failed: %s", exc)
            await asyncio.sleep(max(settings.telemetry_retention_interval_seconds, 60))

    async def run_once(self, now: datetime | None = None) -> dict[str, int]:
        """Run one retention pass and return delete counts."""
        raw_days = settings.mqtt_raw_retention_days
        telemetry_days = settings.bin_telemetry_retention_days

        if raw_days <= 0 and telemetry_days <= 0:
            return {"deleted_raw_messages": 0, "deleted_telemetry_rows": 0}

        now_utc = now or datetime.now(timezone.utc)
        deleted_raw_messages = 0
        deleted_telemetry_rows = 0

        async with SessionLocal() as db:
            if raw_days > 0:
                raw_cutoff = now_utc - timedelta(days=raw_days)
                raw_result = await db.execute(
                    delete(MqttRawMessage).where(MqttRawMessage.received_at < raw_cutoff)
                )
                deleted_raw_messages = int(raw_result.rowcount or 0)

            if telemetry_days > 0:
                telemetry_cutoff = now_utc - timedelta(days=telemetry_days)
                telemetry_result = await db.execute(
                    delete(BinTelemetry).where(BinTelemetry.measured_at < telemetry_cutoff)
                )
                deleted_telemetry_rows = int(telemetry_result.rowcount or 0)

            await db.commit()

        if deleted_raw_messages or deleted_telemetry_rows:
            logger.info(
                "Telemetry retention deleted rows (raw=%s, telemetry=%s)",
                deleted_raw_messages,
                deleted_telemetry_rows,
            )

        return {
            "deleted_raw_messages": deleted_raw_messages,
            "deleted_telemetry_rows": deleted_telemetry_rows,
        }


telemetry_retention_worker = TelemetryRetentionWorker()
