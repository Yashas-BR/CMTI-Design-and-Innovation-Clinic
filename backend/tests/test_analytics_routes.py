"""Route contract tests for analytics reporting endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, require_authority_user
from app.main import app


async def _authority_user_override() -> AuthUser:
    return AuthUser(id=10, org_id=1, email="authority@example.com", roles={"authority_admin"})


@pytest.mark.asyncio
async def test_efficiency_analytics_route_returns_metrics() -> None:
    """Efficiency endpoint should return collections/hour style metrics payload."""
    mock_result = {
        "from_ts": "2026-04-01T00:00:00Z",
        "to_ts": "2026-04-30T23:59:59Z",
        "total_collections": 128,
        "total_routes": 24,
        "total_distance_km": 941.3,
        "total_active_hours": 183.2,
        "collections_per_hour": 0.699,
        "distance_per_collection_km": 7.354,
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch(
            "app.api.v1.analytics.get_efficiency_analytics",
            new=AsyncMock(return_value=mock_result),
        ) as service_mock:
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/api/v1/analytics/efficiency",
                    params={"from": "2026-04-01T00:00:00Z", "to": "2026-04-30T23:59:59Z"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["total_collections"] == 128
    assert service_mock.await_count == 1


@pytest.mark.asyncio
async def test_savings_analytics_route_returns_metrics() -> None:
    """Savings endpoint should return route optimization savings metrics."""
    mock_result = {
        "from_ts": "2026-04-01T00:00:00Z",
        "to_ts": "2026-04-30T23:59:59Z",
        "routes_analyzed": 24,
        "optimized_distance_km": 941.3,
        "naive_distance_km": 1170.4,
        "distance_saved_km": 229.1,
        "distance_saved_pct": 19.576,
        "optimized_fuel_l": 330.3,
        "naive_fuel_l": 412.1,
        "fuel_saved_l": 81.8,
        "fuel_saved_pct": 19.849,
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch(
            "app.api.v1.analytics.get_savings_analytics",
            new=AsyncMock(return_value=mock_result),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/api/v1/analytics/savings",
                    params={"from": "2026-04-01T00:00:00Z", "to": "2026-04-30T23:59:59Z"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["fuel_saved_l"] == 81.8


@pytest.mark.asyncio
async def test_environmental_analytics_route_returns_metrics() -> None:
    """Environmental endpoint should return CO2-reduction metrics."""
    mock_result = {
        "from_ts": "2026-04-01T00:00:00Z",
        "to_ts": "2026-04-30T23:59:59Z",
        "optimized_co2_kg": 885.204,
        "naive_co2_kg": 1104.428,
        "co2_saved_kg": 219.224,
        "co2_reduction_pct": 19.849,
        "fuel_saved_l": 81.8,
        "distance_saved_km": 229.1,
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch(
            "app.api.v1.analytics.get_environmental_analytics",
            new=AsyncMock(return_value=mock_result),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get(
                    "/api/v1/analytics/environmental",
                    params={"from": "2026-04-01T00:00:00Z", "to": "2026-04-30T23:59:59Z"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["co2_saved_kg"] == 219.224


@pytest.mark.asyncio
async def test_analytics_routes_require_auth_by_default() -> None:
    """Analytics endpoints should reject unauthenticated requests by default."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/analytics/efficiency",
            params={"from": "2026-04-01T00:00:00Z", "to": "2026-04-30T23:59:59Z"},
        )

    assert response.status_code == 401
