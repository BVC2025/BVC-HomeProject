"""
Customer Self-Onboarding Portal — backend routes.

Public endpoints (no auth):
  POST /onboarding/{token}/register     Customer sets username + pw
  POST /onboarding/{token}/login        Customer signs in
  GET  /onboarding/{token}              Public session info (status)

Portal-authenticated (Authorization: Bearer <SESSION_KEY>):
  GET  /onboarding/{token}/state        Partial data + progress
  GET  /onboarding/{token}/history      Chat transcript
  POST /onboarding/{token}/chat         Send a chat message, get reply
  POST /onboarding/{token}/submit       Finalise → creates Customer row

Admin endpoints (require admin JWT — same as the rest of the app):
  POST /onboarding/invite               Generate a new invitation
  GET  /onboarding/sessions             List all sessions
  GET  /onboarding/{token}/admin-view   Full session + chat for admin
  POST /onboarding/{token}/reopen       Allow customer to edit again
"""

import json
import os
import secrets
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Customer,
    CustomerOnboardingSession,
    CustomerPortalUser,
    CustomerChatMessage
)

from app.schemas.onboarding_schema import (
    OnboardingInviteCreate,
    PortalRegister,
    PortalLogin,
    PortalChatMessage,
    OnboardingSubmit
)

import bcrypt

from app.services.auth_service import hash_password, verify_password
from app.services import onboarding_ai_service as ai


router = APIRouter()


# Wrap bcrypt directly — passlib's CryptContext crashes on the
# "wrap-bug" probe with bcrypt >= 4.x. The rest of the app already
# uses bcrypt directly (see services/auth_service.py); we follow the
# same pattern here for portal accounts.

def _portal_hash(plain: str) -> str:

    return bcrypt.hashpw(
        plain.encode("utf-8")[:72],   # bcrypt's hard 72-byte limit
        bcrypt.gensalt(rounds=4)
    ).decode("utf-8")


def _portal_verify(plain: str, hashed: str) -> bool:

    if not hashed:

        return False

    try:

        return bcrypt.checkpw(
            plain.encode("utf-8")[:72],
            hashed.encode("utf-8")
        )

    except Exception:

        return False


# =========================
# Helpers
# =========================

def _gen_token(n: int = 24) -> str:

    return secrets.token_urlsafe(n)


def _serialize_session(s: CustomerOnboardingSession) -> dict:

    return {
        "ID": s.ID,
        "TOKEN": s.TOKEN,
        "STATUS": s.STATUS,
        "NAME_HINT": s.NAME_HINT,
        "EMAIL_HINT": s.EMAIL_HINT,
        "INVITED_BY_ID": s.INVITED_BY_ID,
        "PROGRESS_PCT": s.PROGRESS_PCT or 0,
        "NEXT_FIELD_HINT": s.NEXT_FIELD_HINT,
        "CUSTOMER_ID": s.CUSTOMER_ID,
        "VENDOR_ID": s.VENDOR_ID,
        "CREATED_AT": s.CREATED_AT.isoformat() if s.CREATED_AT else None,
        "REGISTERED_AT": s.REGISTERED_AT.isoformat() if s.REGISTERED_AT else None,
        "LAST_ACTIVITY_AT": s.LAST_ACTIVITY_AT.isoformat() if s.LAST_ACTIVITY_AT else None,
        "SUBMITTED_AT": s.SUBMITTED_AT.isoformat() if s.SUBMITTED_AT else None
    }


def _partial(session: CustomerOnboardingSession) -> dict:

    if not session.PARTIAL_DATA:

        return {}

    try:

        return json.loads(session.PARTIAL_DATA)

    except Exception:

        return {}


def _public_partial(session: CustomerOnboardingSession) -> dict:
    """Same as _partial but strips reserved internal keys (e.g.
    __skipped__) before exposing to the client. The UI shouldn't
    render __skipped__ as a Collected entry."""

    p = _partial(session)

    p.pop(ai.SKIPPED_KEY, None)

    return p


# (The customer welcome email helper was intentionally removed —
# only the MD/company inbox receives a registration notification.
# The MD then owns the follow-up channel to the customer.)


