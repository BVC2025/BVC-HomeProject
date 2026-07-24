"""
Employee self-onboarding chatbot — field catalogue + Gemini-driven
helpers with smart widget hints, mirroring the structure of
`onboarding_ai_service.py` (customer onboarding) but tailored to
the EMPLOYEE form.

Each FIELD entry carries:
  - key            backend column name
  - label          friendly question text shown to the candidate
  - widget         text | choice | date | number | textarea
  - options        list of allowed values when widget = "choice"
  - required       whether it's mandatory for "complete"
  - section        PERSONAL | CONTACT | EDUCATION | PROFESSIONAL | ADDITIONAL
  - max_length     soft cap for string columns
  - secret         True for password fields
  - suggestions    optional quick-pick chips (e.g. for SKILLS)

Public API surfaced to the chat route:
  FIELDS, SKIPPED_KEY, MAX_LENGTHS, GEMINI_MODEL_FALLBACKS,
  next_unanswered_field(), safe_truncate(), build_chatbot_question(),
  parse_user_reply(), call_gemini(), rule_based_acknowledge(),
  progress_pct().

PHOTO_URL is uploaded separately via an HTTP endpoint — NOT asked
in chat.

Admin-only fields (ROLE_ID, DEPARTMENT_ID, DESIGNATION_ID, SALARY,
SHIFT_START, SHIFT_END, REPORTING_MANAGER_ID, VENDOR_ID) are filled
during approval — NEVER by the chatbot.
"""

import os
import re
import random
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple


# ----------------------------------------------------------------
# Sentinel keys
# ----------------------------------------------------------------

# Reserved key inside PARTIAL_DATA — stores the list of field keys
# the candidate chose to skip. Skipped fields are NOT asked again
# but still appear in the Pending list (with a "Skipped" hint) so
# the candidate can revisit later.
SKIPPED_KEY = "__skipped__"


# ----------------------------------------------------------------
# Field catalogue
# ----------------------------------------------------------------

