"""Route contract tests for operations route assignment endpoints."""

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
async def test_create_route_assignment_route_returns_created() -> None:
    """Route assignment create endpoint should return 201 with assignment payload."""
    mock_result = {
        "id": 90001,
        "route_id": 7001,
        "driver_user_id": 22,
        "vehicle_id": 3,
        "assigned_by": 10,
        "assigned_at": "2026-04-17T10:10:00Z",
        "accepted_at": None,
        "rejected_at": None,
        "reject_reason": None,
        "status": "assigned",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.create_route_assignment", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/routes/7001/assignments",
                    json={"driver_user_id": 22, "vehicle_id": 3},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["status"] == "assigned"


@pytest.mark.asyncio
async def test_list_route_assignments_route_returns_items() -> None:
    """Route assignment list endpoint should return paginated payload."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 90001,
                "route_id": 7001,
                "driver_user_id": 22,
                "vehicle_id": 3,
                "assigned_by": 10,
                "assigned_at": "2026-04-17T10:10:00Z",
                "accepted_at": None,
                "rejected_at": None,
                "reject_reason": None,
                "status": "assigned",
            }
        ],
    }

    app.dependency_overrides[require_authority_or_driver_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.list_route_assignments", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/routes/7001/assignments")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_driver_list_assignments_scoped_to_self() -> None:
    """Driver list assignments should be scoped to authenticated driver id."""
    list_mock = AsyncMock(return_value={"total": 0, "limit": 50, "offset": 0, "items": []})

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.list_route_assignments", new=list_mock):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/routes/7001/assignments")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert list_mock.await_count == 1
    assert list_mock.await_args.kwargs["driver_user_id"] == 22


@pytest.mark.asyncio
async def test_accept_assignment_route_driver_allowed() -> None:
    """Driver should be able to accept own assignment."""
    mock_result = {
        "id": 90001,
        "route_id": 7001,
        "driver_user_id": 22,
        "vehicle_id": 3,
        "assigned_by": 10,
        "assigned_at": "2026-04-17T10:10:00Z",
        "accepted_at": "2026-04-17T10:12:00Z",
        "rejected_at": None,
        "reject_reason": None,
        "status": "accepted",
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.accept_route_assignment", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/v1/operations/assignments/90001/accept")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["status"] == "accepted"


@pytest.mark.asyncio
async def test_reject_assignment_route_returns_forbidden_on_scope_violation() -> None:
    """Reject endpoint should map driver scope violation to 403."""
    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch(
            "app.api.v1.operations.reject_route_assignment",
            new=AsyncMock(side_effect=PermissionError("drivers can only act on their own assignments")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/assignments/90001/reject",
                    json={"reject_reason": "vehicle issue"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_assignments_accept_requires_auth_by_default() -> None:
    """Assignment accept endpoint should reject unauthenticated requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/operations/assignments/90001/accept")

    assert response.status_code == 401
