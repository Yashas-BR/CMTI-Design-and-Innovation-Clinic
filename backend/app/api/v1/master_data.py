"""Master-data CRUD routes for depots, service areas, and driver profiles."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_user
from app.db.database import get_db
from app.schemas.master_data import (
    DeleteResponse,
    DepotCreateRequest,
    DepotListResponse,
    DepotResponse,
    DepotUpdateRequest,
    DriverProfileCreateRequest,
    DriverProfileListResponse,
    DriverProfileResponse,
    DriverProfileUpdateRequest,
    ServiceAreaCreateRequest,
    ServiceAreaListResponse,
    ServiceAreaResponse,
    ServiceAreaUpdateRequest,
)
from app.services.master_data import (
    create_depot,
    create_driver_profile,
    create_service_area,
    deactivate_depot,
    deactivate_service_area,
    delete_driver_profile,
    get_depot,
    get_driver_profile,
    get_service_area,
    list_depots,
    list_driver_profiles,
    list_service_areas,
    update_depot,
    update_driver_profile,
    update_service_area,
)

router = APIRouter(prefix="/master-data")


def _status_for_value_error(exc: ValueError) -> int:
    message = str(exc).lower()
    if "not found" in message:
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_400_BAD_REQUEST


@router.post("/depots", response_model=DepotResponse, status_code=status.HTTP_201_CREATED)
async def create_depot_route(
    payload: DepotCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DepotResponse:
    """Create one depot in caller organization."""
    try:
        data = await create_depot(db, user.org_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="depot already exists") from exc
    return DepotResponse(**data)


@router.get("/depots", response_model=DepotListResponse)
async def list_depots_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    is_active: bool | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DepotListResponse:
    """List depots for caller organization."""
    data = await list_depots(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        is_active=is_active,
        q=q,
    )
    return DepotListResponse(**data)


@router.get("/depots/{depot_id}", response_model=DepotResponse)
async def get_depot_route(
    depot_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DepotResponse:
    """Get one depot by id."""
    try:
        data = await get_depot(db, user.org_id, depot_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DepotResponse(**data)


@router.patch("/depots/{depot_id}", response_model=DepotResponse)
async def update_depot_route(
    depot_id: int,
    payload: DepotUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DepotResponse:
    """Patch one depot by id."""
    try:
        data = await update_depot(db, user.org_id, depot_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="depot update conflict") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DepotResponse(**data)


@router.post("/depots/{depot_id}/deactivate", response_model=DepotResponse)
async def deactivate_depot_route(
    depot_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DepotResponse:
    """Soft deactivate one depot."""
    try:
        data = await deactivate_depot(db, user.org_id, depot_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DepotResponse(**data)


@router.post("/service-areas", response_model=ServiceAreaResponse, status_code=status.HTTP_201_CREATED)
async def create_service_area_route(
    payload: ServiceAreaCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> ServiceAreaResponse:
    """Create one service area in caller organization."""
    try:
        data = await create_service_area(db, user.org_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="service area already exists") from exc
    return ServiceAreaResponse(**data)


@router.get("/service-areas", response_model=ServiceAreaListResponse)
async def list_service_areas_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    is_active: bool | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> ServiceAreaListResponse:
    """List service areas for caller organization."""
    data = await list_service_areas(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        is_active=is_active,
        q=q,
    )
    return ServiceAreaListResponse(**data)


@router.get("/service-areas/{area_id}", response_model=ServiceAreaResponse)
async def get_service_area_route(
    area_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> ServiceAreaResponse:
    """Get one service area by id."""
    try:
        data = await get_service_area(db, user.org_id, area_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return ServiceAreaResponse(**data)


@router.patch("/service-areas/{area_id}", response_model=ServiceAreaResponse)
async def update_service_area_route(
    area_id: int,
    payload: ServiceAreaUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> ServiceAreaResponse:
    """Patch one service area by id."""
    try:
        data = await update_service_area(db, user.org_id, area_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="service area update conflict") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return ServiceAreaResponse(**data)


@router.post("/service-areas/{area_id}/deactivate", response_model=ServiceAreaResponse)
async def deactivate_service_area_route(
    area_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> ServiceAreaResponse:
    """Soft deactivate one service area."""
    try:
        data = await deactivate_service_area(db, user.org_id, area_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return ServiceAreaResponse(**data)


@router.post("/driver-profiles", response_model=DriverProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_driver_profile_route(
    payload: DriverProfileCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DriverProfileResponse:
    """Create one driver profile for an org-scoped user."""
    try:
        data = await create_driver_profile(db, user.org_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="driver profile already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DriverProfileResponse(**data)


@router.get("/driver-profiles", response_model=DriverProfileListResponse)
async def list_driver_profiles_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user_id: int | None = None,
    employment_status: str | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DriverProfileListResponse:
    """List driver profiles for caller organization."""
    data = await list_driver_profiles(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        user_id=user_id,
        employment_status=employment_status,
        q=q,
    )
    return DriverProfileListResponse(**data)


@router.get("/driver-profiles/{profile_id}", response_model=DriverProfileResponse)
async def get_driver_profile_route(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DriverProfileResponse:
    """Get one driver profile by id."""
    try:
        data = await get_driver_profile(db, user.org_id, profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DriverProfileResponse(**data)


@router.patch("/driver-profiles/{profile_id}", response_model=DriverProfileResponse)
async def update_driver_profile_route(
    profile_id: int,
    payload: DriverProfileUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DriverProfileResponse:
    """Patch one driver profile by id."""
    try:
        data = await update_driver_profile(
            db,
            user.org_id,
            profile_id,
            payload.model_dump(exclude_unset=True),
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="driver profile update conflict") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DriverProfileResponse(**data)


@router.delete("/driver-profiles/{profile_id}", response_model=DeleteResponse)
async def delete_driver_profile_route(
    profile_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DeleteResponse:
    """Delete one driver profile by id."""
    try:
        data = await delete_driver_profile(db, user.org_id, profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DeleteResponse(**data)