FIELDS: List[dict] = [
    # ---------- PERSONAL ----------
    {
        "key": "EMPLOYEE_CODE",
        "label": "Do you have an employee code from your invite? (skip if not)",
        "widget": "text",
        "required": False,
        "max_length": 30,
        "section": "PERSONAL",
    },
    {
        "key": "NAME",
        "label": "What is your full name?",
        "widget": "text",
        "required": True,
        "max_length": 150,
        "section": "PERSONAL",
    },
    {
        "key": "FATHER_NAME",
        "label": "What is your father's name?",
        "widget": "text",
        "required": False,
        "max_length": 150,
        "section": "PERSONAL",
    },
    {
        "key": "MOTHER_NAME",
        "label": "What is your mother's name?",
        "widget": "text",
        "required": False,
        "max_length": 150,
        "section": "PERSONAL",
    },
    {
        "key": "DOB",
        "label": "What is your date of birth? (DD/MM/YYYY)",
        "widget": "date",
        "required": False,
        "section": "PERSONAL",
    },
    {
        "key": "GENDER",
        "label": "What is your gender?",
        "widget": "choice",
        "options": ["Male", "Female", "Other", "Prefer not to say"],
        "required": False,
        "max_length": 30,
        "section": "PERSONAL",
    },
    {
        "key": "MARITAL_STATUS",
        "label": "What is your marital status?",
        "widget": "choice",
        "options": ["Single", "Married", "Divorced", "Widowed"],
        "required": False,
        "max_length": 20,
        "section": "PERSONAL",
    },
    {
        "key": "OCCUPATION",
        "label": "What is your current profession? (e.g. Mechanical Technician)",
        "widget": "text",
        "required": False,
        "max_length": 100,
        "section": "PERSONAL",
    },

    # ---------- CONTACT & LOGIN ----------
    {
        "key": "PHONE",
        "label": "What is your mobile / phone number?",
        "widget": "text",
        "required": True,
        "max_length": 50,
        "section": "CONTACT",
    },
    {
        "key": "EMAIL",
        "label": "What is your email address? (you can skip if you don't have one)",
        "widget": "text",
        "required": False,
        "max_length": 255,
        "section": "CONTACT",
    },
    {
        "key": "ADDRESS",
        "label": "What is your current residential address?",
        "widget": "textarea",
        "required": False,
        "max_length": 500,
        "section": "CONTACT",
    },
    {
        "key": "CITY",
        "label": "Which city are you based in?",
        "widget": "text",
        "required": False,
        "max_length": 100,
        "section": "CONTACT",
    },
    {
        "key": "STATE",
        "label": "Which state?",
        "widget": "text",
        "required": False,
        "max_length": 100,
        "section": "CONTACT",
    },
    {
        "key": "PINCODE",
        "label": "What is your pincode? (6 digits)",
        "widget": "text",
        "required": False,
        "max_length": 10,
        "section": "CONTACT",
    },
    {
        "key": "PASSWORD",
        "label": "Please choose a login password (at least 6 characters).",
        "widget": "text",
        "required": True,
        "secret": True,
        "max_length": 128,
        "section": "CONTACT",
    },

    # ---------- EDUCATION ----------
    {
        "key": "QUALIFICATION",
        "label": "What is your highest qualification?",
        "widget": "text",
        "required": False,
        "max_length": 150,
        "section": "EDUCATION",
    },
    {
        "key": "YEAR_OF_PASSING",
        "label": "Which year did you complete it? (4-digit year)",
        "widget": "number",
        "required": False,
        "section": "EDUCATION",
    },

    # ---------- PROFESSIONAL ----------
    {
        "key": "EMPLOYMENT_TYPE",
        "label": "Are you a fresher or experienced?",
        "widget": "choice",
        "options": ["FRESHER", "EXPERIENCED"],
        "required": False,
        "max_length": 20,
        "section": "PROFESSIONAL",
    },
    {
        "key": "EXPERIENCE_YEARS",
        "label": "How many years of work experience do you have?",
        "widget": "number",
        "required": False,
        "default": 0,
        "section": "PROFESSIONAL",
    },
    {
        "key": "SKILLS",
        "label": "What are your key skills? (comma-separated, e.g. Solidworks, AutoCAD, Welding)",
        "widget": "text",
        "required": False,
        "max_length": 500,
        "section": "PROFESSIONAL",
        "suggestions": [
            "Solidworks", "AutoCAD", "Wiring", "Assembly", "Welding",
            "Python", "JavaScript", "Quality Check", "CNC", "Soldering",
        ],
    },
    {
        "key": "EXPERIENCE_DETAILS",
        "label": "Briefly describe your work experience. (you can skip)",
        "widget": "textarea",
        "required": False,
        "max_length": 2000,
        "section": "PROFESSIONAL",
    },
    {
        "key": "PAST_PROJECTS",
        "label": "Any notable past projects you'd like to mention? (you can skip)",
        "widget": "textarea",
        "required": False,
        "max_length": 2000,
        "section": "PROFESSIONAL",
    },

    # ---------- ADDITIONAL ----------
    {
        "key": "NOTES",
        "label": "Anything else you'd like the team to know? (optional)",
        "widget": "textarea",
        "required": False,
        "max_length": 2000,
        "section": "ADDITIONAL",
    },
]


# ----------------------------------------------------------------
# Per-field maximum length — matches the Employee model columns.
# ----------------------------------------------------------------
MAX_LENGTHS: Dict[str, int] = {
    "EMPLOYEE_CODE":       30,
    "NAME":               150,
    "FATHER_NAME":        150,
    "MOTHER_NAME":        150,
    "GENDER":              30,
    "MARITAL_STATUS":      20,
    "OCCUPATION":         100,
    "PHONE":               50,
    "EMAIL":              255,
    "ADDRESS":            500,
    "CITY":               100,
    "STATE":              100,
    "PINCODE":             10,
    "PASSWORD":           128,
    "QUALIFICATION":      150,
    "EMPLOYMENT_TYPE":     20,
    "SKILLS":             500,
    "EXPERIENCE_DETAILS":2000,
    "PAST_PROJECTS":     2000,
    "NOTES":             2000,
}


