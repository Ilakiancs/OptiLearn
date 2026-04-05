"""
app/models/schemas.py — Pydantic request/response schemas for all API endpoints.
"""
from pydantic import BaseModel, Field


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
