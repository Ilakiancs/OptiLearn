"""
app/services/db.py — SQLite schema initialisation and async helper functions.

All database operations use aiosqlite. The schema uses WAL mode and foreign keys.
Call init_db() from FastAPI's lifespan startup hook.
"""
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, AsyncGenerator

import aiosqlite
from loguru import logger

from app.core.config import settings


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

CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT REFERENCES sessions(id),
    role        TEXT NOT NULL,
    content     TEXT,
    tool_name   TEXT,
    timestamp   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS class_notes (
    id                  TEXT PRIMARY KEY,
    student_id          TEXT REFERENCES students(id),
    session_id          TEXT REFERENCES sessions(id),
    raw_transcript      TEXT,
    translated_chunks   TEXT DEFAULT '[]',
    notes_text          TEXT,
    notes_language      TEXT,
    subject             TEXT,
    faiss_indexed       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS materials (
    id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    title         TEXT NOT NULL,
    subject       TEXT,
    file_path     TEXT NOT NULL,
    uploaded_by   TEXT,
    student_id    TEXT,
    translated_text TEXT,
    target_language TEXT,
    source_language TEXT,
    detected_confidence REAL DEFAULT 0,
    material_type TEXT,
    page_count INTEGER DEFAULT 1,
    preview TEXT,
    tutor_summary TEXT,
    tutor_history TEXT DEFAULT '[]',
    faiss_indexed INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teacher_quizzes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    title       TEXT NOT NULL,
    subject     TEXT,
    questions   TEXT NOT NULL,
    assigned_to TEXT DEFAULT 'all',
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_materials_subject  ON materials(subject);
CREATE INDEX IF NOT EXISTS idx_materials_student  ON materials(student_id);
CREATE INDEX IF NOT EXISTS idx_tquiz_assigned     ON teacher_quizzes(assigned_to);

CREATE TABLE IF NOT EXISTS scheduled_classes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
    title       TEXT NOT NULL,
    subject     TEXT,
    description TEXT,
    start_datetime TEXT NOT NULL,
    end_datetime   TEXT NOT NULL,
    created_by  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teacher_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT DEFAULT (datetime('now'))
);
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


@asynccontextmanager
async def _get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Async context manager that opens, configures, and closes a DB connection."""
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL;")
        await db.execute("PRAGMA foreign_keys=ON;")
        yield db


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
        # Additive migrations — safe to run on existing DBs (ignores duplicate column errors)
        for migration in [
            "ALTER TABLE materials ADD COLUMN student_id TEXT",
            "ALTER TABLE materials ADD COLUMN translated_text TEXT",
            "ALTER TABLE materials ADD COLUMN target_language TEXT",
            "ALTER TABLE materials ADD COLUMN source_language TEXT",
            "ALTER TABLE materials ADD COLUMN detected_confidence REAL DEFAULT 0",
            "ALTER TABLE materials ADD COLUMN material_type TEXT",
            "ALTER TABLE materials ADD COLUMN page_count INTEGER DEFAULT 1",
            "ALTER TABLE materials ADD COLUMN preview TEXT",
            "ALTER TABLE materials ADD COLUMN tutor_summary TEXT",
            "ALTER TABLE materials ADD COLUMN tutor_history TEXT DEFAULT '[]'",
            "ALTER TABLE materials ADD COLUMN updated_at TEXT",
            "ALTER TABLE class_notes ADD COLUMN created_at TEXT DEFAULT (datetime('now'))",
            "INSERT OR IGNORE INTO teacher_settings (key, value) VALUES ('master_language', 'en')",
            "INSERT OR IGNORE INTO teacher_settings (key, value) VALUES ('master_language_name', 'English')",
        ]:
            try:
                await db.execute(migration)
                await db.commit()
            except Exception:
                pass
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
    async with _get_db() as db:
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
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM students WHERE id = ?", (student_id,)
        )
        row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


async def update_last_active(student_id: str) -> None:
    """Update the last_active timestamp of a student to now (UTC, with Z suffix)."""
    now = datetime.utcnow().isoformat() + "Z"
    async with _get_db() as db:
        await db.execute(
            "UPDATE students SET last_active = ? WHERE id = ?",
            (now, student_id),
        )
        await db.commit()


async def create_session(student_id: str) -> dict[str, Any]:
    """Create a new learning session for a student and return it as a dict."""
    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
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
    async with _get_db() as db:
        await db.execute(
            "UPDATE sessions SET ended_at = ? WHERE id = ?",
            (now, session_id),
        )
        await db.commit()


async def increment_message_count(session_id: str) -> None:
    """Atomically increment the message_count field of a session."""
    async with _get_db() as db:
        await db.execute(
            "UPDATE sessions SET message_count = message_count + 1 WHERE id = ?",
            (session_id,),
        )
        await db.commit()


async def add_message(
    session_id: str,
    role: str,
    content: str | None,
    tool_name: str | None = None,
) -> dict[str, Any]:
    """Persist one chat message for a tutoring session."""
    message_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
        await db.execute(
            """
            INSERT INTO messages (id, session_id, role, content, tool_name, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (message_id, session_id, role, content or "", tool_name, now),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM messages WHERE id = ?", (message_id,))
        row = await cursor.fetchone()
    return _row_to_dict(row)


async def get_session_messages(session_id: str) -> list[dict[str, Any]]:
    """Return all saved messages for one tutoring session in display order."""
    async with _get_db() as db:
        cursor = await db.execute(
            """
            SELECT id, session_id, role, content, tool_name, timestamp
            FROM messages
            WHERE session_id = ?
            ORDER BY timestamp ASC, id ASC
            """,
            (session_id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_student_chat_sessions(student_id: str) -> list[dict[str, Any]]:
    """Return saved AI Tutor sessions for one student, newest first."""
    async with _get_db() as db:
        cursor = await db.execute(
            """
            SELECT
                s.id,
                s.student_id,
                s.started_at,
                s.ended_at,
                s.message_count,
                (
                    SELECT m.content
                    FROM messages m
                    WHERE m.session_id = s.id
                      AND m.role IN ('user', 'assistant')
                      AND trim(COALESCE(m.content, '')) != ''
                    ORDER BY m.timestamp DESC, m.id DESC
                    LIMIT 1
                ) AS preview,
                (
                    SELECT m.timestamp
                    FROM messages m
                    WHERE m.session_id = s.id
                    ORDER BY m.timestamp DESC, m.id DESC
                    LIMIT 1
                ) AS last_message_at
            FROM sessions s
            WHERE s.student_id = ?
              AND EXISTS (
                  SELECT 1
                  FROM messages m
                  WHERE m.session_id = s.id
                    AND m.role IN ('user', 'assistant')
              )
            ORDER BY COALESCE(last_message_at, s.started_at) DESC
            LIMIT 30
            """,
            (student_id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_session_for_student(session_id: str, student_id: str) -> dict[str, Any] | None:
    """Return a session only when it belongs to the given student."""
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM sessions WHERE id = ? AND student_id = ?",
            (session_id, student_id),
        )
        row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


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
    async with _get_db() as db:
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
    async with _get_db() as db:
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


async def get_topic_mastery(student_id: str, topic: str) -> float:
    """Return current mastery for a student's topic, or 0.0 if no record exists."""
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT mastery FROM topic_mastery WHERE student_id = ? AND topic = ?",
            (student_id, topic),
        )
        row = await cursor.fetchone()
    return float(row["mastery"]) if row else 0.0


async def get_seen_question_ids(
    student_id: str,
    topic: str,
    question_ids: list[str],
) -> set[str]:
    """
    Return the subset of question_ids already attempted by this student for this topic.

    Used to reduce mastery inflation when the same activity is repeated.
    """
    unique_ids = [q.strip() for q in question_ids if q and q.strip()]
    if not unique_ids:
        return set()

    placeholders = ",".join("?" for _ in unique_ids)
    params: list[Any] = [student_id, topic, *unique_ids]
    sql = f"""
        SELECT DISTINCT question_text
        FROM quiz_results
        WHERE student_id = ?
          AND topic = ?
          AND question_text IN ({placeholders})
    """

    async with _get_db() as db:
        cursor = await db.execute(sql, params)
        rows = await cursor.fetchall()

    return {str(r["question_text"]) for r in rows}


async def get_all_students() -> list[dict[str, Any]]:
    """Return all students with their latest mastery summary."""
    async with _get_db() as db:
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
    async with _get_db() as db:
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
            "students": [...],
            "total_sessions": int,
            "topics_by_struggle": [...]
        }
    """
    async with _get_db() as db:
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

        count_cursor = await db.execute("SELECT COUNT(*) AS cnt FROM sessions")
        count_row = await count_cursor.fetchone()
        total_sessions: int = count_row["cnt"]

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


async def get_teacher_students() -> list[dict[str, Any]]:
    """Return all students with mastery avg, last_active, and alert flags."""
    async with _get_db() as db:
        cursor = await db.execute("SELECT * FROM students ORDER BY name ASC")
        rows = await cursor.fetchall()
        students = [_row_to_dict(r) for r in rows]

        now_iso = datetime.utcnow().isoformat()

        for student in students:
            sid = student["id"]

            m_cursor = await db.execute(
                "SELECT topic, mastery, level FROM topic_mastery WHERE student_id = ?",
                (sid,),
            )
            mastery_rows = await m_cursor.fetchall()
            mastery_list = [_row_to_dict(r) for r in mastery_rows]
            student["mastery_summary"] = mastery_list
            student["mastery_avg"] = (
                round(sum(m["mastery"] for m in mastery_list) / len(mastery_list), 4)
                if mastery_list else 0.0
            )

            alerts: list[str] = []

            # inactive_3_days: NULL last_active OR last_active older than 3 days
            last_active_str = student.get("last_active")
            if last_active_str is None:
                alerts.append("inactive_3_days")
            else:
                try:
                    last = datetime.fromisoformat(last_active_str)
                    if (datetime.utcnow() - last) > timedelta(days=3):
                        alerts.append("inactive_3_days")
                except ValueError:
                    alerts.append("inactive_3_days")

            # stuck_on_topic: any topic with mastery < 0.40 and >= 3 quiz_results
            for m in mastery_list:
                if m["mastery"] < 0.40:
                    count_cur = await db.execute(
                        "SELECT COUNT(*) AS cnt FROM quiz_results WHERE student_id = ? AND topic = ?",
                        (sid, m["topic"]),
                    )
                    cnt_row = await count_cur.fetchone()
                    if cnt_row and cnt_row["cnt"] >= 3:
                        alerts.append("stuck_on_topic")
                        break

            # level_dropped: last topic_mastery update shows level downgrade
            # Detect via quiz_results: compare last two score averages per topic
            if mastery_list:
                for m in mastery_list:
                    qcur = await db.execute(
                        """SELECT score FROM quiz_results
                           WHERE student_id = ? AND topic = ?
                           ORDER BY timestamp DESC LIMIT 4""",
                        (sid, m["topic"]),
                    )
                    qrows = await qcur.fetchall()
                    scores = [r["score"] for r in qrows]
                    if len(scores) >= 4:
                        recent_avg = sum(scores[:2]) / 2
                        older_avg = sum(scores[2:4]) / 2
                        if _mastery_level(recent_avg * 0.3) < _mastery_level(older_avg * 0.3):
                            alerts.append("level_dropped")
                            break

            student["alerts"] = list(set(alerts))

        students.sort(key=lambda s: (0 if s["alerts"] else 1, s["name"]))

    return students


async def get_heatmap_data() -> dict[str, Any]:
    """Return heatmap grid: students × topics with mastery float and color."""
    def _color(val: float | None) -> str:
        if val is None:
            return "grey"
        if val < 0.40:
            return "red"
        if val < 0.75:
            return "amber"
        return "green"

    async with _get_db() as db:
        s_cursor = await db.execute("SELECT id, name FROM students ORDER BY name")
        student_rows = await s_cursor.fetchall()

        t_cursor = await db.execute(
            "SELECT DISTINCT topic FROM topic_mastery ORDER BY topic"
        )
        topic_rows = await t_cursor.fetchall()
        topics = [r["topic"] for r in topic_rows]

        grid: list[list[dict | None]] = []
        for sr in student_rows:
            row_cells: list[dict | None] = []
            for topic in topics:
                mc = await db.execute(
                    "SELECT mastery FROM topic_mastery WHERE student_id = ? AND topic = ?",
                    (sr["id"], topic),
                )
                mrow = await mc.fetchone()
                val = mrow["mastery"] if mrow else None
                row_cells.append({"value": val, "color": _color(val)})
            grid.append(row_cells)

    return {
        "topics": topics,
        "students": [{"id": r["id"], "name": r["name"]} for r in student_rows],
        "grid": grid,
    }


async def get_student_progress(student_id: str) -> dict[str, Any] | None:
    """Return per-student progress: mastery by topic, recent quizzes, sessions, level."""
    student = await get_student(student_id)
    if student is None:
        return None

    async with _get_db() as db:
        m_cursor = await db.execute(
            "SELECT * FROM topic_mastery WHERE student_id = ? ORDER BY mastery DESC",
            (student_id,),
        )
        mastery_rows = await m_cursor.fetchall()
        mastery_by_topic = [_row_to_dict(r) for r in mastery_rows]

        q_cursor = await db.execute(
            """SELECT * FROM quiz_results WHERE student_id = ?
               ORDER BY timestamp DESC LIMIT 10""",
            (student_id,),
        )
        quiz_rows = await q_cursor.fetchall()
        recent_quizzes = [_row_to_dict(r) for r in quiz_rows]

        sess_cursor = await db.execute(
            """SELECT id, started_at, ended_at, message_count, topics_covered
               FROM sessions WHERE student_id = ? ORDER BY started_at DESC LIMIT 10""",
            (student_id,),
        )
        sess_rows = await sess_cursor.fetchall()
        sessions = [_row_to_dict(r) for r in sess_rows]

    overall_mastery = (
        sum(m["mastery"] for m in mastery_by_topic) / len(mastery_by_topic)
        if mastery_by_topic else 0.0
    )
    level = _mastery_level(overall_mastery)

    return {
        "student": student,
        "mastery_by_topic": mastery_by_topic,
        "recent_quizzes": recent_quizzes,
        "sessions": sessions,
        "level": level,
        "last_active": student.get("last_active"),
    }


async def create_material(
    title: str,
    subject: str | None,
    file_path: str,
    uploaded_by: str | None = None,
    student_id: str | None = None,
    target_language: str | None = None,
    source_language: str | None = None,
    detected_confidence: float | None = None,
    material_type: str | None = None,
    page_count: int | None = None,
    preview: str | None = None,
    faiss_indexed: bool = False,
) -> dict[str, Any]:
    """Insert a materials row and return it."""
    mat_id = str(uuid.uuid4())[:16].replace("-", "")
    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
        await db.execute(
            """
            INSERT INTO materials (
                id, title, subject, file_path, uploaded_by, student_id,
                target_language, source_language, detected_confidence,
                material_type, page_count, preview, faiss_indexed, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mat_id,
                title,
                subject,
                file_path,
                uploaded_by,
                student_id,
                target_language,
                source_language,
                detected_confidence or 0,
                material_type,
                page_count or 1,
                preview,
                1 if faiss_indexed else 0,
                now,
            ),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM materials WHERE id = ?", (mat_id,))
        row = await cursor.fetchone()
    return _row_to_dict(row)


async def get_material(material_id: str) -> dict[str, Any] | None:
    """Return a single material record by id (alias for get_material_by_id)."""
    return await get_material_by_id(material_id)


async def get_student_with_profile(student_id: str) -> dict[str, Any] | None:
    """Return student record combined with topic_mastery list."""
    student = await get_student(student_id)
    if student is None:
        return None
    student["topic_mastery"] = await get_student_mastery(student_id)
    return student


async def update_material_translation(
    material_id: str,
    translated_text: str,
    faiss_indexed: bool = True,
    target_language: str | None = None,
) -> None:
    """Persist the completed translation text and record whether vector indexing ran."""
    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
        await db.execute(
            """
            UPDATE materials
            SET translated_text = ?,
                faiss_indexed = ?,
                target_language = COALESCE(?, target_language),
                updated_at = ?
            WHERE id = ?
            """,
            (translated_text, 1 if faiss_indexed else 0, target_language, now, material_id),
        )
        await db.commit()


async def update_material_tutor_summary(
    material_id: str,
    tutor_summary: str,
) -> None:
    """Persist the AI tutor overview generated for a Feature 1 material."""
    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
        await db.execute(
            """
            UPDATE materials
            SET tutor_summary = ?, updated_at = ?
            WHERE id = ?
            """,
            (tutor_summary, now, material_id),
        )
        await db.commit()


async def append_material_tutor_history(
    material_id: str,
    question: str,
    answer: str,
) -> None:
    """Append one persisted tutor Q&A pair for a Feature 1 material."""
    import json as _json

    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT tutor_history FROM materials WHERE id = ?",
            (material_id,),
        )
        row = await cursor.fetchone()
        if row is None:
            return
        try:
            history = _json.loads(row["tutor_history"] or "[]")
            if not isinstance(history, list):
                history = []
        except (_json.JSONDecodeError, TypeError):
            history = []
        history.extend(
            [
                {"type": "question", "content": question},
                {"type": "answer", "content": answer},
            ]
        )
        await db.execute(
            """
            UPDATE materials
            SET tutor_history = ?, updated_at = ?
            WHERE id = ?
            """,
            (_json.dumps(history, ensure_ascii=False), now, material_id),
        )
        await db.commit()


async def get_all_materials(teacher_only: bool = False) -> list[dict[str, Any]]:
    """Return materials ordered by created_at desc. teacher_only=True filters to student_id IS NULL."""
    async with _get_db() as db:
        if teacher_only:
            cursor = await db.execute(
                "SELECT * FROM materials WHERE student_id IS NULL ORDER BY created_at DESC"
            )
        else:
            cursor = await db.execute("SELECT * FROM materials ORDER BY created_at DESC")
        rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def create_teacher_quiz(
    title: str,
    subject: str | None,
    questions: list[dict],
    assigned_to: str = "all",
) -> dict[str, Any]:
    """Insert a teacher_quizzes row and return it."""
    import json as _json
    quiz_id = str(uuid.uuid4())[:16].replace("-", "")
    async with _get_db() as db:
        await db.execute(
            """INSERT INTO teacher_quizzes (id, title, subject, questions, assigned_to)
               VALUES (?, ?, ?, ?, ?)""",
            (quiz_id, title, subject, _json.dumps(questions), assigned_to),
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT * FROM teacher_quizzes WHERE id = ?", (quiz_id,)
        )
        row = await cursor.fetchone()
    result = _row_to_dict(row)
    result["questions"] = _json.loads(result["questions"])
    return result


async def get_all_teacher_quizzes() -> list[dict[str, Any]]:
    """Return all teacher quizzes, questions parsed from JSON."""
    import json as _json
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM teacher_quizzes ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
    result = []
    for r in rows:
        d = _row_to_dict(r)
        d["questions"] = _json.loads(d["questions"])
        result.append(d)
    return result


async def get_teacher_quiz(quiz_id: str) -> dict[str, Any] | None:
    """Return a single teacher quiz by id, questions parsed."""
    import json as _json
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM teacher_quizzes WHERE id = ?", (quiz_id,)
        )
        row = await cursor.fetchone()
    if row is None:
        return None
    d = _row_to_dict(row)
    d["questions"] = _json.loads(d["questions"])
    return d


async def get_teacher_quizzes_for_student(student_id: str) -> list[dict[str, Any]]:
    """Return teacher quizzes assigned to this student or 'all'."""
    import json as _json
    async with _get_db() as db:
        cursor = await db.execute(
            """SELECT * FROM teacher_quizzes
               WHERE assigned_to = 'all'
                  OR assigned_to LIKE ?
               ORDER BY created_at DESC""",
            (f"%{student_id}%",),
        )
        rows = await cursor.fetchall()
    result = []
    for r in rows:
        d = _row_to_dict(r)
        d["questions"] = _json.loads(d["questions"])
        # verify exact student_id match when not 'all'
        if d["assigned_to"] != "all":
            ids = [x.strip() for x in d["assigned_to"].split(",")]
            if student_id not in ids:
                continue
        result.append(d)
    return result


async def get_subjects() -> list[str]:
    """Return all distinct non-null subjects from teacher materials and teacher_quizzes."""
    async with _get_db() as db:
        cursor = await db.execute("""
            SELECT DISTINCT subject FROM (
                SELECT subject FROM materials
                  WHERE subject IS NOT NULL AND subject != '' AND student_id IS NULL
                UNION
                SELECT subject FROM teacher_quizzes
                  WHERE subject IS NOT NULL AND subject != ''
            ) ORDER BY subject
        """)
        rows = await cursor.fetchall()
    return [r["subject"] for r in rows]


async def get_material_by_id(material_id: str) -> dict[str, Any] | None:
    """Return a single material record by id."""
    async with _get_db() as db:
        cursor = await db.execute("SELECT * FROM materials WHERE id = ?", (material_id,))
        row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


async def get_feature1_sessions(student_id: str) -> list[dict[str, Any]]:
    """Return saved Translate & Learn sessions for one student, newest first."""
    async with _get_db() as db:
        cursor = await db.execute(
            """
            SELECT
                id,
                title,
                subject,
                student_id,
                target_language,
                source_language,
                detected_confidence,
                material_type,
                page_count,
                preview,
                substr(translated_text, 1, 320) AS translated_preview,
                substr(tutor_summary, 1, 320) AS tutor_preview,
                faiss_indexed,
                created_at,
                updated_at
            FROM materials
            WHERE student_id = ?
              AND translated_text IS NOT NULL
              AND trim(translated_text) != ''
            ORDER BY COALESCE(updated_at, created_at) DESC
            """,
            (student_id,),
        )
        rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_feature1_session(student_id: str, material_id: str) -> dict[str, Any] | None:
    """Return one saved Translate & Learn session for one student."""
    async with _get_db() as db:
        cursor = await db.execute(
            """
            SELECT *
            FROM materials
            WHERE id = ?
              AND student_id = ?
            """,
            (material_id, student_id),
        )
        row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


async def get_materials_by_subject(subject: str) -> list[dict[str, Any]]:
    """Return materials for a given subject, newest first."""
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM materials WHERE subject = ? ORDER BY created_at DESC",
            (subject,),
        )
        rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_teacher_quizzes_by_subject(subject: str, student_id: str) -> list[dict[str, Any]]:
    """Return teacher quizzes for a subject that are assigned to this student or 'all'."""
    import json as _json
    async with _get_db() as db:
        cursor = await db.execute(
            """SELECT * FROM teacher_quizzes
               WHERE subject = ?
                 AND (assigned_to = 'all' OR assigned_to LIKE ?)
               ORDER BY created_at DESC""",
            (subject, f"%{student_id}%"),
        )
        rows = await cursor.fetchall()
    result = []
    for r in rows:
        d = _row_to_dict(r)
        d["questions"] = _json.loads(d["questions"])
        if d["assigned_to"] != "all":
            ids = [x.strip() for x in d["assigned_to"].split(",")]
            if student_id not in ids:
                continue
        result.append(d)
    return result