def _save_partial(session: CustomerOnboardingSession, data: dict) -> None:

    session.PARTIAL_DATA = json.dumps(data, default=str)

    session.PROGRESS_PCT = ai.compute_progress(data)

    session.LAST_ACTIVITY_AT = datetime.utcnow()

    if session.STATUS == "REGISTERED":

        session.STATUS = "IN_PROGRESS"


def _require_session(
    token: str,
    db: Session,
    allow_submitted: bool = False
) -> CustomerOnboardingSession:

    s = db.query(CustomerOnboardingSession).filter(
        CustomerOnboardingSession.TOKEN == token
    ).first()

    if not s:

        raise HTTPException(status_code=404, detail="Invitation link not found")

    if not allow_submitted and s.STATUS == "SUBMITTED":

        raise HTTPException(
            status_code=403,
            detail="This profile has already been submitted."
        )

    return s


def _require_portal_user(
    session: CustomerOnboardingSession,
    session_key: Optional[str],
    db: Session
) -> CustomerPortalUser:
    """Validate the Authorization header against the portal user's
    SESSION_KEY. Returns the user or raises 401."""

    if not session_key:

        raise HTTPException(
            status_code=401,
            detail="Missing portal session key"
        )

    # Header format we accept: "Bearer <key>" OR raw "<key>"
    if session_key.lower().startswith("bearer "):

        session_key = session_key.split(" ", 1)[1].strip()

    user = db.query(CustomerPortalUser).filter(
        CustomerPortalUser.SESSION_ID == session.ID
    ).first()

    if not user or user.SESSION_KEY != session_key:

        raise HTTPException(
            status_code=401,
            detail="Invalid or expired portal session — please log in again."
        )

    return user


# =========================
# ADMIN — generate invite, list sessions
# =========================

@router.post("/onboarding/invite")
def create_invite(
    data: OnboardingInviteCreate,
    db: Session = Depends(get_db)
):
    """Admin generates a new invitation link. Returns the token and
    the full portal URL the admin can copy and share with the
    customer (via WhatsApp, email, etc.)."""

    token = _gen_token()

    # Should be unique — retry once if a collision somehow occurs
    if db.query(CustomerOnboardingSession).filter(
        CustomerOnboardingSession.TOKEN == token
    ).first():

        token = _gen_token()

    session = CustomerOnboardingSession(
        TOKEN=token,
        STATUS="INVITED",
        NAME_HINT=(data.NAME_HINT or "").strip() or None,
        EMAIL_HINT=(data.EMAIL_HINT or "").strip() or None,
        INVITED_BY_ID=data.INVITED_BY_ID,
        PARTIAL_DATA=json.dumps({}),
        PROGRESS_PCT=0,
        VENDOR_ID=data.VENDOR_ID or 1
    )

    db.add(session)

    db.commit()

    db.refresh(session)

    # Public portal URL — frontend reads its own host
    frontend_base = (
        os.getenv("FRONTEND_BASE_URL")
        or os.getenv("FRONTEND_URL")
        or "http://localhost:5173"
    ).rstrip("/")

    portal_url = f"{frontend_base}/portal/onboarding/{token}"

    # Best-effort invitation email (non-blocking)
    email_sent = False

    email_message = "no recipient"

    if session.EMAIL_HINT:

        try:

            from app.services.email_service import send_alert_email

            html = f"""
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#C8102E,#8B0B1F);color:white;padding:24px 28px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;opacity:0.9;">BVC24 · CUSTOMER ONBOARDING</div>
      <h1 style="margin:6px 0 0;font-size:22px;">Welcome to Bharath Vending Corporation</h1>
    </div>
    <div style="padding:26px 28px;color:#0f172a;line-height:1.55;">
      <p>Hello{' ' + session.NAME_HINT if session.NAME_HINT else ''},</p>
      <p>You've been invited to set up your customer profile on the BVC24 portal. Our AI assistant will walk you through a short conversation to collect your details — it takes about 5 minutes.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="{portal_url}" style="display:inline-block;background:linear-gradient(135deg,#C8102E,#8B0B1F);color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;">Start Onboarding</a>
      </p>
      <p style="font-size:12px;color:#64748b;">Or copy this link into your browser:<br><span style="word-break:break-all;color:#C8102E;">{portal_url}</span></p>
      <p style="margin-top:24px;">Warm regards,<br><b>BVC24 Sales Team</b></p>
    </div>
    <div style="background:#f8fafc;padding:14px 28px;font-size:11px;color:#94a3b8;text-align:center;">
      Bharath Vending Corporation · Chennai, Tamil Nadu · www.bvc24.in
    </div>
  </div>
</body>
</html>
"""

            subject = "Your BVC24 Customer Onboarding Link"

            email_sent, email_message = send_alert_email(
                subject, html, recipient=session.EMAIL_HINT
            )

        except Exception as exc:

            email_message = f"email skipped: {exc}"

    return {
        "message": "Onboarding invite created",
        "session": _serialize_session(session),
        "portal_url": portal_url,
        "email_sent": email_sent,
        "email_message": email_message
    }


