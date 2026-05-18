"""Shared SSE formatting helper used across all streaming route modules."""
import json


def sse(event: dict) -> str:
    """Format a dict as an SSE data line."""
    try:
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
    except TypeError:
        return f"data: {json.dumps({'type': 'error', 'message': 'serialization_failed'})}\n\n"
