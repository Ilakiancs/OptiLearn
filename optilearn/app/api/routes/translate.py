"""
app/api/routes/translate.py — Feature 2: Live Class Translator and Note-Taker.

Routes:
    POST /api/translate/start                 — create session, return session_id
    POST /api/translate/chunk                 — WAV → transcribe → translate (SSE)
    POST /api/translate/end                   — assemble transcript, trigger notes
    GET  /api/translate/sessions/{student_id} — list past sessions
    GET  /api/translate/{session_id}/notes    — stream generated notes (SSE)
    GET  /api/translate/{session_id}          — return completed session data
    POST /api/translate/export-notes          — PDF export (notes or transcript)
"""
from __future__ import annotations

import asyncio
import html
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator
from urllib.parse import quote

import aiosqlite
import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from loguru import logger
from pydantic import BaseModel

from app.core.config import settings
from app.core.grades import normalize_grade_level
from app.core.languages import language_display_name, language_output_issue, language_prompt_label
from app.core.prompts import OPTILEARN_26B_SYSTEM_PROMPT
from app.core.text_formatting import normalize_ai_output
from app.api.sse import sse as _sse
from app.services import db, faiss_store, generated_cache, job_manager
from app.services.model_client import MODEL_SWITCH_TOKEN, ensure_ollama_model, has_26b_api_key, is_force_offline, route_generate_with_fallback
from app.services.whisper_client import (
    get_transcriber_status,
    transcribe_chunk,
    warmup_transcriber,
)

router = APIRouter(prefix="/api/translate", tags=["translate"])

# In-memory events keyed by session_id — set when notes generation completes.
_notes_ready: dict[str, asyncio.Event] = {}
_translation_model_ready = False
_translation_model_loading = False
_translation_model_error = ""
_translation_model_lock = asyncio.Lock()
_live_warmup_task: asyncio.Task | None = None


def _translation_model_status() -> dict:
    if not is_force_offline() and has_26b_api_key():
        return {
            "ready": True,
            "loading": False,
            "model": settings.GEMMA_26B_MODEL,
            "error": "",
        }
    return {
        "ready": _translation_model_ready,
        "loading": _translation_model_loading,
        "model": settings.OLLAMA_MODEL_FAST,
        "error": _translation_model_error,
    }


def _live_translation_status() -> dict:
    asr = get_transcriber_status()
    text_model = _translation_model_status()
    ready = asr["ready"] and text_model["ready"]
    loading = asr["loading"] or text_model["loading"]
    active = asr if not asr["ready"] else text_model
    return {
        "ready": ready,
        "loading": loading,
        "backend": asr["backend"],
        "model": active["model"],
        "error": asr["error"] or text_model["error"],
        "speech": asr,
        "translation": text_model,
    }


async def warmup_translation_model() -> dict:
    global _translation_model_error, _translation_model_loading, _translation_model_ready  # noqa: PLW0603
    if not is_force_offline() and has_26b_api_key():
        _translation_model_ready = True
        _translation_model_error = ""
        return _translation_model_status()

    async with _translation_model_lock:
        if _translation_model_ready:
            return _translation_model_status()
        _translation_model_loading = True
        _translation_model_error = ""
        try:
            present = await ensure_ollama_model(settings.OLLAMA_MODEL_FAST)
            if not present:
                # Online mode and model not local — API will handle requests
                _translation_model_ready = True
                logger.info("Local model not present; will use API for translation")
            else:
                # Model is present — send a cheap keep-alive ping to load it into RAM
                payload = {
                    "model": settings.OLLAMA_MODEL_FAST,
                    "prompt": "ready",
                    "stream": False,
                    "keep_alive": "60m",
                    "options": {"num_predict": 1, "temperature": 0},
                }
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(connect=5.0, read=90.0, write=10.0, pool=5.0)
                ) as client:
                    response = await client.post(f"{settings.OLLAMA_HOST}/api/generate", json=payload)
                if response.status_code != 200:
                    raise RuntimeError(f"Ollama warmup failed with status {response.status_code}")
                _translation_model_ready = True
                logger.info("Live translation text model ready: {}", settings.OLLAMA_MODEL_FAST)
        except Exception as exc:
            _translation_model_error = repr(exc)
            logger.error("Live translation text model warmup error: {!r}", exc)
        finally:
            _translation_model_loading = False
    return _translation_model_status()


async def warmup_live_translation_models() -> dict:
    await asyncio.gather(
        warmup_transcriber(),
        warmup_translation_model(),
        return_exceptions=True,
    )
    return _live_translation_status()


def _start_live_translation_warmup() -> None:
    global _live_warmup_task  # noqa: PLW0603
    if _live_warmup_task and not _live_warmup_task.done():
        return
    if _live_translation_status()["ready"]:
        return
    _live_warmup_task = asyncio.create_task(warmup_live_translation_models())


@router.get("/status")
async def translate_status() -> dict:
    """Readiness probe for live classroom translation."""
    return _live_translation_status()


@router.post("/warmup")
async def translate_warmup() -> dict:
    """Start live translation warmup without blocking the UI."""
    _start_live_translation_warmup()
    status = _live_translation_status()
    return {**status, "loading": True} if not status["ready"] else status


# ──────────────────────────────────────────────────────────────
# Language name map (reuse feature1's full list)
# ──────────────────────────────────────────────────────────────
def _build_lang_map() -> dict[str, str]:
    try:
        from app.api.routes.feature1 import _LANG_NAME
        return dict(_LANG_NAME)
    except Exception:
        return {}

_LANG_NAME: dict[str, str] = {}


def _lang_name(code: str) -> str:
    if not _LANG_NAME:
        _LANG_NAME.update(_build_lang_map())
    return _LANG_NAME.get(code, language_display_name(code))


