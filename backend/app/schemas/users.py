"""Schemas for user administration APIs."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserRoleMutationRequest(BaseModel):
    """Payload for explicit role add/remove operations."""

    role_keys: list[str] = Field(min_length=1)


class UserPasswordResetRequest(BaseModel):
    """Payload for admin/operator password reset."""

    new_password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    """User representation for administration APIs."""

    id: int
    org_id: int
    full_name: str
    email: EmailStr
    phone: str | None = None
    status: str
    is_active: bool
    role_keys: list[str]
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    """Paginated user list response."""

    total: int
    limit: int
    offset: int
    items: list[UserResponse]
