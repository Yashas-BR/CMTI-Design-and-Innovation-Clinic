"""Application configuration using Pydantic."""

from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # App Configuration
    debug: bool = True
    app_name: str = "Smart Waste Dashboard API"
    app_version: str = "0.1.0"
    api_prefix: str = "/api/v1"

    # API Documentation
    api_title: str = "Smart Waste Dashboard API"
    api_description: str = "API for Smart Waste Management System"

    # Database Configuration
    database_url: str = "postgresql+asyncpg://user:password@localhost:5432/smart_waste_db"
    database_echo: bool = False

    # CORS Configuration
    cors_origins: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]
    cors_credentials: bool = True
    cors_methods: List[str] = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
    cors_headers: List[str] = ["*"]

    # Security
    secret_key: str = "your-secret-key-change-this-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # Background stale-bin checker
    stale_checker_enabled: bool = True
    stale_check_interval_seconds: int = 60
    stale_bin_inactivity_minutes: int = 15

    # MQTT consumer worker
    mqtt_consumer_enabled: bool = False
    mqtt_broker_host: str = ""
    mqtt_broker_port: int = 8883
    mqtt_username: str = ""
    mqtt_password: str = ""
    mqtt_data_topic_pattern: str = "smartbin/+/data"
    mqtt_alert_topic_pattern: str = "smartbin/+/alert"
    mqtt_use_tls: bool = True
    mqtt_allow_insecure_tls: bool = True
    mqtt_client_id_prefix: str = "smart_waste_backend"
    mqtt_ingest_api_key: str = "change-this-mqtt-ingest-api-key"

    # IoT retention worker
    telemetry_retention_enabled: bool = False
    telemetry_retention_interval_seconds: int = 3600
    mqtt_raw_retention_days: int = 30
    bin_telemetry_retention_days: int = 180

    # Notification dispatcher
    notifications_enabled: bool = False
    notification_in_app_enabled: bool = True
    notification_email_enabled: bool = False
    notification_email_from: str = "noreply@smartwaste.local"
    notification_email_smtp_host: str = ""
    notification_email_smtp_port: int = 587
    notification_email_smtp_use_tls: bool = True
    notification_email_smtp_use_ssl: bool = False
    notification_email_smtp_username: str = ""
    notification_email_smtp_password: str = ""
    notification_email_timeout_seconds: float = 10.0
    notification_email_recipient_fallback: List[str] = []
    notification_push_enabled: bool = False
    notification_push_provider: str = "fcm"
    notification_push_endpoint: str = ""
    notification_push_api_key: str = ""
    notification_push_timeout_seconds: float = 8.0
    notification_push_default_topics: List[str] = []

    # Route optimization matrix provider
    route_matrix_provider: str = "osrm"
    route_matrix_fallback: str = "haversine"
    route_matrix_osrm_base_url: str = "http://router.project-osrm.org"
    route_matrix_osrm_profile: str = "driving"
    route_matrix_timeout_seconds: float = 8.0
    route_matrix_local_graph_file: str = ""

    class Config:
        """Pydantic config."""

        env_file = ".env"
        case_sensitive = False


# Create settings instance
settings = Settings()
