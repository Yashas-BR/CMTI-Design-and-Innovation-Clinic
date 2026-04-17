"""Schemas for alert management APIs."""

from datetime import datetime

from pydantic import BaseModel, Field


class AlertActionRequest(BaseModel):
    """Payload for acknowledge/resolve actions."""

    note: str | None = Field(default=None, max_length=1000)


class AlertAssignRequest(BaseModel):
    """Payload for assigning or unassigning alert ownership."""

    assigned_to_user_id: int | None = None
    note: str | None = Field(default=None, max_length=1000)


class AlertResponse(BaseModel):
    """Alert representation for list/detail APIs."""

    id: int
    org_id: int
    bin_id: int
    bin_code: str
    rule_id: int | None = None
    alert_type: str
    severity: str
    status: str
    opened_at: datetime
    acknowledged_at: datetime | None = None
    resolved_at: datetime | None = None
    assigned_to_user_id: int | None = None
    title: str
    description: str | None = None
    latest_telemetry_id: int | None = None
    dedupe_key: str | None = None
    created_at: datetime
    updated_at: datetime


class AlertListResponse(BaseModel):
    """Paginated list response for alerts."""

    total: int
    limit: int
    offset: int
    items: list[AlertResponse]


class AlertEventResponse(BaseModel):
    """One alert lifecycle event."""

    id: int
    alert_id: int
    event_type: str
    actor_user_id: int | None = None
    event_ts: datetime
    note: str | None = None
    payload_json: dict | None = None


class AlertEventListResponse(BaseModel):
    """Paginated alert-event response."""

    total: int
    limit: int
    offset: int
    items: list[AlertEventResponse]
