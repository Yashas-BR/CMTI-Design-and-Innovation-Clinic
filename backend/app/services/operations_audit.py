"""Audit helpers for operations flows and idempotency key checks."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import AuditLog


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _trim_request_id(request_id: str | None) -> str | None:
    if request_id is None:
        return None
    value = request_id.strip()
    if not value:
        return None
    return value[:100]


def _to_json_safe(value: Any) -> Any:
    """Convert Python objects into JSON-serializable values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    if isinstance(value, dict):
        return {str(key): _to_json_safe(val) for key, val in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_to_json_safe(item) for item in value]

    return str(value)


async def find_audit_by_request(
    db: AsyncSession,
    *,
    org_id: int,
    action_type: str,
    entity_type: str,
    entity_id: str,
    request_id: str,
) -> AuditLog | None:
    """Find one audit row by action/entity/request triple for idempotency checks."""
    safe_request_id = _trim_request_id(request_id)
    if safe_request_id is None:
        return None

    return (
        await db.execute(
            select(AuditLog)
            .where(
                AuditLog.org_id == org_id,
                AuditLog.action_type == action_type,
                AuditLog.entity_type == entity_type,
                AuditLog.entity_id == entity_id,
                AuditLog.request_id == safe_request_id,
            )
            .order_by(AuditLog.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def append_audit_log(
    db: AsyncSession,
    *,
    org_id: int | None,
    user_id: int | None,
    action_type: str,
    entity_type: str,
    entity_id: str,
    before_json: dict[str, Any] | None = None,
    after_json: dict[str, Any] | None = None,
    request_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    auto_commit: bool = False,
) -> AuditLog:
    """Append one audit row and optionally commit immediately."""
    row = AuditLog(
        org_id=org_id,
        user_id=user_id,
        action_type=action_type,
        entity_type=entity_type,
        entity_id=entity_id,
        before_json=_to_json_safe(before_json),
        after_json=_to_json_safe(after_json),
        request_id=_trim_request_id(request_id),
        ip_address=ip_address,
        user_agent=user_agent,
        created_at=_now_utc(),
    )
    db.add(row)
    if auto_commit:
        await db.commit()
        await db.refresh(row)
    return row
