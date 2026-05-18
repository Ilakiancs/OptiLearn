"""
app/api/routes/settings.py — Runtime network-mode settings and API key management.

Controls whether the app routes AI requests to the local Ollama instance
(offline/forced-local) or automatically uses the Gemma 4 26B cloud API
when latency is below the configured threshold (auto mode).

The teacher's choice is persisted in data/user_settings.json and survives
server restarts. POST /api/settings/network-mode to toggle.

API keys can be updated at runtime via POST /api/settings/api-keys. Changes
are written to the active .env file and applied immediately to the live
settings object without requiring a server restart.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.services.model_client import (
    get_network_mode,
    get_network_status,
    set_network_mode,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


class NetworkModeRequest(BaseModel):
    mode: str


class ApiKeysRequest(BaseModel):
    gemma_api_key: str | None = None
    bey_api_key: str | None = None
    use_local_ollama: bool | None = None


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


@router.get("/api-keys")
async def get_api_keys_route() -> dict:
    """Return which keys are configured (masked — never return raw values)."""
    return {
        "gemma_api_key_set": bool(settings.GEMMA_API_KEY),
        "bey_api_key_set": bool(settings.BEY_API_KEY),
        "use_local_ollama": settings.USE_LOCAL_OLLAMA,
    }


@router.post("/api-keys")
async def set_api_keys_route(body: ApiKeysRequest) -> dict:
    """
    Update API keys and/or USE_LOCAL_OLLAMA in the active .env file and apply
    them to the live settings object immediately (no restart required).
    """
    env_path = Path(os.environ.get("ENV_FILE", ".env"))

    # Read existing file
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    updates: dict[str, str] = {}
    if body.gemma_api_key is not None:
        updates["GEMMA_API_KEY"] = body.gemma_api_key
    if body.bey_api_key is not None:
        updates["BEY_API_KEY"] = body.bey_api_key
    if body.use_local_ollama is not None:
        updates["USE_LOCAL_OLLAMA"] = "true" if body.use_local_ollama else "false"

    # Rewrite matching lines in-place; append any keys not already present
    written: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            new_lines.append(f"{key}={updates[key]}")
            written.add(key)
        else:
            new_lines.append(line)

    for key, val in updates.items():
        if key not in written:
            new_lines.append(f"{key}={val}")

    try:
        env_path.parent.mkdir(parents=True, exist_ok=True)
        env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write .env: {exc}") from exc

    # Apply immediately to the live settings singleton
    if body.gemma_api_key is not None:
        settings.GEMMA_API_KEY = body.gemma_api_key
    if body.bey_api_key is not None:
        settings.BEY_API_KEY = body.bey_api_key
    if body.use_local_ollama is not None:
        settings.USE_LOCAL_OLLAMA = body.use_local_ollama
        # Sync runtime mode to match the new setting
        set_network_mode("offline" if body.use_local_ollama else "auto")

    return {
        "ok": True,
        "gemma_api_key_set": bool(settings.GEMMA_API_KEY),
        "bey_api_key_set": bool(settings.BEY_API_KEY),
        "use_local_ollama": settings.USE_LOCAL_OLLAMA,
    }
