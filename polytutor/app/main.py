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

from app.api.routes import chat, dashboard, quiz, sessions, students
from app.core.config import settings
from app.services import db


# ──────────────────────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("PolyTutor starting up…")
    await db.init_db()
    logger.info("Server ready on http://{}:{}", settings.HOST, settings.PORT)
    yield
    logger.info("PolyTutor shutting down gracefully.")


# ──────────────────────────────────────────────────────────────
# App
# ──────────────────────────────────────────────────────────────
app = FastAPI(
    title="PolyTutor API",
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
