"""Schemas for MQTT ingestion and telemetry query responses."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MQTTIngestRequest(BaseModel):
    """Single MQTT message envelope passed to ingestion endpoint."""

    topic: str = Field(min_length=3, max_length=255)
    payload: dict[str, Any]
    qos: int = Field(default=0, ge=0, le=2)
    retain: bool = False
    received_at: datetime | None = None


class MQTTIngestResponse(BaseModel):
    """Result after message ingestion and evaluation."""

    model_config = ConfigDict(from_attributes=True)

    status: str
    raw_message_id: int
    bin_code: str | None = None
    telemetry_id: int | None = None
    evaluation: dict[str, Any] = Field(default_factory=dict)


class TelemetryPoint(BaseModel):
    """Single telemetry point for charting/history."""

    measured_at: datetime
    fill_pct: float | None = None
    fill_rate_pct_per_min: float | None = None
    ttf_min: float | None = None
    priority_score: float | None = None
    alert_level: str | None = None
    overflow_imminent: bool
    queued: bool


class TelemetryLatestResponse(BaseModel):
    """Latest snapshot response for one bin."""

    bin_code: str
    last_measured_at: datetime | None = None
    current_fill_pct: float | None = None
    current_fill_rate_pct_per_min: float | None = None
    current_ttf_min: float | None = None
    current_priority_score: float | None = None
    current_alert_level: str | None = None
    overflow_imminent: bool
    device_connectivity_state: str
    queued_count: int


class TelemetryHistoryResponse(BaseModel):
    """History response for one bin."""

    bin_code: str
    items: list[TelemetryPoint]


class TelemetryLiveSummaryResponse(BaseModel):
    """Aggregated counters for live dashboard cards."""

    total_bins: int
    bins_with_state: int
    red_bins: int
    yellow_bins: int
    overflow_imminent_bins: int
    offline_bins: int
    open_alerts: int
