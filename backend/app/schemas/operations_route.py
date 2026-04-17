"""Schemas for operations route planning APIs."""

from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator


class StartPointResponse(BaseModel):
    """Resolved route start point used by planning and publish responses."""

    source: str
    depot_id: int | None = None
    area_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None


class RoutePlanRequest(BaseModel):
    """Payload for route planning preview."""

    route_date: date
    depot_id: int | None = Field(default=None, gt=0)
    driver_user_id: int | None = Field(default=None, gt=0)
    include_bin_ids: list[int] | None = Field(default=None)
    max_stops: int = Field(default=60, ge=1, le=500)
    min_fill_pct: float = Field(default=70.0, ge=0, le=100)
    overflow_only: bool = False
    target_shift_minutes: int = Field(default=480, ge=60, le=1440)
    avg_speed_kmph: float = Field(default=22.0, gt=0, le=80)
    service_minutes_per_stop: float = Field(default=4.0, ge=0, le=60)

    @model_validator(mode="after")
    def validate_payload(self) -> "RoutePlanRequest":
        if self.include_bin_ids is not None and len(self.include_bin_ids) == 0:
            raise ValueError("include_bin_ids must not be empty when provided")
        return self


class RoutePlanStopResponse(BaseModel):
    """One optimized stop in route plan response."""

    stop_sequence: int
    bin_id: int
    bin_code: str
    latitude: float
    longitude: float
    fill_pct: float | None = None
    priority_score: float
    planned_leg_km: float
    planned_cumulative_km: float


class RoutePlanResponse(BaseModel):
    """Route planning preview response."""

    algorithm: str
    route_date: date
    candidates_considered: int
    selected_stops: int
    skipped_due_to_shift: int
    estimated_distance_km: float
    estimated_duration_min: float
    start_point: StartPointResponse
    items: list[RoutePlanStopResponse]


class RouteDraftCreateRequest(BaseModel):
    """Payload for creating one draft route and stops."""

    route_code: str = Field(min_length=1, max_length=60)
    route_date: date
    depot_id: int | None = Field(default=None, gt=0)
    driver_user_id: int | None = Field(default=None, gt=0)
    stop_bin_ids: list[int] = Field(min_length=1, max_length=500)


class RoutePublishRequest(BaseModel):
    """Payload for publishing one draft route."""

    driver_user_id: int | None = Field(default=None, gt=0)


class RouteResponse(BaseModel):
    """Route representation returned by APIs."""

    id: int
    org_id: int
    route_code: str
    route_date: date
    depot_id: int | None = None
    status: str
    total_distance_km: float | None = None
    estimated_duration_min: float | None = None
    optimization_run_id: int | None = None
    created_by: int | None = None
    updated_by: int | None = None
    stops_count: int | None = None
    start_point: StartPointResponse | None = None
    created_at: datetime
    updated_at: datetime


class RouteListResponse(BaseModel):
    """Paginated route list."""

    total: int
    limit: int
    offset: int
    items: list[RouteResponse]
