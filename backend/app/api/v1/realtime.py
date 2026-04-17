"""Realtime WebSocket routes for live dashboard updates."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.api.deps.auth import AuthUser, resolve_auth_user_from_token
from app.db.database import SessionLocal
from app.services.bin_state_realtime import bin_state_ws_manager


router = APIRouter(prefix="/realtime")


def _extract_websocket_token(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("token")
    if token:
        return token

    auth_header = websocket.headers.get("authorization")
    if not auth_header:
        return None

    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    return parts[1].strip() or None


async def _resolve_ws_user(websocket: WebSocket) -> AuthUser:
    token = _extract_websocket_token(websocket)
    if not token:
        raise PermissionError("Missing bearer token")

    async with SessionLocal() as db:
        user = await resolve_auth_user_from_token(db, token)

    allowed_roles = {"authority_admin", "authority_operator", "driver"}
    if not user.roles.intersection(allowed_roles):
        raise PermissionError("Driver or authority role required")
    return user


@router.websocket("/ws/bin-states")
async def bin_state_ws(websocket: WebSocket) -> None:
    """WebSocket stream for real-time BinCurrentState updates by organization."""
    try:
        user = await _resolve_ws_user(websocket)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await bin_state_ws_manager.connect(user.org_id, websocket)
    try:
        await websocket.send_json(
            {
                "event": "connected",
                "org_id": user.org_id,
                "user_id": user.id,
                "message": "Subscribed to realtime bin state updates",
            }
        )

        while True:
            # Keep the connection open and allow client ping/heartbeat messages.
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await bin_state_ws_manager.disconnect(user.org_id, websocket)
