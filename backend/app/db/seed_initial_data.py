"""Seed minimal required startup data for authentication flows."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.db.database import SessionLocal, engine
from app.models.iot import Organization, Role, User, UserRole


ORG_CODE = "CMTI"
ORG_NAME = "CMTI Demo Organization"
ORG_TIMEZONE = "Asia/Kolkata"


@dataclass(frozen=True)
class SeedUser:
    """Simple user seed definition."""

    full_name: str
    email: str
    password: str
    role_key: str
    phone: str | None = None


ROLE_DEFINITIONS: tuple[tuple[str, str, str], ...] = (
    ("authority_admin", "Authority Admin", "Full admin role for authority users"),
    ("authority_operator", "Authority Operator", "Operator role for authority users"),
    ("driver", "Driver", "Field driver role"),
)

USER_DEFINITIONS: tuple[SeedUser, ...] = (
    SeedUser(
        full_name="Authority Admin",
        email="admin@cmti.local",
        password="Admin@123",
        role_key="authority_admin",
    ),
    SeedUser(
        full_name="Authority Operator",
        email="operator@cmti.local",
        password="Operator@123",
        role_key="authority_operator",
    ),
    SeedUser(
        full_name="Field Driver",
        email="driver@cmti.local",
        password="Driver@123",
        role_key="driver",
    ),
)


async def _ensure_organization(session: AsyncSession) -> Organization:
    org = (
        await session.execute(
            select(Organization)
            .where(Organization.code == ORG_CODE)
            .limit(1)
        )
    ).scalar_one_or_none()

    if org is None:
        org = Organization(
            name=ORG_NAME,
            code=ORG_CODE,
            timezone=ORG_TIMEZONE,
            is_active=True,
        )
        session.add(org)
        await session.flush()
        print(f"[seed] created organization: {ORG_CODE}")
    else:
        print(f"[seed] organization exists: {ORG_CODE}")

    return org


async def _ensure_roles(session: AsyncSession) -> dict[str, Role]:
    role_map: dict[str, Role] = {}

    for role_key, role_name, role_description in ROLE_DEFINITIONS:
        role = (
            await session.execute(
                select(Role)
                .where(Role.key == role_key)
                .limit(1)
            )
        ).scalar_one_or_none()

        if role is None:
            role = Role(
                key=role_key,
                name=role_name,
                description=role_description,
                is_system=True,
            )
            session.add(role)
            await session.flush()
            print(f"[seed] created role: {role_key}")
        else:
            print(f"[seed] role exists: {role_key}")

        role_map[role_key] = role

    return role_map


async def _ensure_user(session: AsyncSession, *, org: Organization, seed_user: SeedUser) -> User:
    user = (
        await session.execute(
            select(User)
            .where(User.org_id == org.id, User.email == seed_user.email)
            .limit(1)
        )
    ).scalar_one_or_none()

    password_hash = get_password_hash(seed_user.password)

    if user is None:
        user = User(
            org_id=org.id,
            full_name=seed_user.full_name,
            email=seed_user.email,
            phone=seed_user.phone,
            password_hash=password_hash,
            auth_provider=None,
            auth_subject=None,
            status="active",
            is_active=True,
            last_login_at=None,
        )
        session.add(user)
        await session.flush()
        print(f"[seed] created user: {seed_user.email}")
    else:
        # Keep seeded users active and with known credentials for initial setup.
        user.full_name = seed_user.full_name
        user.phone = seed_user.phone
        user.password_hash = password_hash
        user.status = "active"
        user.is_active = True
        await session.flush()
        print(f"[seed] updated user: {seed_user.email}")

    return user


async def _ensure_user_role(
    session: AsyncSession,
    *,
    user: User,
    role: Role,
    assigned_by: int | None,
) -> None:
    existing = (
        await session.execute(
            select(UserRole)
            .where(UserRole.user_id == user.id, UserRole.role_id == role.id)
            .limit(1)
        )
    ).scalar_one_or_none()

    if existing is None:
        session.add(
            UserRole(
                user_id=user.id,
                role_id=role.id,
                assigned_by=assigned_by,
            )
        )
        await session.flush()
        print(f"[seed] assigned role {role.key} to {user.email}")
    else:
        print(f"[seed] role already assigned ({role.key}) to {user.email}")


async def seed_initial_required_data() -> None:
    """Insert minimum required auth data in an idempotent way."""
    try:
        async with SessionLocal() as session:
            org = await _ensure_organization(session)
            roles = await _ensure_roles(session)

            created_users: dict[str, User] = {}
            for seed_user in USER_DEFINITIONS:
                created_users[seed_user.role_key] = await _ensure_user(
                    session,
                    org=org,
                    seed_user=seed_user,
                )

            admin_user = created_users["authority_admin"]

            for seed_user in USER_DEFINITIONS:
                user = created_users[seed_user.role_key]
                role = roles[seed_user.role_key]
                assigned_by = admin_user.id if user.id != admin_user.id else None
                await _ensure_user_role(
                    session,
                    user=user,
                    role=role,
                    assigned_by=assigned_by,
                )

            await session.commit()

        print("[seed] initial required data completed")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed_initial_required_data())
