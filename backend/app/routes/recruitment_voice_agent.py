"""Voice-agent endpoints for Recruitment Requisitions.

Three endpoints:

  POST /recruitment/voice-agent/interpret
       body:  { utterance: str, history: [{role, content}, ...] }
       reply: { reply, action, draft, provider }

  POST /recruitment/voice-agent/commit
       body:  the confirmed draft (same shape as RequisitionCreate)
       reply: the serialized RecruitmentRequisition row

  POST /recruitment/voice-agent/speak
       body:  { text: str, language: "ta-IN"|"en-IN"|"hi-IN"|... }
       reply: audio/wav bytes  (Sarvam AI · Bulbul TTS · female voice)

       Server-side TTS so the frontend never falls back to the
       browser's robotic default speechSynthesis. Sarvam AI's
       Bulbul model has native-quality Tamil / Hindi / English
       female voices — perfect for BVC24's Coimbatore floor.
"""

from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import require, get_current_user
from app.models.models import Employee
from app.models.recruitment_requisition_models import RecruitmentRequisition
from app.services.recruitment_voice_agent import (
    interpret,
    LAST_ERRORS,
    QWEN_MODEL_FALLBACKS,
)
from app.services.sarvam_tts import (
    ALLOWED_VOICES as _ALLOWED_VOICES_SHARED,
    SARVAM_LANG_MAP as _SARVAM_LANG_MAP_SHARED,
    SarvamError,
    sarvam_speak,
)

# Reuse the existing requisition-create logic (email + token + serialize).
# The recruitment route already defines these; importing them keeps
# behaviour identical between the manual form and the voice agent.
from app.routes.recruitment import (
    _next_req_code,
    _serialize_requisition,
    _send_requisition_approval_email,
)


router = APIRouter(
    prefix="/recruitment/voice-agent",
    tags=["Recruitment · Voice Agent"],
)


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------

class HistoryTurn(BaseModel):
    role: str                       # "user" | "assistant"
    content: str


class InterpretIn(BaseModel):
    utterance: str
    history: List[HistoryTurn] = Field(default_factory=list)


class InterpretOut(BaseModel):
    reply: str
    action: str                     # NEED_MORE | PROPOSE_DRAFT
    draft: Optional[Dict[str, Any]] = None
    provider: str


class CommitIn(BaseModel):
    POSITION_TITLE: str
    DEPARTMENT: Optional[str] = None
    LOCATION: Optional[str] = "Coimbatore"
    EMPLOYMENT_TYPE: Optional[str] = "FULL_TIME"
    HEADCOUNT: Optional[int] = 1
    EXPERIENCE_MIN_YEARS: Optional[float] = 0.0
    EXPERIENCE_MAX_YEARS: Optional[float] = None
    BUDGET_CTC_MIN: Optional[float] = None
    BUDGET_CTC_MAX: Optional[float] = None
    REQUIRED_SKILLS: Optional[str] = None
    PREFERRED_SKILLS: Optional[str] = None
    REQUIRED_EDUCATION: Optional[str] = None
    JUSTIFICATION: Optional[str] = None
    URGENCY: Optional[str] = "NORMAL"
    NEEDED_BY_DATE: Optional[str] = None


# ---------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------

@router.post(
    "/interpret",
    response_model=InterpretOut,
    dependencies=[Depends(require("recruitment.manage"))],
)
def interpret_utterance(body: InterpretIn) -> InterpretOut:
    """Turn one HR utterance into either a follow-up question or a
    complete requisition draft. Never mutates the DB."""

    history = [
        {"role": t.role, "content": t.content}
        for t in body.history
        if (t.content or "").strip()
    ]
    result = interpret(body.utterance, history=history)
    return InterpretOut(**result)


