"""Alert management services."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Alert, AlertEvent, Bin, User


AUTHORITY_ROLES = {"authority_admin", "authority_operator"}


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _is_authority(actor_roles: set[str]) -> bool:
    return bool(AUTHORITY_ROLES.intersection(actor_roles))


def _alert_to_dict(alert: Alert, bin_code: str) -> dict[str, Any]:
    return {
        "id": alert.id,
        "org_id": alert.org_id,
        "bin_id": alert.bin_id,
        "bin_code": bin_code,
        "rule_id": alert.rule_id,
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "status": alert.status,
        "opened_at": alert.opened_at,
        "acknowledged_at": alert.acknowledged_at,
        "resolved_at": alert.resolved_at,
        "assigned_to_user_id": alert.assigned_to_user_id,
        "title": alert.title,
        "description": alert.description,
        "latest_telemetry_id": alert.latest_telemetry_id,
        "dedupe_key": alert.dedupe_key,
        "created_at": alert.created_at,
        "updated_at": alert.updated_at,
    }


async def _append_alert_event(
    db: AsyncSession,
    *,
    alert_id: int,
    event_type: str,
    actor_user_id: int,
    note: str | None,
    payload_json: dict[str, Any] | None = None,
) -> None:
    db.add(
        AlertEvent(
            alert_id=alert_id,
            event_type=event_type,
            actor_user_id=actor_user_id,
            event_ts=_now_utc(),
            note=note,
            payload_json=payload_json,
        )
    )


async def _get_alert_scoped(db: AsyncSession, org_id: int, alert_id: int) -> tuple[Alert, str]:
    row = (
        await db.execute(
            select(Alert, Bin.bin_code)
            .join(Bin, Bin.id == Alert.bin_id)
            .where(Alert.id == alert_id, Alert.org_id == org_id)
            .limit(1)
        )
    ).first()
    if row is None:
        raise ValueError("alert not found")
    return row[0], str(row[1])


def _enforce_driver_assignment_scope(
    *,
    actor_user_id: int,
    actor_roles: set[str],
    alert: Alert,
) -> None:
    if _is_authority(actor_roles):
        return

    if alert.assigned_to_user_id != actor_user_id:
        raise PermissionError("drivers can only act on alerts assigned to themselves")


async def list_alerts(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    severity: str | None = None,
    alert_type: str | None = None,
    bin_id: int | None = None,
    assigned_to_user_id: int | None = None,
    opened_from: datetime | None = None,
    opened_to: datetime | None = None,
) -> dict[str, Any]:
    """List organization-scoped alerts with filters."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [Alert.org_id == org_id]
    if status:
        filters.append(Alert.status == status)
    if severity:
        filters.append(Alert.severity == severity)
    if alert_type:
        filters.append(Alert.alert_type == alert_type)
    if bin_id is not None:
        filters.append(Alert.bin_id == bin_id)
    if assigned_to_user_id is not None:
        filters.append(Alert.assigned_to_user_id == assigned_to_user_id)
    if opened_from is not None:
        filters.append(Alert.opened_at >= opened_from)
    if opened_to is not None:
        filters.append(Alert.opened_at <= opened_to)

    total = (await db.execute(select(func.count(Alert.id)).where(*filters))).scalar_one() or 0

    rows = (
        await db.execute(
            select(Alert, Bin.bin_code)
            .join(Bin, Bin.id == Alert.bin_id)
            .where(*filters)
            .order_by(Alert.opened_at.desc(), Alert.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).all()

    items = [_alert_to_dict(row[0], str(row[1])) for row in rows]

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": items,
    }


async def get_alert(db: AsyncSession, org_id: int, alert_id: int) -> dict[str, Any]:
    """Get one organization-scoped alert."""
    alert, bin_code = await _get_alert_scoped(db, org_id, alert_id)
    return _alert_to_dict(alert, bin_code)


async def acknowledge_alert(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    alert_id: int,
    note: str | None,
) -> dict[str, Any]:
    """Acknowledge an open alert."""
    alert, bin_code = await _get_alert_scoped(db, org_id, alert_id)
    _enforce_driver_assignment_scope(actor_user_id=actor_user_id, actor_roles=actor_roles, alert=alert)

    if alert.status == "resolved":
        return _alert_to_dict(alert, bin_code)

    if alert.acknowledged_at is None:
        now = _now_utc()
        alert.acknowledged_at = now
        alert.updated_at = now
        await _append_alert_event(
            db,
            alert_id=alert.id,
            event_type="acknowledged",
            actor_user_id=actor_user_id,
            note=note,
        )
        await db.commit()
        await db.refresh(alert)

    return _alert_to_dict(alert, bin_code)


async def resolve_alert(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    alert_id: int,
    note: str | None,
) -> dict[str, Any]:
    """Resolve an alert."""
    alert, bin_code = await _get_alert_scoped(db, org_id, alert_id)
    _enforce_driver_assignment_scope(actor_user_id=actor_user_id, actor_roles=actor_roles, alert=alert)

    if alert.status == "resolved":
        return _alert_to_dict(alert, bin_code)

    now = _now_utc()
    alert.status = "resolved"
    alert.resolved_at = now
    alert.acknowledged_at = alert.acknowledged_at or now
    alert.updated_at = now

    await _append_alert_event(
        db,
        alert_id=alert.id,
        event_type="resolved",
        actor_user_id=actor_user_id,
        note=note,
    )

    await db.commit()
    await db.refresh(alert)
    return _alert_to_dict(alert, bin_code)


async def assign_alert(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    actor_roles: set[str],
    *,
    alert_id: int,
    assigned_to_user_id: int | None,
    note: str | None,
) -> dict[str, Any]:
    """Assign or unassign an alert to a user."""
    alert, bin_code = await _get_alert_scoped(db, org_id, alert_id)

    if not _is_authority(actor_roles):
        if assigned_to_user_id != actor_user_id:
            raise PermissionError("drivers can only assign alerts to themselves")

    if assigned_to_user_id is not None:
        assignee = (
            await db.execute(
                select(User)
                .where(User.id == assigned_to_user_id, User.org_id == org_id, User.is_active.is_(True))
                .limit(1)
            )
        ).scalar_one_or_none()
        if assignee is None:
            raise ValueError("assignee user not found or inactive")

    alert.assigned_to_user_id = assigned_to_user_id
    alert.updated_at = _now_utc()

    await _append_alert_event(
        db,
        alert_id=alert.id,
        event_type="assigned",
        actor_user_id=actor_user_id,
        note=note,
        payload_json={"assigned_to_user_id": assigned_to_user_id},
    )

    await db.commit()
    await db.refresh(alert)
    return _alert_to_dict(alert, bin_code)


async def list_alert_events(
    db: AsyncSession,
    org_id: int,
    *,
    alert_id: int,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    """List events for one organization-scoped alert."""
    await _get_alert_scoped(db, org_id, alert_id)

    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    base_filters = [AlertEvent.alert_id == alert_id]

    total = (await db.execute(select(func.count(AlertEvent.id)).where(*base_filters))).scalar_one() or 0

    rows = (
        await db.execute(
            select(AlertEvent)
            .where(*base_filters)
            .order_by(AlertEvent.event_ts.desc(), AlertEvent.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    items = [
        {
            "id": row.id,
            "alert_id": row.alert_id,
            "event_type": row.event_type,
            "actor_user_id": row.actor_user_id,
            "event_ts": row.event_ts,
            "note": row.note,
            "payload_json": row.payload_json,
        }
        for row in rows
    ]

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": items,
    }
