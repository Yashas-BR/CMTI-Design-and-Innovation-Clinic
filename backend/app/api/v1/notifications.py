"""In-app notifications routes for list/read and real-time stream."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_or_driver_user
from app.db.database import get_db
from app.schemas.notifications import (
    InAppNotificationListResponse,
    InAppNotificationReadAllResponse,
    InAppNotificationResponse,
)
from app.services.in_app_notifications import (
    in_app_notification_hub,
    list_in_app_notifications,
    mark_all_in_app_notifications_read,
    mark_in_app_notification_read,
)

router = APIRouter(prefix="/notifications/in-app")


def _status_for_value_error(exc: ValueError) -> int:
    if "not found" in str(exc).lower():
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_400_BAD_REQUEST


@router.get("", response_model=InAppNotificationListResponse)
async def list_in_app_notifications_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    unread_only: bool = Query(default=False),
    severity: str | None = None,
    event_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> InAppNotificationListResponse:
    """List notifications for authenticated user only."""
    data = await list_in_app_notifications(
        db,
        user.org_id,
        user.id,
        limit=limit,
        offset=offset,
        unread_only=unread_only,
        severity=severity,
        event_type=event_type,
    )
    return InAppNotificationListResponse(**data)


@router.post("/{notification_id}/read", response_model=InAppNotificationResponse)
async def mark_in_app_notification_read_route(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> InAppNotificationResponse:
    """Mark one in-app notification as read for current user scope."""
    try:
        data = await mark_in_app_notification_read(
            db,
            user.org_id,
            user.id,
            notification_id=notification_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return InAppNotificationResponse(**data)


@router.post("/read-all", response_model=InAppNotificationReadAllResponse)
async def mark_all_in_app_notifications_read_route(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> InAppNotificationReadAllResponse:
    """Mark all unread notifications as read for current user."""
    data = await mark_all_in_app_notifications_read(db, user.org_id, user.id)
    return InAppNotificationReadAllResponse(**data)


@router.get("/stream")
async def stream_in_app_notifications_route(
    request: Request,
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> StreamingResponse:
    """SSE stream of newly created in-app notifications for current user."""

    async def _event_stream() -> AsyncIterator[str]:
        queue = await in_app_notification_hub.subscribe(user.id)
        try:
            connected_payload = {"type": "connected", "user_id": user.id}
            yield f"event: connected\ndata: {json.dumps(connected_payload)}\n\n"

            while True:
                if await request.is_disconnected():
                    break

                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20)
                    event = {"type": "notification", "notification": payload}
                    yield f"event: notification\ndata: {json.dumps(event, default=str)}\n\n"
                except asyncio.TimeoutError:
                    yield "event: heartbeat\ndata: {}\n\n"
        finally:
            await in_app_notification_hub.unsubscribe(user.id, queue)

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
