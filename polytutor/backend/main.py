"""
backend/main.py — FastAPI application with all API routes.

Architecture:
  - Lifespan context manager handles startup (DB init) and shutdown.
  - Static React build is mounted at root if FRONTEND_DIST exists.
  - POST /api/chat is the core SSE streaming endpoint.
"""
from __future__ import annotations

import base64
import io
import json
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from PIL import Image
from pydantic import BaseModel, Field

from backend import db, tools
from backend.config import settings
from backend.model_client import ToolCallEvent, model_client


# ──────────────────────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """FastAPI lifespan: startup and shutdown hooks."""
    # Startup
    logger.info("PolyTutor starting up…")
    await db.init_db()
    logger.info("Server ready on http://{}:{}", settings.HOST, settings.PORT)
    yield
    # Shutdown
    logger.info("PolyTutor shutting down gracefully.")


# ──────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="PolyTutor API",
    description="Offline-first multilingual adaptive learning agent for refugee classrooms.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount frontend static build if it exists
_frontend_path = Path(settings.FRONTEND_DIST)
if _frontend_path.exists() and _frontend_path.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_path), html=True), name="frontend")
    logger.info("Frontend mounted from {}", _frontend_path)
else:
    logger.warning(
        "Frontend dist directory '{}' not found — API-only mode. "
        "Run 'npm run build' in /frontend to serve the UI.",
        _frontend_path,
    )


# ──────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────
class CreateStudentRequest(BaseModel):
    """Request body for POST /api/students."""

    name: str = Field(..., min_length=1, max_length=200)
    age: int | None = Field(default=None, ge=3, le=100)
    language: str = Field(default="en", min_length=2, max_length=10)
    grade_level: int = Field(default=1, ge=1, le=12)


class CreateSessionRequest(BaseModel):
    """Request body for POST /api/sessions."""

    student_id: str


class ChatRequest(BaseModel):
    """Request body for POST /api/chat."""

    student_id: str
    session_id: str
    message: str
    image_b64: str | None = None


class QuizAnswer(BaseModel):
    """A single quiz answer submitted by the student."""

    question_id: str
    answer: str
    correct_answer: str


class SubmitQuizRequest(BaseModel):
    """Request body for POST /api/quiz/submit."""

    student_id: str
    session_id: str
    topic: str
    answers: list[QuizAnswer]


# ──────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────
def _build_system_prompt(student: dict, mastery: list[dict]) -> str:
    """
    Construct the system prompt injected at the start of every chat conversation.

    Args:
        student: Student record dict.
        mastery: List of topic mastery dicts.

    Returns:
        Formatted system prompt string.
    """
    mastery_summary = ", ".join(
        f"{m['topic']} ({m['level']}, {m['mastery']:.0%})" for m in mastery
    ) or "no prior topics assessed"

    return (
        f"You are a patient, encouraging tutor. The student's name is {student['name']}. "
        f"They are {student.get('age', 'unknown age')} years old, "
        f"studying at grade {student['grade_level']} level. "
        f"Their primary language is {student['language']} — always respond in {student['language']}. "
        f"Their current topic mastery: {mastery_summary}.\n\n"
        "Your teaching approach:\n"
        "- Never give answers directly. Guide the student with questions.\n"
        "- If they struggle, try a different explanation or analogy.\n"
        "- Never use the words 'wrong' or 'incorrect'. Say 'not quite' or 'let's try again'.\n"
        "- Keep explanations concise — 3 to 5 sentences maximum.\n"
        "- After explaining a concept, always call the quiz_generator tool.\n"
        "- When you detect the student's language from their message, call language_detector.\n"
        "- When a concept needs curriculum grounding, call retrieve_curriculum first.\n"
        "- After a quiz is submitted and scored, call update_progress."
    )


async def _dispatch_tool(
    tool_name: str,
    arguments: dict,
) -> Any:
    """
    Dispatch a ToolCallEvent to the corresponding tool function.

    Args:
        tool_name:  Name of the tool as returned by the model.
        arguments:  Arguments dict from the model.

    Returns:
        Tool result (dict or list).

    Raises:
        ValueError: If the tool_name is not recognised.
    """
    dispatch_map = {
        "detect_language": tools.detect_language,
        "retrieve_curriculum": tools.retrieve_curriculum,
        "generate_quiz": tools.generate_quiz,
        "update_progress": tools.update_progress,
    }
    fn = dispatch_map.get(tool_name)
    if fn is None:
        raise ValueError(f"Unknown tool '{tool_name}'")
    return await fn(**arguments)


def _sse(event: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(event)}\n\n"


# ──────────────────────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────────────────────
@app.post("/api/students")
async def create_student(body: CreateStudentRequest) -> dict:
    """
    Create a new student record.

    Returns the created student dict.
    """
    student = await db.create_student(
        name=body.name,
        age=body.age,
        language=body.language,
        grade_level=body.grade_level,
    )
    return student


@app.get("/api/students")
async def list_students() -> list[dict]:
    """
    Return all students with their latest mastery summary.
    """
    return await db.get_all_students()


@app.get("/api/students/{student_id}")
async def get_student(student_id: str) -> dict:
    """
    Return a single student's record plus full topic_mastery list.

    Raises 404 if not found.
    """
    student = await db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    mastery = await db.get_student_mastery(student_id)
    student["topic_mastery"] = mastery
    return student


