"""Voice-first Recruitment Requisition agent — Qwen-powered.

HR speaks (Tamil / English / Thanglish) a hiring request; this service
interprets the utterance, extracts the structured fields we need to
create a `RecruitmentRequisition`, and returns either:

  - action=NEED_MORE      : one clarifying question, spoken back.
  - action=PROPOSE_DRAFT  : all critical fields captured; user
                             confirms verbally, then the route calls
                             the requisition-create helper.

Model: Qwen 2.5 72B Instruct via OpenRouter's free tier
(qwen/qwen-2.5-72b-instruct:free). No SDK, just HTTP — same pattern
this codebase already uses for send_via_resend etc.

Falls back to a smaller Qwen model on rate-limit, then to a plain
regex extraction so the agent still degrades usefully if every
model is offline / the OPENROUTER_API_KEY is missing.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------
# OpenRouter model fallback chain
# ---------------------------------------------------------------------
# OpenRouter deprecates free-tier variants often — chain includes
# current (Sep 2026) and older names so the agent survives silent
# retirements. Accuracy first, small-and-fast second.
QWEN_MODEL_FALLBACKS = [
    # Verified free-tier IDs that OpenRouter currently serves.
    # Order = accuracy first, small-and-fast last.
    "meta-llama/llama-3.3-70b-instruct:free",
    "qwen/qwen-2.5-72b-instruct:free",
    "google/gemma-2-9b-it:free",
    "mistralai/mistral-7b-instruct:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "microsoft/phi-3-mini-128k-instruct:free",
]


# In-process ring buffer of the last 12 LLM tries, exposed at
# GET /recruitment/voice-agent/agent/health for quick triage
# when the frontend shows "regex-fallback".
LAST_ERRORS: List[Dict[str, Any]] = []


def _record_attempt(model: str, ok: bool, detail: str) -> None:
    entry = {"model": model, "ok": ok, "detail": detail[:400]}
    LAST_ERRORS.append(entry)
    while len(LAST_ERRORS) > 12:
        LAST_ERRORS.pop(0)
    import sys
    print(f"[voice-agent] {model} · {'OK' if ok else 'FAIL'} · {detail[:200]}",
          file=sys.stderr, flush=True)


# ---------------------------------------------------------------------
# System prompt — the agent's whole brain
# ---------------------------------------------------------------------

SYSTEM_PROMPT = """You are Deepthi, the BVC24 Recruitment Requisition
voice agent. Introduce yourself as Deepthi whenever the conversation
calls for a name — never say "BVC24 assistant" or "AI agent".

Your ONE job: help HR / a department head raise a new hiring
requisition by SPEAKING. HR describes what role they want to fill;
you extract the structured fields and, when you have enough, propose
a draft. HR confirms verbally, then the app creates the requisition.

LANGUAGE RULE (strict):
- Detect the language HR opens in — English, Tamil (தமிழ்), or
  Thanglish (Tamil written in Latin script). Reply in the SAME
  language / style. Never switch on your own.

FIELDS YOU MUST CAPTURE (critical — cannot draft without these):
  1. POSITION_TITLE       — the role (e.g. "Assembly Technician")
  2. DEPARTMENT           — the department (e.g. "Production", "IT")
  3. HEADCOUNT            — how many candidates (integer, default 1)

FIELDS YOU SHOULD CAPTURE (nice-to-have — draft can proceed without):
  4. EXPERIENCE_MIN_YEARS — min years of experience (default 0)
  5. EXPERIENCE_MAX_YEARS — max years of experience (nullable)
  6. REQUIRED_EDUCATION   — degree / qualification
  7. REQUIRED_SKILLS      — comma-separated skills the candidate MUST have
  8. PREFERRED_SKILLS     — comma-separated bonus / preferred skills
  9. LOCATION             — city / site (default: Coimbatore, Tamil Nadu)
 10. EMPLOYMENT_TYPE      — FULL_TIME (default) | PART_TIME | CONTRACT | INTERN
 11. URGENCY              — NORMAL (default) | HIGH | URGENT
 12. BUDGET_CTC_MIN       — minimum annual CTC in rupees (e.g. 240000)
 13. BUDGET_CTC_MAX       — maximum annual CTC in rupees (e.g. 420000)
 14. NEEDED_BY_DATE       — target join date in YYYY-MM-DD format
 15. JUSTIFICATION        — one-sentence business reason