# ----------------------------------------------------------------
# Gemini configuration (mirrors customer onboarding service)
# ----------------------------------------------------------------

GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()

GEMINI_MODEL_FALLBACKS: List[str] = [
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-1.5-flash",
]

_user_model = (os.getenv("GEMINI_MODEL") or "").strip()

if _user_model:

    GEMINI_MODEL_FALLBACKS = (
        [_user_model]
        + [m for m in GEMINI_MODEL_FALLBACKS if m != _user_model]
    )

GEMINI_MODEL = GEMINI_MODEL_FALLBACKS[0]


def is_gemini_configured() -> bool:

    return bool(GEMINI_API_KEY)


# ----------------------------------------------------------------
# Field helpers
# ----------------------------------------------------------------

def field_meta(key: str) -> Optional[dict]:

    for f in FIELDS:

        if f["key"] == key:

            return f

    return None


def all_keys() -> List[str]:

    return [f["key"] for f in FIELDS]


def required_keys() -> List[str]:

    return [f["key"] for f in FIELDS if f.get("required")]


def _coerce_skipped(skipped) -> set:
    """Accept either a set, list, or None and return a set of keys."""

    if skipped is None:

        return set()

    if isinstance(skipped, set):

        return skipped

    if isinstance(skipped, (list, tuple)):

        return set(s for s in skipped if s)

    return set()


def next_unanswered_field(
    collected: Dict[str, Any],
    skipped
) -> Optional[dict]:
    """Walk FIELDS in catalogue order and return the first one that
    is neither in `collected` nor in `skipped`. Returns None when
    every field has been handled."""

    collected = collected or {}

    skip = _coerce_skipped(skipped)

    for f in FIELDS:

        key = f["key"]

        if key in skip:

            continue

        val = collected.get(key)

        if val in (None, ""):

            return f

    return None


def safe_truncate(key: str, value: Any) -> str:
    """Apply MAX_LENGTHS to a single value. Never raises. Returns
    a string (empty string if value is falsy)."""

    if value is None:

        return ""

    s = str(value)

    limit = MAX_LENGTHS.get(key)

    if limit and len(s) > limit:

        return s[:limit]

    return s


def progress_pct(
    collected: Dict[str, Any],
    skipped
) -> float:
    """Fraction (0.0 — 1.0) of FIELDS that are 'done', where done
    means either collected (non-empty) or explicitly skipped."""

    if not FIELDS:

        return 0.0

    collected = collected or {}

    skip = _coerce_skipped(skipped)

    done = 0

    for f in FIELDS:

        key = f["key"]

        if key in skip:

            done += 1

            continue

        if collected.get(key) not in (None, ""):

            done += 1

    return round(done / len(FIELDS), 4)


# ----------------------------------------------------------------
# Question builder
# ----------------------------------------------------------------

def build_chatbot_question(field: dict, hint: str = "") -> str:
    """Generate a friendly question for the chat UI. For choice
    widgets, options are appended inline so the rule-based path
    works even without a UI render."""

    if not field:

        return "Could you share that detail?"

    label = field.get("label") or "Could you share that detail?"

    parts = []

    if hint:

        parts.append(hint.strip())

    parts.append(label)

    if field.get("widget") == "choice" and field.get("options"):

        opts = ", ".join(field["options"])

        parts.append(f"(Options: {opts})")

    if field.get("widget") == "number":

        # Hint for numeric input — non-intrusive
        pass

    if field.get("secret"):

        parts.append("(this will be stored securely)")

    return " ".join(p for p in parts if p).strip()


# ----------------------------------------------------------------
# Parsers / validators — every parser returns (ok, value, err)
# and NEVER raises.
# ----------------------------------------------------------------

_EMAIL_RE   = re.compile(r"^[\w\.\-\+]+@[\w\.\-]+\.[A-Za-z]{2,}$")
_PHONE_RE   = re.compile(r"^\+?\d[\d\s\-]{6,20}$")
_PINCODE_RE = re.compile(r"^\d{6}$")
_NUMBER_RE  = re.compile(r"-?\d+(?:\.\d+)?")
_YEAR_RE    = re.compile(r"\b(19|20)\d{2}\b")


