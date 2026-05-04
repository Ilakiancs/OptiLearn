"""
app/api/routes/students.py — student CRUD and progress endpoints.
"""
from __future__ import annotations

import json
import traceback
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from loguru import logger

from app.core.prompts import OPTILEARN_26B_SYSTEM_PROMPT
from app.models.schemas import CreateStudentRequest
from app.services import db
from app.services.model_client import MODEL_SWITCH_TOKEN, route_generate_with_fallback

router = APIRouter(prefix="/api/students", tags=["students"])
schedule_router = APIRouter(prefix="/api/student", tags=["student"])


@schedule_router.get("/schedule")
async def student_get_schedule() -> list[dict]:
    """Read-only: return all scheduled classes for student calendar view."""
    return await db.get_all_scheduled_classes()


_PROGRESS_REPORT_PROMPT = """\
Generate a 3-paragraph progress report for teacher use.
Be specific: what the student has mastered, what they struggle with,
one concrete recommendation for tomorrow's lesson.
Student: {name}, age {age}, grade {grade_level}, language {language}
Mastery: {topic_mastery_dict}
Recent quizzes: {last_10_results}
"""


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("")
async def create_student(body: CreateStudentRequest) -> dict:
    """Create a new student record."""
    return await db.create_student(
        name=body.name,
        age=body.age,
        language=body.language,
        grade_level=body.grade_level,
    )


@router.get("")
async def list_students() -> list[dict]:
    """Return all students with their latest mastery summary."""
    return await db.get_all_students()


@router.get("/{student_id}/progress")
async def get_student_progress(student_id: str) -> dict:
    """Return mastery_by_topic, recent_quizzes, sessions, level, last_active."""
    progress = await db.get_student_progress(student_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    return progress


@router.get("/{student_id}/report")
async def get_student_report(
    student_id: str,
    language: str = Query(default="en", description="Language for the AI report output"),
) -> StreamingResponse:
    """SSE stream — AI-generated 3-paragraph progress report for teacher use."""
    progress = await db.get_student_progress(student_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")

    student = progress["student"]
    mastery_dict = {m["topic"]: f"{m['mastery']:.0%} ({m['level']})" for m in progress["mastery_by_topic"]}
    last_10 = [
        {"topic": q["topic"], "score": q["score"], "correct": bool(q["correct"])}
        for q in progress["recent_quizzes"]
    ]

    lang_instruction = f" Write the report in {language}." if language != "en" else ""
    prompt = _PROGRESS_REPORT_PROMPT.format(
        name=student["name"],
        age=student.get("age", "unknown"),
        grade_level=student.get("grade_level", "unknown"),
        language=student.get("language", "en"),
        topic_mastery_dict=json.dumps(mastery_dict),
        last_10_results=json.dumps(last_10),
    ) + lang_instruction

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            async for token in route_generate_with_fallback(
                prompt,
                "ADMIN",
                system_prompt=OPTILEARN_26B_SYSTEM_PROMPT,
                enable_thinking=False,
            ):
                if token == MODEL_SWITCH_TOKEN:
                    yield _sse({
                        "type": "model_switch",
                        "message": "Connection interrupted. Switching to local model.",
                        "color": "#EF9F27",
                    })
                    continue
                yield _sse({"type": "token", "content": token})
            yield _sse({"type": "done"})
        except Exception as exc:
            logger.error("Report stream error: {}\n{}", exc, traceback.format_exc())
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{student_id}")
async def get_student(student_id: str) -> dict:
    """Return a single student's record plus full topic_mastery list. Raises 404 if not found."""
    student = await db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    mastery = await db.get_student_mastery(student_id)
    student["topic_mastery"] = mastery
    return student
