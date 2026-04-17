"""Shared helpers for operations domain workflows."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.iot import Bin, Depot, DriverProfile, Route, RouteStop, ServiceArea, User


SHIFT_TRANSITIONS: dict[str, set[str]] = {
    "scheduled": {"started", "cancelled"},
    "started": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}

ROUTE_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"published", "cancelled"},
    "published": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}

ASSIGNMENT_TRANSITIONS: dict[str, set[str]] = {
    "assigned": {"accepted", "rejected"},
    "accepted": set(),
    "rejected": {"assigned"},
}

STOP_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"arrived", "skipped"},
    "arrived": {"serviced", "skipped"},
    "serviced": set(),
    "skipped": set(),
}


@dataclass(slots=True)
class StartPointResolution:
    """Resolved route start point details."""

    source: str
    depot_id: int | None
    area_id: int | None
    latitude: float | None
    longitude: float | None


def _to_float(value: Decimal | float | None) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def validate_transition(*, current_status: str, next_status: str, transitions: dict[str, set[str]]) -> None:
    """Validate status transition against a finite transition map."""
    allowed = transitions.get(current_status)
    if allowed is None:
        raise ValueError(f"unknown current status: {current_status}")
    if next_status not in allowed:
        raise ValueError(f"invalid transition: {current_status} -> {next_status}")


async def ensure_user_belongs_to_org(db: AsyncSession, *, org_id: int, user_id: int) -> User:
    """Return one active user in org or raise validation error."""
    user = (
        await db.execute(
            select(User)
            .where(User.id == user_id, User.org_id == org_id, User.is_active.is_(True))
            .limit(1)
        )
    ).scalar_one_or_none()
    if user is None:
        raise ValueError("user not found or inactive")
    return user


async def resolve_start_point_for_planning(
    db: AsyncSession,
    *,
    org_id: int,
    route_depot_id: int | None = None,
    driver_user_id: int | None = None,
    bin_ids: list[int] | None = None,
) -> StartPointResolution:
    """Resolve route start point from planning context before route is persisted."""
    if route_depot_id is not None:
        depot = (
            await db.execute(
                select(Depot)
                .where(Depot.id == route_depot_id, Depot.org_id == org_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if depot is not None:
            return StartPointResolution(
                source="route_depot",
                depot_id=depot.id,
                area_id=None,
                latitude=_to_float(depot.latitude),
                longitude=_to_float(depot.longitude),
            )

    if driver_user_id is not None:
        profile = (
            await db.execute(
                select(DriverProfile)
                .join(User, User.id == DriverProfile.user_id)
                .where(User.org_id == org_id, DriverProfile.user_id == driver_user_id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if profile is not None and profile.home_depot_id is not None:
            depot = (
                await db.execute(
                    select(Depot)
                    .where(Depot.id == profile.home_depot_id, Depot.org_id == org_id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if depot is not None:
                return StartPointResolution(
                    source="driver_home_depot",
                    depot_id=depot.id,
                    area_id=None,
                    latitude=_to_float(depot.latitude),
                    longitude=_to_float(depot.longitude),
                )

    if bin_ids:
        dominant_depot_id = (
            await db.execute(
                select(Bin.depot_id)
                .where(Bin.org_id == org_id, Bin.id.in_(bin_ids), Bin.depot_id.is_not(None))
                .group_by(Bin.depot_id)
                .order_by(func.count(Bin.id).desc(), Bin.depot_id.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if dominant_depot_id is not None:
            depot = (
                await db.execute(
                    select(Depot)
                    .where(Depot.id == dominant_depot_id, Depot.org_id == org_id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if depot is not None:
                return StartPointResolution(
                    source="dominant_bin_depot",
                    depot_id=depot.id,
                    area_id=None,
                    latitude=_to_float(depot.latitude),
                    longitude=_to_float(depot.longitude),
                )

        dominant_area_id = (
            await db.execute(
                select(Bin.area_id)
                .where(Bin.org_id == org_id, Bin.id.in_(bin_ids), Bin.area_id.is_not(None))
                .group_by(Bin.area_id)
                .order_by(func.count(Bin.id).desc(), Bin.area_id.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if dominant_area_id is not None:
            area = (
                await db.execute(
                    select(ServiceArea)
                    .where(ServiceArea.id == dominant_area_id, ServiceArea.org_id == org_id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if area is not None:
                return StartPointResolution(
                    source="service_area_center",
                    depot_id=None,
                    area_id=area.id,
                    latitude=_to_float(area.center_latitude),
                    longitude=_to_float(area.center_longitude),
                )

    raise ValueError("unable to resolve route start point")


async def resolve_route_start_point(
    db: AsyncSession,
    *,
    org_id: int,
    route_id: int,
    driver_user_id: int | None = None,
) -> StartPointResolution:
    """Resolve route start point from route, driver profile, bin depot majority, then area center."""
    route = (
        await db.execute(select(Route).where(Route.id == route_id, Route.org_id == org_id).limit(1))
    ).scalar_one_or_none()
    if route is None:
        raise ValueError("route not found")

    route_bin_ids = (
        await db.execute(
            select(RouteStop.bin_id)
            .where(RouteStop.route_id == route.id)
            .order_by(RouteStop.stop_sequence.asc())
        )
    ).scalars().all()

    return await resolve_start_point_for_planning(
        db,
        org_id=org_id,
        route_depot_id=route.depot_id,
        driver_user_id=driver_user_id,
        bin_ids=[int(bin_id) for bin_id in route_bin_ids],
    )


def start_point_to_dict(point: StartPointResolution) -> dict[str, Any]:
    """Convert start point dataclass into API-safe payload."""
    return {
        "source": point.source,
        "depot_id": point.depot_id,
        "area_id": point.area_id,
        "latitude": point.latitude,
        "longitude": point.longitude,
    }
