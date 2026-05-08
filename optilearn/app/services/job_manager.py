"""In-memory background job registry for long-running system work."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from loguru import logger

_jobs: dict[str, dict[str, Any]] = {}
_tasks: dict[str, asyncio.Task] = {}
_MAX_JOBS = 200


def create_job(
    name: str,
    call_factory: Callable[[], Awaitable[Any]],
    *,
    metadata: dict[str, Any] | None = None,
) -> str:
    job_id = uuid.uuid4().hex[:16]
    _jobs[job_id] = {
        "id": job_id,
        "name": name,
        "status": "queued",
        "progress": 0,
        "metadata": metadata or {},
        "result": None,
        "error": "",
        "created_at_ms": int(time.time() * 1000),
        "started_at_ms": None,
        "finished_at_ms": None,
    }
    _tasks[job_id] = asyncio.create_task(_run_job(job_id, call_factory))
    _trim_jobs()
    return job_id


async def _run_job(job_id: str, call_factory: Callable[[], Awaitable[Any]]) -> None:
    job = _jobs[job_id]
    job["status"] = "running"
    job["started_at_ms"] = int(time.time() * 1000)
    try:
        result = await call_factory()
        job["status"] = "complete"
        job["progress"] = 100
        job["result"] = result
    except asyncio.CancelledError:
        job["status"] = "cancelled"
        job["error"] = "cancelled"
        raise
    except Exception as exc:
        job["status"] = "error"
        job["error"] = repr(exc)
        logger.error("Background job {} ({}) failed: {!r}", job_id, job["name"], exc)
    finally:
        job["finished_at_ms"] = int(time.time() * 1000)


def update_job(job_id: str, *, progress: int | None = None, metadata: dict[str, Any] | None = None) -> None:
    job = _jobs.get(job_id)
    if not job:
        return
    if progress is not None:
        job["progress"] = max(0, min(100, int(progress)))
    if metadata:
        job["metadata"] = {**job.get("metadata", {}), **metadata}


def cancel_job(job_id: str) -> bool:
    task = _tasks.get(job_id)
    if not task or task.done():
        return False
    task.cancel()
    return True


def get_job(job_id: str) -> dict[str, Any] | None:
    job = _jobs.get(job_id)
    return dict(job) if job else None


def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    jobs = sorted(_jobs.values(), key=lambda j: j["created_at_ms"], reverse=True)
    return [dict(job) for job in jobs[: max(0, min(limit, _MAX_JOBS))]]


def snapshot() -> dict[str, Any]:
    jobs = list(_jobs.values())
    return {
        "active": sum(1 for job in jobs if job["status"] in {"queued", "running"}),
        "total_tracked": len(jobs),
        "recent": list_jobs(20),
    }


def _trim_jobs() -> None:
    if len(_jobs) <= _MAX_JOBS:
        return
    ordered = sorted(_jobs.values(), key=lambda j: j["created_at_ms"])
    for job in ordered[: len(_jobs) - _MAX_JOBS]:
        task = _tasks.get(job["id"])
        if task and not task.done():
            continue
        _jobs.pop(job["id"], None)
        _tasks.pop(job["id"], None)
