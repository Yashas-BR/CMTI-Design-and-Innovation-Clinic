"""Core IoT and operations models used by MQTT ingestion and telemetry queries."""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Organization(Base, TimestampMixin):
    """Organization master table."""

    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    timezone: Mapped[str] = mapped_column(String(50), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class User(Base, TimestampMixin):
    """Application user table for authority/driver roles."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    auth_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Role(Base):
    """Role table (authority_admin, authority_operator, driver)."""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class UserRole(Base):
    """User-to-role assignments."""

    __tablename__ = "user_roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )


class AlertRule(Base, TimestampMixin):
    """Alert rule metadata table."""

    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    rule_type: Mapped[str] = mapped_column(String(40), nullable=False)


class Bin(Base, TimestampMixin):
    """Bin master table."""

    __tablename__ = "bins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    bin_code: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address_line: Mapped[str | None] = mapped_column(String(255), nullable=True)
    area_id: Mapped[int | None] = mapped_column(ForeignKey("service_areas.id", ondelete="SET NULL"), nullable=True)
    depot_id: Mapped[int | None] = mapped_column(ForeignKey("depots.id", ondelete="SET NULL"), nullable=True)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 7), nullable=True)
    capacity_liters: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    bin_height_cm: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    dead_zone_cm: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    threshold_green: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    threshold_yellow: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    distance_factor: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False)
    installed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_service_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class BinDevice(Base, TimestampMixin):
    """Physical IoT device installed in a bin."""

    __tablename__ = "bin_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bin_id: Mapped[int] = mapped_column(ForeignKey("bins.id", ondelete="CASCADE"), nullable=False)
    device_uid: Mapped[str] = mapped_column(String(100), nullable=False)
    mqtt_client_id: Mapped[str] = mapped_column(String(100), nullable=False)
    firmware_version: Mapped[str | None] = mapped_column(String(50), nullable=True)
    hardware_revision: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    installed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decommissioned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BinDeviceHistory(Base):
    """Assignment history of devices to bins."""

    __tablename__ = "bin_device_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    bin_id: Mapped[int] = mapped_column(ForeignKey("bins.id", ondelete="CASCADE"), nullable=False)
    device_id: Mapped[int] = mapped_column(ForeignKey("bin_devices.id", ondelete="CASCADE"), nullable=False)
    active_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    active_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MqttRawMessage(Base):
    """Raw MQTT message log for replay/debugging and ingestion audit."""

    __tablename__ = "mqtt_raw_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    qos: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    parse_status: Mapped[str] = mapped_column(String(20), nullable=False, default="parsed")
    reject_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bin_id: Mapped[int | None] = mapped_column(ForeignKey("bins.id", ondelete="SET NULL"), nullable=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("bin_devices.id", ondelete="SET NULL"), nullable=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BinTelemetry(Base):
    """Parsed telemetry rows used for analytics and trend charts."""

    __tablename__ = "bin_telemetry"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    bin_id: Mapped[int] = mapped_column(ForeignKey("bins.id", ondelete="CASCADE"), nullable=False)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("bin_devices.id", ondelete="SET NULL"), nullable=True)
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload_ts_raw: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    payload_ts_type: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    fill_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    fill_rate_pct_per_min: Mapped[Decimal | None] = mapped_column(Numeric(8, 3), nullable=True)
    ttf_min: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    priority_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    alert_level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    overflow_imminent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    queued: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    raw_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("mqtt_raw_messages.id", ondelete="SET NULL"), nullable=True
    )
    source_topic: Mapped[str | None] = mapped_column(String(255), nullable=True)


class BinCurrentState(Base):
    """Latest per-bin snapshot table optimized for dashboard reads."""

    __tablename__ = "bin_current_state"

    bin_id: Mapped[int] = mapped_column(ForeignKey("bins.id", ondelete="CASCADE"), primary_key=True)
    last_telemetry_id: Mapped[int | None] = mapped_column(
        ForeignKey("bin_telemetry.id", ondelete="SET NULL"), nullable=True
    )
    device_id: Mapped[int | None] = mapped_column(ForeignKey("bin_devices.id", ondelete="SET NULL"), nullable=True)
    last_measured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_fill_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    current_fill_rate_pct_per_min: Mapped[Decimal | None] = mapped_column(Numeric(8, 3), nullable=True)
    current_ttf_min: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    current_priority_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2), nullable=True)
    current_alert_level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    overflow_imminent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    device_connectivity_state: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    queued_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ConnectivityEvent(Base):
    """Connectivity status history per bin/device."""

    __tablename__ = "connectivity_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    bin_id: Mapped[int] = mapped_column(ForeignKey("bins.id", ondelete="CASCADE"), nullable=False)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("bin_devices.id", ondelete="SET NULL"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    event_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_message_id: Mapped[int | None] = mapped_column(
        ForeignKey("mqtt_raw_messages.id", ondelete="SET NULL"), nullable=True
    )
    details_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


class Alert(Base, TimestampMixin):
    """Active/resolved alerts linked to bins."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    bin_id: Mapped[int] = mapped_column(ForeignKey("bins.id", ondelete="CASCADE"), nullable=False)
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("alert_rules.id", ondelete="SET NULL"), nullable=True)
    alert_type: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_to_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    latest_telemetry_id: Mapped[int | None] = mapped_column(
        ForeignKey("bin_telemetry.id", ondelete="SET NULL"), nullable=True
    )
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True)


class AlertEvent(Base):
    """Alert lifecycle events."""

    __tablename__ = "alert_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    event_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