def _lang_prompt(code: str) -> str:
    return language_prompt_label(code)


# ──────────────────────────────────────────────────────────────
# Audio transcription + text translation
# ──────────────────────────────────────────────────────────────
_AUDIO_PROMPT = """\
Listen to this audio. Do two things:
1. Transcribe exactly what is spoken
2. Translate the transcription into {lang} for a grade {grade} student aged {age}

Respond in this exact format with no other text:
ORIGINAL: <transcription here>
TRANSLATED: <translation here>"""

_TRANSLATE_SYSTEM_PROMPT = """\
You are OptiLearn's classroom translation engine.
You translate teacher transcripts for displaced students.
Silently repair obvious speech-to-text errors using classroom context.
Keep math/science names, numbers, and examples accurate.
Return only the final student-facing translation.
This is a strict conceptual translation task only.
Translate every meaningful idea in order. Do not omit, condense, reorder, or add lesson content.
Do not summarize, explain, add notes, add examples, add labels, or add bullets unless they are in the lesson text.
Do not include reasoning or commentary.
Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{}.
Use supportive wording and avoid discouraging labels.
"""

_TRANSLATE_TEXT_PROMPT = """\
Target language: {lang}
Student level: grade {grade}, age {age}
Useful classroom terms:
{glossary}
{quality_note}

Clean up the transcript just enough to make the teacher's meaning clear, then translate it.
If a phrase is incomplete, connect it naturally to the surrounding idea without inventing new lesson content.
Preserve names, numbers, units, formulas, examples, and step-by-step order exactly.
Translate the transcript once only. Do not add summaries, study notes, or conclusions.
Return only the translated classroom script.

Transcript:
{transcript}"""

_TRANSCRIPT_GROUP_MAX_CHARS = 650


def _translation_glossary(target_language: str) -> str:
    glossaries = {
        "si": (
            "- fraction = භාගය\n"
            "- numerator / top number = ලවය\n"
            "- denominator / bottom number = හරය\n"
            "- equivalent fractions = සමාන භාග\n"
            "- whole = සම්පූර්ණය\n"
            "- part = කොටස\n"
            "- one half = අඩක් / දෙකෙන් එක\n"
            "- two over four = හතරෙන් දෙක"
        ),
        "ps": (
            "- water = \u0627\u0648\u0628\u0647\n"
            "- sunlight = \u062f \u0644\u0645\u0631 \u0631\u06bc\u0627\n"
            "- plant / plants = \u0628\u0648\u067c\u06cc / \u0628\u0648\u067c\u064a\n"
            "- grow = \u0648\u062f\u0647 \u06a9\u0648\u0644\n"
            "- oxygen = \u0627\u06a9\u0633\u06cc\u062c\u0646\n"
            "- gas = \u06ab\u0627\u0632\n"
            "- need = \u0627\u0693\u062a\u06cc\u0627 \u0644\u0631\u064a\n"
            "- learn = \u0632\u062f\u0647 \u06a9\u0648\u0644"
        ),
    }
    return glossaries.get(target_language, "- Keep subject terms and numbers precise.")


def _parse_audio_response(response_text: str) -> tuple[str, str]:
    """Parse ORIGINAL:/TRANSLATED: format. Falls back to treating full text as translation."""
    if "ORIGINAL:" in response_text and "TRANSLATED:" in response_text:
        parts = response_text.split("TRANSLATED:")
        translated = parts[1].strip()
        original = parts[0].replace("ORIGINAL:", "").strip()
        return original, translated
    if response_text.strip():
        return "", response_text.strip()
    return "", ""


async def transcribe_and_translate_audio(
    audio_bytes: bytes,
    target_language: str,
    grade_level: str | int,
    age: int,
    hint_language: str | None = None,
) -> tuple[str, str]:
    """Return (original_text, translated_text). Both empty if audio is not understood."""
    if not audio_bytes:
        return "", ""
    original = await transcribe_chunk(audio_bytes, hint_language)
    if not original:
        return "", ""
    translated, _ = await _translate_text(original, target_language, grade_level, age)
    return original, translated or original


def _clean_model_text(text: str) -> str:
    text = re.sub(r"<\|channel>thought.*?<channel\|>", "", text or "", flags=re.DOTALL)
    text = re.sub(r"<\|.*?\|>", "", text)
    text = text.replace("TRANSLATED:", "").replace("Translation:", "").strip()
    return normalize_ai_output(text)


def _normalize_translated_chunk(chunk: dict) -> dict:
    cleaned = dict(chunk)
    translated = cleaned.get("translated")
    if isinstance(translated, str):
        cleaned["translated"] = normalize_ai_output(translated)
    return cleaned


async def _call_ollama_translation(
    transcript: str,
    target_language: str,
    grade_level: str | int,
    age: int,
    *,
    num_predict: int,
) -> str:
    lang_display = _lang_prompt(target_language)
    payload = {
        "model": settings.OLLAMA_MODEL_FAST,
        "system": _TRANSLATE_SYSTEM_PROMPT,
        "prompt": _TRANSLATE_TEXT_PROMPT.format(
            lang=lang_display,
            grade=grade_level,
            age=age,
            glossary=_translation_glossary(target_language),
            quality_note="",
            transcript=transcript,
        ),
        "stream": False,
        "keep_alive": "60m",
        "options": {
            "temperature": 0.15,
            "top_p": 0.85,
            "top_k": 32,
            "num_ctx": 2048,
            "num_predict": num_predict,
        },
    }
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=5.0)
    ) as client:
        response = await client.post(f"{settings.OLLAMA_HOST}/api/generate", json=payload)
    if response.status_code != 200:
        logger.error("Ollama text translation failed: status={}", response.status_code)
        return ""
    data = response.json()
    result = _clean_model_text(data.get("response", ""))
    if not result:
        logger.warning(
            "Ollama returned empty translation: done_reason={} eval_count={}",
            data.get("done_reason"),
            data.get("eval_count"),
        )
    return result


