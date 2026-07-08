"""
RAG orchestration for the AI chatbot.

Three responsibilities:

  1. `build_corpus(db)`      — assemble the raw text chunks that make
                               up our knowledge base. Pulls live data
                               from the DB (departments, holidays,
                               shifts, company profile) AND static
                               markdown files under backend/docs/policies/.

  2. `reindex(db)`           — embed every chunk via Ollama and swap
                               the index atomically. Called from the
                               admin endpoint or lazily on first miss.

  3. `answer(question, ...)` — the query pipeline. Embed the question,
                               retrieve top-K chunks, feed them into
                               phi3:mini with a strict system prompt,
                               return the answer + source citations.

Every step degrades gracefully — if Ollama is down we return None and
the caller falls back to the legacy /chat/stream handler.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.services import ollama_client, rag_index


# =====================================================================
# Configuration
# =====================================================================


def _docs_root() -> Path:
    """backend/docs/policies/ — resolved relative to the app package."""

    pkg_root = Path(__file__).resolve().parent.parent   # .../backend/app
    return pkg_root.parent / "docs" / "policies"


def _top_k() -> int:

    try:

        return max(1, int(os.getenv("RAG_TOP_K", "4")))

    except ValueError:

        return 4


def _min_score() -> float:
    """Cosine similarity threshold below which we treat retrieved
    chunks as irrelevant. Empirically 0.30 works for nomic-embed."""

    try:

        return float(os.getenv("RAG_MIN_SCORE", "0.30"))

    except ValueError:

        return 0.30


# =====================================================================
# Chunker — split markdown by headings, then by ~500 char blocks
# =====================================================================


_MAX_CHUNK_CHARS = 500
_CHUNK_OVERLAP  = 100


def _split_markdown(text: str, source: str) -> List[Dict[str, Any]]:
    """Split a markdown document into overlapping chunks. Each chunk
    remembers its source filename for citation."""

    if not text:

        return []

    # First cut by top-level headings so we don't glue unrelated
    # sections together. Preserve the heading with each following
    # section so the LLM has context.
    sections: List[str] = []

    current_heading = None
    buf: List[str] = []

    for line in text.splitlines():

        stripped = line.strip()

        if stripped.startswith("#"):

            if buf:

                sections.append(
                    (f"{current_heading}\n" if current_heading else "")
                    + "\n".join(buf).strip()
                )
                buf = []

            current_heading = stripped

        else:

            buf.append(line)

    if buf:

        sections.append(
            (f"{current_heading}\n" if current_heading else "")
            + "\n".join(buf).strip()
        )

    # Now split each section into overlapping windows if it's too long.
    chunks: List[Dict[str, Any]] = []

    for sec in sections:

        sec = sec.strip()

        if not sec:

            continue

        if len(sec) <= _MAX_CHUNK_CHARS:

            chunks.append({"source": source, "text": sec})

        else:

            start = 0

            while start < len(sec):

                end = min(start + _MAX_CHUNK_CHARS, len(sec))
                chunk = sec[start:end].strip()

                if chunk:

                    chunks.append({"source": source, "text": chunk})

                start = end - _CHUNK_OVERLAP

                if end == len(sec):

                    break

    return chunks


# =====================================================================
# Corpus builders — the two sources of knowledge
# =====================================================================


def _build_policy_chunks() -> List[Dict[str, Any]]:
    """Walk backend/docs/policies/ and chunk every .md file. Silently
    ignores errors — worst case we index fewer chunks."""

    root = _docs_root()

    if not root.exists() or not root.is_dir():

        return []

    out: List[Dict[str, Any]] = []

    for md in sorted(root.glob("*.md")):

        try:

            text = md.read_text(encoding="utf-8")

        except Exception:

            continue

        out.extend(_split_markdown(text, source=md.name))

    return out


def _build_db_chunks(db: Session) -> List[Dict[str, Any]]:
    """Pull live facts from the DB and turn each into a small chunk.
    We stitch related fields into a single paragraph so the retriever
    can match questions like 'who heads Accounts' or 'when is the next
    holiday'."""

    from app.models.models import (
        Employee, Department, Designation, HolidayCalendar, Shift,
    )

    out: List[Dict[str, Any]] = []

    # --- Departments ---
    try:

        depts = db.query(Department).all()

        for d in depts:

            head_name = None

            if getattr(d, "HEAD_EMPLOYEE_ID", None):

                emp = db.query(Employee).filter(Employee.ID == d.HEAD_EMPLOYEE_ID).first()

                if emp is not None:

                    head_name = emp.NAME

            member_count = (
                db.query(Employee)
                .filter(Employee.DEPARTMENT_ID == d.ID)
                .count()
            )

            parts = [f"Department: {d.NAME}"]

            if getattr(d, "CODE", None):

                parts.append(f"Code: {d.CODE}")

            if head_name:

                parts.append(f"Department head: {head_name}")

            parts.append(f"Number of employees: {member_count}")

            if getattr(d, "DESCRIPTION", None):

                parts.append(f"Description: {d.DESCRIPTION}")

            out.append({
                "source": "org/departments",
                "text":   ". ".join(parts) + ".",
            })

    except Exception:

        pass

    # --- Designations / job titles ---
    try:

        for role in db.query(Designation).all():

            parts = [f"Designation / job title: {role.TITLE}"]

            if getattr(role, "GRADE", None):

                parts.append(f"Grade: {role.GRADE}")

            if getattr(role, "DESCRIPTION", None):

                parts.append(f"Description: {role.DESCRIPTION}")

            out.append({
                "source": "org/designations",
                "text":   ". ".join(parts) + ".",
            })

    except Exception:

        pass

    # --- Active shifts ---
    try:

        shifts = db.query(Shift).filter(Shift.IS_ACTIVE == 1).all()

        for s in shifts:

            parts = [
                f"Shift: {s.NAME}",
                f"Code: {s.SHIFT_CODE}",
                f"Timing: {s.START_TIME.strftime('%H:%M') if s.START_TIME else '?'} "
                f"to {s.END_TIME.strftime('%H:%M') if s.END_TIME else '?'}",
                f"Category: {s.CATEGORY or 'DAY'}",
            ]

            if s.CROSS_MIDNIGHT:

                parts.append("This shift crosses midnight (starts and ends on different days)")

            if s.IS_NIGHT:

                parts.append(
                    f"Night shift with {s.NIGHT_ALLOWANCE_PCT or 0}% night allowance"
                )

            if s.BREAK_MINUTES:

                parts.append(f"Unpaid break: {s.BREAK_MINUTES} minutes")

            if s.DESCRIPTION:

                parts.append(f"Notes: {s.DESCRIPTION}")

            out.append({
                "source": "org/shifts",
                "text":   ". ".join(parts) + ".",
            })

    except Exception:

        pass

    # --- Upcoming holidays (next 12 months) ---
    try:

        from datetime import date, timedelta

        today = date.today()

        horizon = today + timedelta(days=365)

        holidays = (
            db.query(HolidayCalendar)
            .filter(
                HolidayCalendar.HOLIDAY_DATE >= today,
                HolidayCalendar.HOLIDAY_DATE <= horizon,
            )
            .order_by(HolidayCalendar.HOLIDAY_DATE.asc())
            .all()
        )

        if holidays:

            lines = ["Upcoming public / company holidays:"]

            for h in holidays:

                lines.append(
                    f"- {h.HOLIDAY_DATE.strftime('%d %b %Y')} ({h.NAME})"
                )

            # Group all holidays into one chunk — questions like "what's
            # the next holiday?" then get the full list in context.
            out.append({
                "source": "org/holidays",
                "text":   "\n".join(lines),
            })

    except Exception:

        pass

    return out