@app.post("/api/sessions")
async def create_session(body: CreateSessionRequest) -> dict:
    """
    Start a new learning session for a student.

    Returns the created session dict.
    """
    student = await db.get_student(body.student_id)
    if student is None:
        raise HTTPException(status_code=404, detail=f"Student '{body.student_id}' not found.")
    session = await db.create_session(body.student_id)
    return session


@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)) -> dict:
    """
    Accept a multipart image upload, resize to IMAGE_MAX_PX, and return base64 JPEG.

    Max upload size: 10 MB. File is deleted from memory immediately after encoding.
    """
    MAX_BYTES = 10 * 1024 * 1024  # 10 MB

    raw_bytes = await file.read()
    if len(raw_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum allowed size is 10 MB.",
        )

    try:
        image = Image.open(io.BytesIO(raw_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Cannot open image: {exc}") from exc

    # Convert to RGB (handles PNG with alpha, etc.)
    image = image.convert("RGB")

    # Resize so longest side ≤ IMAGE_MAX_PX
    max_px = settings.IMAGE_MAX_PX
    w, h = image.size
    if max(w, h) > max_px:
        ratio = max_px / max(w, h)
        image = image.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    # Encode to JPEG base64
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    encoded = base64.b64encode(buf.read()).decode("utf-8")

    # Explicit cleanup — release memory immediately
    del raw_bytes, image, buf

    logger.info("Image uploaded and encoded ({} bytes b64)", len(encoded))
    return {"image_b64": encoded}


@app.post("/api/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    """
    Core SSE streaming chat endpoint.

    Accepts a student message (and optional image), calls the model, dispatches
    any tool calls, and streams SSE events back to the client.
    """

    async def event_stream() -> AsyncGenerator[str, None]:
        """Inner async generator producing SSE events."""
        try:
            # 1. Load student
            student = await db.get_student(body.student_id)
            if student is None:
                yield _sse({"type": "error", "message": f"Student '{body.student_id}' not found."})
                return

            # 2. Update last_active
            await db.update_last_active(body.student_id)

            # 3. Build system prompt
            mastery = await db.get_student_mastery(body.student_id)
            system_prompt = _build_system_prompt(student, mastery)

            # 4. Build message history (single-turn for Phase 1)
            messages: list[dict] = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": body.message},
            ]

            # 5. Initial model call
            result = await model_client.complete_with_tools(
                messages=messages,
                tools=tools.TOOL_SCHEMAS,
                image_b64=body.image_b64,
            )

            # 6. Handle response
            if isinstance(result, ToolCallEvent):
                # a. Emit tool_start
                yield _sse({"type": "tool_start", "tool": result.tool_name})

                # b. Execute tool
                tool_result = await _dispatch_tool(result.tool_name, result.arguments)

                # c. Emit tool_done
                yield _sse({"type": "tool_done", "tool": result.tool_name, "result": tool_result})

                # d. Append tool result to history
                messages.append(
                    {
                        "role": "assistant",
                        "content": f"[Called tool '{result.tool_name}' with args: {json.dumps(result.arguments)}]",
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "content": json.dumps(tool_result),
                    }
                )

                # e. Stream continuation from model
                try:
                    async for token in model_client.stream_chat(
                        messages=messages,
                        tools=tools.TOOL_SCHEMAS,
                        image_b64=None,
                    ):
                        yield _sse({"type": "token", "content": token})
                except ToolCallEvent as nested_tool:
                    # Handle nested tool call if model calls another tool during stream
                    yield _sse({"type": "tool_start", "tool": nested_tool.tool_name})
                    nested_result = await _dispatch_tool(nested_tool.tool_name, nested_tool.arguments)
                    yield _sse({"type": "tool_done", "tool": nested_tool.tool_name, "result": nested_result})

            else:
                # Direct text response — simulate streaming word-by-word
                for word in result.split(" "):
                    yield _sse({"type": "token", "content": word + " "})

            # 7. Done event
            yield _sse({"type": "done"})

            # 8. Increment session message count
            await db.increment_message_count(body.session_id)

        except Exception as exc:
            logger.error("Chat endpoint error: {}\n{}", exc, traceback.format_exc())
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/quiz/submit")
async def submit_quiz(body: SubmitQuizRequest) -> dict:
    """
    Score submitted quiz answers, persist results, and update mastery.

    Returns: {score, new_level, mastery, results}
    """
    results: list[dict] = []
    correct_count = 0

    for answer in body.answers:
        is_correct = answer.answer.strip().lower() == answer.correct_answer.strip().lower()
        if is_correct:
            correct_count += 1

        record = await db.record_quiz_result(
            student_id=body.student_id,
            session_id=body.session_id,
            topic=body.topic,
            question_text=answer.question_id,  # store question_id as reference
            student_answer=answer.answer,
            correct=is_correct,
            score=1.0 if is_correct else 0.0,
        )
        results.append(
            {
                "question_id": answer.question_id,
                "student_answer": answer.answer,
                "correct_answer": answer.correct_answer,
                "correct": is_correct,
                "record_id": record["id"],
            }
        )

    overall_score = correct_count / len(body.answers) if body.answers else 0.0

    progress = await tools.update_progress(
        student_id=body.student_id,
        topic=body.topic,
        score=overall_score,
        question_ids=[a.question_id for a in body.answers],
    )

    return {
        "score": round(overall_score, 4),
        "new_level": progress["new_level"],
        "mastery": progress["mastery"],
        "results": results,
    }


@app.get("/api/dashboard")
async def get_dashboard() -> dict:
    """
    Return aggregated dashboard data for the teacher view.

    Intended to be polled every 10 seconds.
    """
    return await db.get_dashboard_data()
