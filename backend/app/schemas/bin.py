"""Schemas for bin CRUD and query APIs."""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class BinCreateRequest(BaseModel):
    """Payload for creating one bin."""

    bin_code: str = Field(min_length=1, max_length=50)
    display_name: str | None = Field(default=None, max_length=120)
    address_line: str | None = Field(default=None, max_length=255)
    area_id: int | None = None
    depot_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    capacity_liters: float | None = None
    bin_height_cm: float = Field(default=60.0, gt=0)
    dead_zone_cm: float = Field(default=5.0, ge=0)
    threshold_green: float = Field(default=50.0, ge=0, le=100)
    threshold_yellow: float = Field(default=80.0, ge=0, le=100)
    distance_factor: float = Field(default=0.5, ge=0, le=1)
    status: str = Field(default="active", min_length=1, max_length=20)
    installed_at: datetime | None = None
    last_service_at: datetime | None = None

    @model_validator(mode="after")
    def validate_threshold_order(self) -> "BinCreateRequest":
        if self.threshold_green >= self.threshold_yellow:
            raise ValueError("threshold_green must be less than threshold_yellow")
        return self


class BinUpdateRequest(BaseModel):
    """Payload for partial bin updates."""

    display_name: str | None = Field(default=None, max_length=120)
    address_line: str | None = Field(default=None, max_length=255)
    area_id: int | None = None
    depot_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    capacity_liters: float | None = None
    bin_height_cm: float | None = Field(default=None, gt=0)
    dead_zone_cm: float | None = Field(default=None, ge=0)
    threshold_green: float | None = Field(default=None, ge=0, le=100)
    threshold_yellow: float | None = Field(default=None, ge=0, le=100)
    distance_factor: float | None = Field(default=None, ge=0, le=1)
    status: str | None = Field(default=None, min_length=1, max_length=20)
    installed_at: datetime | None = None
    last_service_at: datetime | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "BinUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")

        green = self.threshold_green
        yellow = self.threshold_yellow
        if green is not None and yellow is not None and green >= yellow:
            raise ValueError("threshold_green must be less than threshold_yellow")
        return self


class BinResponse(BaseModel):
    """Bin representation returned by APIs."""

    id: int
    org_id: int
    bin_code: str
    display_name: str | None = None
    address_line: str | None = None
    area_id: int | None = None
    depot_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    capacity_liters: float | None = None
    bin_height_cm: float
    dead_zone_cm: float
    threshold_green: float
    threshold_yellow: float
    distance_factor: float
    status: str
    installed_at: datetime | None = None
    last_service_at: datetime | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class BinListResponse(BaseModel):
    """Paginated list of bins."""

    total: int
    limit: int
    offset: int
    items: list[BinResponse]


class BinSearchResponse(BinListResponse):
    """Search response for bins."""
