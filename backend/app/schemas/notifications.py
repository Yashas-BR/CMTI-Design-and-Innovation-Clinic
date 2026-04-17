"""Schemas for in-app notification APIs."""

from datetime import datetime

from pydantic import BaseModel


class InAppNotificationResponse(BaseModel):
    """Per-user in-app notification representation."""

    id: int
    org_id: int
    user_id: int
    event_type: str
    severity: str
    title: str
    message: str | None = None
    payload_json: dict | None = None
    is_read: bool
    read_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class InAppNotificationListResponse(BaseModel):
    """Paginated in-app notifications for current user."""

    total: int
    limit: int
    offset: int
    items: list[InAppNotificationResponse]


class InAppNotificationReadAllResponse(BaseModel):
    """Bulk read acknowledgement payload."""

    updated: int
