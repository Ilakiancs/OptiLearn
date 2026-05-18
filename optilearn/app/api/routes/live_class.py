"""
app/api/routes/live_class.py — Shared Teacher-Led Live Class.

Teacher broadcasts audio once → server transcribes once → translates once per language
→ all students on that language share the cached translation.

Teacher routes require Bearer token auth.
Student routes use student_id from request body (trusted, same as /api/translate/*).
"""
from __future__ import annotations

import asyncio
import json
import random
import string
import time
import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator

import aiosqlite
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from loguru import logger
from pydantic import BaseModel

from app.api.routes.auth import get_current_teacher
from app.api.sse import sse as _sse
from app.core.config import settings
from app.core.languages import language_display_name, language_output_issue, language_prompt_label
from app.core.prompts import OPTILEARN_26B_SYSTEM_PROMPT
from app.core.text_formatting import normalize_ai_output
from app.services import db as db_service
from app.services import faiss_store
from app.services.model_client import MODEL_SWITCH_TOKEN, route_generate_with_fallback
from app.services.model_scheduler import LANE_LIVE_CLASS_TRANSLATION
from app.services.whisper_client import transcribe_chunk

router = APIRouter(prefix="/live-class", tags=["live-class"])

# ── Per-(session,language) events — set when notes generation completes ──────
_lc_notes_ready: dict[str, asyncio.Event] = {}  # key = "{session_id}:{target_language}"

# ── In-memory teacher stream tokens (TTL 120s) ─────────────────
_stream_tokens: dict[str, tuple[str, float]] = {}  # token → (session_id, expires_at)

def _make_join_code(length: int = 6) -> str:
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# ── Translation system prompts (shared with translate.py style) ─
_TRANSLATE_SYSTEM = """\
You are OptiLearn's classroom translation engine.
Translate teacher speech for students learning in their native language.
Keep math/science terms, numbers, and examples accurate.
This is a strict conceptual translation task only.
Translate every meaningful idea in order. Do not omit, condense, reorder, or add lesson content.
Return only the final translated text. No labels, explanations, summaries, study notes, or conclusions.
Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{}.
"""

_TRANSLATE_PROMPT = """\
Target language: {lang}
Classroom context: lesson by teacher.
Useful classroom terms:
{glossary}
{quality_note}

Translate the following teacher speech to {lang}:
Preserve names, numbers, units, formulas, examples, and step-by-step order exactly.
Do not invent missing lesson content.

{transcript}"""

_LANG_NAMES = {
    "en": "English", "si": "Sinhala", "ta": "Tamil", "ar": "Arabic",
    "fr": "French", "sw": "Swahili", "so": "Somali", "am": "Amharic",
    "ti": "Tigrinya", "hi": "Hindi", "ur": "Urdu", "fa": "Dari/Farsi",
    "my": "Burmese", "th": "Thai", "bn": "Bengali", "tr": "Turkish",
    "ps": "Pashto", "rw": "Kinyarwanda", "rn": "Kirundi", "ha": "Hausa",
}

def _lang_name(code: str) -> str:
    return _LANG_NAMES.get(code, language_display_name(code))


def _lang_prompt(code: str) -> str:
    return language_prompt_label(code)


def _live_translation_glossary(target_language: str) -> str:
    glossaries = {
        "ps": (
            "- water = \u0627\u0648\u0628\u0647\n"
            "- sunlight = \u062f \u0644\u0645\u0631 \u0631\u06bc\u0627\n"
            "- plant / plants = \u0628\u0648\u067c\u06cc / \u0628\u0648\u067c\u064a\n"
            "- grow = \u0648\u062f\u0647 \u06a9\u0648\u0644\n"
            "- oxygen = \u0627\u06a9\u0633\u06cc\u062c\u0646\n"
            "- gas = \u06ab\u0627\u0632\n"
            "- need = \u0627\u0693\u062a\u06cc\u0627 \u0644\u0631\u064a\n"
            "- learn = \u0632\u062f\u0647 \u06a9\u0648\u0644"
        )
    }
    return glossaries.get(target_language, "- Keep subject terms, numbers, and formulas precise.")


# ── DB helpers (inline to avoid bloating db.py) ────────────────

async def _get_session(session_id: str) -> dict | None:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT lc.*, t.display_name AS teacher_name FROM live_classes lc "
            "LEFT JOIN teachers t ON lc.teacher_id = t.id WHERE lc.id = ?",
            (session_id,),
        )
        row = await cur.fetchone()
    return dict(row) if row else None


async def _get_active_languages(session_id: str) -> list[str]:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        cur = await conn.execute(
            "SELECT DISTINCT target_language FROM live_class_participants "
            "WHERE session_id = ? AND left_at IS NULL",
            (session_id,),
        )
        rows = await cur.fetchall()
    return [r[0] for r in rows]


