"""
Gemini 2.5 Flash intent + entity extraction.

Gemini's only job here is to produce a strict JSON blob:

    {
      "intent": "<one of the allowed values>",
      "entities": { ... key/value pairs ... },
      "natural_reply": "<optional short phrasing>"
    }

The extractor:
  • enforces a JSON response schema (Gemini's `response_mime_type`)
  • falls back to a rule-based extractor if the API key is missing
    or the call fails, so the assistant degrades gracefully instead
    of 500'ing every request
  • is fully async — wraps the SDK in run_in_executor
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import date, timedelta
from typing import Optional

from app.voice_assistant.schemas import ExtractedIntent, SessionState


log = logging.getLogger("voice_assistant.intent")


GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
# gemini-2.5-flash if available on the account; the code falls back
# to whatever model_name env var says.


ALLOWED_INTENTS = [
    # Employee-scoped
    "leave_request",
    "permission_request",
    "attendance_regularization",
    "leave_balance",
    "payslip_request",
    "hr_policy",
    "profile_query",
    # Admin / HR-scoped
    "pending_approvals",
    "attendance_summary",
    "employee_lookup",
    # Meta
    "affirm",
    "deny",
    "cancel",
    "unknown",
]


SYSTEM_PROMPT = """You are the intent-extraction layer of an ERP voice assistant.

Your ONLY job is to read the employee's short spoken message and return a
strict JSON object with:

  intent:        one of the allowed values (see below)
  entities:      key/value pairs of anything useful you can extract
  natural_reply: OPTIONAL short conversational hint (<= 15 words)

You DO NOT execute any action. You DO NOT talk to a database. You DO NOT
guess policies. You only classify what the user MEANT and what values
they mentioned.

Allowed intents (pick exactly one):
  leave_request              — apply for a full/half-day leave
  permission_request         — apply for a sub-day hourly permission
  attendance_regularization  — request a fix to a wrong / missed punch
  leave_balance              — ask how many leave days are left
  payslip_request            — ask for a payslip / salary slip
  hr_policy                  — ask about HR policy / rules / holidays / working hours
  profile_query              — ask about own profile / department / manager / joining date

  Admin-only intents (for HR / managers):
  pending_approvals          — "how many pending leaves / approvals waiting"
  attendance_summary         — "attendance summary today", "who is absent today"
  employee_lookup            — "show me employee BVC008", "find employee Puviyarasi",
                                "details of employee <name/code>"

  Meta:
  affirm                     — "yes" / "submit" / "confirm" / "go ahead"
  deny                       — "no" / "not that" / "wait"
  cancel                     — "stop" / "cancel" / "never mind" / "forget it" / "thank you"
  unknown                    — anything else

Common entities to extract when the user mentions them:
  date               (ISO date; resolve "tomorrow" / "today" / "next Monday" using CONTEXT_DATE)
  start_date         (ISO)
  end_date           (ISO)
  leave_type         (one of CASUAL / SICK / EARNED / UNPAID / LOP)
  half_day           (true / false)
  half_day_slot      ("morning" or "afternoon")
  duration_hours     (float, only for permission)
  reason             (short free-text)
  month              (1..12)
  year               (yyyy)
  policy_topic       (e.g. "casual leave rules", "notice period")
  profile_field      (e.g. "manager", "designation", "joining date")

