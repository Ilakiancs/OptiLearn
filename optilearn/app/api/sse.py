"""Shared SSE formatting helper used across all streaming route modules."""
import json


def sse(event: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(event)}\n\n"