async def _ollama_translate_text(
    transcript: str,
    target_language: str,
    grade_level: str | int,
    age: int,
) -> str:
    translated, _ = await _translate_text(transcript, target_language, grade_level, age)
    return translated


async def _translate_text(
    transcript: str,
    target_language: str,
    grade_level: str | int,
    age: int,
) -> tuple[str, bool]:
    if not transcript.strip():
        return "", False
    try:
        quality_note = ""
        for num_predict in (768, 1280, 1280):
            lang_display = _lang_prompt(target_language)
            prompt = _TRANSLATE_TEXT_PROMPT.format(
                lang=lang_display,
                grade=grade_level,
                age=age,
                glossary=_translation_glossary(target_language),
                quality_note=quality_note,
                transcript=transcript,
            )
            parts: list[str] = []
            switched = False
            async for token in route_generate_with_fallback(
                prompt,
                "TRANSLATION",
                system_prompt=f"{OPTILEARN_26B_SYSTEM_PROMPT}\n\n{_TRANSLATE_SYSTEM_PROMPT}",
                enable_thinking=False,
                ollama_options={
                    "temperature": 0.15,
                    "top_p": 0.85,
                    "top_k": 32,
                    "num_ctx": 2048,
                    "num_predict": num_predict,
                },
                lane="live_translation",
                feature="translate.text",
                profile="translation_fast",
            ):
                if token == MODEL_SWITCH_TOKEN:
                    switched = True
                    parts = []
                    continue
                parts.append(token)
            translation = _clean_model_text("".join(parts))
            if translation:
                issue = language_output_issue(translation, target_language)
                if issue:
                    logger.warning(
                        "Translation quality retry lang={} issue={} output={!r}",
                        target_language,
                        issue,
                        translation[:120],
                    )
                    quality_note = (
                        f"Quality correction: the previous output was rejected because {issue}. "
                        f"Rewrite the translation entirely in {lang_display}. "
                        "Do not use any unrelated language or script. Preserve formulas such as H2O and O2 as plain text.\n"
                    )
                    continue
                logger.info(
                    "Translated transcript: original={!r} translated={!r}",
                    transcript[:50],
                    translation[:50],
                )
                return translation, switched
        logger.error(
            "Translation returned empty after retry for transcript={!r}",
            transcript[:120],
        )
        return "", False
    except Exception as exc:
        logger.error("Text translation error: {!r}", exc)
        return "", False


async def _translate_text_sse(
    transcript: str,
    target_language: str,
    grade_level: str | int,
    age: int,
) -> AsyncGenerator[tuple[str, str], None]:
    if not transcript.strip():
        return
    translated, switched = await _translate_text(transcript, target_language, grade_level, age)
    if switched:
        yield "model_switch", ""
    if translated:
        yield "token", translated


def _sort_chunks(chunks: list[dict]) -> list[dict]:
    return sorted(chunks, key=lambda c: int(c.get("index", 0) or 0))


def _upsert_chunk(chunks: list[dict], chunk: dict) -> list[dict]:
    idx = int(chunk.get("index", 0) or 0)
    kept = [c for c in chunks if int(c.get("index", 0) or 0) != idx]
    kept.append(chunk)
    return _sort_chunks(kept)


def _full_original_text(chunks: list[dict]) -> str:
    return "\n\n".join(c.get("original", "").strip() for c in _sort_chunks(chunks) if c.get("original", "").strip())


def _full_translated_text(chunks: list[dict]) -> str:
    return normalize_ai_output(
        "\n\n".join(
            c.get("translated", "").strip()
            for c in _sort_chunks(chunks)
            if c.get("translated", "").strip()
        )
    )


def _build_translation_groups(chunks: list[dict]) -> list[dict]:
    groups: list[dict] = []
    current: list[dict] = []
    current_chars = 0

    for chunk in _sort_chunks(chunks):
        original = (chunk.get("original") or "").strip()
        if not original:
            continue
        if current and current_chars + len(original) > _TRANSCRIPT_GROUP_MAX_CHARS:
            groups.append({"chunks": current, "text": " ".join(c["original"].strip() for c in current)})
            current = []
            current_chars = 0
        current.append(chunk)
        current_chars += len(original) + 1

    if current:
        groups.append({"chunks": current, "text": " ".join(c["original"].strip() for c in current)})
    return groups


async def _gemini_audio_chunk(
    audio_bytes: bytes,
    target_language: str,
    grade_level: str | int,
    age: int,
) -> tuple[str, str]:
    try:
        from google import genai
        from google.genai import types as genai_types

        lang_display = _lang_prompt(target_language)
        client = genai.Client(api_key=settings.GEMMA_API_KEY)
        contents = [
            genai_types.Content(role="user", parts=[
                genai_types.Part(
                    text=_AUDIO_PROMPT.format(lang=lang_display, grade=grade_level, age=age)
                ),
                genai_types.Part(
                    inline_data=genai_types.Blob(mime_type="audio/wav", data=audio_bytes)
                ),
            ])
        ]
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.models.generate_content(model=settings.GEMINI_MODEL, contents=contents),
        )
        response_text = (response.text or "").strip()
        if not response_text:
            logger.error("Gemini returned empty for audio chunk")
            return "", ""
        original, translated = _parse_audio_response(response_text)
        logger.info("Gemini audio: original={!r} translated={!r}",
                    original[:50], translated[:50])
        return original, translated
    except Exception as exc:
        logger.error("Gemini audio chunk error: {}", exc)
        return "", ""


