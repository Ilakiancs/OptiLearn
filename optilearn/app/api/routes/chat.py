"""
app/api/routes/chat.py — SSE streaming chat endpoint and image upload.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import traceback
from typing import Any, AsyncGenerator

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from loguru import logger
from PIL import Image

from app.core.config import settings
from app.core.prompts import build_system_prompt
from app.models.schemas import ChatRequest
from app.services import context_prep, db
from app.services.model_client import ToolCallEvent, model_client
from app.tools.agent_tools import TOOL_SCHEMAS, detect_language, generate_quiz, retrieve_curriculum, update_progress

router = APIRouter(prefix="/api", tags=["chat"])


# ──────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────
async def _dispatch_tool(tool_name: str, arguments: dict) -> Any:
    """Dispatch a ToolCallEvent to the corresponding tool function."""
    dispatch_map = {
        "detect_language": detect_language,
        "retrieve_curriculum": retrieve_curriculum,
        "generate_quiz": generate_quiz,
        "update_progress": update_progress,
    }
    fn = dispatch_map.get(tool_name)
    if fn is None:
        raise ValueError(f"Unknown tool '{tool_name}'")
    return await fn(**arguments)


def _sse(event: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(event)}\n\n"


def _should_plan_tools(message: str, has_image: bool = False) -> bool:
    """Only spend a planning generation when a tool is likely useful."""
    if has_image:
        return False
    text = (message or "").lower()
    tool_keywords = {
        "quiz", "quick check", "test me", "practice questions",
        "progress", "mastery", "score", "how am i doing",
        "curriculum", "lesson from", "look up", "retrieve",
        "what language", "detect language",
    }
    return any(keyword in text for keyword in tool_keywords)


# ──────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────
@router.post("/upload-image")
async def upload_image(file: UploadFile = File(...)) -> dict:
    """
    Accept a multipart image upload, resize to IMAGE_MAX_PX, and return base64 JPEG.

    Max upload size: 10 MB.
    """
    MAX_BYTES = 10 * 1024 * 1024

    raw_bytes = await file.read()
    if len(raw_bytes) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum allowed size is 10 MB.")

    try:
        image = Image.open(io.BytesIO(raw_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {exc}") from exc

    image = image.convert("RGB")

    max_px = settings.IMAGE_MAX_PX
    w, h = image.size
    if max(w, h) > max_px:
        ratio = max_px / max(w, h)
        image = image.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("utf-8")

    del raw_bytes, image, buf

    logger.info("Image uploaded and encoded ({} bytes b64)", len(encoded))
    return {"image_b64": encoded}


@router.post("/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    """
    Core SSE streaming chat endpoint.

    Accepts a student message (and optional image), calls the model, dispatches
    any tool calls, and streams SSE events back to the client.
    """

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            student = await db.get_student(body.student_id)
            if student is None:
                yield _sse({"type": "error", "message": f"Student '{body.student_id}' not found."})
                return

            await db.update_last_active(body.student_id)

            mastery = await db.get_student_mastery(body.student_id)
            selected_language = body.language or student.get("language") or "en"
            system_prompt = build_system_prompt(student, mastery, selected_language)
            model_preference = body.model_preference or "fast"
            saved_history = await db.get_session_messages(body.session_id)
            recent_history = context_prep.select_chat_history(saved_history, body.message)

            await db.add_message(body.session_id, "user", body.message)
            assistant_parts: list[str] = []

            messages: list[dict] = [
                {"role": "system", "content": system_prompt},
                *recent_history,
                {"role": "user", "content": body.message},
            ]

            result: ToolCallEvent | str = ""
            if _should_plan_tools(body.message, bool(body.image_b64)):
                try:
                    result = await asyncio.wait_for(
                        model_client.complete_with_tools(
                            messages=messages,
                            tools=TOOL_SCHEMAS,
                            image_b64=body.image_b64,
                            model_preference=model_preference,
                            ollama_options={"num_ctx": 4096, "num_predict": 128},
                            lane="student_chat",
                            feature="chat.tool_planning",
                            profile="tutor_fast",
                        ),
                        timeout=12,
                    )
                except (asyncio.TimeoutError, RuntimeError) as exc:
                    logger.warning("Tool planning skipped; streaming tutor answer directly: {}", exc)
                    result = ""

            if not result:
                result = ""
                async for token in model_client.stream_chat(
                    messages=messages,
                    tools=[],
                    image_b64=body.image_b64,
                    model_preference=model_preference,
                    enable_thinking=False,
                    ollama_options={"num_ctx": 4096, "num_predict": 384},
                    lane="student_chat",
                    feature="chat.direct_stream",
                    profile="tutor_fast",
                ):
                    assistant_parts.append(token)
                    yield _sse({"type": "token", "content": token})

            if isinstance(result, ToolCallEvent):
                yield _sse({"type": "tool_start", "tool": result.tool_name})

                tool_result = await _dispatch_tool(result.tool_name, result.arguments)
                await db.add_message(
                    body.session_id,
                    "tool",
                    json.dumps(tool_result, ensure_ascii=False),
                    tool_name=result.tool_name,
                )

                yield _sse({"type": "tool_done", "tool": result.tool_name, "result": tool_result})

                messages.append(
                    {
                        "role": "assistant",
                        "content": f"[Called tool '{result.tool_name}' with args: {json.dumps(result.arguments)}]",
                    }
                )
                messages.append({"role": "tool", "content": json.dumps(tool_result)})

                try:
                    async for token in model_client.stream_chat(
                        messages=messages,
                        tools=TOOL_SCHEMAS,
                        image_b64=None,
                        model_preference=model_preference,
                        lane="student_chat",
                        feature="chat.tool_followup",
                        profile="tutor_fast",
                    ):
                        assistant_parts.append(token)
                        yield _sse({"type": "token", "content": token})
                except ToolCallEvent as nested_tool:
                    yield _sse({"type": "tool_start", "tool": nested_tool.tool_name})
                    nested_result = await _dispatch_tool(nested_tool.tool_name, nested_tool.arguments)
                    await db.add_message(
                        body.session_id,
                        "tool",
                        json.dumps(nested_result, ensure_ascii=False),
                        tool_name=nested_tool.tool_name,
                    )
                    yield _sse({"type": "tool_done", "tool": nested_tool.tool_name, "result": nested_result})

            else:
                # Non-streamed response (e.g. Gemini tool path returned a plain string).
                # Emit the entire text as one token chunk to avoid word-splitting artifacts.
                if result:
                    assistant_parts.append(result)
                    yield _sse({"type": "token", "content": result})

            yield _sse({"type": "done"})

            assistant_text = "".join(assistant_parts).strip()
            if assistant_text:
                await db.add_message(body.session_id, "assistant", assistant_text)
            await db.increment_message_count(body.session_id)

        except RuntimeError as exc:
            # RuntimeError is raised by model_client for Ollama-down scenarios
            # so the user sees a clear, actionable message.
            msg = str(exc)
            logger.warning("RuntimeError in chat endpoint: {}", msg)
            yield _sse({"type": "error", "message": msg})
        except Exception as exc:
            logger.error("Chat endpoint error: {}\n{}", exc, traceback.format_exc())
            msg = str(exc)
            if "429" in msg or "quota" in msg or "RESOURCE_EXHAUSTED" in msg:
                friendly = "API quota reached. Wait a minute, then continue, or check your Google AI Studio usage limits."
            elif "401" in msg or "403" in msg or "API_KEY" in msg.upper():
                friendly = "API key is invalid or missing. Check GEMMA_API_KEY in your .env file."
            elif "ConnectionRefused" in msg or "ConnectError" in msg or "11434" in msg:
                friendly = "The local AI model is not running. Please start Ollama, then continue."
            elif "500" in msg or "INTERNAL" in msg or "503" in msg or "UNAVAILABLE" in msg:
                friendly = "The AI service is temporarily busy. Please continue in a moment."
            else:
                friendly = "The request could not be completed right now. Please continue in a moment."
            yield _sse({"type": "error", "message": friendly})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
