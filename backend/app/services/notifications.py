"""Notification dispatcher for alerts and route assignment events."""

from __future__ import annotations

import asyncio
import json
import logging
import smtplib
from email.message import EmailMessage
from urllib import error as url_error
from urllib import request as url_request

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.iot import Role, User, UserRole
from app.services.in_app_notifications import create_notifications_for_targets


LOGGER = logging.getLogger(__name__)

AUTHORITY_ROLE_KEYS = ("authority_admin", "authority_operator")


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for raw in values:
        value = raw.strip()
        if not value:
            continue
        lowered = value.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(value)
    return result


async def _load_authority_emails(db: AsyncSession, org_id: int) -> list[str]:
    rows = await db.execute(
        select(distinct(User.email))
        .join(UserRole, UserRole.user_id == User.id)
        .join(Role, Role.id == UserRole.role_id)
        .where(
            User.org_id == org_id,
            User.is_active.is_(True),
            Role.key.in_(AUTHORITY_ROLE_KEYS),
        )
        .order_by(User.email.asc())
    )
    return [str(email) for email in rows.scalars().all() if email]


async def _load_active_user_email(db: AsyncSession, org_id: int, user_id: int) -> str | None:
    return (
        await db.execute(
            select(User.email)
            .where(User.id == user_id, User.org_id == org_id, User.is_active.is_(True))
            .limit(1)
        )
    ).scalar_one_or_none()


def _render_alert_email_body(
    *,
    org_id: int,
    bin_code: str,
    alert_type: str,
    severity: str,
    title: str,
    description: str | None,
) -> str:
    return "\n".join(
        [
            "Smart Waste Alert Notification",
            "",
            f"Organization: {org_id}",
            f"Bin: {bin_code}",
            f"Alert Type: {alert_type}",
            f"Severity: {severity}",
            f"Title: {title}",
            f"Description: {description or '-'}",
        ]
    )


def _render_assignment_email_body(
    *,
    org_id: int,
    route_id: int,
    route_code: str,
    driver_user_id: int,
    vehicle_id: int | None,
) -> str:
    return "\n".join(
        [
            "Smart Waste Route Assignment",
            "",
            f"Organization: {org_id}",
            f"Route ID: {route_id}",
            f"Route Code: {route_code}",
            f"Driver User ID: {driver_user_id}",
            f"Vehicle ID: {vehicle_id if vehicle_id is not None else '-'}",
        ]
    )


def _send_email_sync(*, recipients: list[str], subject: str, body: str) -> bool:
    if not recipients:
        return False

    msg = EmailMessage()
    msg["From"] = settings.notification_email_from
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(body)

    timeout = settings.notification_email_timeout_seconds
    host = settings.notification_email_smtp_host
    port = settings.notification_email_smtp_port
    username = settings.notification_email_smtp_username
    password = settings.notification_email_smtp_password

    if settings.notification_email_smtp_use_ssl:
        with smtplib.SMTP_SSL(host=host, port=port, timeout=timeout) as client:
            if username:
                client.login(username, password)
            client.send_message(msg)
        return True

    with smtplib.SMTP(host=host, port=port, timeout=timeout) as client:
        if settings.notification_email_smtp_use_tls:
            client.starttls()
        if username:
            client.login(username, password)
        client.send_message(msg)
    return True


async def _send_email(*, recipients: list[str], subject: str, body: str) -> bool:
    if not settings.notifications_enabled or not settings.notification_email_enabled:
        return False
    if not settings.notification_email_smtp_host:
        LOGGER.warning("Email notifications enabled but SMTP host is not configured")
        return False

    clean_recipients = _dedupe_preserve_order(recipients)
    if not clean_recipients:
        return False

    try:
        return await asyncio.to_thread(
            _send_email_sync,
            recipients=clean_recipients,
            subject=subject,
            body=body,
        )
    except Exception:
        LOGGER.exception("Failed to dispatch email notification")
        return False


def _post_json_sync(*, endpoint: str, headers: dict[str, str], payload: dict) -> int:
    request_body = json.dumps(payload).encode("utf-8")
    req = url_request.Request(endpoint, data=request_body, headers=headers, method="POST")
    with url_request.urlopen(req, timeout=settings.notification_push_timeout_seconds) as response:
        response.read()
        return int(getattr(response, "status", 200))


