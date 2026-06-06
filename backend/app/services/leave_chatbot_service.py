"""
Leave Chatbot Service — natural-language leave request parser.

Turns free-text employee messages like:
    "i need leave tomorrow for family function"
    "sick leave day after till next monday"
    "half day on 8th, hospital appointment"

into structured leave-request payloads that the existing /leave/apply
endpoint can consume.

Multi-turn aware: each call accepts the prior `state` so the user can
fill missing fields across messages. When all required fields are
present, validation runs (balance, overlap, dates) and the response
flags `ready_to_submit=true`.
"""

from datetime import date, datetime, timedelta
from typing import Optional
import json
import os
import re

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    LeaveRequest,
    LeaveBalance
)

from app.services.leave_service import (
    VALID_LEAVE_TYPES,
    QUOTA_BACKED_TYPES,
    get_or_create_balance,
    remaining_for_type,
    compute_days
)


# =====================================================================
# Quick-reply chips the UI shows when relevant
# =====================================================================

LEAVE_TYPE_CHIPS = ["Casual", "Sick", "Earned", "Maternity", "Unpaid"]

REASON_CHIPS = [
    "Family function",
    "Medical appointment",
    "Personal work",
    "Out of town",
    "Not feeling well"
]


# =====================================================================
# Deterministic parsers — run BEFORE Gemini so common phrases don't
# burn API quota. Each returns None if it can't parse.
# =====================================================================

LEAVE_TYPE_KEYWORDS = {
    "CASUAL":   r"\b(casual|cl|cas)\b",
    "SICK":     r"\b(sick|ill|fever|medical|sl|hospital|doctor)\b",
    "EARNED":   r"\b(earned|el|annual|paid)\b",
    "MATERNITY":r"\b(maternity|matern|preg)\b",
    "UNPAID":   r"\b(unpaid|loss\s*of\s*pay|lop|without\s*pay)\b"
}


def _detect_leave_type_kw(message: str) -> Optional[str]:
    """Cheap regex pass for the leave type."""

    m = (message or "").lower()

    for k, pat in LEAVE_TYPE_KEYWORDS.items():

        if re.search(pat, m):

            return k

    return None


def _detect_half_day_kw(message: str) -> bool:

    m = (message or "").lower()

    return bool(re.search(r"\b(half[\s-]?day|0\.5\s*day|0.5d|halfday)\b", m))


# Common relative-date phrases → resolved against today
def _detect_dates_kw(message: str, today: date) -> tuple[Optional[date], Optional[date]]:
    """Returns (start, end) or (None, None) if nothing matched."""

    m = (message or "").lower().strip()

    # "from YYYY-MM-DD to YYYY-MM-DD" / "YYYY-MM-DD to YYYY-MM-DD"
    rng = re.search(
        r"(?:from\s+)?(\d{4}-\d{1,2}-\d{1,2})\s+(?:to|till|until|through|-)\s+(\d{4}-\d{1,2}-\d{1,2})",
        m
    )

    if rng:

        try:

            sd = datetime.fromisoformat(rng.group(1)).date()

            ed = datetime.fromisoformat(rng.group(2)).date()

            return sd, ed

        except Exception:

            pass

    # tomorrow
    if re.search(r"\btomorrow\b", m):

        d = today + timedelta(days=1)

        return d, d

    # today
    if re.search(r"\b(today|right now)\b", m):

        return today, today

    # day after tomorrow
    if re.search(r"\b(day after tomorrow|day\s*after\s*tmrw|day\s*after)\b", m):

        d = today + timedelta(days=2)

        return d, d

    # next monday / tuesday / etc.
    weekday_map = {
        "monday": 0, "tuesday": 1, "wednesday": 2,
        "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6
    }

    nm = re.search(r"\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", m)

    if nm:

        target = weekday_map[nm.group(1)]

        delta = (target - today.weekday()) % 7 or 7

        d = today + timedelta(days=delta)

        return d, d

    # explicit ISO date 2026-06-08
    iso = re.search(r"\b(20\d{2})-(\d{1,2})-(\d{1,2})\b", m)

    if iso:

        try:

            d = date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))

            return d, d

        except Exception:

            pass

    # "8th" / "8" / "june 8" — assume current month
    m_md = re.search(r"\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b", m)

    if m_md and not re.search(r"\d{2}:\d{2}", m):  # avoid times like "12:30"

        try:

            day = int(m_md.group(1))

            if 1 <= day <= 31:

                year, month = today.year, today.month

                # If day is in the past for this month, assume next month
                if day < today.day:

                    if month == 12:

                        year, month = year + 1, 1

                    else:

                        month += 1

                d = date(year, month, day)

                return d, d

        except Exception:

            pass

    return None, None


# =====================================================================
# Gemini fallback — for messages the regex couldn't parse
# =====================================================================

GEMINI_MODEL_CHAIN = [
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash"
]


def _gemini_parse(message: str, state: dict, today: date) -> Optional[dict]:
    """Ask Gemini to extract leave fields. Returns dict or None on failure."""

    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:

        return None

    try:

        import google.generativeai as genai

        genai.configure(api_key=api_key)

    except Exception:

        return None

    prompt = (
        "Extract leave-request fields from the user's message. "
        f"Today's date is {today.isoformat()}.\n\n"
        f"Current known state (may be partially filled from earlier messages):\n"
        f"{json.dumps(state, default=str)}\n\n"
        f"User message: {message!r}\n\n"
        "Reply with ONE LINE of JSON, no markdown. Use null for fields you "
        "can't determine. Don't overwrite existing non-null state values "
        "unless the user explicitly contradicts them.\n\n"
        '{ "leave_type": "CASUAL"|"SICK"|"EARNED"|"MATERNITY"|"UNPAID"|null,\n'
        '  "start_date": "YYYY-MM-DD"|null,\n'
        '  "end_date":   "YYYY-MM-DD"|null,\n'
        '  "is_half_day": true|false,\n'
        '  "reason": "extracted reason text"|null,\n'
        '  "intent": "request_leave"|"cancel"|"small_talk"|"unclear" }\n'
    )

    for model_name in GEMINI_MODEL_CHAIN:

        try:

            model = genai.GenerativeModel(model_name)

            resp = model.generate_content(prompt)

            raw = (resp.text or "").strip()

            # Strip code fences
            if raw.startswith("```"):

                raw = raw.strip("`")

                if raw.lower().startswith("json"):

                    raw = raw[4:].strip()

            try:

                parsed = json.loads(raw)

            except Exception:

                start = raw.find("{")
                end   = raw.rfind("}")
                if start == -1 or end <= start:
                    continue

                try:
                    parsed = json.loads(raw[start:end + 1])
                except Exception:
                    continue

            return parsed

        except Exception:

            continue

    return None


# =====================================================================
# State merger — combine regex + Gemini + prior state without losing info
# =====================================================================

REQUIRED_FIELDS_LEAVE = ("leave_type", "start_date", "end_date", "reason")


def _merge_state(prior: dict, new: dict) -> dict:
    """Non-destructive merge — new values overwrite null/empty prior."""

    out = dict(prior or {})

    for k in ("leave_type", "start_date", "end_date", "reason"):

        v = new.get(k)

        if v not in (None, "", "null"):

            out[k] = v

    # boolean fields use "set if explicitly true"
    if new.get("is_half_day") is True:

        out["is_half_day"] = True

    return out


def _normalize_dates(state: dict, today: date) -> dict:
    """If start_date is set but end_date isn't, default end = start."""

    out = dict(state)

    sd = out.get("start_date")

    ed = out.get("end_date")

    if sd and not ed:

        out["end_date"] = sd

    if isinstance(out.get("start_date"), str):

        try:

            out["start_date"] = datetime.fromisoformat(out["start_date"]).date().isoformat()

        except Exception:

            out["start_date"] = None

    if isinstance(out.get("end_date"), str):

        try:

            out["end_date"] = datetime.fromisoformat(out["end_date"]).date().isoformat()

        except Exception:

            out["end_date"] = None

    return out


# =====================================================================
# Validation — runs once all required fields are filled
# =====================================================================

def validate_request(
    db: Session,
    employee: Employee,
    state: dict,
    today: date
) -> dict:
    """Returns {ok, issues:[...], warnings:[...], balance:{...}}."""

    issues, warnings = [], []

    lt = (state.get("leave_type") or "").upper()

    if lt not in VALID_LEAVE_TYPES:

        issues.append(f"Invalid leave type '{lt}'. Must be one of {sorted(VALID_LEAVE_TYPES)}.")

        return {"ok": False, "issues": issues, "warnings": warnings, "balance": None}

    # Maternity gate
    if lt == "MATERNITY" and (employee.GENDER or "").upper().strip() != "FEMALE":

        issues.append("MATERNITY leave is only available to employees with GENDER=FEMALE on file.")

    # Date validation
    try:

        sd = datetime.fromisoformat(state["start_date"]).date()

        ed = datetime.fromisoformat(state["end_date"]).date()

    except Exception:

        issues.append("Invalid date format.")

        return {"ok": False, "issues": issues, "warnings": warnings, "balance": None}

    if sd > ed:

        issues.append("Start date must be on or before end date.")

    if sd < today:

        warnings.append(f"Start date {sd.isoformat()} is in the past — HR will need to back-date.")

    half_day = bool(state.get("is_half_day"))

    if half_day and sd != ed:

        issues.append("Half-day leave can only be applied for a single date.")

    days_needed = compute_days(sd, ed, half_day)

    # Balance check
    balance_info = None

    if lt in QUOTA_BACKED_TYPES:

        bal = get_or_create_balance(db, employee.ID)

        remaining = remaining_for_type(bal, lt)

        balance_info = {
            "type": lt,
            "remaining_before": remaining,
            "needed": days_needed,
            "remaining_after": round(remaining - days_needed, 1)
        }

        if days_needed > remaining:

            issues.append(
                f"Insufficient {lt} balance — you have {remaining} day(s) left, "
                f"this request needs {days_needed}."
            )

    # Overlap check
    overlap = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.EMPLOYEE_ID == employee.ID,
            LeaveRequest.STATUS.in_(["PENDING_APPROVAL", "APPROVED"]),
            LeaveRequest.START_DATE <= ed,
            LeaveRequest.END_DATE   >= sd,
            LeaveRequest.LEAVE_TYPE != "PERMISSION"
        )
        .first()
    )

    if overlap:

        issues.append(
            f"You already have an overlapping {overlap.LEAVE_TYPE} request "
            f"({overlap.START_DATE} → {overlap.END_DATE}, status: {overlap.STATUS})."
        )

    return {
        "ok": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "balance": balance_info,
        "days": days_needed
    }


# =====================================================================
# Main entry — full multi-turn message handler
# =====================================================================

