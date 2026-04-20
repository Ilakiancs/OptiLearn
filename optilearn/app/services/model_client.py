"""
app/services/model_client.py — unified AI model client.

This is the ONLY file that communicates with an AI model (Gemma API or Ollama).
All other files must call methods on ModelClient; they must never import
google-genai or httpx directly.

Routing:
  USE_LOCAL_OLLAMA=false → google-genai SDK (Gemma / Gemini API)
  USE_LOCAL_OLLAMA=true  → Ollama HTTP API (local)

Retry: tenacity @retry(attempts=3, wait=2s) on both paths.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncGenerator

import httpx
from loguru import logger
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_fixed


def _is_retryable(exc: BaseException) -> bool:
    """Only retry on transient network errors, not quota/auth failures."""
    msg = str(exc).lower()
    if "429" in msg or "quota" in msg or "resource_exhausted" in msg:
        return False
    if "401" in msg or "403" in msg or "api_key" in msg or "permission" in msg:
        return False
    return True

from app.core.config import settings


# ──────────────────────────────────────────────────────────────
# ToolCallEvent
# ──────────────────────────────────────────────────────────────
@dataclass
class ToolCallEvent(Exception):
    """Emitted when the model requests a tool invocation instead of text.

    Inherits from Exception so it can be raised from async generators.
    """

    tool_name: str
    arguments: dict[str, Any]


# ──────────────────────────────────────────────────────────────
# Tool schema conversion helpers (google-genai SDK)
# ──────────────────────────────────────────────────────────────
def _to_genai_tool_config(tools: list[dict]) -> Any:
    """
    Convert the standard tool-schema list to google.genai types.Tool objects.

    Lazily imports google.genai so the module doesn't crash when
    USE_LOCAL_OLLAMA=true.
    """
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
            # Array properties require an 'items' schema
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
    """Map JSON-schema type string to google-genai Schema type string."""
    mapping = {
        "string": "STRING",
        "integer": "INTEGER",
        "number": "NUMBER",
        "boolean": "BOOLEAN",
        "array": "ARRAY",
        "object": "OBJECT",
    }
    return mapping.get(type_str.lower(), "STRING")


# ──────────────────────────────────────────────────────────────
# ModelClient
# ──────────────────────────────────────────────────────────────
class ModelClient:
    """
    Unified client for calling AI models.

    Routes calls to Gemma/Gemini API or Ollama depending on USE_LOCAL_OLLAMA setting.
    """

    def __init__(self) -> None:
        """Initialise the appropriate backend client."""
        if not settings.USE_LOCAL_OLLAMA:
            self._init_gemma()

    def _init_gemma(self) -> None:
        """Configure google-genai client with the API key from settings."""
        from google import genai

        self._genai_client = genai.Client(api_key=settings.GEMMA_API_KEY)
        logger.info("ModelClient using Gemma/Gemini API model={}", settings.GEMMA_MODEL)

    # ──────────────────────────────────────────────────────────
    # Public interface
    # ──────────────────────────────────────────────────────────
    async def stream_chat(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> AsyncGenerator[str, None]:
        """
        Stream a chat response, yielding token strings.

        If the model emits a tool call, raises ToolCallEvent instead of yielding.
        """
        if settings.USE_LOCAL_OLLAMA:
            async for token in self._ollama_stream(messages, tools, image_b64):
                yield token
        else:
            async for token in self._gemma_stream(messages, tools, image_b64):
                yield token

    async def complete_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> "ToolCallEvent | str":
        """
        Call the model and return either a ToolCallEvent or a full text string.
        """
        if settings.USE_LOCAL_OLLAMA:
            return await self._ollama_complete(messages, tools, image_b64)
        return await self._gemma_complete(messages, tools, image_b64)

    # ──────────────────────────────────────────────────────────
    # Gemma / Gemini API path (google-genai SDK)
    # ──────────────────────────────────────────────────────────
    def _build_genai_contents(
        self,
        messages: list[dict],
        image_b64: str | None,
    ) -> tuple[str | None, list[Any]]:
        """
        Convert OpenAI-style messages to google-genai contents format.

        Returns (system_instruction, contents_list).
        The system message is extracted separately; all other messages
        become contents entries with role 'user' or 'model'.
        """
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

            # user / tool messages
            parts: list[Any] = [genai_types.Part(text=text)]
            if image_b64 and not image_attached:
                img_bytes = base64.b64decode(image_b64)
                parts.append(
                    genai_types.Part(
                        inline_data=genai_types.Blob(mime_type="image/jpeg", data=img_bytes)
                    )
                )
                image_attached = True
            contents.append(genai_types.Content(role="user", parts=parts))

        return system_instruction, contents

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2), retry=retry_if_exception(_is_retryable))
    async def _gemma_complete(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> "ToolCallEvent | str":
        """Call Gemma/Gemini API (non-streaming) and detect tool calls or return text."""
        import asyncio

        from google.genai import types as genai_types

        system_instruction, contents = self._build_genai_contents(messages, image_b64)

        config_kwargs: dict[str, Any] = {}
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction
        if tools:
            config_kwargs["tools"] = _to_genai_tool_config(tools)

        config = genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

        loop = asyncio.get_event_loop()

        def _call() -> Any:
            kwargs: dict[str, Any] = {
                "model": settings.GEMMA_MODEL,
                "contents": contents,
            }
            if config:
                kwargs["config"] = config
            return self._genai_client.models.generate_content(**kwargs)

        response = await loop.run_in_executor(None, _call)

        # Check for function/tool calls
        for candidate in response.candidates:
            for part in candidate.content.parts:
                if part.function_call:
                    fn = part.function_call
                    args = dict(fn.args) if fn.args else {}
                    logger.info("Gemma requested tool: {}", fn.name)
                    return ToolCallEvent(tool_name=fn.name, arguments=args)

        return response.text or ""

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2), retry=retry_if_exception(_is_retryable))
    async def _gemma_stream(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from Gemma API, raising ToolCallEvent if tool is requested."""
        import asyncio

        from google.genai import types as genai_types

        system_instruction, contents = self._build_genai_contents(messages, image_b64)

        config_kwargs: dict[str, Any] = {}
        if system_instruction:
            config_kwargs["system_instruction"] = system_instruction
        if tools:
            config_kwargs["tools"] = _to_genai_tool_config(tools)

        config = genai_types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

        loop = asyncio.get_event_loop()

        def _call() -> Any:
            kwargs: dict[str, Any] = {
                "model": settings.GEMMA_MODEL,
                "contents": contents,
            }
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
                        args = dict(fn.args) if fn.args else {}
                        logger.info("Gemma stream requested tool: {}", fn.name)
                        raise ToolCallEvent(tool_name=fn.name, arguments=args)
                    if part.text:
                        yield part.text

    # ──────────────────────────────────────────────────────────
    # Ollama path
    # ──────────────────────────────────────────────────────────
    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2), retry=retry_if_exception(_is_retryable))
    async def _ollama_complete(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> "ToolCallEvent | str":
        """Call Ollama /api/chat (non-streaming) and detect tool calls or return text."""
        body: dict[str, Any] = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
        }
        if tools:
            body["tools"] = tools
        if image_b64:
            body["messages"] = list(messages)
            for i in range(len(body["messages"]) - 1, -1, -1):
                if body["messages"][i]["role"] == "user":
                    msg = dict(body["messages"][i])
                    msg["images"] = [image_b64]
                    body["messages"][i] = msg
                    break

        url = f"{settings.OLLAMA_HOST}/api/chat"
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, json=body)
            response.raise_for_status()
            data = response.json()

        message = data.get("message", {})

        tool_calls = message.get("tool_calls")
        if tool_calls:
            first = tool_calls[0]
            fn = first.get("function", {})
            tool_name = fn.get("name", "")
            arguments = fn.get("arguments", {})
            if isinstance(arguments, str):
                arguments = json.loads(arguments)
            logger.info("Ollama requested tool: {}", tool_name)
            return ToolCallEvent(tool_name=tool_name, arguments=arguments)

        content = message.get("content", "")

        if content.strip().startswith("{"):
            try:
                parsed = json.loads(content)
                tool_name = parsed.get("tool") or parsed.get("name")
                arguments = parsed.get("arguments") or parsed.get("parameters", {})
                if tool_name:
                    return ToolCallEvent(tool_name=tool_name, arguments=arguments)
            except json.JSONDecodeError:
                pass

        return content

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2), retry=retry_if_exception(_is_retryable))
    async def _ollama_stream(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from Ollama /api/chat, raising ToolCallEvent if tool requested."""
        body: dict[str, Any] = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": True,
        }
        if tools:
            body["tools"] = tools
        if image_b64:
            body["messages"] = list(messages)
            for i in range(len(body["messages"]) - 1, -1, -1):
                if body["messages"][i]["role"] == "user":
                    msg = dict(body["messages"][i])
                    msg["images"] = [image_b64]
                    body["messages"][i] = msg
                    break

        url = f"{settings.OLLAMA_HOST}/api/chat"
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("POST", url, json=body) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    message = chunk.get("message", {})
                    tool_calls = message.get("tool_calls")
                    if tool_calls:
                        first = tool_calls[0]
                        fn = first.get("function", {})
                        tool_name = fn.get("name", "")
                        arguments = fn.get("arguments", {})
                        if isinstance(arguments, str):
                            arguments = json.loads(arguments)
                        logger.info("Ollama stream requested tool: {}", tool_name)
                        raise ToolCallEvent(tool_name=tool_name, arguments=arguments)

                    content = message.get("content", "")
                    if content:
                        yield content

                    if chunk.get("done"):
                        break


# ──────────────────────────────────────────────────────────────
# Singleton — import this in routes and tools
# ──────────────────────────────────────────────────────────────
model_client = ModelClient()
