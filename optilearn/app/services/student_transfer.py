"""Student export/import utilities.

Creates AES-encrypted ZIP archives containing a student's profile and learning
records, and imports such archives into the local database.

This module uses `pyzipper` to produce AES-encrypted ZIPs. The ZIP password
is expected to be the student's PIN (short passphrase). Imports are transactional
and record an import fingerprint to avoid duplicates.
"""
import io
import json
import hashlib
import uuid
from datetime import datetime
from typing import Any

import bcrypt
import pyzipper

from app.services import db


def _ensure_json_text(value: Any, fallback: Any) -> str:
    """Return JSON text without double-encoding strings that are already JSON."""
    if value is None:
        return json.dumps(fallback, default=str)
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str)


def _hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


async def build_student_bundle(student_id: str) -> dict[str, Any]:
    """Collect student data and return a dict bundle ready to serialize.

    The bundle contains student, sessions (with messages), quiz_results, topic_mastery,
    class_notes and materials.
    """
    try:
        # Use existing db service functions
        student = await db.get_student(student_id)
        if not student:
            raise ValueError("student not found")
        
        mastery = await db.get_student_mastery(student_id)
        
        # Fetch quiz results via direct DB query
        async with db._get_db() as conn:
            # Get all sessions for this student
            sess_cursor = await conn.execute(
                "SELECT id, student_id, started_at, ended_at, message_count, topics_covered FROM sessions WHERE student_id = ? ORDER BY started_at DESC",
                (student_id,)
            )
            sess_rows = await sess_cursor.fetchall()
            sessions = [dict(row) for row in sess_rows]

            # Get all quiz results for this student
            qr_cursor = await conn.execute(
                "SELECT * FROM quiz_results WHERE student_id = ? ORDER BY timestamp DESC",
                (student_id,)
            )
            qr_rows = await qr_cursor.fetchall()
            quiz_results = [dict(row) for row in qr_rows]
            
            # Get all class notes for this student
            cn_cursor = await conn.execute(
                "SELECT * FROM class_notes WHERE student_id = ? ORDER BY id DESC",
                (student_id,)
            )
            cn_rows = await cn_cursor.fetchall()
            class_notes = [dict(row) for row in cn_rows]
            
            # Get all materials for this student
            mat_cursor = await conn.execute(
                "SELECT * FROM materials WHERE student_id = ? ORDER BY created_at DESC",
                (student_id,)
            )
            mat_rows = await mat_cursor.fetchall()
            materials = [dict(row) for row in mat_rows]
        
        # Fetch messages for each session and nest them in the session object
        sessions_with_messages = []
        for sess in sessions:
            session_id = sess.get("id")
            messages = await db.get_session_messages(session_id)
            sess["messages"] = messages
            sessions_with_messages.append(sess)
        
        bundle = {
            "version": "1",
            "exported_at": datetime.utcnow().isoformat() + "Z",
            "student": student,
            "topic_mastery": mastery,
            "sessions": sessions_with_messages,
            "quiz_results": quiz_results,
            "class_notes": class_notes,
            "materials": materials,
        }
        return bundle
    except Exception as err:
        raise RuntimeError(f"Failed to build student bundle: {str(err)}") from err


def bundle_to_zip_bytes(bundle: dict[str, Any], password: str) -> bytes:
    """Serialize bundle to an AES-encrypted ZIP (bytes).

    Files inside the archive:
      - manifest.json
      - student.json
      - topic_mastery.json
      - sessions.json
      - quiz_results.json
      - class_notes.json
      - materials.json
    """
    bio = io.BytesIO()
    pwd_bytes = password.encode("utf-8") if isinstance(password, str) else password
    
    with pyzipper.AESZipFile(bio, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as zf:
        zf.setpassword(pwd_bytes)
        manifest = {"version": bundle.get("version", "1"), "exported_at": bundle.get("exported_at")}
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, default=str))
        zf.writestr("student.json", json.dumps(bundle.get("student", {}), ensure_ascii=False, default=str))
        zf.writestr("topic_mastery.json", json.dumps(bundle.get("topic_mastery", []), ensure_ascii=False, default=str))
        zf.writestr("sessions.json", json.dumps(bundle.get("sessions", []), ensure_ascii=False, default=str))
        zf.writestr("quiz_results.json", json.dumps(bundle.get("quiz_results", []), ensure_ascii=False, default=str))
        zf.writestr("class_notes.json", json.dumps(bundle.get("class_notes", []), ensure_ascii=False, default=str))
        zf.writestr("materials.json", json.dumps(bundle.get("materials", []), ensure_ascii=False, default=str))
    
    bio.seek(0)
    return bio.getvalue()


