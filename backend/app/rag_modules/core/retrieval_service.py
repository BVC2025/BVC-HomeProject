"""Retrieval: embed a query, search a module's Qdrant collection, join
chunk hits back to AI_DOCUMENTS for a display title. Only chunks belonging
to currently IS_ACTIVE and non-deleted documents are eligible — this is
re-checked at query time (Qdrant's payload doesn't know about a soft-delete/
deactivate performed after ingestion)."""

from dataclasses import dataclass
from typing import List

from sqlalchemy.orm import Session

from app.models.rag_models import AIModule, AIDocument
from app.rag_modules.core.embedding_service import embed_query
from app.rag_modules.core import qdrant_client


@dataclass
class RetrievedChunk:

    document_id: str
    chunk_index: int
    chunk_text: str
    score: float
    document_title: str


def retrieve(db: Session, module: AIModule, query: str, top_k: int = 5) -> List[RetrievedChunk]:

    eligible_docs = (
        db.query(AIDocument)
        .filter(
            AIDocument.MODULE_ID == module.ID,
            AIDocument.IS_ACTIVE.is_(True),
            AIDocument.DELETED_AT.is_(None),
            AIDocument.IS_PROCESSED.is_(True),
        )
        .all()
    )

    if not eligible_docs:

        return []

    titles_by_id = {d.ID: d.TITLE for d in eligible_docs}

    query_vector = embed_query(query)

    hits = qdrant_client.search(
        module.VECTOR_COLLECTION_NAME,
        query_vector,
        top_k=top_k,
        document_ids=list(titles_by_id.keys()),
    )

    return [
        RetrievedChunk(
            document_id=h["document_id"],
            chunk_index=h["chunk_index"],
            chunk_text=h["chunk_text"],
            score=h["score"],
            document_title=titles_by_id.get(h["document_id"], "Unknown document"),
        )
        for h in hits
    ]