def build_corpus(db: Session) -> List[Dict[str, Any]]:
    """Compose every chunk from all sources. Called by reindex()."""

    return _build_policy_chunks() + _build_db_chunks(db)


# =====================================================================
# Reindex — build embeddings + swap the live index atomically
# =====================================================================


def reindex(db: Session) -> Dict[str, Any]:
    """Full-rebuild. Returns a report dict; never raises on Ollama
    outages — reports what happened so the admin UI can show it."""

    if not ollama_client.is_up():

        return {
            "ok":     False,
            "reason": "Ollama daemon is not reachable at " + os.getenv("OLLAMA_URL", "http://localhost:11434"),
            "chunks_seen":     0,
            "chunks_embedded": 0,
        }

    corpus = build_corpus(db)

    if not corpus:

        # No docs + empty DB. Still succeed — the pipeline just has
        # nothing to serve until content shows up.
        rag_index.replace_all(chunks=[], model=os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"))

        return {
            "ok":     True,
            "reason": "No knowledge sources found — index cleared.",
            "chunks_seen":     0,
            "chunks_embedded": 0,
        }

    embedded: List[Dict[str, Any]] = []

    failed = 0

    for idx, chunk in enumerate(corpus):

        vec = ollama_client.embed(chunk["text"])

        if vec is None:

            failed += 1
            continue

        embedded.append({
            "id":        f"c{idx:04d}",
            "source":    chunk["source"],
            "text":      chunk["text"],
            "embedding": vec,
        })

    if not embedded:

        return {
            "ok":     False,
            "reason": "Every embedding call failed — is the nomic-embed-text model pulled?",
            "chunks_seen":     len(corpus),
            "chunks_embedded": 0,
        }

    stats = rag_index.replace_all(
        chunks=embedded,
        model=os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text"),
    )

    stats.update({
        "ok":              True,
        "chunks_seen":     len(corpus),
        "chunks_embedded": len(embedded),
        "chunks_failed":   failed,
    })

    return stats


# =====================================================================
# Query pipeline — the entry point called from /ai/chat
# =====================================================================


SYSTEM_PROMPT = (
    "You are the BVC24 ERP knowledge assistant. Answer the user's "
    "question ONLY using the provided context. Follow these rules:\n"
    "  • If the context doesn't contain the answer, reply: "
    "\"I don't have that information in the BVC24 knowledge base yet.\"\n"
    "  • Keep answers short and factual — 1-3 sentences.\n"
    "  • Never invent employee names, salary figures, or policy "
    "details that aren't in the context.\n"
    "  • Never mention that you're an AI, the underlying model, or "
    "the context mechanism — just answer the question."
)


def answer(question: str, db: Session) -> Optional[Dict[str, Any]]:
    """The full RAG pipeline. Returns:

        { reply: str, sources: [{source, score}], hit_count: int }

    or None if:
      • Ollama isn't reachable
      • no relevant chunks (all below threshold)
      • embedding of the query failed

    In every "None" case the caller should fall back to the legacy
    /chat/stream so the user gets *something*."""

    question = (question or "").strip()

    if not question or not ollama_client.is_up():

        return None

    # 1. Lazy-index — if the file is empty (or missing), try one build.
    #    Guarded so we don't retry on every miss if the DB is truly empty.
    if rag_index.size() == 0:

        try:

            reindex(db)

        except Exception:

            pass

    if rag_index.size() == 0:

        return None

    # 2. Embed the query
    q_vec = ollama_client.embed(question)

    if q_vec is None:

        return None

    # 3. Retrieve top-K
    hits = rag_index.search(q_vec, k=_top_k())

    hits = [h for h in hits if h.get("score", 0.0) >= _min_score()]

    if not hits:

        return None

    # 4. Compose the prompt
    context_blocks = []

    for i, h in enumerate(hits, 1):

        context_blocks.append(
            f"[Source {i}: {h['source']}]\n{h['text']}"
        )

    context = "\n\n".join(context_blocks)

    prompt = (
        f"CONTEXT:\n{context}\n\n"
        f"QUESTION: {question}\n\n"
        f"ANSWER:"
    )

    # 5. Generate
    reply = ollama_client.generate(
        prompt=prompt,
        system=SYSTEM_PROMPT,
        temperature=0.2,
        max_tokens=256,
    )

    if not reply:

        return None

    # 6. Attach source citations (unique, ordered by first appearance)
    seen = set()

    sources = []

    for h in hits:

        s = h["source"]

        if s in seen:

            continue

        seen.add(s)

        sources.append({"source": s, "score": round(h.get("score", 0.0), 3)})

    return {
        "reply":     reply.strip(),
        "sources":   sources,
        "hit_count": len(hits),
    }
