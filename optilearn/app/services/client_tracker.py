"""In-memory tracker for classroom browsers seen by the OptiLearn server."""
from __future__ import annotations

import ipaddress
import time
from dataclasses import dataclass, asdict


@dataclass
class SeenClient:
    ip: str
    last_seen: float
    path: str
    user_agent: str


_clients: dict[str, SeenClient] = {}
_seen_client_ips: set[str] = set()


def _is_trackable_ip(ip: str) -> bool:
    try:
        parsed = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return bool(parsed.version == 4 and parsed.is_private and not parsed.is_loopback)


def record_client(ip: str | None, path: str, user_agent: str | None = None) -> None:
    if not ip or not _is_trackable_ip(ip):
        return
    _seen_client_ips.add(ip)
    _clients[ip] = SeenClient(
        ip=ip,
        last_seen=time.time(),
        path=path,
        user_agent=(user_agent or "")[:180],
    )


def active_clients(window_seconds: int = 600) -> list[dict]:
    cutoff = time.time() - window_seconds
    stale = [ip for ip, client in _clients.items() if client.last_seen < cutoff]
    for ip in stale:
        _clients.pop(ip, None)
    rows = []
    for client in sorted(_clients.values(), key=lambda row: row.last_seen, reverse=True):
        data = asdict(client)
        data["seconds_ago"] = int(time.time() - client.last_seen)
        rows.append(data)
    return rows


def seen_client_count() -> int:
    return len(_seen_client_ips)
