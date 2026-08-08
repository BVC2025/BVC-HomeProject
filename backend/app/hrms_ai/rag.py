"""
Retrieval layer: takes a user question, returns the top-K most
relevant knowledge-base chunks. Pure Python, no external vector DB.

The index is a JSON file on disk written by knowledge_builder.py.
We load it once per process on first use and keep the embedding
matrix cached in memory.
"""

from __future__ import annotations

import logging
import math
import threading
from typing import List, Optional, Tuple

from app.hrms_ai.gemini_client import embed_text
from app.hrms_ai.knowledge_builder import load_index


log = logging.getLogger("hrms_ai.rag")


# In-process cache — loaded on first retrieve() call.
_LOCK = threading.Lock()
_CHUNKS: Optional[List[dict]] = None
_VECTORS: Optional[List[List[float]]] = None


def _ensure_loaded() -> None:
    global _CHUNKS, _VECTORS
    if _CHUNKS is not None:
        return
    with _LOCK:
        if _CHUNKS is not None:
            return
        idx = load_index()
        _CHUNKS = idx
        _VECTORS = [c.get("embedding") or [] for c in idx]
        log.info("hrms_ai.rag: loaded %d chunks from index", len(_CHUNKS))


def reload_index() -> int:
    """Force a re-read of the index file from disk. Called by the
    admin /rebuild endpoint after regeneration so the running server
    picks up the new index without a restart."""

    global _CHUNKS, _VECTORS
    with _LOCK:
        idx = load_index()
        _CHUNKS = idx
        _VECTORS = [c.get("embedding") or [] for c in idx]
        log.info("hrms_ai.rag: reloaded %d chunks", len(_CHUNKS))
        return len(_CHUNKS)


def _cosine(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def retrieve(question: str, top_k: int = 5, min_score: float = 0.30) -> List[Tuple[dict, float]]:
    """Return the top-K knowledge chunks for the given question,
    filtered to those scoring above `min_score`.

    Result: list of (chunk, cosine_score) pairs, sorted best-first.
    Empty list means either the index is empty or nothing matched
    well enough — the caller should return a canned 'not in the docs'
    reply rather than passing empty context to Gemini.
    """

    _ensure_loaded()
    if not _CHUNKS or not _VECTORS:
        return []

    q_vec_list = embed_text([question], task_type="RETRIEVAL_QUERY")
    if not q_vec_list:
        return []
    q_vec = q_vec_list[0]

    scored: List[Tuple[dict, float]] = []
    for chunk, vec in zip(_CHUNKS, _VECTORS):
        score = _cosine(q_vec, vec)
        if score >= min_score:
            scored.append((chunk, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_k]


def index_size() -> int:
    _ensure_loaded()
    return len(_CHUNKS or [])