@router.post(
    "/commit",
    dependencies=[Depends(require("recruitment.manage"))],
)
def commit_requisition(
    body: CommitIn,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Create the requisition from a confirmed voice draft.

    Same effect as posting the manual `/recruitment/requisitions`
    form — including the approval email to HR / MD.
    """

    if not body.POSITION_TITLE.strip():
        raise HTTPException(400, "POSITION_TITLE is required.")

    needed = None
    if body.NEEDED_BY_DATE:
        try:
            needed = date.fromisoformat(body.NEEDED_BY_DATE)
        except (TypeError, ValueError):
            raise HTTPException(400, "NEEDED_BY_DATE must be YYYY-MM-DD.")

    import secrets

    r = RecruitmentRequisition(
        REQ_CODE             = _next_req_code(db),
        POSITION_TITLE       = body.POSITION_TITLE.strip(),
        DEPARTMENT           = (body.DEPARTMENT or "").strip() or None,
        LOCATION             = (body.LOCATION or "").strip() or None,
        EMPLOYMENT_TYPE      = body.EMPLOYMENT_TYPE or "FULL_TIME",
        HEADCOUNT            = body.HEADCOUNT or 1,
        EXPERIENCE_MIN_YEARS = body.EXPERIENCE_MIN_YEARS or 0.0,
        EXPERIENCE_MAX_YEARS = body.EXPERIENCE_MAX_YEARS,
        BUDGET_CTC_MIN       = body.BUDGET_CTC_MIN,
        BUDGET_CTC_MAX       = body.BUDGET_CTC_MAX,
        REQUIRED_SKILLS      = (body.REQUIRED_SKILLS or "").strip() or None,
        PREFERRED_SKILLS     = (body.PREFERRED_SKILLS or "").strip() or None,
        REQUIRED_EDUCATION   = (body.REQUIRED_EDUCATION or "").strip() or None,
        JUSTIFICATION        = (body.JUSTIFICATION or "").strip()
                               or f"Raised by voice agent on "
                                  f"{datetime.now():%Y-%m-%d %H:%M}",
        URGENCY              = (body.URGENCY or "NORMAL").upper(),
        NEEDED_BY_DATE       = needed,
        REQUESTED_BY_ID      = user.get("employee_id"),
        STATUS               = "PENDING",
        APPROVAL_TOKEN       = secrets.token_urlsafe(32),
        VENDOR_ID            = 1,
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    # Fire the same approval email the manual form triggers, so HR /
    # MD see this voice-raised requisition in their inbox exactly as
    # they would a keyboard-raised one.
    requester_name = None
    if r.REQUESTED_BY_ID:
        emp = db.query(Employee).filter(Employee.ID == r.REQUESTED_BY_ID).first()
        if emp:
            requester_name = emp.NAME
    _send_requisition_approval_email(r, requester_name)

    return _serialize_requisition(r, db)


# =====================================================================
# TTS · Sarvam AI · Bulbul v3 (female voice, native Tamil / Hindi / English)
# =====================================================================
#
# Sarvam's Bulbul:v3 (Sep 2026 refresh) ships a new speaker roster.
# Recommended female voices:
#
#   • "priya"    — neutral, professional (recommended default)
#   • "kavya"    — warm, expressive
#   • "shruti"   — clear, articulate
#   • "ishita"   — soft, empathetic
#   • "neha"     — friendly, casual
#   • "shreya"   — formal, corporate
#   • "kavitha"  — mature, authoritative
#   • Others:      ritu · pooja · simran · roopa · tanya · suhani
#
# The frontend posts the reply text; we call Sarvam, get back a
# base64-encoded WAV, and stream the raw bytes to the browser. No
# browser speechSynthesis anywhere in the path.
#
# Env config:
#   SARVAM_API_KEY   — required, sign up at https://sarvam.ai/
#   SARVAM_VOICE     — optional, defaults to "priya"
#   SARVAM_MODEL     — optional, defaults to "bulbul:v3"
# ---------------------------------------------------------------------

# NOTE: Language map (_SARVAM_LANG_MAP_SHARED) and voice whitelist
# (_ALLOWED_VOICES_SHARED) live in app.services.sarvam_tts so the
# Leave voice assistant and this route stay in lockstep. Re-exported
# under the old names below so any downstream import keeps working.
_SARVAM_LANG_MAP = _SARVAM_LANG_MAP_SHARED
_ALLOWED_VOICES = _ALLOWED_VOICES_SHARED


class SpeakIn(BaseModel):
    text: str
    language: Optional[str] = "en-IN"
    # HR picks the voice from the modal's dropdown; falls back to
    # SARVAM_VOICE env var, then to "pooja" if that's unset too.
    voice: Optional[str] = None


@router.post(
    "/speak",
    dependencies=[Depends(require("recruitment.manage"))],
)
def speak_via_sarvam(body: SpeakIn) -> Response:
    """Synthesize `body.text` in Sarvam's Bulbul female voice and
    return raw WAV bytes the browser plays directly via <audio>."""

    try:
        wav_bytes, voice_used, _ = sarvam_speak(
            text=body.text,
            language=body.language,
            voice=body.voice,
        )
    except SarvamError as e:
        msg = str(e)
        status = 503 if "SARVAM_API_KEY" in msg else 502
        raise HTTPException(status, msg)

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-Voice-Provider": f"sarvam · {voice_used}",
        },
    )


# =====================================================================
# Job-post image · WE'RE HIRING poster
# =====================================================================
#
# HR speaks the requisition → agent extracts fields → this endpoint
# renders a 1080 × 1350 branded PNG they can download and drop
# straight onto LinkedIn / Naukri / WhatsApp groups. Pillow-only,
# no external image API.

class PostImageIn(BaseModel):
    """Same shape as CommitIn — HR can generate a post BEFORE
    committing, so we accept the loose draft directly instead of
    reading from the DB."""
    POSITION_TITLE: str
    DEPARTMENT: Optional[str] = None
    LOCATION: Optional[str] = "Coimbatore, Tamil Nadu"
    EMPLOYMENT_TYPE: Optional[str] = "FULL_TIME"
    HEADCOUNT: Optional[int] = 1
    EXPERIENCE_MIN_YEARS: Optional[float] = 0.0
    EXPERIENCE_MAX_YEARS: Optional[float] = None
    BUDGET_CTC_MIN: Optional[float] = None
    BUDGET_CTC_MAX: Optional[float] = None
    REQUIRED_SKILLS: Optional[str] = None
    PREFERRED_SKILLS: Optional[str] = None
    REQUIRED_EDUCATION: Optional[str] = None
    NEEDED_BY_DATE: Optional[str] = None
    JUSTIFICATION: Optional[str] = None
    URGENCY: Optional[str] = "NORMAL"


@router.post(
    "/post-image",
    dependencies=[Depends(require("recruitment.manage"))],
)
def generate_job_post_image(body: PostImageIn) -> Response:
    """Return a branded WE'RE HIRING PNG (1080 × 1350) ready to
    download and post to LinkedIn / Naukri / WhatsApp groups.
    Nothing is persisted server-side — the frontend saves it if
    HR wants a copy."""
    from app.services.recruitment_post_image import render_job_post

    if not body.POSITION_TITLE.strip():
        raise HTTPException(400, "POSITION_TITLE is required")

    png = render_job_post(body.model_dump())

    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": (
                f'inline; filename="hiring-'
                f'{body.POSITION_TITLE.strip().replace(" ", "-").lower()[:40]}.png"'
            ),
        },
    )


@router.get("/agent/health")
def agent_health() -> Dict[str, Any]:
    """Quick triage view — is the Qwen agent talking to OpenRouter,
    or falling back to regex? Reports the last few model attempts
    with their exact HTTP error, so you can see whether the free
    tier is exhausted, a model is deprecated, or the key is wrong.

    Auth intentionally OMITTED — the endpoint only returns model
    names + error messages (no secrets, no PII), and HR needs to
    hit it from the browser address bar when debugging.
    """
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return {
        "openrouter_key_configured": bool(key),
        # Just the prefix — enough to confirm which key is loaded
        # without leaking anything useful.
        "openrouter_key_prefix": key[:8] if key else None,
        "primary_model": os.getenv("OPENROUTER_MODEL", "").strip()
                          or QWEN_MODEL_FALLBACKS[0],
        "fallback_chain": QWEN_MODEL_FALLBACKS,
        "recent_attempts": list(LAST_ERRORS[-12:]),
    }


@router.get(
    "/speak/health",
    dependencies=[Depends(require("recruitment.manage"))],
)
def speak_health() -> Dict[str, Any]:
    """Quick config check. Doesn't call Sarvam — just reports what
    the server sees, so HR can debug 'why is voice silent' in
    seconds instead of trawling the .env by hand."""
    key = os.getenv("SARVAM_API_KEY", "").strip()
    return {
        "sarvam_key_configured": bool(key),
        "sarvam_key_preview": (key[:6] + "…" + key[-4:]) if key else None,
        "sarvam_voice": os.getenv("SARVAM_VOICE", "priya"),
        "sarvam_model": os.getenv("SARVAM_MODEL", "bulbul:v3"),
    }