async def _get_translations(session_id: str, target_language: str, after_index: int) -> list[dict]:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT chunk_index, translated_text, created_at FROM live_class_translations "
            "WHERE session_id = ? AND target_language = ? AND status = 'ready' AND chunk_index > ? "
            "ORDER BY chunk_index ASC",
            (session_id, target_language, after_index),
        )
        rows = await cur.fetchall()
    result: list[dict] = []
    for row in rows:
        item = dict(row)
        item["translated_text"] = normalize_ai_output(item.get("translated_text") or "")
        result.append(item)
    return result


async def _get_source_chunks(session_id: str, after_index: int) -> list[dict]:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT chunk_index, source_text, detected_language, created_at FROM live_class_chunks "
            "WHERE session_id = ? AND chunk_index > ? ORDER BY chunk_index ASC",
            (session_id, after_index),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def _get_participant_stats(session_id: str) -> dict:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        cur_count = await conn.execute(
            "SELECT COUNT(*) FROM live_class_participants WHERE session_id = ? AND left_at IS NULL",
            (session_id,),
        )
        count = (await cur_count.fetchone())[0]
        cur_langs = await conn.execute(
            "SELECT target_language, COUNT(*) AS n FROM live_class_participants "
            "WHERE session_id = ? AND left_at IS NULL GROUP BY target_language",
            (session_id,),
        )
        lang_rows = await cur_langs.fetchall()
    languages = {r[0]: r[1] for r in lang_rows}
    return {"participant_count": count, "languages": languages}


async def _get_notes(session_id: str, target_language: str) -> dict | None:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT * FROM live_class_notes WHERE session_id = ? AND target_language = ?",
            (session_id, target_language),
        )
        row = await cur.fetchone()
    if not row:
        return None
    item = dict(row)
    if item.get("notes_text"):
        item["notes_text"] = normalize_ai_output(item["notes_text"])
    return item


# ── Translation worker ─────────────────────────────────────────

async def _translate_and_store(session_id: str, chunk_index: int, source_text: str, target_language: str) -> None:
    lang_display = _lang_prompt(target_language)
    quality_note = ""
    translated = ""
    try:
        for attempt in range(3):
            prompt = _TRANSLATE_PROMPT.format(
                lang=lang_display,
                glossary=_live_translation_glossary(target_language),
                quality_note=quality_note,
                transcript=source_text,
            )
            parts: list[str] = []
            async for token in route_generate_with_fallback(
                prompt,
                "TRANSLATION",
                system_prompt=_TRANSLATE_SYSTEM,
                enable_thinking=False,
                ollama_options={
                    "temperature": 0.15, "top_p": 0.85, "top_k": 32,
                    "num_ctx": 2048, "num_predict": 512,
                },
                lane=LANE_LIVE_CLASS_TRANSLATION,
                feature="live_class.translate",
                profile="translation_fast",
            ):
                if token == MODEL_SWITCH_TOKEN:
                    parts = []
                    continue
                parts.append(token)
            translated = normalize_ai_output("".join(parts))
            issue = language_output_issue(translated, target_language)
            if not issue:
                break
            logger.warning(
                "Live class translation retry session={} chunk={} lang={} issue={} output={!r}",
                session_id,
                chunk_index,
                target_language,
                issue,
                translated[:120],
            )
            quality_note = (
                f"Quality correction: the previous output was rejected because {issue}. "
                f"Rewrite entirely in {lang_display}. Do not use any unrelated language or script. "
                "Preserve formulas such as H2O and O2 as plain text.\n"
            )
            translated = ""
    except Exception as exc:
        logger.error("Live class translation error chunk={} lang={}: {}", chunk_index, target_language, exc)
        translated = ""

    async with aiosqlite.connect(settings.DB_PATH) as conn:
        if translated:
            await conn.execute(
                "UPDATE live_class_translations SET translated_text=?, status='ready' "
                "WHERE session_id=? AND chunk_index=? AND target_language=?",
                (translated, session_id, chunk_index, target_language),
            )
        else:
            await conn.execute(
                "UPDATE live_class_translations SET status='error' "
                "WHERE session_id=? AND chunk_index=? AND target_language=?",
                (session_id, chunk_index, target_language),
            )
        await conn.commit()
    logger.info("live_class chunk={} lang={} translated={} chars", chunk_index, target_language, len(translated))


