"""
Runtime LAN helpers for classroom hotspot sharing.

The teacher laptop is expected to be the server. We prefer the Windows
Mobile Hotspot subnet, then other active private LAN addresses, and finally
fall back to the usual Windows hotspot gateway.
"""
from __future__ import annotations

import ipaddress
import socket
import subprocess

import psutil
from loguru import logger

from app.core.config import settings

_cached_ip: str | None = None

_PREFERRED_INTERFACE_HINTS = (
    "mobile hotspot",
    "wi-fi",
    "wifi",
    "wireless",
    "wlan",
    "local area connection",
    "ethernet",
)
_SKIP_INTERFACE_HINTS = (
    "bluetooth",
    "docker",
    "hyper-v",
    "loopback",
    "npcap",
    "virtualbox",
    "vmware",
    "vmswitch",
    "wsl",
)


def _is_ipv4_private_candidate(ip: str) -> bool:
    try:
        parsed = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return bool(
        parsed.version == 4
        and parsed.is_private
        and not parsed.is_loopback
        and not parsed.is_link_local
        and not parsed.is_unspecified
    )


def _interface_is_up(iface: str) -> bool:
    try:
        stats = psutil.net_if_stats().get(iface)
    except Exception:
        return True
    return True if stats is None else bool(stats.isup)


def _interface_score(iface: str, ip: str) -> int:
    name = iface.lower()
    score = 0
    if any(hint in name for hint in _SKIP_INTERFACE_HINTS):
        score -= 100
    if ip == "192.168.137.1":
        score += 1000
    elif ip.startswith("192.168.137."):
        score += 900
    if any(hint in name for hint in _PREFERRED_INTERFACE_HINTS):
        score += 100
    if ip.startswith("10.") or ip.startswith("192.168.") or ip.startswith("172."):
        score += 10
    return score


def get_hotspot_ip() -> str:
    """
    Detect the IP address students should use to reach OptiLearn.

    Priority:
      1. Windows Mobile Hotspot gateway/subnet, especially 192.168.137.1
      2. Active private LAN addresses on physical-looking interfaces
      3. Fallback to 192.168.137.1
    """
    candidates: list[tuple[int, str, str]] = []
    try:
        for iface, addrs in psutil.net_if_addrs().items():
            if not _interface_is_up(iface):
                continue
            for addr in addrs:
                if addr.family != socket.AF_INET:
                    continue
                ip = getattr(addr, "address", "")
                if not _is_ipv4_private_candidate(ip):
                    continue
                candidates.append((_interface_score(iface, ip), ip, iface))
    except Exception as exc:
        logger.warning("IP detection could not complete: {}", exc)

    if candidates:
        candidates.sort(key=lambda row: row[0], reverse=True)
        score, ip, iface = candidates[0]
        logger.info("Classroom LAN IP detected: {} ({}, score={})", ip, iface, score)
        return ip

    logger.warning("No private LAN address detected; using Windows hotspot fallback")
    return "192.168.137.1"


def get_cached_hotspot_ip() -> str:
    global _cached_ip
    if _cached_ip is None:
        _cached_ip = get_hotspot_ip()
    return _cached_ip


def refresh_ip_cache() -> str:
    global _cached_ip
    _cached_ip = None
    return get_cached_hotspot_ip()


def get_server_url() -> str:
    return f"http://{get_cached_hotspot_ip()}:{settings.PORT}"


def get_arp_clients() -> list[str]:
    """Best-effort list of devices recently seen by Windows ARP on the hotspot."""
    hotspot_ip = get_cached_hotspot_ip()
    parts = hotspot_ip.split(".")
    if len(parts) != 4:
        return []
    prefix = ".".join(parts[:3]) + "."
    try:
        result = subprocess.run(
            ["arp", "-a"],
            capture_output=True,
            text=True,
            timeout=3,
        )
    except Exception as exc:
        logger.debug("ARP client scan unavailable: {}", exc)
        return []
    if result.returncode != 0:
        return []
    clients: set[str] = set()
    for token in result.stdout.replace("\r", " ").replace("\n", " ").split():
        if not token.startswith(prefix):
            continue
        if token in {hotspot_ip, f"{prefix}255"}:
            continue
        clients.add(token)
    return sorted(clients)
