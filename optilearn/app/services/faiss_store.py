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
_embed_error = ""
_embed_resolved_model = ""


def _offline_env() -> None:
    """Tell Hugging Face libraries not to use the network in classroom mode."""
    if settings.HF_LOCAL_FILES_ONLY:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"


def _resolve_model_ref(model_ref: str, group: str) -> str:
    """Prefer explicit local folders while still allowing a fully cached HF id."""
    path = os.path.expanduser(model_ref)
    if os.path.exists(path):
        return path

    leaf = model_ref.rsplit("/", 1)[-1]
    slug = model_ref.replace("/", "-")
    for name in (leaf, slug):
        candidate = os.path.join(".", "models", group, name)
        if os.path.exists(candidate):
            return candidate
    return model_ref


def _load_embed_model() -> Any | None:
    """Load the embedding model without contacting Hugging Face."""
    global _embed_error, _embed_model, _embed_resolved_model  # noqa: PLW0603

    if _embed_model is not None:
        return _embed_model

    _offline_env()
    _embed_resolved_model = _resolve_model_ref(settings.EMBED_MODEL, "embeddings")
    try:
        from sentence_transformers import SentenceTransformer

        logger.info("Loading embedding model: {}", _embed_resolved_model)
        _embed_model = SentenceTransformer(
            _embed_resolved_model,
            local_files_only=settings.HF_LOCAL_FILES_ONLY,
        )
        _embed_error = ""
        logger.info("Embedding model ready.")
        return _embed_model
    except Exception as exc:
        _embed_error = (
            f"{exc!r}. Put the embedding model in ./models/embeddings/ or set "
            "EMBED_MODEL to a local folder."
        )
        logger.warning("Embedding model unavailable; vector indexing disabled: {}", _embed_error)
        return None


def get_embed_status() -> dict[str, Any]:
    """Return embedding readiness without triggering a model load."""
    resolved = _embed_resolved_model or _resolve_model_ref(settings.EMBED_MODEL, "embeddings")
    return {
        "ready": _embed_model is not None,
        "model": settings.EMBED_MODEL,
        "resolved_model": resolved,
        "local_files_only": settings.HF_LOCAL_FILES_ONLY,
        "error": _embed_error,
    }


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

    _embed_model = _load_embed_model()
    if _embed_model is None:
        return False

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


def ensure_embed_model() -> None:
    """Load the sentence-transformer embedding model into memory if not already loaded.
    Call once at startup so notes generation doesn't pay the 70-second cold-start cost.
    Also does a warmup inference so the JIT-compiled path is hot before the first real query.
    """
    global _embed_model  # noqa: PLW0603
    if _embed_model is None:
        _load_embed_model()
    if _embed_model is not None:
        try:
            _embed_model.encode(["warmup"], convert_to_numpy=True)
            logger.info("Embedding model warmup inference done.")
        except Exception as exc:
            logger.warning("Embedding warmup inference failed: {}", exc)


def add_passages(passages: list[dict]) -> int:
    """
    Embed and add new passages to the live FAISS index.

    Each passage dict must have: {"text": str, "source": str, "student_id": str | None}
    Persists updated index and metadata to disk.
    Returns number of passages added.
    """
    global _index, _meta, _embed_model  # noqa: PLW0603

    if not passages:
        return 0

    if _embed_model is None:
        _embed_model = _load_embed_model()
        if _embed_model is None:
            logger.warning("Skipping FAISS indexing because the embedding model is unavailable.")
            return 0

    texts = [p["text"] for p in passages]
    import numpy as np
    embeddings = _embed_model.encode(texts, convert_to_numpy=True).astype(np.float32)

    if _index is None:
        import faiss
        dim = embeddings.shape[1]
        _index = faiss.IndexFlatL2(dim)
        _meta = []

    _index.add(embeddings)

    import uuid as _uuid
    if _meta is None:
        _meta = []
    for p in passages:
        _meta.append({
            "id": str(_uuid.uuid4()),
            "text": p["text"],
            "source": p.get("source", "upload"),
            "grade_hint": p.get("grade_hint", "all"),
            "student_id": p.get("student_id"),
        })

    import faiss as _faiss, json as _json, os as _os, tempfile as _tf
    index_dir = _os.path.dirname(settings.FAISS_INDEX_PATH) or "."
    _os.makedirs(index_dir, exist_ok=True)
    _faiss.write_index(_index, settings.FAISS_INDEX_PATH)
    with _tf.NamedTemporaryFile(
        mode="w", encoding="utf-8", delete=False,
        dir=_os.path.dirname(settings.FAISS_META_PATH) or ".",
    ) as tmp:
        _json.dump(_meta, tmp, ensure_ascii=False)
        tmp_path = tmp.name
    _os.replace(tmp_path, settings.FAISS_META_PATH)

    logger.info("add_passages: added {} passages, index total={}", len(passages), _index.ntotal)
    return len(passages)


def reset_index() -> None:
    """Drop the in-memory FAISS index so the next query reloads it from disk.

    Call this after an external rebuild of the curriculum index files so the
    server picks up the new content without a restart.
    """
    global _index, _meta  # noqa: PLW0603
    _index = None
    _meta = None
    logger.info("FAISS index reset; will reload from disk on next query.")