async def _claim_and_translate(session_id: str, chunk_index: int, source_text: str, target_language: str) -> None:
    """INSERT OR IGNORE to claim translation slot; only proceed if we won the claim."""
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        result = await conn.execute(
            "INSERT OR IGNORE INTO live_class_translations (session_id, chunk_index, target_language, status) "
            "VALUES (?, ?, ?, 'pending')",
            (session_id, chunk_index, target_language),
        )
        await conn.commit()
        claimed = result.rowcount > 0
    if claimed:
        asyncio.create_task(_translate_and_store(session_id, chunk_index, source_text, target_language))


# ── Notes generation ───────────────────────────────────────────

_NOTES_SYSTEM = """\
You create structured study notes from classroom transcripts.
Write in the target language. Use ## headings, bullet points, and end with an 'In summary:' section.
Base the notes only on the transcript. Do not invent facts, examples, dates, formulas, or conclusions.
Preserve names, numbers, units, formulas, and cause/effect relationships accurately.
Be encouraging and use grade-appropriate vocabulary.
Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{}.
"""

def _fallback_notes_lc(transcript: str) -> str:
    """Minimal structured notes from raw transcript when the model produces nothing."""
    import re
    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+|\n+", transcript)
        if len(s.strip()) > 8
    ]
    if not sentences and transcript.strip():
        sentences = [transcript.strip()]
    if not sentences:
        return "## Class notes\n- Notes are being prepared from the captured lesson."
    lines = ["## Complete lesson notes"]
    group_size = 4
    for group_index, start in enumerate(range(0, min(len(sentences), 28), group_size), start=1):
        group = sentences[start : start + group_size]
        heading_words = group[0].split()[:8]
        heading = " ".join(heading_words).strip(" .,:;") or f"Concept {group_index}"
        lines.append("")
        lines.append(f"## {heading}")
        lines.extend(f"- {point}" for point in group if point)
    step = max(1, len(sentences) // 5)
    summary = [sentences[i] for i in range(0, len(sentences), step)][:5]
    lines.append("")
    lines.append("In summary:")
    lines.extend(f"- {point}" for point in summary if point)
    return "\n".join(lines).strip()


def _notes_coverage_ok(notes: str, transcript: str) -> bool:
    import re
    def wc(t: str) -> int:
        return len([w for w in re.split(r"\s+", t.strip()) if w])
    tw = wc(transcript)
    nw = wc(notes)
    if "In summary:" not in notes:
        return False
    if tw < 80:
        return nw >= 50
    return nw >= min(260, max(120, tw // 3))


async def _generate_class_notes(session_id: str, target_language: str) -> None:
    key = f"{session_id}:{target_language}"
    try:
        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(
                """
                SELECT
                    lcc.source_text,
                    lct.translated_text
                FROM live_class_chunks lcc
                LEFT JOIN live_class_translations lct
                    ON lct.session_id = lcc.session_id
                   AND lct.chunk_index = lcc.chunk_index
                   AND lct.target_language = ?
                   AND lct.status = 'ready'
                WHERE lcc.session_id=?
                ORDER BY lcc.chunk_index ASC
                """,
                (target_language, session_id),
            )
            rows = await cur.fetchall()
        transcript = "\n".join(
            normalize_ai_output(r["translated_text"] or r["source_text"] or "")
            for r in rows
            if (r["translated_text"] or r["source_text"])
        )
        if not transcript.strip():
            async with aiosqlite.connect(settings.DB_PATH) as conn:
                await conn.execute(
                    "UPDATE live_class_notes SET status='error' WHERE session_id=? AND target_language=?",
                    (session_id, target_language),
                )
                await conn.commit()
            return

        lang_display = _lang_prompt(target_language)
        prompt = (
            f"Target language: {lang_display}\n\n"
            "Create structured study notes from this class transcript.\n"
            "Use ## headings, short bullet points, and an 'In summary:' section.\n"
            "Cover the transcript from beginning to end.\n"
            "Base notes only on the transcript; do not invent facts, examples, dates, formulas, or conclusions.\n"
            "Preserve names, numbers, units, formulas, and cause/effect relationships accurately.\n"
            "Do not include hidden reasoning or commentary.\n\n"
            f"{transcript[:4000]}"
        )
        parts: list[str] = []
        try:
            async for token in route_generate_with_fallback(
                prompt, "TRANSLATION",
                system_prompt=_NOTES_SYSTEM,
                enable_thinking=False,
                ollama_options={"temperature": 0.3, "num_ctx": 4096, "num_predict": 1024},
                lane=LANE_LIVE_CLASS_TRANSLATION,
                feature="live_class.notes",
                profile="translation_fast",
            ):
                if token != MODEL_SWITCH_TOKEN:
                    parts.append(token)
            notes = normalize_ai_output("".join(parts))
        except Exception as exc:
            logger.error("Live class notes model error lang={}: {}", target_language, exc)
            notes = ""

        if not notes:
            logger.warning("live_class notes: using fallback for session={} lang={}", session_id, target_language)
            notes = _fallback_notes_lc(transcript)
        elif not _notes_coverage_ok(notes, transcript):
            logger.warning("live_class notes: thin coverage, appending fallback session={}", session_id)
            notes = f"{notes.strip()}\n\n{_fallback_notes_lc(transcript)}".strip()
        notes = normalize_ai_output(notes)

        async with aiosqlite.connect(settings.DB_PATH) as conn:
            if notes:
                await conn.execute(
                    "UPDATE live_class_notes SET notes_text=?, status='ready' "
                    "WHERE session_id=? AND target_language=?",
                    (notes, session_id, target_language),
                )
            else:
                await conn.execute(
                    "UPDATE live_class_notes SET status='error' "
                    "WHERE session_id=? AND target_language=?",
                    (session_id, target_language),
                )
            await conn.commit()

        # Signal the notes-stream SSE endpoint that notes are ready.
        ev = _lc_notes_ready.get(key)
        if ev and not ev.is_set():
            ev.set()

        # Index into FAISS so the AI tutor can answer questions about this lesson.
        if notes:
            try:
                async with aiosqlite.connect(settings.DB_PATH) as conn:
                    cur2 = await conn.execute(
                        "SELECT student_id FROM live_class_participants "
                        "WHERE session_id=? AND target_language=? LIMIT 1",
                        (session_id, target_language),
                    )
                    row = await cur2.fetchone()
                student_id = row[0] if row else None

                paragraphs = [
                    p.strip() for p in notes.split("\n\n")
                    if p.strip() and len(p.strip()) > 20
                ]
                if paragraphs and student_id:
                    await asyncio.to_thread(
                        faiss_store.add_passages,
                        [
                            {
                                "text": p,
                                "source": "live_class_note",
                                "student_id": student_id,
                                "session_id": session_id,
                            }
                            for p in paragraphs
                        ],
                    )
                    logger.info("live_class FAISS indexed {} paragraphs for session={}", len(paragraphs), session_id)
            except Exception as exc:
                logger.warning("live_class FAISS indexing skipped for session {}: {}", session_id, exc)

        logger.info("live_class notes ready session={} lang={} chars={}", session_id, target_language, len(notes))
    finally:
        ev = _lc_notes_ready.get(key)
        if ev and not ev.is_set():
            ev.set()


# ─────────────────────────────────────────────────────────────────
# Teacher routes
# ─────────────────────────────────────────────────────────────────

class StartLiveClassRequest(BaseModel):
    title: str
    subject: str = ""
    source_language: str = "en"
    audience_type: str = "all"
    audience_ids: list[str] = []


@router.post("/start")
async def start_live_class(
    body: StartLiveClassRequest,
    teacher: dict = Depends(get_current_teacher),
) -> dict:
    join_code = _make_join_code()
    session_id = str(uuid.uuid4())[:16].replace("-", "")
    now = _now_iso()
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute(
            "INSERT INTO live_classes (id, teacher_id, title, subject, source_language, "
            "audience_type, audience_ids, join_code, status, created_at, started_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
            (
                session_id, teacher["id"], body.title, body.subject,
                body.source_language, body.audience_type,
                json.dumps(body.audience_ids), join_code, now, now,
            ),
        )
        await conn.commit()
    logger.info("Live class started: {} by teacher {}", session_id, teacher["id"])
    return {"session_id": session_id, "join_code": join_code, "status": "active"}


@router.post("/{session_id}/audio-chunk")
async def upload_audio_chunk(
    session_id: str,
    audio: UploadFile = File(...),
    chunk_index: int = Form(...),
    hint_language: str | None = Form(default=None),
    teacher: dict = Depends(get_current_teacher),
) -> dict:
    session = await _get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=403, detail="Not your session.")
    if session["status"] not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Session is not active.")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio chunk.")

    source_text = await transcribe_chunk(audio_bytes, hint_language or session.get("source_language"))
    if not source_text or not source_text.strip():
        return {"chunk_index": chunk_index, "source_text": "", "detected_language": None, "skipped": True}

    source_text = source_text.strip()
    detected = hint_language or session.get("source_language", "en")

    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute(
            "INSERT OR IGNORE INTO live_class_chunks (session_id, chunk_index, source_text, detected_language, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, chunk_index, source_text, detected, _now_iso()),
        )
        await conn.commit()

    # Trigger translation for each active participant language
    active_languages = await _get_active_languages(session_id)
    for lang in active_languages:
        await _claim_and_translate(session_id, chunk_index, source_text, lang)

    return {"chunk_index": chunk_index, "source_text": source_text, "detected_language": detected}


@router.post("/{session_id}/pause")
async def pause_live_class(session_id: str, teacher: dict = Depends(get_current_teacher)) -> dict:
    session = await _get_session(session_id)
    if not session or session["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=404, detail="Session not found.")
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute("UPDATE live_classes SET status='paused' WHERE id=?", (session_id,))
        await conn.commit()
    return {"status": "paused"}


@router.post("/{session_id}/resume")
async def resume_live_class(session_id: str, teacher: dict = Depends(get_current_teacher)) -> dict:
    session = await _get_session(session_id)
    if not session or session["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=404, detail="Session not found.")
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute("UPDATE live_classes SET status='active' WHERE id=?", (session_id,))
        await conn.commit()
    return {"status": "active"}


@router.post("/{session_id}/end")
async def end_live_class(session_id: str, teacher: dict = Depends(get_current_teacher)) -> dict:
    session = await _get_session(session_id)
    if not session or session["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=404, detail="Session not found.")
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute(
            "UPDATE live_classes SET status='ended', ended_at=? WHERE id=?",
            (_now_iso(), session_id),
        )
        await conn.commit()

    # Generate notes per unique language used in the session
    active_languages = await _get_active_languages(session_id)
    # Also get languages from left participants
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        cur = await conn.execute(
            "SELECT DISTINCT target_language FROM live_class_participants WHERE session_id=?",
            (session_id,),
        )
        rows = await cur.fetchall()
    all_languages = list({r[0] for r in rows} | set(active_languages))

    for lang in all_languages:
        async with aiosqlite.connect(settings.DB_PATH) as conn:
            await conn.execute(
                "INSERT OR IGNORE INTO live_class_notes (session_id, target_language, status) VALUES (?, ?, 'pending')",
                (session_id, lang),
            )
            await conn.commit()
        key = f"{session_id}:{lang}"
        if key not in _lc_notes_ready:
            _lc_notes_ready[key] = asyncio.Event()
        asyncio.create_task(_generate_class_notes(session_id, lang))

    logger.info("Live class ended: {} — generating notes for {} languages", session_id, len(all_languages))
    return {"status": "ended", "languages_count": len(all_languages)}


@router.post("/{session_id}/stream-token")
async def get_stream_token(session_id: str, teacher: dict = Depends(get_current_teacher)) -> dict:
    """Issue a short-lived token for the teacher SSE stream (EventSource cannot send auth headers)."""
    session = await _get_session(session_id)
    if not session or session["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=404, detail="Session not found.")
    token = "".join(random.choices(string.ascii_letters + string.digits, k=32))
    _stream_tokens[token] = (session_id, time.time() + 120)
    # Prune expired tokens
    expired = [t for t, (_, exp) in _stream_tokens.items() if time.time() > exp]
    for t in expired:
        _stream_tokens.pop(t, None)
    return {"token": token}


async def _teacher_stream_generator(session_id: str) -> AsyncGenerator[str, None]:
    last_chunk = -1
    while True:
        session = await _get_session(session_id)
        status = (session or {}).get("status", "ended")

        new_chunks = await _get_source_chunks(session_id, last_chunk)
        for chunk in new_chunks:
            yield _sse({"type": "source_chunk", "chunk_index": chunk["chunk_index"],
                        "text": chunk["source_text"], "timestamp": chunk["created_at"]})
            last_chunk = chunk["chunk_index"]

        stats = await _get_participant_stats(session_id)
        yield _sse({"type": "stats", **stats})

        if status == "ended":
            yield _sse({"type": "session_ended"})
            break

        await asyncio.sleep(2)


@router.get("/{session_id}/teacher-stream")
async def teacher_stream(session_id: str, token: str = "") -> StreamingResponse:
    entry = _stream_tokens.get(token)
    if not entry or entry[0] != session_id or time.time() > entry[1]:
        raise HTTPException(status_code=401, detail="Invalid or expired stream token.")
    return StreamingResponse(
        _teacher_stream_generator(session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─────────────────────────────────────────────────────────────────
# Student routes (no auth — student_id trusted from body)
# ─────────────────────────────────────────────────────────────────

@router.get("/active")
async def get_active_sessions() -> list[dict]:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT lc.id, lc.title, lc.subject, lc.source_language, lc.join_code, lc.status, lc.started_at, "
            "t.display_name AS teacher_display_name, "
            "(SELECT COUNT(*) FROM live_class_participants p WHERE p.session_id=lc.id AND p.left_at IS NULL) AS participant_count "
            "FROM live_classes lc LEFT JOIN teachers t ON lc.teacher_id=t.id "
            "WHERE lc.status IN ('active','paused') ORDER BY lc.started_at DESC",
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


class JoinRequest(BaseModel):
    student_id: str
    target_language: str = "en"


@router.post("/{session_id}/join")
async def join_session(session_id: str, body: JoinRequest) -> dict:
    session = await _get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session["status"] not in ("active", "paused"):
        raise HTTPException(status_code=400, detail="Session has ended.")

    now = _now_iso()
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute(
            "INSERT OR REPLACE INTO live_class_participants "
            "(id, session_id, student_id, target_language, joined_at, last_seen_at) "
            "VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?)",
            (session_id, body.student_id, body.target_language, now, now),
        )
        # Get total chunks already transcribed for catch-up count
        cur = await conn.execute(
            "SELECT COUNT(*) FROM live_class_chunks WHERE session_id=?", (session_id,)
        )
        existing_count = (await cur.fetchone())[0]
        # Get chunks not yet translated to this language (bounded catch-up)
        cur2 = await conn.execute(
            "SELECT chunk_index, source_text FROM live_class_chunks lcc "
            "WHERE lcc.session_id=? AND NOT EXISTS ("
            "  SELECT 1 FROM live_class_translations lct "
            "  WHERE lct.session_id=lcc.session_id AND lct.chunk_index=lcc.chunk_index "
            "  AND lct.target_language=?) ORDER BY chunk_index ASC LIMIT 10",
            (session_id, body.target_language),
        )
        unclaimed = await cur2.fetchall()
        await conn.commit()

    # Trigger catch-up translation for up to 10 unclaimed chunks
    for row in unclaimed:
        await _claim_and_translate(session_id, row[0], row[1], body.target_language)

    return {
        "session_id": session_id,
        "target_language": body.target_language,
        "existing_chunk_count": existing_count,
        "status": session["status"],
    }


async def _student_stream_generator(session_id: str, student_id: str, target_language: str) -> AsyncGenerator[str, None]:
    # 1. Catch-up: send all ready translations for this language in chunk order
    existing = await _get_translations(session_id, target_language, after_index=-1)
    for t in existing:
        yield _sse({"type": "translated_chunk", "chunk_index": t["chunk_index"],
                    "text": t["translated_text"], "timestamp": t["created_at"]})
    last_sent = max((t["chunk_index"] for t in existing), default=-1)

    # 2. Live polling
    while True:
        session = await _get_session(session_id)
        status = (session or {}).get("status", "ended")

        new = await _get_translations(session_id, target_language, after_index=last_sent)
        for t in new:
            yield _sse({"type": "translated_chunk", "chunk_index": t["chunk_index"],
                        "text": t["translated_text"], "timestamp": t["created_at"]})
            last_sent = t["chunk_index"]

        yield _sse({"type": "session_status", "status": status})

        if status == "ended":
            notes = await _get_notes(session_id, target_language)
            if notes and notes.get("status") == "ready":
                yield _sse({"type": "notes_ready", "notes_text": notes["notes_text"]})
            break

        # Update heartbeat
        try:
            async with aiosqlite.connect(settings.DB_PATH) as conn:
                await conn.execute(
                    "UPDATE live_class_participants SET last_seen_at=? WHERE session_id=? AND student_id=?",
                    (_now_iso(), session_id, student_id),
                )
                await conn.commit()
        except Exception:
            pass

        await asyncio.sleep(1)


@router.get("/{session_id}/stream")
async def student_stream(session_id: str, student_id: str = "", target_language: str = "en") -> StreamingResponse:
    session = await _get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    return StreamingResponse(
        _student_stream_generator(session_id, student_id, target_language),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class LanguageRequest(BaseModel):
    student_id: str
    target_language: str


@router.post("/{session_id}/language")
async def change_language(session_id: str, body: LanguageRequest) -> dict:
    now = _now_iso()
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute(
            "UPDATE live_class_participants SET target_language=?, last_seen_at=? "
            "WHERE session_id=? AND student_id=?",
            (body.target_language, now, session_id, body.student_id),
        )
        # Fetch unclaimed chunks for new language (bounded)
        cur = await conn.execute(
            "SELECT chunk_index, source_text FROM live_class_chunks lcc "
            "WHERE lcc.session_id=? AND NOT EXISTS ("
            "  SELECT 1 FROM live_class_translations lct "
            "  WHERE lct.session_id=lcc.session_id AND lct.chunk_index=lcc.chunk_index "
            "  AND lct.target_language=?) ORDER BY chunk_index ASC LIMIT 10",
            (session_id, body.target_language),
        )
        unclaimed = await cur.fetchall()
        await conn.commit()

    for row in unclaimed:
        await _claim_and_translate(session_id, row[0], row[1], body.target_language)

    return {"target_language": body.target_language}


class LeaveRequest(BaseModel):
    student_id: str


@router.post("/{session_id}/leave")
async def leave_session(session_id: str, body: LeaveRequest) -> dict:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        await conn.execute(
            "UPDATE live_class_participants SET left_at=? WHERE session_id=? AND student_id=?",
            (_now_iso(), session_id, body.student_id),
        )
        await conn.commit()
    return {"status": "left"}


@router.get("/{session_id}/notes")
async def get_session_notes(session_id: str, target_language: str = "en") -> dict:
    notes = await _get_notes(session_id, target_language)
    if not notes:
        raise HTTPException(status_code=404, detail="Notes not found for this language.")
    return notes


# ─────────────────────────────────────────────────────────────────
# New endpoints — student parity + teacher post-session
# ─────────────────────────────────────────────────────────────────

# ── GET /student/{student_id}/sessions ────────────────────────
# Must be declared before any /{session_id}/... routes to avoid shadowing.
# (Placed last here but router registration order still works because
# "student" is a literal prefix, not a path param conflict.)

@router.get("/student/{student_id}/sessions")
async def student_past_sessions(student_id: str) -> list[dict]:
    """List live class sessions a student has attended (last 30)."""
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            """
            SELECT
                lc.id          AS session_id,
                lc.title,
                lc.subject,
                lc.source_language,
                lcp.target_language,
                lcp.joined_at,
                SUBSTR(lcn.notes_text, 1, 200)  AS notes_preview,
                lcn.status                       AS notes_status
            FROM live_class_participants lcp
            JOIN live_classes lc ON lc.id = lcp.session_id
            LEFT JOIN live_class_notes lcn
                ON lcn.session_id = lcp.session_id
               AND lcn.target_language = lcp.target_language
            WHERE lcp.student_id = ?
            ORDER BY lcp.joined_at DESC
            LIMIT 30
            """,
            (student_id,),
        )
        rows = await cur.fetchall()
    result: list[dict] = []
    for row in rows:
        item = dict(row)
        item["notes_preview"] = normalize_ai_output(item.get("notes_preview") or "")
        result.append(item)
    return result


# ── GET /{session_id}/source-chunks ───────────────────────────

@router.get("/{session_id}/source-chunks")
async def get_source_chunks(session_id: str) -> list[dict]:
    """Return the teacher's original-language transcript chunks (available after session ends)."""
    session = await _get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT chunk_index, source_text, detected_language, created_at "
            "FROM live_class_chunks WHERE session_id=? ORDER BY chunk_index ASC",
            (session_id,),
        )
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


# ── GET /{session_id}/notes-stream ────────────────────────────

@router.get("/{session_id}/notes-stream")
async def live_class_notes_stream(session_id: str, target_language: str = "en") -> StreamingResponse:
    """Stream notes word-by-word as they are generated. Waits up to 120 s."""
    async def event_stream() -> AsyncGenerator[str, None]:
        key = f"{session_id}:{target_language}"
        # Check if notes already exist.
        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(
                "SELECT notes_text FROM live_class_notes WHERE session_id=? AND target_language=?",
                (session_id, target_language),
            )
            row = await cur.fetchone()

        if row and row["notes_text"]:
            notes = normalize_ai_output(row["notes_text"])
        else:
            if key not in _lc_notes_ready:
                _lc_notes_ready[key] = asyncio.Event()
            try:
                await asyncio.wait_for(_lc_notes_ready[key].wait(), timeout=120.0)
            except asyncio.TimeoutError:
                yield _sse({"type": "error", "message": "Note generation timed out."})
                return

            async with aiosqlite.connect(settings.DB_PATH) as conn:
                conn.row_factory = aiosqlite.Row
                cur = await conn.execute(
                    "SELECT notes_text FROM live_class_notes WHERE session_id=? AND target_language=?",
                    (session_id, target_language),
                )
                row = await cur.fetchone()

            if not row or not row["notes_text"]:
                yield _sse({"type": "error", "message": "Notes unavailable."})
                return
            notes = normalize_ai_output(row["notes_text"])

        words = notes.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield _sse({"type": "token", "content": chunk})
            if i % 15 == 0:
                await asyncio.sleep(0.008)

        yield _sse({"type": "done"})
        _lc_notes_ready.pop(key, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── GET /{session_id}/translations ────────────────────────────

@router.get("/{session_id}/translations")
async def get_session_translations(session_id: str, target_language: str = "en") -> list[dict]:
    """Return ready translated chunks for a student to reconstruct the transcript."""
    return await _get_translations(session_id, target_language, after_index=-1)


# ── GET /{session_id}/completion-status ───────────────────────

@router.get("/{session_id}/completion-status")
async def get_completion_status(
    session_id: str,
    teacher: dict = Depends(get_current_teacher),
) -> dict:
    """Return per-language translation progress for the teacher's post-session view."""
    session = await _get_session(session_id)
    if not session or session["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=404, detail="Session not found.")

    async with aiosqlite.connect(settings.DB_PATH) as conn:
        # Total chunks transcribed
        cur = await conn.execute(
            "SELECT COUNT(*) FROM live_class_chunks WHERE session_id=?", (session_id,)
        )
        total_chunks = (await cur.fetchone())[0]

        # Per-language participant count
        cur2 = await conn.execute(
            "SELECT target_language, COUNT(*) AS n FROM live_class_participants "
            "WHERE session_id=? GROUP BY target_language",
            (session_id,),
        )
        participant_rows = await cur2.fetchall()

        # Per-language ready translation count
        cur3 = await conn.execute(
            "SELECT target_language, COUNT(*) AS n FROM live_class_translations "
            "WHERE session_id=? AND status='ready' GROUP BY target_language",
            (session_id,),
        )
        ready_rows = await cur3.fetchall()

    participant_map = {r[0]: r[1] for r in participant_rows}
    ready_map = {r[0]: r[1] for r in ready_rows}

    languages = {}
    for lang, count in participant_map.items():
        ready = ready_map.get(lang, 0)
        languages[lang] = {
            "participant_count": count,
            "ready_chunks": ready,
            "total_chunks": total_chunks,
            "complete": total_chunks > 0 and ready >= total_chunks,
        }

    all_complete = bool(languages) and all(v["complete"] for v in languages.values())
    return {
        "total_chunks": total_chunks,
        "languages": languages,
        "all_complete": all_complete,
    }


# ── POST /{session_id}/export-transcript (teacher) ────────────

@router.post("/{session_id}/export-transcript")
async def export_teacher_transcript(
    session_id: str,
    teacher: dict = Depends(get_current_teacher),
) -> Response:
    """Download the source-language transcript as a PDF (teacher only)."""
    from app.api.routes.translate import _render_notes_pdf

    session = await _get_session(session_id)
    if not session or session["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=404, detail="Session not found.")

    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT source_text FROM live_class_chunks WHERE session_id=? ORDER BY chunk_index ASC",
            (session_id,),
        )
        rows = await cur.fetchall()

    content_text = "\n\n".join(r["source_text"] for r in rows if r["source_text"])
    if not content_text:
        raise HTTPException(status_code=400, detail="No transcript available yet.")

    from datetime import datetime as _dt
    date_str = _dt.utcnow().strftime("%Y-%m-%d")
    title = f"{session.get('title', 'Class')} — Transcript {date_str}"
    teacher_as_student = {
        "name": teacher.get("display_name") or "Teacher",
        "grade_level": "",
        "language": session.get("source_language", "en"),
    }
    return _render_notes_pdf(
        title=title,
        content_text=content_text,
        content_type="transcript",
        target_language=session.get("source_language", "en"),
        student=teacher_as_student,
    )


# ── POST /export (student — notes or transcript) ───────────────

class LiveClassExportRequest(BaseModel):
    session_id: str
    student_id: str
    export_type: str = "notes"  # "notes" | "transcript"
    target_language: str = "en"


@router.post("/export")
async def export_live_class_pdf(body: LiveClassExportRequest) -> Response:
    """Download live class notes or translated transcript as a PDF (student)."""
    from app.api.routes.translate import _render_notes_pdf
    from datetime import datetime as _dt

    student = await db_service.get_student(body.student_id)
    if not student:
        student = {"name": "Student", "grade_level": "", "language": body.target_language}

    date_str = _dt.utcnow().strftime("%Y-%m-%d")

    if body.export_type == "notes":
        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(
                "SELECT notes_text FROM live_class_notes "
                "WHERE session_id=? AND target_language=?",
                (body.session_id, body.target_language),
            )
            row = await cur.fetchone()
        if not row or not row["notes_text"]:
            raise HTTPException(status_code=400, detail="Notes not ready yet.")
        content_text = normalize_ai_output(row["notes_text"])
        title = f"Class Notes — {date_str}"
        content_type = "notes"
    else:
        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(
                "SELECT translated_text FROM live_class_translations "
                "WHERE session_id=? AND target_language=? AND status='ready' "
                "ORDER BY chunk_index ASC",
                (body.session_id, body.target_language),
            )
            rows = await cur.fetchall()
        if not rows:
            raise HTTPException(status_code=400, detail="Transcript not available yet.")
        content_text = normalize_ai_output(
            "\n\n".join(r["translated_text"] for r in rows if r["translated_text"])
        )
        title = f"Translated Transcript — {date_str}"
        content_type = "transcript"

    return _render_notes_pdf(
        title=title,
        content_text=content_text,
        content_type=content_type,
        target_language=body.target_language,
        student=student,
    )