Respond with a single JSON object. NEVER wrap it in markdown.
"""


def is_configured() -> bool:
    return bool(GEMINI_API_KEY)


# =====================================================================
# Fallback (regex) extractor — used when Gemini is not configured or
# the API call fails. Keeps the voice loop working in dev / offline.
# =====================================================================

_LEAVE_TYPE_ALIASES = {
    "casual": "CASUAL", "cl": "CASUAL",
    "sick":   "SICK",   "sl": "SICK",   "medical": "SICK",
    "earned": "EARNED", "el": "EARNED", "annual":  "EARNED", "privilege": "EARNED",
    "unpaid": "UNPAID", "lop": "LOP",
}


def _resolve_relative_date(msg: str, today: date) -> Optional[str]:
    m = msg.lower()
    if "day after tomorrow" in m:
        return (today + timedelta(days=2)).isoformat()
    if "tomorrow" in m:
        return (today + timedelta(days=1)).isoformat()
    if "today" in m:
        return today.isoformat()
    if "yesterday" in m:
        return (today - timedelta(days=1)).isoformat()
    # "next monday" etc.
    for i, name in enumerate(
        ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
    ):
        if f"next {name}" in m:
            delta = (i - today.weekday()) % 7
            if delta == 0:
                delta = 7
            return (today + timedelta(days=delta)).isoformat()
    return None


def _fallback_extract(message: str, session: SessionState) -> ExtractedIntent:
    """Best-effort rule-based extractor. Only used when Gemini is offline."""
    msg = (message or "").strip().lower()
    today = date.today()
    entities: dict = {}

    # Cancel / affirm / deny — highest priority
    if re.search(r"\b(cancel|stop|never ?mind|forget it|thank ?you)\b", msg):
        return ExtractedIntent(intent="cancel", entities={})
    if re.search(r"\b(yes|yeah|yup|ok|okay|sure|submit|go ahead|confirm|please do)\b", msg):
        # If nothing else in the message, treat as affirm
        if len(msg.split()) <= 3:
            return ExtractedIntent(intent="affirm", entities={})
    if re.search(r"\b(no|nope|not now|wait|hold on)\b", msg) and len(msg.split()) <= 3:
        return ExtractedIntent(intent="deny", entities={})

    # Date
    d = _resolve_relative_date(msg, today)
    if d:
        entities["date"] = d
        entities["start_date"] = d
        entities["end_date"] = d

    # Leave type
    for kw, canonical in _LEAVE_TYPE_ALIASES.items():
        if re.search(rf"\b{kw}\b", msg):
            entities["leave_type"] = canonical
            break

    # Half-day
    if "half day" in msg or "half-day" in msg:
        entities["half_day"] = True
    if "morning" in msg:
        entities["half_day_slot"] = "morning"
    if "afternoon" in msg:
        entities["half_day_slot"] = "afternoon"

    # Reason cue words
    m = re.search(r"(?:because|for|reason(?: is)?)\s+(.+)$", msg)
    if m:
        entities["reason"] = m.group(1).strip().rstrip(".!?")

    # Intent — order matters. Check the more specific phrases first
    # so "leave policy" doesn't get eaten by the "leave" trigger.

    # Admin queries — matched BEFORE generic personal intents so
    # "pending approvals" doesn't fall into leave_request.
    if "pending" in msg and ("approval" in msg or "leave" in msg or "request" in msg):
        return ExtractedIntent(intent="pending_approvals", entities=entities)
    if ("attendance summary" in msg or "who is absent" in msg or "who's absent" in msg
        or "who is late" in msg or "who's late" in msg
        or "attendance today" in msg or "who is present" in msg):
        return ExtractedIntent(intent="attendance_summary", entities=entities)
    if (re.search(r"\b(show|find|lookup|details of|about)\b.*\bemployee\b", msg)
        or re.search(r"\bemployee\s+[a-z]{2,4}\d{2,6}\b", msg)):
        entities["employee_query"] = message
        return ExtractedIntent(intent="employee_lookup", entities=entities)

    # HR policy
    if "policy" in msg or "notice period" in msg or "working hours" in msg or "holiday" in msg:
        return ExtractedIntent(intent="hr_policy", entities=entities)
    if "permission" in msg:
        return ExtractedIntent(intent="permission_request", entities=entities)
    if "regular" in msg and ("punch" in msg or "attendance" in msg or "check" in msg):
        return ExtractedIntent(intent="attendance_regularization", entities=entities)
    if ("balance" in msg or "how many" in msg) and "leave" in msg:
        return ExtractedIntent(intent="leave_balance", entities=entities)
    if "payslip" in msg or "salary slip" in msg or "pay slip" in msg:
        return ExtractedIntent(intent="payslip_request", entities=entities)
    if "manager" in msg or "designation" in msg or "joining" in msg or "profile" in msg or "my department" in msg or "my code" in msg:
        return ExtractedIntent(intent="profile_query", entities=entities)
    if "leave" in msg or "off tomorrow" in msg or "day off" in msg:
        return ExtractedIntent(intent="leave_request", entities=entities)

    return ExtractedIntent(intent="unknown", entities=entities)


# =====================================================================
# Gemini call (async wrapper around the sync SDK)
# =====================================================================

def _sync_gemini_extract(message: str, context_date_iso: str,
                         history_lines: str) -> Optional[ExtractedIntent]:
    """Blocking call. Returns None on any failure so the caller can
    decide to fall back."""
    try:
        import google.generativeai as genai
    except Exception as exc:
        log.warning("google-generativeai not installed: %s", exc)
        return None

    try:
        genai.configure(api_key=GEMINI_API_KEY)

        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            system_instruction=SYSTEM_PROMPT + f"\n\nCONTEXT_DATE: {context_date_iso}",
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.1,
            },
        )

        prompt = (
            "Recent conversation (most recent last):\n"
            f"{history_lines or '(none)'}\n\n"
            f"Current user message: {message}\n\n"
            "Return the JSON now."
        )

        resp = model.generate_content(prompt)
        raw = (resp.text or "").strip()
        # Strip markdown fence if the model wrapped anyway
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?", "", raw)
            raw = re.sub(r"```$", "", raw).strip()
        data = json.loads(raw)

        intent = str(data.get("intent") or "unknown").strip().lower()
        if intent not in ALLOWED_INTENTS:
            intent = "unknown"
        entities = data.get("entities") or {}
        if not isinstance(entities, dict):
            entities = {}
        natural = data.get("natural_reply")
        if natural is not None:
            natural = str(natural)

        return ExtractedIntent(
            intent=intent,
            entities=entities,
            natural_reply=natural,
        )
    except Exception as exc:
        log.warning("Gemini extract failed: %s", exc)
        return None


async def extract_intent(message: str, session: SessionState) -> ExtractedIntent:
    """Public entry — always returns a valid ExtractedIntent."""
    today_iso = date.today().isoformat()

    history_lines = "\n".join(
        f"{turn.get('role','?')}: {turn.get('text','')}"
        for turn in session.history[-6:]
    )

    if is_configured():
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None, _sync_gemini_extract, message, today_iso, history_lines,
        )
        if result is not None:
            return result
        log.info("Gemini returned no result — using fallback extractor")

    return _fallback_extract(message, session)
