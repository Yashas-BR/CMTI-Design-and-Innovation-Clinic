"""Bin CRUD and search routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_or_driver_user, require_authority_user
from app.db.database import get_db
from app.schemas.bin import BinCreateRequest, BinListResponse, BinResponse, BinSearchResponse, BinUpdateRequest
from app.schemas.device import AssignmentHistoryResponse
from app.services.assignments import list_bin_assignments
from app.services.bins import create_bin, deactivate_bin, get_bin, list_bins, search_bins, update_bin

router = APIRouter(prefix="/bins")


def _status_for_value_error(exc: ValueError) -> int:
    message = str(exc).lower()
    if "not found" in message:
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_400_BAD_REQUEST


@router.get("/search", response_model=BinSearchResponse)
async def search_bins_route(
    q: str = Query(min_length=1),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> BinSearchResponse:
    """Search bins by text query within caller organization."""
    try:
        data = await search_bins(
            db,
            user.org_id,
            q=q,
            limit=limit,
            offset=offset,
            status=status_filter,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return BinSearchResponse(**data)


@router.post("", response_model=BinResponse, status_code=status.HTTP_201_CREATED)
async def create_bin_route(
    payload: BinCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> BinResponse:
    """Create one bin within caller organization."""
    try:
        data = await create_bin(db, user.org_id, user.id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="bin already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return BinResponse(**data)


@router.get("", response_model=BinListResponse)
async def list_bins_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    is_active: bool | None = None,
    area_id: int | None = None,
    q: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> BinListResponse:
    """List bins in caller organization with optional filters."""
    data = await list_bins(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        is_active=is_active,
        area_id=area_id,
        q=q,
    )
    return BinListResponse(**data)


@router.get("/{bin_id}", response_model=BinResponse)
async def get_bin_route(
    bin_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> BinResponse:
    """Get one bin by id."""
    try:
        data = await get_bin(db, user.org_id, bin_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return BinResponse(**data)


@router.patch("/{bin_id}", response_model=BinResponse)
async def update_bin_route(
    bin_id: int,
    payload: BinUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> BinResponse:
    """Patch one bin by id."""
    try:
        data = await update_bin(db, user.org_id, user.id, bin_id, payload.model_dump(exclude_unset=True))
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="bin update conflict") from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return BinResponse(**data)


@router.post("/{bin_id}/deactivate", response_model=BinResponse)
async def deactivate_bin_route(
    bin_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> BinResponse:
    """Soft deactivate one bin."""
    try:
        data = await deactivate_bin(db, user.org_id, user.id, bin_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return BinResponse(**data)


@router.get("/{bin_id}/assignments", response_model=AssignmentHistoryResponse)
async def list_bin_assignments_route(
    bin_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AssignmentHistoryResponse:
    """List assignment history for one bin."""
    try:
        data = await list_bin_assignments(
            db,
            user.org_id,
            bin_id=bin_id,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AssignmentHistoryResponse(**data)
