"""CRUD services for depots, service areas, and driver profiles."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Depot, DriverProfile, ServiceArea, User


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _depot_to_dict(row: Depot) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "org_id": int(row.org_id),
        "name": row.name,
        "address": row.address,
        "contact_phone": row.contact_phone,
        "latitude": _to_float(row.latitude),
        "longitude": _to_float(row.longitude),
        "is_active": bool(row.is_active),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _service_area_to_dict(row: ServiceArea) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "org_id": int(row.org_id),
        "name": row.name,
        "center_latitude": _to_float(row.center_latitude),
        "center_longitude": _to_float(row.center_longitude),
        "boundary_geojson": row.boundary_geojson,
        "priority_weight": _to_float(row.priority_weight) or 0.0,
        "is_active": bool(row.is_active),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _driver_profile_to_dict(row: DriverProfile, *, org_id: int) -> dict[str, Any]:
    return {
        "id": int(row.id),
        "org_id": int(org_id),
        "user_id": int(row.user_id),
        "license_no": row.license_no,
        "license_expiry": row.license_expiry,
        "home_depot_id": row.home_depot_id,
        "employment_status": row.employment_status,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def _get_depot_scoped(db: AsyncSession, org_id: int, depot_id: int) -> Depot:
    row = (
        await db.execute(select(Depot).where(Depot.id == depot_id, Depot.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if row is None:
        raise ValueError("depot not found")
    return row


async def _get_service_area_scoped(db: AsyncSession, org_id: int, area_id: int) -> ServiceArea:
    row = (
        await db.execute(
            select(ServiceArea).where(ServiceArea.id == area_id, ServiceArea.org_id == org_id).limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        raise ValueError("service area not found")
    return row


async def _get_user_scoped(db: AsyncSession, org_id: int, user_id: int) -> User:
    row = (
        await db.execute(select(User).where(User.id == user_id, User.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if row is None:
        raise ValueError("user not found")
    return row


async def _get_driver_profile_scoped(
    db: AsyncSession,
    org_id: int,
    profile_id: int,
) -> tuple[DriverProfile, User]:
    row = (
        await db.execute(
            select(DriverProfile, User)
            .join(User, User.id == DriverProfile.user_id)
            .where(DriverProfile.id == profile_id, User.org_id == org_id)
            .limit(1)
        )
    ).first()
    if row is None:
        raise ValueError("driver profile not found")
    return row


async def create_depot(db: AsyncSession, org_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Create one depot in caller organization scope."""
    row = Depot(
        org_id=org_id,
        name=payload["name"],
        address=payload.get("address"),
        contact_phone=payload.get("contact_phone"),
        latitude=payload.get("latitude"),
        longitude=payload.get("longitude"),
        is_active=payload.get("is_active", True),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _depot_to_dict(row)


async def list_depots(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    is_active: bool | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """List depots with pagination and filters."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [Depot.org_id == org_id]
    if is_active is not None:
        filters.append(Depot.is_active.is_(is_active))
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(
            or_(
                Depot.name.ilike(pattern),
                Depot.address.ilike(pattern),
                Depot.contact_phone.ilike(pattern),
            )
        )

    total = (await db.execute(select(func.count(Depot.id)).where(*filters))).scalar_one() or 0
    rows = (
        await db.execute(
            select(Depot)
            .where(*filters)
            .order_by(Depot.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_depot_to_dict(row) for row in rows],
    }


async def get_depot(db: AsyncSession, org_id: int, depot_id: int) -> dict[str, Any]:
    """Get one scoped depot."""
    row = await _get_depot_scoped(db, org_id, depot_id)
    return _depot_to_dict(row)


_DEPOT_UPDATE_FIELDS = {
    "name",
    "address",
    "contact_phone",
    "latitude",
    "longitude",
    "is_active",
}


async def update_depot(
    db: AsyncSession,
    org_id: int,
    depot_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Patch one scoped depot with an explicit allowlist."""
    unexpected = sorted(set(payload) - _DEPOT_UPDATE_FIELDS)
    if unexpected:
        raise ValueError(f"unexpected update fields: {', '.join(unexpected)}")

    row = await _get_depot_scoped(db, org_id, depot_id)
    for key in _DEPOT_UPDATE_FIELDS:
        if key in payload:
            setattr(row, key, payload[key])

    await db.commit()
    await db.refresh(row)
    return _depot_to_dict(row)


async def deactivate_depot(db: AsyncSession, org_id: int, depot_id: int) -> dict[str, Any]:
    """Soft deactivate one scoped depot."""
    row = await _get_depot_scoped(db, org_id, depot_id)
    row.is_active = False
    await db.commit()
    await db.refresh(row)
    return _depot_to_dict(row)


async def create_service_area(db: AsyncSession, org_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Create one service area in caller organization scope."""
    row = ServiceArea(
        org_id=org_id,
        name=payload["name"],
        center_latitude=payload.get("center_latitude"),
        center_longitude=payload.get("center_longitude"),
        boundary_geojson=payload.get("boundary_geojson"),
        priority_weight=payload.get("priority_weight", 1.0),
        is_active=payload.get("is_active", True),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _service_area_to_dict(row)


async def list_service_areas(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    is_active: bool | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """List service areas with pagination and filters."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [ServiceArea.org_id == org_id]
    if is_active is not None:
        filters.append(ServiceArea.is_active.is_(is_active))
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(ServiceArea.name.ilike(pattern))

    total = (await db.execute(select(func.count(ServiceArea.id)).where(*filters))).scalar_one() or 0
    rows = (
        await db.execute(
            select(ServiceArea)
            .where(*filters)
            .order_by(ServiceArea.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).scalars().all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_service_area_to_dict(row) for row in rows],
    }


async def get_service_area(db: AsyncSession, org_id: int, area_id: int) -> dict[str, Any]:
    """Get one scoped service area."""
    row = await _get_service_area_scoped(db, org_id, area_id)
    return _service_area_to_dict(row)


_SERVICE_AREA_UPDATE_FIELDS = {
    "name",
    "center_latitude",
    "center_longitude",
    "boundary_geojson",
    "priority_weight",
    "is_active",
}


async def update_service_area(
    db: AsyncSession,
    org_id: int,
    area_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Patch one scoped service area with an explicit allowlist."""
    unexpected = sorted(set(payload) - _SERVICE_AREA_UPDATE_FIELDS)
    if unexpected:
        raise ValueError(f"unexpected update fields: {', '.join(unexpected)}")

    row = await _get_service_area_scoped(db, org_id, area_id)
    for key in _SERVICE_AREA_UPDATE_FIELDS:
        if key in payload:
            setattr(row, key, payload[key])

    await db.commit()
    await db.refresh(row)
    return _service_area_to_dict(row)


async def deactivate_service_area(db: AsyncSession, org_id: int, area_id: int) -> dict[str, Any]:
    """Soft deactivate one scoped service area."""
    row = await _get_service_area_scoped(db, org_id, area_id)
    row.is_active = False
    await db.commit()
    await db.refresh(row)
    return _service_area_to_dict(row)


async def create_driver_profile(db: AsyncSession, org_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Create one driver profile scoped to a user in caller organization."""
    user = await _get_user_scoped(db, org_id, int(payload["user_id"]))

    existing = (
        await db.execute(select(DriverProfile).where(DriverProfile.user_id == user.id).limit(1))
    ).scalar_one_or_none()
    if existing is not None:
        raise ValueError("driver profile already exists for this user")

    row = DriverProfile(
        user_id=user.id,
        license_no=payload.get("license_no"),
        license_expiry=payload.get("license_expiry"),
        home_depot_id=payload.get("home_depot_id"),
        employment_status=payload["employment_status"],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _driver_profile_to_dict(row, org_id=user.org_id)


async def list_driver_profiles(
    db: AsyncSession,
    org_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    user_id: int | None = None,
    employment_status: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """List driver profiles in caller organization."""
    safe_limit = min(max(limit, 1), 100)
    safe_offset = max(offset, 0)

    filters = [User.org_id == org_id]
    if user_id is not None:
        filters.append(DriverProfile.user_id == user_id)
    if employment_status:
        filters.append(DriverProfile.employment_status == employment_status)
    if q:
        pattern = f"%{q.strip()}%"
        filters.append(DriverProfile.license_no.ilike(pattern))

    total = (
        await db.execute(
            select(func.count(DriverProfile.id))
            .join(User, User.id == DriverProfile.user_id)
            .where(*filters)
        )
    ).scalar_one() or 0

    rows = (
        await db.execute(
            select(DriverProfile, User)
            .join(User, User.id == DriverProfile.user_id)
            .where(*filters)
            .order_by(DriverProfile.id.desc())
            .limit(safe_limit)
            .offset(safe_offset)
        )
    ).all()

    return {
        "total": int(total),
        "limit": safe_limit,
        "offset": safe_offset,
        "items": [_driver_profile_to_dict(profile, org_id=user.org_id) for profile, user in rows],
    }


async def get_driver_profile(db: AsyncSession, org_id: int, profile_id: int) -> dict[str, Any]:
    """Get one scoped driver profile."""
    profile, user = await _get_driver_profile_scoped(db, org_id, profile_id)
    return _driver_profile_to_dict(profile, org_id=user.org_id)


_DRIVER_PROFILE_UPDATE_FIELDS = {
    "license_no",
    "license_expiry",
    "home_depot_id",
    "employment_status",
}


async def update_driver_profile(
    db: AsyncSession,
    org_id: int,
    profile_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Patch one scoped driver profile with an explicit allowlist."""
    unexpected = sorted(set(payload) - _DRIVER_PROFILE_UPDATE_FIELDS)
    if unexpected:
        raise ValueError(f"unexpected update fields: {', '.join(unexpected)}")

    profile, user = await _get_driver_profile_scoped(db, org_id, profile_id)
    for key in _DRIVER_PROFILE_UPDATE_FIELDS:
        if key in payload:
            setattr(profile, key, payload[key])

    await db.commit()
    await db.refresh(profile)
    return _driver_profile_to_dict(profile, org_id=user.org_id)


async def delete_driver_profile(db: AsyncSession, org_id: int, profile_id: int) -> dict[str, Any]:
    """Delete one scoped driver profile."""
    profile, _ = await _get_driver_profile_scoped(db, org_id, profile_id)
    deleted_id = int(profile.id)
    await db.delete(profile)
    await db.commit()
    return {"id": deleted_id, "deleted": True}
