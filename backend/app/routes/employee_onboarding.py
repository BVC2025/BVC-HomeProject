"""
Employee Self-Onboarding — backend routes.

A candidate is invited by HR with a single-use token URL. The link
opens a chat-style form (AI-driven) that collects every Employee
profile field. PHOTO is uploaded via a separate multipart endpoint.
When the candidate hits "Submit", the session is flipped to
SUBMITTED and the row sits in HR's approval queue. Approval is the
ONLY thing that creates the real Employee row.

PUBLIC endpoints (the token IS the secret — no JWT):
  GET    /employee-onboarding/{token}                 Session state
  POST   /employee-onboarding/{token}/chat            Send a chat msg / skip
  POST   /employee-onboarding/{token}/upload-photo    Multipart photo upload
  POST   /employee-onboarding/{token}/submit          Final submit

ADMIN endpoints (called from the HR UI):
  POST   /employee-onboarding/invite                  Generate invite link
  GET    /employee-onboarding/sessions                List all sessions
  GET    /employee-onboarding/sessions/{id}           Full detail
  PATCH  /employee-onboarding/sessions/{id}           Override / org block
  POST   /employee-onboarding/sessions/{id}/approve   Create Employee row
  POST   /employee-onboarding/sessions/{id}/reject    Mark rejected
  DELETE /employee-onboarding/sessions/{id}           Delete invite
  POST   /employee-onboarding/sessions/{id}/resend-link  Refresh token
"""

import json
import os
import re
import secrets
import shutil
import uuid
from datetime import datetime, timedelta, time as dtime
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database.database import get_db

from app.models.models import (
    Employee,
    EmployeeOnboardingSession,
    Role,
    Department,
)

from app.schemas.employee_schema import EmployeeCreate

from app.services.auth_service import (
    hash_password,
    verify_password,
    build_login_response,
)
from app.services import employee_onboarding_ai_service as ai

from app.auth.auth_bearer import get_current_admin, require


router = APIRouter()


# =========================
# Constants
# =========================

_ALLOWED_PHOTO_EXTS = {".png", ".jpg", ".jpeg", ".webp"}

_STATIC_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "static" / "employee-onboarding"
)

# ---- Candidate document uploads (resume, marksheet, Aadhaar, PAN, ...) ----
# Staged here keyed by token; moved to /static/employee-docs/{emp_id}/
# at submit-form time, with matching EmployeeDocument rows created.
_DOC_STAGING_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "static" / "employee-onboarding-docs"
)

_ALLOWED_DOC_EXTS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".webp",
    ".doc", ".docx", ".xls", ".xlsx", ".txt",
}

_MAX_DOC_BYTES = 10 * 1024 * 1024  # 10 MB per file

# Document types the candidate can pick. Kept aligned with the admin
# /employees/{id}/documents catalogue so post-submit handoff is direct.
_CANDIDATE_DOC_TYPES = {
    "RESUME", "MARKSHEET", "DEGREE_CERTIFICATE", "AADHAAR", "PAN",
    "PASSPORT", "DRIVING_LICENSE", "OFFER_LETTER", "EXPERIENCE_LETTER",
    "PAYSLIP", "BANK_STATEMENT", "OTHER",
}


def _frontend_base_url(request: "Request | None" = None) -> str:
    """Resolve the public URL the customer/employee should reach the
    frontend on. Used when building invite/onboarding links that go
    out via email or WhatsApp.

    Resolution order:
      1. FRONTEND_BASE_URL / FRONTEND_URL env vars (production, fixed)
      2. The request's `Origin` header, then `Referer` host —
         set by the browser to the admin's current frontend URL.
         When the admin opens the UI through a Cloudflare tunnel, this
         is the tunnel hostname; when through localhost, it's localhost.
         This eliminates the need to keep .env in sync with a rotating
         quick-tunnel URL.
      3. `http://localhost:5173` — final fallback for non-HTTP callers
         (cron jobs, scripts) where neither env nor request is set.
    """

    env_val = (os.getenv("FRONTEND_BASE_URL") or os.getenv("FRONTEND_URL") or "").strip()

    if env_val:
        return env_val.rstrip("/")

    if request is not None:

        # Origin is set on cross-origin POSTs (admin clicking "send invite"
        # in the React app issues one). Use its scheme + host as-is.
        origin = request.headers.get("origin")

        if origin:
            return origin.rstrip("/")

        # Referer is more loosely set but includes the host the admin
        # is browsing from. Strip the path component.
        referer = request.headers.get("referer")

        if referer:
            try:
                from urllib.parse import urlparse
                p = urlparse(referer)
                if p.scheme and p.netloc:
                    return f"{p.scheme}://{p.netloc}"
            except Exception:
                pass

    return "http://localhost:5173"


# =========================
# Helpers
# =========================

def _gen_token() -> str:

    return secrets.token_urlsafe(32)


def _utcnow() -> datetime:

    return datetime.utcnow()


def _parse_time(raw: Optional[str]) -> Optional[dtime]:
    """Parse a 'HH:MM' string into a datetime.time. Returns None on
    blank input. Raises HTTPException on a malformed value so the
    admin sees a clean 400."""

    if raw is None or raw == "":

        return None

    if isinstance(raw, dtime):

        return raw

    s = str(raw).strip()

    if not s:

        return None

    m = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?$", s)

    if not m:

        raise HTTPException(
            status_code=400,
            detail=f"Invalid time '{raw}' — use HH:MM (e.g. 09:30)"
        )

    hh = int(m.group(1))

    mm = int(m.group(2))

    if not (0 <= hh <= 23 and 0 <= mm <= 59):

        raise HTTPException(
            status_code=400,
            detail=f"Invalid time '{raw}' — hour must be 0-23, minute 0-59"
        )

    return dtime(hh, mm)


def _load_json(raw: Optional[str], default: Any) -> Any:

    if not raw:

        return default

    try:

        return json.loads(raw)

    except Exception:

        return default


def _collected(s: EmployeeOnboardingSession) -> Dict[str, Any]:

    data = _load_json(s.COLLECTED_DATA, {})

    if not isinstance(data, dict):

        return {}

    return data


def _chat_history(s: EmployeeOnboardingSession) -> List[dict]:

    data = _load_json(s.CHAT_HISTORY, [])

    if not isinstance(data, list):

        return []

    return data


def _save_collected(s: EmployeeOnboardingSession, collected: Dict[str, Any]) -> None:

    s.COLLECTED_DATA = json.dumps(collected, default=str)


def _save_chat(s: EmployeeOnboardingSession, chat: List[dict]) -> None:

    s.CHAT_HISTORY = json.dumps(chat, default=str)


def _progress_pct(collected: Dict[str, Any]) -> float:
    """Returns 0.0 - 100.0 (percent). The AI service returns a 0-1
    fraction so we scale here."""

    skipped = collected.get(ai.SKIPPED_KEY) or []

    frac = ai.progress_pct(collected, skipped)

    return round(float(frac) * 100.0, 2)


def _check_expiry(s: EmployeeOnboardingSession, db: Session) -> bool:
    """If EXPIRES_AT is in the past and STATUS is still OPEN, flip
    STATUS=EXPIRED. Returns True if the session is now expired."""

    if s.EXPIRES_AT and s.EXPIRES_AT < _utcnow() and s.STATUS == "OPEN":

        s.STATUS = "EXPIRED"

        try:

            db.commit()

        except Exception:

            db.rollback()

        return True

    return s.STATUS == "EXPIRED"


def _require_session(
    token: str,
    db: Session,
    check_expiry: bool = True
) -> EmployeeOnboardingSession:

    s = db.query(EmployeeOnboardingSession).filter(
        EmployeeOnboardingSession.TOKEN == token
    ).first()

    if not s:

        raise HTTPException(status_code=404, detail="Onboarding link not found")

    if check_expiry and _check_expiry(s, db):

        raise HTTPException(status_code=410, detail="This onboarding link has expired")

    return s


def _require_session_by_id(
    session_id: int,
    db: Session
) -> EmployeeOnboardingSession:

    s = db.query(EmployeeOnboardingSession).filter(
        EmployeeOnboardingSession.ID == session_id
    ).first()

    if not s:

        raise HTTPException(status_code=404, detail="Onboarding session not found")

    return s


def _serialize_for_admin_list(s: EmployeeOnboardingSession) -> dict:

    collected = _collected(s)

    return {
        "id": s.ID,
        "token": s.TOKEN,
        "invited_name": s.INVITED_NAME or collected.get("NAME"),
        "invited_email": s.INVITED_EMAIL or collected.get("EMAIL"),
        "invited_phone": s.INVITED_PHONE or collected.get("PHONE"),
        "status": s.STATUS,
        "progress_pct": _progress_pct(collected),
        "photo_url": s.PHOTO_URL,
        "submitted_at": s.SUBMITTED_AT.isoformat() if s.SUBMITTED_AT else None,
        "approved_at": s.APPROVED_AT.isoformat() if s.APPROVED_AT else None,
        "created_at": s.CREATED_AT.isoformat() if s.CREATED_AT else None,
        "expires_at": s.EXPIRES_AT.isoformat() if s.EXPIRES_AT else None,
        "employee_code": s.EMPLOYEE_CODE,
        "employee_id": s.EMPLOYEE_ID,
        "reject_reason": s.REJECT_REASON,
    }