_DATE_FORMATS = [
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%Y-%m-%d",
    "%d/%m/%y",
    "%d.%m.%Y",
]


def _parse_date(raw: str) -> Optional[str]:
    """Try common date formats and return ISO YYYY-MM-DD, or None."""

    if not raw:

        return None

    s = raw.strip()

    for fmt in _DATE_FORMATS:

        try:

            dt = datetime.strptime(s, fmt)

            return dt.strftime("%Y-%m-%d")

        except (ValueError, TypeError):

            continue

    return None


def _match_choice(field: dict, raw: str) -> Optional[str]:
    """Match raw against the field's options (case-insensitive,
    also accepts a unique prefix of length >= 2)."""

    if not field.get("options"):

        return None

    s = (raw or "").strip().lower()

    if not s:

        return None

    # Exact match
    for opt in field["options"]:

        if str(opt).lower() == s:

            return opt

    # Prefix match (must be unambiguous)
    if len(s) >= 2:

        prefix_hits = [
            opt for opt in field["options"]
            if str(opt).lower().startswith(s)
        ]

        if len(prefix_hits) == 1:

            return prefix_hits[0]

    return None


def parse_user_reply(
    field: dict,
    raw_text: str
) -> Tuple[bool, Optional[Any], Optional[str]]:
    """Validate & normalise the candidate's reply for one field.

    Returns (accepted, normalised_value, error_message).
    - accepted=True, value=<normalised>, error=None — store it
    - accepted=False, value=None, error=<friendly msg>          — re-ask

    Never raises."""

    if not field:

        return (False, None, "Sorry, I lost track of which field this was — could you try again?")

    if raw_text is None:

        return (False, None, "Could you repeat that, please?")

    raw = str(raw_text).strip()

    if not raw:

        return (False, None, "It looks empty — could you share that detail?")

    key = field["key"]

    widget = field.get("widget", "text")

    # ---- Choice ----
    if widget == "choice":

        matched = _match_choice(field, raw)

        if matched is None:

            opts = ", ".join(field.get("options", []))

            return (False, None,
                    f"I didn't recognise that — could you pick one of: {opts}?")

        return (True, matched, None)

    # ---- Date ----
    if widget == "date" or key == "DOB":

        iso = _parse_date(raw)

        if not iso:

            return (False, None,
                    "That date format didn't parse — could you share it as "
                    "DD/MM/YYYY (e.g. 14/08/1995)?")

        return (True, iso, None)

    # ---- Number ----
    if widget == "number" or key in ("YEAR_OF_PASSING", "EXPERIENCE_YEARS"):

        if key == "YEAR_OF_PASSING":

            m = _YEAR_RE.search(raw)

            if not m:

                # Try plain 4-digit
                m2 = re.match(r"^\d{4}$", raw)

                if not m2:

                    return (False, None,
                            "Could you share the year as 4 digits, e.g. 2019?")

                return (True, int(m2.group(0)), None)

            return (True, int(m.group(0)), None)

        m = _NUMBER_RE.search(raw)

        if not m:

            return (False, None, "Could you share that as a number?")

        try:

            val = float(m.group(0))

            if val == int(val):

                val = int(val)

            return (True, val, None)

        except (ValueError, TypeError):

            return (False, None, "Could you share that as a number?")

    # ---- Email ----
    if key == "EMAIL":

        if not _EMAIL_RE.match(raw):

            return (False, None,
                    "That doesn't look like a valid email — could you "
                    "double-check?")

        return (True, safe_truncate(key, raw), None)

    # ---- Phone ----
    if key == "PHONE":

        cleaned = re.sub(r"[\s\-]", "", raw)

        if not _PHONE_RE.match(raw) and not re.match(r"^\+?\d{7,15}$", cleaned):

            return (False, None,
                    "That looks a bit off — could you share a valid "
                    "phone number (digits, optional + country code)?")

        return (True, safe_truncate(key, raw), None)

    # ---- Pincode ----
    if key == "PINCODE":

        m = re.search(r"\b\d{6}\b", raw)

        if not m:

            return (False, None, "Pincode should be exactly 6 digits.")

        return (True, m.group(0), None)

    # ---- Password ----
    if field.get("secret") or key == "PASSWORD":

        if len(raw) < 6:

            return (False, None,
                    "Password should be at least 6 characters long.")

        return (True, safe_truncate(key, raw), None)

    # ---- Year-of-passing safety net ----
    if key == "YEAR_OF_PASSING":

        m = re.match(r"^\d{4}$", raw)

        if not m:

            return (False, None,
                    "Could you share the year as 4 digits, e.g. 2019?")

        return (True, int(m.group(0)), None)

    # ---- Text / textarea (default) ----
    return (True, safe_truncate(key, raw), None)


