"""Schemas for operations route assignment APIs."""

from datetime import datetime

from pydantic import BaseModel, Field


class RouteAssignmentCreateRequest(BaseModel):
    """Payload for assigning a driver and optional vehicle to a route."""

    driver_user_id: int = Field(gt=0)
    vehicle_id: int | None = Field(default=None, gt=0)


class RouteAssignmentRejectRequest(BaseModel):
    """Payload for assignment reject action."""

    reject_reason: str = Field(min_length=1, max_length=255)


class RouteAssignmentResponse(BaseModel):
    """Route assignment representation returned by APIs."""

    id: int
    route_id: int
    driver_user_id: int
    vehicle_id: int | None = None
    assigned_by: int | None = None
    assigned_at: datetime
    accepted_at: datetime | None = None
    rejected_at: datetime | None = None
    reject_reason: str | None = None
    status: str


class RouteAssignmentListResponse(BaseModel):
    """Paginated assignment list."""

    total: int
    limit: int
    offset: int
    items: list[RouteAssignmentResponse]
