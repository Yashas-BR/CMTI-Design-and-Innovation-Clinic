"""FastAPI application factory and setup."""

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import router as v1_router
from app.core.config import settings
from app.services.mqtt_worker import mqtt_consumer_worker
from app.services.stale_checker import stale_bin_checker
from app.services.telemetry_retention import telemetry_retention_worker


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.

    Returns:
        FastAPI: Configured application instance
    """
    app = FastAPI(
        title=settings.api_title,
        description=settings.api_description,
        version=settings.app_version,
        debug=settings.debug,
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_credentials,
        allow_methods=settings.cors_methods,
        allow_headers=settings.cors_headers,
    )

    # Include API routes
    app.include_router(v1_router, prefix=settings.api_prefix)

    @app.on_event("startup")
    async def startup_background_services() -> None:
        if settings.stale_checker_enabled:
            stale_bin_checker.start()
        if settings.mqtt_consumer_enabled:
            mqtt_consumer_worker.start(asyncio.get_running_loop())
        if settings.telemetry_retention_enabled:
            telemetry_retention_worker.start()

    @app.on_event("shutdown")
    async def shutdown_background_services() -> None:
        await stale_bin_checker.stop()
        await telemetry_retention_worker.stop()
        mqtt_consumer_worker.stop()

    return app


# Create application instance
app = create_app()


@app.get("/", tags=["root"])
async def root() -> dict:
    """Root endpoint."""
    return {
        "message": "Welcome to Smart Waste Dashboard API",
        "docs": "/docs",
        "openapi": "/openapi.json",
    }