CONVERSATION FLOW:
- On the first turn, if HR gave the 3 critical fields, jump straight
  to action=PROPOSE_DRAFT.
- If any of the 3 critical fields is missing, action=NEED_MORE and
  ASK ONE QUESTION at a time (never a checklist). Warm, brief.
- For nice-to-have fields, only ask if HR hasn't mentioned them AND
  you have room. Otherwise just leave the field blank in the draft —
  HR can fill it later in the review screen.
- Once you have all 3 critical fields, ALWAYS emit PROPOSE_DRAFT and
  summarize what you captured. Never ask a 4th question after the
  critical trio is complete.

OUTPUT FORMAT — JSON ONLY, no prose, no markdown fences:
{
  "reply": "<what to speak back — brief, warm, in HR's language>",
  "action": "NEED_MORE" | "PROPOSE_DRAFT",
  "draft": {                              // only when action=PROPOSE_DRAFT
    "POSITION_TITLE":       "string",
    "DEPARTMENT":           "string",
    "HEADCOUNT":            <int>,
    "EXPERIENCE_MIN_YEARS": <number>,
    "EXPERIENCE_MAX_YEARS": <number|null>,
    "REQUIRED_EDUCATION":   "string|null",
    "REQUIRED_SKILLS":      "string|null",
    "PREFERRED_SKILLS":     "string|null",
    "LOCATION":             "string",
    "EMPLOYMENT_TYPE":      "FULL_TIME",
    "URGENCY":              "NORMAL",
    "BUDGET_CTC_MIN":       <number|null>,
    "BUDGET_CTC_MAX":       <number|null>,
    "NEEDED_BY_DATE":       "YYYY-MM-DD|null",
    "JUSTIFICATION":        "string|null"
  }
}

EXAMPLES:

HR: "Production department la Assembly ku rendu candidate venum,
     Diploma mudichirukanum, welding theriyanum."
You: {
  "reply": "Sari — Production department la Assembly Technician
            role, rendu candidates, Diploma qualification, welding
            skill. Idha requisition-a create panalaama?",
  "action": "PROPOSE_DRAFT",
  "draft": {
    "POSITION_TITLE": "Assembly Technician",
    "DEPARTMENT": "Production",
    "HEADCOUNT": 2,
    "EXPERIENCE_MIN_YEARS": 0,
    "EXPERIENCE_MAX_YEARS": null,
    "REQUIRED_EDUCATION": "Diploma",
    "REQUIRED_SKILLS": "Welding",
    "LOCATION": "Coimbatore",
    "EMPLOYMENT_TYPE": "FULL_TIME",
    "URGENCY": "NORMAL",
    "JUSTIFICATION": null
  }
}

HR: "IT team ku oru developer venum."
You: {
  "reply": "Sari, IT team ku oru developer. Ena role — frontend,
            backend, illa full-stack?",
  "action": "NEED_MORE"
}

HR: "I need one senior backend engineer for the IT team,
     5 to 8 years, Python and FastAPI must, MySQL preferred."
You: {
  "reply": "Got it — IT team, one Senior Backend Engineer,
            5 to 8 years experience, Python and FastAPI required,
            MySQL preferred. Shall I create the requisition?",
  "action": "PROPOSE_DRAFT",
  "draft": {
    "POSITION_TITLE": "Senior Backend Engineer",
    "DEPARTMENT": "IT",
    "HEADCOUNT": 1,
    "EXPERIENCE_MIN_YEARS": 5,
    "EXPERIENCE_MAX_YEARS": 8,
    "REQUIRED_EDUCATION": null,
    "REQUIRED_SKILLS": "Python, FastAPI, MySQL",
    "LOCATION": "Coimbatore",
    "EMPLOYMENT_TYPE": "FULL_TIME",
    "URGENCY": "NORMAL",
    "JUSTIFICATION": null
  }
}
"""


# ---------------------------------------------------------------------
# OpenRouter HTTP call — no SDK
# ---------------------------------------------------------------------

def _call_openrouter(
    system_prompt: str,
    messages: List[Dict[str, str]],
    api_key: str,
    model: str,
) -> Optional[str]:
    """Single-model call. Returns the raw response text, or None
    on any failure. Records the outcome in LAST_ERRORS so the
    health endpoint can surface why the LLM was skipped."""

    # Try WITH strict JSON mode first; if the model rejects
    # response_format (some free models do), retry without it.
    base_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            *messages,
        ],
        "temperature": 0.3,
        "max_tokens": 600,
    }

    for attempt in (
        {**base_payload, "response_format": {"type": "json_object"}},
        base_payload,
    ):
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=json.dumps(attempt).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://bvc24.local",
                "X-Title": "BVC24 Recruitment Voice Agent",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8")[:400]
            except Exception:
                pass
            _record_attempt(model, False, f"HTTP {e.code} · {err_body or str(e)}")
            # Retry-without-json on 400 (schema rejection); bail
            # on 401/402/403 (auth / billing / permission).
            if e.code == 400 and "response_format" in attempt:
                continue
            return None
        except (urllib.error.URLError, TimeoutError) as e:
            _record_attempt(model, False, f"network · {e}")
            return None
        except Exception as e:
            _record_attempt(model, False, f"crashed · {e!r}")
            return None

        try:
            data = json.loads(body)
            choices = data.get("choices") or []
            if not choices:
                _record_attempt(model, False, f"no choices · {body[:200]}")
                return None
            msg = (choices[0].get("message") or {}).get("content") or ""
            msg = msg.strip()
            if not msg:
                _record_attempt(model, False, "empty content")
                return None
            _record_attempt(model, True, f"{len(msg)} chars")
            return msg
        except json.JSONDecodeError:
            _record_attempt(model, False, f"non-JSON reply · {body[:200]}")
            return None

    return None


# ---------------------------------------------------------------------
# Regex fallback — degrades gracefully when the LLM is offline
# ---------------------------------------------------------------------

_NUM_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "oru": 1, "rendu": 2, "moonu": 3, "moondru": 3, "naanku": 4,
    "aindhu": 5, "aaru": 6,
}


def _parse_inr(text: str) -> Optional[int]:
    """'2,40,000' / '₹2.4L' / '2.4 lakh' / '4.2 lpa' → integer rupees."""
    t = text.lower().replace("rs.", "").replace("rs ", "").replace("₹", "")
    t = t.replace(",", "").strip()
    m = re.search(r"(\d+(?:\.\d+)?)\s*(l|lakh|lakhs|lpa)", t)
    if m:
        return int(float(m.group(1)) * 100000)
    m = re.search(r"(\d+(?:\.\d+)?)\s*(cr|crore|crores)", t)
    if m:
        return int(float(m.group(1)) * 10000000)
    # Bare number ≥ 1000 — assume rupees per annum
    m = re.search(r"\b(\d{4,})\b", t)
    if m:
        return int(m.group(1))
    return None


def _regex_extract(utterance: str) -> Dict[str, Any]:
    """Last-resort field extraction so the agent isn't completely
    dumb when the LLM is unreachable. Handles rich, structured
    voice / text inputs that mention multiple fields."""

    original = utterance
    t = utterance.lower()
    draft: Dict[str, Any] = {
        "POSITION_TITLE": None,
        "DEPARTMENT": None,
        "HEADCOUNT": 1,
        "EXPERIENCE_MIN_YEARS": 0,
        "EXPERIENCE_MAX_YEARS": None,
        "REQUIRED_EDUCATION": None,
        "REQUIRED_SKILLS": None,
        "PREFERRED_SKILLS": None,
        "LOCATION": "Coimbatore, Tamil Nadu",
        "EMPLOYMENT_TYPE": "FULL_TIME",
        "URGENCY": "NORMAL",
        "BUDGET_CTC_MIN": None,
        "BUDGET_CTC_MAX": None,
        "NEEDED_BY_DATE": None,
        "JUSTIFICATION": None,
    }

    # ---- Headcount ---------------------------------------------
    m = re.search(r"\b(\d+)\s*(candidate|position|opening|person|people|nos|headcount)", t)
    if m:
        draft["HEADCOUNT"] = int(m.group(1))
    else:
        for word, val in _NUM_WORDS.items():
            if re.search(rf"\b{word}\b\s+(candidate|position|opening|person|people)", t):
                draft["HEADCOUNT"] = val
                break

    # ---- Experience -------------------------------------------
    m = re.search(r"(\d+)\s*(?:to|-|–)\s*(\d+)\s*(?:year|yr|yrs|years)", t)
    if m:
        draft["EXPERIENCE_MIN_YEARS"] = float(m.group(1))
        draft["EXPERIENCE_MAX_YEARS"] = float(m.group(2))
    else:
        m = re.search(r"(\d+)\s*\+?\s*(?:year|yr|yrs|years)", t)
        if m:
            draft["EXPERIENCE_MIN_YEARS"] = float(m.group(1))

    # ---- Department -------------------------------------------
    for dept, canonical in [
        ("production / manufacturing", "Production / Manufacturing"),
        ("production and manufacturing", "Production / Manufacturing"),
        ("production", "Production"),
        ("manufacturing", "Manufacturing"),
        ("it", "IT"),
        ("hr", "HR"),
        ("finance", "Finance"),
        ("accounts", "Accounts"),
        ("sales", "Sales"),
        ("quality", "Quality"),
        ("operations", "Operations"),
        ("engineering", "Engineering"),
        ("admin", "Admin"),
        ("marketing", "Marketing"),
    ]:
        if re.search(rf"\b{re.escape(dept)}\b", t):
            draft["DEPARTMENT"] = canonical
            break

    # ---- Role -------------------------------------------------
    for role, canonical in [
        ("assembly technician", "Assembly Technician"),
        ("machine operator", "Machine Operator"),
        ("sales executive", "Sales Executive"),
        ("senior backend engineer", "Senior Backend Engineer"),
        ("backend engineer", "Backend Engineer"),
        ("frontend engineer", "Frontend Engineer"),
        ("full stack developer", "Full Stack Developer"),
        ("welder", "Welder"),
        ("fitter", "Fitter"),
        ("developer", "Developer"),
        ("engineer", "Engineer"),
        ("technician", "Technician"),
        ("designer", "Designer"),
        ("accountant", "Accountant"),
        ("assembly", "Assembly Technician"),
    ]:
        if role in t:
            draft["POSITION_TITLE"] = canonical
            break

    # ---- Education --------------------------------------------
    # Prefer full phrase (e.g. "ITI – Fitter / Mechanical / Electrical
    # or Diploma in Mechanical Engineering") over a single word.
    m = re.search(
        r"(ITI[^.,\n]{0,80}(?:diploma[^.,\n]{0,80})?|"
        r"B\.?E\.?[^.,\n]{0,60}|B\.?Tech[^.,\n]{0,60}|"
        r"MBA[^.,\n]{0,40}|Diploma[^.,\n]{0,60}|Degree[^.,\n]{0,40})",
        original,
        re.IGNORECASE,
    )
    if m:
        draft["REQUIRED_EDUCATION"] = m.group(1).strip().strip("- ").strip()

    # ---- Skills (required + preferred) ------------------------
    # Detect a line that starts with "Required skills" and grab up
    # to the next line-break or "Preferred skills" marker.
    rs = re.search(
        r"required\s+skills?\s*[:\-]?\s*([^\n\r]+)",
        t, re.IGNORECASE,
    )
    if rs:
        chunk = rs.group(1)
        # Trim if a later section starts on the same line
        chunk = re.split(
            r"\b(?:preferred|good\s+to\s+have|nice|education|budget|"
            r"needed|urgency|justification)\b",
            chunk, maxsplit=1,
        )[0]
        draft["REQUIRED_SKILLS"] = ", ".join(
            s.strip().rstrip(".").capitalize()
            for s in re.split(r"[,;/]+", chunk)
            if s.strip() and len(s.strip()) > 2
        )[:400] or None

    ps = re.search(
        r"(?:preferred|good\s+to\s+have|nice\s+to\s+have)\s+skills?\s*[:\-]?\s*([^\n\r]+)",
        t, re.IGNORECASE,
    )
    if ps:
        chunk = ps.group(1)
        chunk = re.split(
            r"\b(?:education|budget|needed|urgency|justification|required)\b",
            chunk, maxsplit=1,
        )[0]
        draft["PREFERRED_SKILLS"] = ", ".join(
            s.strip().rstrip(".").capitalize()
            for s in re.split(r"[,;/]+", chunk)
            if s.strip() and len(s.strip()) > 2
        )[:400] or None

    # ---- Budget CTC -------------------------------------------
    # Range: "2,40,000 to 4,20,000" or "2.4 lakh to 4.2 lakh"
    m = re.search(
        r"(?:budget|ctc|salary|pay|package)[^0-9₹]{0,20}"
        r"[₹]?([\d.,]+)\s*(?:l|lakh|lakhs|lpa)?\s*(?:to|-|–|and)\s*"
        r"[₹]?([\d.,]+)\s*(?:l|lakh|lakhs|lpa|per\s+annum|p\.?a\.?|pa)?",
        t,
    )
    if m:
        lo = _parse_inr(m.group(1) + (" lakh" if len(m.group(1)) <= 4 else ""))
        hi = _parse_inr(m.group(2) + (" lakh" if len(m.group(2)) <= 4 else ""))
        if lo:
            draft["BUDGET_CTC_MIN"] = lo
        if hi:
            draft["BUDGET_CTC_MAX"] = hi
    else:
        # Single ceiling: "up to ₹4,20,000"
        m = re.search(
            r"(?:up\s+to|max|maximum)\s+[₹]?([\d.,]+)\s*(?:l|lakh|lpa)?",
            t,
        )
        if m:
            draft["BUDGET_CTC_MAX"] = _parse_inr(m.group(1))

    # ---- Urgency ----------------------------------------------
    if re.search(r"\b(urgent|urgency\s+high|asap|immediately|high\s+priority)\b", t):
        draft["URGENCY"] = "URGENT"
    elif re.search(r"\bhigh\b", t):
        draft["URGENCY"] = "HIGH"

    # ---- Needed by date ---------------------------------------
    # "30-Sep-2026" / "30 September 2026" / "2026-09-30"
    from datetime import datetime as _dt
    for pattern, fmt in [
        (r"\b(\d{1,2})[-\s/](jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s/]?(\d{4})\b", "%d %b %Y"),
        (r"\b(\d{4})-(\d{2})-(\d{2})\b", "%Y-%m-%d"),
    ]:
        m = re.search(pattern, t)
        if not m:
            continue
        try:
            if fmt == "%Y-%m-%d":
                d = _dt.strptime(m.group(0), fmt)
            else:
                d = _dt.strptime(
                    f"{m.group(1)} {m.group(2)[:3].title()} {m.group(3)}",
                    fmt,
                )
            draft["NEEDED_BY_DATE"] = d.strftime("%Y-%m-%d")
            break
        except Exception:
            continue

    # ---- Location ---------------------------------------------
    for city, canonical in [
        ("coimbatore, tamil nadu", "Coimbatore, Tamil Nadu"),
        ("coimbatore", "Coimbatore, Tamil Nadu"),
        ("chennai", "Chennai, Tamil Nadu"),
        ("bangalore", "Bangalore, Karnataka"),
        ("bengaluru", "Bengaluru, Karnataka"),
        ("hyderabad", "Hyderabad, Telangana"),
    ]:
        if city in t:
            draft["LOCATION"] = canonical
            break

    # ---- Justification ---------------------------------------
    # Anything after "justification" or "reason" up to end.
    m = re.search(
        r"(?:justification|reason|why)\s*[:\-]?\s*([^\n\r]{10,300})",
        original, re.IGNORECASE,
    )
    if m:
        draft["JUSTIFICATION"] = m.group(1).strip()

    return draft


# ---------------------------------------------------------------------
# Public entry point — used by the route
# ---------------------------------------------------------------------

def interpret(
    utterance: str,
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """Main call. `utterance` is the fresh transcript from the
    browser's SpeechRecognition (or a typed override). `history`
    is the running conversation so the agent can build on previous
    turns.

    Returns:
      {
        "reply":    "<what to speak>",
        "action":   "NEED_MORE" | "PROPOSE_DRAFT",
        "draft":    <partial requisition> | None,
        "provider": "qwen-72b" | "regex-fallback" | ...
      }
    """
    utterance = (utterance or "").strip()
    if not utterance:
        return {
            "reply": "Please say what role you want to hire for.",
            "action": "NEED_MORE",
            "draft": None,
            "provider": "noop",
        }

    messages = list(history or [])
    messages.append({"role": "user", "content": utterance})

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()

    # ---- LLM path ------------------------------------------------
    if api_key:
        env_model = (os.getenv("OPENROUTER_MODEL") or "").strip()
        chain = (
            [env_model] + [m for m in QWEN_MODEL_FALLBACKS if m != env_model]
            if env_model
            else list(QWEN_MODEL_FALLBACKS)
        )

        for model in chain:
            raw = _call_openrouter(SYSTEM_PROMPT, messages, api_key, model)
            if not raw:
                continue

            # Strip any accidental fences the model produced
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)

            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                # Model returned text — retry with next model
                continue

            reply = (parsed.get("reply") or "").strip()
            action = (parsed.get("action") or "NEED_MORE").upper()
            draft = parsed.get("draft") if action == "PROPOSE_DRAFT" else None
            if reply:
                return {
                    "reply": reply,
                    "action": action,
                    "draft": draft,
                    "provider": model.split(":")[0].split("/")[-1],
                }

    # ---- Regex fallback -----------------------------------------
    d = _regex_extract(utterance)
    have_critical = bool(d["POSITION_TITLE"] and d["DEPARTMENT"])

    if have_critical:
        return {
            "reply": (
                f"Sari — {d['DEPARTMENT']} department la "
                f"{d['POSITION_TITLE']}, {d['HEADCOUNT']} candidate. "
                "Idha requisition-a create panalaama?"
            ),
            "action": "PROPOSE_DRAFT",
            "draft": d,
            "provider": "regex-fallback",
        }

    missing = []
    if not d["POSITION_TITLE"]: missing.append("role")
    if not d["DEPARTMENT"]:     missing.append("department")

    if not api_key:
        note = " (LLM not configured — using regex fallback)"
    else:
        note = ""

    return {
        "reply": (
            f"Enna role, enna department nu clear-a sollunga."
            f"{note}"
        ),
        "action": "NEED_MORE",
        "draft": None,
        "provider": "regex-fallback",
    }
