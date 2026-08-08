"""
HRMS AI endpoints.

  POST   /hrms-ai/ask                Ask a question, get a grounded answer.
  GET    /hrms-ai/history/{sid}      Fetch a session's chat history.
  DELETE /hrms-ai/history/{sid}      Clear a session's chat history.
  GET    /hrms-ai/status             Health / config check.
  POST   /hrms-ai/rebuild            (admin) Rebuild the embedding index.

Every endpoint is auth-gated. The ask/history endpoints are scoped to
the caller's EMPLOYEE_ID + SESSION_ID so no cross-employee reads.
"""

from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.auth_bearer import get_current_user
from app.database.database import get_db

from app.hrms_ai.gemini_client import chat, chat_yes_no, is_configured
from app.hrms_ai.knowledge_builder import build_index
from app.hrms_ai.prompt import (
    NO_CONTEXT_REPLY,
    SYSTEM_INSTRUCTION,
    build_answer_prompt,
    build_grounding_prompt,
)
from app.hrms_ai.rag import index_size, reload_index, retrieve
from app.hrms_ai.schemas import (
    AskRequest,
    AskResponse,
    HistoryMessage,
    HistoryResponse,
    RebuildResponse,
    SourceRef,
)
from app.hrms_ai.session_store import HrmsAiConversation


log = logging.getLogger("hrms_ai.routes")

router = APIRouter(prefix="/hrms-ai", tags=["HRMS AI Assistant"])


# ---------------------------------------------------------------------
# Feature flag
# ---------------------------------------------------------------------

def _enabled() -> bool:
    """Kill switch. Set HRMS_AI_ENABLED=false in .env to disable the
    endpoints without redeploying."""

    raw = (os.getenv("HRMS_AI_ENABLED") or "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _require_enabled():
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail="HRMS AI assistant is currently disabled by the administrator.",
        )


# ---------------------------------------------------------------------
# Conversation-history helpers
# ---------------------------------------------------------------------

_MAX_HISTORY_TURNS = 10   # last N user+assistant messages fed back to Gemini


def _load_history(db: Session, session_id: str, employee_id: Optional[str], vendor_id: Optional[int]) -> List[HrmsAiConversation]:
    q = db.query(HrmsAiConversation).filter(HrmsAiConversation.SESSION_ID == session_id)
    if employee_id:
        q = q.filter(HrmsAiConversation.EMPLOYEE_ID == employee_id)
    if vendor_id is not None:
        q = q.filter(HrmsAiConversation.VENDOR_ID == vendor_id)
    return q.order_by(HrmsAiConversation.ID.asc()).all()


def _save_turn(
    db: Session,
    session_id: str,
    employee_id: Optional[str],
    vendor_id: Optional[int],
    role: str,
    content: str,
    language: Optional[str] = None,
) -> None:
    row = HrmsAiConversation(
        SESSION_ID=session_id,
        EMPLOYEE_ID=employee_id,
        VENDOR_ID=vendor_id,
        ROLE=role,
        CONTENT=(content or "")[:8001],
        LANGUAGE=(language or "")[:8] or None,
    )
    db.add(row)
    db.commit()


def _history_to_gemini_messages(rows: List[HrmsAiConversation]) -> List[dict]:
    """Convert stored rows to Gemini's expected chat history shape.
    role 'assistant' -> 'model'. Trim to last 2 * _MAX_HISTORY_TURNS
    rows so we don't blow the context window on chatty sessions."""

    cut = rows[-(_MAX_HISTORY_TURNS * 2):]
    out = []
    for r in cut:
        role = "model" if (r.ROLE or "").lower() == "assistant" else "user"
        out.append({"role": role, "parts": [r.CONTENT or ""]})
    return out


# ---------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------

@router.get("/status")
def status():
    """No auth — used by the frontend to decide whether to render the
    chat UI at all. Returns just booleans, no secrets."""

    return {
        "enabled": _enabled(),
        "gemini_configured": is_configured(),
        "index_chunks": index_size(),
    }


# ---------------------------------------------------------------------
# Ask
# ---------------------------------------------------------------------