@router.get("/onboarding/_diagnose")
def diagnose():
    """Quick health probe for the onboarding AI engine. Lets an
    admin verify Gemini is actually being used (vs. silently falling
    back to the rule-based bot)."""

    import os

    import time

    gemini_configured = ai.is_gemini_configured()

    gemini_key_present = bool((os.getenv("GEMINI_API_KEY") or "").strip())

    configured_model = (os.getenv("GEMINI_MODEL") or "").strip() or "(auto)"

    out = {
        "gemini_configured": gemini_configured,
        "gemini_key_present": gemini_key_present,
        "configured_model": configured_model,
        "model_fallback_chain": ai.GEMINI_MODEL_FALLBACKS,
        "field_count": len(ai.all_keys()),
        "required_count": len(ai.required_keys())
    }

    if not gemini_configured:

        out["status"] = "rule_based_only"

        out["note"] = (
            "GEMINI_API_KEY is not set. The bot will run on the "
            "deterministic rule-based engine. To enable Gemini, "
            "add GEMINI_API_KEY to backend/.env and restart."
        )

        return out

    started = time.time()

    try:

        result = ai._gemini_chat({}, [], "Hi")

        out["status"] = "ok"

        out["latency_ms"] = int((time.time() - started) * 1000)

        out["model_used"] = result.get("_gemini_model")

        out["sample_reply"] = (result.get("reply") or "")[:160]

        out["sample_next_field"] = result.get("next_field")

    except Exception as exc:

        msg = str(exc)

        out["status"] = "gemini_error"

        out["error"] = msg[:400]

        # Friendly hints based on the kind of error
        if ai._is_quota_error(exc):

            out["error_kind"] = "quota_exceeded"

            out["note"] = (
                "All Gemini models in the fallback chain hit their free-tier "
                "quota for today. Quotas reset at midnight Pacific time. "
                "If you need higher throughput now, enable billing on the "
                "Google AI Studio key at https://aistudio.google.com/apikey "
                "or wait for the reset. The onboarding chatbot keeps working "
                "in deterministic mode in the meantime."
            )

        elif "model" in msg.lower() and ("not found" in msg.lower() or "404" in msg):

            out["error_kind"] = "bad_model_name"

            out["note"] = (
                "The model name isn't recognised by the API. Either remove "
                "GEMINI_MODEL from .env (we'll auto-pick) or set it to one "
                "of: " + ", ".join(ai.GEMINI_MODEL_FALLBACKS)
            )

        elif "api_key" in msg.lower() or "permission" in msg.lower() or "401" in msg or "403" in msg:

            out["error_kind"] = "auth_failed"

            out["note"] = (
                "The API key was rejected. Get a fresh key at "
                "https://aistudio.google.com/apikey and replace GEMINI_API_KEY "
                "in backend/.env."
            )

        else:

            out["error_kind"] = "unknown"

            out["note"] = (
                "Unexpected error from the Gemini API. Check your network "
                "access to generativelanguage.googleapis.com and the model "
                "name in GEMINI_MODEL."
            )

    return out


@router.get("/onboarding/sessions")
def list_sessions(
    status: Optional[str] = None,
    vendor_id: Optional[int] = None,
    db: Session = Depends(get_db)
):

    q = db.query(CustomerOnboardingSession)

    if status:

        q = q.filter(CustomerOnboardingSession.STATUS == status.upper())

    if vendor_id:

        q = q.filter(CustomerOnboardingSession.VENDOR_ID == vendor_id)

    rows = q.order_by(
        CustomerOnboardingSession.CREATED_AT.desc()
    ).all()

    out = []

    for r in rows:

        row = _serialize_session(r)

        # Compute pending count + display name from the partial data
        partial = _partial(r)

        row["PENDING_COUNT"] = len(ai.pending_fields(partial))

        row["DISPLAY_NAME"] = (
            partial.get("CUSTOMER_NAME")
            or r.NAME_HINT
            or "(unnamed)"
        )

        out.append(row)

    return out


