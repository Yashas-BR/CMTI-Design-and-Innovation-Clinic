"""Health check schemas."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Response model for health check endpoint."""

    status: str
    message: str
    version: str

    class Config:
        """Pydantic config."""

        json_schema_extra = {
            "example": {
                "status": "healthy",
                "message": "API is running",
                "version": "0.1.0",
            }
        }
