"""
app/services/model_client.py — unified AI model client.

Routing:
  USE_LOCAL_OLLAMA=true  → always use Ollama (offline-first)
  USE_LOCAL_OLLAMA=false → check internet; if online use Gemini API,
                           if offline fall back to Ollama automatically

Ollama path uses /api/generate (native GGUF format).
Messages arrays are flattened to a single prompt string before sending.

Gemini path uses google-genai SDK for online fallback.
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
from dataclasses import dataclass
from typing import Any, AsyncGenerator

import httpx
from loguru import logger

from app.core.config import settings


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


async def get_active_model(preferred: str = "fast") -> str:
    if preferred == "deep":
        try:
            result = subprocess.run(
                ["ollama", "list"], capture_output=True, text=True, timeout=5
            )
            if settings.OLLAMA_MODEL_DEEP in result.stdout:
                return settings.OLLAMA_MODEL_DEEP
        except Exception:
            pass
    return settings.OLLAMA_MODEL_FAST


async def should_use_gemini() -> bool:
    """True only when USE_LOCAL_OLLAMA=false AND internet is reachable."""
    if settings.USE_LOCAL_OLLAMA:
        return False
    return await check_connectivity()


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
    async def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
        model_preference: str = "fast",
        enable_thinking: bool = True,
        ollama_options: dict[str, Any] | None = None,
    ) -> AsyncGenerator[str, None]:
        if await should_use_gemini():
            async for token in self._gemma_stream(messages, tools, image_b64):
                yield token
        else:
            async for token in self._ollama_stream(
                messages, image_b64, model_preference, enable_thinking, ollama_options
            ):
                yield token

    async def complete_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
        model_preference: str = "fast",
        ollama_options: dict[str, Any] | None = None,
    ) -> "ToolCallEvent | str":
        if await should_use_gemini():
            return await self._gemma_complete(messages, tools, image_b64)
        return await self._ollama_complete(messages, image_b64, model_preference, ollama_options)

    # ── Ollama streaming (/api/generate) ──────────────────────
    async def _ollama_stream(
        self,
        messages: list[dict],
        image_b64: str | None,
        preferred: str = "fast",
        enable_thinking: bool = True,
        extra_options: dict[str, Any] | None = None,
    ) -> AsyncGenerator[str, None]:
        enable_thinking = True
        model_name = await get_active_model(preferred)
        system_text, prompt = _messages_to_prompt(messages)

        if enable_thinking:
            system_text = "<|think|>\n" + system_text if system_text else "<|think|>"

        opts: dict[str, Any] = {"temperature": 1.0, "top_p": 0.95, "top_k": 64}
        if extra_options:
            opts.update(extra_options)

        body: dict[str, Any] = {
            "model": model_name,
            "prompt": prompt,
            "system": system_text,
            "stream": True,
            "options": opts,
            "keep_alive": "60m",
        }
        if image_b64:
            body["images"] = [image_b64]

        url = f"{settings.OLLAMA_HOST}/api/generate"
        logger.info("Ollama stream → model={} thinking={}", model_name, enable_thinking)

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=5.0)
            ) as client:
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
                        token = chunk.get("response", "")
                        if token:
                            buffer += token
                            # Strip thinking blocks before yielding
                            if enable_thinking:
                                clean = _strip_thinking(buffer)
                                # Only yield the newly added clean portion
                                yield clean[len(_strip_thinking(buffer[:-len(token)])):]
                            else:
                                yield token
                        if chunk.get("done"):
                            break
        except httpx.ConnectError:
            logger.error("Ollama not reachable at {}", settings.OLLAMA_HOST)
        except Exception as exc:
            logger.error("Ollama stream error: {}", exc)

    # ── Ollama non-streaming (/api/generate) ──────────────────
    async def _ollama_complete(
        self,
        messages: list[dict],
        image_b64: str | None,
        preferred: str = "fast",
        extra_options: dict[str, Any] | None = None,
    ) -> "ToolCallEvent | str":
        model_name = await get_active_model(preferred)
        system_text, prompt = _messages_to_prompt(messages)
        system_text = "<|think|>\n" + system_text if system_text else "<|think|>"

        opts: dict[str, Any] = {"temperature": 1.0, "top_p": 0.95, "top_k": 64}
        if extra_options:
            opts.update(extra_options)

        body: dict[str, Any] = {
            "model": model_name,
            "prompt": prompt,
            "system": system_text,
            "stream": False,
            "options": opts,
            "keep_alive": "60m",
        }
        if image_b64:
            body["images"] = [image_b64]

        url = f"{settings.OLLAMA_HOST}/api/generate"
        logger.info("Ollama complete → model={} thinking=True", model_name)

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=5.0)
            ) as client:
                response = await client.post(url, json=body)
                response.raise_for_status()
                data = response.json()
                return _strip_thinking(data.get("response", ""))
        except Exception as exc:
            logger.error("Ollama complete error: {}", exc)
            return ""

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

        response = await loop.run_in_executor(None, _call)

        for candidate in response.candidates:
            for part in candidate.content.parts:
                if part.function_call:
                    fn = part.function_call
                    return ToolCallEvent(tool_name=fn.name, arguments=dict(fn.args) if fn.args else {})

        return response.text or ""

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

        stream = await loop.run_in_executor(None, _call)

        for chunk in stream:
            if not chunk.candidates:
                continue
            for candidate in chunk.candidates:
                if not candidate.content or not candidate.content.parts:
                    continue
                for part in candidate.content.parts:
                    if part.function_call:
                        fn = part.function_call
                        raise ToolCallEvent(tool_name=fn.name, arguments=dict(fn.args) if fn.args else {})
                    if part.text:
                        yield part.text


# ── Singleton ──────────────────────────────────────────────────
model_client = ModelClient()
