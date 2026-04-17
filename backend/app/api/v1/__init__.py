"""API v1 routes."""

from fastapi import APIRouter

from .health import router as health_router
from .mqtt import router as mqtt_router
from .telemetry import router as telemetry_router

router = APIRouter()
router.include_router(health_router, tags=["health"])
router.include_router(mqtt_router, tags=["mqtt"])
router.include_router(telemetry_router, tags=["telemetry"])

__all__ = ["router"]