@router.get("/onboarding/{token}/admin-view")
def admin_view(token: str, db: Session = Depends(get_db)):
    """Full session detail + chat history for the admin UI."""

    s = _require_session(token, db, allow_submitted=True)

    chat = db.query(CustomerChatMessage).filter(
        CustomerChatMessage.SESSION_ID == s.ID
    ).order_by(CustomerChatMessage.CREATED_AT).all()

    return {
        "session": _serialize_session(s),
        "partial_data": _partial(s),
        "chat": [
            {
                "ID": c.ID,
                "ROLE": c.ROLE,
                "CONTENT": c.CONTENT,
                "FIELD_KEY": c.FIELD_KEY,
                "EXTRACTED_FIELDS": (
                    json.loads(c.EXTRACTED_FIELDS)
                    if c.EXTRACTED_FIELDS else None
                ),
                "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None
            }
            for c in chat
        ]
    }


@router.post("/onboarding/{token}/reopen")
def reopen_session(token: str, db: Session = Depends(get_db)):
    """Admin reopens a SUBMITTED session for corrections."""

    s = _require_session(token, db, allow_submitted=True)

    if s.STATUS != "SUBMITTED":

        raise HTTPException(
            status_code=400,
            detail=f"Cannot reopen — session is {s.STATUS}"
        )

    s.STATUS = "IN_PROGRESS"

    s.SUBMITTED_AT = None

    s.LAST_ACTIVITY_AT = datetime.utcnow()

    db.commit()

    return {
        "message": "Onboarding reopened for the customer",
        "session": _serialize_session(s)
    }


@router.delete("/onboarding/sessions/{token}")
def delete_session(
    token: str,
    db: Session = Depends(get_db)
):
    """Admin deletes an onboarding invitation. Removes the session,
    the portal user account, and the full chat transcript. If the
    session already created a Customer row (SUBMITTED), that Customer
    is preserved — use the Customers page to delete that separately.
    """

    s = db.query(CustomerOnboardingSession).filter(
        CustomerOnboardingSession.TOKEN == token
    ).first()

    if not s:

        raise HTTPException(
            status_code=404,
            detail="Onboarding invitation not found"
        )

    name_hint = s.NAME_HINT or "(unnamed)"

    status = s.STATUS

    customer_id = s.CUSTOMER_ID

    # Order matters — children before parent to avoid FK errors.
    chat_deleted = db.query(CustomerChatMessage).filter(
        CustomerChatMessage.SESSION_ID == s.ID
    ).delete(synchronize_session=False)

    user_deleted = db.query(CustomerPortalUser).filter(
        CustomerPortalUser.SESSION_ID == s.ID
    ).delete(synchronize_session=False)

    db.delete(s)

    db.commit()

    return {
        "message": (
            f"Onboarding invitation for '{name_hint}' deleted "
            f"({chat_deleted} chat message(s) and "
            f"{user_deleted} portal account removed)."
        ),
        "name_hint": name_hint,
        "previous_status": status,
        "customer_preserved": bool(customer_id),
        "customer_id": customer_id
    }


# =========================
# PUBLIC — customer portal entry
# =========================

@router.get("/onboarding/{token}")
def get_public_session(token: str, db: Session = Depends(get_db)):
    """Lightweight public lookup: does this token exist, and what
    state is it in? Returned before the customer is logged in so the
    portal page knows whether to show the registration form or the
    login form."""

    s = db.query(CustomerOnboardingSession).filter(
        CustomerOnboardingSession.TOKEN == token
    ).first()

    if not s:

        raise HTTPException(status_code=404, detail="Invitation not found")

    # Has the customer already created a portal account?
    has_account = db.query(CustomerPortalUser).filter(
        CustomerPortalUser.SESSION_ID == s.ID
    ).first() is not None

    return {
        "TOKEN": s.TOKEN,
        "STATUS": s.STATUS,
        "NAME_HINT": s.NAME_HINT,
        "PROGRESS_PCT": s.PROGRESS_PCT or 0,
        "HAS_ACCOUNT": has_account,
        "SUBMITTED": s.STATUS == "SUBMITTED"
    }


