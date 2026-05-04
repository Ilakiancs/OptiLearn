"""
app/main.py — FastAPI application factory.

Registers all routers, mounts the frontend static build, and manages
lifespan (DB init on startup).
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.api.routes import auth, chat, dashboard, feature1, materials, quiz, sessions, settings as settings_routes, students, teacher, teacher_quiz, translate as translate_routes
from app.api.routes.feature1 import tts_router
from app.core.config import settings
from app.services import db, faiss_store
from app.services.model_client import get_network_mode, get_network_status, load_user_network_settings


class NoCacheStaticFiles(StaticFiles):
    """Serve the app shell without browser caching stale frontend builds."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if path in {"", ".", "index.html", "sw.js"} or path.endswith(".html"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


# ──────────────────────────────────────────────────────────────
# Lifespan
# ──────────────────────────────────────────────────────────────
def _ensure_noto_fonts() -> None:
    """Download Noto TTF fonts at startup for multilingual PDF export."""
    import urllib.request

    fonts_dir = Path("data/fonts")
    fonts_dir.mkdir(parents=True, exist_ok=True)

    _GH = "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf"
    fonts = {
        # Latin / Greek / Cyrillic (gstatic CDN — confirmed working)
        "NotoSans-Regular.ttf":          "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf",
        "NotoSans-Bold.ttf":             "https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyAaBN9d.ttf",
        # Script-specific (GitHub raw — confirmed real TTF)
        "NotoSansSinhala-Regular.ttf":    f"{_GH}/NotoSansSinhala/NotoSansSinhala-Regular.ttf",
        "NotoSansTamil-Regular.ttf":      f"{_GH}/NotoSansTamil/NotoSansTamil-Regular.ttf",
        "NotoSansArabic-Regular.ttf":     f"{_GH}/NotoSansArabic/NotoSansArabic-Regular.ttf",
        "NotoSansEthiopic-Regular.ttf":   f"{_GH}/NotoSansEthiopic/NotoSansEthiopic-Regular.ttf",
        "NotoSansDevanagari-Regular.ttf": f"{_GH}/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
        "NotoSansBengali-Regular.ttf":    f"{_GH}/NotoSansBengali/NotoSansBengali-Regular.ttf",
        "NotoSansMyanmar-Regular.ttf":    f"{_GH}/NotoSansMyanmar/NotoSansMyanmar-Regular.ttf",
        "NotoSansThai-Regular.ttf":       f"{_GH}/NotoSansThai/NotoSansThai-Regular.ttf",
    }

    for filename, url in fonts.items():
        dest = fonts_dir / filename
        if dest.exists():
            continue
        logger.info("Downloading font {} …", filename)
        try:
            urllib.request.urlretrieve(url, str(dest))
            logger.info("Font saved: {}", dest)
        except Exception as exc:
            logger.warning("Could not download {}: {}", filename, exc)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("OptiLearn starting up…")
    load_user_network_settings()
    _ensure_noto_fonts()
    await db.init_db()
    # Warm live translation models first, then embeddings. Running FAISS model
    # loading beside ASR made classroom startup painfully slow on teacher laptops.
    async def _warmup_background_models() -> None:
        try:
            await translate_routes.warmup_live_translation_models()
        except Exception as exc:
            logger.warning("Live translation warmup skipped: {}", exc)
        try:
            await asyncio.to_thread(faiss_store.ensure_embed_model)
        except Exception as exc:
            logger.warning("Embedding model warmup skipped: {}", exc)

    asyncio.create_task(_warmup_background_models())
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
app.include_router(students.schedule_router)
app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(chat.router)
app.include_router(quiz.router)
app.include_router(dashboard.router)
app.include_router(teacher.router)
app.include_router(teacher_quiz.router)
app.include_router(teacher_quiz.student_router)
app.include_router(materials.router)
app.include_router(feature1.router)
app.include_router(tts_router)
app.include_router(translate_routes.router)
app.include_router(settings_routes.router)


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    """System health check — Ollama connectivity, DB, FAISS, model availability."""
    import httpx
    import subprocess

    ollama_ok = False
    e4b_available = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{settings.OLLAMA_HOST}/api/tags")
            if r.status_code == 200:
                ollama_ok = True
                tags = r.json()
                model_names = [m.get("name", "") for m in tags.get("models", [])]
                e4b_available = settings.OLLAMA_MODEL_DEEP in model_names
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

    network_status = await get_network_status()

    return {
        "ollama_ok": ollama_ok,
        "model_name": settings.OLLAMA_MODEL_FAST,
        "db_ok": db_ok,
        "faiss_passages": faiss_passages,
        "embedding": faiss_store.get_embed_status(),
        "use_local_ollama": not network_status["use_26b"],
        "e4b_available": e4b_available,
        "active_model": settings.OLLAMA_MODEL_FAST,
        "network": {
            **network_status,
            "mode": get_network_mode(),
            "26b_api_configured": bool(
                (settings.GEMMA_26B_API_KEY or "").strip()
                and not settings.GEMMA_26B_API_KEY.strip().startswith("<")
            ),
        },
        "version": "1.0.0",
    }

# ── Frontend static build ──────────────────────────────────────
_frontend_path = Path(settings.FRONTEND_DIST)
if _frontend_path.exists() and _frontend_path.is_dir():
    app.mount("/", NoCacheStaticFiles(directory=str(_frontend_path), html=True), name="frontend")
    logger.info("Frontend mounted from {}", _frontend_path)
else:
    logger.warning(
        "Frontend dist directory '{}' not found — API-only mode. "
        "Run 'npm run build' in /frontend to serve the UI.",
        _frontend_path,
    )
