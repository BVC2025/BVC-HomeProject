"""
Knowledge-base builder for the HRMS AI assistant.

Reads docs/HRMS_KNOWLEDGE.md, chunks it by Markdown H3 (### heading),
embeds each chunk via Gemini, and writes the index to
backend/app/hrms_ai/knowledge_index.json.

Rebuild is a one-liner from the project root:

    python -m app.hrms_ai.knowledge_builder

Or via HTTP:

    POST /hrms-ai/rebuild        (admin only)

The index file is a plain JSON list of:
    { "module": "Attendance",
      "section": "Business rules",
      "text": "...",
      "embedding": [...768 floats...] }

No FAISS, no external vector DB — a linear cosine scan over ~30-60
chunks is well under 5 ms per query. Keeps the deploy footprint
small: one Python file + one JSON.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import List, Optional

from app.hrms_ai.gemini_client import embed_text, is_configured


log = logging.getLogger("hrms_ai.knowledge_builder")


# ---------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------
# knowledge_builder.py lives at backend/app/hrms_ai/knowledge_builder.py
# .parent = hrms_ai/
# .parent.parent = app/
# .parent.parent.parent = backend/
# .parent.parent.parent.parent = project root
_HERE = Path(__file__).resolve().parent
PROJECT_ROOT = _HERE.parent.parent.parent
DOC_PATH = PROJECT_ROOT / "docs" / "HRMS_KNOWLEDGE.md"
INDEX_PATH = _HERE / "knowledge_index.json"


# ---------------------------------------------------------------------
# Chunking — split by ### headings, keep the parent ## module as context
# ---------------------------------------------------------------------

_H2_RE = re.compile(r"^##\s+(?P<title>.+?)\s*$", re.MULTILINE)
_H3_RE = re.compile(r"^###\s+(?P<title>.+?)\s*$", re.MULTILINE)


def parse_markdown(md: str) -> List[dict]:
    """Return a list of {module, section, text} chunks.

    Chunks are split at H3 boundaries. The H2 above each H3 is captured
    as `module`. The H3 title becomes `section`. Trailing whitespace
    trimmed. Empty sections skipped.
    """

    chunks: List[dict] = []
    current_module = "General"
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        h2 = _H2_RE.match(line)
        if h2:
            current_module = h2.group("title").strip()
            # Strip a leading "Module: " prefix if present
            current_module = re.sub(r"^Module\s*:\s*", "", current_module, flags=re.IGNORECASE)
            i += 1
            continue
        h3 = _H3_RE.match(line)
        if h3:
            section_title = h3.group("title").strip()
            # Collect body until the next H2/H3 or EOF
            body_lines: List[str] = []
            i += 1
            while i < len(lines):
                nxt = lines[i]
                if _H2_RE.match(nxt) or _H3_RE.match(nxt):
                    break
                body_lines.append(nxt)
                i += 1
            body = "\n".join(body_lines).strip()
            if body:
                chunks.append({
                    "module": current_module,
                    "section": section_title,
                    "text": body,
                })
            continue
        i += 1
    return chunks


def _text_for_embedding(chunk: dict) -> str:
    """Build the string that gets embedded. Prepend the module +
    section so retrieval works even when the body is terse."""
    return (
        f"Module: {chunk['module']}\n"
        f"Section: {chunk['section']}\n\n"
        f"{chunk['text']}"
    )


# ---------------------------------------------------------------------
# Build + load
# ---------------------------------------------------------------------

def build_index(doc_path: Optional[Path] = None, index_path: Optional[Path] = None) -> dict:
    """Read the doc, embed each chunk, write the index JSON.

    Returns a summary dict for the HTTP endpoint / CLI caller.
    """

    doc_path = doc_path or DOC_PATH
    index_path = index_path or INDEX_PATH

    if not doc_path.exists():
        raise FileNotFoundError(
            f"HRMS knowledge file not found at {doc_path}. "
            "Create it before rebuilding the index."
        )

    if not is_configured():
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to backend/.env before "
            "rebuilding the knowledge index."
        )

    md = doc_path.read_text(encoding="utf-8")
    chunks = parse_markdown(md)
    if not chunks:
        raise ValueError(
            f"No ### sections found in {doc_path}. Check the doc "
            "structure — each subsection must be introduced by a "
            "level-3 heading."
        )

    start = time.time()
    embeddings = embed_text(
        [_text_for_embedding(c) for c in chunks],
        task_type="RETRIEVAL_DOCUMENT",
    )
    took_ms = int((time.time() - start) * 1000)

    for c, e in zip(chunks, embeddings):
        c["embedding"] = e

    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps(chunks, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {
        "ok": True,
        "chunks": len(chunks),
        "took_ms": took_ms,
        "doc_path": str(doc_path),
    }


def load_index(index_path: Optional[Path] = None) -> List[dict]:
    """Load the pre-computed index. Returns [] if the file is missing
    so callers can degrade gracefully instead of 500ing."""

    index_path = index_path or INDEX_PATH
    if not index_path.exists():
        log.warning("Knowledge index not found at %s. Run the builder first.", index_path)
        return []
    try:
        return json.loads(index_path.read_text(encoding="utf-8"))
    except Exception as e:
        log.error("Failed to load knowledge index: %s", e)
        return []


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def _cli():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    print(f"[hrms_ai] Building index from {DOC_PATH}...")
    summary = build_index()
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    _cli()