@router.post("/onboarding/{token}/register")
def portal_register(
    token: str,
    data: PortalRegister,
    db: Session = Depends(get_db)
):
    """Customer creates their portal username + password. Returns
    a SESSION_KEY the portal client stores in localStorage and
    sends as Authorization: Bearer <key> on subsequent calls."""

    s = _require_session(token, db)

    if data.PASSWORD != data.CONFIRM_PASSWORD:

        raise HTTPException(
            status_code=400,
            detail="Password and confirm password do not match"
        )

    if len(data.PASSWORD) < 6:

        raise HTTPException(
            status_code=400,
            detail="Password must be at least 6 characters"
        )

    if db.query(CustomerPortalUser).filter(
        CustomerPortalUser.SESSION_ID == s.ID
    ).first():

        raise HTTPException(
            status_code=400,
            detail="An account already exists for this link — please log in instead."
        )

    user = CustomerPortalUser(
        SESSION_ID=s.ID,
        USERNAME=data.USERNAME.strip(),
        PASSWORD=_portal_hash(data.PASSWORD),
        SESSION_KEY=_gen_token(16),
        LAST_LOGIN_AT=datetime.utcnow()
    )

    db.add(user)

    if s.STATUS == "INVITED":

        s.STATUS = "REGISTERED"

    s.REGISTERED_AT = datetime.utcnow()

    s.LAST_ACTIVITY_AT = datetime.utcnow()

    db.commit()

    db.refresh(user)

    return {
        "message": "Account created",
        "session_key": user.SESSION_KEY,
        "username": user.USERNAME,
        "progress_pct": s.PROGRESS_PCT or 0,
        "status": s.STATUS
    }


@router.post("/onboarding/{token}/login")
def portal_login(
    token: str,
    data: PortalLogin,
    db: Session = Depends(get_db)
):
    """Customer logs back in to resume a session."""

    s = _require_session(token, db, allow_submitted=True)

    user = db.query(CustomerPortalUser).filter(
        CustomerPortalUser.SESSION_ID == s.ID,
        CustomerPortalUser.USERNAME == data.USERNAME.strip()
    ).first()

    if not user or not _portal_verify(data.PASSWORD, user.PASSWORD):

        raise HTTPException(
            status_code=401,
            detail="Invalid username or password"
        )

    user.SESSION_KEY = _gen_token(16)

    user.LAST_LOGIN_AT = datetime.utcnow()

    s.LAST_ACTIVITY_AT = datetime.utcnow()

    db.commit()

    return {
        "message": "Login successful",
        "session_key": user.SESSION_KEY,
        "username": user.USERNAME,
        "progress_pct": s.PROGRESS_PCT or 0,
        "status": s.STATUS
    }


# =========================
# PORTAL — authenticated chat
# =========================

