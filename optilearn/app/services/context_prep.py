"""Deterministic context preparation before model calls."""
from __future__ import annotations

import re
from typing import Any


def select_chat_history(
    messages: list[dict[str, Any]],
    current_message: str,
    *,
    max_recent: int = 6,
    max_relevant: int = 4,
) -> list[dict[str, str]]:
    """Keep recent turns plus simple lexical matches to reduce prompt bulk."""
    cleaned = [
        {"role": msg["role"], "content": (msg.get("content") or "").strip()}
        for msg in messages
        if msg.get("role") in {"user", "assistant"} and (msg.get("content") or "").strip()
    ]
    if not cleaned:
        return []

    recent = cleaned[-max_recent:]
    recent_ids = {id(item) for item in recent}
    query_terms = _terms(current_message)
    scored: list[tuple[int, int, dict[str, str]]] = []
    for index, item in enumerate(cleaned[:-max_recent] if len(cleaned) > max_recent else []):
        score = len(query_terms & _terms(item["content"]))
        if score > 0:
            scored.append((score, index, item))

    relevant = [
        item
        for _, _, item in sorted(scored, key=lambda row: (-row[0], -row[1]))[:max_relevant]
        if id(item) not in recent_ids
    ]
    selected = relevant + recent
    selected.sort(key=lambda item: cleaned.index(item))
    return selected


def summarize_records_for_prompt(records: list[dict[str, Any]], max_items: int = 12) -> str:
    """Create a concise deterministic summary for reports before AI expansion."""
    lines: list[str] = []
    for row in records[:max_items]:
        pieces = [
            f"{key}: {value}"
            for key, value in row.items()
            if value not in (None, "", [], {})
        ]
        if pieces:
            lines.append("- " + "; ".join(pieces[:6]))
    return "\n".join(lines)


def _terms(text: str) -> set[str]:
    return {
        part
        for part in re.findall(r"[A-Za-z0-9']+", (text or "").lower())
        if len(part) > 2
    }
