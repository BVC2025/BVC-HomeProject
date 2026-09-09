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
from typing import Any, Dict, List, Literal, Optional

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
    GEMINI_MODEL_FALLBACKS,
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
    # Groups turns of one conversation together in the audit trail.
    # Frontend generates a random UUID per "New Requisition" opening
    # and sends the same value on every subsequent turn. Optional —
    # if missing we auto-create one server-side.
    session_id: Optional[str] = None


class InterpretOut(BaseModel):
    reply: str
    action: str                     # CHIT_CHAT | NEED_MORE | PROPOSE_DRAFT
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
    WORK_MODE: Optional[str] = "ON_SITE"
    SHIFT: Optional[str] = None
    SALARY_PERIOD: Optional[str] = "MONTHLY"
    HIRING_MANAGER_ID: Optional[str] = None
    RECRUITER_ID: Optional[str] = None
    APPLICATION_DEADLINE: Optional[str] = None
    JOB_DESCRIPTION: Optional[str] = None
    RESPONSIBILITIES: Optional[str] = None
    QUALIFICATIONS: Optional[str] = None
    source: Literal["CHAT", "VOICE"] = "VOICE"
    original_transcript: Optional[str] = None


# ---------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------

@router.post(
    "/interpret",
    response_model=InterpretOut,
    dependencies=[Depends(require("recruitment.manage"))],
)
def interpret_utterance(
    body: InterpretIn,
    db:   Session = Depends(get_db),
    user: dict    = Depends(get_current_user),
) -> InterpretOut:
    """Turn one HR utterance into either a follow-up question or a
    complete requisition draft.

    Persists BOTH the user's utterance and Deepthi's reply to
    `recruitment_chat_message` so admins can audit conversations.
    Persistence failures never break the chat — the reply always
    reaches the caller even if the DB write blows up.
    """
    import json as _json
    import uuid as _uuid
    import re as _re
    from app.models.recruitment_chat_models import RecruitmentChatMessage

    history = [
        {"role": t.role, "content": t.content}
        for t in body.history
        if (t.content or "").strip()
    ]
    result = interpret(body.utterance, history=history)

    session_id = (body.session_id or str(_uuid.uuid4())).strip()[:36]
    emp_id     = user.get("employee_id") or user.get("sub")
    vendor_id  = user.get("vendor_id")

    # Sniff the utterance's script so admins can filter by language
    # without needing every row to pass through detect_language().
    utter = (body.utterance or "")
    if _re.search(r"[஀-௿]", utter):    lang = "ta"
    elif _re.search(r"[ऀ-ॿ]", utter):    lang = "hi"
    else:                                 lang = "en"

    try:
        db.add(RecruitmentChatMessage(
            EMPLOYEE_ID = emp_id,
            ROLE        = "user",
            CONTENT     = utter[:20000],
            LANGUAGE    = lang,
            SESSION_ID  = session_id,
            VENDOR_ID   = vendor_id,
        ))
        db.add(RecruitmentChatMessage(
            EMPLOYEE_ID    = emp_id,
            ROLE           = "assistant",
            CONTENT        = (result.get("reply") or "")[:20000],
            ACTION         = result.get("action"),
            PROVIDER       = result.get("provider"),
            DRAFT_SNAPSHOT = _json.dumps(result.get("draft")) if result.get("draft") else None,
            SESSION_ID     = session_id,
            VENDOR_ID      = vendor_id,
        ))
        db.commit()
    except Exception:
        db.rollback()      # best-effort persistence; chat must still work

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

    deadline = None
    if body.APPLICATION_DEADLINE:
        try:
            deadline = date.fromisoformat(body.APPLICATION_DEADLINE)
        except (TypeError, ValueError):
            raise HTTPException(400, "APPLICATION_DEADLINE must be YYYY-MM-DD.")

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
        WORK_MODE            = (body.WORK_MODE or "ON_SITE").upper(),
        SHIFT                = (body.SHIFT or "").strip() or None,
        SALARY_PERIOD        = (body.SALARY_PERIOD or "MONTHLY").upper(),
        HIRING_MANAGER_ID    = body.HIRING_MANAGER_ID or None,
        RECRUITER_ID         = body.RECRUITER_ID or None,
        APPLICATION_DEADLINE = deadline,
        JOB_DESCRIPTION      = (body.JOB_DESCRIPTION or "").strip() or None,
        RESPONSIBILITIES     = (body.RESPONSIBILITIES or "").strip() or None,
        QUALIFICATIONS       = (body.QUALIFICATIONS or "").strip() or None,
        SOURCE               = body.source,
        ORIGINAL_TRANSCRIPT  = (body.original_transcript or "").strip() or None,
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