def _serialize_for_public(s: EmployeeOnboardingSession) -> dict:

    collected = _collected(s)

    # Strip the reserved __skipped__ sentinel from the public view —
    # the UI doesn't need to render that as a field.
    public_collected = {
        k: v for k, v in collected.items() if k != ai.SKIPPED_KEY
    }

    # Compute current_field meta object (label + widget) so the
    # frontend can render the right input control without a second
    # roundtrip.
    current_field = None

    if s.CURRENT_FIELD:

        meta = ai.field_meta(s.CURRENT_FIELD)

        if meta:

            current_field = {
                "key":      meta["key"],
                "label":    meta.get("label"),
                "widget":   meta.get("widget"),
                "options":  meta.get("options"),
                "required": meta.get("required", False),
                "section":  meta.get("section"),
                "secret":   meta.get("secret", False),
            }

    return {
        "token": s.TOKEN,
        "status": s.STATUS,
        "collected_data": public_collected,
        "chat_history": _chat_history(s),
        "current_field": current_field,
        "progress_pct": _progress_pct(collected),
        "photo_url": s.PHOTO_URL,
        "expires_at": s.EXPIRES_AT.isoformat() if s.EXPIRES_AT else None,
        "submitted_at": s.SUBMITTED_AT.isoformat() if s.SUBMITTED_AT else None,
        "approved_at": s.APPROVED_AT.isoformat() if s.APPROVED_AT else None,
        "reject_reason": s.REJECT_REASON,
        "invited_name": s.INVITED_NAME,
        "employee_code": s.EMPLOYEE_CODE,
    }


def _mark_skipped(collected: Dict[str, Any], key: str) -> None:

    existing = collected.get(ai.SKIPPED_KEY) or []

    if not isinstance(existing, list):

        existing = list(existing) if existing else []

    if key not in existing:

        existing.append(key)

    collected[ai.SKIPPED_KEY] = existing


def _meta_to_dict(meta: Optional[dict]) -> Optional[dict]:

    if not meta:

        return None

    return {
        "key":      meta["key"],
        "label":    meta.get("label"),
        "widget":   meta.get("widget"),
        "options":  meta.get("options"),
        "required": meta.get("required", False),
        "section":  meta.get("section"),
        "secret":   meta.get("secret", False),
    }


# =========================
# Pydantic request bodies
# =========================

class ChatBody(BaseModel):

    message: Optional[str] = None
    skip: bool = False


class InviteCreate(BaseModel):
    """New flow: admin sets {Name + Employee ID + Password + Role} on invite.

    Email/phone are NOT collected here — the candidate fills them in
    on the registration form after logging in with the credentials
    chosen by admin. DEPARTMENT_ID + DESIGNATION_ID are optional but
    strongly recommended — they pre-set the candidate's role so the
    Employee row is fully populated on approval without an extra
    HR step."""

    INVITED_NAME: str = Field(..., min_length=1)
    EMPLOYEE_CODE: str = Field(..., min_length=1)
    PASSWORD: str = Field(..., min_length=1)
    EXPIRES_IN_DAYS: int = 2
    DEPARTMENT_ID:  Optional[int] = None
    DESIGNATION_ID: Optional[int] = None


class OnboardingLogin(BaseModel):
    """Candidate login with the credentials the admin chose at invite."""

    EMPLOYEE_CODE: str
    PASSWORD: str


class OnboardingSubmitForm(BaseModel):
    """Form-based registration payload. Mirrors the non-admin fields of
    EmployeeCreate. NAME + EMPLOYEE_CODE are required; the rest are
    optional and stored in COLLECTED_DATA verbatim. The Employee row is
    NOT created here — admin approval still does that."""

    EMPLOYEE_CODE: str = Field(..., min_length=1)
    NAME: str = Field(..., min_length=1)

    FATHER_NAME: Optional[str] = None
    MOTHER_NAME: Optional[str] = None
    DOB: Optional[str] = None
    GENDER: Optional[str] = None
    MARITAL_STATUS: Optional[str] = None
    OCCUPATION: Optional[str] = None

    PHONE: Optional[str] = None
    EMAIL: Optional[str] = None
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None

    QUALIFICATION: Optional[str] = None
    YEAR_OF_PASSING: Optional[int] = None

    EMPLOYMENT_TYPE: Optional[str] = None
    EXPERIENCE_YEARS: Optional[float] = None
    SKILLS: Optional[str] = None
    EXPERIENCE_DETAILS: Optional[str] = None
    PAST_PROJECTS: Optional[str] = None

    NOTES: Optional[str] = None

    # --- Phase A — HR Module expansion ---
    BLOOD_GROUP: Optional[str] = None
    NATIONALITY: Optional[str] = None
    EMERGENCY_CONTACT_NAME: Optional[str] = None
    EMERGENCY_CONTACT_PHONE: Optional[str] = None
    EMERGENCY_CONTACT_RELATION: Optional[str] = None
    WORK_LOCATION: Optional[str] = None
    COLLEGE: Optional[str] = None
    UNIVERSITY: Optional[str] = None
    PERCENTAGE: Optional[float] = None
    PREVIOUS_COMPANY: Optional[str] = None
    PREVIOUS_SALARY: Optional[float] = None
    BANK_ACCOUNT_NUMBER: Optional[str] = None
    BANK_NAME: Optional[str] = None
    IFSC_CODE: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    AADHAAR_NUMBER: Optional[str] = None
    # CONFIRMATION_DATE is admin-only — not collected from candidate.


class AdminOrgBlock(BaseModel):
    """Admin-only org details — never collected from the candidate."""

    ROLE_ID: Optional[int] = None
    DEPARTMENT_ID: Optional[int] = None
    DESIGNATION_ID: Optional[int] = None
    SALARY: Optional[float] = None
    SHIFT_START: Optional[str] = None  # "HH:MM"
    SHIFT_END: Optional[str] = None


class SessionPatch(BaseModel):
    """Any combination of COLLECTED_DATA overrides + meta + org block.

    The model_extra config lets the admin send chat-field overrides
    (NAME, PHONE, EMAIL, ADDRESS, ...) without us having to enumerate
    every Employee column here."""

    model_config = {"extra": "allow"}

    NOTES: Optional[str] = None
    EMPLOYEE_CODE: Optional[str] = None
    ORG: Optional[AdminOrgBlock] = None


class RejectBody(BaseModel):

    reason: str = Field(..., min_length=1, max_length=500)


class ApproveBody(BaseModel):
    """Optional admin org overrides applied at approval time."""

    ORG: Optional[AdminOrgBlock] = None
    EMPLOYEE_CODE: Optional[str] = None


# =========================
# PUBLIC ENDPOINTS
# =========================

# IMPORTANT: register the static GET /sessions route BEFORE the
# dynamic GET /{token} route. FastAPI matches paths in registration
# order, so without this, /employee-onboarding/sessions gets captured
# as token="sessions" and 404s. The full admin_list_sessions handler
# lives further down — this is just a forwarding stub registered at
# the right point in the route table.

