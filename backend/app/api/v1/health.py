"""Health check endpoints."""

from fastapi import APIRouter

from app import __version__
from app.schemas.health import HealthResponse

router = APIRouter(prefix="/health")


@router.get("", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check endpoint.

    Returns:
        HealthResponse: Status of the API
    """
    return HealthResponse(
        status="healthy",
        message="API is running",
        version=__version__,
    )


@router.get("/live", response_model=dict)
async def liveness() -> dict:
    """
    Liveness probe endpoint.

    Returns:
        dict: Status indicator
    """
    return {"status": "alive"}


@router.get("/ready", response_model=dict)
async def readiness() -> dict:
    """
    Readiness probe endpoint.

    Returns:
        dict: Status indicator
    """
    return {"status": "ready"}
