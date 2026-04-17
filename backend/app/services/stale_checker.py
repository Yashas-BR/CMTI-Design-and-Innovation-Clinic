"""Background stale-bin checker for inactivity-based offline alert management."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging

from sqlalchemy import select

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.iot import Alert, AlertEvent, Bin, BinCurrentState

logger = logging.getLogger(__name__)


class StaleBinChecker:
    """Periodic task that opens/resolves offline alerts by inactivity window."""

    def __init__(self) -> None:
        self._task: asyncio.Task[None] | None = None
        self._running = False

    def start(self) -> None:
        """Start checker loop if not already running."""
        if self._task is not None and not self._task.done():
            return

        self._running = True
        self._task = asyncio.create_task(self._run_loop(), name="stale-bin-checker")
        logger.info(
            "Stale checker started (interval=%ss, inactivity=%smin)",
            settings.stale_check_interval_seconds,
            settings.stale_bin_inactivity_minutes,
        )

    async def stop(self) -> None:
        """Stop checker loop gracefully."""
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
            logger.info("Stale checker stopped")

    async def _run_loop(self) -> None:
        while self._running:
            try:
                await self.run_once()
            except Exception as exc:  # pragma: no cover - defensive background guard
                logger.exception("Stale checker iteration failed: %s", exc)
            await asyncio.sleep(max(settings.stale_check_interval_seconds, 15))

    async def run_once(self) -> None:
        """Run one stale check pass and update alert lifecycle."""
        now = datetime.now(timezone.utc)
        stale_cutoff = now - timedelta(minutes=settings.stale_bin_inactivity_minutes)

        async with SessionLocal() as db:
            stale_rows = (
                await db.execute(
                    select(BinCurrentState, Bin)
                    .join(Bin, Bin.id == BinCurrentState.bin_id)
                    .where(BinCurrentState.last_measured_at.is_not(None))
                    .where(BinCurrentState.last_measured_at < stale_cutoff)
                )
            ).all()

            fresh_rows = (
                await db.execute(
                    select(BinCurrentState, Bin)
                    .join(Bin, Bin.id == BinCurrentState.bin_id)
                    .where(BinCurrentState.last_measured_at.is_not(None))
                    .where(BinCurrentState.last_measured_at >= stale_cutoff)
                )
            ).all()

            stale_opened = 0
            stale_resolved = 0

            for state, bin_obj in stale_rows:
                state.device_connectivity_state = "offline"
                state.updated_at = now

                open_alert = (
                    await db.execute(
                        select(Alert)
                        .where(Alert.bin_id == bin_obj.id, Alert.alert_type == "device_offline", Alert.status == "open")
                        .limit(1)
                    )
                ).scalar_one_or_none()

                if open_alert is None:
                    created = Alert(
                        org_id=bin_obj.org_id,
                        bin_id=bin_obj.id,
                        rule_id=None,
                        alert_type="device_offline",
                        severity="critical",
                        status="open",
                        opened_at=now,
                        acknowledged_at=None,
                        resolved_at=None,
                        assigned_to_user_id=None,
                        title=f"Device offline: {bin_obj.bin_code}",
                        description=(
                            "No telemetry received for "
                            f"{settings.stale_bin_inactivity_minutes} minutes."
                        ),
                        latest_telemetry_id=state.last_telemetry_id,
                        dedupe_key=f"{bin_obj.org_id}:{bin_obj.id}:device_offline",
                        created_at=now,
                        updated_at=now,
                    )
                    db.add(created)
                    await db.flush()
                    db.add(
                        AlertEvent(
                            alert_id=created.id,
                            event_type="opened",
                            actor_user_id=None,
                            event_ts=now,
                            note="Opened by stale checker due to inactivity window.",
                            payload_json={
                                "inactivity_minutes": settings.stale_bin_inactivity_minutes,
                                "last_measured_at": state.last_measured_at.isoformat(),
                            },
                        )
                    )
                    stale_opened += 1

            for state, bin_obj in fresh_rows:
                open_alert = (
                    await db.execute(
                        select(Alert)
                        .where(Alert.bin_id == bin_obj.id, Alert.alert_type == "device_offline", Alert.status == "open")
                        .limit(1)
                    )
                ).scalar_one_or_none()

                if open_alert is None:
                    continue

                open_alert.status = "resolved"
                open_alert.resolved_at = now
                open_alert.updated_at = now
                state.device_connectivity_state = "online"
                state.updated_at = now
                db.add(
                    AlertEvent(
                        alert_id=open_alert.id,
                        event_type="resolved",
                        actor_user_id=None,
                        event_ts=now,
                        note="Resolved by stale checker after telemetry resumed.",
                        payload_json={
                            "last_measured_at": state.last_measured_at.isoformat(),
                        },
                    )
                )
                stale_resolved += 1

            await db.commit()

        if stale_opened or stale_resolved:
            logger.info("Stale checker changes: opened=%s resolved=%s", stale_opened, stale_resolved)


stale_bin_checker = StaleBinChecker()
