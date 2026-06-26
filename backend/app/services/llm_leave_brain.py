"""
LLM-driven leave-agent brain (Gemini-backed).

This is the "AI" part of the leave agent. It does in a single call:
  1. Understand the user's message + current state + history
  2. Update the collected leave-request fields
  3. Generate a natural-language reply
  4. Decide the next state

The orchestrator (leave_agent_service.py) is still in charge of:
  • Persistence (conversation rows + LeaveRequest writes)
  • Quota / policy validation
  • Tool execution (creating the leave request on confirmation)

This separation keeps the AI useful AND safe: it can't fabricate
data-writes; only the orchestrator can. If Gemini fails or is
unreachable, the orchestrator falls back to the rule-based parser.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Optional, List, Dict, Any
import os
import json
import re


# ---------------------------------------------------------------
# System prompt — tight, structured, deterministic.
# ---------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are the BVC24 ERP Leave Assistant — a conversational AI that helps
EMPLOYEES apply for leave in plain English (or Tanglish / Tamil / Hindi).
You are NOT a free-form chatbot. Every response MUST be a JSON object
matching the schema below.

YOUR JOB
  Understand the employee's latest message in the context of:
    - The current conversation state
    - Fields already collected
    - Recent conversation history
  Then output a single JSON object that:
    1. Updates the collected fields (only what's new or changed).
    2. Returns a short, warm, natural-language reply.
    3. Tells the orchestrator the next state.
    4. Optionally suggests 1-3 quick-reply chips.

REQUIRED FIELDS FOR A LEAVE REQUEST
  - leave_type   (one of CASUAL, SICK, EARNED, MATERNITY, PATERNITY,
                  COMP_OFF, LOP — pick CASUAL if user gives only a reason)
  - start_date   (ISO date YYYY-MM-DD)
  - end_date     (ISO date YYYY-MM-DD; equal to start_date for one day)
  - reason       (short free text — capture user's words)
  - half_day     (boolean — true ONLY if user explicitly says "half day")

DATE RESOLUTION RULES
  - Resolve relative phrases against TODAY (provided in context).
  - "tomorrow" -> today + 1
  - "day after tomorrow" -> today + 2
  - "next Friday" -> the upcoming Friday (>= 7 days away if today is Friday)
  - "this Friday" -> the nearest Friday this week
  - "for 3 days starting Monday" -> Mon + 0, Mon + 2 as end_date
  - "25 June", "June 25th", "25/06/2026", "2026-06-25" all resolve to the same date
  - If only one date is given, set start_date = end_date.

STATE MACHINE
  Valid `next_state` values:
    COLLECTING  - still gathering required fields (default during a request flow)
    CONFIRMING  - ALL required fields are present and you've shown the
                  user a summary; you're now awaiting their yes/no.
    EXECUTE     - user has just confirmed; the orchestrator should
                  actually create the leave request. Only set this when
                  the immediately-prior agent message was a confirmation
                  prompt AND the user has now said yes/ok/sure/go ahead.
    CANCELLED   - user said no / cancel / stop in any flow.
    DONE_INFO   - this turn was purely informational (balance, status,
                  greeting, small-talk). No leave request is in flight.

INTENT VALUES
    REQUEST  - employee wants to apply for leave
    BALANCE  - asking how many leaves they have
    STATUS   - asking status of an existing leave request
    CANCEL   - wants to cancel mid-flow (or cancel a submitted leave)
    MODIFY   - wants to change dates / type after providing them
    CONFIRM  - "yes, submit it" during CONFIRMING state
    DENY     - "no, cancel" during CONFIRMING state
    GREETING - hi / hello / good morning
    SMALLTALK- thanks / nice / general chit-chat

REPLY STYLE
  - Warm, brief (1-3 sentences). Avoid corporate stiffness.
  - Use the employee's first name occasionally — not every sentence.
  - When showing a summary before confirmation, format it as a clean
    bullet list inside `agent_reply`.
  - When asking a follow-up question, ask only ONE thing.

OUTPUT — STRICT JSON ONLY, NO MARKDOWN, NO EXTRA TEXT
{
  "intent":      "REQUEST" | "BALANCE" | "STATUS" | "CANCEL" | "MODIFY"
                  | "CONFIRM" | "DENY" | "GREETING" | "SMALLTALK",
  "updates": {
      "leave_type": "CASUAL" | "SICK" | ... | null,
      "start_date": "YYYY-MM-DD" | null,
      "end_date":   "YYYY-MM-DD" | null,
      "reason":     "..." | null,
      "half_day":   true | false | null
  },
  "agent_reply":  "your natural language response",
  "next_state":   "COLLECTING" | "CONFIRMING" | "EXECUTE"
                  | "CANCELLED" | "DONE_INFO",
  "suggestions":  ["chip 1", "chip 2", ...]   // 0-3 items, short
}

CRITICAL
  - Output MUST be valid JSON and ONLY JSON. No prose before or after.
  - Never invent dates / balances / approvals — those come from the
    orchestrator. You're only responsible for parsing + replying.
  - If the user asks something off-topic, set intent=SMALLTALK and
    politely steer them back.
"""


_VALID_INTENTS = {
    "REQUEST", "BALANCE", "STATUS", "CANCEL", "MODIFY",
    "CONFIRM", "DENY", "GREETING", "SMALLTALK",
}

_VALID_STATES = {
    "COLLECTING", "CONFIRMING", "EXECUTE", "CANCELLED", "DONE_INFO",
}