@router.get("/onboarding/{token}/state")
def get_portal_state(
    token: str,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Returns the partial data + progress + next field. The portal
    UI calls this when the customer opens the chat page."""

    s = _require_session(token, db, allow_submitted=True)

    _require_portal_user(s, authorization, db)

    partial = _partial(s)

    pending = ai.pending_fields(partial)

    nxt = ai.first_unfilled_field(partial)

    # `partial` here is what the AI sees (includes __skipped__);
    # the response uses `_public_partial(s)` to hide internals
    return {
        "status": s.STATUS,
        "progress_pct": ai.compute_progress(partial),
        "partial": _public_partial(s),
        "total_fields": len(ai.all_keys()),
        "filled_count": len(ai.all_keys()) - len(pending),
        "required_fields": ai.required_keys(),
        "missing_required": ai.missing_required(partial),
        "pending": pending,
        "pending_count": len(pending),
        "next_field": nxt["key"] if nxt else None,
        "next_widget": ai.widget_for(nxt["key"] if nxt else None),
        "submitted": s.STATUS == "SUBMITTED",
        "customer_id": s.CUSTOMER_ID
    }


@router.get("/onboarding/{token}/history")
def get_chat_history(
    token: str,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):

    s = _require_session(token, db, allow_submitted=True)

    _require_portal_user(s, authorization, db)

    rows = db.query(CustomerChatMessage).filter(
        CustomerChatMessage.SESSION_ID == s.ID
    ).order_by(CustomerChatMessage.CREATED_AT).all()

    history = [
        {
            "ROLE": c.ROLE,
            "CONTENT": c.CONTENT,
            "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None
        }
        for c in rows
    ]

    # If there's no history yet, seed the opening assistant message
    if not history:

        opener = ai.opening_message(_partial(s))

        db.add(CustomerChatMessage(
            SESSION_ID=s.ID,
            ROLE="assistant",
            CONTENT=opener
        ))

        db.commit()

        history = [{
            "ROLE": "assistant",
            "CONTENT": opener,
            "CREATED_AT": datetime.utcnow().isoformat()
        }]

    return {"history": history}


@router.post("/onboarding/{token}/chat")
def portal_chat(
    token: str,
    data: PortalChatMessage,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """The main chat endpoint — receives a customer message, calls
    Gemini, merges any extracted fields into PARTIAL_DATA, persists,
    and returns the assistant reply + updated progress."""

    s = _require_session(token, db)

    _require_portal_user(s, authorization, db)

    # Persist the user's message
    db.add(CustomerChatMessage(
        SESSION_ID=s.ID,
        ROLE="user",
        CONTENT=data.MESSAGE
    ))

    partial = _partial(s)

    # ---- Deterministic skip short-circuit ----------------------
    # When the customer clicks the "Skip" button on a widget, the
    # frontend sends `SKIP_FIELD=<the field that was being asked>`.
    # We mark that field as skipped DIRECTLY (no AI call) and ask
    # the next pending question via the rule-based picker. This
    # guarantees Gemini can never re-ask a skipped field even if
    # its response drifts.
    skip_target = (data.SKIP_FIELD or "").strip() or None

    if skip_target and ai.field_meta(skip_target):

        ai.mark_skipped(partial, skip_target)

        _save_partial(s, partial)

        nxt = ai.first_unfilled_field(partial)

        if nxt is None:

            if ai.missing_required(partial):

                reply = (
                    "Thanks! You can submit your profile any time, "
                    "or let me know which detail you'd like to add."
                )

                complete = False

            else:

                reply = (
                    "Excellent — we have everything we need. "
                    "Please click *Submit Details* whenever you're ready."
                )

                complete = True

            next_field = None

        else:

            reply = "No problem, we can update that later. " + nxt["question"]

            next_field = nxt["key"]

            complete = False

        s.NEXT_FIELD_HINT = next_field

        db.add(CustomerChatMessage(
            SESSION_ID=s.ID,
            ROLE="assistant",
            CONTENT=reply,
            FIELD_KEY=next_field,
            EXTRACTED_FIELDS=json.dumps({ai.SKIPPED_KEY: [skip_target]})
        ))

        db.commit()

        pending = ai.pending_fields(partial)

        return {
            "reply": reply,
            "extracted": {},
            "next_field": next_field,
            "next_widget": ai.widget_for(next_field),
            "complete": complete,
            "progress_pct": s.PROGRESS_PCT or 0,
            "total_fields": len(ai.all_keys()),
            "filled_count": len(ai.all_keys()) - len(pending),
            "partial": _public_partial(s),
            "pending": pending,
            "pending_count": len(pending),
            "missing_required": ai.missing_required(partial)
        }

    # ---- Normal AI-driven turn --------------------------------
    # Load recent history (last 20 turns) for context
    recent = db.query(CustomerChatMessage).filter(
        CustomerChatMessage.SESSION_ID == s.ID
    ).order_by(CustomerChatMessage.CREATED_AT.desc()).limit(20).all()

    history = [
        {"role": c.ROLE, "content": c.CONTENT}
        for c in reversed(recent)
    ]

    result = ai.process_turn(partial, history, data.MESSAGE)

    extracted = result.get("extracted") or {}

    # Merge into partial + persist. The reserved __skipped__ key is a
    # LIST — we union it with any existing skipped list rather than
    # overwriting (otherwise each new skip would clobber the prior
    # ones and the AI would forget them).
    if extracted:

        new_skips = extracted.pop(ai.SKIPPED_KEY, None)

        partial.update(extracted)

        if new_skips:

            for k in new_skips:

                ai.mark_skipped(partial, k)

        _save_partial(s, partial)

    else:

        # Still update last-activity even without new data
        s.LAST_ACTIVITY_AT = datetime.utcnow()

        if s.STATUS == "REGISTERED":

            s.STATUS = "IN_PROGRESS"

    s.NEXT_FIELD_HINT = result.get("next_field")

    db.add(CustomerChatMessage(
        SESSION_ID=s.ID,
        ROLE="assistant",
        CONTENT=result.get("reply", ""),
        FIELD_KEY=result.get("next_field"),
        EXTRACTED_FIELDS=(
            json.dumps(extracted) if extracted else None
        )
    ))

    db.commit()

    next_field = result.get("next_field")

    pending = ai.pending_fields(partial)

    return {
        "reply": result.get("reply", ""),
        "extracted": extracted,
        "next_field": next_field,
        "next_widget": ai.widget_for(next_field),
        "complete": result.get("complete", False),
        "progress_pct": s.PROGRESS_PCT or 0,
        "total_fields": len(ai.all_keys()),
        "filled_count": len(ai.all_keys()) - len(pending),
        "partial": _public_partial(s),
        "pending": pending,
        "pending_count": len(pending),
        "missing_required": ai.missing_required(partial),
        "_engine": result.get("_engine")
    }


@router.post("/onboarding/{token}/submit")
def portal_submit(
    token: str,
    data: OnboardingSubmit,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """Finalise: validate all required fields, create the Customer
    row in CRM, mark the session SUBMITTED."""

    s = _require_session(token, db)

    _require_portal_user(s, authorization, db)

    partial = _partial(s)

    # Soft minimum — without these, the customer record is useless to
    # the sales team. Everything else can be filled later when admin
    # reopens the session.
    SOFT_MINIMUM = ["CUSTOMER_NAME", "CONTACT_PERSON", "PHONE"]

    soft_missing = [
        k for k in SOFT_MINIMUM
        if partial.get(k) in (None, "", 0)
    ]

    if soft_missing:

        labels = {
            "CUSTOMER_NAME":  "Company name",
            "CONTACT_PERSON": "Contact person name",
            "PHONE":          "Phone number"
        }

        raise HTTPException(
            status_code=400,
            detail=(
                "Before submitting, please provide at least: "
                + ", ".join(labels.get(k, k) for k in soft_missing)
            )
        )

    # Truncate any string longer than its column's max_length and
    # strip the reserved __skipped__ key. Guarantees the INSERT never
    # raises (1406, "Data too long for column ...").
    partial = ai.safe_truncate(partial)

    # ---- Create the CRM Customer row ----

    # Generate a CUST-### code
    vendor_id = s.VENDOR_ID or 1

    cust_count = db.query(Customer).filter(
        Customer.VENDOR_ID == vendor_id
    ).count()

    code = f"CUST-{cust_count + 1:03d}"

    while db.query(Customer).filter(
        Customer.VENDOR_ID == vendor_id,
        Customer.CUSTOMER_CODE == code
    ).first():

        cust_count += 1

        code = f"CUST-{cust_count + 1:03d}"

    def _g(k, default=None):
        """Get value with a None-for-blank convention."""

        v = partial.get(k)

        if v in (None, ""):

            return default

        return v

    customer = Customer(
        CUSTOMER_CODE=code,
        CUSTOMER_NAME=_g("CUSTOMER_NAME"),
        CONTACT_PERSON=_g("CONTACT_PERSON"),
        DESIGNATION=_g("DESIGNATION"),
        PHONE=_g("PHONE"),
        ALTERNATE_PHONE=_g("ALTERNATE_PHONE"),
        EMAIL=_g("EMAIL"),
        WEBSITE=_g("WEBSITE"),
        ADDRESS=_g("ADDRESS"),
        CITY=_g("CITY"),
        STATE=_g("STATE"),
        PINCODE=_g("PINCODE"),
        COUNTRY=_g("COUNTRY") or "India",
        GST_NUMBER=_g("GST_NUMBER"),
        PAN_NUMBER=_g("PAN_NUMBER"),
        INDUSTRY=_g("INDUSTRY"),
        STATUS="ACTIVE",
        VENDOR_ID=vendor_id,
        CUSTOMER_TYPE=_g("CUSTOMER_TYPE"),
        BUSINESS_TYPE=_g("BUSINESS_TYPE"),
        NUMBER_OF_BRANCHES=_g("NUMBER_OF_BRANCHES"),
        EXPECTED_MONTHLY_ORDERS=_g("EXPECTED_MONTHLY_ORDERS"),
        WHATSAPP_NUMBER=_g("WHATSAPP_NUMBER"),
        LEAD_SOURCE="PORTAL_SELF_SERVE",
        LEAD_STATUS="NEW",
        LEAD_PRIORITY="MEDIUM",
        LEAD_CREATED_DATE=date.today(),
        REQUIREMENT_NOTES=_g("REQUIREMENT_NOTES")
    )

    db.add(customer)

    db.flush()

    s.STATUS = "SUBMITTED"

    s.SUBMITTED_AT = datetime.utcnow()

    s.LAST_ACTIVITY_AT = datetime.utcnow()

    s.CUSTOMER_ID = customer.ID

    db.commit()

    db.refresh(customer)

    # 📲 Optional MD notifications (WhatsApp + email)
    try:

        from app.services.whatsapp_service import notify_md_safe

        notify_md_safe(
            f"✅ *New Customer (Self-Onboarded) — BVC24*\n\n"
            f"🏢 *{customer.CUSTOMER_NAME}*\n"
            f"📞 {customer.PHONE}\n"
            + (f"📧 {customer.EMAIL}\n" if customer.EMAIL else "")
            + (f"🏭 Industry: {customer.INDUSTRY}\n" if customer.INDUSTRY else "")
            + (f"📍 {customer.CITY or ''}{', ' + customer.STATE if customer.STATE else ''}\n" if (customer.CITY or customer.STATE) else "")
            + (
                f"\n🤖 Requested: *{partial.get('REQUESTED_MACHINE_NAME')}* "
                f"× {partial.get('REQUESTED_QUANTITY') or 1}\n"
                if partial.get("REQUESTED_MACHINE_NAME") else ""
            )
            + f"\nCode: {customer.CUSTOMER_CODE}"
            + f"\nSource: Customer self-onboarding portal"
        )

    except Exception:

        pass

    # 📧 Registration notification → goes to the Managing Director /
    # company inbox ONLY. The customer themselves does NOT receive a
    # welcome email — the MD owns the follow-up channel.
    md_email_sent = False

    md_email_message = "skipped"

    try:

        from app.services.email_service import send_alert_email

        from app.routes.project import (
            _md_recipient_email,
            _build_customer_profile_email_html
        )

        md_target = _md_recipient_email()

        if md_target:

            product_info_for_email = None

            if partial.get("REQUESTED_MACHINE_NAME"):

                product_info_for_email = {
                    "model_name": partial.get("REQUESTED_MACHINE_NAME"),
                    "model_code": partial.get("REQUESTED_MACHINE_CATEGORY") or "—",
                    "was_existing": False
                }

            html = _build_customer_profile_email_html(
                customer,
                sales_rep_name=None,
                product_info=product_info_for_email,
                requested_quantity=partial.get("REQUESTED_QUANTITY") or 1
            )

            subject = (
                f"[BVC24] New Customer Registered via Portal — "
                f"{customer.CUSTOMER_NAME} ({customer.CUSTOMER_CODE})"
            )

            md_email_sent, md_email_message = send_alert_email(
                subject, html, recipient=md_target
            )

        else:

            md_email_message = "no MD recipient configured (MD_EMAIL / APPROVER_EMAIL not set)"

    except Exception as exc:

        md_email_message = f"MD email skipped: {exc}"

    final_pct = ai.compute_progress(partial)

    fully_complete = final_pct >= 100

    pending_after = ai.pending_fields(partial)

    return {
        "message": "Onboarding submitted — your profile is now with our team.",
        "customer_id": customer.ID,
        "customer_code": customer.CUSTOMER_CODE,
        "completion_pct": final_pct,
        "fully_complete": fully_complete,
        "pending_count": len(pending_after),
        "md_email_sent": md_email_sent,
        "md_email_message": md_email_message,
        "session": _serialize_session(s)
    }
