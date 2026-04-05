"""
app/api/routes/sessions.py — learning session endpoints.
"""
from fastapi import APIRouter, HTTPException

from app.models.schemas import CreateSessionRequest
from app.services import db

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("")
async def create_session(body: CreateSessionRequest) -> dict:
    """Start a new learning session for a student."""
    student = await db.get_student(body.student_id)
    if student is None:
        raise HTTPException(status_code=404, detail=f"Student '{body.student_id}' not found.")
    return await db.create_session(body.student_id)
