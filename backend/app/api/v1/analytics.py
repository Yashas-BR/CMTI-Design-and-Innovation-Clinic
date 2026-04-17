"""Analytics reporting routes for efficiency, savings, and environmental impact."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_user
from app.db.database import get_db
from app.schemas.analytics import (
    EfficiencyAnalyticsResponse,
    EnvironmentalAnalyticsResponse,
    SavingsAnalyticsResponse,
)
from app.services.analytics import (
    get_efficiency_analytics,
    get_environmental_analytics,
    get_savings_analytics,
)

router = APIRouter(prefix="/analytics")


@router.get("/efficiency", response_model=EfficiencyAnalyticsResponse)
async def read_efficiency_analytics(
    from_ts: datetime = Query(alias="from"),
    to_ts: datetime = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> EfficiencyAnalyticsResponse:
    """Return collections/hour and distance/collection metrics for reporting."""
    try:
        data = await get_efficiency_analytics(
            db,
            user.org_id,
            from_ts=from_ts,
            to_ts=to_ts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return EfficiencyAnalyticsResponse(**data)


@router.get("/savings", response_model=SavingsAnalyticsResponse)
async def read_savings_analytics(
    from_ts: datetime = Query(alias="from"),
    to_ts: datetime = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> SavingsAnalyticsResponse:
    """Return estimated distance and fuel savings vs naive routing."""
    try:
        data = await get_savings_analytics(
            db,
            user.org_id,
            from_ts=from_ts,
            to_ts=to_ts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return SavingsAnalyticsResponse(**data)


@router.get("/environmental", response_model=EnvironmentalAnalyticsResponse)
async def read_environmental_analytics(
    from_ts: datetime = Query(alias="from"),
    to_ts: datetime = Query(alias="to"),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_user),
) -> EnvironmentalAnalyticsResponse:
    """Return estimated CO2 reduction from route optimization."""
    try:
        data = await get_environmental_analytics(
            db,
            user.org_id,
            from_ts=from_ts,
            to_ts=to_ts,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return EnvironmentalAnalyticsResponse(**data)
