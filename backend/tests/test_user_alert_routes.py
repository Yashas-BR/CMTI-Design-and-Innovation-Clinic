"""Route contract tests for user admin and alert management endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, require_authority_or_driver_user, require_authority_user
from app.main import app


async def _authority_user_override() -> AuthUser:
    return AuthUser(id=1, org_id=1, email="operator@example.com", roles={"authority_operator"})


async def _driver_user_override() -> AuthUser:
    return AuthUser(id=31, org_id=1, email="driver@example.com", roles={"driver"})


@pytest.mark.asyncio
async def test_list_users_route_returns_paginated_payload() -> None:
    """Users list endpoint should return paginated user items."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 11,
                "org_id": 1,
                "full_name": "A Driver",
                "email": "a.driver@example.com",
                "phone": None,
                "status": "active",
                "is_active": True,
                "role_keys": ["driver"],
                "created_at": "2026-04-17T10:00:00Z",
                "updated_at": "2026-04-17T10:00:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.users.list_users", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/users")
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_add_roles_route_returns_updated_user() -> None:
    """Explicit role add endpoint should return updated user representation."""
    mock_result = {
        "id": 11,
        "org_id": 1,
        "full_name": "A Driver",
        "email": "a.driver@example.com",
        "phone": None,
        "status": "active",
        "is_active": True,
        "role_keys": ["driver", "authority_operator"],
        "created_at": "2026-04-17T10:00:00Z",
        "updated_at": "2026-04-17T11:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.users.add_user_roles", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/users/11/roles/add",
                    json={"role_keys": ["authority_operator"]},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert "authority_operator" in response.json()["role_keys"]


@pytest.mark.asyncio
async def test_reset_user_password_route_returns_user() -> None:
    """Password reset endpoint should return updated user summary."""
    mock_result = {
        "id": 11,
        "org_id": 1,
        "full_name": "A Driver",
        "email": "a.driver@example.com",
        "phone": None,
        "status": "active",
        "is_active": True,
        "role_keys": ["driver"],
        "created_at": "2026-04-17T10:00:00Z",
        "updated_at": "2026-04-17T11:30:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.users.reset_user_password", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/users/11/password/reset",
                    json={"new_password": "newStrongPassword1"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["id"] == 11


@pytest.mark.asyncio
async def test_list_alerts_route_returns_items_for_driver() -> None:
    """Alert list endpoint should be accessible to driver role."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 1001,
                "org_id": 1,
                "bin_id": 7,
                "bin_code": "BIN_007",
                "rule_id": None,
                "alert_type": "fill_threshold",
                "severity": "warning",
                "status": "open",
                "opened_at": "2026-04-17T11:00:00Z",
                "acknowledged_at": None,
                "resolved_at": None,
                "assigned_to_user_id": 31,
                "title": "Bin BIN_007 reached YELLOW",
                "description": "Fill level alert",
                "latest_telemetry_id": 99,
                "dedupe_key": "1:7:fill_threshold",
                "created_at": "2026-04-17T11:00:00Z",
                "updated_at": "2026-04-17T11:00:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.alerts.list_alerts", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/alerts")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == 1001


@pytest.mark.asyncio
async def test_acknowledge_alert_route_driver_allowed() -> None:
    """Drivers should be able to acknowledge alerts through route contract."""
    mock_result = {
        "id": 1001,
        "org_id": 1,
        "bin_id": 7,
        "bin_code": "BIN_007",
        "rule_id": None,
        "alert_type": "fill_threshold",
        "severity": "warning",
        "status": "open",
        "opened_at": "2026-04-17T11:00:00Z",
        "acknowledged_at": "2026-04-17T11:05:00Z",
        "resolved_at": None,
        "assigned_to_user_id": 31,
        "title": "Bin BIN_007 reached YELLOW",
        "description": "Fill level alert",
        "latest_telemetry_id": 99,
        "dedupe_key": "1:7:fill_threshold",
        "created_at": "2026-04-17T11:00:00Z",
        "updated_at": "2026-04-17T11:05:00Z",
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.alerts.acknowledge_alert", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/alerts/1001/acknowledge",
                    json={"note": "Will handle on next stop"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["acknowledged_at"] is not None


@pytest.mark.asyncio
async def test_alert_assign_route_returns_forbidden_on_driver_scope_violation() -> None:
    """Assign route should map driver scope violations to 403."""
    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch(
            "app.api.v1.alerts.assign_alert",
            new=AsyncMock(side_effect=PermissionError("drivers can only assign alerts to themselves")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/alerts/1001/assign",
                    json={"assigned_to_user_id": 2},
                )
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 403
