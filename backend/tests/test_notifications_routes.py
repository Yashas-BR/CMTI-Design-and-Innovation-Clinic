"""Route contract tests for in-app notifications endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, require_authority_or_driver_user
from app.main import app


async def _driver_user_override() -> AuthUser:
    return AuthUser(id=31, org_id=1, email="driver@example.com", roles={"driver"})


@pytest.mark.asyncio
async def test_list_in_app_notifications_route_returns_items() -> None:
    """List endpoint should return paginated in-app notifications for current user."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 501,
                "org_id": 1,
                "user_id": 31,
                "event_type": "route_assigned",
                "severity": "info",
                "title": "Route assigned: ROUTE-7001",
                "message": "Route 7001 has been assigned to you.",
                "payload_json": {"route_id": 7001},
                "is_read": False,
                "read_at": None,
                "created_at": "2026-04-18T08:30:00Z",
                "updated_at": "2026-04-18T08:30:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.notifications.list_in_app_notifications", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/notifications/in-app")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == 501


@pytest.mark.asyncio
async def test_mark_in_app_notification_read_maps_not_found() -> None:
    """Mark-read endpoint should map missing notification to 404."""
    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch(
            "app.api.v1.notifications.mark_in_app_notification_read",
            new=AsyncMock(side_effect=ValueError("notification not found")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/v1/notifications/in-app/999/read")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_mark_all_in_app_notifications_read_returns_count() -> None:
    """Read-all endpoint should return number of updated notifications."""
    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch(
            "app.api.v1.notifications.mark_all_in_app_notifications_read",
            new=AsyncMock(return_value={"updated": 3}),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/v1/notifications/in-app/read-all")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["updated"] == 3


@pytest.mark.asyncio
async def test_in_app_notifications_require_auth_by_default() -> None:
    """In-app list endpoint should reject unauthenticated requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/notifications/in-app")

    assert response.status_code == 401
