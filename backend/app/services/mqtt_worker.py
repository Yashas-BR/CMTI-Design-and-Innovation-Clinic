"""Background MQTT consumer worker that forwards broker messages into ingestion pipeline."""

from __future__ import annotations

import asyncio
from concurrent.futures import Future
from datetime import datetime, timezone
import json
import logging
import os
from typing import Any

from app.core.config import settings
from app.db.database import SessionLocal
from app.schemas.mqtt import MQTTIngestRequest
from app.services.mqtt_ingestion import ingest_mqtt_message

logger = logging.getLogger(__name__)

try:
    import paho.mqtt.client as mqtt
except ImportError:  # pragma: no cover - dependency may be absent in CI
    mqtt = None


class MQTTConsumerWorker:
    """Consumes MQTT topics and ingests them via internal service pipeline."""

    def __init__(self) -> None:
        self._client: Any | None = None
        self._started = False
        self._app_loop: asyncio.AbstractEventLoop | None = None

    def start(self, app_loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Start background MQTT consumption loop."""
        if self._started:
            return

        if app_loop is None:
            try:
                app_loop = asyncio.get_running_loop()
            except RuntimeError:
                logger.error("No running app event loop available; MQTT worker not started")
                return

        self._app_loop = app_loop

        if mqtt is None:
            logger.warning("paho-mqtt is not installed; MQTT consumer worker not started")
            return

        if not settings.mqtt_broker_host:
            logger.warning("MQTT broker host not configured; MQTT consumer worker not started")
            return

        client_id = f"{settings.mqtt_client_id_prefix}_{os.getpid()}"
        self._client = mqtt.Client(client_id=client_id)

        if settings.mqtt_username:
            self._client.username_pw_set(settings.mqtt_username, settings.mqtt_password)

        if settings.mqtt_use_tls:
            self._client.tls_set()
            if settings.mqtt_allow_insecure_tls:
                self._client.tls_insecure_set(True)

        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message

        self._client.connect_async(settings.mqtt_broker_host, settings.mqtt_broker_port, keepalive=60)
        self._client.loop_start()
        self._started = True

        logger.info(
            "MQTT worker started (host=%s, port=%s)",
            settings.mqtt_broker_host,
            settings.mqtt_broker_port,
        )

    def stop(self) -> None:
        """Stop background MQTT consumption loop."""
        if not self._started or self._client is None:
            return

        self._client.loop_stop()
        self._client.disconnect()
        self._client = None
        self._started = False
        self._app_loop = None
        logger.info("MQTT worker stopped")

    def _on_connect(self, client: Any, userdata: Any, flags: dict[str, Any], rc: int) -> None:
        if rc != 0:
            logger.error("MQTT worker connection failed with rc=%s", rc)
            return

        client.subscribe(settings.mqtt_data_topic_pattern)
        client.subscribe(settings.mqtt_alert_topic_pattern)
        logger.info(
            "MQTT worker connected; subscribed to %s and %s",
            settings.mqtt_data_topic_pattern,
            settings.mqtt_alert_topic_pattern,
        )

    def _on_message(self, client: Any, userdata: Any, msg: Any) -> None:
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except Exception:
            payload = {"_raw": msg.payload.decode("utf-8", errors="ignore")}

        request = MQTTIngestRequest(
            topic=msg.topic,
            payload=payload,
            qos=getattr(msg, "qos", 0),
            retain=bool(getattr(msg, "retain", False)),
            received_at=datetime.now(timezone.utc),
        )

        if self._app_loop is None:
            logger.error("MQTT worker received message before app loop was set")
            return

        try:
            future = asyncio.run_coroutine_threadsafe(self._persist(request), self._app_loop)
            future.add_done_callback(self._on_persist_done)
        except Exception as exc:  # pragma: no cover - defensive worker guard
            logger.exception("MQTT worker failed to ingest message from topic %s: %s", msg.topic, exc)

    def _on_persist_done(self, future: Future[None]) -> None:
        """Log any ingestion exception raised on app loop task completion."""
        try:
            future.result()
        except Exception as exc:  # pragma: no cover - defensive worker guard
            logger.exception("MQTT worker persistence task failed: %s", exc)

    async def _persist(self, request: MQTTIngestRequest) -> None:
        async with SessionLocal() as db:
            await ingest_mqtt_message(db, request)


mqtt_consumer_worker = MQTTConsumerWorker()
