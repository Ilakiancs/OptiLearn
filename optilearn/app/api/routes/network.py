"""
app/api/routes/network.py — Network configuration and QR code endpoints.

Exposes the server URL, hotspot IP, QR code image, and the online/offline
mode toggle used by the teacher dashboard. Also returns the list of connected
student devices tracked by client_tracker.
"""
from __future__ import annotations

import base64
import io

import qrcode
from fastapi import APIRouter, Request, Response
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, StreamingResponse

from app.core.config import settings
from app.services import db
from app.services.client_tracker import active_clients
from app.services.dns_server import captive_portal_stats, is_captive_portal_active, start_captive_portal
from app.services.network import get_arp_clients, get_cached_hotspot_ip, get_server_url, refresh_ip_cache

router = APIRouter(tags=["network"])

THEME_BLUE = "#2a8dbf"
LIVE_CLIENT_WINDOW_SECONDS = 15
_seen_network_ips: set[str] = set()
_heartbeat_ips: dict[str, float] = {}  # ip → last heartbeat timestamp
HEARTBEAT_WINDOW_SECONDS = 20

_CAPTIVE_HOST_HINTS = (
    "captive.apple.com",
    "connectivitycheck.gstatic.com",
    "clients3.google.com",
    "detectportal.firefox.com",
    "msftconnecttest.com",
    "msftncsi.com",
    "samsung",
)


def _request_host(request: Request) -> str:
    return (request.headers.get("host") or "").split(":", 1)[0].lower()


def _should_redirect_captive_check(request: Request) -> bool:
    host = _request_host(request)
    local_hosts = {"", "localhost", "127.0.0.1", get_cached_hotspot_ip()}
    if host in local_hosts:
        return False
    return True if any(hint in host for hint in _CAPTIVE_HOST_HINTS) else host not in local_hosts


def _app_redirect() -> RedirectResponse:
    return RedirectResponse(url=f"{get_server_url()}/", status_code=302)


def _with_trailing_slash(url: str) -> str:
    return url if url.endswith("/") else f"{url}/"


def _primary_connect_url() -> str:
    return _with_trailing_slash(get_server_url())


def _mdns_connect_url() -> str:
    return f"http://optilearn.local:{settings.PORT}/"


@router.get("/generate_204", include_in_schema=False)
async def android_captive_204() -> RedirectResponse:
    return _app_redirect()


@router.get("/gen_204", include_in_schema=False)
async def android_captive_gen() -> RedirectResponse:
    return _app_redirect()


@router.get("/204", include_in_schema=False)
async def generic_204(request: Request) -> Response:
    if _should_redirect_captive_check(request):
        return _app_redirect()
    return Response(status_code=204)


@router.get("/hotspot-detect.html", include_in_schema=False)
async def ios_captive(request: Request) -> Response:
    if _should_redirect_captive_check(request):
        return _app_redirect()
    return HTMLResponse(
        content="<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"
    )


@router.get("/library/test/success.html", include_in_schema=False)
async def ios_captive_alt(request: Request) -> Response:
    if _should_redirect_captive_check(request):
        return _app_redirect()
    return HTMLResponse(content="<HTML><BODY>Success</BODY></HTML>")


@router.get("/ncsi.txt", include_in_schema=False)
async def windows_ncsi(request: Request) -> Response:
    if _should_redirect_captive_check(request):
        return _app_redirect()
    return PlainTextResponse("Microsoft NCSI")


@router.get("/connecttest.txt", include_in_schema=False)
async def windows_connect(request: Request) -> Response:
    if _should_redirect_captive_check(request):
        return _app_redirect()
    return PlainTextResponse("Microsoft Connect Test")


@router.get("/success.txt", include_in_schema=False)
async def firefox_captive(request: Request) -> Response:
    if _should_redirect_captive_check(request):
        return _app_redirect()
    return PlainTextResponse("success")


async def _network_payload() -> dict:
    import time as _time
    hotspot_ip = get_cached_hotspot_ip()
    browser_clients = active_clients(window_seconds=LIVE_CLIENT_WINDOW_SECONDS)
    arp_clients = get_arp_clients()
    db_student_count = await db.count_recent_active_students()
    browser_ips = {client["ip"] for client in browser_clients}
    browser_ips.discard(hotspot_ip)
    _seen_network_ips.update(browser_ips)

    # Live count: prefer heartbeat-filtered IPs (students actively on the page)
    now = _time.time()
    live_heartbeat_ips = {ip for ip, ts in _heartbeat_ips.items() if now - ts <= HEARTBEAT_WINDOW_SECONDS}
    live_count = len(live_heartbeat_ips & browser_ips) if live_heartbeat_ips else len(browser_ips)

    return {
        "hotspot_ip": hotspot_ip,
        "server_url": get_server_url(),
        "connect_url": _primary_connect_url(),
        "mdns_url": _mdns_connect_url(),
        "captive_portal_active": is_captive_portal_active(),
        "port": settings.PORT,
        "student_count": db_student_count,
        "network_client_count": live_count,
        "current_network_client_count": live_count,
        "seen_network_client_count": len(_seen_network_ips),
        "live_window_seconds": LIVE_CLIENT_WINDOW_SECONDS,
        "recent_student_count": db_student_count,
        "browser_client_count": len(browser_clients),
        "arp_client_count": len(arp_clients),
        "browser_clients": browser_clients,
        "arp_clients": arp_clients,
        "dns": captive_portal_stats(),
        "wifi_ssid": "OptiLearn",
    }


@router.get("/api/network/status")
async def network_status() -> dict:
    return await _network_payload()


@router.post("/api/network/heartbeat")
async def network_heartbeat(request: Request) -> dict:
    import time as _time
    from app.services.client_tracker import _is_trackable_ip  # noqa: PLC0415
    client_ip = request.client.host if request.client else None
    if client_ip and _is_trackable_ip(client_ip):
        _heartbeat_ips[client_ip] = _time.time()
    return await _network_payload()


@router.api_route("/api/network/refresh", methods=["GET", "POST"])
async def refresh_network_status() -> dict:
    hotspot_ip = refresh_ip_cache()
    start_captive_portal(hotspot_ip)
    return await _network_payload()


def _qr_png_bytes() -> bytes:
    qr = qrcode.QRCode(
        version=2,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=12,
        border=4,
    )
    qr.add_data(_primary_connect_url())
    qr.make(fit=True)
    img = qr.make_image(fill_color=THEME_BLUE, back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@router.get("/api/network/qr")
@router.get("/api/network/qr.png")
async def get_connection_qr() -> StreamingResponse:
    buf = io.BytesIO(_qr_png_bytes())
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/png",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


@router.head("/api/network/qr")
@router.head("/api/network/qr.png")
async def head_connection_qr() -> Response:
    return Response(headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})


@router.get("/api/network/qr-data")
async def get_connection_qr_data() -> dict:
    encoded = base64.b64encode(_qr_png_bytes()).decode("ascii")
    return {
        "url": _primary_connect_url(),
        "mdns_url": _mdns_connect_url(),
        "data_url": f"data:image/png;base64,{encoded}",
    }
