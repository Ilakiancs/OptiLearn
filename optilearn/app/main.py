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

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse

from app.api.routes import auth, chat, dashboard, feature1, live_class, live_quiz, materials, network, persona, quiz, sessions, settings as settings_routes, students, teacher, teacher_quiz, translate as translate_routes
from app.api.routes.persona import _load_agent_cache
from app.api.routes.auth import get_current_admin
from app.api.routes.feature1 import tts_router
from app.core.config import settings
from app.services import db, faiss_store, job_manager, model_scheduler, telemetry, tts_client
from app.services.client_tracker import record_client
from app.services.dns_server import start_captive_portal, stop_captive_portal
from app.services.mdns_server import start_mdns, stop_mdns
from app.services.model_client import get_model_profiles, get_network_mode, get_network_status, get_tutor_model_status, load_user_network_settings, warmup_tutor_model
from app.services.whisper_client import get_transcriber_status
from app.services.network import get_cached_hotspot_ip, get_server_url


_CAPTIVE_HOSTS = frozenset({
    "captive.apple.com",
    "www.apple.com",
    "connectivitycheck.gstatic.com",
    "connectivitycheck.android.com",
    "clients3.google.com",
    "clients1.google.com",
    "nmcheck.gnome.org",
    "network-test.debian.org",
    "detectportal.firefox.com",
    "www.msftconnecttest.com",
    "www.msftncsi.com",
})


class CaptivePortalMiddleware(BaseHTTPMiddleware):
    """Redirect captive-portal detection requests to OptiLearn by Host header.

    When DNS redirects all queries to this server, phones send their captive
    portal checks here with the original hostname in the Host header. This
    catches them regardless of path and sends the browser to OptiLearn.
    """

    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("host") or "").split(":")[0].lower()
        record_client(
            request.client.host if request.client else None,
            request.url.path,
            request.headers.get("user-agent"),
        )
        if host in _CAPTIVE_HOSTS:
            return RedirectResponse(url=f"{get_server_url()}/", status_code=302)
        return await call_next(request)


class NoCacheStaticFiles(StaticFiles):
    """Serve the app shell without browser caching stale frontend builds."""

    async def get_response(self, path: str, scope):
        served_path = path
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or not self._is_spa_route(path):
                raise
            served_path = "index.html"
            response = await super().get_response(served_path, scope)

        if served_path in {"", ".", "index.html", "sw.js"} or served_path.endswith(".html"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

    @staticmethod
    def _is_spa_route(path: str) -> bool:
        clean_path = path.lstrip("/")
        if not clean_path:
            return False
        if clean_path.startswith(("api/", "assets/", "icons/")):
            return False
        return "." not in Path(clean_path).name


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


def _ensure_ssl_cert() -> None:
    """Generate a self-signed TLS cert covering all detected LAN IPs.

    Stored at data/ssl/ so the HTTPS server can serve student microphone
    requests without relying on a CA. Idempotent — no-op if files exist.
    """
    import ipaddress
    import socket
    import datetime

    cert_path = Path(settings.SSL_CERT_PATH)
    key_path  = Path(settings.SSL_KEY_PATH)
    if cert_path.exists() and key_path.exists():
        return

    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError:
        logger.warning("cryptography package not installed — HTTPS cert generation skipped")
        return

    san_ips: set[ipaddress.IPv4Address] = {ipaddress.IPv4Address("127.0.0.1")}
    san_dns: set[str] = {"localhost"}
    try:
        hostname = socket.gethostname()
        san_dns.add(hostname)
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            try:
                san_ips.add(ipaddress.IPv4Address(addr))
            except Exception:
                pass
    except Exception:
        pass
    try:
        import psutil
        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if a.family == socket.AF_INET:
                    try:
                        san_ips.add(ipaddress.IPv4Address(a.address))
                    except Exception:
                        pass
    except Exception:
        pass

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "OptiLearn")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName(d) for d in san_dns]
                + [x509.IPAddress(ip) for ip in san_ips]
            ),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    logger.info("Generated self-signed SSL cert ({} IPs) → {}", len(san_ips), cert_path)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("OptiLearn starting up…")
    load_user_network_settings()
    _load_agent_cache()
    _ensure_noto_fonts()
    _ensure_ssl_cert()
    await db.init_db()
    hotspot_ip = get_cached_hotspot_ip()
    server_url = get_server_url()
    logger.info("Server accessible at: {}", server_url)
    portal_active = start_captive_portal(hotspot_ip)
    if portal_active:
        logger.info("Captive portal active; students auto-connect on WiFi join")
    else:
        logger.warning(
            "Captive portal requires administrator privileges. "
            "Students connect via QR code or URL: {}",
            server_url,
        )
    start_mdns(port=settings.PORT)
    # Warm the student tutor first, then live translation, then embeddings. Running
    # FAISS model loading beside ASR made classroom startup painfully slow on teacher laptops.
    async def _warmup_background_models() -> None:
        try:
            await asyncio.wait_for(warmup_tutor_model(), timeout=120.0)
        except asyncio.TimeoutError:
            logger.warning("Tutor model warmup timed out after 120 s — continuing anyway")
        except Exception as exc:
            logger.warning("Tutor model warmup skipped: {}", exc)
        try:
            await asyncio.wait_for(translate_routes.warmup_live_translation_models(), timeout=60.0)
        except asyncio.TimeoutError:
            logger.warning("Live translation warmup timed out after 60 s — continuing anyway")
        except Exception as exc:
            logger.warning("Live translation warmup skipped: {}", exc)
        try:
            await asyncio.wait_for(asyncio.to_thread(faiss_store.ensure_embed_model), timeout=120.0)
        except asyncio.TimeoutError:
            logger.warning("Embedding model warmup timed out after 120 s — continuing anyway")
        except Exception as exc:
            logger.warning("Embedding model warmup skipped: {}", exc)

    asyncio.create_task(_warmup_background_models())

    # Purge stale sessions at startup, then every hour in the background.
    purged = await db.purge_expired_sessions()
    if purged:
        logger.info("Purged {} expired teacher session(s) at startup.", purged)

    async def _session_cleanup_loop() -> None:
        while True:
            await asyncio.sleep(3600)
            try:
                n = await db.purge_expired_sessions()
                if n:
                    logger.info("Periodic cleanup: purged {} expired teacher session(s).", n)
            except Exception as exc:
                logger.warning("Session cleanup error: {}", exc)

    asyncio.create_task(_session_cleanup_loop())

    logger.info("Server ready on http://{}:{}", settings.HOST, settings.PORT)
    try:
        yield
    finally:
        stop_mdns()
        stop_captive_portal()
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
app.add_middleware(CaptivePortalMiddleware)