_VALID_LEAVE_TYPES = {
    "CASUAL", "SICK", "EARNED", "MATERNITY",
    "PATERNITY", "COMP_OFF", "LOP",
}

GEMINI_MODEL_CHAIN = [
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]


# ---------------------------------------------------------------
# Public return shape
# ---------------------------------------------------------------

@dataclass
class BrainResult:
    intent:       str
    updates:      Dict[str, Any]        # only fields the LLM wants to set
    agent_reply:  str
    next_state:   str
    suggestions:  List[str]
    raw_json:     Optional[str] = None  # for audit / debugging
    source:       str = "gemini"        # "gemini" | "rule-fallback"


# ---------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------

def think(
    *,
    employee_name: str,
    employee_first_name: str,
    today: date,
    state: str,
    collected: Dict[str, Any],
    history: List[Dict[str, str]],
    user_message: str,
    balance_snapshot: Optional[Dict[str, Any]] = None,
) -> Optional[BrainResult]:
    """Call Gemini with the leave-agent system prompt and return a
    parsed BrainResult. Returns None on failure (orchestrator should
    fall back to the rule-based path)."""

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
        state=state,
        collected=collected,
        history=history,
        user_message=user_message,
        balance_snapshot=balance_snapshot,
    )

    preferred = (os.getenv("GEMINI_MODEL") or "").strip()
    chain = (
        [preferred] + [m for m in GEMINI_MODEL_CHAIN if m != preferred]
        if preferred
        else GEMINI_MODEL_CHAIN
    )

    for model_name in chain:
        try:
            model = genai.GenerativeModel(
                model_name,
                generation_config={
                    "temperature": 0.4,
                    "top_p": 0.9,
                    "max_output_tokens": 600,
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


# ---------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------

def _build_prompt(
    *,
    employee_name: str,
    employee_first_name: str,
    today: date,
    state: str,
    collected: Dict[str, Any],
    history: List[Dict[str, str]],
    user_message: str,
    balance_snapshot: Optional[Dict[str, Any]],
) -> str:

    # Last ~10 turns of conversation
    history_text = "\n".join(
        f"{turn.get('role', '?').upper()}: {turn.get('text') or turn.get('content') or ''}"
        for turn in (history or [])[-10:]
    ) or "(no prior turns)"

    bal_text = (
        json.dumps(balance_snapshot, default=str)
        if balance_snapshot
        else "(not loaded)"
    )

    return (
        f"{_SYSTEM_PROMPT}\n\n"
        f"--- RUNTIME CONTEXT (read-only) ---\n"
        f"TODAY:               {today.isoformat()}\n"
        f"EMPLOYEE_NAME:       {employee_name}\n"
        f"EMPLOYEE_FIRST_NAME: {employee_first_name}\n"
        f"CURRENT_STATE:       {state}\n"
        f"COLLECTED_SO_FAR:    {json.dumps(collected, default=str)}\n"
        f"LEAVE_BALANCE:       {bal_text}\n\n"
        f"--- CONVERSATION HISTORY ---\n{history_text}\n\n"
        f"--- USER'S LATEST MESSAGE ---\n{user_message}\n\n"
        f"NOW REPLY WITH THE JSON OBJECT (no markdown, no prose):"
    )


# ---------------------------------------------------------------
# JSON parsing — be lenient because LLMs sometimes wrap in
# ```json fences or trail explanatory text despite instructions.
# ---------------------------------------------------------------

def _parse_json_strict(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    cleaned = text.strip()
    # Strip ``` fences if present
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    # First attempt
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # Try to extract the largest balanced {...} block
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


# ---------------------------------------------------------------
# Coercion — enforce the contract even when the LLM is sloppy
# ---------------------------------------------------------------

def _coerce(p: Dict[str, Any]) -> BrainResult:

    intent = str(p.get("intent") or "REQUEST").upper().strip()
    if intent not in _VALID_INTENTS:
        intent = "REQUEST"

    state = str(p.get("next_state") or "COLLECTING").upper().strip()
    if state not in _VALID_STATES:
        state = "COLLECTING"

    updates_raw = p.get("updates") or {}
    updates: Dict[str, Any] = {}
    if isinstance(updates_raw, dict):
        lt = updates_raw.get("leave_type")
        if isinstance(lt, str) and lt.upper().strip() in _VALID_LEAVE_TYPES:
            updates["leave_type"] = lt.upper().strip()

        for k in ("start_date", "end_date"):
            v = updates_raw.get(k)
            if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", v.strip()):
                updates[k] = v.strip()

        reason = updates_raw.get("reason")
        if isinstance(reason, str) and reason.strip():
            updates["reason"] = reason.strip()[:200]

        hd = updates_raw.get("half_day")
        if isinstance(hd, bool):
            updates["half_day"] = hd

    reply = str(p.get("agent_reply") or "").strip()
    if not reply:
        reply = "Could you tell me more?"

    suggestions_raw = p.get("suggestions") or []
    suggestions: List[str] = []
    if isinstance(suggestions_raw, list):
        for s in suggestions_raw[:3]:
            if isinstance(s, str) and s.strip():
                suggestions.append(s.strip()[:50])

    return BrainResult(
        intent=intent,
        updates=updates,
        agent_reply=reply,
        next_state=state,
        suggestions=suggestions,
        raw_json=json.dumps(p),
        source="gemini",
    )
