"""Route contract tests for bin, device, and assignment APIs."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, require_authority_or_driver_user, require_authority_user
from app.main import app


async def _authority_user_override() -> AuthUser:
    return AuthUser(id=10, org_id=1, email="authority@example.com", roles={"authority_admin"})


async def _driver_user_override() -> AuthUser:
    return AuthUser(id=22, org_id=1, email="driver@example.com", roles={"driver"})


@pytest.mark.asyncio
async def test_create_bin_route_returns_created() -> None:
    """Bin create endpoint should return 201 with created payload."""
    mock_result = {
        "id": 101,
        "org_id": 1,
        "bin_code": "BIN_101",
        "display_name": "Main Street Bin",
        "address_line": "Main Street",
        "area_id": None,
        "depot_id": None,
        "latitude": None,
        "longitude": None,
        "capacity_liters": 240.0,
        "bin_height_cm": 60.0,
        "dead_zone_cm": 5.0,
        "threshold_green": 50.0,
        "threshold_yellow": 80.0,
        "distance_factor": 0.5,
        "status": "active",
        "installed_at": None,
        "last_service_at": None,
        "is_active": True,
        "created_at": "2026-04-17T00:00:00Z",
        "updated_at": "2026-04-17T00:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.bins.create_bin", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/bins",
                    json={
                        "bin_code": "BIN_101",
                        "display_name": "Main Street Bin",
                        "capacity_liters": 240,
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["bin_code"] == "BIN_101"


@pytest.mark.asyncio
async def test_list_bins_route_returns_items() -> None:
    """Bin list endpoint should return paginated payload."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 1,
                "org_id": 1,
                "bin_code": "BIN_001",
                "display_name": "Ward 1 Bin",
                "address_line": None,
                "area_id": None,
                "depot_id": None,
                "latitude": None,
                "longitude": None,
                "capacity_liters": None,
                "bin_height_cm": 60.0,
                "dead_zone_cm": 5.0,
                "threshold_green": 50.0,
                "threshold_yellow": 80.0,
                "distance_factor": 0.5,
                "status": "active",
                "installed_at": None,
                "last_service_at": None,
                "is_active": True,
                "created_at": "2026-04-17T00:00:00Z",
                "updated_at": "2026-04-17T00:00:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.bins.list_bins", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/bins")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_assign_device_route_returns_history_item() -> None:
    """Assign endpoint should return created history row."""
    mock_result = {
        "id": 501,
        "bin_id": 3,
        "device_id": 7,
        "active_from": "2026-04-17T10:00:00Z",
        "active_to": None,
        "notes": "Moved for maintenance",
        "created_at": "2026-04-17T10:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.devices.assign_device_to_bin", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/devices/7/assign",
                    json={"bin_id": 3, "notes": "Moved for maintenance"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["device_id"] == 7


@pytest.mark.asyncio
async def test_bin_assignments_requires_auth_by_default() -> None:
    """Bin assignment history should reject unauthenticated requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/bins/1/assignments")

    assert response.status_code == 401
