"""
Minimal vector index for the AI chatbot's RAG layer.

  • Persistence:  plain JSON at data/rag_index.json (no ChromaDB, no
                  SQLite extension, no native code). Zero new pip deps.
  • Search:       pure-numpy cosine similarity. Fast enough up to ~10k
                  chunks on CPU (single index build is a few hundred).
  • Model-agnostic: we store the embedding vectors as raw lists and
                  don't care which model produced them, but we do save
                  the model name so we can invalidate the file when it
                  changes.

If numpy isn't available we degrade to plain Python (~5× slower but
still workable at this scale).
"""

from __future__ import annotations

import json
import math
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


try:

    import numpy as _np

    _HAS_NUMPY = True

except Exception:

    _np = None  # type: ignore
    _HAS_NUMPY = False


# =====================================================================
# Location — resolve once at import time
# =====================================================================


def _index_path() -> Path:

    override = os.getenv("RAG_INDEX_PATH", "").strip()

    if override:

        p = Path(override)

    else:

        # backend/data/rag_index.json  (relative to this file's package)
        # This works whether uvicorn is launched from repo root, backend/,
        # or the fully-qualified module path.
        pkg_root = Path(__file__).resolve().parent.parent   # .../backend/app
        p = pkg_root.parent / "data" / "rag_index.json"     # .../backend/data/rag_index.json

    p.parent.mkdir(parents=True, exist_ok=True)

    return p


# =====================================================================
# In-memory + JSON persistence
# =====================================================================


class _State:
    """Container for the live index, guarded by a lock so we can rebuild
    concurrently with query traffic."""

    lock = threading.RLock()
    chunks: List[Dict[str, Any]] = []
    matrix: Optional[Any] = None    # numpy array (N, D) or None
    dim: int = 0
    model: Optional[str] = None
    built_at: Optional[str] = None
    loaded: bool = False


def _cosine_np(query_vec: List[float], matrix) -> Any:

    q = _np.asarray(query_vec, dtype="float32")
    q_norm = _np.linalg.norm(q) or 1.0

    m_norm = _np.linalg.norm(matrix, axis=1)
    # Guard against zero-vector rows (shouldn't happen but be safe)
    m_norm = _np.where(m_norm == 0, 1.0, m_norm)

    return (matrix @ q) / (m_norm * q_norm)


def _cosine_py(query_vec: List[float], vecs: List[List[float]]) -> List[float]:

    def _dot(a, b):
        return sum(x * y for x, y in zip(a, b))

    def _norm(a):
        return math.sqrt(sum(x * x for x in a)) or 1.0

    qn = _norm(query_vec)

    out = []

    for v in vecs:

        n = _norm(v)

        out.append(_dot(query_vec, v) / (n * qn))

    return out


def _rebuild_matrix(chunks: List[Dict[str, Any]]) -> Tuple[Optional[Any], int]:
    """Rebuild the dense matrix from stored chunk vectors."""

    vecs = [c.get("embedding") or [] for c in chunks]

    if not vecs or not vecs[0]:

        return None, 0

    dim = len(vecs[0])

    if _HAS_NUMPY:

        try:

            arr = _np.asarray(vecs, dtype="float32")

            return arr, dim

        except Exception:

            return None, dim

    return None, dim


def load() -> None:
    """Load the JSON file into memory. Idempotent — safe to call more
    than once. Silent no-op if the file doesn't exist yet."""

    with _State.lock:

        if _State.loaded:

            return

        path = _index_path()

        if not path.exists():

            _State.loaded = True
            return

        try:

            raw = json.loads(path.read_text(encoding="utf-8"))

        except Exception:

            _State.loaded = True
            return

        chunks = raw.get("chunks") or []

        _State.chunks   = chunks
        _State.dim      = int(raw.get("dim") or 0)
        _State.model    = raw.get("model")
        _State.built_at = raw.get("built_at")
        _State.matrix, dim = _rebuild_matrix(chunks)

        if dim:

            _State.dim = dim

        _State.loaded = True


def save() -> None:

    with _State.lock:

        path = _index_path()

        payload = {
            "model":    _State.model,
            "dim":      _State.dim,
            "built_at": _State.built_at,
            "chunks":   _State.chunks,
        }

        tmp = path.with_suffix(".json.tmp")

        tmp.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )

        # Atomic replace so a crash mid-write doesn't corrupt the index
        os.replace(tmp, path)


def replace_all(chunks: List[Dict[str, Any]], model: str) -> Dict[str, Any]:
    """Swap the whole index. Each chunk must have keys:
       id, source, text, embedding.

    Returns a stats dict for the caller to surface in the reindex
    response."""

    with _State.lock:

        _State.chunks = chunks
        _State.model  = model
        _State.built_at = datetime.utcnow().isoformat()

        _State.matrix, dim = _rebuild_matrix(chunks)

        _State.dim = dim

        save()

        return {
            "chunks":   len(chunks),
            "dim":      dim,
            "model":    model,
            "built_at": _State.built_at,
            "backend":  "numpy" if _HAS_NUMPY else "python",
        }


def size() -> int:

    load()

    with _State.lock:

        return len(_State.chunks)


def info() -> Dict[str, Any]:

    load()

    with _State.lock:

        return {
            "chunks":   len(_State.chunks),
            "dim":      _State.dim,
            "model":    _State.model,
            "built_at": _State.built_at,
            "backend":  "numpy" if _HAS_NUMPY else "python",
            "path":     str(_index_path()),
        }


def search(query_embedding: List[float], k: int = 4) -> List[Dict[str, Any]]:
    """Return the top-`k` chunks by cosine similarity. Each result is
    the original chunk dict (id, source, text, embedding) with an
    added `score` field."""

    load()

    if not query_embedding:

        return []

    with _State.lock:

        chunks = list(_State.chunks)   # snapshot for lock-free scoring
        matrix = _State.matrix

    if not chunks:

        return []

    if matrix is not None and _HAS_NUMPY:

        try:

            scores = _cosine_np(query_embedding, matrix)

            # top-k indices
            top_idx = _np.argsort(-scores)[:k]

            results = []

            for i in top_idx:

                c = dict(chunks[int(i)])
                c["score"] = float(scores[int(i)])
                # Drop the raw vector from the returned copy so we don't
                # pipe hundreds of floats through the JSON response.
                c.pop("embedding", None)
                results.append(c)

            return results

        except Exception:

            pass  # fall through to Python path

    # Pure-Python fallback
    vecs = [c.get("embedding") or [] for c in chunks]

    scores = _cosine_py(query_embedding, vecs)

    ranked = sorted(
        enumerate(scores),
        key=lambda pair: -pair[1],
    )[:k]

    results = []

    for idx, s in ranked:

        c = dict(chunks[idx])
        c["score"] = float(s)
        c.pop("embedding", None)
        results.append(c)

    return results
