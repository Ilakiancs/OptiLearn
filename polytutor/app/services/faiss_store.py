"""
app/services/faiss_store.py — lazy-loaded FAISS index singleton.

Exposes a single public function:
    query(topic, grade_level, k=3) -> list[dict]

If the index file does not exist, logs a warning and returns [] without crashing.
"""
from __future__ import annotations

import json
import os
from typing import Any

import numpy as np
from loguru import logger

from app.core.config import settings

# ──────────────────────────────────────────────────────────────
# Lazy singleton state
# ──────────────────────────────────────────────────────────────
_index: Any | None = None
_meta: list[dict] | None = None
_embed_model: Any | None = None


def _load() -> bool:
    """
    Load the FAISS index, metadata, and embedding model on first call.

    Returns True if loading succeeded, False if index files are absent.
    """
    global _index, _meta, _embed_model  # noqa: PLW0603

    index_path = settings.FAISS_INDEX_PATH
    meta_path = settings.FAISS_META_PATH

    if not os.path.exists(index_path):
        logger.warning(
            "FAISS index not found at {}. Topic retrieval disabled. "
            "Run 'python data/scripts/build_index.py' to build it.",
            index_path,
        )
        return False

    if not os.path.exists(meta_path):
        logger.warning(
            "FAISS metadata not found at {}. Topic retrieval disabled.",
            meta_path,
        )
        return False

    logger.info("Loading FAISS index from {}", index_path)
    import faiss
    _index = faiss.read_index(index_path)

    with open(meta_path, encoding="utf-8") as fh:
        _meta = json.load(fh)

    logger.info("Loaded {} passages from metadata.", len(_meta))

    from sentence_transformers import SentenceTransformer
    logger.info("Loading embedding model: {}", settings.EMBED_MODEL)
    _embed_model = SentenceTransformer(settings.EMBED_MODEL)

    return True


# ──────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────
def query(topic: str, grade_level: int, k: int = 3) -> list[dict[str, Any]]:
    """
    Embed the topic string and return the top-k relevant curriculum passages.

    Args:
        topic:       Topic description to search for.
        grade_level: Student's grade level (used for metadata filtering hint).
        k:           Number of results to return.

    Returns:
        List of dicts with keys: passage, source, grade_hint, score.
        Returns [] if the index is not available.
    """
    global _index, _meta, _embed_model  # noqa: PLW0603

    if _index is None:
        success = _load()
        if not success:
            return []

    if _index is None or _meta is None or _embed_model is None:
        return []

    query_vec: np.ndarray = _embed_model.encode(
        [topic], convert_to_numpy=True
    ).astype(np.float32)

    distances, indices = _index.search(query_vec, k)

    results: list[dict] = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx < 0 or idx >= len(_meta):
            continue
        passage_meta = _meta[idx]
        results.append(
            {
                "passage": passage_meta["text"],
                "source": passage_meta["source"],
                "grade_hint": passage_meta.get("grade_hint", "all"),
                "score": float(dist),
            }
        )

    logger.debug(
        "FAISS query='{}' grade={} returned {} result(s)", topic, grade_level, len(results)
    )
    return results