# ──────────────────────────────────────────────────────────────
# Notes generation — direct Ollama call, no thinking mode
# ──────────────────────────────────────────────────────────────
_NOTES_SYSTEM_PROMPT = """\
You are OptiLearn's study note writer.
Return only complete study notes in the requested language.
Cover every main lesson idea from beginning to end.
If the transcript is noisy, repair obvious speech-to-text issues using classroom context.
Base the notes only on the transcript. Do not invent facts, examples, dates, formulas, or conclusions.
Preserve names, numbers, units, formulas, and cause/effect relationships accurately.
Use ## headings, short bullet points, and an In summary: section.
Never include hidden reasoning or commentary.
Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{}.
Use supportive wording and avoid discouraging labels.
"""


async def _ollama_generate_notes(prompt: str, num_ctx: int) -> str:
    try:
        parts: list[str] = []
        async for token in route_generate_with_fallback(
            prompt,
            "TRANSLATION",
            system_prompt=f"{OPTILEARN_26B_SYSTEM_PROMPT}\n\n{_NOTES_SYSTEM_PROMPT}",
            enable_thinking=False,
            ollama_options={
                "temperature": 0.35,
                "top_p": 0.9,
                "num_ctx": num_ctx,
                "num_predict": 1400,
            },
            lane="background",
            feature="translate.notes",
            profile="notes_balanced",
        ):
            if token == MODEL_SWITCH_TOKEN:
                parts = []
                continue
            parts.append(token)
        return _clean_model_text("".join(parts))
    except Exception as exc:
        logger.error("Notes generation model error: {}", exc)
        return ""


def _fallback_notes(transcript: str) -> str:
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
        group = sentences[start:start + group_size]
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


def _word_count(text: str) -> int:
    return len([part for part in re.split(r"\s+", text.strip()) if part])