# =====================================================================
# Job-post plain text — for pasting into LinkedIn / Indeed / Naukri
# by hand. No real portal API integration exists yet (no credentials
# for any of them) — this is the honest "export, don't fake-publish"
# path: the recruiter copies this and posts it themselves wherever
# they actually have an account.
# =====================================================================

class PostTextIn(PostImageIn):
    WORK_MODE: Optional[str] = "ON_SITE"
    SHIFT: Optional[str] = None
    SALARY_PERIOD: Optional[str] = "MONTHLY"
    JOB_DESCRIPTION: Optional[str] = None
    RESPONSIBILITIES: Optional[str] = None
    QUALIFICATIONS: Optional[str] = None


def _format_salary(lo, hi, period) -> Optional[str]:
    if not lo and not hi:
        return None
    unit = "/month" if (period or "MONTHLY").upper() == "MONTHLY" else " CTC/year"
    if lo and hi:
        return f"₹{lo:,.0f}–₹{hi:,.0f}{unit}"
    return f"₹{(lo or hi):,.0f}{unit}"


@router.post(
    "/post-text",
    dependencies=[Depends(require("recruitment.manage"))],
)
def generate_job_post_text(body: PostTextIn) -> Dict[str, str]:
    """Plain-text job posting, ready to copy-paste. Company name is
    hardcoded (BVC24 doesn't have a multi-tenant company-name setting
    the recruitment module already reads from) — update here if that
    changes."""

    if not body.POSITION_TITLE.strip():
        raise HTTPException(400, "POSITION_TITLE is required")

    lines = [
        body.POSITION_TITLE.strip(),
        "Bharath Vending Corporation",
        "",
    ]

    facts = []
    if body.LOCATION:
        facts.append(f"📍 {body.LOCATION}")
    if body.EMPLOYMENT_TYPE:
        facts.append(f"💼 {body.EMPLOYMENT_TYPE.replace('_', ' ').title()}")
    if body.WORK_MODE:
        facts.append(f"🏠 {body.WORK_MODE.replace('_', ' ').title()}")
    if body.EXPERIENCE_MIN_YEARS is not None or body.EXPERIENCE_MAX_YEARS is not None:
        lo, hi = body.EXPERIENCE_MIN_YEARS or 0, body.EXPERIENCE_MAX_YEARS
        facts.append(f"👨‍💻 {lo:g}–{hi:g} Years" if hi else f"👨‍💻 {lo:g}+ Years")
    salary = _format_salary(body.BUDGET_CTC_MIN, body.BUDGET_CTC_MAX, body.SALARY_PERIOD)
    if salary:
        facts.append(f"💰 {salary}")
    if facts:
        lines.append("  ".join(facts))
        lines.append("")

    if body.JOB_DESCRIPTION:
        lines += ["About the Role", body.JOB_DESCRIPTION.strip(), ""]

    if body.RESPONSIBILITIES:
        lines += ["Responsibilities", body.RESPONSIBILITIES.strip(), ""]

    if body.REQUIRED_SKILLS:
        lines += ["Required Skills", body.REQUIRED_SKILLS.strip(), ""]

    if body.PREFERRED_SKILLS:
        lines += ["Preferred Skills", body.PREFERRED_SKILLS.strip(), ""]

    if body.QUALIFICATIONS:
        lines += ["Qualifications", body.QUALIFICATIONS.strip(), ""]
    elif body.REQUIRED_EDUCATION:
        lines += ["Qualifications", body.REQUIRED_EDUCATION.strip(), ""]

    if body.SHIFT:
        lines += [f"Shift: {body.SHIFT}", ""]

    return {"text": "\n".join(lines).strip() + "\n"}


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
    gemini_key    = os.getenv("GEMINI_API_KEY", "").strip()
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return {
        "primary_provider":              "gemini" if gemini_key else ("openrouter" if openrouter_key else "regex-fallback"),

        "gemini_key_configured":         bool(gemini_key),
        "gemini_key_prefix":             gemini_key[:8] if gemini_key else None,
        "gemini_primary_model":          os.getenv("GEMINI_MODEL", "").strip()
                                          or GEMINI_MODEL_FALLBACKS[0],
        "gemini_fallback_chain":         GEMINI_MODEL_FALLBACKS,

        "openrouter_key_configured":     bool(openrouter_key),
        "openrouter_key_prefix":         openrouter_key[:8] if openrouter_key else None,
        "openrouter_primary_model":      os.getenv("OPENROUTER_MODEL", "").strip()
                                          or QWEN_MODEL_FALLBACKS[0],
        "openrouter_fallback_chain":     QWEN_MODEL_FALLBACKS,

        "recent_attempts":               list(LAST_ERRORS[-12:]),
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


# =====================================================================
# Chat-history admin endpoints
# =====================================================================
#
# All /recruitment/voice-agent/interpret calls store both the user
# utterance and Deepthi's reply. These three endpoints let an admin
# (recruitment.view or admin-level) list who has talked to Deepthi,
# open one employee's full transcript, and delete a transcript if
# needed (GDPR, accidental sensitive content).

@router.get(
    "/history/employees",
    dependencies=[Depends(require("recruitment.view"))],
)
def recruit_history_employees(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """Sidebar for the admin Chat History view — one row per employee
    who has chatted with Deepthi, with message count + last activity.
    Sorted newest-first."""
    from sqlalchemy import func
    from app.models.recruitment_chat_models import RecruitmentChatMessage

    rows = (
        db.query(
            RecruitmentChatMessage.EMPLOYEE_ID,
            func.count(RecruitmentChatMessage.ID).label("message_count"),
            func.max(RecruitmentChatMessage.CREATED_AT).label("last_activity"),
        )
        .group_by(RecruitmentChatMessage.EMPLOYEE_ID)
        .all()
    )
    if not rows:
        return []

    emp_ids = [r.EMPLOYEE_ID for r in rows if r.EMPLOYEE_ID]
    by_id: Dict[str, Employee] = {}
    if emp_ids:
        for e in db.query(Employee).filter(Employee.ID.in_(emp_ids)).all():
            by_id[e.ID] = e

    out: List[Dict[str, Any]] = []
    for r in rows:
        emp = by_id.get(r.EMPLOYEE_ID) if r.EMPLOYEE_ID else None
        out.append({
            "employee_id":   r.EMPLOYEE_ID,
            "employee_code": emp.EMPLOYEE_CODE if emp else None,
            "employee_name": (emp.NAME if emp else None) or ("(anonymous)" if not r.EMPLOYEE_ID else "(unknown)"),
            "message_count": int(r.message_count or 0),
            "last_activity": r.last_activity.isoformat() if r.last_activity else None,
        })
    out.sort(key=lambda x: x["last_activity"] or "", reverse=True)
    return out


@router.get(
    "/history/employee/{employee_id}",
    dependencies=[Depends(require("recruitment.view"))],
)
def recruit_history_for_employee(
    employee_id: str,
    limit:       int = 500,
    db:          Session = Depends(get_db),
) -> Dict[str, Any]:
    """Full transcript for one employee, oldest-first (chronological
    reading order). Draft snapshots are parsed back to dicts so the
    admin UI can render the requisition preview inline."""
    import json as _json
    from app.models.recruitment_chat_models import RecruitmentChatMessage

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()
    if not emp:
        emp = db.query(Employee).filter(Employee.EMPLOYEE_CODE == employee_id).first()

    rows = (
        db.query(RecruitmentChatMessage)
        .filter(RecruitmentChatMessage.EMPLOYEE_ID == (emp.ID if emp else employee_id))
        .order_by(RecruitmentChatMessage.CREATED_AT.asc())
        .limit(limit)
        .all()
    )

    messages: List[Dict[str, Any]] = []
    for m in rows:
        draft: Optional[Dict[str, Any]] = None
        if m.DRAFT_SNAPSHOT:
            try:
                draft = _json.loads(m.DRAFT_SNAPSHOT)
            except Exception:
                draft = None
        messages.append({
            "id":         m.ID,
            "role":       m.ROLE,
            "content":    m.CONTENT,
            "language":   m.LANGUAGE,
            "action":     m.ACTION,
            "provider":   m.PROVIDER,
            "draft":      draft,
            "session_id": m.SESSION_ID,
            "created_at": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
        })

    return {
        "employee": {
            "id":   emp.ID if emp else employee_id,
            "code": emp.EMPLOYEE_CODE if emp else None,
            "name": emp.NAME if emp else None,
        },
        "message_count": len(messages),
        "messages":      messages,
    }


@router.delete(
    "/history/employee/{employee_id}",
    dependencies=[Depends(require("recruitment.manage"))],
)
def recruit_history_delete(
    employee_id: str,
    db:          Session = Depends(get_db),
) -> Dict[str, Any]:
    """Admin can clear one employee's Deepthi transcript (e.g. GDPR
    request, sensitive content accidentally spoken). Requires the
    stronger recruitment.manage permission, not just .view."""
    from app.models.recruitment_chat_models import RecruitmentChatMessage

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()
    if not emp:
        emp = db.query(Employee).filter(Employee.EMPLOYEE_CODE == employee_id).first()

    n = (
        db.query(RecruitmentChatMessage)
        .filter(RecruitmentChatMessage.EMPLOYEE_ID == (emp.ID if emp else employee_id))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"deleted": n, "employee_id": emp.ID if emp else employee_id}
