"""Tests for MQTT ingestion and telemetry route contracts."""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.api.deps.auth import AuthUser, require_authority_or_driver_user
from app.core.config import settings
from app.main import app


async def _driver_user_override() -> AuthUser:
    return AuthUser(id=1, org_id=1, email="driver@example.com", roles={"driver"})


@pytest.mark.asyncio
async def test_mqtt_ingest_route_returns_created() -> None:
    """MQTT ingest endpoint should return 201 with service output."""
    payload = {
        "topic": "smartbin/BIN_001/data",
        "payload": {
            "bin_id": "BIN_001",
            "fill_pct": 71.2,
            "fill_rate": 0.15,
            "ttf_min": 55,
            "priority": 78,
            "alert": "YELLOW",
            "overflow_imminent": False,
            "queued": False,
        },
        "qos": 1,
        "retain": False,
    }

    mock_result = {
        "status": "ok",
        "raw_message_id": 101,
        "bin_code": "BIN_001",
        "telemetry_id": 201,
        "evaluation": {
            "channel": "data",
            "threshold_alert": "opened",
            "overflow_alert": "none",
            "payload_ts_type": "uptime_s",
        },
    }

    with patch("app.api.v1.mqtt.ingest_mqtt_message", new=AsyncMock(return_value=mock_result)):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/v1/mqtt/ingest",
                json=payload,
                headers={"X-API-Key": settings.mqtt_ingest_api_key},
            )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "ok"
    assert body["raw_message_id"] == 101
    assert body["telemetry_id"] == 201


@pytest.mark.asyncio
async def test_telemetry_latest_route_returns_snapshot() -> None:
    """Latest telemetry route should return one snapshot document."""
    mock_result = {
        "bin_code": "BIN_001",
        "last_measured_at": None,
        "current_fill_pct": 66.0,
        "current_fill_rate_pct_per_min": 0.12,
        "current_ttf_min": 90.0,
        "current_priority_score": 61.3,
        "current_alert_level": "YELLOW",
        "overflow_imminent": False,
        "device_connectivity_state": "online",
        "queued_count": 0,
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.telemetry.get_bin_latest_state", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/telemetry/bins/BIN_001/latest")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    body = response.json()
    assert body["bin_code"] == "BIN_001"
    assert body["current_alert_level"] == "YELLOW"


@pytest.mark.asyncio
async def test_telemetry_summary_route_returns_counters() -> None:
    """Live summary route should return dashboard counters."""
    mock_result = {
        "total_bins": 5,
        "bins_with_state": 5,
        "red_bins": 1,
        "yellow_bins": 2,
        "overflow_imminent_bins": 1,
        "offline_bins": 0,
        "open_alerts": 2,
    }

    app.dependency_overrides[require_authority_or_driver_user] = _driver_user_override
    try:
        with patch("app.api.v1.telemetry.get_live_summary", new=AsyncMock(return_value=mock_result)):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/v1/telemetry/live/summary")
    finally:
        app.dependency_overrides.pop(require_authority_or_driver_user, None)

    assert response.status_code == 200
    assert response.json()["open_alerts"] == 2


@pytest.mark.asyncio
async def test_mqtt_ingest_requires_api_key() -> None:
    """MQTT ingest route should reject requests without X-API-Key."""
    payload = {
        "topic": "smartbin/BIN_001/data",
        "payload": {"bin_id": "BIN_001"},
        "qos": 0,
        "retain": False,
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/api/v1/mqtt/ingest", json=payload)

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_telemetry_requires_auth_when_no_override() -> None:
    """Telemetry routes should reject unauthenticated requests by default."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/telemetry/live/summary")

    assert response.status_code == 401