async def import_zip_bytes(archive_bytes: bytes, password: str, target_student_id: str | None = None, imported_by: str | None = None) -> dict[str, Any]:
    """Import a ZIP archive into the DB.

    Restores student record, mastery, sessions, and quiz results from the archive.
    If the import is a duplicate (same fingerprint), raises ValueError.
    
    Args:
        archive_bytes: The encrypted ZIP file bytes
        password: The PIN/password to decrypt
        target_student_id: Optional override student ID (for admin imports). If not provided, uses ID from archive.
        imported_by: Teacher ID or "signup" for audit trail
        
    Returns:
        Dict with `student_id` and `fingerprint`
    """
    fingerprint = hashlib.sha256(archive_bytes).hexdigest()

    # Open archive and extract all data
    bio = io.BytesIO(archive_bytes)
    try:
        with pyzipper.AESZipFile(bio, "r") as zf:
            pwd_bytes = password.encode("utf-8") if isinstance(password, str) else password
            zf.setpassword(pwd_bytes)
            
            # Read all JSON payloads
            student_data = json.loads(zf.read("student.json"))
            mastery_data = json.loads(zf.read("topic_mastery.json").decode("utf-8"))
            sessions_data = json.loads(zf.read("sessions.json").decode("utf-8"))
            quiz_results_data = json.loads(zf.read("quiz_results.json").decode("utf-8"))
            class_notes_data = json.loads(zf.read("class_notes.json").decode("utf-8"))
            materials_data = json.loads(zf.read("materials.json").decode("utf-8"))
    except RuntimeError as exc:
        raise ValueError("The archive could not be opened — the PIN may not match or the file may be corrupt.") from exc
    except Exception as exc:
        raise ValueError(f"unable to read archive: {str(exc)}") from exc

    # Check if this archive has been imported before (duplicate detection)
    async with db._get_db() as conn:
        dup_cursor = await conn.execute(
            "SELECT student_id FROM import_history WHERE fingerprint = ? LIMIT 1",
            (fingerprint,)
        )
        dup_row = await dup_cursor.fetchone()
        if dup_row:
            raise ValueError(f"This student profile has already been imported. Student ID: {dup_row['student_id']}")
    
    # Determine the target student ID (prefer explicit target, then archived id).
    dest_id = target_student_id or student_data.get("id") or student_data.get("student_id") or uuid.uuid4().hex
    pin_visible = student_data.get("pin_visible") or password
    password_hash = student_data.get("password_hash") or _hash_pin(pin_visible)
    
    # Restore the student record and all related data via direct DB inserts
    async with db._get_db() as conn:
        # 1. Restore student record (upsert - replace if exists)
        student_data["id"] = dest_id  # Use dest_id to allow overrides
        await conn.execute("""
            INSERT OR REPLACE INTO students 
            (id, name, age, language, grade_level, username, password_hash, pin_visible, is_registered, created_at, last_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            dest_id,
            student_data.get("name"),
            student_data.get("age"),
            student_data.get("language", "en"),
            student_data.get("grade_level", "7th"),
            (student_data.get("username") or "").strip().lower() or None,
            password_hash,
            pin_visible,
            student_data.get("is_registered", 1),
            student_data.get("created_at", datetime.utcnow().isoformat()),
            student_data.get("last_active")
        ))
        
        # 2. Restore topic mastery records
        for mastery in mastery_data:
            await conn.execute("""
                INSERT OR REPLACE INTO topic_mastery
                (student_id, topic, mastery, level, last_updated)
                VALUES (?, ?, ?, ?, ?)
            """, (
                dest_id,
                mastery.get("topic"),
                mastery.get("mastery", 0.0),
                mastery.get("level", "beginner"),
                mastery.get("last_updated", datetime.utcnow().isoformat())
            ))
        
        # 3. Restore sessions and messages
        for session in sessions_data:
            session_id = session.get("id", uuid.uuid4().hex)
            await conn.execute("""
                INSERT OR REPLACE INTO sessions
                (id, student_id, started_at, ended_at, message_count, topics_covered)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                session_id,
                dest_id,
                session.get("started_at"),
                session.get("ended_at"),
                session.get("message_count", 0),
                _ensure_json_text(session.get("topics_covered"), [])
            ))
            
            # Restore messages within this session
            messages = session.get("messages", [])
            for msg in messages:
                await conn.execute("""
                    INSERT OR REPLACE INTO messages
                    (id, session_id, role, content, tool_name, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    msg.get("id", uuid.uuid4().hex),
                    session_id,
                    msg.get("role"),
                    msg.get("content"),
                    msg.get("tool_name"),
                    msg.get("timestamp", datetime.utcnow().isoformat())
                ))
        
        # 4. Restore quiz results
        for result in quiz_results_data:
            await conn.execute("""
                INSERT OR REPLACE INTO quiz_results
                (id, student_id, quiz_id, session_id, topic, question_text, student_answer, correct, score, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                result.get("id", uuid.uuid4().hex),
                dest_id,
                result.get("quiz_id"),
                result.get("session_id"),
                result.get("topic"),
                result.get("question_text"),
                result.get("student_answer"),
                result.get("correct"),
                result.get("score"),
                result.get("timestamp", datetime.utcnow().isoformat())
            ))
        
        # 5. Restore class notes (if any)
        for note in class_notes_data:
            await conn.execute("""
                INSERT OR REPLACE INTO class_notes
                (id, student_id, session_id, raw_transcript, translated_chunks, notes_text, notes_language, subject, faiss_indexed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                note.get("id", uuid.uuid4().hex),
                dest_id,
                note.get("session_id"),
                note.get("raw_transcript"),
                _ensure_json_text(note.get("translated_chunks"), []),
                note.get("notes_text"),
                note.get("notes_language"),
                note.get("subject"),
                note.get("faiss_indexed", 0)
            ))
        
        # 6. Restore materials (if any)
        for material in materials_data:
            await conn.execute("""
                INSERT OR REPLACE INTO materials
                (id, title, subject, file_path, uploaded_by, student_id, translated_text, target_language, source_language, detected_confidence, material_type, page_count, preview, tutor_summary, tutor_history, faiss_indexed, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                material.get("id", uuid.uuid4().hex),
                material.get("title"),
                material.get("subject"),
                material.get("file_path"),
                material.get("uploaded_by"),
                dest_id,
                material.get("translated_text"),
                material.get("target_language"),
                material.get("source_language"),
                material.get("detected_confidence", 0),
                material.get("material_type"),
                material.get("page_count", 1),
                material.get("preview"),
                material.get("tutor_summary"),
                _ensure_json_text(material.get("tutor_history"), []),
                material.get("faiss_indexed", 0),
                material.get("created_at", datetime.utcnow().isoformat()),
                material.get("updated_at", datetime.utcnow().isoformat())
            ))
        
        # Record this import in history to prevent duplicates
        await conn.execute("""
            INSERT OR IGNORE INTO import_history (fingerprint, student_id, imported_by)
            VALUES (?, ?, ?)
        """, (fingerprint, dest_id, imported_by or "system"))
        
        await conn.commit()
    
    return {"student_id": dest_id, "fingerprint": fingerprint}
