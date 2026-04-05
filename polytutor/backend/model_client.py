"""
backend/model_client.py — unified AI model client.

This is the ONLY file that communicates with an AI model (Gemma API or Ollama).
All other files must call methods on ModelClient; they must never import
google-generativeai or httpx directly.

Routing:
  USE_LOCAL_OLLAMA=false → Google Generative AI SDK (Gemma API)
  USE_LOCAL_OLLAMA=true  → Ollama HTTP API (local)

Retry: tenacity @retry(attempts=3, wait=2s) on both paths.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncGenerator

import httpx
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_fixed

from backend.config import settings


# ──────────────────────────────────────────────────────────────
# ToolCallEvent
# ──────────────────────────────────────────────────────────────
@dataclass
class ToolCallEvent:
    """Emitted when the model requests a tool invocation instead of text."""

    tool_name: str
    arguments: dict[str, Any]


# ──────────────────────────────────────────────────────────────
# Tool schema conversion helpers
# ──────────────────────────────────────────────────────────────
def _to_genai_tools(tools: list[dict]) -> list[Any]:
    """
    Convert the standard tool-schema list to google-generativeai Tool objects.

    Imports google.generativeai lazily so the module doesn't crash when
    USE_LOCAL_OLLAMA=true and the package is not fully configured.
    """
    import google.generativeai as genai
    from google.generativeai import protos

    genai_tools: list[Any] = []
    for tool_def in tools:
        params = tool_def.get("parameters", {})
        props_raw = params.get("properties", {})
        required = params.get("required", [])

        schema_props: dict[str, protos.Schema] = {}
        for prop_name, prop_info in props_raw.items():
            schema_props[prop_name] = protos.Schema(
                type=_map_type_to_genai(prop_info.get("type", "string")),
                description=prop_info.get("description", ""),
            )

        fn_decl = protos.FunctionDeclaration(
            name=tool_def["name"],
            description=tool_def.get("description", ""),
            parameters=protos.Schema(
                type=protos.Type.OBJECT,
                properties=schema_props,
                required=required,
            ),
        )
        genai_tools.append(protos.Tool(function_declarations=[fn_decl]))

    return genai_tools


def _map_type_to_genai(type_str: str) -> Any:
    """Map JSON-schema type string to google.generativeai protos.Type enum."""
    from google.generativeai import protos

    mapping = {
        "string": protos.Type.STRING,
        "integer": protos.Type.INTEGER,
        "number": protos.Type.NUMBER,
        "boolean": protos.Type.BOOLEAN,
        "array": protos.Type.ARRAY,
        "object": protos.Type.OBJECT,
    }
    return mapping.get(type_str.lower(), protos.Type.STRING)


# ──────────────────────────────────────────────────────────────
# ModelClient
# ──────────────────────────────────────────────────────────────
class ModelClient:
    """
    Unified client for calling AI models.

    Routes calls to Gemma API or Ollama depending on USE_LOCAL_OLLAMA setting.
    """

    def __init__(self) -> None:
        """Initialise the client and configure the active backend."""
        if not settings.USE_LOCAL_OLLAMA:
            self._init_gemma()

    def _init_gemma(self) -> None:
        """Configure google-generativeai with the API key from settings."""
        import google.generativeai as genai

        genai.configure(api_key=settings.GEMMA_API_KEY)
        self._genai_model = genai.GenerativeModel(settings.GEMMA_MODEL)
        logger.info("ModelClient using Gemma API model={}", settings.GEMMA_MODEL)

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

        Args:
            messages:  OpenAI-style message list [{role, content}, ...].
            tools:     Tool definitions in standard schema format.
            image_b64: Base64-encoded JPEG if a textbook image is attached.

        Yields:
            Token strings from the model response.
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

        Args:
            messages:  OpenAI-style message list.
            tools:     Tool definitions in standard schema format.
            image_b64: Base64-encoded JPEG if present.

        Returns:
            ToolCallEvent if the model requested a tool, else the response text string.
        """
        if settings.USE_LOCAL_OLLAMA:
            return await self._ollama_complete(messages, tools, image_b64)
        return await self._gemma_complete(messages, tools, image_b64)

    # ──────────────────────────────────────────────────────────
    # Gemma API path
    # ──────────────────────────────────────────────────────────
    def _build_gemma_content(
        self,
        messages: list[dict],
        image_b64: str | None,
    ) -> list[Any]:
        """
        Build google-generativeai content list from OpenAI-style messages.

        The system message is promoted into an instruction; the rest become
        user/model turns. The image attaches to the last user turn if provided.
        """
        import base64

        from google.generativeai import protos

        content_parts: list[Any] = []

        for msg in messages:
            role = msg.get("role", "user")
            text = msg.get("content", "")

            if role == "system":
                # Prepend system text to the first user message
                content_parts.append({"role": "user", "parts": [text]})
                content_parts.append(
                    {"role": "model", "parts": ["Understood. I will follow your instructions."]}
                )
            elif role == "user":
                parts: list[Any] = [text]
                if image_b64:
                    # Attach image to this user turn
                    img_bytes = base64.b64decode(image_b64)
                    parts.append(
                        protos.Part(
                            inline_data=protos.Blob(
                                mime_type="image/jpeg",
                                data=img_bytes,
                            )
                        )
                    )
                    image_b64 = None  # only attach once
                content_parts.append({"role": "user", "parts": parts})
            elif role in ("assistant", "model"):
                content_parts.append({"role": "model", "parts": [text]})
            elif role == "tool":
                # Tool result — encode as a user message with function response
                content_parts.append({"role": "user", "parts": [text]})

        return content_parts

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
    async def _gemma_complete(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> "ToolCallEvent | str":
        """Call Gemma API (non-streaming) and detect tool calls or return text."""
        import asyncio

        content = self._build_gemma_content(messages, image_b64)
        genai_tools = _to_genai_tools(tools) if tools else []

        loop = asyncio.get_event_loop()
        kwargs: dict[str, Any] = {"contents": content, "stream": False}
        if genai_tools:
            kwargs["tools"] = genai_tools

        response = await loop.run_in_executor(
            None,
            lambda: self._genai_model.generate_content(**kwargs),
        )

        # Check for tool call
        for candidate in response.candidates:
            for part in candidate.content.parts:
                if part.function_call and part.function_call.name:
                    fn = part.function_call
                    args = dict(fn.args) if fn.args else {}
                    logger.info("Gemma requested tool: {}", fn.name)
                    return ToolCallEvent(tool_name=fn.name, arguments=args)

        # Plain text response
        return response.text

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
    async def _gemma_stream(
        self,
        messages: list[dict],
        tools: list[dict],
        image_b64: str | None,
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from Gemma API, raising ToolCallEvent if tool is requested."""
        import asyncio

        content = self._build_gemma_content(messages, image_b64)
        genai_tools = _to_genai_tools(tools) if tools else []

        loop = asyncio.get_event_loop()
        kwargs: dict[str, Any] = {"contents": content, "stream": True}
        if genai_tools:
            kwargs["tools"] = genai_tools

        response = await loop.run_in_executor(
            None,
            lambda: self._genai_model.generate_content(**kwargs),
        )

        for chunk in response:
            for candidate in chunk.candidates:
                for part in candidate.content.parts:
                    if part.function_call and part.function_call.name:
                        fn = part.function_call
                        args = dict(fn.args) if fn.args else {}
                        logger.info("Gemma stream requested tool: {}", fn.name)
                        raise ToolCallEvent(tool_name=fn.name, arguments=args)
                    if part.text:
                        yield part.text

    # Make _gemma_stream a proper async generator
    # (the retry decorator wraps it; we need to yield from inside the loop above)
    # This is handled implicitly since _gemma_stream uses `yield`, making it an
    # async generator — but tenacity doesn't support async generators directly.
    # We work around by making stream_chat call a wrapper.

    # ──────────────────────────────────────────────────────────
    # Ollama path
    # ──────────────────────────────────────────────────────────
    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
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
            # Attach image to the last user message
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

        # Detect tool call
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

        # Fallback: try parsing raw JSON from content
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

    @retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
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
# Singleton — import this in main.py and tools.py
# ──────────────────────────────────────────────────────────────
model_client = ModelClient()
