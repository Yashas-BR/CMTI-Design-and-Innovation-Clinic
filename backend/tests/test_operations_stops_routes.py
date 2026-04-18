"""Route contract tests for operations stop execution endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, require_authority_or_driver_user
from app.main import app


async def _authority_user_override() -> AuthUser:
    return AuthUser(id=10, org_id=1, email="authority@example.com", roles={"authority_admin"})


async def _driver_user_override() -> AuthUser:
    return AuthUser(id=22, org_id=1, email="driver@example.com", roles={"driver"})


@pytest.mark.asyncio
async def test_list_route_stops_route_returns_items() -> None:
    """Route stops list endpoint should return paginated payload."""
    mock_result = {
        "total": 2,
        "limit": 100,
        "offset": 0,
        "items": [
            {
                "id": 501,
                "route_id": 7001,
                "stop_sequence": 1,
                "bin_id": 101,
                "planned_eta": None,
                "planned_service_minutes": None,
                "priority_snapshot": None,
                "status": "pending",
                "actual_arrival": None,
                "actual_departure": None,
                "skip_reason": None,
            }
        ],
    }

    app.dependency_overrides[require_authority_or_driver_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.list_route_stops", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/routes/7001/stops")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 2


@pytest.mark.asyncio
async def test_list_my_stops_route_returns_items() -> None:
    """My stops endpoint should return driver-scoped stop items."""
    mock_result = {
        "total": 1,
        "limit": 100,
        "offset": 0,
        "items": [
            {
                "id": 501,
                "route_id": 7001,
                "stop_sequence": 1,
                "bin_id": 101,
                "planned_eta": None,
                "planned_service_minutes": None,
                "priority_snapshot": None,
                "status": "pending",
                "actual_arrival": None,
                "actual_departure": None,
                "skip_reason": None,
                "route_code": "R-20260418-A",
                "route_date": "2026-04-18",
                "route_status": "in_progress",
                "assignment_id": 90001,
                "assignment_status": "accepted",
                "vehicle_id": 3,
                "bin_code": "BIN-A001",
            }
        ],
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.list_driver_stops", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/my-stops")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["route_code"] == "R-20260418-A"


@pytest.mark.asyncio
async def test_driver_list_my_stops_forces_self_scope() -> None:
    """Driver my-stops endpoint must ignore requested driver_user_id and use auth user id."""
    list_mock = AsyncMock(return_value={"total": 0, "limit": 100, "offset": 0, "items": []})

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.list_driver_stops", new=list_mock):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/my-stops?driver_user_id=999")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert list_mock.await_count == 1
    assert list_mock.await_args.kwargs["driver_user_id"] == 22


@pytest.mark.asyncio
async def test_driver_list_route_stops_scoped_to_self() -> None:
    """Driver route stop list should be scoped to authenticated driver id."""
    list_mock = AsyncMock(return_value={"total": 0, "limit": 100, "offset": 0, "items": []})

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.list_route_stops", new=list_mock):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/routes/7001/stops")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert list_mock.await_count == 1
    assert list_mock.await_args.kwargs["driver_user_id"] == 22


@pytest.mark.asyncio
async def test_arrive_stop_route_returns_updated_stop() -> None:
    """Stop arrive endpoint should return updated stop payload."""
    mock_result = {
        "id": 501,
        "route_id": 7001,
        "stop_sequence": 1,
        "bin_id": 101,
        "planned_eta": None,
        "planned_service_minutes": None,
        "priority_snapshot": None,
        "status": "arrived",
        "actual_arrival": "2026-04-17T11:00:00Z",
        "actual_departure": None,
        "skip_reason": None,
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        arrive_mock = AsyncMock(return_value=mock_result)
        with patch("app.api.v1.operations.arrive_stop", new=arrive_mock):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/stops/501/arrive",
                    json={"notes": "Reached stop"},
                    headers={"Idempotency-Key": "idem-stop-501-arrive"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["status"] == "arrived"
    assert arrive_mock.await_count == 1
    assert arrive_mock.await_args.kwargs["idempotency_key"] == "idem-stop-501-arrive"


@pytest.mark.asyncio
async def test_service_stop_route_returns_updated_stop() -> None:
    """Stop service endpoint should return updated stop payload."""
    mock_result = {
        "id": 501,
        "route_id": 7001,
        "stop_sequence": 1,
        "bin_id": 101,
        "planned_eta": None,
        "planned_service_minutes": None,
        "priority_snapshot": None,
        "status": "serviced",
        "actual_arrival": "2026-04-17T11:00:00Z",
        "actual_departure": "2026-04-17T11:07:00Z",
        "skip_reason": None,
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.service_stop", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/stops/501/service",
                    json={
                        "fill_before_pct": 88.0,
                        "fill_after_pct": 12.0,
                        "notes": "Emptied bin",
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["status"] == "serviced"


@pytest.mark.asyncio
async def test_skip_stop_route_returns_forbidden_on_scope_violation() -> None:
    """Stop skip endpoint should map scope violation to 403."""
    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch(
            "app.api.v1.operations.skip_stop",
            new=AsyncMock(side_effect=PermissionError("driver can only access stops for assigned routes")),
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/stops/501/skip",
                    json={"reason": "road blocked"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_stop_arrive_requires_auth_by_default() -> None:
    """Stop arrive endpoint should reject unauthenticated requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/operations/stops/501/arrive", json={})

    assert response.status_code == 401
