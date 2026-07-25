"""Voice assistant — Pydantic request/response models."""

from __future__ import annotations

from typing import Optional, Any, Dict, List

from pydantic import BaseModel, Field


# =====================================================================
# API surface
# =====================================================================

class VoiceQueryRequest(BaseModel):
    session_id:  str = Field(..., min_length=1, max_length=128)
    employee_id: str = Field(..., min_length=1, max_length=64)
    # Accepts UUID or EMPLOYEE_CODE — resolved server-side.
    message:     str = Field(..., min_length=1, max_length=2000)


class VoiceQueryResponse(BaseModel):
    reply:                 str
    conversation_complete: bool = False
    # Debug fields — safe to expose; frontend hides them.
    intent:      Optional[str]           = None
    slots:       Optional[Dict[str, Any]] = None
    action_taken: Optional[str]           = None


# =====================================================================
# Internal — what the Gemini extractor returns
# =====================================================================

class ExtractedIntent(BaseModel):
    """Strict JSON schema Gemini must fill in."""

    intent: str
    # One of:
    #   leave_request
    #   permission_request
    #   attendance_regularization
    #   leave_balance
    #   payslip_request
    #   hr_policy
    #   profile_query
    #   cancel        (user said "stop" / "cancel")
    #   affirm        (user said "yes" / "submit" / "confirm")
    #   deny          (user said "no")
    #   unknown

    entities: Dict[str, Any] = Field(default_factory=dict)
    # Free-form bag: date, leave_type (casual/sick/earned/etc),
    # half_day (bool), half_day_slot ("morning"/"afternoon"),
    # duration_hours (float), reason (str), month (str), year (int), ...

    natural_reply: Optional[str] = None
    # A short conversational hint Gemini generated. Handlers may use
    # it to build the final reply, or override it entirely.


# =====================================================================
# Session state
# =====================================================================

class SessionState(BaseModel):
    """One conversation with one employee. In-memory, TTL-scoped."""

    session_id:  str
    employee_id: str

    active_intent: Optional[str] = None
    # Once a handler owns the conversation, it stays owned until
    # complete OR the user cancels — subsequent messages are treated
    # as slot-fills instead of re-classified.

    slots: Dict[str, Any] = Field(default_factory=dict)
    # Everything the handler has collected so far.
    # e.g. {"leave_type": "CASUAL", "half_day": true, "start_date": "2026-07-26"}

    history: List[Dict[str, str]] = Field(default_factory=list)
    # [{"role":"user","text":"..."},{"role":"assistant","text":"..."}]
    # Bounded to the last ~10 turns to keep prompts cheap.