def _notes_need_more_coverage(notes: str, transcript: str) -> bool:
    if not notes.strip():
        return True
    transcript_words = _word_count(transcript)
    notes_words = _word_count(notes)
    if "In summary:" not in notes:
        return True
    if transcript_words < 80:
        return notes_words < 50
    minimum_notes_words = min(260, max(120, transcript_words // 3))
    return notes_words < minimum_notes_words


# ──────────────────────────────────────────────────────────────
# Notes generation (background task)
# ──────────────────────────────────────────────────────────────
async def _generate_notes(
    session_id: str,
    student_id: str,
    target_language: str,
    full_transcript_translated: str,
) -> None:
    try:
        student = await db.get_student(student_id)
        if not student:
            logger.error("generate_notes: student {} not found", student_id)
            return

        lang_name = _lang_prompt(target_language)
        prompt = (
            f"You are creating study notes for {student['name']}, "
            f"age {student.get('age', 10)}, grade {student.get('grade_level', 1)}.\n"
            f"Create structured study notes in {lang_name}:\n"
            "- Use ## headings for each concept covered in the lesson\n"
            "- Cover the whole lesson transcript from beginning to end\n"
            "- If the transcript is noisy, repair obvious speech-to-text issues using classroom context\n"
            "- Base notes only on the transcript; do not invent facts, examples, dates, formulas, or conclusions\n"
            "- Preserve names, numbers, units, formulas, and cause/effect relationships accurately\n"
            "- Bullet points for key facts under each heading\n"
            "- End with \"In summary:\" section with 3-5 key takeaways\n"
            "- Grade-appropriate vocabulary\n"
            "- Warm, encouraging tone\n"
            "- Use supportive wording and avoid discouraging labels\n"
            "- Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{}\n\n"
            f"Lesson transcript:\n{full_transcript_translated[:10000]}"
        )

        source_hash = generated_cache.hash_text(full_transcript_translated)
        cache_key = generated_cache.make_cache_key(
            "class.notes",
            {
                "student_id": student_id,
                "target_language": target_language,
                "grade": student.get("grade_level", 1),
                "source_hash": source_hash,
            },
            prompt_version="translate-notes-v3",
        )
        cached_notes = await generated_cache.get_text(cache_key, "class.notes")
        if cached_notes:
            notes = normalize_ai_output(cached_notes)
        else:
            num_ctx = 8192
            notes = await _ollama_generate_notes(prompt, num_ctx)

            if not notes.strip():
                logger.warning("generate_notes: using fallback notes for session {}", session_id)
                notes = _fallback_notes(full_transcript_translated)
            elif _notes_need_more_coverage(notes, full_transcript_translated):
                logger.warning("generate_notes: expanding thin notes for session {}", session_id)
                coverage_notes = _fallback_notes(full_transcript_translated)
                notes = f"{notes.strip()}\n\n{coverage_notes}".strip()
            notes = normalize_ai_output(notes)

            await generated_cache.set_text(
                cache_key,
                "class.notes",
                notes,
                input_hash=source_hash,
                metadata={
                    "student_id": student_id,
                    "target_language": target_language,
                    "session_id": session_id,
                },
            )

        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            await conn.execute(
                "UPDATE class_notes SET notes_text = ?, faiss_indexed = 0 WHERE id = ?",
                (notes, session_id),
            )
            await conn.commit()

        event = _notes_ready.get(session_id)
        if event and not event.is_set():
            event.set()

        # Index into FAISS after notes are already visible in the UI.
        try:
            paragraphs = [
                p.strip() for p in notes.split("\n\n")
                if p.strip() and len(p.strip()) > 20
            ]
            if paragraphs:
                await asyncio.to_thread(
                    faiss_store.add_passages,
                    [
                        {
                            "text": p,
                            "source": "class_note",
                            "student_id": student_id,
                            "session_id": session_id,
                        }
                        for p in paragraphs
                    ],
                )
                async with aiosqlite.connect(settings.DB_PATH) as conn:
                    conn.row_factory = aiosqlite.Row
                    await conn.execute(
                        "UPDATE class_notes SET faiss_indexed = 1 WHERE id = ?",
                        (session_id,),
                    )
                    await conn.commit()
        except Exception as exc:
            logger.warning("FAISS indexing skipped for session {}: {}", session_id, exc)

        logger.info("Notes generated for session {} ({} chars)", session_id, len(notes))
    except Exception as exc:
        logger.error("generate_notes error for session {}: {}", session_id, exc)
    finally:
        event = _notes_ready.get(session_id)
        if event:
            event.set()


# ──────────────────────────────────────────────────────────────
# Route 1 — POST /api/translate/start
# ──────────────────────────────────────────────────────────────
class StartRequest(BaseModel):
    student_id: str
    target_language: str


class TextChunkRequest(BaseModel):
    session_id: str
    student_id: str
    target_language: str
    index: int
    original: str
    timestamp: str = ""
    detected_language: str = "en"


@router.post("/start")
async def translate_start(body: StartRequest) -> dict:
    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute(
            """INSERT INTO class_notes (id, student_id, notes_language, translated_chunks, created_at)
               VALUES (?, ?, ?, '[]', ?)""",
            (session_id, body.student_id, body.target_language, now),
        )
        await conn.commit()

    _notes_ready[session_id] = asyncio.Event()
    logger.info(
        "Translate session started id={} student={} lang={}",
        session_id, body.student_id, body.target_language,
    )
    return {"session_id": session_id, "target_language": body.target_language}


@router.post("/text-chunk")
async def translate_text_chunk(body: TextChunkRequest) -> dict:
    original = (body.original or "").strip()
    if not original:
        raise HTTPException(status_code=400, detail="Text chunk must not be empty.")

    student = await db.get_student(body.student_id) or {}
    grade = normalize_grade_level(student.get("grade_level") or "1")
    age = int(student.get("age") or 10)
    translated, model_switched = await _translate_text(original, body.target_language, grade, age)
    if not translated:
        translated = original
    translated = normalize_ai_output(translated)

    return {
        "index": body.index,
        "source_indices": [],
        "original": original,
        "translated": translated,
        "timestamp": body.timestamp or datetime.utcnow().strftime("%H:%M"),
        "detected_language": body.detected_language or "en",
        "model_switched": model_switched,
    }


# ──────────────────────────────────────────────────────────────
# Route 2 — POST /api/translate/chunk (SSE)
# ──────────────────────────────────────────────────────────────
@router.post("/chunk")
async def translate_chunk(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    target_language: str = Form(...),
    chunk_index: int = Form(...),
    hint_language: str = Form("en"),
) -> StreamingResponse:
    audio_bytes = await audio.read()

    async def event_stream() -> AsyncGenerator[str, None]:
        if len(audio_bytes) < 1000:
            yield _sse({"type": "skip", "chunk_index": chunk_index, "reason": "empty_audio"})
            return

        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(
                "SELECT student_id, translated_chunks FROM class_notes WHERE id = ?",
                (session_id,),
            )
            session_row = await cur.fetchone()

        if not session_row:
            yield _sse({"type": "error", "message": "Translation session not found.", "chunk_index": chunk_index})
            return

        original_text = await transcribe_chunk(audio_bytes, hint_language)
        if not original_text:
            yield _sse({"type": "skip", "chunk_index": chunk_index})
            return

        # Detect source language from original for display
        detected_lang = hint_language or "en"
        if original_text:
            try:
                from langdetect import detect
                detected_lang = detect(original_text[:500])
            except Exception:
                pass

        yield _sse({
            "type": "original",
            "chunk_index": chunk_index,
            "content": original_text,
            "detected_language": detected_lang,
        })

        # Persist chunk
        timestamp = datetime.utcnow().strftime("%H:%M")
        chunk_data = {
            "index": chunk_index,
            "original": original_text,
            "translated": "",
            "timestamp": timestamp,
            "detected_language": detected_lang,
        }
        try:
            async with aiosqlite.connect(settings.DB_PATH) as conn:
                conn.row_factory = aiosqlite.Row
                chunks = json.loads(session_row["translated_chunks"] or "[]")
                chunks = _upsert_chunk(chunks, chunk_data)
                await conn.execute(
                    "UPDATE class_notes SET translated_chunks = ?, raw_transcript = ? WHERE id = ?",
                    (
                        json.dumps(chunks, ensure_ascii=False),
                        _full_original_text(chunks),
                        session_id,
                    ),
                )
                await conn.commit()
        except Exception as exc:
            logger.error("Chunk persist error session={}: {}", session_id, exc)

        student = await db.get_student(session_row["student_id"] or "") or {}
        grade = normalize_grade_level(student.get("grade_level") or "7th")
        age = int(student.get("age") or 10)
        translated_parts: list[str] = []
        async for event_type, value in _translate_text_sse(original_text, target_language, grade, age):
            if event_type == "model_switch":
                translated_parts = []
                yield _sse({
                    "type": "model_switch",
                    "chunk_index": chunk_index,
                    "message": "Connection interrupted. Switching to local model.",
                    "color": "#EF9F27",
                })
                continue
            translated_parts.append(value)
            yield _sse({
                "type": "translated_token",
                "chunk_index": chunk_index,
                "content": value,
            })

        translated = _clean_model_text("".join(translated_parts)) or original_text
        translated = normalize_ai_output(translated)
        chunk_data["translated"] = translated
        try:
            async with aiosqlite.connect(settings.DB_PATH) as conn:
                conn.row_factory = aiosqlite.Row
                cur = await conn.execute(
                    "SELECT translated_chunks FROM class_notes WHERE id = ?",
                    (session_id,),
                )
                row = await cur.fetchone()
                chunks = json.loads(row["translated_chunks"] or "[]") if row else []
                chunks = _upsert_chunk(chunks, chunk_data)
                await conn.execute(
                    "UPDATE class_notes SET translated_chunks = ?, raw_transcript = ? WHERE id = ?",
                    (
                        json.dumps(chunks, ensure_ascii=False),
                        _full_original_text(chunks),
                        session_id,
                    ),
                )
                await conn.commit()
        except Exception as exc:
            logger.error("Translated chunk persist error session={}: {}", session_id, exc)

        yield _sse({
            "type": "translated_chunk",
            "chunk_index": chunk_index,
            "chunk": chunk_data,
        })
        yield _sse({"type": "done", "chunk_index": chunk_index})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────────────────────
# Route 3 — POST /api/translate/end
# ──────────────────────────────────────────────────────────────
class FinalizeRequest(BaseModel):
    session_id: str
    target_language: str
    student_id: str


@router.post("/finalize")
async def translate_finalize(body: FinalizeRequest) -> StreamingResponse:
    async def event_stream() -> AsyncGenerator[str, None]:
        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(
                "SELECT translated_chunks FROM class_notes WHERE id = ?", (body.session_id,)
            )
            row = await cur.fetchone()

        if not row:
            yield _sse({"type": "error", "message": "Session not found."})
            return

        chunks = [_normalize_translated_chunk(c) for c in _sort_chunks(json.loads(row["translated_chunks"] or "[]"))]
        groups = _build_translation_groups(chunks)
        full_original = _full_original_text(chunks)
        if not groups:
            yield _sse({"type": "error", "message": "No transcript was captured."})
            return

        student = await db.get_student(body.student_id) or {}
        grade = normalize_grade_level(student.get("grade_level") or "7th")
        age = int(student.get("age") or 10)
        total = len(groups)
        translated_chunks: list[dict] = []

        yield _sse({"type": "start", "total": total})

        for index, group in enumerate(groups):
            original = group["text"].strip()
            translated_parts: list[str] = []
            async for event_type, value in _translate_text_sse(original, body.target_language, grade, age):
                if event_type == "model_switch":
                    translated_parts = []
                    yield _sse({
                        "type": "model_switch",
                        "message": "Connection interrupted. Switching to local model.",
                        "color": "#EF9F27",
                    })
                    continue
                translated_parts.append(value)
            translated = _clean_model_text("".join(translated_parts))

            if not translated and len(group["chunks"]) > 1:
                parts = []
                for source_chunk in group["chunks"]:
                    source_text = (source_chunk.get("original") or "").strip()
                    if not source_text:
                        continue
                    part, _ = await _translate_text(source_text, body.target_language, grade, age)
                    parts.append(part or source_text)
                translated = normalize_ai_output("\n".join(parts))

            if not translated:
                translated = original
            translated = normalize_ai_output(translated)

            first_chunk = group["chunks"][0]
            translated_chunk = {
                "index": index,
                "source_indices": [c.get("index") for c in group["chunks"]],
                "original": original,
                "translated": translated,
                "timestamp": first_chunk.get("timestamp") or datetime.utcnow().strftime("%H:%M"),
                "detected_language": first_chunk.get("detected_language") or "en",
            }
            translated_chunks.append(translated_chunk)

            async with aiosqlite.connect(settings.DB_PATH) as conn:
                conn.row_factory = aiosqlite.Row
                await conn.execute(
                    "UPDATE class_notes SET raw_transcript = ?, translated_chunks = ? WHERE id = ?",
                    (
                        full_original,
                        json.dumps(translated_chunks, ensure_ascii=False),
                        body.session_id,
                    ),
                )
                await conn.commit()

            progress = round(((index + 1) / total) * 100)
            yield _sse({
                "type": "chunk",
                "chunk": translated_chunk,
                "progress": progress,
                "completed": index + 1,
                "total": total,
            })
            yield _sse({"type": "progress", "progress": progress, "completed": index + 1, "total": total})

        translated_transcript = _full_translated_text(translated_chunks)
        yield _sse({
            "type": "done",
            "progress": 100,
            "original_transcript": full_original,
            "translated_transcript": translated_transcript,
            "chunks": translated_chunks,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class EndRequest(BaseModel):
    session_id: str
    target_language: str
    student_id: str
    raw_transcript: str | None = None
    translated_chunks: list[dict] | None = None


@router.post("/end")
async def translate_end(body: EndRequest) -> dict:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT translated_chunks FROM class_notes WHERE id = ?", (body.session_id,)
        )
        row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")

    if body.translated_chunks is not None:
        chunks = [_normalize_translated_chunk(c) for c in _sort_chunks(body.translated_chunks)]
    else:
        chunks = [_normalize_translated_chunk(c) for c in _sort_chunks(json.loads(row["translated_chunks"] or "[]"))]
    full_translated = _full_translated_text(chunks)
    full_original = (body.raw_transcript or "").strip() or _full_original_text(chunks)

    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute(
            "UPDATE class_notes SET raw_transcript = ?, translated_chunks = ? WHERE id = ?",
            (full_original, json.dumps(chunks, ensure_ascii=False), body.session_id),
        )
        await conn.commit()

    if body.session_id not in _notes_ready:
        _notes_ready[body.session_id] = asyncio.Event()
    else:
        _notes_ready[body.session_id].clear()

    job_id = job_manager.create_job(
        "translate.generate_notes",
        lambda: _generate_notes(
            body.session_id,
            body.student_id,
            body.target_language,
            full_translated or full_original,
        ),
        metadata={
            "session_id": body.session_id,
            "student_id": body.student_id,
            "target_language": body.target_language,
        },
    )

    return {
        "status": "generating",
        "session_id": body.session_id,
        "chunk_count": len(chunks),
        "job_id": job_id,
    }


# ──────────────────────────────────────────────────────────────
# Route 6 — GET /api/translate/sessions/{student_id}
# MUST be declared before /{session_id} to avoid route shadowing
# ──────────────────────────────────────────────────────────────
@router.get("/sessions/{student_id}")
async def translate_sessions(student_id: str) -> list[dict]:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            """SELECT id, notes_language, subject, faiss_indexed, created_at,
                      SUBSTR(notes_text, 1, 200)     AS notes_preview,
                      SUBSTR(raw_transcript, 1, 200) AS transcript_preview
               FROM class_notes
               WHERE student_id = ? AND raw_transcript IS NOT NULL
               ORDER BY created_at DESC
               LIMIT 30""",
            (student_id,),
        )
        rows = await cur.fetchall()
    result: list[dict] = []
    for row in rows:
        item = dict(row)
        item["notes_preview"] = normalize_ai_output(item.get("notes_preview") or "")
        item["transcript_preview"] = normalize_ai_output(item.get("transcript_preview") or "")
        result.append(item)
    return result


# ──────────────────────────────────────────────────────────────
# Route 4 — GET /api/translate/{session_id}/notes (SSE)
# MUST be declared before /{session_id}
# ──────────────────────────────────────────────────────────────
@router.get("/{session_id}/notes")
async def translate_notes_stream(session_id: str) -> StreamingResponse:
    async def event_stream() -> AsyncGenerator[str, None]:
        # Check if notes already exist in DB (past session load)
        async with aiosqlite.connect(settings.DB_PATH) as conn:
            conn.row_factory = aiosqlite.Row
            cur = await conn.execute(
                "SELECT notes_text FROM class_notes WHERE id = ?", (session_id,)
            )
            row = await cur.fetchone()

        if row and row["notes_text"]:
            notes = normalize_ai_output(row["notes_text"])
        else:
            # Wait for background task to complete
            if session_id not in _notes_ready:
                _notes_ready[session_id] = asyncio.Event()
            try:
                await asyncio.wait_for(_notes_ready[session_id].wait(), timeout=120.0)
            except asyncio.TimeoutError:
                yield _sse({"type": "error", "message": "Note generation timed out."})
                return

            async with aiosqlite.connect(settings.DB_PATH) as conn:
                conn.row_factory = aiosqlite.Row
                cur = await conn.execute(
                    "SELECT notes_text FROM class_notes WHERE id = ?", (session_id,)
                )
                row = await cur.fetchone()

            if not row or not row["notes_text"]:
                yield _sse({"type": "error", "message": "Notes unavailable."})
                return
            notes = normalize_ai_output(row["notes_text"])

        # Stream word-by-word
        words = notes.split(" ")
        for i, word in enumerate(words):
            chunk = word + (" " if i < len(words) - 1 else "")
            yield _sse({"type": "token", "content": chunk})
            if i % 15 == 0:
                await asyncio.sleep(0.008)

        yield _sse({"type": "done"})
        _notes_ready.pop(session_id, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────────────────────
# Route 5 — GET /api/translate/{session_id}
# ──────────────────────────────────────────────────────────────
@router.get("/{session_id}")
async def translate_session(session_id: str) -> dict:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT * FROM class_notes WHERE id = ?", (session_id,)
        )
        row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")

    data = dict(row)
    if data.get("notes_text"):
        data["notes_text"] = normalize_ai_output(data["notes_text"])
    try:
        data["translated_chunks"] = [
            _normalize_translated_chunk(c)
            for c in json.loads(data.get("translated_chunks") or "[]")
        ]
    except Exception:
        data["translated_chunks"] = []
    return data


# ──────────────────────────────────────────────────────────────
# Route 7 — POST /api/translate/export-notes (PDF)
# ──────────────────────────────────────────────────────────────
class ExportNotesRequest(BaseModel):
    session_id: str
    export_type: str = "notes"  # "notes" | "transcript"


@router.post("/export-notes")
async def export_notes_pdf(body: ExportNotesRequest) -> Response:
    async with aiosqlite.connect(settings.DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT * FROM class_notes WHERE id = ?", (body.session_id,)
        )
        row = await cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Session not found.")

    session = dict(row)
    student = await db.get_student(session.get("student_id", "") or "")
    if not student:
        student = {"name": "Student", "grade_level": "", "language": "en"}

    target_language = session.get("notes_language", "en") or "en"
    date_str = datetime.utcnow().strftime("%Y-%m-%d")

    if body.export_type == "notes":
        content_text = session.get("notes_text") or ""
        if not content_text:
            raise HTTPException(status_code=400, detail="Notes not generated yet.")
        title = f"Study Notes — {date_str}"
        content_type = "notes"
    else:
        try:
            transcript_chunks = json.loads(session.get("translated_chunks") or "[]")
        except Exception:
            transcript_chunks = []
        content_text = _full_translated_text(transcript_chunks) or session.get("raw_transcript") or ""
        if not content_text:
            raise HTTPException(status_code=400, detail="Transcript not available.")
        title = f"Translated Class Transcript - {date_str}"
        content_type = "transcript"

    return _render_notes_pdf(
        title=title,
        content_text=content_text,
        content_type=content_type,
        target_language=target_language,
        student=student,
    )


def _render_notes_pdf(
    *,
    title: str,
    content_text: str,
    content_type: str,
    target_language: str,
    student: dict,
) -> Response:
    import io as _io

    content_text = normalize_ai_output(content_text)

    try:
        from reportlab.lib.colors import HexColor, white
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import (
            HRFlowable, ListFlowable, ListItem,
            Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
        )
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="PDF library not available.") from exc

    app_root = Path(__file__).resolve().parents[3]
    fonts_dir = app_root / "data" / "fonts"

    _SCRIPT_FONTS = {
        "si": "NotoSansSinhala-Regular.ttf",
        "ta": "NotoSansTamil-Regular.ttf",
        "ar": "NotoSansArabic-Regular.ttf",
        "fa": "NotoSansArabic-Regular.ttf",
        "ur": "NotoSansArabic-Regular.ttf",
        "am": "NotoSansEthiopic-Regular.ttf",
        "ti": "NotoSansEthiopic-Regular.ttf",
        "hi": "NotoSansDevanagari-Regular.ttf",
        "mr": "NotoSansDevanagari-Regular.ttf",
        "ne": "NotoSansDevanagari-Regular.ttf",
        "bn": "NotoSansBengali-Regular.ttf",
        "my": "NotoSansMyanmar-Regular.ttf",
        "th": "NotoSansThai-Regular.ttf",
    }

    def _try_register(font_name: str, font_path: Path) -> bool:
        try:
            if font_path.exists() and font_name not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
            return font_path.exists()
        except Exception:
            logger.warning("Could not register PDF font: {}", font_path)
            return False

    base_font = "Helvetica"
    bold_font = "Helvetica-Bold"
    if _try_register("NotoSans", fonts_dir / "NotoSans-Regular.ttf"):
        base_font = "NotoSans"
    if _try_register("NotoSans-Bold", fonts_dir / "NotoSans-Bold.ttf"):
        bold_font = "NotoSans-Bold"

    script_file = _SCRIPT_FONTS.get(target_language)
    if script_file:
        script_font_name = f"NotoScript-{target_language}"
        if _try_register(script_font_name, fonts_dir / script_file):
            base_font = script_font_name

    is_rtl = target_language in {"ar", "fa", "ur", "he"}
    text_align = TA_RIGHT if is_rtl else TA_LEFT

    lang_display = _lang_name(target_language)
    student_name = str(student.get("name") or "Student")
    grade = str(student.get("grade_level") or "").strip()
    subtitle_parts = [f"Student: {student_name}"]
    if grade:
        subtitle_parts.append(f"Grade {grade}")
    subtitle_parts.append(f"Language: {lang_display}")
    subtitle = " | ".join(subtitle_parts)

    buffer = _io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        leftMargin=22 * mm, rightMargin=22 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
        title=f"OptiLearn Notes - {student_name}", author="OptiLearn",
    )

    header_table = Table([[
        Paragraph("OptiLearn", ParagraphStyle("hl", fontName=bold_font, fontSize=10, textColor=white)),
        Paragraph(
            "Study Notes" if content_type == "notes" else "Class Transcript",
            ParagraphStyle("hr", fontName=base_font, fontSize=10, textColor=white, alignment=TA_RIGHT),
        ),
    ]], colWidths=[83 * mm, 83 * mm])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HexColor("#2a8dbf")),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (0, -1), 8), ("RIGHTPADDING", (-1, 0), (-1, -1), 8),
    ]))

    title_style    = ParagraphStyle("title",    fontName=bold_font, fontSize=22, leading=28, textColor=HexColor("#202124"), spaceAfter=5,  alignment=text_align)
    subtitle_style = ParagraphStyle("subtitle", fontName=base_font, fontSize=10, leading=15, textColor=HexColor("#5f6368"), spaceAfter=14, alignment=text_align)
    body_style     = ParagraphStyle("body",     fontName=base_font, fontSize=11, leading=19, textColor=HexColor("#202124"), spaceAfter=6,  alignment=text_align)
    heading_style  = ParagraphStyle("heading",  fontName=bold_font, fontSize=13, leading=18, textColor=HexColor("#202124"), spaceBefore=10, spaceAfter=4, alignment=text_align)
    bullet_style   = ParagraphStyle("bullet",   fontName=base_font, fontSize=11, leading=18, textColor=HexColor("#202124"), leftIndent=14, spaceAfter=3, alignment=text_align)
    footer_style   = ParagraphStyle("footer",   fontName=base_font, fontSize=8,  textColor=HexColor("#9aa0a6"), alignment=TA_CENTER)

    story = [
        header_table,
        Spacer(1, 6 * mm),
        Paragraph(html.escape(title), title_style),
        Paragraph(html.escape(subtitle), subtitle_style),
        HRFlowable(width="100%", thickness=1, color=HexColor("#dadce0"), spaceAfter=6 * mm),
    ]

    if content_type == "notes":
        for line in content_text.splitlines():
            line = line.rstrip()
            if not line:
                story.append(Spacer(1, 3 * mm))
            elif line.startswith("## "):
                story.append(Paragraph(html.escape(line[3:]), heading_style))
            elif line.startswith("# "):
                story.append(Paragraph(html.escape(line[2:]), heading_style))
            elif line.startswith("- ") or line.startswith("* "):
                story.append(Paragraph(f"&#8226; {html.escape(line[2:])}", bullet_style))
            else:
                story.append(Paragraph(html.escape(line), body_style))
    else:
        for para in content_text.split("\n\n"):
            para = para.strip()
            if para:
                story.append(Paragraph(html.escape(para), body_style))

    story.extend([
        Spacer(1, 8 * mm),
        HRFlowable(width="100%", thickness=1, color=HexColor("#dadce0"), spaceBefore=4 * mm, spaceAfter=3 * mm),
        Paragraph("Generated by OptiLearn | Gemma 4 Good Hackathon 2026 | Opti5 Labs", footer_style),
    ])

    doc.build(story)
    pdf_bytes = buffer.getvalue()
    if not pdf_bytes:
        raise HTTPException(status_code=500, detail="PDF could not be generated. Please try again.")

    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", title).strip("._") or "OptiLearn_notes"
    filename = f"{safe}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"; filename*=UTF-8\'\'{quote(filename)}'
            )
        },
    )
