"""
Small UDP DNS responder for classroom captive-portal discovery.

When the teacher runs OptiLearn as administrator, DNS port 53 can bind and all
student DNS lookups resolve to the teacher laptop. Without administrator rights
the QR/manual URL flow still works.
"""
from __future__ import annotations

import socket
import threading
import time

from dnslib import A, DNSRecord, QTYPE, RR
from loguru import logger


class CaptivePortalDNS:
    def __init__(self, redirect_ip: str, port: int = 53):
        self.redirect_ip = redirect_ip
        self.port = port
        self._thread: threading.Thread | None = None
        self._running = False
        self._sock: socket.socket | None = None
        self._tcp_sock: socket.socket | None = None
        self._started = threading.Event()
        self.active = False
        self.query_count = 0
        self.last_query_at: float | None = None
        self.last_clients: list[str] = []

    def _handle(self, data: bytes, addr: tuple[str, int], sock: socket.socket) -> None:
        try:
            request = DNSRecord.parse(data)
            reply = request.reply()
            qname = str(request.q.qname)
            reply.add_answer(RR(qname, QTYPE.A, rdata=A(self.redirect_ip), ttl=10))
            sock.sendto(reply.pack(), addr)
            self._record_query(addr)
        except Exception as exc:
            logger.debug("DNS handler error: {}", exc)

    def _record_query(self, addr: tuple[str, int]) -> None:
        self.query_count += 1
        self.last_query_at = time.time()
        ip = addr[0]
        if ip not in self.last_clients:
            self.last_clients.append(ip)
            self.last_clients = self.last_clients[-20:]

    def _handle_tcp_client(self, conn: socket.socket, addr: tuple[str, int]) -> None:
        try:
            with conn:
                length_bytes = conn.recv(2)
                if len(length_bytes) != 2:
                    return
                length = int.from_bytes(length_bytes, "big")
                data = conn.recv(length)
                request = DNSRecord.parse(data)
                reply = request.reply()
                qname = str(request.q.qname)
                reply.add_answer(RR(qname, QTYPE.A, rdata=A(self.redirect_ip), ttl=10))
                payload = reply.pack()
                conn.sendall(len(payload).to_bytes(2, "big") + payload)
                self._record_query(addr)
        except Exception as exc:
            logger.debug("DNS TCP handler error: {}", exc)

    def _serve_tcp(self) -> None:
        try:
            self._tcp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self._tcp_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._tcp_sock.settimeout(1.0)
            self._tcp_sock.bind(("0.0.0.0", self.port))
            self._tcp_sock.listen(16)
            while self._running:
                try:
                    conn, addr = self._tcp_sock.accept()
                    threading.Thread(
                        target=self._handle_tcp_client,
                        args=(conn, addr),
                        daemon=True,
                    ).start()
                except socket.timeout:
                    continue
                except OSError:
                    break
        except Exception as exc:
            logger.debug("DNS TCP listener unavailable: {}", exc)
        finally:
            if self._tcp_sock:
                try:
                    self._tcp_sock.close()
                except OSError:
                    pass
                self._tcp_sock = None

    def _serve(self) -> None:
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self._sock.settimeout(1.0)
            self._sock.bind(("0.0.0.0", self.port))
            self.active = True
            self._started.set()
            threading.Thread(target=self._serve_tcp, daemon=True).start()
            logger.info(
                "Captive portal DNS active; all domains redirect to {}",
                self.redirect_ip,
            )
            while self._running:
                try:
                    data, addr = self._sock.recvfrom(512)
                    threading.Thread(
                        target=self._handle,
                        args=(data, addr, self._sock),
                        daemon=True,
                    ).start()
                except socket.timeout:
                    continue
                except OSError:
                    break
        except PermissionError:
            self.active = False
            self._started.set()
            logger.warning(
                "DNS port 53 requires administrator privileges. "
                "Captive portal auto-connect disabled. "
                "Students can still connect via QR code or manual URL."
            )
        except Exception as exc:
            self.active = False
            self._started.set()
            logger.error("DNS server could not start: {}", exc)
        finally:
            self.active = False
            if self._sock:
                try:
                    self._sock.close()
                except OSError:
                    pass
                self._sock = None

    def start(self) -> bool:
        if self._thread and self._thread.is_alive():
            return self.active
        self._running = True
        self._started.clear()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()
        self._started.wait(timeout=0.75)
        return self.active

    def stop(self) -> None:
        self._running = False
        if self._sock:
            try:
                self._sock.close()
            except OSError:
                pass
        if self._tcp_sock:
            try:
                self._tcp_sock.close()
            except OSError:
                pass


_dns: CaptivePortalDNS | None = None


def start_captive_portal(redirect_ip: str) -> bool:
    global _dns
    if _dns and _dns.active and _dns.redirect_ip == redirect_ip:
        return True
    if _dns:
        _dns.stop()
    _dns = CaptivePortalDNS(redirect_ip=redirect_ip)
    return _dns.start()


def stop_captive_portal() -> None:
    if _dns:
        _dns.stop()


def is_captive_portal_active() -> bool:
    return bool(_dns and _dns.active)


def captive_portal_stats() -> dict:
    return {
        "active": bool(_dns and _dns.active),
        "query_count": _dns.query_count if _dns else 0,
        "last_query_at": _dns.last_query_at if _dns else None,
        "last_clients": list(_dns.last_clients) if _dns else [],
    }
