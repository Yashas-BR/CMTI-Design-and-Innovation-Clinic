"""Schemas for authentication and driver-user administration."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """Credentials payload for login."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenRefreshRequest(BaseModel):
    """Payload for access token refresh."""

    refresh_token: str = Field(min_length=10)


class LoginResponse(BaseModel):
    """Token pair response returned on successful login."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in_seconds: int
    role_keys: list[str]
    user_id: int
    org_id: int


class CreateDriverRequest(BaseModel):
    """Payload for authority operator/admin to create one driver account."""

    full_name: str = Field(min_length=1, max_length=150)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=30)


class UserSummaryResponse(BaseModel):
    """Minimal user profile response for administration endpoints."""

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
