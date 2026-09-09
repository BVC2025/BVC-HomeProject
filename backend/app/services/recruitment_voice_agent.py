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
# LLM model fallback chains — Gemini (primary) + OpenRouter (secondary)
# ---------------------------------------------------------------------
# Gemini gives visibly better ChatGPT-style conversation (natural chit-chat,
# consistent language matching, no repeated boilerplate) than the free-tier
# OpenRouter models. Same provider the Leave assistant already uses well.
# OpenRouter/Qwen stays as a secondary fallback for when Gemini quota is
# exhausted, and regex is the last resort.
GEMINI_MODEL_FALLBACKS = [
    "gemini-flash-lite-latest",    # Rolling alias — always the current lite model
    "gemini-flash-latest",         # Rolling alias — always the current flash model
    "gemini-2.5-flash",            # Explicit stable name
]

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

SYSTEM_PROMPT = """You are Deepthi — a warm, sharp, ChatGPT-style
recruitment assistant for BVC24. Introduce yourself as Deepthi when
first greeted; never say "BVC24 assistant" or "AI agent".

WHO YOU ARE:
- You talk like a real human colleague on a call. Warm, direct,
  friendly. You have opinions, you can crack a light joke, you can
  answer questions about hiring, salary norms, market conditions,
  BVC24 processes, or anything the user asks.
- You are NOT a form-filler robot. Do not open with "What role and
  department?" unless the user actually asked to raise a hiring
  request. Match the user's energy.

YOUR PRIMARY SKILL: help HR / department heads raise a hiring
requisition when they want to. But if they just want to chat, ask
a general question, test the voice, or explore what you can do —
respond naturally, like ChatGPT would, and only steer toward a
requisition when the user signals they want one.

LANGUAGE RULE (strict):
- Detect the language the user opens in — English, Tamil (தமிழ்),
  or Thanglish (Tamil in Latin script). Reply in the SAME language
  and roughly the same length. If they switch, follow the switch.
- Match the user's tone: casual message → casual reply, formal
  business ask → professional reply.

CONVERSATION MODES — pick the right one per turn:

1. CHAT (action = "CHIT_CHAT"):
   Use for greetings ("hi", "hello", "vanakkam"), small talk,
   voice-test messages ("testing", "can you hear me"), meta
   questions ("what can you do?", "who made you?", "how do I use
   this?"), general hiring questions ("what's a good salary for a
   welder in Coimbatore?"), or ANY message that isn't clearly
   about raising a specific requisition. Answer naturally in 1-3
   sentences. Do NOT ask for role/department. Do NOT produce a draft.

2. NEED_MORE (action = "NEED_MORE"):
   Use ONLY once the user has clearly started raising a requisition
   (mentions a role, a headcount, "we need to hire", "recruit
   pananu", etc.) BUT one of the 3 critical fields is missing
   (POSITION_TITLE / DEPARTMENT / HEADCOUNT). Ask ONE targeted
   question. No checklists.

3. PROPOSE_DRAFT (action = "PROPOSE_DRAFT"):
   Use once all 3 critical fields are known. Summarize warmly and
   ask "shall I create it?". Fill nice-to-have fields from what
   was actually said — never invent skills or benefits.

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
 12. BUDGET_CTC_MIN       — minimum salary in rupees (e.g. 30000)
 13. BUDGET_CTC_MAX       — maximum salary in rupees (e.g. 40000)
 14. NEEDED_BY_DATE       — target join date in YYYY-MM-DD format
 15. JUSTIFICATION        — one-sentence business reason
 16. WORK_MODE            — ON_SITE (default) | REMOTE | HYBRID
 17. SHIFT                — e.g. "Day", "Night", "General" (nullable)
 18. SALARY_PERIOD        — MONTHLY (default) | ANNUAL — the unit BUDGET_CTC_MIN/MAX
                             is in. Infer from how HR phrased it ("30 to 40
                             thousand a month" = MONTHLY; "4.2 LPA" = ANNUAL).
 19. APPLICATION_DEADLINE — when applications close, YYYY-MM-DD (nullable,
                             distinct from NEEDED_BY_DATE which is the join target)

Do NOT ask about or capture any gender/marital/religious/community
requirement for the role, even if HR mentions one — politely note in
your reply that hiring must stay open to all eligible candidates and
drop that detail from the draft entirely. This is a hard rule, not a
style preference.

ONCE YOU PROPOSE A DRAFT, also generate (from ONLY what HR actually
said — never invent a skill, benefit, or requirement they didn't
mention):
  - JOB_DESCRIPTION  — 2-3 sentence overview of the role
  - RESPONSIBILITIES — newline-separated bullet points (as a single
                        string, "- " prefix per line)
  - QUALIFICATIONS   — newline-separated bullet points, same format,
                        built from REQUIRED_EDUCATION/REQUIRED_SKILLS/
                        EXPERIENCE_MIN_YEARS — don't repeat information
                        not already captured in those fields.

CONVERSATION FLOW:
- Every turn, first decide: is the user asking to hire someone, or
  are they just chatting / asking a question / testing? If the
  latter, use CHIT_CHAT. Do NOT try to force every turn into a
  requisition flow.
- Once they clearly start hiring: if 3 critical fields all present
  in this turn, jump to PROPOSE_DRAFT. If missing, NEED_MORE with
  ONE question. Never a checklist.
- For nice-to-have fields, only ask if HR hasn't mentioned them AND
  you have room. Otherwise leave the field blank in the draft —
  HR can fill it later in the review screen.
- Once all 3 critical fields are known, ALWAYS emit PROPOSE_DRAFT.
  Never ask a 4th question after the critical trio is complete.

OUTPUT FORMAT — JSON ONLY, no prose, no markdown fences:
{
  "reply": "<what to speak back — natural, warm, in the user's language and length>",
  "action": "CHIT_CHAT" | "NEED_MORE" | "PROPOSE_DRAFT",
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
    "JUSTIFICATION":        "string|null",
    "WORK_MODE":            "ON_SITE",
    "SHIFT":                "string|null",
    "SALARY_PERIOD":        "MONTHLY",
    "APPLICATION_DEADLINE": "YYYY-MM-DD|null",
    "JOB_DESCRIPTION":      "string|null",
    "RESPONSIBILITIES":     "string|null",
    "QUALIFICATIONS":       "string|null"
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

# ---- CHIT_CHAT examples — respond naturally, do NOT push a requisition ----

HR: "Hi"
You: {
  "reply": "Hi! I'm Deepthi from BVC24 recruitment. Anything I can help you with today — a new hire to raise, or just a hiring question?",
  "action": "CHIT_CHAT"
}

HR: "vanakkam"
You: {
  "reply": "Vanakkam! Naan Deepthi — BVC24 recruitment assistant. Enna help vendum? Puthiya requisition raise pananuma, illa vera edhavadhu hiring kelvi iruka?",
  "action": "CHIT_CHAT"
}

HR: "what can you do?"
You: {
  "reply": "I can raise a new hiring requisition for any role, walk you through what info I need, and answer questions about salary bands, hiring timelines or the BVC24 approval flow. Want to start with a role in mind, or ask me something first?",
  "action": "CHIT_CHAT"
}

HR: "who are you"
You: {
  "reply": "I'm Deepthi — the recruitment assistant built for BVC24. I help HR and department heads raise requisitions by voice or chat, and I keep track of what's still missing before the MD approves. What's on your plate today?",
  "action": "CHIT_CHAT"
}

HR: "testing testing"
You: {
  "reply": "Loud and clear! I can hear you fine. Whenever you're ready — tell me the role you want to hire for and we'll go from there.",
  "action": "CHIT_CHAT"
}

HR: "Coimbatore la welder ku enna salary range?"
You: {
  "reply": "Coimbatore-la experienced welder ku market range roughly ₹18,000 – ₹28,000 per month, skill and shift-a poruthu — arc/TIG/MIG specialist iruntha ₹32k varai poidum. Neenga oru welder requisition raise panna venuma?",
  "action": "CHIT_CHAT"
}

HR: "explain how the approval works"
You: {
  "reply": "Simple flow: you tell me the role → I create a draft → MD gets an email with Approve/Reject buttons → once approved it flips to an open job and candidates can be added to the pipeline. Usually a day or two for MD to respond. Want to raise one now?",
  "action": "CHIT_CHAT"
}
"""


