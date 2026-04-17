"""Schemas for operations vehicle APIs."""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class VehicleCreateRequest(BaseModel):
    """Payload for creating one vehicle."""

    vehicle_no: str = Field(min_length=1, max_length=50)
    vehicle_type: str | None = Field(default=None, max_length=40)
    capacity_kg: float | None = Field(default=None, gt=0)
    status: str = Field(default="active", min_length=1, max_length=20)


class VehicleUpdateRequest(BaseModel):
    """Payload for partial vehicle updates."""

    vehicle_no: str | None = Field(default=None, min_length=1, max_length=50)
    vehicle_type: str | None = Field(default=None, max_length=40)
    capacity_kg: float | None = Field(default=None, gt=0)
    status: str | None = Field(default=None, min_length=1, max_length=20)
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "VehicleUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        return self


class VehicleResponse(BaseModel):
    """Vehicle representation returned by APIs."""

    id: int
    org_id: int
    vehicle_no: str
    vehicle_type: str | None = None
    capacity_kg: float | None = None
    status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class VehicleListResponse(BaseModel):
    """Paginated vehicle list."""

    total: int
    limit: int
    offset: int
    items: list[VehicleResponse]
