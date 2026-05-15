"""
app/services/model_client.py — unified AI model client.

Routing:
  TUTOR routes always use local E2B via Ollama.
  TRANSLATION and ADMIN routes use Gemma 4 26B API only when auto mode is
  enabled, a 26B key is configured, and measured latency is below threshold.
  Otherwise they fall back to local E2B via Ollama.

Legacy compatibility:
  USE_LOCAL_OLLAMA=true  → always use Ollama (offline-first)
  USE_LOCAL_OLLAMA=false → check internet; if online use Gemini API,
                           if offline fall back to Ollama automatically

Ollama streaming path uses /api/chat (native multi-turn messages format).
  - System prompt is sent as {"role": "system", "content": "..."}
  - Student messages and history are sent as-is
  - Thinking mode is controlled via the options dict

Ollama non-streaming path (used for tool dispatch / quiz generation) still
uses /api/generate because it needs a flat prompt for structured JSON output.

26B path uses google-genai SDK for online translation, notes, and admin tasks.
Whisper transcription stays local and is not routed through the API.
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator

import httpx
from loguru import logger

from app.core.config import settings
from app.services import model_scheduler

ROUTE_TUTOR = "TUTOR"
ROUTE_TRANSLATION = "TRANSLATION"
ROUTE_ADMIN = "ADMIN"
MODEL_SWITCH_TOKEN = "__MODEL_SWITCH__"


@dataclass(frozen=True)
class ModelProfile:
    """Reusable capability profile for current and future fine-tuned models."""

    name: str
    route_type: str
    local_model_setting: str
    lane: str
    think: bool | str | None = False
    keep_alive: str = "60m"
    use_cloud_when_auto: bool = False


MODEL_PROFILES: dict[str, ModelProfile] = {
    "tutor_fast": ModelProfile(
        name="tutor_fast",
        route_type=ROUTE_TUTOR,
        local_model_setting="OLLAMA_TUTOR_MODEL",
        lane=model_scheduler.LANE_STUDENT_CHAT,
        think=False,
    ),
    "translation_fast": ModelProfile(
        name="translation_fast",
        route_type=ROUTE_TRANSLATION,
        local_model_setting="OLLAMA_MODEL_FAST",
        lane=model_scheduler.LANE_LIVE_TRANSLATION,
        think=False,
        use_cloud_when_auto=True,
    ),
    "notes_balanced": ModelProfile(
        name="notes_balanced",
        route_type=ROUTE_TRANSLATION,
        local_model_setting="OLLAMA_MODEL_FAST",
        lane=model_scheduler.LANE_BACKGROUND,
        think=False,
        use_cloud_when_auto=True,
    ),
    "admin_balanced": ModelProfile(
        name="admin_balanced",
        route_type=ROUTE_ADMIN,
        local_model_setting="OLLAMA_MODEL_FAST",
        lane=model_scheduler.LANE_ADMIN,
        think=False,
        use_cloud_when_auto=True,
    ),
    "deep_optional": ModelProfile(
        name="deep_optional",
        route_type=ROUTE_ADMIN,
        local_model_setting="OLLAMA_MODEL_DEEP",
        lane=model_scheduler.LANE_BACKGROUND,
        think=True,
        use_cloud_when_auto=True,
    ),
}

_network_status_cache: dict | None = None
_network_status_timestamp: float = 0
NETWORK_CACHE_TTL = 30

_USER_SETTINGS_PATH = Path(settings.DB_PATH).resolve().parent / "user_settings.json"
_runtime_network_mode: str | None = None
_OLLAMA_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=30.0)

_API_MAX_RETRIES = 3
_API_RETRY_DELAY = (1.5, 3.0, 6.0)


# ──────────────────────────────────────────────────────────────
# Friendly error shown to users when Ollama is not reachable
# ──────────────────────────────────────────────────────────────
_OLLAMA_DOWN_MSG = (
    "The local AI model is not running. "
    "Please start Ollama (run 'ollama serve' in a terminal) and try again."
)
_OLLAMA_TIMEOUT_MSG = (
    "The local AI model is taking longer than expected. "
    "OptiLearn is keeping the classroom server stable; please try again in a moment."
)

# ──────────────────────────────────────────────────────────────
# Connectivity + model selection helpers
# ──────────────────────────────────────────────────────────────
async def check_connectivity() -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.get("https://dns.google")
        return True
    except Exception:
        return False


def _has_26b_api_key() -> bool:
    key = (settings.GEMMA_26B_API_KEY or "").strip()
    return bool(key and not key.startswith("<"))


async def is_model_present(model_name: str) -> bool:
    """Check if a model is already pulled in Ollama (no download triggered)."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{settings.OLLAMA_HOST}/api/tags")
        if r.status_code != 200:
            return False
        names = [m.get("name", "") for m in r.json().get("models", [])]
        # Exact match, or tagless lookup (e.g. "gemma4" matches "gemma4:latest")
        has_tag = ":" in model_name
        return any(
            n == model_name or (not has_tag and n.split(":")[0] == model_name)
            for n in names
        )
    except Exception:
        return False


