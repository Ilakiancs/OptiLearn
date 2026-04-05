"""
backend/db.py — SQLite schema initialisation and async helper functions.

All database operations use aiosqlite. The schema uses WAL mode and foreign keys.
Call init_db() from FastAPI's lifespan startup hook.
"""
import uuid
from datetime import datetime
from typing import Any

import aiosqlite
from loguru import logger

from backend.config import settings


# ──────────────────────────────────────────────────────────────
# Schema DDL
# ──────────────────────────────────────────────────────────────
_SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS students (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    age         INTEGER,
    language    TEXT DEFAULT 'en',
    grade_level INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    last_active TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    student_id     TEXT REFERENCES students(id),
    started_at     TEXT DEFAULT (datetime('now')),
    ended_at       TEXT,
    message_count  INTEGER DEFAULT 0,
    topics_covered TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS quiz_results (
    id             TEXT PRIMARY KEY,
    student_id     TEXT REFERENCES students(id),
    session_id     TEXT REFERENCES sessions(id),
    topic          TEXT NOT NULL,
    question_text  TEXT,
    student_answer TEXT,
    correct        INTEGER,
    score          REAL,
    timestamp      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topic_mastery (
    student_id   TEXT REFERENCES students(id),
    topic        TEXT NOT NULL,
    mastery      REAL DEFAULT 0.0,
    level        TEXT DEFAULT 'beginner',
    last_updated TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (student_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_quiz_student    ON quiz_results(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_topic      ON quiz_results(topic);
CREATE INDEX IF NOT EXISTS idx_mastery_student ON topic_mastery(student_id);
"""


# ──────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────
def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    """Convert an aiosqlite Row to a plain dict."""
    return dict(row)


def _mastery_level(mastery: float) -> str:
    """Return mastery level label from a 0–1 mastery score."""
    if mastery > 0.75:
        return "advanced"
    if mastery > 0.45:
        return "intermediate"
    return "beginner"


async def _get_db() -> aiosqlite.Connection:
    """Open and configure a database connection."""
    db = await aiosqlite.connect(settings.DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL;")
    await db.execute("PRAGMA foreign_keys=ON;")
    return db


# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────
async def init_db() -> None:
    """Initialise the SQLite schema. Safe to call multiple times (IF NOT EXISTS)."""
    logger.info("Initialising database at {}", settings.DB_PATH)
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.executescript(_SCHEMA_SQL)
        await db.commit()
    logger.info("Database schema ready.")


async def create_student(
    name: str,
    age: int | None,
    language: str = "en",
    grade_level: int = 1,
) -> dict[str, Any]:
    """Create a new student record and return it as a dict."""
    student_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    async with await _get_db() as db:
        await db.execute(
            """
            INSERT INTO students (id, name, age, language, grade_level, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (student_id, name, age, language, grade_level, now),
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT * FROM students WHERE id = ?", (student_id,)
        )
        row = await cursor.fetchone()
    logger.info("Created student id={} name={}", student_id, name)
    return _row_to_dict(row)


async def get_student(student_id: str) -> dict[str, Any] | None:
    """Retrieve a single student by ID. Returns None if not found."""
    async with await _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM students WHERE id = ?", (student_id,)
        )
        row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


async def update_last_active(student_id: str) -> None:
    """Update the last_active timestamp of a student to now."""
    now = datetime.utcnow().isoformat()
    async with await _get_db() as db:
        await db.execute(
            "UPDATE students SET last_active = ? WHERE id = ?",
            (now, student_id),
        )
        await db.commit()


async def create_session(student_id: str) -> dict[str, Any]:
    """Create a new learning session for a student and return it as a dict."""
    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    async with await _get_db() as db:
        await db.execute(
            """
            INSERT INTO sessions (id, student_id, started_at)
            VALUES (?, ?, ?)
            """,
            (session_id, student_id, now),
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        )
        row = await cursor.fetchone()
    logger.info("Created session id={} student_id={}", session_id, student_id)
    return _row_to_dict(row)


async def end_session(session_id: str) -> None:
    """Mark a session as ended by recording the current timestamp."""
    now = datetime.utcnow().isoformat()
    async with await _get_db() as db:
        await db.execute(
            "UPDATE sessions SET ended_at = ? WHERE id = ?",
            (now, session_id),
        )
        await db.commit()


async def increment_message_count(session_id: str) -> None:
    """Atomically increment the message_count field of a session."""
    async with await _get_db() as db:
        await db.execute(
            "UPDATE sessions SET message_count = message_count + 1 WHERE id = ?",
            (session_id,),
        )
        await db.commit()


async def record_quiz_result(
    student_id: str,
    session_id: str,
    topic: str,
    question_text: str,
    student_answer: str,
    correct: bool,
    score: float,
) -> dict[str, Any]:
    """Persist a single quiz answer and return the stored record as a dict."""
    result_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    async with await _get_db() as db:
        await db.execute(
            """
            INSERT INTO quiz_results
                (id, student_id, session_id, topic, question_text, student_answer, correct, score, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result_id,
                student_id,
                session_id,
                topic,
                question_text,
                student_answer,
                1 if correct else 0,
                score,
                now,
            ),
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT * FROM quiz_results WHERE id = ?", (result_id,)
        )
        row = await cursor.fetchone()
    return _row_to_dict(row)


async def update_mastery(
    student_id: str,
    topic: str,
    new_score: float,
) -> dict[str, Any]:
    """
    Update topic mastery using an exponential moving average.

    EMA formula: mastery = 0.7 * old_mastery + 0.3 * new_score
    Level thresholds: >0.75 → advanced | >0.45 → intermediate | else → beginner

    Returns: {"mastery": float, "level": str, "previous_level": str}
    """
    now = datetime.utcnow().isoformat()
    async with await _get_db() as db:
        cursor = await db.execute(
            "SELECT mastery, level FROM topic_mastery WHERE student_id = ? AND topic = ?",
            (student_id, topic),
        )
        existing = await cursor.fetchone()

        if existing:
            old_mastery: float = existing["mastery"]
            previous_level: str = existing["level"]
        else:
            old_mastery = 0.0
            previous_level = "beginner"

        new_mastery = 0.7 * old_mastery + 0.3 * new_score
        new_level = _mastery_level(new_mastery)

        if existing:
            await db.execute(
                """
                UPDATE topic_mastery
                SET mastery = ?, level = ?, last_updated = ?
                WHERE student_id = ? AND topic = ?
                """,
                (new_mastery, new_level, now, student_id, topic),
            )
        else:
            await db.execute(
                """
                INSERT INTO topic_mastery (student_id, topic, mastery, level, last_updated)
                VALUES (?, ?, ?, ?, ?)
                """,
                (student_id, topic, new_mastery, new_level, now),
            )

        await db.commit()

    logger.info(
        "Mastery update student={} topic={} {:.2f} → {:.2f} ({} → {})",
        student_id,
        topic,
        old_mastery,
        new_mastery,
        previous_level,
        new_level,
    )
    return {
        "mastery": round(new_mastery, 4),
        "level": new_level,
        "previous_level": previous_level,
    }


async def get_all_students() -> list[dict[str, Any]]:
    """Return all students with their latest mastery summary."""
    async with await _get_db() as db:
        cursor = await db.execute("SELECT * FROM students ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        students = [_row_to_dict(r) for r in rows]

        for student in students:
            m_cursor = await db.execute(
                """
                SELECT topic, mastery, level FROM topic_mastery
                WHERE student_id = ?
                ORDER BY mastery DESC
                """,
                (student["id"],),
            )
            mastery_rows = await m_cursor.fetchall()
            student["mastery_summary"] = [_row_to_dict(r) for r in mastery_rows]

    return students


async def get_student_mastery(student_id: str) -> list[dict[str, Any]]:
    """Return all topic mastery records for a given student."""
    async with await _get_db() as db:
        cursor = await db.execute(
            """
            SELECT * FROM topic_mastery
            WHERE student_id = ?
            ORDER BY mastery DESC
            """,
            (student_id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_dashboard_data() -> dict[str, Any]:
    """
    Aggregate dashboard data for the teacher view.

    Returns:
        {
            "students": [...],          # all students with mastery
            "total_sessions": int,
            "topics_by_struggle": [...]  # topics with lowest avg mastery
        }
    """
    async with await _get_db() as db:
        # All students
        cursor = await db.execute("SELECT * FROM students ORDER BY created_at DESC")
        student_rows = await cursor.fetchall()
        students = [_row_to_dict(r) for r in student_rows]

        for student in students:
            m_cursor = await db.execute(
                """
                SELECT topic, mastery, level FROM topic_mastery
                WHERE student_id = ?
                ORDER BY mastery DESC
                """,
                (student["id"],),
            )
            mastery_rows = await m_cursor.fetchall()
            student["mastery_summary"] = [_row_to_dict(r) for r in mastery_rows]

        # Total sessions
        count_cursor = await db.execute("SELECT COUNT(*) AS cnt FROM sessions")
        count_row = await count_cursor.fetchone()
        total_sessions: int = count_row["cnt"]

        # Topics ordered by lowest average mastery (most struggle)
        struggle_cursor = await db.execute(
            """
            SELECT topic, AVG(mastery) AS avg_mastery, COUNT(*) AS student_count
            FROM topic_mastery
            GROUP BY topic
            ORDER BY avg_mastery ASC
            LIMIT 10
            """
        )
        struggle_rows = await struggle_cursor.fetchall()
        topics_by_struggle = [_row_to_dict(r) for r in struggle_rows]

    return {
        "students": students,
        "total_sessions": total_sessions,
        "topics_by_struggle": topics_by_struggle,
    }


# ──────────────────────────────────────────────────────────────
# Allow running this file directly to initialise the schema
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import asyncio

    asyncio.run(init_db())
    print("Database initialised.")
