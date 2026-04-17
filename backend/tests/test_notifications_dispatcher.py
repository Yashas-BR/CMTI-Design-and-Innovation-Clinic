"""Unit tests for notification dispatcher behavior."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.services.notifications import dispatch_alert_opened, dispatch_route_assignment_created


@pytest.mark.asyncio
async def test_dispatch_alert_opened_sends_email_and_push() -> None:
    """Alert dispatcher should call both channel senders when globally enabled."""
    db = SimpleNamespace()

    original_notifications_enabled = settings.notifications_enabled
    try:
        settings.notifications_enabled = True

        with (
            patch(
                "app.services.notifications._load_authority_emails",
                new=AsyncMock(return_value=["ops@example.com"]),
            ),
            patch(
                "app.services.notifications.create_notifications_for_targets",
                new=AsyncMock(return_value=[]),
            ) as in_app_mock,
            patch("app.services.notifications._send_email", new=AsyncMock(return_value=True)) as email_mock,
            patch("app.services.notifications._send_push", new=AsyncMock(return_value=True)) as push_mock,
        ):
            await dispatch_alert_opened(
                db,
                org_id=1,
                bin_code="BIN_001",
                alert_type="overflow_imminent",
                severity="critical",
                title="Overflow imminent for BIN_001",
                description="Predicted time-to-full is 10 minutes.",
            )

        assert in_app_mock.await_count == 1
        assert email_mock.await_count == 1
        assert push_mock.await_count == 1
        assert "ops@example.com" in email_mock.await_args.kwargs["recipients"]
    finally:
        settings.notifications_enabled = original_notifications_enabled


@pytest.mark.asyncio
async def test_dispatch_route_assignment_created_targets_driver() -> None:
    """Assignment dispatcher should target driver-specific recipients and topics."""
    db = SimpleNamespace()

    original_notifications_enabled = settings.notifications_enabled
    try:
        settings.notifications_enabled = True

        with (
            patch(
                "app.services.notifications._load_active_user_email",
                new=AsyncMock(return_value="driver@example.com"),
            ),
            patch(
                "app.services.notifications.create_notifications_for_targets",
                new=AsyncMock(return_value=[]),
            ) as in_app_mock,
            patch("app.services.notifications._send_email", new=AsyncMock(return_value=True)) as email_mock,
            patch("app.services.notifications._send_push", new=AsyncMock(return_value=True)) as push_mock,
        ):
            await dispatch_route_assignment_created(
                db,
                org_id=1,
                route_id=7001,
                route_code="ROUTE-7001",
                driver_user_id=22,
                vehicle_id=3,
            )

        assert in_app_mock.await_count == 1
        assert email_mock.await_count == 1
        assert email_mock.await_args.kwargs["recipients"] == ["driver@example.com"]
        assert push_mock.await_count == 1
        assert "org.1.driver.22" in push_mock.await_args.kwargs["topics"]
    finally:
        settings.notifications_enabled = original_notifications_enabled