async def _send_push(
    *,
    title: str,
    body: str,
    data: dict[str, str],
    topics: list[str],
) -> bool:
    if not settings.notifications_enabled or not settings.notification_push_enabled:
        return False
    if not settings.notification_push_endpoint:
        LOGGER.warning("Push notifications enabled but endpoint is not configured")
        return False

    payload = {
        "provider": settings.notification_push_provider,
        "notification": {"title": title, "body": body},
        "data": data,
        "topics": _dedupe_preserve_order(topics),
    }

    headers = {
        "Content-Type": "application/json",
    }
    if settings.notification_push_api_key:
        headers["Authorization"] = f"Bearer {settings.notification_push_api_key}"

    try:
        status_code = await asyncio.to_thread(
            _post_json_sync,
            endpoint=settings.notification_push_endpoint,
            headers=headers,
            payload=payload,
        )
        if 200 <= status_code < 300:
            return True
        LOGGER.warning("Push notification endpoint returned non-success status code: %s", status_code)
        return False
    except (url_error.HTTPError, url_error.URLError):
        LOGGER.exception("Failed to dispatch push notification")
        return False
    except Exception:
        LOGGER.exception("Unexpected push notification dispatch failure")
        return False


async def dispatch_alert_opened(
    db: AsyncSession,
    *,
    org_id: int,
    bin_code: str,
    alert_type: str,
    severity: str,
    title: str,
    description: str | None,
) -> None:
    """Dispatch notifications when a new alert is opened."""
    try:
        await create_notifications_for_targets(
            db,
            org_id=org_id,
            event_type="alert_opened",
            severity=severity,
            title=title,
            message=description,
            payload_json={
                "org_id": org_id,
                "bin_code": bin_code,
                "alert_type": alert_type,
                "severity": severity,
            },
            target_role_keys=list(AUTHORITY_ROLE_KEYS),
            target_user_ids=None,
        )
    except Exception:
        LOGGER.exception("Failed to persist in-app alert notification")

    if not settings.notifications_enabled:
        return

    authority_emails = await _load_authority_emails(db, org_id)
    email_recipients = _dedupe_preserve_order(
        authority_emails + list(settings.notification_email_recipient_fallback)
    )

    email_body = _render_alert_email_body(
        org_id=org_id,
        bin_code=bin_code,
        alert_type=alert_type,
        severity=severity,
        title=title,
        description=description,
    )
    push_topics = [f"org.{org_id}.alerts"] + list(settings.notification_push_default_topics)

    await asyncio.gather(
        _send_email(recipients=email_recipients, subject=f"[{severity.upper()}] {title}", body=email_body),
        _send_push(
            title=title,
            body=description or title,
            data={
                "org_id": str(org_id),
                "bin_code": bin_code,
                "alert_type": alert_type,
                "severity": severity,
            },
            topics=push_topics,
        ),
    )


async def dispatch_route_assignment_created(
    db: AsyncSession,
    *,
    org_id: int,
    route_id: int,
    route_code: str,
    driver_user_id: int,
    vehicle_id: int | None,
) -> None:
    """Dispatch notifications when a route is assigned to a driver."""
    try:
        await create_notifications_for_targets(
            db,
            org_id=org_id,
            event_type="route_assigned",
            severity="info",
            title=f"Route assigned: {route_code}",
            message=f"Route {route_id} has been assigned to you.",
            payload_json={
                "org_id": org_id,
                "route_id": route_id,
                "route_code": route_code,
                "driver_user_id": driver_user_id,
                "vehicle_id": vehicle_id,
            },
            target_role_keys=None,
            target_user_ids=[driver_user_id],
        )
    except Exception:
        LOGGER.exception("Failed to persist in-app assignment notification")

    if not settings.notifications_enabled:
        return

    driver_email = await _load_active_user_email(db, org_id, driver_user_id)
    email_recipients = [driver_email] if driver_email else []

    body = _render_assignment_email_body(
        org_id=org_id,
        route_id=route_id,
        route_code=route_code,
        driver_user_id=driver_user_id,
        vehicle_id=vehicle_id,
    )
    await asyncio.gather(
        _send_email(
            recipients=email_recipients,
            subject=f"Route Assigned: {route_code}",
            body=body,
        ),
        _send_push(
            title=f"New route assigned: {route_code}",
            body=f"Route {route_id} is assigned to driver {driver_user_id}.",
            data={
                "org_id": str(org_id),
                "route_id": str(route_id),
                "route_code": route_code,
                "driver_user_id": str(driver_user_id),
                "vehicle_id": "" if vehicle_id is None else str(vehicle_id),
            },
            topics=[f"org.{org_id}.driver.{driver_user_id}"] + list(settings.notification_push_default_topics),
        ),
    )