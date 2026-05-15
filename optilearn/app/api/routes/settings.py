"""
app/api/routes/settings.py — Runtime network-mode settings.

Controls whether the app routes AI requests to the local Ollama instance
(offline/forced-local) or automatically uses the Gemma 4 26B cloud API
when latency is below the configured threshold (auto mode).

The teacher's choice is persisted in data/user_settings.json and survives
server restarts. POST /api/settings/network-mode to toggle.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.model_client import (
    get_network_mode,
    get_network_status,
    set_network_mode,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class NetworkModeRequest(BaseModel):
    mode: str


@router.get("/network-mode")
async def get_network_mode_route() -> dict:
    status = await get_network_status()
    mode = get_network_mode()
    return {
        "mode": mode,
        "use_local_ollama": not status["use_26b"],
        "network": status,
    }


@router.post("/network-mode")
async def set_network_mode_route(body: NetworkModeRequest) -> dict:
    try:
        result = set_network_mode(body.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    status = await get_network_status()
    return {**result, "network": status}