async def pull_model(model_name: str) -> bool:
    """Pull a model from Ollama registry. Streams progress to logs. Returns success."""
    logger.info("Pulling Ollama model {} (not present locally)…", model_name)
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=1800.0, write=30.0, pool=10.0)
        ) as client:
            async with client.stream(
                "POST",
                f"{settings.OLLAMA_HOST}/api/pull",
                json={"name": model_name, "stream": True},
            ) as response:
                if response.status_code != 200:
                    logger.error("Ollama pull failed: status={}", response.status_code)
                    return False
                async for raw in response.aiter_lines():
                    if not raw.strip():
                        continue
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    status = chunk.get("status", "")
                    total = chunk.get("total", 0)
                    completed = chunk.get("completed", 0)
                    if total and completed:
                        pct = int(completed / total * 100)
                        logger.info("Pulling {}: {}% ({})", model_name, pct, status)
                    elif status:
                        logger.info("Pulling {}: {}", model_name, status)
        logger.info("Ollama model {} ready", model_name)
        return True
    except Exception as exc:
        logger.error("Ollama pull error for {}: {}", model_name, exc)
        return False


async def ensure_ollama_model(model_name: str) -> bool:
    """
    Check if the model is present in Ollama.
    - If present: return True immediately (no warmup, no download).
    - If missing and offline mode: pull it, then return result.
    - If missing and online/auto mode: skip pull, return False (API will be used).
    """
    present = await is_model_present(model_name)
    if present:
        logger.info("Ollama model {} found locally", model_name)
        return True
    if _is_force_offline():
        logger.warning("Model {} not found — pulling (offline mode requires it)", model_name)
        return await pull_model(model_name)
    logger.info("Model {} not in Ollama — skipping pull (online/auto mode active)", model_name)
    return False


def load_user_network_settings() -> None:
    """Load persisted network-mode preference at server startup.

    Dashboard toggle always wins: a teacher-set offline/auto preference
    persists across restarts. .env sets the default only when no saved
    preference exists.
    """
    global _runtime_network_mode  # noqa: PLW0603
    try:
        if not _USER_SETTINGS_PATH.exists():
            # No saved preference — fall back to .env default
            _runtime_network_mode = "offline" if settings.USE_LOCAL_OLLAMA else "auto"
            return
        data = json.loads(_USER_SETTINGS_PATH.read_text(encoding="utf-8"))
        mode = data.get("network_mode")
        if mode in {"auto", "offline"}:
            _runtime_network_mode = mode
        else:
            _runtime_network_mode = "offline" if settings.USE_LOCAL_OLLAMA else "auto"
    except Exception as exc:
        logger.warning("Could not load user network settings: {}", exc)
        _runtime_network_mode = "offline" if settings.USE_LOCAL_OLLAMA else "auto"


def get_network_mode() -> str:
    if _runtime_network_mode in {"auto", "offline"}:
        return _runtime_network_mode
    return "offline" if settings.USE_LOCAL_OLLAMA else "auto"


def _is_force_offline() -> bool:
    return get_network_mode() == "offline"


def is_force_offline() -> bool:
    """Public alias for _is_force_offline — use this for cross-module imports."""
    return _is_force_offline()


def has_26b_api_key() -> bool:
    """Public alias for _has_26b_api_key — use this for cross-module imports."""
    return _has_26b_api_key()


def set_network_mode(mode: str) -> dict:
    """Persist runtime network mode and invalidate the routing cache."""
    global _runtime_network_mode  # noqa: PLW0603
    if mode not in {"auto", "offline"}:
        raise ValueError("mode must be 'auto' or 'offline'")
    _runtime_network_mode = mode
    _USER_SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _USER_SETTINGS_PATH.write_text(
        json.dumps({"network_mode": mode}, indent=2),
        encoding="utf-8",
    )
    invalidate_network_cache()
    return {"mode": get_network_mode(), "use_local_ollama": _is_force_offline()}


async def check_network_status() -> dict:
    """
    Returns network status based on USE_LOCAL_OLLAMA setting.
    Returns: {
        "connected": bool,
        "latency_ms": int | None,
        "use_26b": bool
    }
    """
    # Determine status purely based on USE_LOCAL_OLLAMA setting
    if settings.USE_LOCAL_OLLAMA:
        # Offline mode: using local ollama
        return {"connected": True, "latency_ms": None, "use_26b": False}
    else:
        # Online mode: using API/cloud
        return {"connected": True, "latency_ms": None, "use_26b": True}


async def _measure_network_latency() -> int | None:
    """Measure internet latency with HTTP probes, falling back to OS ping."""
    probe_urls = [
        "https://www.google.com/generate_204",
        "https://dns.google",
        settings.GEMMA_26B_BASE_URL,
    ]
    latencies: list[int] = []
    for url in probe_urls:
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(
                timeout=3.0,
                follow_redirects=False,
            ) as client:
                response = await client.get(url)
            if response.status_code < 500:
                latencies.append(int((time.monotonic() - start) * 1000))
        except Exception:
            continue

    ping_latency = await asyncio.to_thread(_ping_latency_ms)
    if ping_latency is not None:
        latencies.append(ping_latency)

    return min(latencies) if latencies else None