@router.get("/employee-onboarding/sessions", dependencies=[Depends(require("onboarding.sessions.view"))])
def _admin_list_sessions_early(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Route-order shim — see comment above. Implementation:"""

    q = db.query(EmployeeOnboardingSession)

    if status:

        q = q.filter(EmployeeOnboardingSession.STATUS == status.upper())

    if search:

        like = f"%{search.strip()}%"

        q = q.filter(
            or_(
                EmployeeOnboardingSession.INVITED_NAME.ilike(like),
                EmployeeOnboardingSession.INVITED_EMAIL.ilike(like),
                EmployeeOnboardingSession.INVITED_PHONE.ilike(like),
                EmployeeOnboardingSession.EMPLOYEE_CODE.ilike(like),
            )
        )

    rows = q.order_by(EmployeeOnboardingSession.CREATED_AT.desc()).all()

    return [_serialize_for_admin_list(r) for r in rows]


@router.get("/employee-onboarding/{token}")
def get_public_session(token: str, db: Session = Depends(get_db)):
    """Returns the current session state for the candidate's UI.

    404 if token unknown. 410 if EXPIRES_AT has passed (the session
    is also flipped to STATUS=EXPIRED at the same time)."""

    s = _require_session(token, db)

    return _serialize_for_public(s)


@router.post("/employee-onboarding/{token}/chat")
def public_chat(
    token: str,
    body: ChatBody,
    db: Session = Depends(get_db)
):
    """DEPRECATED. The AI chat onboarding flow has been replaced with a
    static registration form (POST /employee-onboarding/{token}/submit-form).
    This route is kept registered only to give old clients a clear 410
    instead of a 404 from FastAPI."""

    raise HTTPException(
        status_code=410,
        detail=(
            "Chat onboarding has been replaced with form-based "
            "registration. Use POST /employee-onboarding/{token}/submit-form."
        )
    )

    # Original chat logic retained below for historical reference.
    # It is unreachable because of the raise above.

    s = _require_session(token, db)

    if s.STATUS != "OPEN":

        raise HTTPException(
            status_code=400,
            detail=f"This onboarding session is {s.STATUS} — chat is disabled."
        )

    collected = _collected(s)

    chat = _chat_history(s)

    # Resolve which field we are currently on. If CURRENT_FIELD is
    # unset (first turn) pick the next unanswered field.
    current_meta = None

    if s.CURRENT_FIELD:

        current_meta = ai.field_meta(s.CURRENT_FIELD)

    if not current_meta:

        skipped = collected.get(ai.SKIPPED_KEY) or []

        current_meta = ai.next_unanswered_field(collected, skipped)

    # ---- Handle skip --------------------------------------------
    if body.skip:

        if current_meta:

            _mark_skipped(collected, current_meta["key"])

        # Don't add a user "skip" bubble — frontends typically render
        # the skip click on the assistant card itself. We do log the
        # event in chat history for audit.
        chat.append({
            "role": "system",
            "text": f"Candidate skipped: {current_meta['key'] if current_meta else 'unknown'}",
            "ts": _utcnow().isoformat(),
        })

        user_msg_text = None  # nothing to parse

    else:

        user_msg_text = (body.message or "").strip()

        if not user_msg_text:

            raise HTTPException(
                status_code=400,
                detail="Send a non-empty message or set skip=true."
            )

        # Append the user bubble before validation so the chat
        # history always shows what the candidate typed.
        chat.append({
            "role": "user",
            "text": user_msg_text,
            "ts": _utcnow().isoformat(),
        })

        if current_meta:

            ok, value, err = ai.parse_user_reply(current_meta, user_msg_text)

            if not ok:

                # Persist the user message + return the error WITHOUT
                # advancing the field. The bot's reply IS the error.
                chat.append({
                    "role": "assistant",
                    "text": err or "Could you try again?",
                    "ts": _utcnow().isoformat(),
                })

                _save_collected(s, collected)

                _save_chat(s, chat)

                try:

                    db.commit()

                except Exception:

                    db.rollback()

                    raise HTTPException(
                        status_code=500,
                        detail="Could not save chat — please retry."
                    )

                return {
                    "bot_reply": err,
                    "next_field": _meta_to_dict(current_meta),
                    "progress_pct": _progress_pct(collected),
                    "done": False,
                    "error": err,
                }

            # Store the parsed value
            collected[current_meta["key"]] = value

    # ---- Advance to the next unanswered field ------------------
    skipped_list = collected.get(ai.SKIPPED_KEY) or []

    next_meta = ai.next_unanswered_field(collected, skipped_list)

    s.CURRENT_FIELD = next_meta["key"] if next_meta else None

    # ---- Bot reply: Gemini -> rule-based fallback --------------
    bot_reply = ""

    if user_msg_text or body.skip:

        # Build a tight prompt summarising the catalogue position and
        # ask Gemini to acknowledge + ask the next question.
        if next_meta:

            prompt = (
                "You are a friendly HR onboarding assistant collecting an "
                "employee's profile. The candidate just provided their "
                f"answer for the field '{current_meta['key'] if current_meta else 'unknown'}'. "
                f"Briefly (1 sentence) acknowledge that, then ask the next "
                f"question: \"{ai.build_chatbot_question(next_meta)}\". "
                "Keep your reply under 2 sentences and warm."
            )

        else:

            prompt = (
                "You are a friendly HR onboarding assistant. The candidate "
                "has finished answering every question. Thank them and let "
                "them know they can review and submit when ready. Keep it "
                "under 2 sentences."
            )

        try:

            bot_reply = ai.call_gemini(prompt, chat) or ""

        except Exception:

            bot_reply = ""

    if not bot_reply:

        bot_reply = ai.rule_based_acknowledge(
            current_meta,
            collected.get(current_meta["key"]) if current_meta else None,
            next_meta
        )

    chat.append({
        "role": "assistant",
        "text": bot_reply,
        "ts": _utcnow().isoformat(),
    })

    _save_collected(s, collected)

    _save_chat(s, chat)

    try:

        db.commit()

    except Exception:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Could not save chat — please retry."
        )

    return {
        "bot_reply": bot_reply,
        "next_field": _meta_to_dict(next_meta),
        "progress_pct": _progress_pct(collected),
        "done": next_meta is None,
    }


@router.post("/employee-onboarding/{token}/upload-photo")
def public_upload_photo(
    token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Save the candidate's photo under static/employee-onboarding/
    and store the public URL on session.PHOTO_URL."""

    s = _require_session(token, db)

    if s.STATUS not in ("OPEN", "SUBMITTED"):

        raise HTTPException(
            status_code=400,
            detail=(
                f"Photo upload is disabled for {s.STATUS} sessions."
            )
        )

    ext = Path(file.filename or "").suffix.lower()

    if ext not in _ALLOWED_PHOTO_EXTS:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported image type '{ext}'. Allowed: "
                + ", ".join(sorted(_ALLOWED_PHOTO_EXTS))
            )
        )

    _STATIC_DIR.mkdir(parents=True, exist_ok=True)

    fname = f"{token}-{uuid.uuid4().hex[:8]}{ext}"

    dest = _STATIC_DIR / fname

    try:

        with dest.open("wb") as out:

            shutil.copyfileobj(file.file, out)

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=f"Could not save photo: {exc}"
        )

    # Clean up the previous photo to avoid orphans
    if s.PHOTO_URL:

        try:

            old_name = s.PHOTO_URL.rsplit("/", 1)[-1]

            old_path = _STATIC_DIR / old_name

            if old_path.exists() and old_path.is_file():

                old_path.unlink()

        except Exception:

            pass

    public_url = f"/static/employee-onboarding/{fname}"

    s.PHOTO_URL = public_url

    try:

        db.commit()

    except Exception:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Could not record photo URL."
        )

    return {
        "message": "Photo uploaded",
        "photo_url": public_url,
    }


# =====================================================================
# Candidate document uploads — staged by token, finalized at submit
# =====================================================================

def _staged_docs_for_token(token: str) -> list[dict]:
    """Return the JSON list stored under
    session.COLLECTED_DATA['__pending_documents__'].
    Each entry: {id, doc_type, original_name, stored_name, size, uploaded_at}"""

    pass  # placeholder; we read/write through helper below


def _read_pending_docs(s) -> list[dict]:
    data = _load_json(s.COLLECTED_DATA, {})
    raw = data.get("__pending_documents__") or []
    return raw if isinstance(raw, list) else []


def _write_pending_docs(s, docs: list[dict]) -> None:
    data = _load_json(s.COLLECTED_DATA, {})
    data["__pending_documents__"] = docs
    s.COLLECTED_DATA = json.dumps(data, default=str)


def _promote_staged_documents(db: Session, s, emp, docs: list[dict] | None = None) -> int:
    """Move every staged document for this session into the employee's
    permanent docs folder and create matching EmployeeDocument rows.

    `docs` can be passed in by the caller when COLLECTED_DATA was
    overwritten between upload-time and promote-time (the submit-form
    case). When None, falls back to reading from the session.

    Returns the count of documents successfully promoted.
    """

    from app.models.models import EmployeeDocument

    if docs is None:
        docs = _read_pending_docs(s)
    if not docs:
        return 0

    target_dir = (
        Path(__file__).resolve().parent.parent.parent
        / "static" / "employee-docs" / str(emp.ID)
    )
    target_dir.mkdir(parents=True, exist_ok=True)

    staged_dir = _DOC_STAGING_DIR / s.TOKEN
    promoted = 0

    for d in docs:
        stored = d.get("stored_name")
        if not stored:
            continue
        src = staged_dir / stored
        if not src.exists() or not src.is_file():
            continue

        dest = target_dir / stored
        try:
            shutil.move(str(src), str(dest))
        except Exception as e:
            print(f"[onboarding] could not move {src} -> {dest}: {e}")
            continue

        public_url = f"/static/employee-docs/{emp.ID}/{stored}"

        try:
            row = EmployeeDocument(
                EMPLOYEE_ID=emp.ID,
                DOC_TYPE=d.get("doc_type") or "OTHER",
                TITLE=d.get("original_name") or stored,
                FILE_URL=public_url,
                FILE_NAME=d.get("original_name") or stored,
                SIZE_BYTES=int(d.get("size") or 0),
                NOTES="Uploaded by candidate during self-onboarding.",
                UPLOADED_BY_ID=emp.ID,
            )
            db.add(row)
            promoted += 1
        except Exception as e:
            print(f"[onboarding] could not insert EmployeeDocument: {e}")

    # Clean up the now-empty staging dir
    try:
        if staged_dir.exists() and not any(staged_dir.iterdir()):
            staged_dir.rmdir()
    except Exception:
        pass

    # Clear the pending list since they're now real docs
    _write_pending_docs(s, [])

    return promoted


@router.post("/employee-onboarding/{token}/upload-document")
def public_upload_document(
    token: str,
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Candidate uploads a single document (resume, marksheet, KYC, etc.).

    Each file is staged under static/employee-onboarding-docs/{token}/.
    The submit-form endpoint moves staged files to
    static/employee-docs/{employee_id}/ and creates matching
    EmployeeDocument rows.

    Returns the new doc record so the frontend can show it in the
    "Uploaded documents" list and offer a Delete button."""

    s = _require_session(token, db)

    if s.STATUS not in ("OPEN", "SUBMITTED"):
        raise HTTPException(
            status_code=400,
            detail=f"Document upload is disabled for {s.STATUS} sessions.",
        )

    dt = (doc_type or "").upper().strip()
    if dt not in _CANDIDATE_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid doc_type {dt!r}. Allowed: "
                + ", ".join(sorted(_CANDIDATE_DOC_TYPES))
            ),
        )

    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED_DOC_EXTS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type {ext!r}. Allowed: "
                + ", ".join(sorted(_ALLOWED_DOC_EXTS))
            ),
        )

    # Read file to enforce size cap. UploadFile gives us a SpooledTempFile
    # so we can read into memory safely below the 10 MB cap.
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > _MAX_DOC_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({size} bytes). Max {_MAX_DOC_BYTES} bytes.",
        )

    # Save to staging dir
    staging = _DOC_STAGING_DIR / token
    staging.mkdir(parents=True, exist_ok=True)

    doc_id = uuid.uuid4().hex
    stored_name = f"{doc_id}{ext}"
    dest = staging / stored_name
    try:
        with dest.open("wb") as out:
            shutil.copyfileobj(file.file, out)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not save document: {exc}",
        )

    # Append to session's pending-documents list
    docs = _read_pending_docs(s)
    record = {
        "id":            doc_id,
        "doc_type":      dt,
        "original_name": (file.filename or "")[:255],
        "stored_name":   stored_name,
        "size":          int(size),
        "uploaded_at":   _utcnow().isoformat(),
        "url":           f"/static/employee-onboarding-docs/{token}/{stored_name}",
    }
    docs.append(record)
    _write_pending_docs(s, docs)

    try:
        db.commit()
    except Exception:
        db.rollback()
        # best-effort cleanup on commit failure
        try:
            dest.unlink()
        except Exception:
            pass
        raise HTTPException(500, "Could not record document upload.")

    return {"message": "Document uploaded", "document": record}


@router.get("/employee-onboarding/{token}/documents")
def public_list_documents(
    token: str,
    db: Session = Depends(get_db),
):
    """List all documents the candidate has uploaded so far for THIS
    onboarding session. Used by the form to render the 'uploaded'
    table with delete buttons."""

    s = _require_session(token, db)
    return {"documents": _read_pending_docs(s)}


@router.delete("/employee-onboarding/{token}/documents/{doc_id}")
def public_delete_document(
    token: str,
    doc_id: str,
    db: Session = Depends(get_db),
):
    """Remove a single staged document. Idempotent — a missing doc
    returns 200 with `removed=false`."""

    s = _require_session(token, db)

    if s.STATUS not in ("OPEN", "SUBMITTED"):
        raise HTTPException(
            status_code=400,
            detail=f"Document delete is disabled for {s.STATUS} sessions.",
        )

    docs = _read_pending_docs(s)
    keep, dropped = [], None
    for d in docs:
        if d.get("id") == doc_id:
            dropped = d
            continue
        keep.append(d)

    if not dropped:
        return {"removed": False, "doc_id": doc_id}

    # Remove the file from disk (best effort)
    try:
        p = _DOC_STAGING_DIR / token / dropped.get("stored_name", "")
        if p.exists() and p.is_file():
            p.unlink()
    except Exception:
        pass

    _write_pending_docs(s, keep)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(500, "Could not record document removal.")

    return {"removed": True, "doc_id": doc_id}


@router.post("/employee-onboarding/{token}/submit")
def public_submit(
    token: str,
    db: Session = Depends(get_db)
):
    """DEPRECATED — back-compat alias for the old chatbot finalize step.

    The new form-based flow uses POST /employee-onboarding/{token}/submit-form
    which carries the entire payload in the request body. If a client still
    POSTs to this old endpoint with no body, we simply flip the existing
    COLLECTED_DATA to SUBMITTED (mirroring the new submit-form behavior)
    so admin approval can run."""

    s = _require_session(token, db)

    if s.STATUS == "SUBMITTED":

        return {
            "message": "Already submitted. You will be contacted shortly.",
            "status": "SUBMITTED",
        }

    if s.STATUS != "OPEN":

        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit — session is {s.STATUS}."
        )

    s.STATUS = "SUBMITTED"

    s.SUBMITTED_AT = _utcnow()

    try:

        db.commit()

    except Exception:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Could not finalize submission — please retry."
        )

    return {
        "message": "Submitted for HR approval",
        "status": "SUBMITTED",
    }


# =========================
# ADMIN ENDPOINTS
# =========================

@router.post("/employee-onboarding/invite", dependencies=[Depends(require("onboarding.invite"))])
def admin_create_invite(
    body: InviteCreate,
    request: Request,
    db: Session = Depends(get_db)
):
    """Generate a fresh invitation.

    New flow: admin picks {Name + Employee ID + Password}. The
    candidate uses Employee ID + Password to log into the onboarding
    portal and fill the registration form. Email / phone are no longer
    required up-front — those land on the form."""

    invited_name = (body.INVITED_NAME or "").strip()

    employee_code = (body.EMPLOYEE_CODE or "").strip()

    password = body.PASSWORD or ""

    if not invited_name:

        raise HTTPException(
            status_code=400,
            detail="INVITED_NAME is required."
        )

    if not employee_code:

        raise HTTPException(
            status_code=400,
            detail="EMPLOYEE_CODE is required."
        )

    if len(password) < 6:

        raise HTTPException(
            status_code=400,
            detail="Password must be at least 6 characters."
        )

    # ---- Refuse if EMPLOYEE_CODE is already taken ----
    # Existing real employee?
    if db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == employee_code.upper()
    ).first():

        raise HTTPException(
            status_code=400,
            detail=(
                f"Employee code '{employee_code}' is already assigned "
                "to an existing employee."
            )
        )

    # Open / submitted onboarding session for the same code?
    if db.query(EmployeeOnboardingSession).filter(
        EmployeeOnboardingSession.EMPLOYEE_CODE == employee_code,
        EmployeeOnboardingSession.STATUS.in_(("OPEN", "SUBMITTED"))
    ).first():

        raise HTTPException(
            status_code=400,
            detail=(
                f"Employee code '{employee_code}' is already in use by "
                "another open onboarding invite."
            )
        )

    token = _gen_token()

    # Vanishingly unlikely collision — retry once just in case
    if db.query(EmployeeOnboardingSession).filter(
        EmployeeOnboardingSession.TOKEN == token
    ).first():

        token = _gen_token()

    days = body.EXPIRES_IN_DAYS or 2

    if days < 1:

        days = 1

    expires_at = _utcnow() + timedelta(days=days)

    s = EmployeeOnboardingSession(
        TOKEN=token,
        INVITED_NAME=invited_name,
        INVITED_EMAIL=None,
        INVITED_PHONE=None,
        EMPLOYEE_CODE=employee_code,
        PASSWORD_HASH=hash_password(password),
        STATUS="OPEN",
        COLLECTED_DATA=json.dumps({}),
        CHAT_HISTORY=json.dumps([]),
        EXPIRES_AT=expires_at,
        DEPARTMENT_ID=body.DEPARTMENT_ID,
        DESIGNATION_ID=body.DESIGNATION_ID,
    )

    db.add(s)

    try:

        db.commit()

        db.refresh(s)

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not create invite: {exc}"
        )

    invite_link = f"{_frontend_base_url(request)}/employee-onboarding/{token}"

    return {
        "id": s.ID,
        "token": token,
        "invite_link": invite_link,
        "expires_at": s.EXPIRES_AT.isoformat() if s.EXPIRES_AT else None,
        "status": s.STATUS,
        "invited_name": s.INVITED_NAME,
        "employee_code": s.EMPLOYEE_CODE,
    }


@router.post("/employee-onboarding/{token}/login")
def public_onboarding_login(
    token: str,
    body: OnboardingLogin,
    db: Session = Depends(get_db)
):
    """Candidate login with the {Employee ID + Password} that admin
    chose at invite time. Does NOT issue a JWT — the token in the URL
    is already the session secret. On success, returns the public
    session payload so the SPA can render the registration form."""

    # Skip the auto-expiry-flip inside _require_session so we can
    # return a proper 410 ourselves with consistent shape below.
    s = _require_session(token, db, check_expiry=False)

    # Expiry check (manual so we control the response code)
    if s.EXPIRES_AT and s.EXPIRES_AT < _utcnow():

        if s.STATUS == "OPEN":

            s.STATUS = "EXPIRED"

            try:

                db.commit()

            except Exception:

                db.rollback()

        raise HTTPException(
            status_code=410,
            detail="This onboarding link has expired."
        )

    if s.STATUS != "OPEN":

        # Allow the candidate to "re-open" their submitted view —
        # the SPA can show a read-only confirmation. But still block
        # APPROVED / REJECTED / EXPIRED at this entrypoint with 400.
        if s.STATUS == "SUBMITTED":

            friendly = "Already submitted — waiting for HR approval."

        elif s.STATUS == "APPROVED":

            friendly = "Already approved. Please log in via the main portal."

        elif s.STATUS == "REJECTED":

            friendly = "This onboarding invite has been rejected."

        else:

            friendly = f"This onboarding session is {s.STATUS}."

        raise HTTPException(
            status_code=400,
            detail=friendly
        )

    # ---- Validate credentials ----
    submitted_code = (body.EMPLOYEE_CODE or "").strip()

    submitted_pw   = body.PASSWORD or ""

    expected_code = (s.EMPLOYEE_CODE or "").strip()

    if (
        not submitted_code
        or not expected_code
        or submitted_code.lower() != expected_code.lower()
    ):

        raise HTTPException(
            status_code=401,
            detail="Invalid Employee ID or password."
        )

    if not s.PASSWORD_HASH or not verify_password(submitted_pw, s.PASSWORD_HASH):

        raise HTTPException(
            status_code=401,
            detail="Invalid Employee ID or password."
        )

    collected = _collected(s)

    return {
        "ok": True,
        "session": _serialize_for_public(s),
        "invited_name": s.INVITED_NAME,
        "employee_code": s.EMPLOYEE_CODE,
        "status": s.STATUS,
        "submitted": collected if collected else None,
    }


def _pick_default_role(db: Session):
    """Find a sensible default Role for an auto-approved candidate.

    Priority:
      1. ROLE_NAME = 'EMPLOYEE'
      2. ROLE_NAME = 'WORKER'
      3. Any non-admin role (excludes SUPER_ADMIN / ADMIN)
      4. Lowest-ID role overall (last resort)
    """

    for name in ("EMPLOYEE", "Employee", "WORKER", "Worker"):

        r = db.query(Role).filter(Role.NAME == name).first()

        if r:

            return r

    r = db.query(Role).filter(
        ~Role.NAME.in_(["SUPER_ADMIN", "ADMIN"])
    ).order_by(Role.ID).first()

    if r:

        return r

    return db.query(Role).order_by(Role.ID).first()


@router.post("/employee-onboarding/{token}/submit-form")
def public_submit_form(
    token: str,
    body: OnboardingSubmitForm,
    db: Session = Depends(get_db)
):
    """Form-based registration submit.

    Auto-approves the candidate: stores the payload, creates the
    Employee row immediately (with a default Role), flips STATUS to
    APPROVED, and returns an auto-login payload (JWT + employee info)
    so the frontend can redirect straight to the dashboard.

    HR can still review/edit the submission afterward via the admin
    endpoints — STATUS is APPROVED on success rather than SUBMITTED."""

    s = _require_session(token, db)

    if s.STATUS != "OPEN":

        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit — session is {s.STATUS}."
        )

    submitted_code = (body.EMPLOYEE_CODE or "").strip()

    expected_code  = (s.EMPLOYEE_CODE or "").strip()

    if (
        not submitted_code
        or not expected_code
        or submitted_code.lower() != expected_code.lower()
    ):

        raise HTTPException(
            status_code=400,
            detail="EMPLOYEE_CODE does not match the invite."
        )

    # ---- Capture pending docs BEFORE we overwrite COLLECTED_DATA ----
    # _save_collected() replaces the entire JSON blob, which would wipe
    # the __pending_documents__ list the upload-document endpoint
    # appended. Grab it now and hand it to _promote_staged_documents
    # directly.
    pending_docs_snapshot = _read_pending_docs(s)

    # Persist payload to COLLECTED_DATA so HR can still review what was
    # actually submitted (separate from any later admin edits).
    payload = body.model_dump()

    payload["EMPLOYEE_CODE"] = expected_code

    _save_collected(s, payload)

    s.SUBMITTED_AT = _utcnow()

    # ---- Build EmployeeCreate payload and create the row inline ----

    def _val(key, default=None):

        v = payload.get(key)

        return v if v not in (None, "") else default

    default_role = _pick_default_role(db)

    if not default_role:

        raise HTTPException(
            status_code=500,
            detail=(
                "No Role rows exist in the database — cannot auto-approve. "
                "Seed at least one Role (e.g. EMPLOYEE) and retry."
            )
        )

    # Pydantic EmployeeCreate requires a non-empty PASSWORD string;
    # we already have the bcrypt hash on the session and copy that
    # directly onto Employee.PASSWORD below — this is a placeholder.
    placeholder_password = secrets.token_urlsafe(10)

    emp_payload = {
        "EMPLOYEE_CODE":        expected_code,
        "NAME":                 _val("NAME") or s.INVITED_NAME or "Unnamed",
        "EMAIL":                _val("EMAIL"),
        "PHONE":                _val("PHONE"),
        "PASSWORD":             placeholder_password,
        "DEPARTMENT_ID":        None,
        "DESIGNATION_ID":       None,
        "ROLE_ID":              default_role.ID,
        "REPORTING_MANAGER_ID": None,
        "JOINING_DATE":         None,
        "SALARY":               0.0,
        "SHIFT_START":          None,
        "SHIFT_END":            None,
        "SKILLS":               _val("SKILLS"),
        "VENDOR_ID":            1,
        "ADDRESS":              _val("ADDRESS"),
        "CITY":                 _val("CITY"),
        "STATE":                _val("STATE"),
        "PINCODE":              _val("PINCODE"),
        "DOB":                  _val("DOB"),
        "GENDER":               _val("GENDER"),
        "FATHER_NAME":          _val("FATHER_NAME"),
        "MOTHER_NAME":          _val("MOTHER_NAME"),
        "MARITAL_STATUS":       _val("MARITAL_STATUS"),
        "OCCUPATION":           _val("OCCUPATION"),
        "QUALIFICATION":        _val("QUALIFICATION"),
        "YEAR_OF_PASSING":      _val("YEAR_OF_PASSING"),
        "EXPERIENCE_YEARS":     _val("EXPERIENCE_YEARS") or 0.0,
        "EXPERIENCE_DETAILS":   _val("EXPERIENCE_DETAILS"),
        "PAST_PROJECTS":        _val("PAST_PROJECTS"),
        "EMPLOYMENT_TYPE":      _val("EMPLOYMENT_TYPE"),
        "NOTES":                _val("NOTES"),
        # Phase A — HR Module expansion
        "BLOOD_GROUP":                _val("BLOOD_GROUP"),
        "NATIONALITY":                _val("NATIONALITY"),
        "EMERGENCY_CONTACT_NAME":     _val("EMERGENCY_CONTACT_NAME"),
        "EMERGENCY_CONTACT_PHONE":    _val("EMERGENCY_CONTACT_PHONE"),
        "EMERGENCY_CONTACT_RELATION": _val("EMERGENCY_CONTACT_RELATION"),
        "WORK_LOCATION":              _val("WORK_LOCATION"),
        "COLLEGE":                    _val("COLLEGE"),
        "UNIVERSITY":                 _val("UNIVERSITY"),
        "PERCENTAGE":                 _val("PERCENTAGE"),
        "PREVIOUS_COMPANY":           _val("PREVIOUS_COMPANY"),
        "PREVIOUS_SALARY":            _val("PREVIOUS_SALARY"),
        "BANK_ACCOUNT_NUMBER":        _val("BANK_ACCOUNT_NUMBER"),
        "BANK_NAME":                  _val("BANK_NAME"),
        "IFSC_CODE":                  _val("IFSC_CODE"),
        "PAN_NUMBER":                 _val("PAN_NUMBER"),
        "AADHAAR_NUMBER":             _val("AADHAAR_NUMBER"),
    }

    try:

        emp_in = EmployeeCreate(**emp_payload)

    except Exception as exc:

        raise HTTPException(
            status_code=400,
            detail=f"Submission rejected — payload invalid: {exc}"
        )

    # Duplicate-key guards (mirror employee.create_employee)
    if db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == emp_in.EMPLOYEE_CODE.upper()
    ).first():

        raise HTTPException(
            status_code=400,
            detail=(
                f"Employee code '{emp_in.EMPLOYEE_CODE}' is already in use. "
                "Contact your admin to re-issue the invite with a different code."
            )
        )

    if emp_in.EMAIL and db.query(Employee).filter(
        Employee.EMAIL == emp_in.EMAIL
    ).first():

        raise HTTPException(
            status_code=400,
            detail="An employee with this email already exists."
        )

    # Use the password the admin chose at invite time (already hashed
    # on the session) so the candidate's chosen-at-invite password keeps
    # working after submit.
    final_password_hash = s.PASSWORD_HASH or hash_password(emp_in.PASSWORD)

    emp = Employee(
        EMPLOYEE_CODE=emp_in.EMPLOYEE_CODE.upper(),
        NAME=emp_in.NAME,
        EMAIL=emp_in.EMAIL,
        PHONE=emp_in.PHONE,
        PASSWORD=final_password_hash,
        DEPARTMENT_ID=emp_in.DEPARTMENT_ID,
        DESIGNATION_ID=emp_in.DESIGNATION_ID,
        ROLE_ID=emp_in.ROLE_ID,
        REPORTING_MANAGER_ID=emp_in.REPORTING_MANAGER_ID,
        JOINING_DATE=emp_in.JOINING_DATE,
        SALARY=emp_in.SALARY or 0.0,
        SHIFT_START=emp_in.SHIFT_START,
        SHIFT_END=emp_in.SHIFT_END,
        SKILLS=emp_in.SKILLS,
        STATUS="ACTIVE",
        VENDOR_ID=emp_in.VENDOR_ID,
        ADDRESS=emp_in.ADDRESS,
        CITY=emp_in.CITY,
        STATE=emp_in.STATE,
        PINCODE=emp_in.PINCODE,
        DOB=emp_in.DOB,
        GENDER=emp_in.GENDER,
        FATHER_NAME=emp_in.FATHER_NAME,
        MOTHER_NAME=emp_in.MOTHER_NAME,
        MARITAL_STATUS=emp_in.MARITAL_STATUS,
        OCCUPATION=emp_in.OCCUPATION,
        QUALIFICATION=emp_in.QUALIFICATION,
        YEAR_OF_PASSING=emp_in.YEAR_OF_PASSING,
        EXPERIENCE_YEARS=emp_in.EXPERIENCE_YEARS or 0.0,
        EXPERIENCE_DETAILS=emp_in.EXPERIENCE_DETAILS,
        PAST_PROJECTS=emp_in.PAST_PROJECTS,
        EMPLOYMENT_TYPE=emp_in.EMPLOYMENT_TYPE,
        NOTES=emp_in.NOTES,
        PHOTO_URL=s.PHOTO_URL,
        PROFILE_SUBMITTED=1,
        # Phase A — HR Module expansion
        BLOOD_GROUP=emp_in.BLOOD_GROUP,
        NATIONALITY=emp_in.NATIONALITY,
        EMERGENCY_CONTACT_NAME=emp_in.EMERGENCY_CONTACT_NAME,
        EMERGENCY_CONTACT_PHONE=emp_in.EMERGENCY_CONTACT_PHONE,
        EMERGENCY_CONTACT_RELATION=emp_in.EMERGENCY_CONTACT_RELATION,
        CONFIRMATION_DATE=emp_in.CONFIRMATION_DATE,
        WORK_LOCATION=emp_in.WORK_LOCATION,
        COLLEGE=emp_in.COLLEGE,
        UNIVERSITY=emp_in.UNIVERSITY,
        PERCENTAGE=emp_in.PERCENTAGE,
        PREVIOUS_COMPANY=emp_in.PREVIOUS_COMPANY,
        PREVIOUS_SALARY=emp_in.PREVIOUS_SALARY,
        BANK_ACCOUNT_NUMBER=emp_in.BANK_ACCOUNT_NUMBER,
        BANK_NAME=emp_in.BANK_NAME,
        IFSC_CODE=emp_in.IFSC_CODE,
        PAN_NUMBER=emp_in.PAN_NUMBER,
        AADHAAR_NUMBER=emp_in.AADHAAR_NUMBER,
    )

    db.add(emp)

    try:

        db.flush()

    except IntegrityError as e:

        db.rollback()

        raise HTTPException(
            status_code=400,
            detail=f"Database rejected the record: {str(getattr(e,'orig',e))[:200]}"
        )

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not create employee: {exc}"
        )

    # Flip the session to APPROVED + link to the new Employee
    s.EMPLOYEE_ID   = emp.ID
    s.STATUS        = "APPROVED"
    s.APPROVED_AT   = _utcnow()
    s.EMPLOYEE_CODE = emp.EMPLOYEE_CODE
    s.REJECT_REASON = None

    # ---- Promote staged candidate documents to real EmployeeDocument rows.
    # We pass the pre-captured list because _save_collected() above
    # already wiped __pending_documents__ from COLLECTED_DATA.
    # Best-effort: a failure here doesn't undo the Employee row.
    try:
        _promote_staged_documents(db, s, emp, pending_docs_snapshot)
    except Exception as doc_exc:
        print(f"[onboarding] document promote failed for {emp.EMPLOYEE_CODE}: {doc_exc}")

    try:

        db.commit()
        db.refresh(emp)

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not finalize submission: {exc}"
        )

    # ---- Build the auto-login payload (mirrors /employee-login) ----
    auto_login = build_login_response(db, emp)

    auto_login["EMPLOYEE_ID"]   = emp.EMPLOYEE_CODE
    auto_login["EMPLOYEE_NAME"] = emp.NAME

    dept_name = None

    if emp.DEPARTMENT_ID:

        d = db.query(Department).filter(
            Department.ID == emp.DEPARTMENT_ID
        ).first()

        dept_name = d.NAME if d else None

    auto_login["DEPARTMENT"] = dept_name

    return {
        "message": "Registration complete. Welcome to the team!",
        "status": "APPROVED",
        "employee_id": emp.ID,
        "employee_code": emp.EMPLOYEE_CODE,
        "auto_login": auto_login,
    }


@router.get("/employee-onboarding/sessions", dependencies=[Depends(require("onboarding.sessions.view"))])
def admin_list_sessions(
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """List every onboarding session, newest first. Supports
    optional filtering by STATUS and a free-text search on
    name / email / phone / employee_code."""

    q = db.query(EmployeeOnboardingSession)

    if status:

        q = q.filter(EmployeeOnboardingSession.STATUS == status.upper())

    if search:

        like = f"%{search.strip()}%"

        q = q.filter(
            or_(
                EmployeeOnboardingSession.INVITED_NAME.ilike(like),
                EmployeeOnboardingSession.INVITED_EMAIL.ilike(like),
                EmployeeOnboardingSession.INVITED_PHONE.ilike(like),
                EmployeeOnboardingSession.EMPLOYEE_CODE.ilike(like),
            )
        )

    rows = q.order_by(EmployeeOnboardingSession.CREATED_AT.desc()).all()

    return [_serialize_for_admin_list(r) for r in rows]


@router.get("/employee-onboarding/sessions/{session_id}", dependencies=[Depends(require("onboarding.sessions.view"))])
def admin_get_session(
    session_id: int,
    db: Session = Depends(get_db)
):
    """Full detail — list row + collected_data + chat_history + notes."""

    s = _require_session_by_id(session_id, db)

    base = _serialize_for_admin_list(s)

    base["collected_data"] = _collected(s)

    base["chat_history"] = _chat_history(s)

    base["notes"] = s.NOTES

    base["current_field"] = s.CURRENT_FIELD

    return base


@router.patch("/employee-onboarding/sessions/{session_id}", dependencies=[Depends(require("onboarding.sessions.edit"))])
def admin_patch_session(
    session_id: int,
    body: SessionPatch,
    db: Session = Depends(get_db)
):
    """Admin override. Any keys in the body that aren't reserved meta
    (NOTES, EMPLOYEE_CODE, ORG) are stored into
    COLLECTED_DATA["__admin__"] so the original chat answers are
    preserved alongside the overrides."""

    s = _require_session_by_id(session_id, db)

    raw = body.model_dump(exclude_unset=True)

    # Pull out the reserved keys
    notes        = raw.pop("NOTES", None)
    employee_code = raw.pop("EMPLOYEE_CODE", None)
    org_block    = raw.pop("ORG", None)

    # Whatever's left is treated as a candidate-field override.
    collected = _collected(s)

    if raw:

        admin_overrides = collected.get("__admin__") or {}

        if not isinstance(admin_overrides, dict):

            admin_overrides = {}

        for k, v in raw.items():

            admin_overrides[k] = v

        collected["__admin__"] = admin_overrides

    # Org block also lives under __admin__ so the approval step can
    # find it in one place.
    if org_block is not None:

        admin_overrides = collected.get("__admin__") or {}

        if not isinstance(admin_overrides, dict):

            admin_overrides = {}

        org_dict = (
            org_block
            if isinstance(org_block, dict)
            else dict(org_block)
        )

        # Validate any time strings up front
        if org_dict.get("SHIFT_START") is not None:

            _parse_time(org_dict["SHIFT_START"])

        if org_dict.get("SHIFT_END") is not None:

            _parse_time(org_dict["SHIFT_END"])

        admin_overrides["ORG"] = org_dict

        collected["__admin__"] = admin_overrides

    _save_collected(s, collected)

    if notes is not None:

        s.NOTES = notes

    if employee_code is not None:

        s.EMPLOYEE_CODE = (employee_code or "").strip() or None

    try:

        db.commit()

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not save patch: {exc}"
        )

    return {
        "message": "Session updated",
        "session": _serialize_for_admin_list(s),
        "collected_data": _collected(s),
        "notes": s.NOTES,
    }


@router.post("/employee-onboarding/sessions/{session_id}/approve", dependencies=[Depends(require("onboarding.sessions.approve"))])
def admin_approve_session(
    session_id: int,
    body: Optional[ApproveBody] = None,
    db: Session = Depends(get_db)
):
    """Approve the session: validate the assembled payload against
    EmployeeCreate, then insert a real Employee row. On success,
    stamp APPROVED_AT + EMPLOYEE_ID."""

    s = _require_session_by_id(session_id, db)

    if s.STATUS == "APPROVED":

        raise HTTPException(
            status_code=400,
            detail="This session is already APPROVED."
        )

    if s.STATUS != "SUBMITTED":

        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot approve — session is {s.STATUS}. "
                "Only SUBMITTED sessions can be approved."
            )
        )

    collected = _collected(s)

    admin_block = collected.get("__admin__") or {}

    if not isinstance(admin_block, dict):

        admin_block = {}

    # Pull the org overrides — from the request body first, then
    # whatever the admin PATCHed earlier into __admin__["ORG"].
    org_overrides: Dict[str, Any] = {}

    if body and body.ORG:

        org_overrides = body.ORG.model_dump(exclude_unset=False)

    else:

        org_overrides = admin_block.get("ORG") or {}

    # Field-level admin overrides (e.g. NAME corrected by HR)
    field_overrides = {
        k: v for k, v in admin_block.items()
        if k not in ("ORG",)
    }

    # Pick the right EMPLOYEE_CODE: body > session field > collected
    chosen_code = None

    if body and body.EMPLOYEE_CODE:

        chosen_code = body.EMPLOYEE_CODE.strip()

    elif s.EMPLOYEE_CODE:

        chosen_code = s.EMPLOYEE_CODE.strip()

    elif field_overrides.get("EMPLOYEE_CODE"):

        chosen_code = str(field_overrides["EMPLOYEE_CODE"]).strip()

    elif collected.get("EMPLOYEE_CODE"):

        chosen_code = str(collected["EMPLOYEE_CODE"]).strip()

    if not chosen_code:

        raise HTTPException(
            status_code=400,
            detail=(
                "EMPLOYEE_CODE is required to approve. Either set it "
                "on the session or include it in the request body."
            )
        )

    # Helper to fetch a field's value with priority:
    #   field-level admin override > candidate-collected
    def _val(key: str, default: Any = None) -> Any:

        v = field_overrides.get(key)

        if v not in (None, ""):

            return v

        v = collected.get(key)

        if v in (None, ""):

            return default

        return v

    candidate_password = _val("PASSWORD")

    # In the new flow, the candidate's password was chosen by admin at
    # invite time and is already stored on session.PASSWORD_HASH. We
    # only need a plaintext stub here so the EmployeeCreate Pydantic
    # validator (which requires PASSWORD) passes — the real hash gets
    # copied straight onto Employee.PASSWORD below, bypassing rehash.
    if not candidate_password:

        candidate_password = secrets.token_urlsafe(10)

    # Resolve org assignment with a 2-stage fallback so the dropdowns
    # the admin picked at invite time aren't silently lost:
    #   1. HR's approval-time override (org_overrides) — highest priority
    #   2. The invite-time selection stored on the session itself
    #      (s.DEPARTMENT_ID / s.DESIGNATION_ID — see InviteEmployeeModal)
    final_department_id  = org_overrides.get("DEPARTMENT_ID")  or s.DEPARTMENT_ID
    final_designation_id = org_overrides.get("DESIGNATION_ID") or s.DESIGNATION_ID

    # Build the EmployeeCreate payload
    payload = {
        "EMPLOYEE_CODE": chosen_code,
        "NAME":          _val("NAME"),
        "EMAIL":         _val("EMAIL"),
        "PHONE":         _val("PHONE"),
        "PASSWORD":      candidate_password,
        "DEPARTMENT_ID": final_department_id,
        "DESIGNATION_ID": final_designation_id,
        "ROLE_ID":       org_overrides.get("ROLE_ID"),
        "REPORTING_MANAGER_ID": None,
        "JOINING_DATE":  None,
        "SALARY":        org_overrides.get("SALARY") or 0.0,
        "SHIFT_START":   _parse_time(org_overrides.get("SHIFT_START")),
        "SHIFT_END":     _parse_time(org_overrides.get("SHIFT_END")),
        "SKILLS":        _val("SKILLS"),
        "VENDOR_ID":     1,
        # Profile / resume fields
        "ADDRESS":            _val("ADDRESS"),
        "CITY":               _val("CITY"),
        "STATE":              _val("STATE"),
        "PINCODE":            _val("PINCODE"),
        "DOB":                _val("DOB"),
        "GENDER":             _val("GENDER"),
        "FATHER_NAME":        _val("FATHER_NAME"),
        "MOTHER_NAME":        _val("MOTHER_NAME"),
        "MARITAL_STATUS":     _val("MARITAL_STATUS"),
        "OCCUPATION":         _val("OCCUPATION"),
        "QUALIFICATION":      _val("QUALIFICATION"),
        "YEAR_OF_PASSING":    _val("YEAR_OF_PASSING"),
        "EXPERIENCE_YEARS":   _val("EXPERIENCE_YEARS") or 0.0,
        "EXPERIENCE_DETAILS": _val("EXPERIENCE_DETAILS"),
        "PAST_PROJECTS":      _val("PAST_PROJECTS"),
        "EMPLOYMENT_TYPE":    _val("EMPLOYMENT_TYPE"),
        "NOTES":              _val("NOTES"),
        # Phase A — HR Module expansion (candidate-collected)
        "BLOOD_GROUP":                _val("BLOOD_GROUP"),
        "NATIONALITY":                _val("NATIONALITY"),
        "EMERGENCY_CONTACT_NAME":     _val("EMERGENCY_CONTACT_NAME"),
        "EMERGENCY_CONTACT_PHONE":    _val("EMERGENCY_CONTACT_PHONE"),
        "EMERGENCY_CONTACT_RELATION": _val("EMERGENCY_CONTACT_RELATION"),
        "WORK_LOCATION":              _val("WORK_LOCATION"),
        "COLLEGE":                    _val("COLLEGE"),
        "UNIVERSITY":                 _val("UNIVERSITY"),
        "PERCENTAGE":                 _val("PERCENTAGE"),
        "PREVIOUS_COMPANY":           _val("PREVIOUS_COMPANY"),
        "PREVIOUS_SALARY":            _val("PREVIOUS_SALARY"),
        "BANK_ACCOUNT_NUMBER":        _val("BANK_ACCOUNT_NUMBER"),
        "BANK_NAME":                  _val("BANK_NAME"),
        "IFSC_CODE":                  _val("IFSC_CODE"),
        "PAN_NUMBER":                 _val("PAN_NUMBER"),
        "AADHAAR_NUMBER":             _val("AADHAAR_NUMBER"),
        # CONFIRMATION_DATE is admin-only; can be set from org overrides
        "CONFIRMATION_DATE":  org_overrides.get("CONFIRMATION_DATE"),
    }

    # Validate via Pydantic — raises 422 if a required field
    # (e.g. ROLE_ID) is missing.
    try:

        emp_in = EmployeeCreate(**payload)

    except Exception as exc:

        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve — payload invalid: {exc}"
        )

    # ---- Duplicate-key guards (mirrors employee.create_employee) ----
    if db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == emp_in.EMPLOYEE_CODE.upper()
    ).first():

        s.REJECT_REASON = (
            f"Employee code '{emp_in.EMPLOYEE_CODE}' already exists."
        )

        try:

            db.commit()

        except Exception:

            db.rollback()

        raise HTTPException(
            status_code=400,
            detail=s.REJECT_REASON
        )

    if emp_in.EMAIL and db.query(Employee).filter(
        Employee.EMAIL == emp_in.EMAIL
    ).first():

        s.REJECT_REASON = (
            "An employee with this email already exists."
        )

        try:

            db.commit()

        except Exception:

            db.rollback()

        raise HTTPException(
            status_code=400,
            detail=s.REJECT_REASON
        )

    # ---- Build the Employee row ----
    # If the candidate's password was chosen by admin at invite time
    # and stored on session.PASSWORD_HASH, copy that exact hash onto
    # Employee.PASSWORD so the candidate's chosen-at-invite password
    # keeps working after approval. Otherwise (legacy sessions) we
    # bcrypt the value from emp_in.PASSWORD.
    if s.PASSWORD_HASH:

        final_password_hash = s.PASSWORD_HASH

    else:

        final_password_hash = hash_password(emp_in.PASSWORD)

    emp = Employee(
        EMPLOYEE_CODE=emp_in.EMPLOYEE_CODE.upper(),
        NAME=emp_in.NAME,
        EMAIL=emp_in.EMAIL,
        PHONE=emp_in.PHONE,
        PASSWORD=final_password_hash,
        DEPARTMENT_ID=emp_in.DEPARTMENT_ID,
        DESIGNATION_ID=emp_in.DESIGNATION_ID,
        ROLE_ID=emp_in.ROLE_ID,
        REPORTING_MANAGER_ID=emp_in.REPORTING_MANAGER_ID,
        JOINING_DATE=emp_in.JOINING_DATE,
        SALARY=emp_in.SALARY or 0.0,
        SHIFT_START=emp_in.SHIFT_START,
        SHIFT_END=emp_in.SHIFT_END,
        SKILLS=emp_in.SKILLS,
        STATUS="ACTIVE",
        VENDOR_ID=emp_in.VENDOR_ID,
        ADDRESS=emp_in.ADDRESS,
        CITY=emp_in.CITY,
        STATE=emp_in.STATE,
        PINCODE=emp_in.PINCODE,
        DOB=emp_in.DOB,
        GENDER=emp_in.GENDER,
        FATHER_NAME=emp_in.FATHER_NAME,
        MOTHER_NAME=emp_in.MOTHER_NAME,
        MARITAL_STATUS=emp_in.MARITAL_STATUS,
        OCCUPATION=emp_in.OCCUPATION,
        QUALIFICATION=emp_in.QUALIFICATION,
        YEAR_OF_PASSING=emp_in.YEAR_OF_PASSING,
        EXPERIENCE_YEARS=emp_in.EXPERIENCE_YEARS or 0.0,
        EXPERIENCE_DETAILS=emp_in.EXPERIENCE_DETAILS,
        PAST_PROJECTS=emp_in.PAST_PROJECTS,
        EMPLOYMENT_TYPE=emp_in.EMPLOYMENT_TYPE,
        NOTES=emp_in.NOTES,
        PHOTO_URL=s.PHOTO_URL,
        PROFILE_SUBMITTED=1,
        # Phase A — HR Module expansion
        BLOOD_GROUP=emp_in.BLOOD_GROUP,
        NATIONALITY=emp_in.NATIONALITY,
        EMERGENCY_CONTACT_NAME=emp_in.EMERGENCY_CONTACT_NAME,
        EMERGENCY_CONTACT_PHONE=emp_in.EMERGENCY_CONTACT_PHONE,
        EMERGENCY_CONTACT_RELATION=emp_in.EMERGENCY_CONTACT_RELATION,
        CONFIRMATION_DATE=emp_in.CONFIRMATION_DATE,
        WORK_LOCATION=emp_in.WORK_LOCATION,
        COLLEGE=emp_in.COLLEGE,
        UNIVERSITY=emp_in.UNIVERSITY,
        PERCENTAGE=emp_in.PERCENTAGE,
        PREVIOUS_COMPANY=emp_in.PREVIOUS_COMPANY,
        PREVIOUS_SALARY=emp_in.PREVIOUS_SALARY,
        BANK_ACCOUNT_NUMBER=emp_in.BANK_ACCOUNT_NUMBER,
        BANK_NAME=emp_in.BANK_NAME,
        IFSC_CODE=emp_in.IFSC_CODE,
        PAN_NUMBER=emp_in.PAN_NUMBER,
        AADHAAR_NUMBER=emp_in.AADHAAR_NUMBER,
    )

    db.add(emp)

    try:

        db.flush()  # surface IntegrityError before we touch the session

    except IntegrityError as e:

        db.rollback()

        raw = str(getattr(e, "orig", e))

        s.REJECT_REASON = f"Database rejected the record: {raw[:200]}"

        try:

            db.commit()

        except Exception:

            db.rollback()

        raise HTTPException(
            status_code=400,
            detail=s.REJECT_REASON
        )

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not create employee: {exc}"
        )

    # Mark the session as APPROVED + link to the new Employee
    s.EMPLOYEE_ID  = emp.ID

    s.STATUS       = "APPROVED"

    s.APPROVED_AT  = _utcnow()

    s.EMPLOYEE_CODE = emp.EMPLOYEE_CODE

    s.REJECT_REASON = None

    # APPROVED_BY_ID — set if we ever wire admin auth into this MVP
    # endpoint; for now leave NULL.

    try:

        db.commit()

        db.refresh(emp)

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not finalize approval: {exc}"
        )

    return {
        "message": (
            f"Employee {emp.NAME} ({emp.EMPLOYEE_CODE}) created and "
            "onboarding approved."
        ),
        "employee_id": emp.ID,
        "employee_code": emp.EMPLOYEE_CODE,
        "session": _serialize_for_admin_list(s),
    }


@router.post("/employee-onboarding/sessions/{session_id}/reject", dependencies=[Depends(require("onboarding.sessions.reject"))])
def admin_reject_session(
    session_id: int,
    body: RejectBody,
    db: Session = Depends(get_db)
):
    """Reject a session — sets STATUS=REJECTED + REJECT_REASON."""

    s = _require_session_by_id(session_id, db)

    if s.STATUS == "APPROVED":

        raise HTTPException(
            status_code=400,
            detail=(
                "This session is already APPROVED. Delete the linked "
                "employee first if you need to undo the approval."
            )
        )

    s.STATUS = "REJECTED"

    s.REJECT_REASON = body.reason.strip()[:500]

    try:

        db.commit()

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not reject: {exc}"
        )

    return {
        "message": "Session rejected.",
        "session": _serialize_for_admin_list(s),
    }


@router.delete("/employee-onboarding/sessions/{session_id}", dependencies=[Depends(require("onboarding.sessions.delete"))])
def admin_delete_session(
    session_id: int,
    db: Session = Depends(get_db)
):
    """Delete an onboarding session + its photo file. Refuses if
    STATUS=APPROVED — the admin must delete the Employee row first."""

    s = _require_session_by_id(session_id, db)

    # Refuse only when the session still points to a live Employee row.
    # Once the employee has been deleted (EMPLOYEE_ID nulled), the
    # session is orphaned audit data and the admin should be able to
    # remove it.
    if s.STATUS == "APPROVED" and s.EMPLOYEE_ID:

        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot delete an APPROVED onboarding session while the "
                "linked Employee still exists. Delete the employee first, "
                "then this session can be removed."
            )
        )

    photo_url = s.PHOTO_URL

    try:

        db.delete(s)

        db.commit()

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not delete session: {exc}"
        )

    # Clean up the photo file (best-effort)
    photo_removed = False

    if photo_url:

        try:

            fname = photo_url.rsplit("/", 1)[-1]

            fpath = _STATIC_DIR / fname

            if fpath.exists() and fpath.is_file():

                fpath.unlink()

                photo_removed = True

        except Exception:

            pass

    return {
        "message": "Onboarding session deleted.",
        "photo_removed": photo_removed,
    }


@router.post("/employee-onboarding/sessions/{session_id}/resend-link", dependencies=[Depends(require("onboarding.sessions.resend"))])
def admin_resend_link(
    session_id: int,
    request: Request,
    expires_in_days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db)
):
    """Generate a fresh TOKEN (old link is now dead) + extend
    EXPIRES_AT. Useful when the original link has lapsed and the
    admin wants to give the candidate another chance without
    re-keying their hint fields."""

    s = _require_session_by_id(session_id, db)

    if s.STATUS == "APPROVED":

        raise HTTPException(
            status_code=400,
            detail="Cannot resend — this session is already APPROVED."
        )

    new_token = _gen_token()

    if db.query(EmployeeOnboardingSession).filter(
        EmployeeOnboardingSession.TOKEN == new_token
    ).first():

        new_token = _gen_token()

    s.TOKEN = new_token

    s.EXPIRES_AT = _utcnow() + timedelta(days=expires_in_days)

    # If the session was EXPIRED, reopen it so the new link works.
    if s.STATUS in ("EXPIRED", "REJECTED"):

        s.STATUS = "OPEN"

        s.REJECT_REASON = None

    try:

        db.commit()

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Could not resend link: {exc}"
        )

    invite_link = f"{_frontend_base_url(request)}/employee-onboarding/{new_token}"

    return {
        "message": "New invite link generated.",
        "token": new_token,
        "invite_link": invite_link,
        "expires_at": s.EXPIRES_AT.isoformat() if s.EXPIRES_AT else None,
        "status": s.STATUS,
    }
