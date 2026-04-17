"""Schemas for analytics and reporting APIs."""

from datetime import datetime

from pydantic import BaseModel


class EfficiencyAnalyticsResponse(BaseModel):
    """Collection efficiency metrics for a selected time range."""

    from_ts: datetime
    to_ts: datetime
    total_collections: int
    total_routes: int
    total_distance_km: float
    total_active_hours: float
    collections_per_hour: float
    distance_per_collection_km: float


class SavingsAnalyticsResponse(BaseModel):
    """Optimization savings metrics compared with naive routing."""

    from_ts: datetime
    to_ts: datetime
    routes_analyzed: int
    optimized_distance_km: float
    naive_distance_km: float
    distance_saved_km: float
    distance_saved_pct: float
    optimized_fuel_l: float
    naive_fuel_l: float
    fuel_saved_l: float
    fuel_saved_pct: float


class EnvironmentalAnalyticsResponse(BaseModel):
    """Environmental impact metrics derived from route optimization savings."""

    from_ts: datetime
    to_ts: datetime
    optimized_co2_kg: float
    naive_co2_kg: float
    co2_saved_kg: float
    co2_reduction_pct: float
    fuel_saved_l: float
    distance_saved_km: float