# ----------------------------------------------------------------
# Gemini call (with quota fallback chain)
# ----------------------------------------------------------------

def _is_quota_error(exc: Exception) -> bool:

    msg = str(exc).lower()

    return (
        "429" in msg
        or "quota" in msg
        or "rate" in msg
        or "exhaust" in msg
    )


def call_gemini(prompt: str, history: List[dict]) -> str:
    """Send `prompt` to Gemini using the model fallback chain.

    On total failure (no API key, every model throttled, network
    error) returns an empty string — the caller should treat that
    as 'use the rule-based acknowledge'. Never raises."""

    if not is_gemini_configured():

        return ""

    try:

        import google.generativeai as genai

    except Exception:

        return ""

    try:

        genai.configure(api_key=GEMINI_API_KEY)

    except Exception:

        return ""

    gemini_history = []

    for h in (history or [])[-10:]:

        role = h.get("ROLE") or h.get("role")

        content = h.get("CONTENT") or h.get("content") or ""

        if role == "user":

            gemini_history.append({"role": "user", "parts": [content]})

        elif role == "assistant":

            gemini_history.append({"role": "model", "parts": [content]})

    last_exc: Optional[Exception] = None

    for model_name in GEMINI_MODEL_FALLBACKS:

        try:

            model = genai.GenerativeModel(model_name=model_name)

            chat = model.start_chat(history=gemini_history)

            response = chat.send_message(prompt)

            try:

                text = response.text or ""

            except Exception:

                text = ""

                for cand in getattr(response, "candidates", []):

                    for part in getattr(cand.content, "parts", []):

                        text += getattr(part, "text", "")

            if text:

                return text.strip()

            return ""

        except Exception as exc:

            last_exc = exc

            if _is_quota_error(exc):

                continue

            # Non-quota error — bail silently
            return ""

    # Every model exhausted
    return ""


# ----------------------------------------------------------------
# Rule-based acknowledgement (no-AI fallback)
# ----------------------------------------------------------------

_ACK_PREFIXES = [
    "Got it.",
    "Perfect.",
    "Noted.",
    "Thanks!",
    "Great.",
    "Wonderful.",
    "Excellent.",
]


def rule_based_acknowledge(
    field: dict,
    value: Any,
    next_field: Optional[dict]
) -> str:
    """Compose a friendly acknowledgement + the next question.
    Used when Gemini is unavailable, throttled, or returns nothing."""

    prefix = random.choice(_ACK_PREFIXES)

    if next_field is None:

        return (
            f"{prefix} That's everything I needed — please review and "
            "submit your details whenever you're ready."
        )

    next_q = build_chatbot_question(next_field)

    return f"{prefix} {next_q}"


# ----------------------------------------------------------------
# Opening message helper (small convenience for the route)
# ----------------------------------------------------------------

def opening_message(collected: Dict[str, Any], skipped=None) -> str:

    nxt = next_unanswered_field(collected or {}, skipped)

    if nxt is None:

        return (
            "Welcome back! You've already filled in everything. "
            "Please review and submit when ready."
        )

    if not collected:

        return (
            "Welcome! I'll help you complete your employee profile "
            "with a few quick questions. " + build_chatbot_question(nxt)
        )

    return "Welcome back! Let's continue. " + build_chatbot_question(nxt)
