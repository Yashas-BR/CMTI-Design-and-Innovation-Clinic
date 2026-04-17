"""In-app notification queue services and real-time hub."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import distinct, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.iot import InAppNotification, Role, User, UserRole


class InAppNotificationHub:
    """In-process pub/sub hub for per-user real-time notification streaming."""

    def __init__(self) -> None:
        self._subscribers: dict[int, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, user_id: int) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        async with self._lock:
            self._subscribers.setdefault(user_id, set()).add(queue)
        return queue

    async def unsubscribe(self, user_id: int, queue: asyncio.Queue[dict[str, Any]]) -> None:
        async with self._lock:
            queues = self._subscribers.get(user_id)
            if not queues:
                return
            queues.discard(queue)
            if not queues:
                self._subscribers.pop(user_id, None)

    async def publish(self, user_id: int, event: dict[str, Any]) -> None:
        async with self._lock:
            subscribers = list(self._subscribers.get(user_id, set()))

        for queue in subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Keep the stream live by dropping oldest buffered event.
                try:
                    queue.get_nowait()
                    queue.put_nowait(event)
                except Exception:
                    continue


in_app_notification_hub = InAppNotificationHub()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _notification_to_dict(row: InAppNotification) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "org_id": int(row.org_id),
        "user_id": int(row.user_id),
        "event_type": row.event_type,
        "severity": row.severity,
        "title": row.title,
        "message": row.message,
        "payload_json": row.payload_json,
        "is_read": bool(row.is_read),
        "read_at": row.read_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def _resolve_target_user_ids(
    db: AsyncSession,
    *,
    org_id: int,
    target_role_keys: list[str] | None,
    target_user_ids: list[int] | None,
) -> list[int]:
    recipients: set[int] = set()

    if target_user_ids:
        rows = await db.execute(
            select(User.id).where(
                User.org_id == org_id,
                User.is_active.is_(True),
                User.id.in_([int(item) for item in target_user_ids]),
            )
        )
        recipients.update(int(item) for item in rows.scalars().all())

    clean_role_keys = sorted({item.strip() for item in (target_role_keys or []) if item.strip()})
    if clean_role_keys:
        role_rows = await db.execute(
            select(distinct(User.id))
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.org_id == org_id,
                User.is_active.is_(True),
                Role.key.in_(clean_role_keys),
            )
        )
        recipients.update(int(item) for item in role_rows.scalars().all())

    return sorted(recipients)


async def create_notifications_for_targets(
    db: AsyncSession,
    *,
    org_id: int,
    event_type: str,
    severity: str,
    title: str,
    message: str | None,
    payload_json: dict[str, Any] | None = None,
    target_role_keys: list[str] | None = None,
    target_user_ids: list[int] | None = None,
) -> list[dict[str, Any]]:
    """Persist in-app notifications for resolved recipient users and publish realtime events."""
    if not settings.notification_in_app_enabled:
        return []

    recipient_user_ids = await _resolve_target_user_ids(
        db,
        org_id=org_id,
        target_role_keys=target_role_keys,
        target_user_ids=target_user_ids,
    )
    if not recipient_user_ids:
        return []

    now = _now_utc()
    rows: list[InAppNotification] = []
    for recipient_user_id in recipient_user_ids:
        row = InAppNotification(
            org_id=org_id,
            user_id=recipient_user_id,
            event_type=event_type,
            severity=severity,
            title=title,
            message=message,
            payload_json=payload_json,
            is_read=False,
            read_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        rows.append(row)

    await db.flush()
    payloads = [_notification_to_dict(row) for row in rows]
    await db.commit()

    for row, payload in zip(rows, payloads):
        await in_app_notification_hub.publish(int(row.user_id), payload)

    return payloads


async def list_in_app_notifications(
    db: AsyncSession,
    org_id: int,
    user_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
    severity: str | None = None,
    event_type: str | None = None,
) -> dict[str, Any]:
    """List notifications belonging to one authenticated user within organization scope."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [
        InAppNotification.org_id == org_id,
        InAppNotification.user_id == user_id,
    ]
    if unread_only:
        filters.append(InAppNotification.is_read.is_(False))
    if severity:
        filters.append(InAppNotification.severity == severity)
    if event_type:
        filters.append(InAppNotification.event_type == event_type)

    total = (
        await db.execute(select(func.count(InAppNotification.id)).where(*filters))
    ).scalar_one() or 0

    rows = (
        await db.execute(
            select(InAppNotification)
            .where(*filters)
            .order_by(InAppNotification.created_at.desc(), InAppNotification.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_notification_to_dict(row) for row in rows],
    }


async def mark_in_app_notification_read(
    db: AsyncSession,
    org_id: int,
    user_id: int,
    *,
    notification_id: int,
) -> dict[str, Any]:
    """Mark one scoped notification as read."""
    row = (
        await db.execute(
            select(InAppNotification)
            .where(
                InAppNotification.id == notification_id,
                InAppNotification.org_id == org_id,
                InAppNotification.user_id == user_id,
            )
            .limit(1)
        )
    ).scalar_one_or_none()

    if row is None:
        raise ValueError("notification not found")

    if not row.is_read:
        now = _now_utc()
        row.is_read = True
        row.read_at = now
        row.updated_at = now
        await db.commit()
        await db.refresh(row)

    return _notification_to_dict(row)


async def mark_all_in_app_notifications_read(db: AsyncSession, org_id: int, user_id: int) -> dict[str, int]:
    """Mark all unread notifications as read for one scoped user."""
    now = _now_utc()
    result = await db.execute(
        update(InAppNotification)
        .where(
            InAppNotification.org_id == org_id,
            InAppNotification.user_id == user_id,
            InAppNotification.is_read.is_(False),
        )
        .values(is_read=True, read_at=now, updated_at=now)
    )
    await db.commit()

    updated = int(result.rowcount or 0)
    return {"updated": updated}
