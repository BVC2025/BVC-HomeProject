"""Thin Qdrant wrapper — one collection per AI module.

Qdrant runs as a local Windows service (see deploy/nssm-install-qdrant.ps1),
not Docker. Client is a lazy-loaded module-level singleton, same pattern as
embedding_service.get_embedding_model()."""

import os
import uuid
from typing import List, Optional

from app.rag_modules.core.embedding_service import EMBEDDING_DIM

_client = None


def get_client():

    global _client

    if _client is None:

        from qdrant_client import QdrantClient

        _client = QdrantClient(
            url=os.getenv("QDRANT_URL", "http://127.0.0.1:6333"),
            api_key=os.getenv("QDRANT_API_KEY") or None,
        )

    return _client


def ensure_collection(collection_name: str, vector_size: int = EMBEDDING_DIM) -> None:
    """Create-if-missing. Idempotent."""

    from qdrant_client.models import Distance, VectorParams

    client = get_client()

    if not client.collection_exists(collection_name):

        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )


def _point_id(document_id: str, chunk_index: int) -> str:
    """Deterministic point ID so re-ingesting the same document (replace/
    retrain) overwrites cleanly instead of duplicating points."""

    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{document_id}:{chunk_index}"))


def upsert_chunks(
    collection_name: str,
    document_id: str,
    module_code: str,
    chunks: List[str],
    vectors: List[List[float]],
) -> int:

    from qdrant_client.models import PointStruct

    client = get_client()

    points = [
        PointStruct(
            id=_point_id(document_id, idx),
            vector=vector,
            payload={
                "document_id": document_id,
                "chunk_index": idx,
                "chunk_text": chunk,
                "module_code": module_code,
            },
        )
        for idx, (chunk, vector) in enumerate(zip(chunks, vectors))
    ]

    if points:

        client.upsert(collection_name=collection_name, points=points)

    return len(points)


def delete_document_vectors(collection_name: str, document_id: str) -> None:
    """Filter-delete every point belonging to a document — used before
    re-ingesting on replace/retrain, and on document delete."""

    from qdrant_client.models import Filter, FieldCondition, MatchValue

    client = get_client()

    if not client.collection_exists(collection_name):

        return

    client.delete(
        collection_name=collection_name,
        points_selector=Filter(
            must=[FieldCondition(key="document_id", match=MatchValue(value=document_id))]
        ),
    )


def search(
    collection_name: str,
    query_vector: List[float],
    top_k: int = 5,
    document_ids: Optional[List[str]] = None,
) -> List[dict]:
    """Returns [{document_id, chunk_index, chunk_text, score}, ...].
    If document_ids is given, restricts results to that set (used to
    exclude documents that were soft-deleted/deactivated after ingestion)."""

    client = get_client()

    if not client.collection_exists(collection_name):

        return []

    query_filter = None

    if document_ids is not None:

        from qdrant_client.models import Filter, FieldCondition, MatchAny

        query_filter = Filter(
            must=[FieldCondition(key="document_id", match=MatchAny(any=document_ids))]
        )

    hits = client.query_points(
        collection_name=collection_name,
        query=query_vector,
        limit=top_k,
        query_filter=query_filter,
        with_payload=True,
    ).points

    return [
        {
            "document_id": h.payload.get("document_id"),
            "chunk_index": h.payload.get("chunk_index"),
            "chunk_text": h.payload.get("chunk_text"),
            "score": h.score,
        }
        for h in hits
    ]
