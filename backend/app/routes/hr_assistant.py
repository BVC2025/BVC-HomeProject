"""
HR Assistant chatbot — drives the leave application flow through
natural conversation. 100% local rule-based, no external API, no
quota. Conversation state lives on the client and is echoed back
every turn, so the backend is stateless.

Endpoints:
  POST /hr-bot/message     → process one user message
  GET  /hr-bot/policy      → return the current leave policy text
"""

import re

from datetime import date, datetime, timedelta
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import Employee, LeaveRequest, LeaveBalance


router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================

class HRBotContext(BaseModel):
    """Conversation slot-state passed both ways."""

    state: Optional[str] = "idle"
    leave_type: Optional[str] = None
    start_date: Optional[str] = None  # ISO yyyy-mm-dd
    end_date: Optional[str] = None
    days: Optional[float] = None
    reason: Optional[str] = None


class HRBotRequest(BaseModel):

    employee_id: str
    message: str
    context: Optional[HRBotContext] = None


# =====================================================================
# Employee resolver (shared pattern from leave routes)
# =====================================================================

def _resolve_employee(db: Session, identifier: str) -> Optional[Employee]:

    if not identifier:

        return None

    emp = db.query(Employee).filter(Employee.ID == identifier).first()

    if emp:

        return emp

    return db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == str(identifier).strip().upper()
    ).first()


# =====================================================================
# Intent + entity detection (pure rule-based, no LLM)
# =====================================================================

def _norm(text: str) -> str:
    """Lowercase + strip punctuation for keyword matching."""

    return re.sub(r"[^\w\s\-/.:]", " ", (text or "").lower()).strip()


LEAVE_TRIGGERS = {
    "leave", "leaves", "off", "holiday", "vacation",
    "permission", "absent", "absence", "take off"
}

APPLY_TRIGGERS = {
    "apply", "need", "want", "request", "take", "going on", "book"
}

LEAVE_TYPES = {
    "SICK":     {"sick", "medical", "ill", "fever", "doctor", "hospital"},
    "CASUAL":   {"casual", "personal", "family", "function", "event", "wedding"},
    "EARNED":   {"earned", "el", "annual", "vacation", "leave-encash"},
    "EMERGENCY": {"emergency", "urgent"},
    "UNPAID":   {"unpaid", "lop", "without pay"}
}

CONFIRM_WORDS = {
    "yes", "ya", "yeah", "yep", "yup", "ok", "okay", "submit",
    "confirm", "go ahead", "do it", "send", "proceed", "sure"
}

CANCEL_WORDS = {
    "no", "nope", "cancel", "stop", "abort", "discard", "drop"
}

GREETING_WORDS = {
    "hi", "hello", "hey", "good morning", "good afternoon",
    "good evening", "yo", "hola"
}


def _has_any(text_norm: str, words) -> bool:
    """Match any of the given words/phrases as whole tokens or substrings."""

    for w in words:

        if w in text_norm:

            return True

    return False


def _detect_leave_type(text_norm: str) -> Optional[str]:

    for ltype, keywords in LEAVE_TYPES.items():

        if _has_any(text_norm, keywords):

            return ltype

    return None


# Date parsing — handles "tomorrow", "today", "next monday",
# "29 may", "29/05", "2026-05-29", "27-05-2026" etc.

WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6
}

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6,
    "july": 7, "jul": 7, "august": 8, "aug": 8, "september": 9, "sep": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11,
    "december": 12, "dec": 12
}


def _parse_date(text_norm: str, today: Optional[date] = None) -> Optional[date]:
    """Best-effort date extraction. Returns None if no date found."""

    if today is None:

        today = date.today()

    if "tomorrow" in text_norm:

        return today + timedelta(days=1)

    if "day after tomorrow" in text_norm:

        return today + timedelta(days=2)

    if "today" in text_norm:

        return today

    if "yesterday" in text_norm:

        return today - timedelta(days=1)

    # "next monday" / "this friday"
    for wd_name, wd_num in WEEKDAYS.items():

        if wd_name in text_norm:

            days_ahead = (wd_num - today.weekday()) % 7

            if "next" in text_norm:

                days_ahead = days_ahead or 7

            elif days_ahead == 0:

                days_ahead = 7

            return today + timedelta(days=days_ahead)

    # ISO yyyy-mm-dd
    m = re.search(r"(20\d{2})[-/](\d{1,2})[-/](\d{1,2})", text_norm)

    if m:

        try:

            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))

        except ValueError:

            pass

    # dd-mm-yyyy or dd/mm/yyyy
    m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](20\d{2})", text_norm)

    if m:

        try:

            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))

        except ValueError:

            pass

    # "29 may" / "29 may 2026" / "may 29"
    for mn, mi in MONTHS.items():

        m = re.search(r"(\d{1,2})\s+" + mn + r"(?:\s+(20\d{2}))?", text_norm)

        if m:

            day = int(m.group(1))

            year = int(m.group(2)) if m.group(2) else today.year

            try:

                d = date(year, mi, day)

                if d < today and not m.group(2):

                    d = date(year + 1, mi, day)

                return d

            except ValueError:

                pass

        m = re.search(mn + r"\s+(\d{1,2})(?:\s+(20\d{2}))?", text_norm)

        if m:

            day = int(m.group(1))

            year = int(m.group(2)) if m.group(2) else today.year

            try:

                d = date(year, mi, day)

                if d < today and not m.group(2):

                    d = date(year + 1, mi, day)

                return d

            except ValueError:

                pass

    return None


def _parse_days(text_norm: str) -> Optional[float]:
    """Extract a day count like '2 days', '3', 'half day', '0.5'."""

    if "half day" in text_norm or "0.5 day" in text_norm or "half-day" in text_norm:

        return 0.5

    # "2 days" / "3day" / "for 5 days"
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:day|days|d\b)", text_norm)

    if m:

        return float(m.group(1))

    # Bare number on its own line (after "how many days?")
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*", text_norm)

    if m:

        return float(m.group(1))

    return None


def _detect_intent(text_norm: str) -> str:
    """Top-level user intent."""

    if _has_any(text_norm, {"balance", "remaining", "how many leaves", "how many days left"}):

        return "balance"

    if _has_any(text_norm, {"policy", "rules", "how does leave work", "leave rule"}):

        return "policy"

    if _has_any(text_norm, {"history", "my leaves", "past leave", "my requests", "previous leave"}):

        return "history"

    if _has_any(text_norm, {"help", "what can you do", "commands"}):

        return "help"

    if _has_any(text_norm, GREETING_WORDS):

        return "greeting"

    # Leave-application intent — "apply leave", "need leave tomorrow", "i want leave"
    if (
        _has_any(text_norm, LEAVE_TRIGGERS)
        and _has_any(text_norm, APPLY_TRIGGERS | {"i ", "my ", "next ", "tomorrow", "today"})
    ) or _has_any(text_norm, {"apply leave", "take leave", "need leave", "want leave"}):

        return "leave_apply"

    if _has_any(text_norm, LEAVE_TRIGGERS):

        return "leave_apply"

    return "unknown"


# =====================================================================
# Response builder
# =====================================================================