def _ping_latency_ms() -> int | None:
    """Best-effort fallback for networks where HTTPS probes are blocked."""
    command = ["ping", "-n" if sys.platform.startswith("win") else "-c", "1", "google.com"]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        return None
    if result.returncode != 0:
        return None

    output = f"{result.stdout}\n{result.stderr}"
    match = re.search(r"time[=<]\s*(\d+)\s*ms", output, re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.search(r"Average\s*=\s*(\d+)\s*ms", output, re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.search(r"avg[/=]\s*([\d.]+)", output, re.IGNORECASE)
    if match:
        return int(float(match.group(1)))
    return None


async def get_network_status() -> dict:
    global _network_status_cache, _network_status_timestamp  # noqa: PLW0603
    now = time.monotonic()
    if (
        _network_status_cache is None
        or (now - _network_status_timestamp) > NETWORK_CACHE_TTL
    ):
        _network_status_cache = await check_network_status()
        _network_status_timestamp = now
    return _network_status_cache


def invalidate_network_cache() -> None:
    global _network_status_cache  # noqa: PLW0603
    _network_status_cache = None


def resolve_model_profile(profile: str | None = None, route_type: str = ROUTE_TUTOR) -> ModelProfile:
    if profile and profile in MODEL_PROFILES:
        return MODEL_PROFILES[profile]
    route = (route_type or ROUTE_TUTOR).upper()
    if route == ROUTE_TRANSLATION:
        return MODEL_PROFILES["translation_fast"]
    if route == ROUTE_ADMIN:
        return MODEL_PROFILES["admin_balanced"]
    return MODEL_PROFILES["tutor_fast"]


def _profile_local_model(profile: ModelProfile) -> str:
    return str(getattr(settings, profile.local_model_setting))


def get_model_profiles() -> dict[str, dict[str, Any]]:
    return {
        name: {
            "name": profile.name,
            "route_type": profile.route_type,
            "local_model": _profile_local_model(profile),
            "lane": profile.lane,
            "think": profile.think,
            "keep_alive": profile.keep_alive,
            "use_cloud_when_auto": profile.use_cloud_when_auto,
        }
        for name, profile in MODEL_PROFILES.items()
    }


def _get_26b_client() -> Any:
    from google import genai

    return genai.Client(api_key=settings.GEMMA_26B_API_KEY)


async def stream_26b(
    prompt: str,
    system_prompt: str = "",
    enable_thinking: bool = False,
    image_b64: str | None = None,
) -> AsyncGenerator[str, None]:
    """Stream tokens from Gemma 4 26B via Google Generative AI API."""
    import base64
    from google.genai import types as genai_types

    client = _get_26b_client()
    parts: list[Any] = [genai_types.Part(text=prompt)]
    if image_b64:
        parts.append(
            genai_types.Part(
                inline_data=genai_types.Blob(
                    mime_type="image/jpeg",
                    data=base64.b64decode(image_b64),
                )
            )
        )
    contents = [genai_types.Content(role="user", parts=parts)]
    config_kwargs: dict[str, Any] = {
        "temperature": 1.0,
        "top_p": 0.95,
        "top_k": 64,
        "thinking_config": genai_types.ThinkingConfig(
            include_thoughts=enable_thinking
        ),
    }
    if system_prompt:
        config_kwargs["system_instruction"] = system_prompt
    config = genai_types.GenerateContentConfig(**config_kwargs)
    logger.info(
        "26B API stream start -> model={} prompt_chars={} image={}",
        settings.GEMMA_26B_MODEL,
        len(prompt),
        bool(image_b64),
    )
    for attempt in range(_API_MAX_RETRIES):
        try:
            stream = await asyncio.to_thread(
                client.models.generate_content_stream,
                model=settings.GEMMA_26B_MODEL,
                contents=contents,
                config=config,
            )
            chunk_count = 0
            char_count = 0
            for chunk in stream:
                if getattr(chunk, "text", None):
                    chunk_count += 1
                    char_count += len(chunk.text)
                    yield chunk.text
            logger.info(
                "26B API stream complete -> model={} chunks={} chars={}",
                settings.GEMMA_26B_MODEL,
                chunk_count,
                char_count,
            )
            return
        except Exception as exc:
            msg = str(exc)
            is_transient = "500" in msg or "INTERNAL" in msg or "503" in msg or "UNAVAILABLE" in msg
            if is_transient and attempt < _API_MAX_RETRIES - 1:
                delay = _API_RETRY_DELAY[attempt]
                logger.warning("26B transient error (attempt {}/{}), retrying in {}s: {}", attempt + 1, _API_MAX_RETRIES, delay, exc)
                await asyncio.sleep(delay)
                continue
            logger.error("26B API stream error: {}", exc)
            raise


async def _ollama_stream(
    prompt: str,
    model_name: str,
    *,
    system_prompt: str = "",
    enable_thinking: bool = False,
    extra_options: dict[str, Any] | None = None,
    image_b64: str | None = None,
    lane: str | None = None,
    feature: str = "model.generate",
    route_type: str = "OLLAMA",
    cache_status: str = "miss",
    think: bool | str | None = False,
    keep_alive: str = "60m",
) -> AsyncGenerator[str, None]:
    opts: dict[str, Any] = {"temperature": 1.0, "top_p": 0.95, "top_k": 64}
    if extra_options:
        opts.update(extra_options)
    body: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "system": system_prompt,
        "stream": True,
        "options": opts,
        "keep_alive": keep_alive,
    }
    if think is not None:
        body["think"] = think
    if image_b64:
        body["images"] = [image_b64]
    async def request_stream() -> AsyncGenerator[str, None]:
        try:
            async with httpx.AsyncClient(timeout=_OLLAMA_TIMEOUT) as client:
                async with client.stream("POST", f"{settings.OLLAMA_HOST}/api/generate", json=body) as response:
                    response.raise_for_status()
                    buffer = ""
                    async for raw in response.aiter_lines():
                        if not raw.strip():
                            continue
                        try:
                            chunk = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        token = chunk.get("response", "")
                        thinking = chunk.get("thinking", "")
                        if thinking and enable_thinking and not token:
                            continue
                        if token:
                            buffer += token
                            if enable_thinking:
                                clean = _strip_thinking(buffer)
                                prev_clean = _strip_thinking(buffer[:-len(token)])
                                new_portion = clean[len(prev_clean):]
                                if new_portion:
                                    yield new_portion
                            else:
                                yield token
                        if chunk.get("done"):
                            break
        except (httpx.ConnectError, httpx.ConnectTimeout, ConnectionRefusedError) as exc:
            logger.error("Ollama not reachable at {} (routed stream): {}", settings.OLLAMA_HOST, exc)
            raise RuntimeError(_OLLAMA_DOWN_MSG) from exc
        except httpx.TimeoutException as exc:
            logger.error("Ollama routed stream timed out at {}: {}", settings.OLLAMA_HOST, exc)
            raise RuntimeError(_OLLAMA_TIMEOUT_MSG) from exc

    try:
        async for token in model_scheduler.stream_with_lane(
            lane=lane,
            feature=feature,
            route_type=route_type,
            input_size=len(prompt) + len(system_prompt),
            cache_status=cache_status,
            generator_factory=request_stream,
        ):
            yield token
    except (httpx.ConnectError, httpx.ConnectTimeout, ConnectionRefusedError) as exc:
        logger.error("Ollama not reachable at {} (routed stream): {}", settings.OLLAMA_HOST, exc)
        raise RuntimeError(_OLLAMA_DOWN_MSG) from exc
    except httpx.TimeoutException as exc:
        logger.error("Ollama routed stream timed out at {}: {}", settings.OLLAMA_HOST, exc)
        raise RuntimeError(_OLLAMA_TIMEOUT_MSG) from exc


async def route_generate(
    prompt: str,
    route_type: str,
    system_prompt: str = "",
    enable_thinking: bool = False,
    stream: bool = True,
    image_b64: str | None = None,
    ollama_options: dict[str, Any] | None = None,
    lane: str | None = None,
    feature: str | None = None,
    cache_status: str = "miss",
    profile: str | None = None,
) -> AsyncGenerator[str, None]:
    """
    Routes to the correct model based on route_type and network status.
    TUTOR always uses local E2B.
    TRANSLATION and ADMIN use 26B when online, E2B when offline.
    """
    del stream
    feature_name = feature or f"route.{route_type.lower()}"
    model_profile = resolve_model_profile(profile, route_type)
    lane_name = lane or model_profile.lane
    if route_type == ROUTE_TUTOR:
        # FUTURE: replace settings.OLLAMA_TUTOR_MODEL with fine-tuned model
        local_model = _profile_local_model(model_profile)
        logger.info("MODEL ROUTE: {} -> local profile={} ({})", route_type, model_profile.name, local_model)
        async for token in _ollama_stream(
            prompt,
            local_model,
            system_prompt=system_prompt,
            enable_thinking=enable_thinking,
            extra_options=ollama_options,
            image_b64=image_b64,
            lane=lane_name,
            feature=feature_name,
            route_type=route_type,
            cache_status=cache_status,
            think=model_profile.think,
            keep_alive=model_profile.keep_alive,
        ):
            yield token
        return

    status = await get_network_status()
    if status["use_26b"] and model_profile.use_cloud_when_auto:
        logger.info(
            "MODEL ROUTE: {} -> 26B API ({}) latency={}ms",
            route_type,
            settings.GEMMA_26B_MODEL,
            status["latency_ms"],
        )
        async def api_stream() -> AsyncGenerator[str, None]:
            async for piece in stream_26b(
                prompt,
                system_prompt=system_prompt,
                enable_thinking=enable_thinking,
                image_b64=image_b64,
            ):
                yield piece

        async for token in model_scheduler.stream_with_lane(
            lane=lane_name,
            feature=feature_name,
            route_type=route_type,
            input_size=len(prompt) + len(system_prompt),
            cache_status=cache_status,
            generator_factory=api_stream,
        ):
            yield token
        return

    reason = (
        "manual override"
        if _is_force_offline()
        else f"latency={status['latency_ms']}ms"
        if status["connected"]
        else "offline"
    )
    logger.info(
        "MODEL ROUTE: {} -> local profile={} ({}) reason={}",
        route_type,
        model_profile.name,
        _profile_local_model(model_profile),
        reason,
    )
    async for token in _ollama_stream(
        prompt,
        _profile_local_model(model_profile),
        system_prompt=system_prompt,
        enable_thinking=enable_thinking,
        extra_options=ollama_options,
        image_b64=image_b64,
        lane=lane_name,
        feature=feature_name,
        route_type=route_type,
        cache_status=cache_status,
        think=model_profile.think,
        keep_alive=model_profile.keep_alive,
    ):
        yield token


async def route_generate_with_fallback(
    prompt: str,
    route_type: str,
    system_prompt: str = "",
    enable_thinking: bool = False,
    stream: bool = True,
    image_b64: str | None = None,
    ollama_options: dict[str, Any] | None = None,
    lane: str | None = None,
    feature: str | None = None,
    cache_status: str = "miss",
    profile: str | None = None,
) -> AsyncGenerator[str, None]:
    """Like route_generate but catches 26B failures and falls back to E2B."""
    feature_name = feature or f"route.{route_type.lower()}"
    model_profile = resolve_model_profile(profile, route_type)
    lane_name = lane or model_profile.lane
    status = await get_network_status()
    if not status["use_26b"] or route_type == ROUTE_TUTOR or not model_profile.use_cloud_when_auto:
        if route_type != ROUTE_TUTOR:
            reason = (
                "manual override"
                if _is_force_offline()
                else f"latency={status['latency_ms']}ms"
                if status["connected"]
                else "offline"
            )
            logger.info(
                "MODEL ROUTE: {} -> local profile={} ({}) reason={}",
                route_type,
                model_profile.name,
                _profile_local_model(model_profile),
                reason,
            )
        async for token in route_generate(
            prompt,
            route_type,
            system_prompt=system_prompt,
            enable_thinking=enable_thinking,
            stream=stream,
            image_b64=image_b64,
            ollama_options=ollama_options,
            lane=lane_name,
            feature=feature_name,
            cache_status=cache_status,
            profile=model_profile.name,
        ):
            yield token
        return

    got_tokens = False
    try:
        logger.info(
            "MODEL ROUTE: {} -> 26B API ({}) latency={}ms",
            route_type,
            settings.GEMMA_26B_MODEL,
            status["latency_ms"],
        )
        async def api_stream() -> AsyncGenerator[str, None]:
            async for piece in stream_26b(
                prompt,
                system_prompt=system_prompt,
                enable_thinking=enable_thinking,
                image_b64=image_b64,
            ):
                yield piece

        async for token in model_scheduler.stream_with_lane(
            lane=lane_name,
            feature=feature_name,
            route_type=route_type,
            input_size=len(prompt) + len(system_prompt),
            cache_status=cache_status,
            generator_factory=api_stream,
        ):
            got_tokens = True
            yield token
        return
    except Exception as exc:
        logger.warning("26B stream failed after tokens={}: {}", got_tokens, exc)
        invalidate_network_cache()
        if got_tokens:
            yield MODEL_SWITCH_TOKEN
        else:
            logger.warning(
                "MODEL ROUTE: {} -> local profile={} ({}) reason=26B failed before first token",
                route_type,
                model_profile.name,
                _profile_local_model(model_profile),
            )

    async for token in _ollama_stream(
        prompt,
        _profile_local_model(model_profile),
        system_prompt=system_prompt,
        enable_thinking=enable_thinking,
        extra_options=ollama_options,
        image_b64=image_b64,
        lane=lane_name,
        feature=feature_name,
        route_type=route_type,
        cache_status=cache_status,
        think=model_profile.think,
        keep_alive=model_profile.keep_alive,
    ):
        yield token


async def get_active_model(preferred: str = "fast") -> str:
    if preferred == "deep":
        try:
            result = subprocess.run(
                ["ollama", "list"], capture_output=True, text=True, timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if settings.OLLAMA_MODEL_DEEP in result.stdout:
                return settings.OLLAMA_MODEL_DEEP
        except Exception:
            pass
    return settings.OLLAMA_MODEL_FAST


async def should_use_gemini() -> bool:
    """True only when not force-offline, 26B key configured, and latency is acceptable."""
    status = await get_network_status()
    return status["use_26b"]


# ──────────────────────────────────────────────────────────────
# Prompt formatting helpers
# ──────────────────────────────────────────────────────────────
def _messages_to_prompt(messages: list[dict]) -> tuple[str, str]:
    """
    Flatten OpenAI-style messages into (system_text, prompt_string).
    The prompt_string concatenates all non-system turns.
    """
    system_parts: list[str] = []
    turn_parts: list[str] = []

    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            system_parts.append(content)
        elif role in ("assistant", "model"):
            turn_parts.append(f"Assistant: {content}")
        else:
            turn_parts.append(f"User: {content}")

    return "\n\n".join(system_parts), "\n".join(turn_parts)


def _strip_thinking(text: str) -> str:
    """Remove <|channel>thought ... <channel|> blocks from model output."""
    return re.sub(r"<\|channel>thought.*?<channel\|>", "", text, flags=re.DOTALL).strip()


# ──────────────────────────────────────────────────────────────
# ToolCallEvent
# ──────────────────────────────────────────────────────────────
@dataclass
class ToolCallEvent(Exception):
    tool_name: str
    arguments: dict[str, Any]


# ──────────────────────────────────────────────────────────────
# Gemini SDK helpers (only imported when needed)
# ──────────────────────────────────────────────────────────────
def _to_genai_tool_config(tools: list[dict]) -> Any:
    from google.genai import types as genai_types

    fn_declarations = []
    for tool_def in tools:
        params = tool_def.get("parameters", {})
        props_raw = params.get("properties", {})
        required = params.get("required", [])

        schema_props: dict[str, Any] = {}
        for prop_name, prop_info in props_raw.items():
            schema_kwargs: dict[str, Any] = {
                "type": _map_type(prop_info.get("type", "string")),
                "description": prop_info.get("description", ""),
            }
            if prop_info.get("type") == "array" and "items" in prop_info:
                schema_kwargs["items"] = genai_types.Schema(
                    type=_map_type(prop_info["items"].get("type", "string"))
                )
            schema_props[prop_name] = genai_types.Schema(**schema_kwargs)

        fn_declarations.append(
            genai_types.FunctionDeclaration(
                name=tool_def["name"],
                description=tool_def.get("description", ""),
                parameters=genai_types.Schema(
                    type="OBJECT",
                    properties=schema_props,
                    required=required,
                ),
            )
        )

    return [genai_types.Tool(function_declarations=fn_declarations)]


def _map_type(type_str: str) -> str:
    return {
        "string": "STRING", "integer": "INTEGER", "number": "NUMBER",
        "boolean": "BOOLEAN", "array": "ARRAY", "object": "OBJECT",
    }.get(type_str.lower(), "STRING")


# ──────────────────────────────────────────────────────────────
# ModelClient
# ──────────────────────────────────────────────────────────────
class ModelClient:
    def __init__(self) -> None:
        self._genai_client: Any = None
        if not settings.USE_LOCAL_OLLAMA and settings.GEMMA_API_KEY:
            self._init_gemini()

    def _init_gemini(self) -> None:
        try:
            from google import genai
            self._genai_client = genai.Client(api_key=settings.GEMMA_API_KEY)
            logger.info("ModelClient: Gemini client initialised model={}", settings.GEMINI_MODEL)
        except Exception as exc:
            logger.warning("Gemini client init failed: {} — Ollama only", exc)

    # ── Public interface ───────────────────────────────────────
    # TUTOR route always uses local Ollama — trauma-aware model stays offline.
    async def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
        model_preference: str = "fast",
        enable_thinking: bool = True,
        ollama_options: dict[str, Any] | None = None,
        force_local: bool = False,
        lane: str | None = None,
        feature: str = "chat.stream",
        cache_status: str = "miss",
        profile: str | None = "tutor_fast",
    ) -> AsyncGenerator[str, None]:
        model_profile = resolve_model_profile(profile, ROUTE_TUTOR)
        lane_name = lane or model_profile.lane
        async for token in self._ollama_stream(
            messages,
            image_b64,
            model_preference,
            enable_thinking,
            ollama_options,
            lane=lane_name,
            feature=feature,
            cache_status=cache_status,
            profile=model_profile.name,
        ):
            yield token

    async def complete_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
        model_preference: str = "fast",
        ollama_options: dict[str, Any] | None = None,
        force_local: bool = False,
        lane: str | None = None,
        feature: str = "chat.complete",
        cache_status: str = "miss",
        profile: str | None = "tutor_fast",
    ) -> "ToolCallEvent | str":
        model_profile = resolve_model_profile(profile, ROUTE_TUTOR)
        lane_name = lane or model_profile.lane
        return await self._ollama_complete(
            messages,
            image_b64,
            model_preference,
            ollama_options,
            lane=lane_name,
            feature=feature,
            cache_status=cache_status,
            profile=model_profile.name,
        )

    # ── Ollama streaming (/api/chat — native multi-turn format) ─
    async def _ollama_stream(
        self,
        messages: list[dict],
        image_b64: str | None,
        preferred: str = "fast",
        enable_thinking: bool = True,
        extra_options: dict[str, Any] | None = None,
        lane: str | None = None,
        feature: str = "chat.stream",
        cache_status: str = "miss",
        profile: str | None = "tutor_fast",
    ) -> AsyncGenerator[str, None]:
        """Stream a chat response from Ollama using the /api/chat endpoint.

        Uses the native multi-turn messages format so the system prompt is
        preserved as a proper 'system' role message rather than being flattened
        into a prompt string. This ensures the hidden system prompt reaches the
        model faithfully.

        Thinking mode: Gemma 4 E2B extended thinking is enabled by default.
        Thinking tokens (<|channel>thought...</channel|>) are stripped before
        yielding to the client.
        """
        model_profile = resolve_model_profile(profile, ROUTE_TUTOR)
        model_name = await get_active_model("deep") if preferred == "deep" else _profile_local_model(model_profile)

        # Normalise role names: /api/chat expects 'assistant' not 'model'
        normalised: list[dict] = []
        for msg in messages:
            role = msg.get("role", "user")
            if role == "model":
                role = "assistant"
            entry: dict[str, Any] = {"role": role, "content": msg.get("content", "")}
            normalised.append(entry)

        opts: dict[str, Any] = {"temperature": 1.0, "top_p": 0.95, "top_k": 64}
        if extra_options:
            opts.update(extra_options)

        body: dict[str, Any] = {
            "model": model_name,
            "messages": normalised,
            "stream": True,
            "options": opts,
            "keep_alive": model_profile.keep_alive,
        }
        if model_profile.think is not None:
            body["think"] = model_profile.think

        # Attach image to the last user message when provided
        if image_b64:
            for i in range(len(body["messages"]) - 1, -1, -1):
                if body["messages"][i]["role"] == "user":
                    body["messages"][i]["images"] = [image_b64]
                    break

        url = f"{settings.OLLAMA_HOST}/api/chat"
        logger.info("Ollama /api/chat stream → model={} thinking={}", model_name, enable_thinking)

        async def request_stream() -> AsyncGenerator[str, None]:
            try:
                async with httpx.AsyncClient(timeout=_OLLAMA_TIMEOUT) as client:
                    async with client.stream("POST", url, json=body) as response:
                        response.raise_for_status()
                        buffer = ""
                        async for raw in response.aiter_lines():
                            if not raw.strip():
                                continue
                            try:
                                chunk = json.loads(raw)
                            except json.JSONDecodeError:
                                continue
                            # /api/chat response format: chunk["message"]["content"]
                            token = chunk.get("message", {}).get("content", "")
                            thinking = chunk.get("message", {}).get("thinking", "")
                            if thinking and enable_thinking and not token:
                                continue
                            if token:
                                buffer += token
                                if enable_thinking:
                                    clean = _strip_thinking(buffer)
                                    prev_clean = _strip_thinking(buffer[: -len(token)])
                                    new_portion = clean[len(prev_clean):]
                                    if new_portion:
                                        yield new_portion
                                else:
                                    yield token
                            if chunk.get("done"):
                                break
            except httpx.HTTPStatusError as exc:
                logger.error(
                    "Ollama /api/chat HTTP {} — body={}",
                    exc.response.status_code,
                    exc.response.text[:500],
                )
                raise RuntimeError(_OLLAMA_DOWN_MSG) from exc
            except (httpx.ConnectError, httpx.ConnectTimeout, ConnectionRefusedError):
                logger.error("Ollama not reachable at {} (stream)", settings.OLLAMA_HOST)
                raise RuntimeError(_OLLAMA_DOWN_MSG)
            except httpx.TimeoutException as exc:
                logger.error("Ollama stream timed out at {}: {}", settings.OLLAMA_HOST, exc)
                raise RuntimeError(_OLLAMA_TIMEOUT_MSG) from exc

        try:
            async for token in model_scheduler.stream_with_lane(
                lane=lane,
                feature=feature,
                route_type=ROUTE_TUTOR,
                input_size=sum(len(str(m.get("content", ""))) for m in normalised),
                cache_status=cache_status,
                generator_factory=request_stream,
            ):
                yield token
        except Exception as exc:
            logger.error("Ollama stream error: {}", exc)
            raise

    # ── Ollama non-streaming (/api/generate) ──────────────────
    # Kept on /api/generate for tool dispatch and quiz generation —
    # these need a flat prompt and structured JSON output, not multi-turn.
    async def _ollama_complete(
        self,
        messages: list[dict],
        image_b64: str | None,
        preferred: str = "fast",
        extra_options: dict[str, Any] | None = None,
        lane: str | None = None,
        feature: str = "chat.complete",
        cache_status: str = "miss",
        profile: str | None = "tutor_fast",
    ) -> "ToolCallEvent | str":
        model_profile = resolve_model_profile(profile, ROUTE_TUTOR)
        model_name = await get_active_model("deep") if preferred == "deep" else _profile_local_model(model_profile)
        system_text, prompt = _messages_to_prompt(messages)

        opts: dict[str, Any] = {"temperature": 1.0, "top_p": 0.95, "top_k": 64}
        if extra_options:
            opts.update(extra_options)

        body: dict[str, Any] = {
            "model": model_name,
            "prompt": prompt,
            "system": system_text,
            "stream": False,
            "options": opts,
            "keep_alive": model_profile.keep_alive,
        }
        if model_profile.think is not None:
            body["think"] = model_profile.think
        if image_b64:
            body["images"] = [image_b64]

        url = f"{settings.OLLAMA_HOST}/api/generate"
        logger.info("Ollama /api/generate complete → model={}", model_name)

        async def call() -> "ToolCallEvent | str":
            try:
                async with httpx.AsyncClient(timeout=_OLLAMA_TIMEOUT) as client:
                    response = await client.post(url, json=body)
                    response.raise_for_status()
                    data = response.json()
                    return _strip_thinking(data.get("response", ""))
            except (httpx.ConnectError, httpx.ConnectTimeout, ConnectionRefusedError) as exc:
                logger.error("Ollama not reachable at {} (complete): {}", settings.OLLAMA_HOST, exc)
                raise RuntimeError(_OLLAMA_DOWN_MSG) from exc
            except httpx.TimeoutException as exc:
                logger.error("Ollama complete timed out at {}: {}", settings.OLLAMA_HOST, exc)
                raise RuntimeError(_OLLAMA_TIMEOUT_MSG) from exc

        try:
            return await model_scheduler.run_with_lane(
                lane=lane,
                feature=feature,
                route_type=ROUTE_TUTOR,
                input_size=len(prompt) + len(system_text),
                cache_status=cache_status,
                call_factory=call,
            )
        except Exception as exc:
            logger.error("Ollama complete error: {}", exc)
            raise

    # ── Gemini streaming (online fallback) ────────────────────
    def _build_genai_contents(
        self, messages: list[dict], image_b64: str | None
    ) -> tuple[str | None, list[Any]]:
        import base64
        from google.genai import types as genai_types

        system_instruction: str | None = None
        contents: list[Any] = []
        image_attached = False

        for msg in messages:
            role = msg.get("role", "user")
            text = msg.get("content", "")
            if role == "system":
                system_instruction = text
                continue
            if role in ("assistant", "model"):
                contents.append(genai_types.Content(role="model", parts=[genai_types.Part(text=text)]))
                continue
            parts: list[Any] = [genai_types.Part(text=text)]
            if image_b64 and not image_attached:
                img_bytes = base64.b64decode(image_b64)
                parts.append(genai_types.Part(
                    inline_data=genai_types.Blob(mime_type="image/jpeg", data=img_bytes)
                ))
                image_attached = True
            contents.append(genai_types.Content(role="user", parts=parts))

        return system_instruction, contents

    async def _gemma_complete(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> "ToolCallEvent | str":
        from google.genai import types as genai_types

        if not self._genai_client:
            self._init_gemini()

        system_instruction, contents = self._build_genai_contents(messages, image_b64)
        config_kwargs: dict[str, Any] = {}
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction
        if tools:
            config_kwargs["tools"] = _to_genai_tool_config(tools)
        config = genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

        loop = asyncio.get_event_loop()

        def _call() -> Any:
            kwargs: dict[str, Any] = {"model": settings.GEMINI_MODEL, "contents": contents}
            if config:
                kwargs["config"] = config
            return self._genai_client.models.generate_content(**kwargs)

        for attempt in range(_API_MAX_RETRIES):
            try:
                response = await loop.run_in_executor(None, _call)
                for candidate in response.candidates:
                    for part in candidate.content.parts:
                        if getattr(part, "thought", False):
                            continue
                        if part.function_call:
                            fn = part.function_call
                            return ToolCallEvent(tool_name=fn.name, arguments=dict(fn.args) if fn.args else {})
                text = response.text or ""
                return _strip_thinking(text)
            except ToolCallEvent:
                raise
            except Exception as exc:
                msg = str(exc)
                is_transient = "500" in msg or "INTERNAL" in msg or "503" in msg or "UNAVAILABLE" in msg
                if is_transient and attempt < _API_MAX_RETRIES - 1:
                    delay = _API_RETRY_DELAY[attempt]
                    logger.warning("Gemini transient error (attempt {}/{}), retrying in {}s: {}", attempt + 1, _API_MAX_RETRIES, delay, exc)
                    await asyncio.sleep(delay)
                    continue
                raise
        return ""

    async def _gemma_stream(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> AsyncGenerator[str, None]:
        from google.genai import types as genai_types

        if not self._genai_client:
            self._init_gemini()

        system_instruction, contents = self._build_genai_contents(messages, image_b64)
        config_kwargs: dict[str, Any] = {}
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction
        if tools:
            config_kwargs["tools"] = _to_genai_tool_config(tools)
        config = genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

        loop = asyncio.get_event_loop()

        def _call() -> Any:
            kwargs: dict[str, Any] = {"model": settings.GEMINI_MODEL, "contents": contents}
            if config:
                kwargs["config"] = config
            return self._genai_client.models.generate_content_stream(**kwargs)

        def _call_non_stream() -> Any:
            kwargs: dict[str, Any] = {"model": settings.GEMINI_MODEL, "contents": contents}
            if config:
                kwargs["config"] = config
            return self._genai_client.models.generate_content(**kwargs)

        for attempt in range(_API_MAX_RETRIES):
            try:
                # Use non-streaming with retry, then yield the full text at once.
                # Streaming iterators surface errors mid-iteration after tokens are
                # already sent, making retry impossible. Non-streaming is safe to retry.
                response = await loop.run_in_executor(None, _call_non_stream)
                for candidate in response.candidates:
                    if not candidate.content or not candidate.content.parts:
                        continue
                    for part in candidate.content.parts:
                        if part.function_call:
                            fn = part.function_call
                            raise ToolCallEvent(tool_name=fn.name, arguments=dict(fn.args) if fn.args else {})
                        if getattr(part, "thought", False):
                            continue
                        if part.text:
                            yield part.text
                return
            except ToolCallEvent:
                raise
            except Exception as exc:
                msg = str(exc)
                is_transient = "500" in msg or "INTERNAL" in msg or "503" in msg or "UNAVAILABLE" in msg
                if is_transient and attempt < _API_MAX_RETRIES - 1:
                    delay = _API_RETRY_DELAY[attempt]
                    logger.warning("Gemini transient error (attempt {}/{}), retrying in {}s: {}", attempt + 1, _API_MAX_RETRIES, delay, exc)
                    await asyncio.sleep(delay)
                    continue
                raise


# ── Singleton ──────────────────────────────────────────────────
model_client = ModelClient()
