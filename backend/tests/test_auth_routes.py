"""Route contract tests for auth/login and driver creation endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, get_current_user, require_authority_user
from app.main import app


async def _authority_user_override() -> AuthUser:
    return AuthUser(id=1, org_id=1, email="operator@example.com", roles={"authority_operator"})


async def _driver_user_override() -> AuthUser:
    return AuthUser(id=10, org_id=1, email="driver@example.com", roles={"driver"})


@pytest.mark.asyncio
async def test_login_route_returns_token_pair() -> None:
    """Login endpoint should return access and refresh tokens."""
    mock_result = {
        "access_token": "access.token.value",
        "refresh_token": "refresh.token.value",
        "token_type": "bearer",
        "expires_in_seconds": 1800,
        "role_keys": ["driver"],
        "user_id": 10,
        "org_id": 1,
    }

    with patch("app.api.v1.auth.login_user", new=AsyncMock(return_value=mock_result)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/login",
                json={"email": "driver@example.com", "password": "secret123"},
            )

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["role_keys"] == ["driver"]


@pytest.mark.asyncio
async def test_refresh_route_returns_new_access_token() -> None:
    """Refresh endpoint should return a new access token payload."""
    mock_result = {
        "access_token": "new.access.token",
        "refresh_token": "new.refresh.token",
        "token_type": "bearer",
        "expires_in_seconds": 1800,
        "role_keys": ["authority_operator"],
        "user_id": 2,
        "org_id": 1,
    }

    with patch("app.api.v1.auth.refresh_access_token", new=AsyncMock(return_value=mock_result)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/auth/refresh",
                json={"refresh_token": "refresh.token.value"},
            )

    assert response.status_code == 200
    assert response.json()["access_token"] == "new.access.token"
    assert response.json()["refresh_token"] == "new.refresh.token"


@pytest.mark.asyncio
async def test_me_route_returns_authenticated_user_summary() -> None:
    """Authenticated profile endpoint should return current user summary for any role."""
    mock_result = {
        "id": 10,
        "org_id": 1,
        "full_name": "Demo Driver",
        "email": "driver@example.com",
        "phone": None,
        "status": "active",
        "is_active": True,
        "role_keys": ["driver"],
        "created_at": "2026-04-17T10:00:00Z",
        "updated_at": "2026-04-17T10:00:00Z",
    }

    app.dependency_overrides[get_current_user] = _driver_user_override
    try:
        with patch("app.api.v1.auth.get_authenticated_user_summary", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/auth/me")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == 10
    assert body["role_keys"] == ["driver"]


@pytest.mark.asyncio
async def test_create_driver_route_returns_created() -> None:
    """Driver creation endpoint should return user summary for created driver."""
    mock_result = {
        "id": 15,
        "org_id": 1,
        "full_name": "New Driver",
        "email": "new.driver@example.com",
        "phone": "9999999999",
        "status": "active",
        "is_active": True,
        "role_keys": ["driver"],
        "created_at": "2026-04-17T12:00:00Z",
        "updated_at": "2026-04-17T12:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.auth.create_driver_user", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/auth/drivers",
                    json={
                        "full_name": "New Driver",
                        "email": "new.driver@example.com",
                        "password": "strongpassword",
                        "phone": "9999999999",
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["role_keys"] == ["driver"]


@pytest.mark.asyncio
async def test_create_driver_requires_authority() -> None:
    """Driver creation should reject unauthenticated requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/drivers",
            json={
                "full_name": "New Driver",
                "email": "new.driver@example.com",
                "password": "strongpassword",
            },
        )

    assert response.status_code == 401
