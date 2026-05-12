"""
app/api/routes/students.py — student CRUD and progress endpoints.
"""
from __future__ import annotations

import json
import traceback
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException, Query, Depends, UploadFile, File, Form, Header
from fastapi.responses import StreamingResponse
import io

from app.api.routes.auth import get_current_teacher
from app.services.student_transfer import build_student_bundle, bundle_to_zip_bytes, import_zip_bytes
from loguru import logger

from app.core.prompts import OPTILEARN_26B_SYSTEM_PROMPT
from app.models.schemas import CreateStudentRequest
from app.services import db, generated_cache
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
    progress_hash = generated_cache.hash_text(json.dumps(progress, ensure_ascii=False, sort_keys=True))
    cache_key = generated_cache.make_cache_key(
        "student.report",
        {
            "student_id": student_id,
            "language": language,
            "progress_hash": progress_hash,
        },
        prompt_version="student-report-v1",
    )

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            cached_report = await generated_cache.get_text(cache_key, "student.report")
            if cached_report:
                yield _sse({"type": "token", "content": cached_report})
                yield _sse({"type": "done", "cache_hit": True})
                return

            report_parts: list[str] = []
            async for token in route_generate_with_fallback(
                prompt,
                "ADMIN",
                system_prompt=OPTILEARN_26B_SYSTEM_PROMPT,
                enable_thinking=False,
                lane="admin",
                feature="student.report",
                profile="admin_balanced",
            ):
                if token == MODEL_SWITCH_TOKEN:
                    yield _sse({
                        "type": "model_switch",
                        "message": "Connection interrupted. Switching to local model.",
                        "color": "#EF9F27",
                    })
                    continue
                report_parts.append(token)
                yield _sse({"type": "token", "content": token})
            report_text = "".join(report_parts).strip()
            if report_text:
                await generated_cache.set_text(
                    cache_key,
                    "student.report",
                    report_text,
                    input_hash=progress_hash,
                    metadata={"student_id": student_id, "language": language},
                )
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


@router.get("/{student_id}/export")
async def export_student_archive(
    student_id: str,
    pin: str = Query(..., description="Student PIN for verification"),
    teacher: dict = Depends(get_current_teacher),
):
    """Export a student's profile as a password-protected ZIP. Teacher-only, requires PIN verification."""
    try:
        student = await db.get_student(student_id)
        if student is None:
            raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
        
        # Verify PIN matches
        stored_pin = student.get("pin_visible") or ""
        if pin != stored_pin:
            raise HTTPException(status_code=401, detail="That PIN did not match.")
        
        logger.info(f"Exporting student {student_id}")
        bundle = await build_student_bundle(student_id)
        logger.info(f"Bundle built for {student_id}, creating ZIP")
        zip_bytes = bundle_to_zip_bytes(bundle, stored_pin)
        logger.info(f"ZIP created for {student_id}, size={len(zip_bytes)} bytes")
        filename = f"{(student.get('username') or student.get('name') or student_id)}.optistudent.zip"
        return StreamingResponse(io.BytesIO(zip_bytes), media_type="application/zip", headers={"Content-Disposition": f"attachment; filename=\"{filename}\""})
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Export error for {student_id}: {err}", exc_info=True)
        raise HTTPException(status_code=500, detail="Export could not be completed.")

@router.post("/import")
async def import_student_archive(
    file: UploadFile = File(...),
    pin: str = Form(...),
    target_student_id: str | None = Form(None),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict:
    """Import a student ZIP archive. Teacher auth optional (for signup vs manage users)."""
    # Get teacher ID if auth provided, otherwise use "system" for signup imports
    imported_by = None
    if authorization:
        try:
            from app.api.routes.auth import _teacher_from_token, _bearer_token
            token = _bearer_token(authorization)
            teacher = await _teacher_from_token(token)
            imported_by = teacher.get("id")
        except Exception:
            # Auth failed, continue without it (signup case)
            pass
    
    contents = await file.read()
    try:
        result = await import_zip_bytes(contents, pin, target_student_id, imported_by=imported_by or "signup")
        logger.info(f"Import successful for student {result.get('student_id')}")
    except ValueError as exc:
        logger.error(f"Import validation error: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error(f"Import error: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Import could not be completed.")
    return result


@router.delete("/{student_id}")
async def delete_student(student_id: str, teacher: dict = Depends(get_current_teacher)) -> dict:
    """Hard-delete a student and all related records. Teacher-only."""
    try:
        student = await db.get_student(student_id)
        if student is None:
            raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
        
        # Hard delete: remove all related records
        async with db._get_db() as conn:
            # Delete related records in order (respecting foreign keys)
            await conn.execute("DELETE FROM import_history WHERE student_id = ?", (student_id,))
            await conn.execute("DELETE FROM quiz_results WHERE student_id = ?", (student_id,))
            await conn.execute("DELETE FROM topic_mastery WHERE student_id = ?", (student_id,))
            await conn.execute("DELETE FROM class_notes WHERE student_id = ?", (student_id,))
            await conn.execute("DELETE FROM materials WHERE student_id = ?", (student_id,))
            await conn.execute("DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE student_id = ?)", (student_id,))
            await conn.execute("DELETE FROM sessions WHERE student_id = ?", (student_id,))
            await conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
            await conn.commit()
        
        logger.info(f"Student {student_id} deleted by teacher {teacher.get('id')}")
        return {"success": True, "deleted_student_id": student_id}
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"Delete error for {student_id}: {err}", exc_info=True)
        raise HTTPException(status_code=500, detail="Record could not be removed.")
