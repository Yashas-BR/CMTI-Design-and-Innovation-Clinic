"""User administration services."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.models.iot import Role, User, UserRole


AUTHORITY_ADMIN_ROLE = "authority_admin"
AUTHORITY_OPERATOR_ROLE = "authority_operator"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def _load_roles_for_user_ids(db: AsyncSession, user_ids: list[int]) -> dict[int, list[str]]:
    if not user_ids:
        return {}

    rows = await db.execute(
        select(UserRole.user_id, Role.key)
        .join(Role, Role.id == UserRole.role_id)
        .where(UserRole.user_id.in_(user_ids))
        .order_by(UserRole.user_id.asc(), Role.key.asc())
    )

    role_map: dict[int, list[str]] = {user_id: [] for user_id in user_ids}
    for user_id, role_key in rows.all():
        role_map[int(user_id)].append(str(role_key))
    return role_map


async def _get_user_scoped(db: AsyncSession, org_id: int, user_id: int) -> User:
    user = (
        await db.execute(select(User).where(User.org_id == org_id, User.id == user_id).limit(1))
    ).scalar_one_or_none()
    if user is None:
        raise ValueError("user not found")
    return user


async def _get_role_ids_by_keys(db: AsyncSession, role_keys: list[str]) -> dict[str, int]:
    cleaned = sorted({item.strip() for item in role_keys if item.strip()})
    if not cleaned:
        raise ValueError("role_keys must not be empty")

    rows = await db.execute(select(Role.key, Role.id).where(Role.key.in_(cleaned)))
    mapping = {str(key): int(role_id) for key, role_id in rows.all()}

    missing = [key for key in cleaned if key not in mapping]
    if missing:
        raise ValueError(f"unknown role keys: {', '.join(missing)}")
    return mapping


async def _count_org_admins(db: AsyncSession, org_id: int) -> int:
    count = (
        await db.execute(
            select(func.count(User.id))
            .select_from(User)
            .join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(
                User.org_id == org_id,
                User.is_active.is_(True),
                Role.key == AUTHORITY_ADMIN_ROLE,
            )
        )
    ).scalar_one()
    return int(count or 0)


async def _ensure_not_removing_last_admin(db: AsyncSession, org_id: int, user_id: int, remove_role_keys: set[str]) -> None:
    if AUTHORITY_ADMIN_ROLE not in remove_role_keys:
        return

    user_is_admin = (
        await db.execute(
            select(func.count(UserRole.id))
            .select_from(UserRole)
            .join(Role, Role.id == UserRole.role_id)
            .where(UserRole.user_id == user_id, Role.key == AUTHORITY_ADMIN_ROLE)
        )
    ).scalar_one()

    if int(user_is_admin or 0) == 0:
        return

    admin_count = await _count_org_admins(db, org_id)
    if admin_count <= 1:
        raise ValueError("cannot remove the last authority_admin in organization")


async def _user_to_dict(db: AsyncSession, user: User) -> dict[str, Any]:
    role_map = await _load_roles_for_user_ids(db, [user.id])
    return {
        "id": user.id,
        "org_id": user.org_id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "status": user.status,
        "is_active": bool(user.is_active),
        "role_keys": role_map.get(user.id, []),
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


async def list_users(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    q: str | None = None,
    role: str | None = None,
    status: str | None = None,
    is_active: bool | None = None,
) -> dict[str, Any]:
    """List users in caller organization with filters."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [User.org_id == org_id]
    if status:
        filters.append(User.status == status)
    if is_active is not None:
        filters.append(User.is_active.is_(is_active))
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                User.full_name.ilike(pattern),
                User.email.ilike(pattern),
                User.phone.ilike(pattern),
            )
        )

    base_total_stmt = select(func.count(func.distinct(User.id))).select_from(User)
    base_items_stmt = select(User).select_from(User)

    if role:
        base_total_stmt = (
            base_total_stmt.join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.key == role)
        )
        base_items_stmt = (
            base_items_stmt.join(UserRole, UserRole.user_id == User.id)
            .join(Role, Role.id == UserRole.role_id)
            .where(Role.key == role)
        )

    total = (await db.execute(base_total_stmt.where(*filters))).scalar_one() or 0

    users = (
        await db.execute(
            base_items_stmt.where(*filters)
            .order_by(User.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    role_map = await _load_roles_for_user_ids(db, [user.id for user in users])
    items = [
        {
            "id": user.id,
            "org_id": user.org_id,
            "full_name": user.full_name,
            "email": user.email,
            "phone": user.phone,
            "status": user.status,
            "is_active": bool(user.is_active),
            "role_keys": role_map.get(user.id, []),
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }
        for user in users
    ]

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": items,
    }


async def get_user(db: AsyncSession, org_id: int, user_id: int) -> dict[str, Any]:
    """Get one organization-scoped user."""
    user = await _get_user_scoped(db, org_id, user_id)
    return await _user_to_dict(db, user)


async def add_user_roles(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    *,
    user_id: int,
    role_keys: list[str],
) -> dict[str, Any]:
    """Explicitly add one or more roles to a user."""
    user = await _get_user_scoped(db, org_id, user_id)
    role_id_map = await _get_role_ids_by_keys(db, role_keys)

    existing_role_ids = set(
        (
            await db.execute(select(UserRole.role_id).where(UserRole.user_id == user.id))
        ).scalars().all()
    )

    now = _now_utc()
    for role_key, role_id in role_id_map.items():
        if role_id in existing_role_ids:
            continue
        db.add(
            UserRole(
                user_id=user.id,
                role_id=role_id,
                assigned_by=actor_user_id,
                assigned_at=now,
            )
        )

    await db.commit()
    await db.refresh(user)
    return await _user_to_dict(db, user)


async def remove_user_roles(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    *,
    user_id: int,
    role_keys: list[str],
) -> dict[str, Any]:
    """Explicitly remove one or more roles from a user."""
    del actor_user_id
    user = await _get_user_scoped(db, org_id, user_id)
    role_id_map = await _get_role_ids_by_keys(db, role_keys)

    remove_keys_set = set(role_id_map.keys())
    await _ensure_not_removing_last_admin(db, org_id, user.id, remove_keys_set)

    await db.execute(
        delete(UserRole).where(
            UserRole.user_id == user.id,
            UserRole.role_id.in_(list(role_id_map.values())),
        )
    )

    await db.commit()
    await db.refresh(user)
    return await _user_to_dict(db, user)


async def deactivate_user(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    *,
    user_id: int,
) -> dict[str, Any]:
    """Soft deactivate one user."""
    del actor_user_id
    user = await _get_user_scoped(db, org_id, user_id)

    user_role_keys = set((await _load_roles_for_user_ids(db, [user.id])).get(user.id, []))
    await _ensure_not_removing_last_admin(db, org_id, user.id, user_role_keys)

    user.is_active = False
    user.status = "inactive"
    user.updated_at = _now_utc()

    await db.commit()
    await db.refresh(user)
    return await _user_to_dict(db, user)


async def reset_user_password(
    db: AsyncSession,
    org_id: int,
    actor_user_id: int,
    *,
    user_id: int,
    new_password: str,
) -> dict[str, Any]:
    """Reset a user's password (forgot-password flow intentionally excluded)."""
    del actor_user_id
    user = await _get_user_scoped(db, org_id, user_id)

    user.password_hash = get_password_hash(new_password)
    user.updated_at = _now_utc()

    await db.commit()
    await db.refresh(user)
    return await _user_to_dict(db, user)
