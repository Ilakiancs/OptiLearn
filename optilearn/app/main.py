"""
app/main.py — FastAPI application factory.

Registers all routers, mounts the frontend static build, and manages
lifespan (DB init on startup).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.api.routes import chat, dashboard, materials, quiz, sessions, students, teacher, teacher_quiz
from app.core.config import settings
from app.services import db, faiss_store


# ──────────────────────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("OptiLearn starting up…")
    await db.init_db()
    logger.info("Server ready on http://{}:{}", settings.HOST, settings.PORT)
    yield
    logger.info("OptiLearn shutting down gracefully.")


# ──────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="OptiLearn API",
    description="Offline-first multilingual adaptive learning agent for refugee classrooms.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────
app.include_router(students.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(quiz.router)
app.include_router(dashboard.router)
app.include_router(teacher.router)
app.include_router(teacher_quiz.router)
app.include_router(materials.router)


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    """System health check — Ollama connectivity, DB, FAISS."""
    import httpx

    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{settings.OLLAMA_HOST}/api/tags")
            ollama_ok = r.status_code == 200
    except Exception:
        pass

    db_ok = False
    try:
        async with __import__("aiosqlite").connect(settings.DB_PATH) as _db:
            await _db.execute("SELECT 1")
        db_ok = True
    except Exception:
        pass

    faiss_passages = 0
    try:
        if faiss_store._index is not None:
            faiss_passages = faiss_store._index.ntotal
    except Exception:
        pass

    return {
        "ollama_ok": ollama_ok,
        "model_name": settings.OLLAMA_MODEL,
        "db_ok": db_ok,
        "faiss_passages": faiss_passages,
        "use_local_ollama": settings.USE_LOCAL_OLLAMA,
        "version": "1.0.0",
    }

# ── Frontend static build ──────────────────────────────────────
_frontend_path = Path(settings.FRONTEND_DIST)
if _frontend_path.exists() and _frontend_path.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend_path), html=True), name="frontend")
    logger.info("Frontend mounted from {}", _frontend_path)
else:
    logger.warning(
        "Frontend dist directory '{}' not found — API-only mode. "
        "Run 'npm run build' in /frontend to serve the UI.",
        _frontend_path,
    )
