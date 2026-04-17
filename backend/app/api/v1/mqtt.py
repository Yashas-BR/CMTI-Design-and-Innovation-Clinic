"""MQTT ingestion routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.auth import require_mqtt_ingest_api_key
from app.db.database import get_db
from app.schemas.mqtt import MQTTIngestRequest, MQTTIngestResponse
from app.services.mqtt_ingestion import ingest_mqtt_message

router = APIRouter(prefix="/mqtt")


@router.post("/ingest", response_model=MQTTIngestResponse, status_code=status.HTTP_201_CREATED)
async def ingest_message(
    payload: MQTTIngestRequest,
    _: None = Depends(require_mqtt_ingest_api_key),
    db: AsyncSession = Depends(get_db),
) -> MQTTIngestResponse:
    """Ingest one MQTT message and run immediate evaluation updates."""
    try:
        result = await ingest_mqtt_message(db, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return MQTTIngestResponse(**result)