def _reply(
    text: str,
    context: Dict[str, Any],
    suggestions: Optional[List[str]] = None,
    action: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:

    return {
        "reply": text,
        "context": context,
        "suggestions": suggestions or [],
        "action": action
    }


# =====================================================================
# Handlers
# =====================================================================

def _format_balance(bal: LeaveBalance) -> str:

    casual_total = bal.CASUAL_TOTAL or 0

    casual_used = bal.CASUAL_USED or 0

    casual_left = casual_total - casual_used

    sick_total = bal.SICK_TOTAL or 0

    sick_used = bal.SICK_USED or 0

    sick_left = sick_total - sick_used

    earned_total = bal.EARNED_TOTAL or 0

    earned_used = bal.EARNED_USED or 0

    earned_left = earned_total - earned_used

    return (
        f"📊 Here's your leave balance for {bal.YEAR}:\n\n"
        f"• Casual: {casual_left:g} / {casual_total:g} days left "
        f"({casual_used:g} used)\n"
        f"• Sick: {sick_left:g} / {sick_total:g} days left "
        f"({sick_used:g} used)\n"
        f"• Earned: {earned_left:g} / {earned_total:g} days left "
        f"({earned_used:g} used)"
    )


def _handle_balance(db: Session, emp: Employee, ctx: Dict[str, Any]) -> Dict[str, Any]:

    from app.services.leave_service import get_or_create_balance

    try:

        bal = get_or_create_balance(db, emp.ID)

    except Exception:

        bal = None

    if not bal:

        return _reply(
            "I couldn't load your leave balance right now. Please try "
            "again in a moment or use the leave form below.",
            ctx,
            suggestions=["Apply leave", "Show leave policy"]
        )

    return _reply(
        _format_balance(bal),
        ctx,
        suggestions=["Apply leave", "Show my leave history", "Show leave policy"]
    )


def _handle_history(db: Session, emp: Employee, ctx: Dict[str, Any]) -> Dict[str, Any]:

    rows = db.query(LeaveRequest).filter(
        LeaveRequest.EMPLOYEE_ID == emp.ID
    ).order_by(LeaveRequest.CREATED_AT.desc()).limit(5).all()

    if not rows:

        return _reply(
            "📭 You haven't applied for any leave yet.\n\n"
            "Want to apply one now? Just say 'I need leave tomorrow' or "
            "tap the suggestion below.",
            ctx,
            suggestions=["Apply leave", "Show my balance"]
        )

    lines = ["📋 Here are your recent leave requests:\n"]

    icon = {
        "PENDING_APPROVAL": "🟡",
        "APPROVED": "✅",
        "REJECTED": "❌",
        "CANCELLED": "⚪",
        "EXPIRED": "⌛"
    }

    for r in rows:

        i = icon.get(r.STATUS, "•")

        date_range = (
            f"{r.START_DATE.isoformat()}"
            if r.START_DATE == r.END_DATE
            else f"{r.START_DATE.isoformat()} → {r.END_DATE.isoformat()}"
        )

        lines.append(
            f"{i} {r.LEAVE_TYPE} · {date_range} · {r.DAYS:g} day(s)\n"
            f"   Status: {r.STATUS}"
            + (f" — '{r.REJECTION_REASON}'" if r.STATUS == "REJECTED" and r.REJECTION_REASON else "")
        )

    return _reply(
        "\n".join(lines),
        ctx,
        suggestions=["Apply leave", "Show my balance"]
    )


def _handle_policy(ctx: Dict[str, Any]) -> Dict[str, Any]:

    text = (
        "📜 *BVC24 Leave Policy*\n\n"
        "Every leave — including half-day and one-day requests — needs "
        "manager approval before it takes effect.\n\n"
        "• A reason is REQUIRED on every request.\n"
        "• The approval email goes to your reporting manager.\n"
        "• You'll be notified by email + in-app when the manager "
        "approves or rejects.\n"
        "• Balance is deducted only AFTER approval.\n"
        "• Approved leave can be cancelled — the balance is refunded.\n\n"
        "Quotas per year:\n"
        "• Casual — 12 days\n"
        "• Sick — 12 days\n"
        "• Earned — 15 days"
    )

    return _reply(
        text,
        ctx,
        suggestions=["Apply leave", "Show my balance", "Show my leave history"]
    )


def _handle_help(ctx: Dict[str, Any]) -> Dict[str, Any]:

    return _reply(
        "👋 I'm your HR assistant. I can help with:\n\n"
        "• Apply for leave — just say 'I need leave tomorrow' "
        "or 'apply for sick leave next Monday'\n"
        "• Check leave balance — 'how many leaves do I have left?'\n"
        "• Show leave history — 'my past leaves'\n"
        "• Explain leave policy — 'what's the leave policy?'\n\n"
        "Try any of the suggestion buttons below to get started.",
        ctx,
        suggestions=[
            "Apply leave",
            "Show my balance",
            "Show my leave history",
            "Show leave policy"
        ]
    )


def _handle_greeting(emp: Employee, ctx: Dict[str, Any]) -> Dict[str, Any]:

    name = (emp.NAME or "").split()[0] if emp.NAME else "there"

    return _reply(
        f"Hi {name}! 👋 I'm your HR assistant. How can I help today?\n\n"
        "I can apply leaves for you, check your balance, or explain "
        "the leave policy.",
        ctx,
        suggestions=[
            "Apply leave",
            "Show my balance",
            "Show my leave history"
        ]
    )


# =====================================================================
# Leave-application state machine
# =====================================================================

def _ask_for_leave_type(ctx: Dict[str, Any]) -> Dict[str, Any]:

    ctx["state"] = "awaiting_leave_type"

    return _reply(
        "Got it. What **type** of leave do you need?",
        ctx,
        suggestions=["Sick leave", "Casual leave", "Earned leave", "Emergency"]
    )


def _ask_for_dates(ctx: Dict[str, Any]) -> Dict[str, Any]:

    ctx["state"] = "awaiting_dates"

    return _reply(
        "**When** is the leave? You can say things like:\n"
        "• 'tomorrow'\n"
        "• 'next Monday'\n"
        "• '29-05-2026'\n"
        "• 'starting 27 May for 3 days'",
        ctx,
        suggestions=["Tomorrow", "Day after tomorrow", "Next Monday"]
    )


def _ask_for_days(ctx: Dict[str, Any]) -> Dict[str, Any]:

    ctx["state"] = "awaiting_days"

    return _reply(
        f"How **many days** of leave from "
        f"**{ctx.get('start_date')}**? (use '1' for a single day, "
        f"'0.5' for a half-day)",
        ctx,
        suggestions=["1 day", "2 days", "Half day"]
    )


def _ask_for_reason(ctx: Dict[str, Any]) -> Dict[str, Any]:

    ctx["state"] = "awaiting_reason"

    return _reply(
        "What's the **reason** for the leave? "
        "(this goes to your manager along with the request)",
        ctx
    )


def _ask_for_confirm(ctx: Dict[str, Any]) -> Dict[str, Any]:

    ctx["state"] = "awaiting_confirm"

    date_range = ctx["start_date"]

    if ctx.get("end_date") and ctx["end_date"] != ctx["start_date"]:

        date_range = f"{ctx['start_date']} → {ctx['end_date']}"

    summary = (
        "🧾 Please confirm:\n\n"
        f"• Type: **{ctx['leave_type']}**\n"
        f"• Dates: **{date_range}**\n"
        f"• Days: **{ctx['days']:g}**\n"
        f"• Reason: **{ctx['reason']}**\n\n"
        "Submit this request?"
    )

    return _reply(
        summary,
        ctx,
        suggestions=["Yes, submit", "Cancel"]
    )


def _try_advance_to_next_step(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Look at what slots are filled and ask the next question."""

    if not ctx.get("leave_type"):

        return _ask_for_leave_type(ctx)

    if not ctx.get("start_date"):

        return _ask_for_dates(ctx)

    if ctx.get("days") is None:

        return _ask_for_days(ctx)

    if not ctx.get("reason"):

        return _ask_for_reason(ctx)

    return _ask_for_confirm(ctx)


def _submit_leave(
    db: Session, emp: Employee, ctx: Dict[str, Any]
) -> Dict[str, Any]:
    """Call into the existing /leave/apply logic by re-using the
    LeaveRequest model + leave service helpers."""

    from app.services.leave_service import (
        VALID_LEAVE_TYPES,
        QUOTA_BACKED_TYPES,
        get_or_create_balance,
        remaining_for_type
    )

    from app.services.email_service import send_alert_email

    import os

    import secrets

    leave_type = (ctx.get("leave_type") or "").upper()

    if leave_type not in VALID_LEAVE_TYPES:

        ctx["state"] = "idle"

        return _reply(
            f"⚠️ '{leave_type}' isn't a recognised leave type. "
            f"Try one of: {', '.join(sorted(VALID_LEAVE_TYPES))}.",
            ctx,
            suggestions=["Apply leave", "Show leave policy"]
        )

    try:

        start_d = date.fromisoformat(ctx["start_date"])

        end_d = date.fromisoformat(ctx["end_date"] or ctx["start_date"])

    except (TypeError, ValueError):

        ctx["state"] = "idle"

        return _reply(
            "⚠️ I couldn't parse the leave dates. Let's start over.",
            ctx,
            suggestions=["Apply leave"]
        )

    days = float(ctx.get("days") or 1)

    reason = (ctx.get("reason") or "").strip()

    # Balance check (quota-backed types only)
    if leave_type in QUOTA_BACKED_TYPES:

        bal = get_or_create_balance(db, emp.ID)

        remaining = remaining_for_type(bal, leave_type)

        if days > remaining:

            ctx["state"] = "idle"

            return _reply(
                f"❌ You only have **{remaining:g} day(s)** of "
                f"{leave_type} leave left, but you've requested "
                f"**{days:g} day(s)**. Try a shorter leave or pick "
                f"a different type.",
                ctx,
                suggestions=["Show my balance", "Apply leave"]
            )

    # Generate approval token (manager review is always required —
    # matches the policy at /leave/apply)
    token = secrets.token_urlsafe(24)

    leave = LeaveRequest(
        EMPLOYEE_ID=emp.ID,
        LEAVE_TYPE=leave_type,
        START_DATE=start_d,
        END_DATE=end_d,
        DAYS=days,
        REASON=reason,
        STATUS="PENDING_APPROVAL",
        APPROVAL_TOKEN=token,
        VENDOR_ID=emp.VENDOR_ID or 1,
        CREATED_AT=datetime.utcnow(),
        UPDATED_AT=datetime.utcnow()
    )

    db.add(leave)

    db.commit()

    db.refresh(leave)

    # Try to email manager (non-fatal if it fails — the request
    # is still in the dashboard for them to action)
    approver = os.getenv("APPROVER_EMAIL", "").strip()

    if approver:

        try:

            api_base = os.getenv(
                "API_BASE_URL", "http://localhost:8000"
            ).rstrip("/")

            approve_link = f"{api_base}/leave/decide/{token}?action=approve"

            reject_link  = f"{api_base}/leave/decide/{token}?action=reject"

            html = (
                f"<h3>New leave request from {emp.NAME or emp.EMPLOYEE_CODE}</h3>"
                f"<p><b>Type:</b> {leave_type}<br>"
                f"<b>Dates:</b> {start_d} → {end_d} ({days:g} day(s))<br>"
                f"<b>Reason:</b> {reason}</p>"
                f"<p style='margin-top:18px;'>"
                f"<a href='{approve_link}' style='background:#10b981;"
                f"color:white;padding:10px 22px;border-radius:6px;"
                f"text-decoration:none;margin-right:10px;'>Approve</a>"
                f"<a href='{reject_link}' style='background:#ef4444;"
                f"color:white;padding:10px 22px;border-radius:6px;"
                f"text-decoration:none;'>Reject</a></p>"
                f"<p style='font-size:11px;color:#94a3b8;'>"
                f"Generated by BVC24 HR Assistant</p>"
            )

            send_alert_email(
                f"Leave request — {emp.NAME or emp.EMPLOYEE_CODE} "
                f"({leave_type}, {days:g}d)",
                html,
                recipient=approver
            )

        except Exception:

            pass  # email is best-effort

    # Reset conversation state for the next round
    new_ctx = {"state": "idle"}

    return _reply(
        f"✅ Done! I've submitted your **{leave_type}** leave request "
        f"({days:g} day(s) from {start_d} to {end_d}).\n\n"
        f"📨 Your manager has been notified by email and the request "
        f"is now **PENDING APPROVAL**. You'll get a notification once "
        f"they decide.\n\n"
        f"Anything else I can help with?",
        new_ctx,
        suggestions=[
            "Show my balance",
            "Show my leave history",
            "Apply another leave"
        ],
        action={"type": "leave_submitted", "leave_id": leave.ID}
    )


# =====================================================================
# Main message handler
# =====================================================================

def _process_message(
    db: Session, emp: Employee, user_text: str, ctx: Dict[str, Any]
) -> Dict[str, Any]:

    text_norm = _norm(user_text)

    state = ctx.get("state", "idle")

    # ---- Stateful conversation continuation ---------------------------
    if state == "awaiting_leave_type":

        ltype = _detect_leave_type(text_norm)

        if not ltype:

            return _reply(
                "I didn't catch that. Please pick one — Sick, Casual, "
                "Earned, Emergency, or Unpaid.",
                ctx,
                suggestions=["Sick", "Casual", "Earned", "Emergency"]
            )

        ctx["leave_type"] = ltype

        return _try_advance_to_next_step(ctx)

    if state == "awaiting_dates":

        parsed_date = _parse_date(text_norm)

        if not parsed_date:

            return _reply(
                "I couldn't read that date. Try 'tomorrow', "
                "'next Monday', or 'dd-mm-yyyy'.",
                ctx,
                suggestions=["Tomorrow", "Day after tomorrow", "Next Monday"]
            )

        ctx["start_date"] = parsed_date.isoformat()

        # User might have also said the day count: "tomorrow for 2 days"
        d = _parse_days(text_norm)

        if d is not None:

            ctx["days"] = d

            ctx["end_date"] = (
                parsed_date + timedelta(days=int(d - 1) if d >= 1 else 0)
            ).isoformat()

        return _try_advance_to_next_step(ctx)

    if state == "awaiting_days":

        d = _parse_days(text_norm)

        if d is None:

            return _reply(
                "How many days? Just send a number like '1', "
                "'2', or '0.5' for half-day.",
                ctx,
                suggestions=["1 day", "2 days", "Half day"]
            )

        if d <= 0:

            return _reply(
                "Days must be greater than 0. How many?",
                ctx
            )

        ctx["days"] = d

        start = date.fromisoformat(ctx["start_date"])

        if d >= 1:

            end = start + timedelta(days=int(d) - 1)

        else:

            end = start  # half-day → same day

        ctx["end_date"] = end.isoformat()

        return _try_advance_to_next_step(ctx)

    if state == "awaiting_reason":

        reason = user_text.strip()

        if len(reason) < 3:

            return _reply(
                "Please give a slightly longer reason — your manager "
                "needs to understand the context.",
                ctx
            )

        ctx["reason"] = reason

        return _try_advance_to_next_step(ctx)

    if state == "awaiting_confirm":

        if _has_any(text_norm, CONFIRM_WORDS):

            return _submit_leave(db, emp, ctx)

        if _has_any(text_norm, CANCEL_WORDS):

            return _reply(
                "👍 Cancelled. No leave request was created.",
                {"state": "idle"},
                suggestions=[
                    "Apply leave",
                    "Show my balance"
                ]
            )

        return _reply(
            "Please confirm with 'yes' to submit or 'cancel' to abort.",
            ctx,
            suggestions=["Yes, submit", "Cancel"]
        )

    # ---- Top-level intent (fresh / idle state) ------------------------
    intent = _detect_intent(text_norm)

    if intent == "greeting":

        return _handle_greeting(emp, ctx)

    if intent == "help":

        return _handle_help(ctx)

    if intent == "balance":

        return _handle_balance(db, emp, ctx)

    if intent == "history":

        return _handle_history(db, emp, ctx)

    if intent == "policy":

        return _handle_policy(ctx)

    if intent == "leave_apply":

        # Try to extract everything we can from the opening message
        ctx["state"] = "idle"  # reset before re-filling

        ltype = _detect_leave_type(text_norm)

        if ltype:

            ctx["leave_type"] = ltype

        parsed_date = _parse_date(text_norm)

        if parsed_date:

            ctx["start_date"] = parsed_date.isoformat()

        d = _parse_days(text_norm)

        if d is not None and ctx.get("start_date"):

            ctx["days"] = d

            start = date.fromisoformat(ctx["start_date"])

            end = start + timedelta(days=int(d) - 1) if d >= 1 else start

            ctx["end_date"] = end.isoformat()

        return _try_advance_to_next_step(ctx)

    # ---- Fallback -----------------------------------------------------
    # Anything outside the script's known intents — try Gemini if the
    # API key is configured. This handles open-ended HR questions like
    # "how do I file a tax declaration?" or "what's a notice period?".
    # If Gemini fails (no key / quota / error), drop back to the safe
    # canned reply below.
    gemini_reply = _try_gemini_fallback(user_text, emp)

    if gemini_reply:

        return _reply(
            gemini_reply,
            ctx,
            suggestions=[
                "Apply leave",
                "Show my balance",
                "Show my leave history"
            ]
        )

    return _reply(
        "Sorry, I didn't quite catch that. I can help with leave "
        "applications, balance checks, history, and policy questions.",
        ctx,
        suggestions=[
            "Apply leave",
            "Show my balance",
            "Show my leave history",
            "What can you do?"
        ]
    )


# =====================================================================
# Gemini fallback for open-ended HR questions
# =====================================================================

def _try_gemini_fallback(user_text: str, emp: Employee) -> Optional[str]:
    """If GEMINI_API_KEY is set in .env, send the user's free-form
    question to Gemini with an HR-focused system prompt and return
    its reply. Returns None on any failure so the caller falls back
    to the canned safe reply.

    Kept stateless / single-turn so it stays cheap (free tier friendly)
    and doesn't leak previous conversation context to Gemini.
    """

    import os

    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()

    if not api_key:

        return None

    system_prompt = (
        "You are the HR assistant for BVC24 (Bharath Vending "
        "Corporation), an Indian vending machine manufacturer. "
        "You are talking to the company's employee "
        f"'{emp.NAME or emp.EMPLOYEE_CODE}'.\n\n"
        "Rules:\n"
        "• Keep answers SHORT — 2 to 4 sentences max.\n"
        "• You can answer general HR / workplace questions "
        "(notice period, tax declarations, PF, ESI, professional "
        "etiquette, etc.) using common Indian HR knowledge.\n"
        "• Do NOT invent BVC24-specific policies, salary numbers, "
        "names, projects, or leave balances. If asked about "
        "BVC-specific data, redirect them to use the in-app "
        "buttons (Apply leave / Show my balance / Show my leave "
        "history / Show leave policy).\n"
        "• Be warm and professional. Use plain English.\n"
        "• Do NOT mention you are an AI; just be the HR assistant."
    )

    try:

        import google.generativeai as genai

        genai.configure(api_key=api_key)

        # Match the rest of the codebase's model preference — flash is
        # cheap on the free tier.
        model_name = (
            os.getenv("GEMINI_MODEL", "").strip()
            or "gemini-2.5-flash"
        )

        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=system_prompt
        )

        response = model.generate_content(
            user_text,
            generation_config={
                "temperature": 0.4,
                "max_output_tokens": 220
            }
        )

        text = (getattr(response, "text", None) or "").strip()

        if not text:

            return None

        return text

    except Exception as exc:

        # Common failures: 403 quota, network down, invalid key,
        # SDK not installed. All non-fatal — caller falls back.
        import logging

        logging.getLogger(__name__).warning(
            "HR-bot Gemini fallback FAILED (%s): %s",
            type(exc).__name__, exc
        )

        return None


@router.get("/hr-bot/diagnose")
def hr_bot_diagnose():
    """Diagnostic endpoint — call from a browser to see exactly why
    the Gemini fallback is or isn't working. Use this when the bot
    keeps replying 'sorry I didn't catch that' instead of using AI.

    Hit: http://localhost:8000/hr-bot/diagnose
    """

    import os

    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()

    result = {
        "GEMINI_API_KEY_present": bool(api_key),
        "GEMINI_API_KEY_length": len(api_key) if api_key else 0,
        "GEMINI_MODEL_env": os.getenv("GEMINI_MODEL", "").strip() or None,
        "google_generativeai_installed": False,
        "google_generativeai_version": None,
        "test_call": None,
        "test_call_error": None
    }

    if not api_key:

        result["next_step"] = (
            "Add GEMINI_API_KEY=... to backend/.env and restart the server."
        )

        return result

    try:

        import google.generativeai as genai

        result["google_generativeai_installed"] = True

        result["google_generativeai_version"] = getattr(
            genai, "__version__", "unknown"
        )

        genai.configure(api_key=api_key)

        model_name = (
            os.getenv("GEMINI_MODEL", "").strip()
            or "gemini-2.5-flash"
        )

        result["model_being_tried"] = model_name

        model = genai.GenerativeModel(model_name=model_name)

        resp = model.generate_content(
            "Reply with exactly the word: PONG",
            generation_config={
                "temperature": 0.0,
                "max_output_tokens": 8
            }
        )

        text = (getattr(resp, "text", None) or "").strip()

        result["test_call"] = text or "(empty)"

    except Exception as exc:

        result["test_call_error"] = f"{type(exc).__name__}: {exc}"

        result["next_step"] = (
            "Read the error above. Most common causes:\n"
            "  • 403/quota → switch to a different free model "
            "(set GEMINI_MODEL=gemini-2.5-flash-lite or similar)\n"
            "  • Invalid key → regenerate at https://aistudio.google.com/apikey\n"
            "  • Model name not found → set GEMINI_MODEL=gemini-2.5-flash"
        )

    return result


# =====================================================================
# Endpoint
# =====================================================================

@router.post("/hr-bot/message")
def hr_bot_message(
    data: HRBotRequest,
    db: Session = Depends(get_db)
):
    """Single endpoint for the HR assistant. Stateless — the client
    sends the conversation context with every message, the backend
    returns the next reply + updated context."""

    emp = _resolve_employee(db, data.employee_id)

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    ctx = (
        data.context.dict() if data.context else {"state": "idle"}
    )

    return _process_message(db, emp, data.message or "", ctx)


@router.get("/hr-bot/policy")
def hr_bot_policy():
    """Static policy text — same content the chatbot quotes."""

    return _handle_policy({"state": "idle"})
