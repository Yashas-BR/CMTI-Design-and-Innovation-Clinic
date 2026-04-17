"""Unit tests for operations hardening behaviors (idempotency, audit, and routing matrix)."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.operations_assignments import accept_route_assignment
from app.services.operations_routes import CandidateBin, plan_route
from app.services.operations_stops import arrive_stop


@pytest.mark.asyncio
async def test_arrive_stop_idempotency_replay_short_circuits_side_effects() -> None:
    """Arrive action should no-op when an idempotency key was already processed."""
    stop = SimpleNamespace(
        id=501,
        route_id=7001,
        stop_sequence=1,
        bin_id=101,
        planned_eta=None,
        planned_service_minutes=None,
        priority_snapshot=None,
        status="pending",
        actual_arrival=None,
        actual_departure=None,
        skip_reason=None,
    )
    route = SimpleNamespace(id=7001)
    db = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    with (
        patch("app.services.operations_stops._get_stop_scoped", new=AsyncMock(return_value=(stop, route))),
        patch("app.services.operations_stops.find_audit_by_request", new=AsyncMock(return_value=SimpleNamespace(id=1))),
        patch("app.services.operations_stops._resolve_assignment_for_action", new=AsyncMock()) as resolve_mock,
        patch("app.services.operations_stops._append_collection_event", new=AsyncMock()) as event_mock,
        patch("app.services.operations_stops.append_audit_log", new=AsyncMock()) as audit_mock,
    ):
        result = await arrive_stop(
            db,
            org_id=1,
            actor_user_id=22,
            actor_roles={"driver"},
            stop_id=501,
            actual_arrival=None,
            gps_latitude=None,
            gps_longitude=None,
            notes=None,
            idempotency_key="idem-stop-501-arrive",
        )

    assert result["status"] == "pending"
    assert resolve_mock.await_count == 0
    assert event_mock.await_count == 0
    assert audit_mock.await_count == 0
    assert db.commit.await_count == 0


@pytest.mark.asyncio
async def test_accept_assignment_writes_audit_log() -> None:
    """Accept action should update state and append an audit row."""
    assignment = SimpleNamespace(
        id=90001,
        route_id=7001,
        driver_user_id=22,
        vehicle_id=3,
        assigned_by=10,
        assigned_at=None,
        accepted_at=None,
        rejected_at=None,
        reject_reason=None,
        status="assigned",
    )
    db = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    with (
        patch("app.services.operations_assignments._get_assignment_scoped", new=AsyncMock(return_value=assignment)),
        patch("app.services.operations_assignments.append_audit_log", new=AsyncMock()) as audit_mock,
    ):
        result = await accept_route_assignment(
            db,
            org_id=1,
            actor_user_id=22,
            actor_roles={"driver"},
            assignment_id=90001,
        )

    assert result["status"] == "accepted"
    assert assignment.accepted_at is not None
    assert audit_mock.await_count == 1
    assert audit_mock.await_args.kwargs["action_type"] == "assignment_accepted"
    assert db.commit.await_count == 1
    assert db.refresh.await_count == 1


@pytest.mark.asyncio
async def test_plan_route_uses_matrix_and_writes_audit() -> None:
    """Route planning should consume the matrix provider and append audit context."""
    db = SimpleNamespace()
    candidate = CandidateBin(
        point_id="bin:101",
        bin_id=101,
        bin_code="BIN_101",
        latitude=12.972,
        longitude=77.598,
        fill_pct=92.0,
        priority_score=88.2,
    )
    start_point = SimpleNamespace(
        source="route_depot",
        depot_id=2,
        area_id=None,
        latitude=12.9716,
        longitude=77.5946,
    )

    matrix = {
        ("__start__", "__start__"): 0.0,
        ("__start__", "bin:101"): 1.25,
        ("bin:101", "__start__"): 1.25,
        ("bin:101", "bin:101"): 0.0,
    }

    with (
        patch("app.services.operations_routes._get_candidate_bins", new=AsyncMock(return_value=[candidate])),
        patch(
            "app.services.operations_routes.resolve_start_point_for_planning",
            new=AsyncMock(return_value=start_point),
        ),
        patch("app.services.operations_routes.build_travel_cost_matrix", new=AsyncMock(return_value=matrix)) as matrix_mock,
        patch("app.services.operations_routes.append_audit_log", new=AsyncMock()) as audit_mock,
    ):
        result = await plan_route(
            db,
            1,
            route_date=date(2026, 4, 18),
            depot_id=2,
            driver_user_id=22,
            include_bin_ids=[101],
            max_stops=10,
            min_fill_pct=70.0,
            overflow_only=False,
            target_shift_minutes=480,
            avg_speed_kmph=22.0,
            service_minutes_per_stop=4.0,
            actor_user_id=10,
            ip_address="127.0.0.1",
            user_agent="pytest",
        )

    assert matrix_mock.await_count == 1
    assert audit_mock.await_count == 1
    assert result["selected_stops"] == 1
    assert result["estimated_distance_km"] == 1.25
