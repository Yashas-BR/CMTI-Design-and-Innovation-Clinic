"""MQTT ingestion pipeline: store raw messages, telemetry, current state, and alerts."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import (
    Alert,
    AlertEvent,
    Bin,
    BinCurrentState,
    BinDevice,
    BinTelemetry,
    ConnectivityEvent,
    MqttRawMessage,
)
from app.schemas.mqtt import MQTTIngestRequest


ALERT_GREEN = "GREEN"
ALERT_YELLOW = "YELLOW"
ALERT_RED = "RED"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _to_float(payload: dict[str, Any], key: str) -> float | None:
    value = payload.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_bool(payload: dict[str, Any], key: str, default: bool = False) -> bool:
    value = payload.get(key)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"true", "1", "yes"}
    return bool(value)


def _parse_topic(topic: str) -> tuple[str, str]:
    """Return (bin_token, channel) for smartbin/{bin}/data|alert topics."""
    parts = [part for part in topic.split("/") if part]
    if len(parts) < 3:
        raise ValueError("topic must look like smartbin/{bin_id}/data or smartbin/{bin_id}/alert")
    if parts[0].lower() != "smartbin":
        raise ValueError("only smartbin topics are supported")

    channel = parts[2].lower()
    if channel not in {"data", "alert"}:
        raise ValueError("topic channel must be data or alert")
    return parts[1], channel


def _parse_payload_time(raw_ts: Any, fallback: datetime) -> tuple[datetime, int | None, str]:
    """Infer measured_at and payload timestamp type from raw value."""
    if raw_ts is None:
        return fallback, None, "unknown"

    try:
        ts_num = int(raw_ts)
    except (TypeError, ValueError):
        return fallback, None, "unknown"

    # Unix seconds range guard.
    if 946684800 <= ts_num <= 4102444800:
        return datetime.fromtimestamp(ts_num, tz=timezone.utc), ts_num, "unix_s"

    # Unix milliseconds range guard.
    if 946684800000 <= ts_num <= 4102444800000:
        seconds = ts_num / 1000.0
        return datetime.fromtimestamp(seconds, tz=timezone.utc), ts_num, "unix_ms"

    # Firmware currently sends uptime-like values; keep raw and use server time.
    if ts_num >= 0:
        return fallback, ts_num, "uptime_s"

    return fallback, ts_num, "unknown"


async def _resolve_bin_and_device(db: AsyncSession, bin_token: str) -> tuple[Bin, BinDevice | None]:
    device = (
        await db.execute(
            select(BinDevice).where(BinDevice.mqtt_client_id == bin_token).limit(1)
        )
    ).scalar_one_or_none()

    if device is not None:
        bin_obj = (await db.execute(select(Bin).where(Bin.id == device.bin_id).limit(1))).scalar_one_or_none()
        if bin_obj is not None:
            return bin_obj, device

    bin_obj = (await db.execute(select(Bin).where(Bin.bin_code == bin_token).limit(1))).scalar_one_or_none()
    if bin_obj is None:
        raise ValueError(f"bin not found for token {bin_token}")

    fallback_device = (
        await db.execute(select(BinDevice).where(BinDevice.bin_id == bin_obj.id).limit(1))
    ).scalar_one_or_none()
    return bin_obj, fallback_device


async def _append_alert_event(
    db: AsyncSession,
    alert_id: int,
    event_type: str,
    note: str,
    payload: dict[str, Any] | None = None,
) -> None:
    db.add(
        AlertEvent(
            alert_id=alert_id,
            event_type=event_type,
            actor_user_id=None,
            event_ts=_now_utc(),
            note=note,
            payload_json=payload,
        )
    )


async def _get_open_alert(db: AsyncSession, bin_id: int, alert_type: str) -> Alert | None:
    stmt: Select[tuple[Alert]] = (
        select(Alert)
        .where(Alert.bin_id == bin_id, Alert.alert_type == alert_type, Alert.status == "open")
        .order_by(Alert.opened_at.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _open_or_update_alert(
    db: AsyncSession,
    *,
    bin_obj: Bin,
    alert_type: str,
    severity: str,
    title: str,
    description: str,
    latest_telemetry_id: int | None,
    dedupe_key: str,
) -> str:
    open_alert = await _get_open_alert(db, bin_obj.id, alert_type)
    now = _now_utc()
    if open_alert is None:
        created = Alert(
            org_id=bin_obj.org_id,
            bin_id=bin_obj.id,
            rule_id=None,
            alert_type=alert_type,
            severity=severity,
            status="open",
            opened_at=now,
            acknowledged_at=None,
            resolved_at=None,
            assigned_to_user_id=None,
            title=title,
            description=description,
            latest_telemetry_id=latest_telemetry_id,
            dedupe_key=dedupe_key,
            created_at=now,
            updated_at=now,
        )
        db.add(created)
        await db.flush()
        await _append_alert_event(db, created.id, "opened", description)
        return "opened"

    open_alert.severity = severity
    open_alert.title = title
    open_alert.description = description
    open_alert.latest_telemetry_id = latest_telemetry_id
    open_alert.updated_at = now
    await _append_alert_event(db, open_alert.id, "updated", "Alert refreshed with latest telemetry")
    return "updated"


async def _resolve_alert(db: AsyncSession, *, bin_id: int, alert_type: str, note: str) -> str:
    open_alert = await _get_open_alert(db, bin_id, alert_type)
    if open_alert is None:
        return "none"

    now = _now_utc()
    open_alert.status = "resolved"
    open_alert.resolved_at = now
    open_alert.updated_at = now
    await _append_alert_event(db, open_alert.id, "resolved", note)
    return "resolved"


async def _upsert_current_state(
    db: AsyncSession,
    *,
    bin_id: int,
    device_id: int | None,
    telemetry_id: int | None,
    measured_at: datetime | None,
    fill_pct: float | None,
    fill_rate: float | None,
    ttf_min: float | None,
    priority: float | None,
    alert_level: str | None,
    overflow_imminent: bool | None,
    queued: bool | None,
    connectivity_state: str | None,
) -> None:
    update_map: dict[str, Any] = {
        "updated_at": _now_utc(),
    }

    if telemetry_id is not None:
        update_map.update(
            {
                "last_telemetry_id": telemetry_id,
                "last_measured_at": measured_at,
                "current_fill_pct": fill_pct,
                "current_fill_rate_pct_per_min": fill_rate,
                "current_ttf_min": ttf_min,
                "current_priority_score": priority,
                "current_alert_level": alert_level,
                "overflow_imminent": bool(overflow_imminent),
            }
        )
        if queued is not None:
            update_map["queued_count"] = 1 if queued else 0

    if connectivity_state is not None:
        update_map["device_connectivity_state"] = connectivity_state

    if device_id is not None:
        update_map["device_id"] = device_id

    values_map = {
        "bin_id": bin_id,
        "device_id": device_id,
        "last_telemetry_id": telemetry_id,
        "last_measured_at": measured_at,
        "current_fill_pct": fill_pct,
        "current_fill_rate_pct_per_min": fill_rate,
        "current_ttf_min": ttf_min,
        "current_priority_score": priority,
        "current_alert_level": alert_level,
        "overflow_imminent": bool(overflow_imminent) if overflow_imminent is not None else False,
        "device_connectivity_state": connectivity_state or "unknown",
        "queued_count": 1 if queued else 0,
        "updated_at": _now_utc(),
    }

    stmt = pg_insert(BinCurrentState).values(**values_map)
    stmt = stmt.on_conflict_do_update(index_elements=[BinCurrentState.bin_id], set_=update_map)
    await db.execute(stmt)


async def ingest_mqtt_message(db: AsyncSession, request: MQTTIngestRequest) -> dict[str, Any]:
    """Ingest one MQTT message and run immediate alert/state evaluation."""
    topic_bin, channel = _parse_topic(request.topic)
    payload = request.payload
    payload_bin = str(payload.get("bin_id") or topic_bin).strip()

    bin_obj, device = await _resolve_bin_and_device(db, payload_bin)
    received_at = request.received_at or _now_utc()

    digest_source = f"{request.topic}|{payload}|{received_at.isoformat()}".encode("utf-8")
    payload_hash = hashlib.sha256(digest_source).hexdigest()

    raw = MqttRawMessage(
        received_at=received_at,
        topic=request.topic,
        qos=request.qos,
        retain=request.retain,
        payload_json=payload,
        parse_status="parsed",
        reject_reason=None,
        payload_hash=payload_hash,
        bin_id=bin_obj.id,
        device_id=device.id if device else None,
        processed_at=None,
    )
    db.add(raw)
    await db.flush()

    result: dict[str, Any] = {
        "status": "ok",
        "raw_message_id": raw.id,
        "bin_code": bin_obj.bin_code,
        "telemetry_id": None,
        "evaluation": {},
    }

    if channel == "data":
        measured_at, payload_ts_raw, payload_ts_type = _parse_payload_time(payload.get("ts"), received_at)
        fill_pct = _to_float(payload, "fill_pct")
        fill_rate = _to_float(payload, "fill_rate")
        ttf_min = _to_float(payload, "ttf_min")
        priority = _to_float(payload, "priority")
        alert_level = str(payload.get("alert") or "").upper() or None
        overflow_imminent = _to_bool(payload, "overflow_imminent", default=False)
        queued = _to_bool(payload, "queued", default=False)

        telemetry = BinTelemetry(
            bin_id=bin_obj.id,
            device_id=device.id if device else None,
            measured_at=measured_at,
            ingested_at=received_at,
            payload_ts_raw=payload_ts_raw,
            payload_ts_type=payload_ts_type,
            fill_pct=fill_pct,
            fill_rate_pct_per_min=fill_rate,
            ttf_min=ttf_min,
            priority_score=priority,
            alert_level=alert_level,
            overflow_imminent=overflow_imminent,
            queued=queued,
            raw_message_id=raw.id,
            source_topic=request.topic,
        )
        db.add(telemetry)
        await db.flush()

        await _upsert_current_state(
            db,
            bin_id=bin_obj.id,
            device_id=device.id if device else None,
            telemetry_id=telemetry.id,
            measured_at=measured_at,
            fill_pct=fill_pct,
            fill_rate=fill_rate,
            ttf_min=ttf_min,
            priority=priority,
            alert_level=alert_level,
            overflow_imminent=overflow_imminent,
            queued=queued,
            connectivity_state=None,
        )

        threshold_state = "none"
        overflow_state = "none"

        if alert_level in {ALERT_YELLOW, ALERT_RED}:
            threshold_state = await _open_or_update_alert(
                db,
                bin_obj=bin_obj,
                alert_type="fill_threshold",
                severity="critical" if alert_level == ALERT_RED else "warning",
                title=f"Bin {bin_obj.bin_code} reached {alert_level}",
                description=f"Fill level alert {alert_level} at {fill_pct}%.",
                latest_telemetry_id=telemetry.id,
                dedupe_key=f"{bin_obj.org_id}:{bin_obj.id}:fill_threshold",
            )
        elif alert_level == ALERT_GREEN:
            threshold_state = await _resolve_alert(
                db,
                bin_id=bin_obj.id,
                alert_type="fill_threshold",
                note="Bin returned to GREEN state.",
            )

        if overflow_imminent:
            overflow_state = await _open_or_update_alert(
                db,
                bin_obj=bin_obj,
                alert_type="overflow_imminent",
                severity="critical",
                title=f"Overflow imminent for {bin_obj.bin_code}",
                description=f"Predicted time-to-full is {ttf_min} minutes.",
                latest_telemetry_id=telemetry.id,
                dedupe_key=f"{bin_obj.org_id}:{bin_obj.id}:overflow_imminent",
            )
        else:
            overflow_state = await _resolve_alert(
                db,
                bin_id=bin_obj.id,
                alert_type="overflow_imminent",
                note="Overflow risk cleared.",
            )

        result["telemetry_id"] = telemetry.id
        result["evaluation"] = {
            "channel": "data",
            "threshold_alert": threshold_state,
            "overflow_alert": overflow_state,
            "payload_ts_type": payload_ts_type,
        }

    else:
        status = str(payload.get("status") or "").lower()
        alert_level = str(payload.get("alert") or "").upper() or None

        if status in {"online", "offline"}:
            db.add(
                ConnectivityEvent(
                    bin_id=bin_obj.id,
                    device_id=device.id if device else None,
                    event_type=status,
                    event_ts=received_at,
                    source_message_id=raw.id,
                    details_json=payload,
                )
            )
            await _upsert_current_state(
                db,
                bin_id=bin_obj.id,
                device_id=device.id if device else None,
                telemetry_id=None,
                measured_at=None,
                fill_pct=None,
                fill_rate=None,
                ttf_min=None,
                priority=None,
                alert_level=None,
                overflow_imminent=None,
                queued=None,
                connectivity_state=status,
            )

            offline_state = "none"
            if status == "offline":
                offline_state = await _open_or_update_alert(
                    db,
                    bin_obj=bin_obj,
                    alert_type="device_offline",
                    severity="critical",
                    title=f"Device offline: {bin_obj.bin_code}",
                    description="MQTT device reported offline status.",
                    latest_telemetry_id=None,
                    dedupe_key=f"{bin_obj.org_id}:{bin_obj.id}:device_offline",
                )
            else:
                offline_state = await _resolve_alert(
                    db,
                    bin_id=bin_obj.id,
                    alert_type="device_offline",
                    note="Device reconnected and reported online.",
                )

            result["evaluation"] = {
                "channel": "alert",
                "connectivity": status,
                "device_offline_alert": offline_state,
            }

        elif alert_level in {ALERT_GREEN, ALERT_YELLOW, ALERT_RED}:
            await _upsert_current_state(
                db,
                bin_id=bin_obj.id,
                device_id=device.id if device else None,
                telemetry_id=None,
                measured_at=None,
                fill_pct=None,
                fill_rate=None,
                ttf_min=None,
                priority=None,
                alert_level=alert_level,
                overflow_imminent=None,
                queued=None,
                connectivity_state=None,
            )

            threshold_state = "none"
            if alert_level in {ALERT_YELLOW, ALERT_RED}:
                threshold_state = await _open_or_update_alert(
                    db,
                    bin_obj=bin_obj,
                    alert_type="fill_threshold",
                    severity="critical" if alert_level == ALERT_RED else "warning",
                    title=f"Bin {bin_obj.bin_code} reached {alert_level}",
                    description=f"Alert topic reported {alert_level}.",
                    latest_telemetry_id=None,
                    dedupe_key=f"{bin_obj.org_id}:{bin_obj.id}:fill_threshold",
                )
            else:
                threshold_state = await _resolve_alert(
                    db,
                    bin_id=bin_obj.id,
                    alert_type="fill_threshold",
                    note="Alert topic reported GREEN.",
                )

            result["evaluation"] = {
                "channel": "alert",
                "alert_level": alert_level,
                "threshold_alert": threshold_state,
            }
        else:
            raw.parse_status = "partial"
            raw.reject_reason = "alert payload has no recognized status/alert field"
            result["status"] = "partial"
            result["evaluation"] = {
                "channel": "alert",
                "note": "message stored but no state transition",
            }

    raw.processed_at = _now_utc()
    await db.commit()

    return result
