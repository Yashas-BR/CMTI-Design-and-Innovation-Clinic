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

    class Config:
        """Pydantic config."""

        env_file = ".env"
        case_sensitive = False


# Create settings instance
settings = Settings()
