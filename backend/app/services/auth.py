"""Authentication and user-role administration services."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, get_password_hash, verify_password, verify_token
from app.models.iot import Role, User, UserRole


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _load_role_keys(db: AsyncSession, user_id: int) -> list[str]:
    rows = await db.execute(
        select(Role.key)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
        .order_by(Role.key.asc())
    )
    return list(rows.scalars().all())


def _build_access_token(user: User, role_keys: list[str]) -> str:
    payload = {
        "sub": str(user.id),
        "user_id": user.id,
        "email": user.email,
        "org_id": user.org_id,
        "roles": role_keys,
        "token_type": "access",
    }
    return create_access_token(payload)


def _build_refresh_token(user: User, role_keys: list[str]) -> str:
    payload = {
        "sub": str(user.id),
        "user_id": user.id,
        "email": user.email,
        "org_id": user.org_id,
        "roles": role_keys,
        "token_type": "refresh",
    }
    return create_access_token(payload, expires_delta=timedelta(days=7))


async def login_user(db: AsyncSession, *, email: str, password: str) -> dict:
    """Validate credentials and issue access/refresh tokens."""
    user = (
        await db.execute(
            select(User)
            .where(User.email == email, User.is_active.is_(True), User.status == "active")
            .order_by(User.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if user is None or not user.password_hash:
        raise ValueError("invalid credentials")

    if not verify_password(password, user.password_hash):
        raise ValueError("invalid credentials")

    role_keys = await _load_role_keys(db, user.id)
    if not role_keys:
        raise ValueError("user has no assigned role")

    user.last_login_at = _now_utc()
    await db.commit()

    return {
        "access_token": _build_access_token(user, role_keys),
        "refresh_token": _build_refresh_token(user, role_keys),
        "token_type": "bearer",
        "expires_in_seconds": int(settings.access_token_expire_minutes * 60),
        "role_keys": role_keys,
        "user_id": user.id,
        "org_id": user.org_id,
    }


async def refresh_access_token(db: AsyncSession, *, refresh_token: str) -> dict:
    """Issue a new access token from a valid refresh token."""
    payload = verify_token(refresh_token)
    if payload is None:
        raise ValueError("invalid refresh token")

    if payload.get("token_type") != "refresh":
        raise ValueError("invalid refresh token type")

    user_id = payload.get("user_id")
    if not isinstance(user_id, int):
        raise ValueError("invalid refresh token payload")

    user = (
        await db.execute(
            select(User)
            .where(User.id == user_id, User.is_active.is_(True), User.status == "active")
            .limit(1)
        )
    ).scalar_one_or_none()
    if user is None:
        raise ValueError("user not found or inactive")

    role_keys = await _load_role_keys(db, user.id)
    if not role_keys:
        raise ValueError("user has no assigned role")

    return {
        "access_token": _build_access_token(user, role_keys),
        "refresh_token": _build_refresh_token(user, role_keys),
        "token_type": "bearer",
        "expires_in_seconds": int(settings.access_token_expire_minutes * 60),
        "role_keys": role_keys,
        "user_id": user.id,
        "org_id": user.org_id,
    }


async def create_driver_user(
    db: AsyncSession,
    *,
    operator_user_id: int,
    operator_org_id: int,
    full_name: str,
    email: str,
    password: str,
    phone: str | None,
) -> dict:
    """Create one driver user and assign role driver in operator org."""
    existing = (
        await db.execute(
            select(User)
            .where(User.org_id == operator_org_id, User.email == email)
            .limit(1)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise ValueError("user already exists in organization")

    driver_role_id = (
        await db.execute(select(Role.id).where(Role.key == "driver").limit(1))
    ).scalar_one_or_none()
    if driver_role_id is None:
        raise ValueError("driver role is not configured")

    user = User(
        org_id=operator_org_id,
        full_name=full_name,
        email=email,
        phone=phone,
        password_hash=get_password_hash(password),
        auth_provider=None,
        auth_subject=None,
        status="active",
        is_active=True,
        last_login_at=None,
    )
    db.add(user)
    await db.flush()

    user_role = UserRole(
        user_id=user.id,
        role_id=driver_role_id,
        assigned_by=operator_user_id,
        assigned_at=_now_utc(),
    )
    db.add(user_role)
    await db.commit()
    await db.refresh(user)

    role_keys = await _load_role_keys(db, user.id)
    return {
        "id": user.id,
        "org_id": user.org_id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "status": user.status,
        "is_active": bool(user.is_active),
        "role_keys": role_keys,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


async def get_authenticated_user_summary(
    db: AsyncSession,
    *,
    user_id: int,
    org_id: int,
) -> dict:
    """Return the current authenticated user summary for frontend session bootstrap."""
    user = (
        await db.execute(
            select(User)
            .where(User.id == user_id, User.org_id == org_id)
            .limit(1)
        )
    ).scalar_one_or_none()

    if user is None or not user.is_active:
        raise ValueError("user not found or inactive")

    role_keys = await _load_role_keys(db, user.id)
    return {
        "id": user.id,
        "org_id": user.org_id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "status": user.status,
        "is_active": bool(user.is_active),
        "role_keys": role_keys,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }
