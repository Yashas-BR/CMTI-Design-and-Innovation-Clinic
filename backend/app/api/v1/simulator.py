"""Simulator proxy routes for authority_admin device simulation.

These endpoints act as an authenticated wrapper around the MQTT ingestion
pipeline, allowing the admin dashboard to simulate ESP32 device telemetry
without exposing the raw MQTT ingest API key to the browser.

POST /simulator/push-telemetry      — single bin telemetry push
POST /simulator/push-bulk-telemetry — batch push for area simulation ticks
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, get_current_user
from app.db.database import get_db
from app.schemas.mqtt import MQTTIngestRequest, MQTTIngestResponse
from app.services.mqtt_ingestion import ingest_mqtt_message

router = APIRouter(prefix="/simulator")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SimTelemetryPayload(BaseModel):
    """Telemetry values for one simulated bin tick."""

    bin_code: str = Field(min_length=1, max_length=50)

    # Data-channel fields
    fill_pct: float | None = Field(default=None, ge=0, le=100)
    fill_rate: float | None = None   # % per minute
    ttf_min: float | None = None     # time-to-full in minutes
    priority: float | None = None    # 0..1 derived score
    alert: str | None = None         # GREEN | YELLOW | RED
    overflow_imminent: bool = False
    queued: bool = False

    # Alert-channel connection events
    connectivity_status: str | None = None   # "online" | "offline"

    # Optional firmware-like timestamp (uptime seconds)
    uptime_s: int | None = None


class SimBulkTelemetryRequest(BaseModel):
    """Batch of simulated telemetry readings for one simulation tick."""

    readings: list[SimTelemetryPayload] = Field(min_length=1, max_length=200)


class SimBulkTelemetryResponse(BaseModel):
    """Summary of a bulk push."""

    pushed: int
    failed: int
    errors: list[dict[str, Any]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Auth guard — authority_admin only
# ---------------------------------------------------------------------------


async def _require_admin(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    if "authority_admin" not in user.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="authority_admin role required for simulator access",
        )
    return user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_ingest_request(reading: SimTelemetryPayload) -> MQTTIngestRequest:
    """Convert a SimTelemetryPayload into a real MQTTIngestRequest."""
    now = datetime.now(timezone.utc)

    if reading.connectivity_status in {"online", "offline"}:
        # Alert channel — connectivity event
        topic = f"smartbin/{reading.bin_code}/alert"
        payload: dict[str, Any] = {
            "bin_id": reading.bin_code,
            "status": reading.connectivity_status,
            "ts": int(now.timestamp()),
        }
    else:
        # Data channel — telemetry
        topic = f"smartbin/{reading.bin_code}/data"
        payload = {
            "bin_id": reading.bin_code,
            "ts": reading.uptime_s if reading.uptime_s is not None else int(now.timestamp()),
            "fill_pct": reading.fill_pct,
            "fill_rate": reading.fill_rate,
            "ttf_min": reading.ttf_min,
            "priority": reading.priority,
            "alert": reading.alert or "GREEN",
            "overflow_imminent": reading.overflow_imminent,
            "queued": reading.queued,
        }

    return MQTTIngestRequest(
        topic=topic,
        payload=payload,
        qos=0,
        retain=False,
        received_at=now,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post(
    "/push-telemetry",
    response_model=MQTTIngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Simulate a single ESP32 telemetry message",
)
async def push_telemetry(
    payload: SimTelemetryPayload,
    user: AuthUser = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> MQTTIngestResponse:
    """Inject one simulated device telemetry reading into the MQTT pipeline."""
    try:
        ingest_req = _build_ingest_request(payload)
        result = await ingest_mqtt_message(db, ingest_req)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MQTTIngestResponse(**result)


@router.post(
    "/push-bulk-telemetry",
    response_model=SimBulkTelemetryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Simulate a batch of ESP32 telemetry messages (area tick)",
)
async def push_bulk_telemetry(
    body: SimBulkTelemetryRequest,
    user: AuthUser = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
) -> SimBulkTelemetryResponse:
    """Inject multiple simulated device readings in one request.

    This is called on every simulation tick for an entire service area —
    one entry per bin in the area.  Errors on individual readings are
    collected and returned without aborting the whole batch.
    """
    pushed = 0
    failed = 0
    errors: list[dict[str, Any]] = []

    for reading in body.readings:
        try:
            ingest_req = _build_ingest_request(reading)
            await ingest_mqtt_message(db, ingest_req)
            pushed += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            errors.append({"bin_code": reading.bin_code, "error": str(exc)})

    return SimBulkTelemetryResponse(pushed=pushed, failed=failed, errors=errors)
