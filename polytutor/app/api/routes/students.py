"""
app/api/routes/students.py — student CRUD endpoints.
"""
from fastapi import APIRouter, HTTPException

from app.models.schemas import CreateStudentRequest
from app.services import db

router = APIRouter(prefix="/api/students", tags=["students"])


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


@router.get("/{student_id}")
async def get_student(student_id: str) -> dict:
    """Return a single student's record plus full topic_mastery list. Raises 404 if not found."""
    student = await db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail=f"Student '{student_id}' not found.")
    mastery = await db.get_student_mastery(student_id)
    student["topic_mastery"] = mastery
    return student
