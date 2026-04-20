"""
app/tools/agent_tools.py — four agent tool implementations.

Tools are pure async functions dispatched after the model emits a ToolCallEvent.
generate_quiz is the one exception: it calls model_client for structured generation.

TOOL_SCHEMAS: list[dict] is the canonical tool definition list passed into
every model_client call from the route handlers.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import Any

from langdetect import detect_langs
from langdetect.lang_detect_exception import LangDetectException
from loguru import logger

from app.core.config import settings
from app.services import db, faiss_store
from app.services.model_client import model_client

# ──────────────────────────────────────────────────────────────
# Tool schema definitions
# ──────────────────────────────────────────────────────────────
TOOL_SCHEMAS: list[dict] = [
    {
        "name": "detect_language",
        "description": (
            "Detect the language of a text string and return the ISO 639-1 language code "
            "along with a confidence score."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text whose language should be detected.",
                }
            },
            "required": ["text"],
        },
    },
    {
        "name": "retrieve_curriculum",
        "description": (
            "Retrieve relevant curriculum passages from the local knowledge base "
            "for a given topic and grade level."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The topic to search for (e.g. 'fractions', 'water cycle').",
                },
                "grade_level": {
                    "type": "integer",
                    "description": "The student's grade level (1–12).",
                },
                "language": {
                    "type": "string",
                    "description": "ISO 639-1 language code of the student.",
                },
            },
            "required": ["topic", "grade_level", "language"],
        },
    },
    {
        "name": "generate_quiz",
        "description": (
            "Generate a multiple-choice quiz on a topic at the student's level "
            "in the student's language."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {
                    "type": "string",
                    "description": "The quiz topic.",
                },
                "level": {
                    "type": "string",
                    "description": "Difficulty level: 'beginner', 'intermediate', or 'advanced'.",
                },
                "language": {
                    "type": "string",
                    "description": "ISO 639-1 language code for quiz language.",
                },
                "n": {
                    "type": "integer",
                    "description": "Number of quiz questions to generate (default: 3).",
                },
            },
            "required": ["topic", "level", "language", "n"],
        },
    },
    {
        "name": "update_progress",
        "description": (
            "Record a student's quiz score for a topic and update their mastery level."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "student_id": {
                    "type": "string",
                    "description": "The student's UUID.",
                },
                "topic": {
                    "type": "string",
                    "description": "The topic that was quizzed.",
                },
                "score": {
                    "type": "number",
                    "description": "Quiz score as a fraction between 0.0 and 1.0.",
                },
                "question_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of question UUIDs answered in this quiz.",
                },
            },
            "required": ["student_id", "topic", "score", "question_ids"],
        },
    },
]


# ──────────────────────────────────────────────────────────────
# Tool 1 — detect_language
# ──────────────────────────────────────────────────────────────
async def detect_language(text: str) -> dict[str, Any]:
    """
    Detect the language of the given text using langdetect.

    Returns the ISO 639-1 language code and a confidence score.
    Falls back to English with confidence 0.0 on any error.
    """
    threshold = settings.LANGDETECT_CONFIDENCE_THRESHOLD
    try:
        results = detect_langs(text)
        if not results:
            logger.warning("langdetect returned no results for text snippet.")
            return {"language": "en", "confidence": 0.0}

        top = results[0]
        lang_code: str = top.lang
        confidence: float = top.prob

        if confidence < threshold:
            logger.warning(
                "Low language detection confidence: {} ({:.2f}). "
                "Returning top result anyway.",
                lang_code,
                confidence,
            )

        logger.info("Detected language={} confidence={:.2f}", lang_code, confidence)
        return {"language": lang_code, "confidence": round(confidence, 4)}

    except LangDetectException as exc:
        logger.error("langdetect error for text snippet: {}", exc)
        return {"language": "en", "confidence": 0.0}


# ──────────────────────────────────────────────────────────────
# Tool 2 — retrieve_curriculum
# ──────────────────────────────────────────────────────────────
async def retrieve_curriculum(
    topic: str,
    grade_level: int,
    language: str,  # noqa: ARG001 — reserved for future language-specific filtering
) -> list[dict[str, Any]]:
    """
    Retrieve relevant curriculum passages from the FAISS vector store.
    """
    results = faiss_store.query(topic=topic, grade_level=grade_level, k=3)

    if not results:
        logger.warning("No curriculum passages found for topic='{}' grade={}", topic, grade_level)
        return [
            {
                "passage": (
                    f"No curriculum content was found for the topic '{topic}'. "
                    "Please explain based on your general knowledge."
                ),
                "source": "none",
            }
        ]

    return [{"passage": r["passage"], "source": r["source"]} for r in results]


# ──────────────────────────────────────────────────────────────
# Tool 3 — generate_quiz
# ──────────────────────────────────────────────────────────────
async def generate_quiz(
    topic: str,
    level: str,
    language: str,
    n: int,
    student_id: str | None = None,
) -> dict[str, Any]:
    """
    Generate a multiple-choice quiz using the AI model, then prepend any
    teacher-authored quizzes assigned to this student (or 'all').
    Teacher quizzes take priority and appear first.
    """
    # Fetch teacher quizzes for this student
    teacher_questions: list[dict] = []
    if student_id:
        try:
            teacher_quizzes = await db.get_teacher_quizzes_for_student(student_id)
            for tq in teacher_quizzes:
                for q in tq.get("questions", []):
                    teacher_questions.append({
                        "id": str(uuid.uuid4()),
                        "question": q.get("question", ""),
                        "options": q.get("options", []),
                        "answer": q.get("correct_answer", q.get("answer", "")),
                        "type": "mcq",
                        "source": "teacher",
                    })
        except Exception as exc:
            logger.warning("Could not fetch teacher quizzes: {}", exc)

    prompt = (
        f"Generate exactly {n} multiple-choice quiz questions about '{topic}' "
        f"at {level} difficulty level. "
        f"Write all questions and options in ISO 639-1 language code '{language}'. "
        "Return ONLY valid JSON with no markdown, no explanation, no code fences.\n\n"
        "Required JSON structure:\n"
        '{"questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer": "A", "type": "mcq"}]}\n\n'
        "Rules:\n"
        "- options must be a list of exactly 4 strings.\n"
        "- answer must be one of the option strings (not a letter label).\n"
        "- type must be exactly 'mcq'.\n"
        "- Do not include any text outside the JSON object."
    )

    messages = [{"role": "user", "content": prompt}]
    result = await model_client.complete_with_tools(
        messages=messages,
        tools=[],
        image_b64=None,
    )

    if not isinstance(result, str):
        raise ValueError(
            f"Expected string response from model for quiz generation, "
            f"got {type(result).__name__}"
        )

    cleaned = re.sub(r"```(?:json)?\s*", "", result).strip()
    cleaned = cleaned.rstrip("`").strip()

    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        logger.error("Quiz JSON parse error. Raw response: {!r}", result[:500])
        raise ValueError(f"Model returned invalid JSON for quiz: {exc}") from exc

    questions = data.get("questions")
    if not isinstance(questions, list) or len(questions) == 0:
        raise ValueError("Quiz JSON missing 'questions' list or list is empty.")

    ai_questions: list[dict] = []
    for q in questions:
        if not all(k in q for k in ("question", "options", "answer", "type")):
            raise ValueError(f"Quiz question missing required fields: {q!r}")
        if not isinstance(q["options"], list) or len(q["options"]) < 2:
            raise ValueError(f"Quiz question has invalid options: {q!r}")
        ai_questions.append(
            {
                "id": str(uuid.uuid4()),
                "question": q["question"],
                "options": q["options"],
                "answer": q["answer"],
                "type": q["type"],
                "source": "ai",
            }
        )

    all_questions = teacher_questions + ai_questions
    logger.info(
        "Quiz: {} teacher + {} AI question(s) topic='{}' level={} language={}",
        len(teacher_questions), len(ai_questions), topic, level, language,
    )
    return {"questions": all_questions}


# ──────────────────────────────────────────────────────────────
# Tool 4 — update_progress
# ──────────────────────────────────────────────────────────────
async def update_progress(
    student_id: str,
    topic: str,
    score: float,
    question_ids: list[str],  # noqa: ARG001 — reserved for future audit trail
) -> dict[str, Any]:
    """
    Update a student's mastery for a topic using EMA and return the new level.
    """
    result = await db.update_mastery(
        student_id=student_id,
        topic=topic,
        new_score=score,
    )
    logger.info(
        "Progress updated student={} topic={} mastery={:.2f} level={}",
        student_id,
        topic,
        result["mastery"],
        result["level"],
    )
    return {
        "new_level": result["level"],
        "mastery": result["mastery"],
        "previous_level": result["previous_level"],
    }
