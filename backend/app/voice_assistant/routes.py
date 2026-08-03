"""
FastAPI presentation layer for the voice assistant.

Single endpoint:  POST /voice/query

Auth: reuses the existing JWT bearer. Employees may only query their
own data — enforced by assert_self_or_admin against the payload.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.auth_bearer import assert_self_or_admin, get_current_user
from app.database.database import get_db
from app.models.models import Employee
from app.voice_assistant.intent_extractor import extract_intent
from app.voice_assistant.intent_router import route
from app.voice_assistant.schemas import (
    VoiceQueryRequest, VoiceQueryResponse,
)
from app.voice_assistant.session_store import store


log = logging.getLogger("voice_assistant.routes")


router = APIRouter(prefix="/voice", tags=["Voice Assistant"])


def _resolve_employee(db: Session, ident: str) -> Employee | None:
    if not ident:
        return None
    return (
        db.query(Employee)
        .filter(
            (Employee.ID == ident) | (Employee.EMPLOYEE_CODE == ident)
        )
        .first()
    )


@router.post("/query", response_model=VoiceQueryResponse)
async def voice_query(
    body: VoiceQueryRequest,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Voice assistant turn — one user utterance in, one reply out.

    Multi-turn state is held in the in-process SessionStore keyed on
    session_id. Callers should keep the same session_id for the life
    of a conversation and rotate it after conversation_complete=true.
    """

    # Employees only touch their own state; admin can inspect
    # subordinate flows (rare, but useful for HR triage).
    assert_self_or_admin(body.employee_id, payload)

    employee = _resolve_employee(db, body.employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Session
    session = store.get_or_create(body.session_id, employee.ID)
    session.history.append({"role": "user", "text": body.message})

    # Stash the raw utterance so hr_policy handler can Gemini-answer it
    session.slots["_last_user_message"] = body.message

    # ---- Gemini intent extraction (or fallback) ----
    try:
        extracted = await extract_intent(body.message, session)
    except Exception as exc:
        log.exception("intent extractor crashed")
        raise HTTPException(
            status_code=502,
            detail="Voice service temporarily unavailable. Try again.",
        ) from exc

    log.info(
        "voice: session=%s emp=%s intent=%s entities=%s active=%s",
        body.session_id, employee.EMPLOYEE_CODE,
        extracted.intent, extracted.entities, session.active_intent,
    )

    # ---- Route to handler ----
    try:
        reply = await route(db, session, extracted, employee)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("handler crashed")
        # Reset the session so the user isn't stuck in a broken flow
        store.reset(body.session_id)
        raise HTTPException(
            status_code=500,
            detail="Something went wrong. Try phrasing that differently.",
        ) from exc

    # Persist state
    session.history.append({"role": "assistant", "text": reply.reply})
    store.save(session)

    return VoiceQueryResponse(
        reply=reply.reply,
        conversation_complete=reply.conversation_complete,
        intent=extracted.intent,
        slots=dict(session.slots) if session.slots else None,
        action_taken=reply.action_taken,
    )