async def create_scheduled_class(
    title: str,
    subject: str | None,
    description: str | None,
    start_datetime: str,
    end_datetime: str,
    created_by: str | None = None,
) -> dict[str, Any]:
    class_id = str(uuid.uuid4())[:16].replace("-", "")
    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
        await db.execute(
            """INSERT INTO scheduled_classes
               (id, title, subject, description, start_datetime, end_datetime, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (class_id, title, subject, description, start_datetime, end_datetime, created_by, now),
        )
        await db.commit()
        cursor = await db.execute("SELECT * FROM scheduled_classes WHERE id = ?", (class_id,))
        row = await cursor.fetchone()
    return _row_to_dict(row)


async def get_all_scheduled_classes() -> list[dict[str, Any]]:
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM scheduled_classes ORDER BY start_datetime ASC"
        )
        rows = await cursor.fetchall()
    return [_row_to_dict(r) for r in rows]


async def get_scheduled_class(class_id: str) -> dict[str, Any] | None:
    async with _get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM scheduled_classes WHERE id = ?", (class_id,)
        )
        row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


async def update_scheduled_class(class_id: str, **kwargs: Any) -> dict[str, Any] | None:
    allowed = {"title", "subject", "description", "start_datetime", "end_datetime"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return await get_scheduled_class(class_id)
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [class_id]
    async with _get_db() as db:
        await db.execute(
            f"UPDATE scheduled_classes SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
        cursor = await db.execute(
            "SELECT * FROM scheduled_classes WHERE id = ?", (class_id,)
        )
        row = await cursor.fetchone()
    return _row_to_dict(row) if row else None


async def delete_scheduled_class(class_id: str) -> None:
    async with _get_db() as db:
        await db.execute("DELETE FROM scheduled_classes WHERE id = ?", (class_id,))
        await db.commit()


async def get_teacher_settings() -> dict[str, str]:
    async with _get_db() as db:
        cursor = await db.execute("SELECT key, value FROM teacher_settings")
        rows = await cursor.fetchall()
    return {r["key"]: r["value"] for r in rows}


async def update_teacher_setting(key: str, value: str) -> None:
    now = datetime.utcnow().isoformat()
    async with _get_db() as db:
        await db.execute(
            "INSERT OR REPLACE INTO teacher_settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now),
        )
        await db.commit()


# ──────────────────────────────────────────────────────────────
# Allow running this file directly to initialise the schema
# ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import asyncio

    asyncio.run(init_db())
    print("Database initialised.")
