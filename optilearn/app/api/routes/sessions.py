"""
app/api/routes/sessions.py — learning session endpoints.
"""
from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import CreateSessionRequest
from app.services import db

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("")
async def create_session(body: CreateSessionRequest) -> dict:
    """Start a new learning session for a student."""
    student = await db.get_student(body.student_id)
    if student is None:
        raise HTTPException(status_code=404, detail=f"Student '{body.student_id}' not found.")
    await db.update_last_active(body.student_id)
    return await db.create_session(body.student_id)


@router.get("/student/{student_id}/chats")
async def list_student_chat_sessions(student_id: str) -> dict:
    """Return saved AI Tutor sessions for one student."""
    student = await db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    return {"sessions": await db.get_student_chat_sessions(student_id)}


@router.get("/{session_id}/messages")
async def get_chat_messages(session_id: str, student_id: str = Query(...)) -> dict:
    """Return saved messages for one AI Tutor session."""
    session = await db.get_session_for_student(session_id, student_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    return {"session": session, "messages": await db.get_session_messages(session_id)}
