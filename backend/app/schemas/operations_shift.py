"""Schemas for operations shift APIs."""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class ShiftCreateRequest(BaseModel):
    """Payload for creating one driver shift."""

    driver_user_id: int = Field(gt=0)
    vehicle_id: int | None = Field(default=None, gt=0)
    planned_start: datetime
    planned_end: datetime
    notes: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def validate_time_window(self) -> "ShiftCreateRequest":
        if self.planned_end <= self.planned_start:
            raise ValueError("planned_end must be greater than planned_start")
        return self


class ShiftResponse(BaseModel):
    """Shift representation returned by APIs."""

    id: int
    org_id: int
    driver_user_id: int
    vehicle_id: int | None = None
    planned_start: datetime
    planned_end: datetime
    actual_start: datetime | None = None
    actual_end: datetime | None = None
    status: str
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class ShiftListResponse(BaseModel):
    """Paginated shift list."""

    total: int
    limit: int
    offset: int
    items: list[ShiftResponse]
