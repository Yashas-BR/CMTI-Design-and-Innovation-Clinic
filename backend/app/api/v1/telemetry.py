"""Telemetry query routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import AuthUser, require_authority_or_driver_user
from app.db.database import get_db
from app.schemas.mqtt import (
    TelemetryHistoryResponse,
    TelemetryLatestResponse,
    TelemetryLiveSummaryResponse,
)
from app.services.telemetry import get_bin_history, get_bin_latest_state, get_live_summary

router = APIRouter(prefix="/telemetry")


@router.get("/bins/{bin_code}/latest", response_model=TelemetryLatestResponse)
async def read_bin_latest(
    bin_code: str,
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> TelemetryLatestResponse:
    """Fetch latest snapshot for one bin code."""
    try:
        data = await get_bin_latest_state(db, bin_code, org_id=user.org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return TelemetryLatestResponse(**data)


@router.get("/bins/{bin_code}/history", response_model=TelemetryHistoryResponse)
async def read_bin_history(
    bin_code: str,
    limit: int = Query(default=100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> TelemetryHistoryResponse:
    """Fetch most recent telemetry points for one bin code."""
    try:
        data = await get_bin_history(db, bin_code, limit=limit, org_id=user.org_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return TelemetryHistoryResponse(**data)


@router.get("/live/summary", response_model=TelemetryLiveSummaryResponse)
async def read_live_summary(
    db: AsyncSession = Depends(get_db),
    user: AuthUser = Depends(require_authority_or_driver_user),
) -> TelemetryLiveSummaryResponse:
    """Fetch aggregate counters for dashboard cards."""
    data = await get_live_summary(db, org_id=user.org_id)
    return TelemetryLiveSummaryResponse(**data)
