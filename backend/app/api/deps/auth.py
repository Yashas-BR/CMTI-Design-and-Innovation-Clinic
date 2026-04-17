"""Authentication and role-based access dependencies."""

from dataclasses import dataclass
from secrets import compare_digest

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import verify_token
from app.db.database import get_db
from app.models.iot import Role, User, UserRole


bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(slots=True)
class AuthUser:
    """Resolved user plus role keys from DB."""

    id: int
    org_id: int
    email: str
    roles: set[str]


def _parse_user_id(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


async def _load_roles(db: AsyncSession, user_id: int) -> set[str]:
    rows = await db.execute(
        select(Role.key)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == user_id)
    )
    return set(rows.scalars().all())


async def resolve_auth_user_from_token(db: AsyncSession, token: str) -> AuthUser:
    """Resolve authenticated user from JWT token value."""
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    subject = payload.get("sub")
    user_id = _parse_user_id(payload.get("user_id")) or _parse_user_id(subject)
    email = payload.get("email")

    user: User | None = None
    if user_id is not None:
        user = (await db.execute(select(User).where(User.id == user_id).limit(1))).scalar_one_or_none()

    if user is None and isinstance(email, str):
        user = (await db.execute(select(User).where(User.email == email).limit(1))).scalar_one_or_none()

    if user is None and isinstance(subject, str) and not subject.isdigit():
        user = (
            await db.execute(select(User).where(User.auth_subject == subject).limit(1))
        ).scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    roles = await _load_roles(db, user.id)
    return AuthUser(id=user.id, org_id=user.org_id, email=user.email, roles=roles)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    """Resolve currently authenticated user from JWT and DB."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    return await resolve_auth_user_from_token(db, credentials.credentials)


async def require_authority_user(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    """Allow only authority roles."""
    if user.roles.intersection({"authority_admin", "authority_operator"}):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authority role required")


async def require_authority_or_driver_user(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    """Allow authority and driver roles."""
    if user.roles.intersection({"authority_admin", "authority_operator", "driver"}):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Driver or authority role required")


async def require_mqtt_ingest_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    """Reject MQTT ingest requests without a valid shared API key."""
    expected_key = settings.mqtt_ingest_api_key.strip()
    if not expected_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="MQTT ingest key is not configured")

    if x_api_key is None or not compare_digest(x_api_key, expected_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing MQTT ingest API key")
