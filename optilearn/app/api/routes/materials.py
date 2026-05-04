"""
app/api/routes/materials.py — teacher material upload and listing.

POST /api/materials/upload  — multipart: file + title + subject
GET  /api/materials          — list all uploaded materials
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from loguru import logger

from app.api.routes.auth import get_current_teacher
from app.core.config import settings
from app.services import db, faiss_store

router = APIRouter(prefix="/api/materials", tags=["materials"])

_CHUNK_WORDS = 200
_ALLOWED_EXT = {".pdf", ".txt", ".png", ".jpg", ".jpeg", ".webp"}


def _chunk_text(text: str, source: str) -> list[dict]:
    """Split text into ~200-word page-aware chunks."""
    words = text.split()
    chunks: list[dict] = []
    start = 0
    while start < len(words):
        end = min(start + _CHUNK_WORDS, len(words))
        chunks.append({"text": " ".join(words[start:end]), "source": source, "student_id": None})
        if end == len(words):
            break
        start = end
    return chunks


def _extract_pdf(file_path: str, source: str) -> list[dict]:
    """Extract text per page from a PDF and chunk each page separately."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF not installed — PDF text extraction skipped")
        return []

    doc = fitz.open(file_path)
    all_chunks: list[dict] = []
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text().strip()
        if text:
            page_source = f"{source}:p{page_num}"
            all_chunks.extend(_chunk_text(text, page_source))
    doc.close()
    return all_chunks


def _extract_txt(file_path: str, source: str) -> list[dict]:
    with open(file_path, encoding="utf-8", errors="ignore") as fh:
        text = fh.read().strip()
    return _chunk_text(text, source) if text else []


@router.post("/upload")
async def upload_material(
    file: UploadFile = File(...),
    title: Annotated[str, Form()] = "",
    subject: Annotated[str | None, Form()] = None,
    current_teacher: dict = Depends(get_current_teacher),
) -> dict:
    """
    Upload a teaching material file. PDFs are text-extracted and indexed in FAISS.
    Images and other files are stored but not indexed (OCR out of scope).
    Returns {id, title, subject, passage_count}.
    """
    if not title.strip():
        raise HTTPException(status_code=422, detail="title is required")

    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED_EXT:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(_ALLOWED_EXT)}",
        )

    materials_dir = Path(settings.MATERIALS_DIR)
    materials_dir.mkdir(parents=True, exist_ok=True)

    file_id = str(uuid.uuid4())[:8]
    safe_name = f"{file_id}_{Path(file.filename or 'upload').name}"
    dest_path = materials_dir / safe_name

    content = await file.read()
    dest_path.write_bytes(content)
    logger.info("Saved material file {} ({} bytes)", dest_path, len(content))

    passage_count = 0
    source_label = f"{title}{ext}"

    if ext == ".pdf":
        chunks = _extract_pdf(str(dest_path), source_label)
        if chunks:
            passage_count = faiss_store.add_passages(chunks)
    elif ext == ".txt":
        chunks = _extract_txt(str(dest_path), source_label)
        if chunks:
            passage_count = faiss_store.add_passages(chunks)

    record = await db.create_material(
        title=title.strip(),
        subject=subject,
        file_path=str(dest_path),
        uploaded_by=current_teacher["id"],
        faiss_indexed=passage_count > 0,
    )
    record["passage_count"] = passage_count
    return record


@router.get("/subjects")
async def list_subjects() -> list[str]:
    """Return all distinct subjects that have at least one material or quiz."""
    return await db.get_subjects()


@router.get("/{material_id}/file")
async def get_material_file(material_id: str) -> FileResponse:
    """Serve the raw file for a material (PDF, image, TXT)."""
    record = await db.get_material_by_id(material_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Material not found.")
    file_path = Path(record["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk.")
    ext = file_path.suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".txt": "text/plain; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }
    media_type = media_types.get(ext, "application/octet-stream")
    return FileResponse(str(file_path), media_type=media_type)


@router.get("")
async def list_materials(subject: str | None = None, teacher_only: bool = False) -> list[dict]:
    """Return materials. ?subject=X to filter by subject, ?teacher_only=true for student_id IS NULL."""
    if subject:
        mats = await db.get_materials_by_subject(subject)
        if teacher_only:
            mats = [m for m in mats if m.get("student_id") is None]
        return mats
    return await db.get_all_materials(teacher_only=teacher_only)
