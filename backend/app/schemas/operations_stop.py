"""Schemas for operations route stop and collection event APIs."""

from datetime import datetime

from pydantic import BaseModel, Field


class StopArriveRequest(BaseModel):
    """Payload for marking stop arrival."""

    actual_arrival: datetime | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    notes: str | None = None


class StopServiceRequest(BaseModel):
    """Payload for marking stop serviced."""

    actual_departure: datetime | None = None
    fill_before_pct: float | None = Field(default=None, ge=0, le=100)
    fill_after_pct: float | None = Field(default=None, ge=0, le=100)
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    notes: str | None = None
    photo_url: str | None = Field(default=None, max_length=255)


class StopSkipRequest(BaseModel):
    """Payload for marking stop skipped."""

    reason: str = Field(min_length=1, max_length=255)
    actual_departure: datetime | None = None
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    notes: str | None = None


class RouteStopResponse(BaseModel):
    """Route stop representation returned by APIs."""

    id: int
    route_id: int
    stop_sequence: int
    bin_id: int
    planned_eta: datetime | None = None
    planned_service_minutes: float | None = None
    priority_snapshot: float | None = None
    status: str
    actual_arrival: datetime | None = None
    actual_departure: datetime | None = None
    skip_reason: str | None = None


class RouteStopListResponse(BaseModel):
    """Paginated route stop list."""

    total: int
    limit: int
    offset: int
    items: list[RouteStopResponse]