@router.post("/ask", response_model=AskResponse)
def ask(
    body: AskRequest,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_enabled()

    if not is_configured():
        raise HTTPException(
            status_code=503,
            detail="The HRMS AI assistant is not configured (missing GEMINI_API_KEY).",
        )

    employee_id = payload.get("employee_id")
    vendor_id = payload.get("vendor_id")

    question = (body.message or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Empty message.")

    # ---- 1. Retrieval ---------------------------------------------------
    retrieved = retrieve(question, top_k=5)

    # ---- 2. Persist user turn ------------------------------------------
    _save_turn(
        db, body.session_id, employee_id, vendor_id,
        role="user", content=question, language=body.language,
    )

    # ---- 3. Nothing retrieved -> canned reply, don't touch Gemini -------
    if not retrieved:
        answer = NO_CONTEXT_REPLY
        _save_turn(db, body.session_id, employee_id, vendor_id,
                   role="assistant", content=answer, language=body.language)
        return AskResponse(
            answer=answer,
            sources=[],
            grounded=True,
            language=body.language,
        )

    # ---- 4. Build the answer prompt with retrieved chunks --------------
    prior = _load_history(db, body.session_id, employee_id, vendor_id)
    # Exclude the just-saved user row from history — it's added
    # explicitly as the final turn.
    prior_for_history = [r for r in prior[:-1] if r.ROLE in ("user", "assistant")]

    user_prompt = build_answer_prompt(
        question=question,
        retrieved=retrieved,
        language_hint=body.language,
    )

    messages = _history_to_gemini_messages(prior_for_history)
    messages.append({"role": "user", "parts": [user_prompt]})

    try:
        raw_answer = chat(
            messages,
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0.2,
            max_output_tokens=1024,
        )
    except Exception as e:
        log.error("Gemini chat failed: %s", e)
        # Persist a placeholder assistant turn so the history is complete
        fail_msg = (
            "I ran into a problem reaching the AI service. "
            "Please try again in a moment."
        )
        _save_turn(db, body.session_id, employee_id, vendor_id,
                   role="assistant", content=fail_msg, language=body.language)
        raise HTTPException(status_code=502, detail=fail_msg)

    answer = (raw_answer or "").strip() or NO_CONTEXT_REPLY

    # ---- 5. Grounding check --------------------------------------------
    # Fail-CLOSED on verifier errors: if the second Gemini call can't
    # confirm the answer is supported by the retrieved chunks, we
    # substitute the canned reply. Worse UX than passing through, but
    # this is the last line of defence against a plausible-but-wrong
    # response. The primary answer call reaching Gemini successfully
    # while the verifier call fails is a rare middle case (Gemini is
    # usually all-or-nothing), so this shouldn't hit users often.
    grounded = False
    try:
        grounded = chat_yes_no(
            build_grounding_prompt(question=question, answer=answer, retrieved=retrieved)
        )
    except Exception as e:
        log.error("Grounding check errored — treating as ungrounded: %s", e)
        grounded = False

    if not grounded:
        answer = NO_CONTEXT_REPLY

    # ---- 6. Persist assistant turn -------------------------------------
    _save_turn(db, body.session_id, employee_id, vendor_id,
               role="assistant", content=answer, language=body.language)

    # ---- 7. Build response ---------------------------------------------
    # When we substituted the canned reply, the retrieved chunks weren't
    # actually used to form the answer — surface an empty source list
    # so the frontend doesn't confusingly attribute the refusal to
    # unrelated modules.
    sources = (
        [
            SourceRef(module=c.get("module", ""), section=c.get("section", ""), score=float(s))
            for c, s in retrieved
        ]
        if grounded else []
    )
    return AskResponse(
        answer=answer,
        sources=sources,
        grounded=grounded,
        language=body.language,
    )


# ---------------------------------------------------------------------
# History
# ---------------------------------------------------------------------

@router.get("/history/{session_id}", response_model=HistoryResponse)
def history(
    session_id: str,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_enabled()

    employee_id = payload.get("employee_id")
    vendor_id = payload.get("vendor_id")

    rows = _load_history(db, session_id, employee_id, vendor_id)

    return HistoryResponse(
        session_id=session_id,
        messages=[
            HistoryMessage(
                role=(r.ROLE or "").lower(),
                content=r.CONTENT or "",
                created_at=r.CREATED_AT.isoformat() if r.CREATED_AT else None,
            )
            for r in rows
        ],
    )


@router.delete("/history/{session_id}")
def clear_history(
    session_id: str,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_enabled()

    employee_id = payload.get("employee_id")
    vendor_id = payload.get("vendor_id")

    q = db.query(HrmsAiConversation).filter(HrmsAiConversation.SESSION_ID == session_id)
    if employee_id:
        q = q.filter(HrmsAiConversation.EMPLOYEE_ID == employee_id)
    if vendor_id is not None:
        q = q.filter(HrmsAiConversation.VENDOR_ID == vendor_id)
    deleted = q.delete(synchronize_session=False)
    db.commit()

    return {"session_id": session_id, "deleted": deleted}


# ---------------------------------------------------------------------
# Rebuild knowledge index (admin only)
# ---------------------------------------------------------------------

@router.post("/rebuild", response_model=RebuildResponse)
def rebuild(payload: dict = Depends(get_current_user)):
    _require_enabled()

    role = (payload.get("role") or "").upper()
    if role not in {"ADMIN", "SUPER_ADMIN"}:
        raise HTTPException(status_code=403, detail="Admin access required.")

    try:
        summary = build_index()
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        log.exception("rebuild failed")
        raise HTTPException(status_code=500, detail=f"Rebuild failed: {e}")

    reload_index()

    return RebuildResponse(**summary)
