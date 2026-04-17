"""Unit tests for operations hardening behaviors (idempotency, audit, and routing matrix)."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.operations_assignments import accept_route_assignment
from app.services.operations_assignments import create_route_assignment
from app.services.bins import update_bin
from app.services.operations_routes import CandidateBin, PlanningVehicle, plan_route
from app.services.operations_stops import arrive_stop, service_stop
from app.services.operations_vehicles import update_vehicle
from app.services.mqtt_ingestion import _open_or_update_alert


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
async def test_service_stop_syncs_current_state_and_resolves_alerts() -> None:
    """Service action should update state snapshot and clear fill/overflow alerts."""
    stop = SimpleNamespace(
        id=501,
        route_id=7001,
        stop_sequence=1,
        bin_id=101,
        planned_eta=None,
        planned_service_minutes=None,
        priority_snapshot=None,
        status="arrived",
        actual_arrival=None,
        actual_departure=None,
        skip_reason=None,
    )
    route = SimpleNamespace(id=7001, org_id=1)
    assignment = SimpleNamespace(vehicle_id=3, driver_user_id=22)
    db = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    with (
        patch("app.services.operations_stops._get_stop_scoped", new=AsyncMock(return_value=(stop, route))),
        patch("app.services.operations_stops.find_audit_by_request", new=AsyncMock(return_value=None)),
        patch(
            "app.services.operations_stops._resolve_assignment_for_action",
            new=AsyncMock(return_value=(assignment, 22)),
        ),
        patch("app.services.operations_stops._append_collection_event", new=AsyncMock()) as event_mock,
        patch("app.services.operations_stops._sync_bin_state_after_service", new=AsyncMock()) as state_sync_mock,
        patch("app.services.operations_stops._resolve_service_related_alerts", new=AsyncMock()) as alerts_mock,
        patch("app.services.operations_stops.auto_complete_route_if_terminal", new=AsyncMock()) as auto_complete_mock,
        patch("app.services.operations_stops.broadcast_bin_current_state_update", new=AsyncMock()) as realtime_mock,
        patch("app.services.operations_stops.append_audit_log", new=AsyncMock()) as audit_mock,
    ):
        result = await service_stop(
            db,
            org_id=1,
            actor_user_id=22,
            actor_roles={"driver"},
            stop_id=501,
            actual_departure=None,
            fill_before_pct=88.0,
            fill_after_pct=12.0,
            gps_latitude=None,
            gps_longitude=None,
            notes="Emptied bin",
            photo_url=None,
            idempotency_key="idem-stop-501-service",
        )

    assert result["status"] == "serviced"
    assert event_mock.await_count == 1
    assert state_sync_mock.await_count == 1
    assert state_sync_mock.await_args.kwargs["fill_after_pct"] == 12.0
    assert alerts_mock.await_count == 1
    assert auto_complete_mock.await_count == 1
    assert realtime_mock.await_count == 1
    assert realtime_mock.await_args.kwargs["bin_id"] == 101
    assert audit_mock.await_count == 1
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
        estimated_load_kg=24.5,
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


@pytest.mark.asyncio
async def test_plan_route_multi_vehicle_uses_solver_output() -> None:
    """Multi-vehicle route planning should expose per-vehicle plans and aggregate totals."""
    db = SimpleNamespace()
    candidates = [
        CandidateBin(
            point_id="bin:101",
            bin_id=101,
            bin_code="BIN_101",
            latitude=12.972,
            longitude=77.598,
            fill_pct=92.0,
            priority_score=88.2,
            estimated_load_kg=20.0,
        ),
        CandidateBin(
            point_id="bin:102",
            bin_id=102,
            bin_code="BIN_102",
            latitude=12.975,
            longitude=77.602,
            fill_pct=87.0,
            priority_score=83.1,
            estimated_load_kg=18.0,
        ),
    ]
    start_point = SimpleNamespace(
        source="route_depot",
        depot_id=2,
        area_id=None,
        latitude=12.9716,
        longitude=77.5946,
    )
    vehicles = [
        PlanningVehicle(vehicle_id=1, vehicle_no="KA01AB1234", capacity_kg=2000.0),
        PlanningVehicle(vehicle_id=2, vehicle_no="KA02CD5678", capacity_kg=1800.0),
    ]
    matrix = {
        ("__start__", "__start__"): 0.0,
        ("__start__", "bin:101"): 1.20,
        ("bin:101", "__start__"): 1.20,
        ("__start__", "bin:102"): 1.70,
        ("bin:102", "__start__"): 1.70,
        ("bin:101", "bin:101"): 0.0,
        ("bin:102", "bin:102"): 0.0,
        ("bin:101", "bin:102"): 0.65,
        ("bin:102", "bin:101"): 0.65,
    }

    with (
        patch("app.services.operations_routes._get_candidate_bins", new=AsyncMock(return_value=candidates)),
        patch(
            "app.services.operations_routes.resolve_start_point_for_planning",
            new=AsyncMock(return_value=start_point),
        ),
        patch("app.services.operations_routes.build_travel_cost_matrix", new=AsyncMock(return_value=matrix)),
        patch("app.services.operations_routes._get_planning_vehicles", new=AsyncMock(return_value=vehicles)),
        patch(
            "app.services.operations_routes._solve_vrp_with_ortools",
            return_value=([ [candidates[0]], [candidates[1]] ], []),
        ),
        patch("app.services.operations_routes.append_audit_log", new=AsyncMock()) as audit_mock,
    ):
        result = await plan_route(
            db,
            1,
            route_date=date(2026, 4, 18),
            depot_id=2,
            driver_user_id=22,
            include_bin_ids=[101, 102],
            max_stops=10,
            min_fill_pct=70.0,
            overflow_only=False,
            target_shift_minutes=480,
            avg_speed_kmph=22.0,
            service_minutes_per_stop=4.0,
            use_multi_vehicle=True,
            vehicle_ids=[1, 2],
            actor_user_id=10,
            ip_address="127.0.0.1",
            user_agent="pytest",
        )

    assert audit_mock.await_count == 1
    assert result["algorithm"] == "vrp_multi_vehicle_ortools_v1"
    assert result["selected_stops"] == 2
    assert result["unassigned_bin_ids"] == []
    assert result["vehicle_routes"] is not None
    assert len(result["vehicle_routes"]) == 2
    assert result["vehicle_routes"][0]["vehicle_id"] == 1
    assert result["vehicle_routes"][1]["vehicle_id"] == 2


@pytest.mark.asyncio
async def test_create_route_assignment_dispatches_notification() -> None:
    """Route assignment creation should trigger notification dispatch after persistence."""
    route = SimpleNamespace(id=7001, org_id=1, status="published", route_code="ROUTE-7001")

    class _ScalarResult:
        def __init__(self, value: int) -> None:
            self._value = value

        def scalar_one(self) -> int:
            return self._value

    db = SimpleNamespace(
        add=lambda obj: setattr(obj, "id", 90001),
        flush=AsyncMock(),
        execute=AsyncMock(return_value=_ScalarResult(0)),
        commit=AsyncMock(),
        refresh=AsyncMock(),
    )

    with (
        patch("app.services.operations_assignments._get_route_scoped", new=AsyncMock(return_value=route)),
        patch("app.services.operations_assignments.ensure_user_belongs_to_org", new=AsyncMock()),
        patch("app.services.operations_assignments._ensure_vehicle_scoped", new=AsyncMock()),
        patch("app.services.operations_assignments.append_audit_log", new=AsyncMock()) as audit_mock,
        patch(
            "app.services.operations_assignments.dispatch_route_assignment_created",
            new=AsyncMock(),
        ) as notify_mock,
    ):
        result = await create_route_assignment(
            db,
            1,
            10,
            route_id=7001,
            driver_user_id=22,
            vehicle_id=3,
        )

    assert result["id"] == 90001
    assert audit_mock.await_count == 1
    assert db.commit.await_count == 1
    assert db.refresh.await_count == 1
    assert notify_mock.await_count == 1
    assert notify_mock.await_args.kwargs["driver_user_id"] == 22


@pytest.mark.asyncio
async def test_open_or_update_alert_tracks_pending_dispatch_for_new_alert() -> None:
    """New alert open should enqueue one pending notification payload."""
    pending_dispatches: list[dict[str, str]] = []
    bin_obj = SimpleNamespace(id=101, org_id=1, bin_code="BIN_101")

    db = SimpleNamespace(
        add=lambda obj: setattr(obj, "id", 1001),
        flush=AsyncMock(),
    )

    with (
        patch("app.services.mqtt_ingestion._get_open_alert", new=AsyncMock(return_value=None)),
        patch("app.services.mqtt_ingestion._append_alert_event", new=AsyncMock()) as event_mock,
    ):
        status = await _open_or_update_alert(
            db,
            bin_obj=bin_obj,
            alert_type="overflow_imminent",
            severity="critical",
            title="Overflow imminent for BIN_101",
            description="Predicted time-to-full is 12 minutes.",
            latest_telemetry_id=501,
            dedupe_key="1:101:overflow_imminent",
            pending_dispatches=pending_dispatches,
        )

    assert status == "opened"
    assert event_mock.await_count == 1
    assert len(pending_dispatches) == 1
    assert pending_dispatches[0]["bin_code"] == "BIN_101"
    assert pending_dispatches[0]["alert_type"] == "overflow_imminent"


@pytest.mark.asyncio
async def test_update_bin_rejects_unexpected_fields() -> None:
    """Bin update should reject unsafe fields outside the allowlist."""
    bin_obj = SimpleNamespace(org_id=1, updated_by=None)
    db = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    with patch("app.services.bins._get_bin_scoped", new=AsyncMock(return_value=bin_obj)):
        with pytest.raises(ValueError, match="unexpected update fields"):
            await update_bin(
                db,
                org_id=1,
                actor_user_id=10,
                bin_id=101,
                payload={"org_id": 999},
            )

    assert db.commit.await_count == 0
    assert bin_obj.org_id == 1


@pytest.mark.asyncio
async def test_update_vehicle_rejects_unexpected_fields() -> None:
    """Vehicle update should reject unsafe fields outside the allowlist."""
    vehicle = SimpleNamespace(created_at="2026-04-18T00:00:00Z")
    db = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())

    with patch("app.services.operations_vehicles._get_vehicle_scoped", new=AsyncMock(return_value=vehicle)):
        with pytest.raises(ValueError, match="unexpected update fields"):
            await update_vehicle(
                db,
                org_id=1,
                vehicle_id=301,
                payload={"created_at": "forged"},
            )

    assert db.commit.await_count == 0
    assert vehicle.created_at == "2026-04-18T00:00:00Z"
