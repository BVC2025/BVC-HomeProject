"""
LLM brain for the unified HR Assistant.

Same Gemini-backed pattern as llm_leave_brain.py but with a broader
intent set covering all of Phase 1's Employee Assistant features.

The orchestrator calls think() once per turn; the result tells the
orchestrator which handler to invoke (leave / attendance / salary
slip / employee info / HR policy / holiday calendar) and provides a
natural-language reply.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional, List, Dict, Any
import os
import json
import re


_SYSTEM_PROMPT = """\
You are the BVC24 ERP HR Assistant — a conversational AI that helps
EMPLOYEES with everything HR-related: leave, attendance, payslips,
their profile, company policies, and holidays.

You handle Indian-context queries in English, Tanglish, Tamil and Hindi.

EVERY response MUST be a single JSON object matching the schema below.
No prose before or after.

INTENT VALUES (pick ONE):

  Leave-flow intents (orchestrator delegates to the leave state machine):
    LEAVE_REQUEST   - employee wants to apply for leave
    LEAVE_CONFIRM   - "yes submit it" mid-confirmation
    LEAVE_DENY      - "no cancel" mid-confirmation
    LEAVE_CANCEL    - cancel a submitted / in-flight leave

  One-shot Q&A intents (orchestrator calls a handler, returns answer):
    LEAVE_BALANCE   - "how many leaves do I have?", "balance of casual leave"
    LEAVE_STATUS    - "what's the status of my last leave?"
    ATTENDANCE      - "how many late marks?", "what's my attendance this month?"
    SALARY_SLIP     - "send my payslip", "what's my net pay?"
    EMPLOYEE_INFO   - "who's my manager?", "what's my joining date?"
    HR_POLICY       - "what's the notice period?", "how much sick leave per year?"
    HOLIDAY         - "next holiday?", "is tomorrow a holiday?"

  Conversational intents:
    GREETING        - "hi", "hello", "good morning"
    SMALLTALK       - thanks, chitchat, off-topic
    UNKNOWN         - can't tell

ENTITY EXTRACTION
  For LEAVE_REQUEST extract: leave_type, start_date, end_date, reason, half_day.
  For SALARY_SLIP extract: month (1-12) and year (YYYY) if user said "march payslip" etc.
  For ATTENDANCE extract: month/year if specified, else current month.
  For HOLIDAY extract: range ("this month" / "next 3 months") or specific month/year.

DATE RESOLUTION
  - Resolve dates against TODAY (in context).
  - "tomorrow" -> today+1, "next Friday" -> upcoming Friday (>=7 days if today is Friday).
  - Indian DD/MM/YYYY format.
  - Names of months: full or abbreviated.

REPLY STYLE
  - Warm, brief (1-3 sentences). Use the employee's first name occasionally.
  - For data-heavy answers (balance, attendance, payslip), KEEP YOUR REPLY SHORT
    because the orchestrator will REPLACE your reply with real DB-rendered numbers.
    Just acknowledge the request ("Sure, fetching your balance...").
  - For LEAVE_REQUEST collection, ask only ONE missing field per turn.
  - For HR_POLICY questions, answer from the policy context provided.
    If the policy context doesn't mention it, say "I'm not sure — please check
    with HR" rather than guessing.

OUTPUT SCHEMA (strict JSON, no markdown):
{
  "intent":    "<one of the values above>",
  "agent_reply": "<your natural-language response>",
  "entities": {
      "leave_type": "CASUAL"|"SICK"|"EARNED"|"MATERNITY"|"PATERNITY"|"COMP_OFF"|"LOP"|null,
      "start_date": "YYYY-MM-DD" | null,
      "end_date":   "YYYY-MM-DD" | null,
      "reason":     "..." | null,
      "half_day":   true | false | null,
      "month":      1-12 | null,
      "year":       2024 | 2025 | 2026 | ... | null,
      "policy_topic": "leave"|"attendance"|"notice_period"|"working_hours"|"dress_code"|"travel"|"reimbursement"|"holidays"|null
  },
  "suggestions": ["chip 1", "chip 2", ...]   // 0-3 short follow-up suggestions
}

EXAMPLES

User: "Apply leave tomorrow for family function"
Output:
{
  "intent": "LEAVE_REQUEST",
  "agent_reply": "Got it — one day of casual leave tomorrow for a family function. Let me set that up.",
  "entities": {"leave_type":"CASUAL","start_date":"<tomorrow>","end_date":"<tomorrow>","reason":"family function","half_day":false},
  "suggestions": []
}

User: "How many leaves do I have?"
Output:
{"intent":"LEAVE_BALANCE","agent_reply":"Sure, fetching your balance...","entities":{},"suggestions":["Apply for leave","My leave history"]}

User: "What's my attendance this month?"
Output:
{"intent":"ATTENDANCE","agent_reply":"Pulling your attendance for this month...","entities":{},"suggestions":["Pending leave requests","Salary slip"]}

User: "Send my March payslip"
Output:
{"intent":"SALARY_SLIP","agent_reply":"Fetching your March payslip...","entities":{"month":3},"suggestions":["My net pay","Salary history"]}

User: "Who's my manager?"
Output:
{"intent":"EMPLOYEE_INFO","agent_reply":"Looking that up for you...","entities":{},"suggestions":["My designation","Joining date"]}

User: "What's the notice period?"
Output:
{"intent":"HR_POLICY","agent_reply":"Let me check the HR policy...","entities":{"policy_topic":"notice_period"},"suggestions":["Leave policy","Working hours"]}

User: "Next holiday?"
Output:
{"intent":"HOLIDAY","agent_reply":"Checking the holiday calendar...","entities":{},"suggestions":["Holidays this month","Diwali date"]}

