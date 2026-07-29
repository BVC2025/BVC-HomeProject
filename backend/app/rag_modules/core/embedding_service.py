"""Local embedding model wrapper — BAAI/bge-small-en-v1.5 via sentence-transformers.

Loaded lazily as a module-level singleton on first real use, so a plain
backend boot never pays the torch import cost until a document is actually
processed or a chat happens (this repo has no other torch dependency)."""

import os
from typing import List

EMBEDDING_DIM = 384  # bge-small-en-v1.5 output size — used to size the Qdrant collection

_model = None


def get_embedding_model():

    global _model

    if _model is None:

        from sentence_transformers import SentenceTransformer

        model_name = os.getenv("RAG_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

        _model = SentenceTransformer(model_name, device="cpu")

    return _model


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed a batch of chunk texts (no instruction prefix — bge only needs
    the prefix on the query side for asymmetric retrieval)."""

    if not texts:

        return []

    vectors = get_embedding_model().encode(
        texts, batch_size=32, show_progress_bar=False, normalize_embeddings=True
    )

    return vectors.tolist()


def embed_query(text: str) -> List[float]:
    """Embed a single search query. bge models recommend an instruction
    prefix on the query side for asymmetric passage retrieval."""

    prefixed = f"Represent this sentence for searching relevant passages: {text}"

    return embed_texts([prefixed])[0]
