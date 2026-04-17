"""Authentication and user-role administration routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, get_current_user, require_authority_user
from app.db.database import get_db
from app.schemas.auth import (
    CreateDriverRequest,
    LoginRequest,
    LoginResponse,
    TokenRefreshRequest,
    UserSummaryResponse,
)
from app.services.auth import (
    create_driver_user,
    get_authenticated_user_summary,
    login_user,
    refresh_access_token,
)

router = APIRouter(prefix="/auth")


def _raise_for_value_error(exc: ValueError) -> HTTPException:
    message = str(exc).lower()
    if "invalid credentials" in message or "invalid refresh token" in message:
        return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))
    if "not found" in message:
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/login", response_model=LoginResponse)
async def login_route(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    """Login for driver, authority_operator, and authority_admin users."""
    try:
        data = await login_user(db, email=payload.email, password=payload.password)
    except ValueError as exc:
        raise _raise_for_value_error(exc) from exc
    return LoginResponse(**data)


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token_route(
    payload: TokenRefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> LoginResponse:
    """Issue a new access token using a refresh token."""
    try:
        data = await refresh_access_token(db, refresh_token=payload.refresh_token)
    except ValueError as exc:
        raise _raise_for_value_error(exc) from exc
    return LoginResponse(**data)


@router.get("/me", response_model=UserSummaryResponse)
async def me_route(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
) -> UserSummaryResponse:
    """Return profile + role summary for current authenticated user."""
    try:
        data = await get_authenticated_user_summary(db, user_id=user.id, org_id=user.org_id)
    except ValueError as exc:
        raise _raise_for_value_error(exc) from exc
    return UserSummaryResponse(**data)


@router.post("/drivers", response_model=UserSummaryResponse, status_code=status.HTTP_201_CREATED)
async def create_driver_route(
    payload: CreateDriverRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> UserSummaryResponse:
    """Create one driver account in caller organization (operator/admin)."""
    try:
        data = await create_driver_user(
            db,
            operator_user_id=user.id,
            operator_org_id=user.org_id,
            full_name=payload.full_name,
            email=payload.email,
            password=payload.password,
            phone=payload.phone,
        )
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="driver already exists") from exc
    except ValueError as exc:
        raise _raise_for_value_error(exc) from exc
    return UserSummaryResponse(**data)