Now produce the JSON for the user's latest message.
"""


_VALID_INTENTS = {
    "LEAVE_REQUEST", "LEAVE_CONFIRM", "LEAVE_DENY", "LEAVE_CANCEL",
    "LEAVE_BALANCE", "LEAVE_STATUS",
    "ATTENDANCE", "SALARY_SLIP", "EMPLOYEE_INFO",
    "HR_POLICY", "HOLIDAY",
    "GREETING", "SMALLTALK", "UNKNOWN",
}

_VALID_LEAVE_TYPES = {"CASUAL", "SICK", "EARNED", "MATERNITY",
                     "PATERNITY", "COMP_OFF", "LOP"}

_VALID_POLICY_TOPICS = {"leave", "attendance", "notice_period",
                       "working_hours", "dress_code", "travel",
                       "reimbursement", "holidays"}

GEMINI_MODEL_CHAIN = [
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]


@dataclass
class HRBrainResult:
    intent: str
    agent_reply: str
    entities: Dict[str, Any]
    suggestions: List[str]
    raw_json: Optional[str] = None
    source: str = "gemini"


def think(
    *,
    employee_name: str,
    employee_first_name: str,
    today: date,
    history: List[Dict[str, str]],
    user_message: str,
    policy_snippets: Optional[str] = None,
) -> Optional[HRBrainResult]:
    """Single Gemini call. Returns None on failure so the orchestrator
    can fall back to a rule-based path."""

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return None

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
    except Exception:
        return None

    prompt = _build_prompt(
        employee_name=employee_name,
        employee_first_name=employee_first_name,
        today=today,
        history=history,
        user_message=user_message,
        policy_snippets=policy_snippets,
    )

    preferred = (os.getenv("GEMINI_MODEL") or "").strip()
    chain = (
        [preferred] + [m for m in GEMINI_MODEL_CHAIN if m != preferred]
        if preferred else GEMINI_MODEL_CHAIN
    )

    for model_name in chain:
        try:
            model = genai.GenerativeModel(
                model_name,
                generation_config={
                    "temperature": 0.4,
                    "top_p": 0.9,
                    "max_output_tokens": 500,
                    "response_mime_type": "application/json",
                },
            )
            resp = model.generate_content(prompt)
            text = (resp.text or "").strip()
            parsed = _parse_json_strict(text)
            if parsed:
                return _coerce(parsed)
        except Exception:
            continue

    return None


def _build_prompt(
    *,
    employee_name: str,
    employee_first_name: str,
    today: date,
    history: List[Dict[str, str]],
    user_message: str,
    policy_snippets: Optional[str],
) -> str:
    history_text = "\n".join(
        f"{turn.get('role', '?').upper()}: {turn.get('text') or turn.get('content') or ''}"
        for turn in (history or [])[-10:]
    ) or "(no prior turns)"

    policy_text = policy_snippets or "(no policy snippets attached this turn)"

    return (
        f"{_SYSTEM_PROMPT}\n\n"
        f"--- RUNTIME CONTEXT ---\n"
        f"TODAY:               {today.isoformat()}\n"
        f"EMPLOYEE_NAME:       {employee_name}\n"
        f"EMPLOYEE_FIRST_NAME: {employee_first_name}\n\n"
        f"--- POLICY SNIPPETS (use only for HR_POLICY answers) ---\n"
        f"{policy_text}\n\n"
        f"--- CONVERSATION HISTORY ---\n{history_text}\n\n"
        f"--- USER'S LATEST MESSAGE ---\n{user_message}\n\n"
        f"NOW REPLY WITH THE JSON OBJECT:"
    )


def _parse_json_strict(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


def _coerce(p: Dict[str, Any]) -> HRBrainResult:
    intent = str(p.get("intent") or "UNKNOWN").upper().strip()
    if intent not in _VALID_INTENTS:
        intent = "UNKNOWN"

    raw_ent = p.get("entities") or {}
    ent: Dict[str, Any] = {}
    if isinstance(raw_ent, dict):
        lt = raw_ent.get("leave_type")
        if isinstance(lt, str) and lt.upper().strip() in _VALID_LEAVE_TYPES:
            ent["leave_type"] = lt.upper().strip()

        for k in ("start_date", "end_date"):
            v = raw_ent.get(k)
            if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", v.strip()):
                ent[k] = v.strip()

        reason = raw_ent.get("reason")
        if isinstance(reason, str) and reason.strip():
            ent["reason"] = reason.strip()[:200]

        hd = raw_ent.get("half_day")
        if isinstance(hd, bool):
            ent["half_day"] = hd

        m = raw_ent.get("month")
        if isinstance(m, (int, float)) and 1 <= int(m) <= 12:
            ent["month"] = int(m)

        y = raw_ent.get("year")
        if isinstance(y, (int, float)) and 2000 <= int(y) <= 2100:
            ent["year"] = int(y)

        pt = raw_ent.get("policy_topic")
        if isinstance(pt, str) and pt.strip().lower() in _VALID_POLICY_TOPICS:
            ent["policy_topic"] = pt.strip().lower()

    reply = str(p.get("agent_reply") or "").strip()
    if not reply:
        reply = "How can I help?"

    suggs_raw = p.get("suggestions") or []
    suggs: List[str] = []
    if isinstance(suggs_raw, list):
        for s in suggs_raw[:3]:
            if isinstance(s, str) and s.strip():
                suggs.append(s.strip()[:50])

    return HRBrainResult(
        intent=intent,
        agent_reply=reply,
        entities=ent,
        suggestions=suggs,
        raw_json=json.dumps(p),
        source="gemini",
    )
