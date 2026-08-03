"""Dependency-light recursive text chunker.

Splits on paragraph breaks first, falls back to sentence breaks, then to a
hard character slice as a last resort — never pulling in langchain for
something this small (nothing else in this codebase uses it).

Semantic chunking (sentence-embedding boundary detection) is a v2
nice-to-have, not built here — see rag_modules/README.md."""

import re
from typing import List

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _split_paragraphs(text: str) -> List[str]:

    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _split_sentences(paragraph: str) -> List[str]:

    return [s.strip() for s in _SENTENCE_SPLIT_RE.split(paragraph) if s.strip()]


def chunk_text(
    text: str,
    chunk_size: int = 800,
    chunk_overlap: int = 120,
) -> List[str]:
    """Recursive splitter: pack paragraphs/sentences into chunks up to
    chunk_size characters, carrying chunk_overlap characters of trailing
    context into the next chunk. A single unit (paragraph or sentence)
    longer than chunk_size is hard-sliced rather than dropped."""

    units: List[str] = []

    for para in _split_paragraphs(text):

        if len(para) <= chunk_size:

            units.append(para)

            continue

        for sent in _split_sentences(para):

            if len(sent) <= chunk_size:

                units.append(sent)

            else:

                # Hard slice as a last resort — a single sentence longer
                # than chunk_size (e.g. a data dump with no punctuation).
                for i in range(0, len(sent), chunk_size):

                    units.append(sent[i:i + chunk_size])

    if not units:

        return []

    chunks: List[str] = []

    current = ""

    for unit in units:

        candidate = f"{current} {unit}".strip() if current else unit

        if len(candidate) <= chunk_size:

            current = candidate

            continue

        if current:

            chunks.append(current)

            tail = current[-chunk_overlap:] if chunk_overlap else ""

            current = f"{tail} {unit}".strip() if tail else unit

        else:

            current = unit

    if current:

        chunks.append(current)

    return chunks
