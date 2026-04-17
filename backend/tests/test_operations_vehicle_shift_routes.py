"""Route contract tests for operations vehicle and shift endpoints."""

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
async def test_create_vehicle_route_returns_created() -> None:
    """Vehicle create endpoint should return 201 with created payload."""
    mock_result = {
        "id": 301,
        "org_id": 1,
        "vehicle_no": "KA01AB1234",
        "vehicle_type": "compactor",
        "capacity_kg": 2500.0,
        "status": "active",
        "is_active": True,
        "created_at": "2026-04-17T00:00:00Z",
        "updated_at": "2026-04-17T00:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.create_vehicle", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/vehicles",
                    json={
                        "vehicle_no": "KA01AB1234",
                        "vehicle_type": "compactor",
                        "capacity_kg": 2500,
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["vehicle_no"] == "KA01AB1234"


@pytest.mark.asyncio
async def test_list_vehicles_route_returns_items() -> None:
    """Vehicle list endpoint should return paginated payload."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 1,
                "org_id": 1,
                "vehicle_no": "KA01AB1234",
                "vehicle_type": "tipper",
                "capacity_kg": 1800.0,
                "status": "active",
                "is_active": True,
                "created_at": "2026-04-17T00:00:00Z",
                "updated_at": "2026-04-17T00:00:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.list_vehicles", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/vehicles")
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_create_shift_route_returns_created() -> None:
    """Shift create endpoint should return 201 with created payload."""
    mock_result = {
        "id": 9001,
        "org_id": 1,
        "driver_user_id": 22,
        "vehicle_id": 1,
        "planned_start": "2026-04-18T06:00:00Z",
        "planned_end": "2026-04-18T14:00:00Z",
        "actual_start": None,
        "actual_end": None,
        "status": "scheduled",
        "notes": "Morning route",
        "created_at": "2026-04-17T00:00:00Z",
        "updated_at": "2026-04-17T00:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.create_shift", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/shifts",
                    json={
                        "driver_user_id": 22,
                        "vehicle_id": 1,
                        "planned_start": "2026-04-18T06:00:00Z",
                        "planned_end": "2026-04-18T14:00:00Z",
                        "notes": "Morning route",
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["status"] == "scheduled"


@pytest.mark.asyncio
async def test_driver_list_shifts_is_scoped_to_self() -> None:
    """Driver listing shifts should always be scoped to authenticated driver id."""
    mock_result = {"total": 0, "limit": 50, "offset": 0, "items": []}
    list_mock = AsyncMock(return_value=mock_result)

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.list_shifts", new=list_mock):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/shifts?driver_user_id=777")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert list_mock.await_count == 1
    assert list_mock.await_args.kwargs["driver_user_id"] == 22


@pytest.mark.asyncio
async def test_driver_get_shift_for_other_driver_is_forbidden() -> None:
    """Driver should not access shifts assigned to another driver."""
    mock_shift = {
        "id": 100,
        "org_id": 1,
        "driver_user_id": 99,
        "vehicle_id": 1,
        "planned_start": "2026-04-18T06:00:00Z",
        "planned_end": "2026-04-18T14:00:00Z",
        "actual_start": None,
        "actual_end": None,
        "status": "scheduled",
        "notes": None,
        "created_at": "2026-04-17T00:00:00Z",
        "updated_at": "2026-04-17T00:00:00Z",
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.get_shift", new=AsyncMock(return_value=mock_shift)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/shifts/100")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_start_shift_route_driver_owner_allowed() -> None:
    """Owning driver should be allowed to start own shift."""
    current_shift = {
        "id": 100,
        "org_id": 1,
        "driver_user_id": 22,
        "vehicle_id": 1,
        "planned_start": "2026-04-18T06:00:00Z",
        "planned_end": "2026-04-18T14:00:00Z",
        "actual_start": None,
        "actual_end": None,
        "status": "scheduled",
        "notes": None,
        "created_at": "2026-04-17T00:00:00Z",
        "updated_at": "2026-04-17T00:00:00Z",
    }
    started_shift = {
        **current_shift,
        "status": "started",
        "actual_start": "2026-04-18T06:02:00Z",
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.get_shift", new=AsyncMock(return_value=current_shift)), patch(
            "app.api.v1.operations.start_shift",
            new=AsyncMock(return_value=started_shift),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/v1/operations/shifts/100/start")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["status"] == "started"


@pytest.mark.asyncio
async def test_operations_vehicle_list_requires_auth_by_default() -> None:
    """Operations vehicle list should reject unauthenticated requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/operations/vehicles")

    assert response.status_code == 401
