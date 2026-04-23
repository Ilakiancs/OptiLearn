"""
app/api/routes/teacher_quiz.py — teacher quiz builder CRUD.

POST /api/teacher/quiz       — create a quiz
GET  /api/teacher/quiz       — list all teacher quizzes
GET  /api/teacher/quiz/{id}  — single quiz with full questions
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import db

router = APIRouter(prefix="/api/teacher/quiz", tags=["teacher-quiz"])


class QuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(..., min_length=2)
    correct_answer: str
    explanation: str = ""


class CreateTeacherQuizRequest(BaseModel):
    title: str = Field(..., min_length=1)
    subject: str | None = None
    questions: list[QuizQuestion] = Field(..., min_length=1)
    assigned_to: str = "all"


@router.post("")
async def create_teacher_quiz(body: CreateTeacherQuizRequest) -> dict:
    """
    Create a teacher-authored quiz.
    assigned_to: "all" or comma-separated student IDs e.g. "id1,id2"
    """
    questions_raw = [q.model_dump() for q in body.questions]
    quiz = await db.create_teacher_quiz(
        title=body.title,
        subject=body.subject,
        questions=questions_raw,
        assigned_to=body.assigned_to,
    )
    return quiz


@router.get("")
async def list_teacher_quizzes(subject: str | None = None, student_id: str | None = None) -> list[dict]:
    """Return teacher quizzes. Filter by ?subject= and/or ?student_id=."""
    if subject and student_id:
        quizzes = await db.get_teacher_quizzes_by_subject(subject, student_id)
    elif student_id:
        quizzes = await db.get_teacher_quizzes_for_student(student_id)
    else:
        quizzes = await db.get_all_teacher_quizzes()
    for q in quizzes:
        q["question_count"] = len(q.get("questions", []))
    return quizzes


@router.get("/{quiz_id}")
async def get_teacher_quiz(quiz_id: str) -> dict:
    """Return a single teacher quiz with full questions."""
    quiz = await db.get_teacher_quiz(quiz_id)
    if quiz is None:
        raise HTTPException(status_code=404, detail=f"Quiz '{quiz_id}' not found.")
    return quiz
