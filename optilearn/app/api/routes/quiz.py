"""
app/api/routes/quiz.py — quiz submission and scoring endpoint.
"""
from fastapi import APIRouter

from app.models.schemas import SubmitQuizRequest
from app.services import db
from app.tools.agent_tools import update_progress

router = APIRouter(prefix="/api/quiz", tags=["quiz"])


@router.post("/submit")
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
            question_text=answer.question_id,
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

    progress = await update_progress(
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
