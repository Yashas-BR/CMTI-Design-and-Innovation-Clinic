"""Schemas for depot, service-area, and driver-profile CRUD APIs."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class DepotCreateRequest(BaseModel):
    """Payload for creating one depot."""

    name: str = Field(min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    contact_phone: str | None = Field(default=None, max_length=30)
    latitude: float | None = None
    longitude: float | None = None
    is_active: bool = True


class DepotUpdateRequest(BaseModel):
    """Payload for partially updating one depot."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, max_length=255)
    contact_phone: str | None = Field(default=None, max_length=30)
    latitude: float | None = None
    longitude: float | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "DepotUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        return self


class DepotResponse(BaseModel):
    """Depot representation returned by APIs."""

    id: int
    org_id: int
    name: str
    address: str | None = None
    contact_phone: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DepotListResponse(BaseModel):
    """Paginated list of depots."""

    total: int
    limit: int
    offset: int
    items: list[DepotResponse]


class ServiceAreaCreateRequest(BaseModel):
    """Payload for creating one service area."""

    name: str = Field(min_length=1, max_length=120)
    center_latitude: float | None = None
    center_longitude: float | None = None
    boundary_geojson: dict[str, Any] | None = None
    priority_weight: float = Field(default=1.0, gt=0)
    is_active: bool = True


class ServiceAreaUpdateRequest(BaseModel):
    """Payload for partially updating one service area."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    center_latitude: float | None = None
    center_longitude: float | None = None
    boundary_geojson: dict[str, Any] | None = None
    priority_weight: float | None = Field(default=None, gt=0)
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "ServiceAreaUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        return self


class ServiceAreaResponse(BaseModel):
    """Service area representation returned by APIs."""

    id: int
    org_id: int
    name: str
    center_latitude: float | None = None
    center_longitude: float | None = None
    boundary_geojson: dict[str, Any] | None = None
    priority_weight: float
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ServiceAreaListResponse(BaseModel):
    """Paginated list of service areas."""

    total: int
    limit: int
    offset: int
    items: list[ServiceAreaResponse]


class DriverProfileCreateRequest(BaseModel):
    """Payload for creating one driver profile."""

    user_id: int
    license_no: str | None = Field(default=None, max_length=80)
    license_expiry: date | None = None
    home_depot_id: int | None = None
    employment_status: str = Field(min_length=1, max_length=20)


class DriverProfileUpdateRequest(BaseModel):
    """Payload for partially updating one driver profile."""

    license_no: str | None = Field(default=None, max_length=80)
    license_expiry: date | None = None
    home_depot_id: int | None = None
    employment_status: str | None = Field(default=None, min_length=1, max_length=20)

    @model_validator(mode="after")
    def validate_payload(self) -> "DriverProfileUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        return self


class DriverProfileResponse(BaseModel):
    """Driver profile representation returned by APIs."""

    id: int
    org_id: int
    user_id: int
    license_no: str | None = None
    license_expiry: date | None = None
    home_depot_id: int | None = None
    employment_status: str
    created_at: datetime
    updated_at: datetime


class DriverProfileListResponse(BaseModel):
    """Paginated list of driver profiles."""

    total: int
    limit: int
    offset: int
    items: list[DriverProfileResponse]


class DeleteResponse(BaseModel):
    """Delete acknowledgement payload."""

    id: int
    deleted: bool