# ── Routers ────────────────────────────────────────────────────
app.include_router(network.router)
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
app.include_router(live_class.router, prefix="/api")
app.include_router(settings_routes.router)
app.include_router(live_quiz.router)
app.include_router(persona.router)


@app.get("/api/health", tags=["system"])
async def health() -> dict:
    """System health check — Ollama connectivity, DB, FAISS, model availability."""
    import httpx
    import subprocess

    ollama_ok = False
    tutor_model_present = False
    e4b_available = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{settings.OLLAMA_HOST}/api/tags")
            if r.status_code == 200:
                ollama_ok = True
                model_names = [m.get("name", "") for m in r.json().get("models", [])]
                def _model_present(name: str) -> bool:
                    has_tag = ":" in name
                    return any(
                        n == name or (not has_tag and n.split(":")[0] == name)
                        for n in model_names
                    )
                tutor_model_present = _model_present(settings.OLLAMA_TUTOR_MODEL)
                e4b_available = _model_present(settings.OLLAMA_MODEL_DEEP)
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
        "speech": get_transcriber_status(),
        "tts": tts_client.get_tts_status(),
        "use_local_ollama": not network_status["use_26b"],
        "tutor_model_present": tutor_model_present,
        "tutor_model": get_tutor_model_status(),
        "e4b_available": e4b_available,
        "active_model": settings.OLLAMA_MODEL_FAST,
        "model_profiles": get_model_profiles(),
        "scheduler": model_scheduler.get_scheduler_status(),
        "jobs": job_manager.snapshot(),
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
@app.get("/api/diagnostics/performance", tags=["system"])
async def performance_diagnostics(
    limit: int = 100,
    _admin: dict = Depends(get_current_admin),
) -> dict:
    """Recent system-layer AI telemetry for teacher/admin diagnostics."""
    safe_limit = max(1, min(limit, 300))
    return {
        "summary": telemetry.telemetry_summary(),
        "active": telemetry.active_ai_traces(),
        "recent": telemetry.recent_ai_events(safe_limit),
        "scheduler": model_scheduler.get_scheduler_status(),
        "jobs": job_manager.snapshot(),
    }


@app.get("/api/jobs", tags=["system"])
async def list_jobs(
    limit: int = 50,
    _admin: dict = Depends(get_current_admin),
) -> dict:
    return {"jobs": job_manager.list_jobs(limit)}


@app.get("/api/jobs/{job_id}", tags=["system"])
async def get_job(
    job_id: str,
    _admin: dict = Depends(get_current_admin),
) -> dict:
    job = job_manager.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# Keep unknown API endpoints as API 404s before the frontend catch-all mount.
@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
@app.api_route(
    "/api",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
async def api_not_found(path: str = "") -> None:
    raise HTTPException(status_code=404, detail="Not Found")


# Frontend static build
_frontend_path = Path(settings.FRONTEND_DIST)

if _frontend_path.exists() and _frontend_path.is_dir():
    # Mount /assets separately so JS/CSS chunks are served with proper caching
    _assets_path = _frontend_path / "assets"
    if _assets_path.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_path)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> Response:
        """
        SPA catch-all: serve the exact file if it exists on disk (favicon, sw.js, etc.),
        otherwise return index.html so React Router handles the URL client-side.
        This fixes the 404 that occurred when opening /teacher/live-quiz/:id in a new tab.
        """
        # Guard against path traversal
        try:
            resolved = (_frontend_path / full_path).resolve()
            if not str(resolved).startswith(str(_frontend_path.resolve())):
                return Response(status_code=403)
        except Exception:
            return Response(status_code=403)

        if resolved.exists() and resolved.is_file():
            # Real file (favicon.ico, manifest.json, etc.) — serve directly
            no_cache = full_path in {"", ".", "index.html", "sw.js", "manifest.json"} or full_path.endswith(".html")
            headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"} if no_cache else {}
            return FileResponse(str(resolved), headers=headers)

        # Not a real file — fall back to index.html for React Router
        index_html = _frontend_path / "index.html"
        if index_html.exists():
            return FileResponse(
                str(index_html),
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )

        return Response("Frontend not built. Run: cd frontend && npm run build", status_code=503)

    logger.info("Frontend SPA serving enabled from {}", _frontend_path)
else:
    logger.warning(
        "Frontend dist directory '{}' not found — API-only mode. "
        "Run 'npm run build' in /frontend to serve the UI.",
        _frontend_path,
    )