# ---------------------------------------------------------------------
# Gemini call — primary LLM. Same pattern the Leave assistant uses.
# ---------------------------------------------------------------------

def _parse_and_pack(raw: str, provider_label: str) -> Optional[Dict[str, Any]]:
    """Parse a raw LLM JSON reply into the standard return shape.
    Returns None on any parse error so the caller can try the next model.
    Shared between the Gemini and OpenRouter branches so both handle
    fences, unknown actions, and empty replies identically."""
    if not raw:
        return None

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None

    reply = (parsed.get("reply") or "").strip()
    action = (parsed.get("action") or "NEED_MORE").upper()
    if action not in ("CHIT_CHAT", "NEED_MORE", "PROPOSE_DRAFT"):
        action = "CHIT_CHAT"
    draft = parsed.get("draft") if action == "PROPOSE_DRAFT" else None
    if not reply:
        return None

    return {
        "reply": reply,
        "action": action,
        "draft": draft,
        "provider": provider_label,
    }


def _call_gemini(
    system_prompt: str,
    messages: List[Dict[str, str]],
    model: str,
) -> Optional[str]:
    """One Gemini turn. Returns raw JSON text or None on failure.

    Uses `response_mime_type=application/json` + system_instruction so
    the model is guided to return a valid JSON object per SYSTEM_PROMPT.
    History is converted from OpenAI-style {role,content} to Gemini's
    {role:'user'|'model', parts:[text]} shape.
    """
    try:
        import google.generativeai as genai
    except ImportError:
        _record_attempt(model, False, "google-generativeai not installed")
        return None

    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        _record_attempt(model, False, "GEMINI_API_KEY missing")
        return None

    genai.configure(api_key=key)

    # Build Gemini-style history — peel off the last user message so
    # start_chat() gets prior turns and send_message() carries the fresh ask.
    history: List[Dict[str, Any]] = []
    latest_user: Optional[str] = None
    for m in messages:
        role = (m.get("role") or "user").strip()
        text = (m.get("content") or "").strip()
        if not text:
            continue
        if role == "user":
            history.append({"role": "user",  "parts": [text]})
        elif role == "assistant":
            history.append({"role": "model", "parts": [text]})

    if history and history[-1]["role"] == "user":
        latest_user = history[-1]["parts"][0]
        history = history[:-1]

    if not latest_user:
        _record_attempt(model, False, "no user message in history")
        return None

    try:
        gm = genai.GenerativeModel(
            model_name=model,
            system_instruction=system_prompt,
            generation_config={
                "response_mime_type": "application/json",
                # Slightly warm so replies vary turn-to-turn instead of
                # repeating the same "shall I create it?" phrasing.
                "temperature": 0.6,
                "max_output_tokens": 700,
            },
        )
        chat = gm.start_chat(history=history)
        try:
            resp = chat.send_message(latest_user, request_options={"timeout": 25})
        except TypeError:
            # Older google-generativeai versions don't accept request_options
            resp = chat.send_message(latest_user)

        raw = ""
        try:
            raw = (resp.text or "").strip()
        except Exception:
            raw = ""

        if raw:
            _record_attempt(model, True, raw[:180])
            return raw
        _record_attempt(model, False, "empty response")
        return None

    except Exception as e:
        _record_attempt(model, False, f"{type(e).__name__}: {e}")
        return None


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
        "WORK_MODE": "ON_SITE",
        "SHIFT": None,
        "SALARY_PERIOD": "MONTHLY",
        "APPLICATION_DEADLINE": None,
        # Prose generation (JOB_DESCRIPTION/RESPONSIBILITIES/QUALIFICATIONS)
        # is an LLM-only capability — left blank in the regex fallback
        # rather than templating something HR didn't actually say.
        "JOB_DESCRIPTION": None,
        "RESPONSIBILITIES": None,
        "QUALIFICATIONS": None,
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

    # ---- Work mode ----------------------------------------------
    if re.search(r"\b(remote|work\s+from\s+home|wfh)\b", t):
        draft["WORK_MODE"] = "REMOTE"
    elif re.search(r"\bhybrid\b", t):
        draft["WORK_MODE"] = "HYBRID"
    elif re.search(r"\b(on\s*-?\s*site|onsite|office)\b", t):
        draft["WORK_MODE"] = "ON_SITE"

    # ---- Shift ---------------------------------------------------
    m = re.search(r"\b(day|night|general|morning|evening|rotational)\s+shift\b", t)
    if m:
        draft["SHIFT"] = m.group(1).title() + " Shift"

    # ---- Salary period --------------------------------------------
    # "a month" / "per month" / "monthly" -> MONTHLY; "lpa" / "per
    # annum" / "annual" / "a year" -> ANNUAL. Only overrides the
    # MONTHLY default when annual phrasing is actually present.
    if re.search(r"\b(lpa|per\s+annum|p\.?a\.?|annual(?:ly)?|a\s+year|per\s+year)\b", t):
        draft["SALARY_PERIOD"] = "ANNUAL"
    elif re.search(r"\b(per\s+month|a\s+month|monthly)\b", t):
        draft["SALARY_PERIOD"] = "MONTHLY"

    # ---- Application deadline (distinct from "needed by") ---------
    m = re.search(
        r"(?:application|apply)[^.\n]{0,20}(?:by|before|deadline)\s*[:\-]?\s*"
        r"(\d{1,2}[-\s/](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s/]?\d{4}|\d{4}-\d{2}-\d{2})",
        t,
    )
    if m:
        from datetime import datetime as _dt2
        raw = m.group(1)
        for fmt_try in ("%Y-%m-%d",):
            try:
                draft["APPLICATION_DEADLINE"] = _dt2.strptime(raw, fmt_try).strftime("%Y-%m-%d")
                break
            except ValueError:
                continue

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

    # ---- Gemini FIRST (primary — better chit-chat, language matching) ----
    if os.getenv("GEMINI_API_KEY", "").strip():
        env_gemini = (os.getenv("GEMINI_MODEL") or "").strip()
        gemini_chain = (
            [env_gemini] + [m for m in GEMINI_MODEL_FALLBACKS if m != env_gemini]
            if env_gemini
            else list(GEMINI_MODEL_FALLBACKS)
        )
        for model in gemini_chain:
            raw = _call_gemini(SYSTEM_PROMPT, messages, model)
            if not raw:
                continue
            parsed_ok = _parse_and_pack(raw, provider_label=f"gemini · {model}")
            if parsed_ok:
                return parsed_ok

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()

    # ---- OpenRouter/Qwen SECONDARY (only if Gemini failed) -------
    if api_key:
        env_model = (os.getenv("OPENROUTER_MODEL") or "").strip()
        chain = (
            [env_model] + [m for m in QWEN_MODEL_FALLBACKS if m != env_model]
            if env_model
            else list(QWEN_MODEL_FALLBACKS)
        )

        for model in chain:
            raw = _call_openrouter(SYSTEM_PROMPT, messages, api_key, model)
            packed = _parse_and_pack(raw, provider_label=model.split(":")[0].split("/")[-1])
            if packed:
                return packed

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
