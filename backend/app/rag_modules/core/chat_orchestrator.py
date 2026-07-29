"""The one reusable RAG chat function — every module and every future
channel (WhatsApp, email, voice) calls run_chat(). It is a plain generator
with no HTTP/SSE assumptions baked in; the route layer wraps it in a
StreamingResponse, a future webhook handler would just drain it directly."""

from typing import Dict, Iterator, List, Optional

from sqlalchemy.orm import Session

from app.models.rag_models import AIModule
from app.rag_modules.core.retrieval_service import retrieve
from app.rag_modules.core.module_registry import get_system_prompt
from app.rag_modules.core import llm_client

TOP_K = 5


def _build_context_prompt(system_prompt: str, chunks) -> str:

    if not chunks:

        context_block = (
            "(No relevant documents found in the knowledge base for this "
            "question — answer honestly that you don't have information "
            "on this yet, don't guess.)"
        )

    else:

        context_block = "\n\n".join(
            f"[Source: {c.document_title}]\n{c.chunk_text}" for c in chunks
        )

    return (
        f"{system_prompt}\n\n"
        "Use the following retrieved context to answer the user's question. "
        "Cite which source document(s) you used when relevant.\n\n"
        f"--- CONTEXT ---\n{context_block}\n--- END CONTEXT ---"
    )


def run_chat(
    db: Session,
    module_code: str,
    user_message: str,
    session_id: str,
    user_id: Optional[str] = None,
    history: Optional[List[Dict]] = None,
    verbose: bool = False,
) -> Iterator[dict]:
    """Yields SSE-frame-shaped dicts:
      {"type": "chunks", "chunks": [...]}   (verbose only)
      {"type": "text", "text": ...}          (repeated)
      {"type": "confidence", "score": ...}   (verbose only)
      {"type": "usage", "prompt_tokens":, "completion_tokens":, "total_tokens":, "response_time":, "model_name":}
      {"type": "done"}
      {"type": "error", "message": ...}

    The caller (route layer) is responsible for persisting the resulting
    AIChatHistory row after draining this generator — this function only
    yields; it does not write to the DB."""

    module = (
        db.query(AIModule)
        .filter(AIModule.MODULE_CODE == module_code, AIModule.IS_ACTIVE.is_(True))
        .first()
    )

    if not module:

        yield {"type": "error", "message": f"Unknown or inactive AI module: {module_code}"}

        yield {"type": "done"}

        return

    try:

        chunks = retrieve(db, module, user_message, top_k=TOP_K)

    except Exception as e:

        yield {"type": "error", "message": f"Retrieval failed: {e}"}

        yield {"type": "done"}

        return

    if verbose:

        yield {
            "type": "chunks",
            "chunks": [
                {
                    "document_id": c.document_id,
                    "document_title": c.document_title,
                    "chunk_text": c.chunk_text,
                    "score": c.score,
                }
                for c in chunks
            ],
        }

    system_prompt = get_system_prompt(module_code)

    full_prompt = _build_context_prompt(system_prompt, chunks)

    final_answer_parts = []

    meta = None

    try:

        for event in llm_client.stream_answer(full_prompt, user_message, history=history):

            if event["type"] == "text":

                final_answer_parts.append(event["text"])

                yield event

            elif event["type"] == "meta":

                meta = event

    except Exception as e:

        yield {"type": "error", "message": str(e)}

        yield {"type": "done"}

        return

    if verbose:

        top_score = chunks[0].score if chunks else 0.0

        yield {"type": "confidence", "score": round(top_score, 4)}

    if meta:

        yield {
            "type": "usage",
            "prompt_tokens": meta.get("prompt_tokens"),
            "completion_tokens": meta.get("completion_tokens"),
            "total_tokens": meta.get("total_tokens"),
            "response_time": meta.get("response_time"),
            "model_name": meta.get("model_name"),
        }

    yield {"type": "done"}
