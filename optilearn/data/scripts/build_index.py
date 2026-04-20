"""
data/scripts/build_index.py — one-time FAISS index builder.

Reads all .txt files from CURRICULUM_DIR, splits them into overlapping passages,
embeds them with sentence-transformers, and saves the FAISS index + metadata JSON.

Usage:
    python data/scripts/build_index.py
"""
import json
import os
import sys
import uuid

# Ensure project root is on the path when run directly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../.."))

import faiss
import numpy as np
from loguru import logger
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

from app.core.config import settings

# ──────────────────────────────────────────────────────────────
# Passage splitting
# ──────────────────────────────────────────────────────────────
_PASSAGE_WORDS = 200
_OVERLAP_WORDS = 20


def _split_passages(text: str, source: str) -> list[dict]:
    """
    Split text into passages of ~200 words with a 20-word overlap.

    Args:
        text:   Raw file content.
        source: Filename used as source metadata.

    Returns:
        List of passage dicts with keys: id, text, source, grade_hint.
    """
    words = text.split()
    passages: list[dict] = []
    start = 0

    while start < len(words):
        end = min(start + _PASSAGE_WORDS, len(words))
        chunk = " ".join(words[start:end])
        grade_hint = _infer_grade_hint(source)
        passages.append(
            {
                "id": str(uuid.uuid4()),
                "text": chunk,
                "source": source,
                "grade_hint": grade_hint,
            }
        )
        if end == len(words):
            break
        start = end - _OVERLAP_WORDS

    return passages


def _infer_grade_hint(source: str) -> str:
    """
    Infer a coarse grade hint from the filename.

    For example 'math_counting.txt' → 'grade_1_2', 'math_fractions.txt' → 'grade_3_4'.
    Returns 'all' if no hint can be derived.
    """
    name = source.lower()
    if "counting" in name or "hygiene" in name or "phonics" in name:
        return "grade_1_2"
    if "fractions" in name or "water_cycle" in name:
        return "grade_3_4"
    return "all"


# ──────────────────────────────────────────────────────────────
# Main build routine
# ──────────────────────────────────────────────────────────────
def build_index() -> None:
    """Load curriculum files, embed passages, and save FAISS index + metadata."""
    curriculum_dir = settings.CURRICULUM_DIR
    index_path = settings.FAISS_INDEX_PATH
    meta_path = settings.FAISS_META_PATH
    embed_model_name = settings.EMBED_MODEL

    txt_files = sorted(
        f for f in os.listdir(curriculum_dir) if f.endswith(".txt")
    )
    if not txt_files:
        logger.error("No .txt files found in {}", curriculum_dir)
        sys.exit(1)

    logger.info("Found {} curriculum file(s) in {}", len(txt_files), curriculum_dir)

    all_passages: list[dict] = []
    for fname in txt_files:
        fpath = os.path.join(curriculum_dir, fname)
        with open(fpath, encoding="utf-8") as fh:
            text = fh.read().strip()
        passages = _split_passages(text, fname)
        all_passages.extend(passages)
        logger.info("  {} → {} passage(s)", fname, len(passages))

    logger.info("Total passages to embed: {}", len(all_passages))

    logger.info("Loading embedding model: {}", embed_model_name)
    model = SentenceTransformer(embed_model_name)

    texts = [p["text"] for p in all_passages]
    embeddings: np.ndarray = model.encode(
        texts,
        show_progress_bar=True,
        batch_size=32,
        convert_to_numpy=True,
    )

    dim = embeddings.shape[1]
    index = faiss.IndexFlatL2(dim)
    index.add(embeddings.astype(np.float32))

    os.makedirs(os.path.dirname(index_path), exist_ok=True)
    faiss.write_index(index, index_path)
    logger.info("FAISS index saved to {}", index_path)

    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(all_passages, fh, ensure_ascii=False, indent=2)
    logger.info("Metadata saved to {}", meta_path)

    print(f"\n✓ Indexed {len(all_passages)} passages from {len(txt_files)} file(s).")


if __name__ == "__main__":
    build_index()
