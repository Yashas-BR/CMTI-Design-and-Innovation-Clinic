"""Route contract tests for master-data CRUD endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, require_authority_user
from app.main import app


async def _authority_user_override() -> AuthUser:
    return AuthUser(id=10, org_id=1, email="authority@example.com", roles={"authority_admin"})


@pytest.mark.asyncio
async def test_create_depot_route_returns_created() -> None:
    """Depot create endpoint should return 201 with created payload."""
    mock_result = {
        "id": 201,
        "org_id": 1,
        "name": "Ward 1 Depot",
        "address": "Main Road",
        "contact_phone": "9999999999",
        "latitude": 12.972,
        "longitude": 77.594,
        "is_active": True,
        "created_at": "2026-04-18T08:00:00Z",
        "updated_at": "2026-04-18T08:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.master_data.create_depot", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/master-data/depots",
                    json={
                        "name": "Ward 1 Depot",
                        "address": "Main Road",
                        "contact_phone": "9999999999",
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["name"] == "Ward 1 Depot"


@pytest.mark.asyncio
async def test_list_service_areas_route_returns_items() -> None:
    """Service-area list endpoint should return paginated payload."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 301,
                "org_id": 1,
                "name": "North Zone",
                "center_latitude": 12.98,
                "center_longitude": 77.61,
                "boundary_geojson": None,
                "priority_weight": 1.2,
                "is_active": True,
                "created_at": "2026-04-18T08:00:00Z",
                "updated_at": "2026-04-18T08:00:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.master_data.list_service_areas", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/master-data/service-areas")
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_create_driver_profile_route_returns_created() -> None:
    """Driver-profile create endpoint should return 201 with created payload."""
    mock_result = {
        "id": 401,
        "org_id": 1,
        "user_id": 22,
        "license_no": "DL-1234",
        "license_expiry": "2030-01-01",
        "home_depot_id": 201,
        "employment_status": "active",
        "created_at": "2026-04-18T08:00:00Z",
        "updated_at": "2026-04-18T08:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.master_data.create_driver_profile", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/master-data/driver-profiles",
                    json={
                        "user_id": 22,
                        "license_no": "DL-1234",
                        "employment_status": "active",
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["user_id"] == 22


@pytest.mark.asyncio
async def test_master_data_routes_require_auth_by_default() -> None:
    """Master-data endpoints should reject unauthenticated requests by default."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/master-data/depots")

    assert response.status_code == 401
