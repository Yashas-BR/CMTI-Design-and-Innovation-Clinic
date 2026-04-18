"""Route contract tests for operations route planning endpoints."""

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
async def test_plan_route_route_returns_plan_payload() -> None:
    """Route planning endpoint should return deterministic plan contract."""
    mock_result = {
        "algorithm": "greedy_nn_2opt_v1",
        "route_date": "2026-04-18",
        "candidates_considered": 5,
        "selected_stops": 3,
        "skipped_due_to_shift": 1,
        "estimated_distance_km": 8.12,
        "estimated_duration_min": 34.4,
        "start_point": {
            "source": "route_depot",
            "depot_id": 2,
            "area_id": None,
            "latitude": 12.9716,
            "longitude": 77.5946,
        },
        "items": [
            {
                "stop_sequence": 1,
                "bin_id": 101,
                "bin_code": "BIN_101",
                "latitude": 12.972,
                "longitude": 77.598,
                "fill_pct": 92.0,
                "priority_score": 88.2,
                "planned_leg_km": 1.2,
                "planned_cumulative_km": 1.2,
            }
        ],
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        plan_mock = AsyncMock(return_value=mock_result)
        with patch("app.api.v1.operations.plan_route", new=plan_mock):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/routes/plan",
                    json={
                        "route_date": "2026-04-18",
                        "depot_id": 2,
                        "max_stops": 10,
                        "min_fill_pct": 70,
                    },
                    headers={"User-Agent": "pytest-agent"},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["algorithm"] == "greedy_nn_2opt_v1"
    assert plan_mock.await_count == 1
    assert plan_mock.await_args.kwargs["actor_user_id"] == 10
    assert plan_mock.await_args.kwargs["ip_address"] == "127.0.0.1"
    assert plan_mock.await_args.kwargs["user_agent"] == "pytest-agent"


@pytest.mark.asyncio
async def test_create_route_route_returns_created() -> None:
    """Route draft creation endpoint should return 201 with route payload."""
    mock_result = {
        "id": 7001,
        "org_id": 1,
        "route_code": "R-20260418-A",
        "route_date": "2026-04-18",
        "depot_id": 2,
        "status": "draft",
        "total_distance_km": None,
        "estimated_duration_min": None,
        "optimization_run_id": None,
        "created_by": 10,
        "updated_by": 10,
        "stops_count": 3,
        "start_point": {
            "source": "route_depot",
            "depot_id": 2,
            "area_id": None,
            "latitude": 12.9716,
            "longitude": 77.5946,
        },
        "created_at": "2026-04-17T10:00:00Z",
        "updated_at": "2026-04-17T10:00:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.create_route_draft", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/routes",
                    json={
                        "route_code": "R-20260418-A",
                        "route_date": "2026-04-18",
                        "depot_id": 2,
                        "stop_bin_ids": [101, 102, 103],
                    },
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 201
    assert response.json()["status"] == "draft"


@pytest.mark.asyncio
async def test_auto_plan_routes_route_returns_summary() -> None:
    """Auto-plan endpoint should return creation summary and created routes."""
    mock_result = {
        "route_date": "2026-04-18",
        "triggered": True,
        "created_count": 1,
        "skipped_count": 0,
        "created_routes": [
            {
                "id": 7101,
                "org_id": 1,
                "route_code": "AUTO-20260418-D2-083000-01",
                "route_date": "2026-04-18",
                "depot_id": 2,
                "status": "draft",
                "total_distance_km": None,
                "estimated_duration_min": None,
                "optimization_run_id": 8801,
                "created_by": 10,
                "updated_by": 10,
                "stops_count": 4,
                "start_point": {
                    "source": "route_depot",
                    "depot_id": 2,
                    "area_id": None,
                    "latitude": 12.9716,
                    "longitude": 77.5946,
                },
                "auto_generated": True,
                "optimization_summary": {
                    "planner_type": "auto_monitoring",
                    "algorithm": "greedy_nn_2opt_v1",
                    "recommended_start_at": "2026-04-18T08:35:00Z",
                    "baseline_distance_km": 12.4,
                    "estimated_distance_km": 10.1,
                    "estimated_fuel_saved_liters": 0.66,
                    "selected_stops": 4,
                    "candidates_considered": 6,
                    "skipped_due_to_shift": 0,
                    "cluster_depot_id": 2,
                    "cluster_area_id": None,
                    "efficiency_reasoning": ["test reason"],
                },
                "created_at": "2026-04-18T08:30:00Z",
                "updated_at": "2026-04-18T08:30:00Z",
            }
        ],
        "reasons": ["created auto draft"],
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.auto_plan_routes_from_live_state", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/routes/auto-plan",
                    json={"route_date": "2026-04-18", "force": False},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["triggered"] is True
    assert response.json()["created_count"] == 1


@pytest.mark.asyncio
async def test_list_routes_route_returns_items() -> None:
    """Route list endpoint should return paginated payload."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 7001,
                "org_id": 1,
                "route_code": "R-20260418-A",
                "route_date": "2026-04-18",
                "depot_id": 2,
                "status": "draft",
                "total_distance_km": None,
                "estimated_duration_min": None,
                "optimization_run_id": None,
                "created_by": 10,
                "updated_by": 10,
                "stops_count": 3,
                "start_point": None,
                "created_at": "2026-04-17T10:00:00Z",
                "updated_at": "2026-04-17T10:00:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.list_routes", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/routes")
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1


@pytest.mark.asyncio
async def test_list_my_routes_route_returns_items() -> None:
    """Driver route list endpoint should return assigned route payload."""
    mock_result = {
        "total": 1,
        "limit": 50,
        "offset": 0,
        "items": [
            {
                "id": 7001,
                "org_id": 1,
                "route_code": "R-20260418-A",
                "route_date": "2026-04-18",
                "depot_id": 2,
                "status": "published",
                "total_distance_km": 8.2,
                "estimated_duration_min": 34.5,
                "optimization_run_id": None,
                "created_by": 10,
                "updated_by": 10,
                "stops_count": 3,
                "start_point": None,
                "assignment_id": 90001,
                "assignment_status": "accepted",
                "assigned_at": "2026-04-17T10:00:00Z",
                "accepted_at": "2026-04-17T10:05:00Z",
                "rejected_at": None,
                "reject_reason": None,
                "vehicle_id": 3,
                "created_at": "2026-04-17T10:00:00Z",
                "updated_at": "2026-04-17T10:05:00Z",
            }
        ],
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.list_driver_routes", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/my-routes")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["assignment_status"] == "accepted"


@pytest.mark.asyncio
async def test_driver_list_my_routes_forces_self_scope() -> None:
    """Driver my-routes endpoint must ignore requested driver_user_id and use auth user id."""
    list_mock = AsyncMock(return_value={"total": 0, "limit": 50, "offset": 0, "items": []})

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.operations.list_driver_routes", new=list_mock):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/operations/my-routes?driver_user_id=999")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert list_mock.await_count == 1
    assert list_mock.await_args.kwargs["driver_user_id"] == 22


@pytest.mark.asyncio
async def test_publish_route_route_returns_published() -> None:
    """Publish endpoint should return published route payload."""
    mock_result = {
        "id": 7001,
        "org_id": 1,
        "route_code": "R-20260418-A",
        "route_date": "2026-04-18",
        "depot_id": 2,
        "status": "published",
        "total_distance_km": 8.2,
        "estimated_duration_min": 34.5,
        "optimization_run_id": None,
        "created_by": 10,
        "updated_by": 10,
        "stops_count": 3,
        "start_point": {
            "source": "route_depot",
            "depot_id": 2,
            "area_id": None,
            "latitude": 12.9716,
            "longitude": 77.5946,
        },
        "created_at": "2026-04-17T10:00:00Z",
        "updated_at": "2026-04-17T10:05:00Z",
    }

    app.dependency_overrides[require_authority_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.publish_route", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post(
                    "/api/v1/operations/routes/7001/publish",
                    json={"driver_user_id": 22},
                )
    finally:
        app.dependency_overrides.pop(require_authority_user, None)

    assert response.status_code == 200
    assert response.json()["status"] == "published"


@pytest.mark.asyncio
async def test_start_route_route_returns_in_progress() -> None:
    """Start endpoint should return in-progress route payload."""
    mock_result = {
        "id": 7001,
        "org_id": 1,
        "route_code": "R-20260418-A",
        "route_date": "2026-04-18",
        "depot_id": 2,
        "status": "in_progress",
        "total_distance_km": 8.2,
        "estimated_duration_min": 34.5,
        "optimization_run_id": None,
        "created_by": 10,
        "updated_by": 10,
        "stops_count": 3,
        "start_point": None,
        "created_at": "2026-04-17T10:00:00Z",
        "updated_at": "2026-04-17T10:05:00Z",
    }

    app.dependency_overrides[require_authority_or_driver_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.start_route", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/v1/operations/routes/7001/start")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"


@pytest.mark.asyncio
async def test_complete_route_route_returns_completed() -> None:
    """Complete endpoint should return completed route payload."""
    mock_result = {
        "id": 7001,
        "org_id": 1,
        "route_code": "R-20260418-A",
        "route_date": "2026-04-18",
        "depot_id": 2,
        "status": "completed",
        "total_distance_km": 8.2,
        "estimated_duration_min": 34.5,
        "optimization_run_id": None,
        "created_by": 10,
        "updated_by": 10,
        "stops_count": 3,
        "start_point": None,
        "created_at": "2026-04-17T10:00:00Z",
        "updated_at": "2026-04-17T12:30:00Z",
    }

    app.dependency_overrides[require_authority_or_driver_user] = _authority_user_override
    try:
        with patch("app.api.v1.operations.complete_route", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/api/v1/operations/routes/7001/complete")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_routes_plan_requires_auth_by_default() -> None:
    """Route planning endpoint should reject unauthenticated requests."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/operations/routes/plan",
            json={"route_date": "2026-04-18"},
        )

    assert response.status_code == 401
