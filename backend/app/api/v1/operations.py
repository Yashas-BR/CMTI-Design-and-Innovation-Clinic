"""Operations routes for vehicle and shift workflows (phase 1)."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_or_driver_user, require_authority_user
from app.db.database import get_db
from app.schemas.operations_assignment import (
    RouteAssignmentCreateRequest,
    RouteAssignmentListResponse,
    RouteAssignmentRejectRequest,
    RouteAssignmentResponse,
)
from app.schemas.operations_route import (
    DriverRouteListResponse,
    RouteDraftCreateRequest,
    RouteListResponse,
    RoutePlanRequest,
    RoutePlanResponse,
    RoutePublishRequest,
    RouteResponse,
)
from app.schemas.operations_shift import ShiftCreateRequest, ShiftListResponse, ShiftResponse
from app.schemas.operations_stop import (
    DriverStopListResponse,
    RouteStopListResponse,
    RouteStopResponse,
    StopArriveRequest,
    StopServiceRequest,
    StopSkipRequest,
)
from app.schemas.operations_vehicle import VehicleCreateRequest, VehicleListResponse, VehicleResponse, VehicleUpdateRequest
from app.services.operations_assignments import (
    accept_route_assignment,
    create_route_assignment,
    list_route_assignments,
    reject_route_assignment,
)
from app.services.operations_routes import (
    complete_route,
    create_route_draft,
    get_route,
    list_driver_routes,
    list_routes,
    plan_route,
    publish_route,
    start_route,
)
from app.services.operations_shifts import complete_shift, create_shift, get_shift, list_shifts, start_shift
from app.services.operations_stops import arrive_stop, list_driver_stops, list_route_stops, service_stop, skip_stop
from app.services.operations_vehicles import create_vehicle, deactivate_vehicle, get_vehicle, list_vehicles, update_vehicle

router = APIRouter(prefix="/operations")

AUTHORITY_ROLES = {"authority_admin", "authority_operator"}


def _status_for_value_error(exc: ValueError) -> int:
    message = str(exc).lower()
    if "not found" in message:
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_400_BAD_REQUEST


def _is_authority(user: AuthUser) -> bool:
    return bool(AUTHORITY_ROLES.intersection(user.roles))


@router.post("/vehicles", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
async def create_vehicle_route(
    payload: VehicleCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> VehicleResponse:
    """Create one vehicle in caller organization."""
    try:
        data = await create_vehicle(db, user.org_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="vehicle already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return VehicleResponse(**data)


@router.get("/vehicles", response_model=VehicleListResponse)
async def list_vehicles_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    is_active: bool | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> VehicleListResponse:
    """List vehicles for caller organization."""
    data = await list_vehicles(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        is_active=is_active,
        q=q,
    )
    return VehicleListResponse(**data)


@router.get("/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def get_vehicle_route(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> VehicleResponse:
    """Get one vehicle by id."""
    try:
        data = await get_vehicle(db, user.org_id, vehicle_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return VehicleResponse(**data)


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleResponse)
async def update_vehicle_route(
    vehicle_id: int,
    payload: VehicleUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> VehicleResponse:
    """Patch one vehicle by id."""
    try:
        data = await update_vehicle(db, user.org_id, vehicle_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="vehicle update conflict") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return VehicleResponse(**data)


@router.post("/vehicles/{vehicle_id}/deactivate", response_model=VehicleResponse)
async def deactivate_vehicle_route(
    vehicle_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> VehicleResponse:
    """Soft deactivate one vehicle."""
    try:
        data = await deactivate_vehicle(db, user.org_id, vehicle_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return VehicleResponse(**data)


@router.post("/shifts", response_model=ShiftResponse, status_code=status.HTTP_201_CREATED)
async def create_shift_route(
    payload: ShiftCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> ShiftResponse:
    """Create one shift in scheduled state."""
    try:
        data = await create_shift(db, user.org_id, payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return ShiftResponse(**data)


@router.get("/shifts", response_model=ShiftListResponse)
async def list_shifts_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    driver_user_id: int | None = None,
    vehicle_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> ShiftListResponse:
    """List shifts for caller organization with driver scoping."""
    scoped_driver_user_id = driver_user_id
    if not _is_authority(user):
        scoped_driver_user_id = user.id

    data = await list_shifts(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        driver_user_id=scoped_driver_user_id,
        vehicle_id=vehicle_id,
    )
    return ShiftListResponse(**data)


@router.get("/shifts/{shift_id}", response_model=ShiftResponse)
async def get_shift_route(
    shift_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> ShiftResponse:
    """Get one shift by id with driver ownership scope."""
    try:
        data = await get_shift(db, user.org_id, shift_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    if not _is_authority(user) and data["driver_user_id"] != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="shift access denied")

    return ShiftResponse(**data)


@router.post("/shifts/{shift_id}/start", response_model=ShiftResponse)
async def start_shift_route(
    shift_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> ShiftResponse:
    """Start one shift if caller is authority or owning driver."""
    try:
        current = await get_shift(db, user.org_id, shift_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    if not _is_authority(user) and current["driver_user_id"] != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="shift start denied")

    try:
        data = await start_shift(db, user.org_id, shift_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return ShiftResponse(**data)


@router.post("/shifts/{shift_id}/complete", response_model=ShiftResponse)
async def complete_shift_route(
    shift_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> ShiftResponse:
    """Complete one shift if caller is authority or owning driver."""
    try:
        current = await get_shift(db, user.org_id, shift_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    if not _is_authority(user) and current["driver_user_id"] != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="shift completion denied")

    try:
        data = await complete_shift(db, user.org_id, shift_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return ShiftResponse(**data)


@router.post("/routes/plan", response_model=RoutePlanResponse)
async def plan_route_route(
    payload: RoutePlanRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> RoutePlanResponse:
    """Generate a deterministic route optimization preview without persisting."""
    try:
        data = await plan_route(
            db,
            user.org_id,
            route_date=payload.route_date,
            depot_id=payload.depot_id,
            driver_user_id=payload.driver_user_id,
            include_bin_ids=payload.include_bin_ids,
            max_stops=payload.max_stops,
            min_fill_pct=payload.min_fill_pct,
            overflow_only=payload.overflow_only,
            target_shift_minutes=payload.target_shift_minutes,
            avg_speed_kmph=payload.avg_speed_kmph,
            service_minutes_per_stop=payload.service_minutes_per_stop,
            use_multi_vehicle=payload.use_multi_vehicle,
            vehicle_ids=payload.vehicle_ids,
            actor_user_id=user.id,
            ip_address=request.client.host if request.client is not None else None,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RoutePlanResponse(**data)


@router.post("/routes", response_model=RouteResponse, status_code=status.HTTP_201_CREATED)
async def create_route_route(
    payload: RouteDraftCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> RouteResponse:
    """Create one draft route and persist ordered route stops."""
    try:
        data = await create_route_draft(
            db,
            user.org_id,
            user.id,
            route_code=payload.route_code,
            route_date=payload.route_date,
            depot_id=payload.depot_id,
            stop_bin_ids=payload.stop_bin_ids,
            driver_user_id=payload.driver_user_id,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="route already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteResponse(**data)


@router.get("/routes", response_model=RouteListResponse)
async def list_routes_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    route_date: date | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> RouteListResponse:
    """List organization routes for planning and operations control."""
    data = await list_routes(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        route_date=route_date,
    )
    return RouteListResponse(**data)


@router.get("/my-routes", response_model=DriverRouteListResponse)
async def list_my_routes_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    route_date: date | None = None,
    assignment_status: str | None = None,
    driver_user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> DriverRouteListResponse:
    """List routes assigned to the authenticated driver (or explicit driver for authority)."""
    scoped_driver_user_id = driver_user_id
    if not _is_authority(user):
        scoped_driver_user_id = user.id
    elif scoped_driver_user_id is None:
        scoped_driver_user_id = user.id

    data = await list_driver_routes(
        db,
        user.org_id,
        driver_user_id=scoped_driver_user_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        route_date=route_date,
        assignment_status=assignment_status,
    )
    return DriverRouteListResponse(**data)


@router.get("/routes/{route_id}", response_model=RouteResponse)
async def get_route_route(
    route_id: int,
    driver_user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> RouteResponse:
    """Get one route by id with computed start-point metadata."""
    try:
        data = await get_route(
            db,
            user.org_id,
            route_id,
            driver_user_id=driver_user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteResponse(**data)


@router.post("/routes/{route_id}/publish", response_model=RouteResponse)
async def publish_route_route(
    route_id: int,
    payload: RoutePublishRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> RouteResponse:
    """Publish one route after transition and start-point validation."""
    try:
        data = await publish_route(
            db,
            user.org_id,
            user.id,
            route_id,
            driver_user_id=payload.driver_user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteResponse(**data)


@router.post("/routes/{route_id}/start", response_model=RouteResponse)
async def start_route_route(
    route_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteResponse:
    """Start one route if caller is authority or an assigned driver."""
    try:
        data = await start_route(
            db,
            user.org_id,
            user.id,
            user.roles,
            route_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteResponse(**data)


@router.post("/routes/{route_id}/complete", response_model=RouteResponse)
async def complete_route_route(
    route_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteResponse:
    """Complete one route if caller is authority or an assigned driver."""
    try:
        data = await complete_route(
            db,
            user.org_id,
            user.id,
            user.roles,
            route_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteResponse(**data)


@router.post("/routes/{route_id}/assignments", response_model=RouteAssignmentResponse, status_code=status.HTTP_201_CREATED)
async def create_route_assignment_route(
    route_id: int,
    payload: RouteAssignmentCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> RouteAssignmentResponse:
    """Create one assignment for a published or in-progress route."""
    try:
        data = await create_route_assignment(
            db,
            user.org_id,
            user.id,
            route_id=route_id,
            driver_user_id=payload.driver_user_id,
            vehicle_id=payload.vehicle_id,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="assignment conflict") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteAssignmentResponse(**data)


@router.get("/routes/{route_id}/assignments", response_model=RouteAssignmentListResponse)
async def list_route_assignments_route(
    route_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    driver_user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteAssignmentListResponse:
    """List route assignments with driver self-scope enforcement."""
    scoped_driver_user_id = driver_user_id
    if not _is_authority(user):
        scoped_driver_user_id = user.id

    try:
        data = await list_route_assignments(
            db,
            user.org_id,
            route_id=route_id,
            limit=limit,
            offset=offset,
            driver_user_id=scoped_driver_user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteAssignmentListResponse(**data)


@router.post("/assignments/{assignment_id}/accept", response_model=RouteAssignmentResponse)
async def accept_route_assignment_route(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteAssignmentResponse:
    """Accept one assignment for authority or owning driver."""
    try:
        data = await accept_route_assignment(
            db,
            user.org_id,
            user.id,
            user.roles,
            assignment_id=assignment_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteAssignmentResponse(**data)


@router.post("/assignments/{assignment_id}/reject", response_model=RouteAssignmentResponse)
async def reject_route_assignment_route(
    assignment_id: int,
    payload: RouteAssignmentRejectRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteAssignmentResponse:
    """Reject one assignment for authority or owning driver."""
    try:
        data = await reject_route_assignment(
            db,
            user.org_id,
            user.id,
            user.roles,
            assignment_id=assignment_id,
            reject_reason=payload.reject_reason,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteAssignmentResponse(**data)


@router.get("/routes/{route_id}/stops", response_model=RouteStopListResponse)
async def list_route_stops_route(
    route_id: int,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteStopListResponse:
    """List route stops with driver access restricted to own assignments."""
    scoped_driver_user_id: int | None = None if _is_authority(user) else user.id

    try:
        data = await list_route_stops(
            db,
            user.org_id,
            route_id=route_id,
            limit=limit,
            offset=offset,
            driver_user_id=scoped_driver_user_id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteStopListResponse(**data)


@router.get("/my-stops", response_model=DriverStopListResponse)
async def list_my_stops_route(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    route_status: str | None = None,
    route_date: date | None = None,
    assignment_status: str | None = None,
    driver_user_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> DriverStopListResponse:
    """List stops across routes assigned to authenticated driver (or explicit driver for authority)."""
    scoped_driver_user_id = driver_user_id
    if not _is_authority(user):
        scoped_driver_user_id = user.id
    elif scoped_driver_user_id is None:
        scoped_driver_user_id = user.id

    data = await list_driver_stops(
        db,
        user.org_id,
        driver_user_id=scoped_driver_user_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        route_status=route_status,
        route_date=route_date,
        assignment_status=assignment_status,
    )
    return DriverStopListResponse(**data)


@router.post("/stops/{stop_id}/arrive", response_model=RouteStopResponse)
async def arrive_stop_route(
    stop_id: int,
    payload: StopArriveRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteStopResponse:
    """Mark one stop as arrived and append collection evidence event."""
    try:
        data = await arrive_stop(
            db,
            user.org_id,
            user.id,
            user.roles,
            stop_id=stop_id,
            actual_arrival=payload.actual_arrival,
            gps_latitude=payload.gps_latitude,
            gps_longitude=payload.gps_longitude,
            notes=payload.notes,
            idempotency_key=idempotency_key,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteStopResponse(**data)


@router.post("/stops/{stop_id}/service", response_model=RouteStopResponse)
async def service_stop_route(
    stop_id: int,
    payload: StopServiceRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteStopResponse:
    """Mark one stop as serviced and append collection evidence event."""
    try:
        data = await service_stop(
            db,
            user.org_id,
            user.id,
            user.roles,
            stop_id=stop_id,
            actual_departure=payload.actual_departure,
            fill_before_pct=payload.fill_before_pct,
            fill_after_pct=payload.fill_after_pct,
            gps_latitude=payload.gps_latitude,
            gps_longitude=payload.gps_longitude,
            notes=payload.notes,
            photo_url=payload.photo_url,
            idempotency_key=idempotency_key,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteStopResponse(**data)


@router.post("/stops/{stop_id}/skip", response_model=RouteStopResponse)
async def skip_stop_route(
    stop_id: int,
    payload: StopSkipRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> RouteStopResponse:
    """Mark one stop as skipped and append collection evidence event."""
    try:
        data = await skip_stop(
            db,
            user.org_id,
            user.id,
            user.roles,
            stop_id=stop_id,
            reason=payload.reason,
            actual_departure=payload.actual_departure,
            gps_latitude=payload.gps_latitude,
            gps_longitude=payload.gps_longitude,
            notes=payload.notes,
            idempotency_key=idempotency_key,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc

    return RouteStopResponse(**data)