def handle_message(
    db: Session,
    employee: Employee,
    message: str,
    prior_state: dict
) -> dict:
    """Process one chat message. Returns the response dict the frontend
    renders + a fresh state to echo back on the next turn.

    Response shape:
      {
        "reply":            "natural-language bot message",
        "state":            updated state dict,
        "missing":          ["leave_type", "reason", ...],
        "ready_to_submit":  bool,
        "validation":       {ok, issues, warnings, balance, days} | None,
        "suggestions":      ["Casual", "Sick", ...]   chip labels
      }
    """

    today = date.today()

    msg = (message or "").strip()

    # ---- Quick small-talk match ----
    low = msg.lower()

    if not msg or low in ("hi", "hello", "hey", "hai"):

        return _reply(
            "Hi! 👋 I'm your leave assistant. Tell me what you need — "
            "e.g. *'casual leave tomorrow for family function'* — and I'll "
            "fill the request for you.",
            state=prior_state or {},
            suggestions=LEAVE_TYPE_CHIPS
        )

    if re.search(r"\b(cancel|never\s*mind|forget)\b", low):

        return _reply(
            "Okay — request discarded. Start a new one whenever you're ready.",
            state={},
            suggestions=LEAVE_TYPE_CHIPS
        )

    # ---- 1) Try deterministic parsing first (free, fast) ----
    kw_parsed = {
        "leave_type":  _detect_leave_type_kw(msg),
        "is_half_day": _detect_half_day_kw(msg)
    }

    sd, ed = _detect_dates_kw(msg, today)

    if sd: kw_parsed["start_date"] = sd.isoformat()
    if ed: kw_parsed["end_date"]   = ed.isoformat()

    state = _merge_state(prior_state or {}, kw_parsed)

    # ---- 2) Fall back to Gemini for whatever's still missing ----
    needs_gemini = (
        not state.get("leave_type") or
        not state.get("start_date") or
        not state.get("reason")
    )

    if needs_gemini:

        gem = _gemini_parse(msg, state, today)

        if gem:

            state = _merge_state(state, gem)

    # If user typed something that looks like a reason but didn't get
    # parsed yet, capture the raw message as reason fallback
    if not state.get("reason") and len(msg) > 8:

        if not re.match(r"^(casual|sick|earned|maternity|unpaid|tomorrow|today|day after|next |\d)", low):

            state["reason"] = msg[:500]

    state = _normalize_dates(state, today)

    # ---- 3) Determine what's still missing ----
    missing = []

    if not state.get("leave_type"):  missing.append("leave_type")
    if not state.get("start_date"):  missing.append("start_date")
    if not state.get("reason"):      missing.append("reason")

    if missing:

        return _reply(
            _craft_clarify_prompt(state, missing),
            state=state,
            missing=missing,
            suggestions=_chips_for_missing(missing[0])
        )

    # ---- 4) All required fields present → validate ----
    validation = validate_request(db, employee, state, today)

    if not validation["ok"]:

        return _reply(
            "I can't submit this just yet:\n\n• " + "\n• ".join(validation["issues"]) +
            "\n\nWhat would you like to change?",
            state=state,
            missing=[],
            validation=validation,
            ready_to_submit=False,
            suggestions=LEAVE_TYPE_CHIPS
        )

    # ---- 5) Ready to submit ----
    sd = state["start_date"]
    ed = state["end_date"]

    days = validation["days"]

    bal_line = ""

    if validation.get("balance"):

        b = validation["balance"]

        bal_line = (
            f"\nYour {b['type']} balance: **{b['remaining_before']}d** → "
            f"**{b['remaining_after']}d** after this leave."
        )

    warn_line = ""

    if validation.get("warnings"):

        warn_line = "\n\n⚠ " + " · ".join(validation["warnings"])

    summary = (
        f"Ready to submit:\n\n"
        f"• **Type:** {state['leave_type']} LEAVE\n"
        f"• **Date:** {sd}" + (f" → {ed}" if ed != sd else "") +
        (" (half day)" if state.get("is_half_day") else f" ({days} day(s))") + "\n"
        f"• **Reason:** {state['reason']}"
        + bal_line + warn_line +
        "\n\nTap **Confirm & Submit** to send it for approval, or tell me what to change."
    )

    return _reply(
        summary,
        state=state,
        missing=[],
        ready_to_submit=True,
        validation=validation,
        suggestions=["Confirm & Submit", "Change date", "Change reason", "Cancel"]
    )


# =====================================================================
# Helpers — clarify prompts + suggestion chips per missing field
# =====================================================================

def _craft_clarify_prompt(state: dict, missing: list) -> str:

    first = missing[0]

    have = []

    if state.get("leave_type"):  have.append(f"type *{state['leave_type']}*")
    if state.get("start_date"):

        if state.get("end_date") and state["end_date"] != state["start_date"]:
            have.append(f"dates *{state['start_date']} → {state['end_date']}*")
        else:
            have.append(f"date *{state['start_date']}*")

    if state.get("reason"):       have.append(f"reason *{state['reason'][:40]}*")

    got_line = " · ".join(have) if have else ""

    prefix = f"Got: {got_line}.\n\n" if got_line else ""

    if first == "leave_type":

        return prefix + "What **type** of leave do you need?"

    if first == "start_date":

        return prefix + "Which **date(s)** do you need off? You can say *tomorrow*, *next monday*, *8th*, or *2026-06-15*."

    if first == "reason":

        return prefix + "What's the **reason**? (Manager will see this before approving.)"

    return prefix + "I need a bit more info — what would you like to specify?"


def _chips_for_missing(field: str) -> list:

    if field == "leave_type": return LEAVE_TYPE_CHIPS
    if field == "start_date": return ["Tomorrow", "Day after", "Next Monday"]
    if field == "reason":     return REASON_CHIPS
    return []


def _reply(
    text: str,
    state: dict = None,
    missing: list = None,
    ready_to_submit: bool = False,
    validation: dict = None,
    suggestions: list = None
) -> dict:

    return {
        "reply":           text,
        "state":           state or {},
        "missing":         missing or [],
        "ready_to_submit": ready_to_submit,
        "validation":      validation,
        "suggestions":     suggestions or []
    }
