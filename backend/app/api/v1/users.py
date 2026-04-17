"""User administration routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_user
from app.db.database import get_db
from app.schemas.users import UserListResponse, UserPasswordResetRequest, UserResponse, UserRoleMutationRequest
from app.services.users import (
    add_user_roles,
    deactivate_user,
    get_user,
    list_users,
    remove_user_roles,
    reset_user_password,
)

router = APIRouter(prefix="/users")


def _status_for_value_error(exc: ValueError) -> int:
    message = str(exc).lower()
    if "not found" in message:
        return status.HTTP_404_NOT_FOUND
    if "cannot remove the last authority_admin" in message:
        return status.HTTP_409_CONFLICT
    return status.HTTP_400_BAD_REQUEST


@router.get("", response_model=UserListResponse)
async def list_users_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    q: str | None = None,
    role: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    is_active: bool | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> UserListResponse:
    """List users within caller organization."""
    data = await list_users(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        q=q,
        role=role,
        status=status_filter,
        is_active=is_active,
    )
    return UserListResponse(**data)


@router.get("/{user_id}", response_model=UserResponse)
async def get_user_route(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> UserResponse:
    """Get one user in caller organization."""
    try:
        data = await get_user(db, user.org_id, user_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return UserResponse(**data)


@router.post("/{user_id}/roles/add", response_model=UserResponse)
async def add_user_roles_route(
    user_id: int,
    payload: UserRoleMutationRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> UserResponse:
    """Explicitly add role(s) for one user."""
    try:
        data = await add_user_roles(
            db,
            user.org_id,
            user.id,
            user_id=user_id,
            role_keys=payload.role_keys,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="role assignment conflict") from exc
    return UserResponse(**data)


@router.post("/{user_id}/roles/remove", response_model=UserResponse)
async def remove_user_roles_route(
    user_id: int,
    payload: UserRoleMutationRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> UserResponse:
    """Explicitly remove role(s) for one user."""
    try:
        data = await remove_user_roles(
            db,
            user.org_id,
            user.id,
            user_id=user_id,
            role_keys=payload.role_keys,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return UserResponse(**data)


@router.post("/{user_id}/deactivate", response_model=UserResponse)
async def deactivate_user_route(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> UserResponse:
    """Soft deactivate one user in caller organization."""
    try:
        data = await deactivate_user(db, user.org_id, user.id, user_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return UserResponse(**data)


@router.post("/{user_id}/password/reset", response_model=UserResponse)
async def reset_user_password_route(
    user_id: int,
    payload: UserPasswordResetRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> UserResponse:
    """Reset user password without forgot-password workflow."""
    try:
        data = await reset_user_password(
            db,
            user.org_id,
            user.id,
            user_id=user_id,
            new_password=payload.new_password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return UserResponse(**data)
