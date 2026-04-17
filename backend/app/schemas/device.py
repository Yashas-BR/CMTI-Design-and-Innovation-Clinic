"""Schemas for device CRUD and assignment history APIs."""

from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class DeviceCreateRequest(BaseModel):
    """Payload for creating one device."""

    bin_id: int
    device_uid: str = Field(min_length=1, max_length=100)
    mqtt_client_id: str = Field(min_length=1, max_length=100)
    firmware_version: str | None = Field(default=None, max_length=50)
    hardware_revision: str | None = Field(default=None, max_length=50)
    status: str = Field(default="online", min_length=1, max_length=20)
    installed_at: datetime | None = None
    last_seen_at: datetime | None = None


class DeviceUpdateRequest(BaseModel):
    """Payload for partial device updates."""

    mqtt_client_id: str | None = Field(default=None, min_length=1, max_length=100)
    firmware_version: str | None = Field(default=None, max_length=50)
    hardware_revision: str | None = Field(default=None, max_length=50)
    status: str | None = Field(default=None, min_length=1, max_length=20)
    installed_at: datetime | None = None
    decommissioned_at: datetime | None = None
    last_seen_at: datetime | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> "DeviceUpdateRequest":
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        return self


class DeviceResponse(BaseModel):
    """Device representation returned by APIs."""

    id: int
    bin_id: int
    org_id: int
    device_uid: str
    mqtt_client_id: str
    firmware_version: str | None = None
    hardware_revision: str | None = None
    status: str
    installed_at: datetime | None = None
    decommissioned_at: datetime | None = None
    last_seen_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class DeviceListResponse(BaseModel):
    """Paginated list of devices."""

    total: int
    limit: int
    offset: int
    items: list[DeviceResponse]


class AssignmentCreateRequest(BaseModel):
    """Payload to assign or reassign a device to a bin."""

    bin_id: int
    notes: str | None = Field(default=None, max_length=255)
    active_from: datetime | None = None


class AssignmentHistoryItem(BaseModel):
    """Single assignment history row."""

    id: int
    bin_id: int
    device_id: int
    active_from: datetime
    active_to: datetime | None = None
    notes: str | None = None
    created_at: datetime


class AssignmentHistoryResponse(BaseModel):
    """Paginated assignment history response."""

    total: int
    limit: int
    offset: int
    items: list[AssignmentHistoryItem]
