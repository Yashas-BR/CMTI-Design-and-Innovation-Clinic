"""API v1 routes."""

from fastapi import APIRouter

from .alerts import router as alerts_router
from .auth import router as auth_router
from .bins import router as bins_router
from .devices import router as devices_router
from .health import router as health_router
from .mqtt import router as mqtt_router
from .operations import router as operations_router
from .telemetry import router as telemetry_router
from .users import router as users_router

router = APIRouter()
router.include_router(health_router, tags=["health"])
router.include_router(mqtt_router, tags=["mqtt"])
router.include_router(telemetry_router, tags=["telemetry"])
router.include_router(alerts_router, tags=["alerts"])
router.include_router(auth_router, tags=["auth"])
router.include_router(users_router, tags=["users"])
router.include_router(bins_router, tags=["bins"])
router.include_router(devices_router, tags=["devices"])
router.include_router(operations_router, tags=["operations"])

__all__ = ["router"]
