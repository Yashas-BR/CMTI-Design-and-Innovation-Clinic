"""API v1 routes."""

from fastapi import APIRouter

from .analytics import router as analytics_router
from .alerts import router as alerts_router
from .auth import router as auth_router
from .bins import router as bins_router
from .devices import router as devices_router
from .health import router as health_router
from .master_data import router as master_data_router
from .mqtt import router as mqtt_router
from .notifications import router as notifications_router
from .operations import router as operations_router
from .realtime import router as realtime_router
from .simulator import router as simulator_router
from .telemetry import router as telemetry_router
from .users import router as users_router

router = APIRouter()
router.include_router(health_router, tags=["health"])
router.include_router(mqtt_router, tags=["mqtt"])
router.include_router(notifications_router, tags=["notifications"])
router.include_router(realtime_router, tags=["realtime"])
router.include_router(telemetry_router, tags=["telemetry"])
router.include_router(analytics_router, tags=["analytics"])
router.include_router(alerts_router, tags=["alerts"])
router.include_router(auth_router, tags=["auth"])
router.include_router(users_router, tags=["users"])
router.include_router(master_data_router, tags=["master-data"])
router.include_router(bins_router, tags=["bins"])
router.include_router(devices_router, tags=["devices"])
router.include_router(operations_router, tags=["operations"])
router.include_router(simulator_router, tags=["simulator"])

__all__ = ["router"]
