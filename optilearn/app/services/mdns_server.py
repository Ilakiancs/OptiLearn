"""
app/services/mdns_server.py — mDNS/Bonjour service registration.

Broadcasts optilearn.local on the LAN so iOS/macOS devices can reach the
server by hostname without knowing the hotspot IP. Uses the zeroconf library.
Start with start_mdns(port); stop cleanly with stop_mdns().
"""
from __future__ import annotations

import socket
import threading

from loguru import logger
from zeroconf import ServiceInfo, Zeroconf

_zeroconf: Zeroconf | None = None
_thread: threading.Thread | None = None
_lock = threading.Lock()


def get_local_ip() -> str:
    try:
        from app.services.network import get_cached_hotspot_ip

        ip = get_cached_hotspot_ip()
        if ip:
            return ip
    except Exception:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "192.168.137.1"


def _register_mdns(port: int) -> None:
    global _zeroconf
    try:
        with _lock:
            if _zeroconf:
                _zeroconf.close()
                _zeroconf = None

            ip = get_local_ip()
            ip_bytes = socket.inet_aton(ip)

            info = ServiceInfo(
                "_http._tcp.local.",
                "OptiLearn._http._tcp.local.",
                addresses=[ip_bytes],
                port=port,
                properties={"path": "/"},
                server="optilearn.local.",
            )

            _zeroconf = Zeroconf()
            _zeroconf.register_service(info)
            logger.info(
                "mDNS active - students can connect at http://optilearn.local:{}",
                port,
            )
    except Exception as exc:
            logger.warning(
                "mDNS failed to start: {}. Students use IP or QR code instead.",
                exc,
            )


def start_mdns(port: int = 8000) -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _thread = threading.Thread(target=_register_mdns, args=(port,), daemon=True)
    _thread.start()


def stop_mdns() -> None:
    global _zeroconf
    with _lock:
        if _zeroconf:
            _zeroconf.close()
            _zeroconf = None
