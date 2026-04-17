"""Device CRUD, assignment, and assignment history routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_or_driver_user, require_authority_user
from app.db.database import get_db
from app.schemas.device import (
    AssignmentCreateRequest,
    AssignmentHistoryItem,
    AssignmentHistoryResponse,
    DeviceCreateRequest,
    DeviceListResponse,
    DeviceResponse,
    DeviceUpdateRequest,
)
from app.services.assignments import assign_device_to_bin, list_device_assignments
from app.services.devices import create_device, deactivate_device, get_device, list_devices, search_devices, update_device

router = APIRouter(prefix="/devices")


def _status_for_value_error(exc: ValueError) -> int:
    message = str(exc).lower()
    if "not found" in message:
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_400_BAD_REQUEST


@router.get("/search", response_model=DeviceListResponse)
async def search_devices_route(
    q: str = Query(min_length=1),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> DeviceListResponse:
    """Search devices by uid/client id within caller organization."""
    try:
        data = await search_devices(
            db,
            user.org_id,
            q=q,
            limit=limit,
            offset=offset,
            status=status_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DeviceListResponse(**data)


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def create_device_route(
    payload: DeviceCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DeviceResponse:
    """Create one device for a bin in caller organization."""
    try:
        data = await create_device(db, user.org_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="device already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DeviceResponse(**data)


@router.get("", response_model=DeviceListResponse)
async def list_devices_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    bin_id: int | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> DeviceListResponse:
    """List devices in caller organization with optional filters."""
    data = await list_devices(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        bin_id=bin_id,
        q=q,
    )
    return DeviceListResponse(**data)


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device_route(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> DeviceResponse:
    """Get one device by id."""
    try:
        data = await get_device(db, user.org_id, device_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DeviceResponse(**data)


@router.patch("/{device_id}", response_model=DeviceResponse)
async def update_device_route(
    device_id: int,
    payload: DeviceUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DeviceResponse:
    """Patch one device by id."""
    try:
        data = await update_device(db, user.org_id, device_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="device update conflict") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DeviceResponse(**data)


@router.post("/{device_id}/deactivate", response_model=DeviceResponse)
async def deactivate_device_route(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> DeviceResponse:
    """Soft deactivate one device."""
    try:
        data = await deactivate_device(db, user.org_id, device_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return DeviceResponse(**data)


@router.post("/{device_id}/assign", response_model=AssignmentHistoryItem)
async def assign_device_route(
    device_id: int,
    payload: AssignmentCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> AssignmentHistoryItem:
    """Assign or reassign one device to a bin and write history."""
    try:
        data = await assign_device_to_bin(
            db,
            user.org_id,
            device_id=device_id,
            bin_id=payload.bin_id,
            notes=payload.notes,
            active_from=payload.active_from,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AssignmentHistoryItem(**data)


@router.get("/{device_id}/assignments", response_model=AssignmentHistoryResponse)
async def list_device_assignments_route(
    device_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AssignmentHistoryResponse:
    """List assignment history for one device."""
    try:
        data = await list_device_assignments(
            db,
            user.org_id,
            device_id=device_id,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AssignmentHistoryResponse(**data)


