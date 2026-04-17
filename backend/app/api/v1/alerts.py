"""Alert management routes."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_or_driver_user
from app.db.database import get_db
from app.schemas.alerts import (
    AlertActionRequest,
    AlertAssignRequest,
    AlertEventListResponse,
    AlertListResponse,
    AlertResponse,
)
from app.services.alerts import acknowledge_alert, assign_alert, get_alert, list_alert_events, list_alerts, resolve_alert

router = APIRouter(prefix="/alerts")


def _status_for_value_error(exc: ValueError) -> int:
    message = str(exc).lower()
    if "not found" in message:
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_400_BAD_REQUEST


@router.get("", response_model=AlertListResponse)
async def list_alerts_route(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: str | None = Query(default=None, alias="status"),
    severity: str | None = None,
    alert_type: str | None = None,
    bin_id: int | None = None,
    assigned_to_user_id: int | None = None,
    opened_from: datetime | None = None,
    opened_to: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AlertListResponse:
    """List organization-scoped alerts with filters."""
    data = await list_alerts(
        db,
        user.org_id,
        limit=limit,
        offset=offset,
        status=status_filter,
        severity=severity,
        alert_type=alert_type,
        bin_id=bin_id,
        assigned_to_user_id=assigned_to_user_id,
        opened_from=opened_from,
        opened_to=opened_to,
    )
    return AlertListResponse(**data)


@router.get("/{alert_id}", response_model=AlertResponse)
async def get_alert_route(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AlertResponse:
    """Get one alert by id."""
    try:
        data = await get_alert(db, user.org_id, alert_id)
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AlertResponse(**data)


@router.post("/{alert_id}/acknowledge", response_model=AlertResponse)
async def acknowledge_alert_route(
    alert_id: int,
    payload: AlertActionRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AlertResponse:
    """Acknowledge one alert."""
    try:
        data = await acknowledge_alert(
            db,
            user.org_id,
            user.id,
            user.roles,
            alert_id=alert_id,
            note=payload.note,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AlertResponse(**data)


@router.post("/{alert_id}/resolve", response_model=AlertResponse)
async def resolve_alert_route(
    alert_id: int,
    payload: AlertActionRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AlertResponse:
    """Resolve one alert."""
    try:
        data = await resolve_alert(
            db,
            user.org_id,
            user.id,
            user.roles,
            alert_id=alert_id,
            note=payload.note,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AlertResponse(**data)


@router.post("/{alert_id}/assign", response_model=AlertResponse)
async def assign_alert_route(
    alert_id: int,
    payload: AlertAssignRequest,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AlertResponse:
    """Assign or unassign one alert."""
    try:
        data = await assign_alert(
            db,
            user.org_id,
            user.id,
            user.roles,
            alert_id=alert_id,
            assigned_to_user_id=payload.assigned_to_user_id,
            note=payload.note,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AlertResponse(**data)


@router.get("/{alert_id}/events", response_model=AlertEventListResponse)
async def list_alert_events_route(
    alert_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> AlertEventListResponse:
    """List event history for one alert."""
    try:
        data = await list_alert_events(
            db,
            user.org_id,
            alert_id=alert_id,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=_status_for_value_error(exc), detail=str(exc)) from exc
    return AlertEventListResponse(**data)
