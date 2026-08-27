"""Voice-first leave assistant — OpenRouter-backed chat service.

This module is deliberately isolated from `leave_ai_agent.py` (the
existing MD-facing verdict engine). That one runs at the manager-approval
stage; this one runs at the employee-conversation stage. The two never
share state or prompts.

Key design points:

* The employee's raw record is NEVER sent to the LLM. Only a narrow
  `EmployeeChatContext` is assembled, with salary / memos / other
  employees' data explicitly excluded.

* Conversation history is stateless on the server. The frontend passes
  the full running transcript on every turn. That keeps this endpoint
  horizontally scalable and removes the need for a chat-session table.

* Language handling: the model is instructed to reply in the language
  the employee is using (auto-detected) OR in the language the frontend
  passes as a hint. Both Thanglish (Tamil written in Latin script) and
  Tamil script are supported.

* Actions: the model can only take TWO safe actions -
    - PROPOSE_LEAVE  : the model has enough info to draft a leave request.
                       The frontend must ask the employee to confirm
                       verbally before calling /leave-ai-chat/submit.
    - ANSWER_ONLY    : plain conversational reply, no state change.
  The model can NEVER submit a leave directly; that always requires a
  separate authenticated POST to /leave-ai-chat/submit after the human
  says yes.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.models import Employee, LeaveRequest, Task, TaskAssignment


# Gemini is the primary provider — the project already ships a
# GEMINI_API_KEY and other AI features (recruitment / onboarding /
# memos) share the same key + fallback chain. OpenRouter is retained
# as a manual override for any future paid-tier switch.
GEMINI_MODEL_FALLBACKS = [
    "gemini-flash-lite-latest",    # Rolling alias — always tracks the current lite model
    "gemini-flash-latest",         # Rolling alias — always tracks the current flash model
    "gemini-3.1-flash-lite",       # Explicit 3.1 lite
    "gemini-3.5-flash-lite",       # Google's suggested replacement per error msg
    "gemini-2.5-flash",            # Final fallback
]


# ---------------------------------------------------------------------------
# Context assembly — ONLY safe fields leave the process.
# ---------------------------------------------------------------------------

_SENSITIVE_FIELDS_NEVER_SENT = {
    "PASSWORD",
    "SALARY",
    "PAN",
    "AADHAAR",
    "BANK_ACCOUNT",
    "IFSC_CODE",
    "SALARY_STRUCTURE",
    "STAR_BONUS",
}


def gather_employee_context(db: Session, employee_id: str) -> Dict[str, Any]:
    """Assemble the safe context the assistant is allowed to see.
    Never returns sensitive fields. Never returns other employees'
    data."""

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:
        return {}

    # Leave balance — compute from LeaveRequest rows in the current
    # calendar year. We deliberately do not read the leave_balance
    # cache table because it may be stale mid-request.
    year_start = date(date.today().year, 1, 1)

    approved_this_year = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.EMPLOYEE_ID == emp.ID,
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE >= year_start,
        )
        .all()
    )

    def _days(t: str) -> float:
        return sum(
            float(r.DAYS or 0) for r in approved_this_year
            if (r.LEAVE_TYPE or "").upper() == t
        )

    balance = {
        "CASUAL":   {"quota": 12, "used": _days("CASUAL"),   "remaining": max(0, 12 - _days("CASUAL"))},
        "SICK":     {"quota": 10, "used": _days("SICK"),     "remaining": max(0, 10 - _days("SICK"))},
        "EARNED":   {"quota": 15, "used": _days("EARNED"),   "remaining": max(0, 15 - _days("EARNED"))},
    }

    # Pending tasks — open ones assigned to this employee.
    tasks = (
        db.query(Task)
        .join(TaskAssignment, TaskAssignment.TASK_ID == Task.ID)
        .filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            Task.STATUS.in_(("PENDING", "IN_PROGRESS", "TODO", "OPEN")),
        )
        .limit(10)
        .all()
    )

    pending_tasks = [
        {
            "id":       t.ID,
            "title":    t.TITLE or "(untitled)",
            "due_date": t.DUE_DATE.isoformat() if t.DUE_DATE else None,
            "priority": t.PRIORITY or "MEDIUM",
        }
        for t in tasks
    ]

    # Casual-leave-this-month gate (matches app policy — one CL per month).
    month_start = date.today().replace(day=1)
    cl_this_month = sum(
        1 for r in approved_this_year
        if (r.LEAVE_TYPE or "").upper() == "CASUAL"
        and (r.START_DATE or date.today()) >= month_start
    )

    # Permission hours used this calendar month (policy: 2h free/month).
    permission_hours_this_month = 0.0
    try:
        permission_hours_this_month = sum(
            float(r.DURATION_HOURS or 0)
            for r in db.query(LeaveRequest).filter(
                LeaveRequest.EMPLOYEE_ID == emp.ID,
                LeaveRequest.LEAVE_TYPE == "PERMISSION",
                LeaveRequest.STATUS == "APPROVED",
                LeaveRequest.START_DATE >= month_start,
            ).all()
        )
    except Exception:
        permission_hours_this_month = 0.0

    # Late marks this month (policy: 3 lates in a month → half-day LOP).
    late_marks_this_month = 0
    try:
        from app.models.models import Attendance
        late_marks_this_month = (
            db.query(Attendance)
            .filter(
                Attendance.EMPLOYEE_ID == emp.ID,
                Attendance.STATUS == "LATE",
                Attendance.DATE >= month_start,
            )
            .count()
        )
    except Exception:
        late_marks_this_month = 0

    return {
        "employee_name":              emp.NAME or "",
        "employee_code":              emp.EMPLOYEE_CODE or "",
        "employee_id":                emp.ID,
        "gender":                     emp.GENDER or "",
        "joining_date":               emp.JOINING_DATE.isoformat() if emp.JOINING_DATE else None,
        "today":                      date.today().isoformat(),
        "balance":                    balance,
        "pending_tasks":              pending_tasks,
        "casual_leaves_this_month":   cl_this_month,
        "permission_hours_this_month": round(permission_hours_this_month, 2),
        "late_marks_this_month":      late_marks_this_month,
        "policies": {
            "casual_leaves_per_year":     12,
            "casual_leaves_per_month":    1,
            "requires_md_approval":       True,
            "half_day_requires_same_date": True,
            "permission_free_hours_per_month": 2,
            "permission_over_limit_penalty":   "half-day salary deduction",
            "late_arrivals_before_deduction":  3,
            "late_arrivals_penalty":           "half-day salary deduction",
            "official_start_time":             "09:20",
            "late_cutoff":                     "09:21",
        },
    }


# ---------------------------------------------------------------------------
# System prompt.
# ---------------------------------------------------------------------------

def build_system_prompt(context: Dict[str, Any], language_hint: str = "auto") -> str:
    """Language hint values: 'auto', 'en', 'ta', 'thanglish'."""

    lang_directive = {
        "auto":      "Reply in the same language the employee is using. If they switch, follow the switch.",
        "en":        "Reply in English only.",
        "ta":        "Reply in Tamil (தமிழ்) script.",
        "thanglish": "Reply in Thanglish — Tamil words written in Latin script (e.g. 'Naanga help pandra').",
    }.get(language_hint, "Reply in the same language the employee is using.")

    ctx_json = json.dumps(context, indent=2, default=str)

    return f"""You are the BVC24 ERP leave assistant. You help ONE employee — the one described in EMPLOYEE_CONTEXT below — apply for leave, understand their own balance, and answer questions about their own data ONLY.

STRICT ACCESS RULES (RBAC — non-negotiable):
- You may ONLY discuss the employee named in EMPLOYEE_CONTEXT. Their code is in `employee_code`.
- If the employee asks about ANY OTHER person by name, code, or role (e.g. "How much leave does Nasira have?", "What is Puviyarasi's salary?", "Show me Ramkumar's tasks"), you MUST refuse with exactly: "Sorry, I'm not authorized to provide that information."
- You MUST NEVER reveal salary, PAN, Aadhaar, bank details, memos, disciplinary records, or performance scores — not even the employee's own. If asked, refuse politely with the same line.
- Only these topics are permitted for the employee's OWN data: leave balance, pending tasks, holiday calendar, permission usage, late marks, attendance summary, applying for leave.

LEAVE POLICY (enforce strictly):
- Casual Leave: 12 days/year total, max 1 per calendar month.
- If `casual_leaves_this_month` >= 1 and employee asks for another CL, that becomes the "2nd CL this month" case:
  * If `pending_tasks` is empty → still recommend it. Emit PROPOSE_LEAVE. In the draft, note "no pending tasks" in the reason. MD gets the email + can approve/reject.
  * If `pending_tasks` has any tasks → ASK the employee when they will complete each pending task (get a specific YYYY-MM-DD date for each). Only after collecting a completion date for each open task, emit PROPOSE_LEAVE with those dates in `task_commitments`.
- If requested days exceed remaining balance in `balance[TYPE].remaining` → same task-check flow as above.
- Half-day leave: start_date must equal end_date (single day).
- MATERNITY leave: only for employees where gender == FEMALE.

PERMISSION POLICY:
- Free permission hours: 2 hours per calendar month.
- Current usage this month: `permission_hours_this_month`.
- If the employee wants permission that would push their monthly total > 2 hours (including any half-day permission which counts as 4 hours), warn them that it counts as a HALF-DAY salary deduction. Still let them proceed if they confirm.

LATE-ARRIVAL POLICY (informational — do not create attendance records):
- Official office start: 09:20. Punches at 09:20 (any second) are PRESENT. Only 09:21 onwards is LATE.
- Current lates this month: `late_marks_this_month`.
- If asked about it, tell the employee they have X lates so far this month, and that 3 lates in a calendar month result in a half-day salary deduction.

CONVERSATION FLOW:
- Never submit a leave request yourself. When you have enough info, emit action=PROPOSE_LEAVE with a draft. The user confirms verbally, then the app submits.
- Be conversational, warm, and brief. This is voice — keep replies under 60 words when possible.

LANGUAGE:
- {lang_directive}

OUTPUT FORMAT — you MUST reply with a JSON object, no prose outside it:
{{
  "reply": "<what to say out loud to the employee, in the appropriate language>",
  "action": "PROPOSE_LEAVE" | "ANSWER_ONLY",
  "draft": {{                       // ONLY when action=PROPOSE_LEAVE
    "leave_type": "CASUAL" | "SICK" | "EARNED" | "UNPAID" | "LOP" | "MATERNITY",
    "start_date": "YYYY-MM-DD",
    "end_date":   "YYYY-MM-DD",
    "half_day":   true | false,
    "reason":     "<the employee's reason, cleaned up>",
    "days":       <number>,
    "task_commitments": [           // Optional; only when balance is insufficient
      {{ "task_id": "...", "title": "...", "promised_completion_date": "YYYY-MM-DD" }}
    ]
  }}
}}

Never include markdown code fences. Never include text outside the JSON.

EMPLOYEE_CONTEXT:
{ctx_json}
"""


# ---------------------------------------------------------------------------
# OpenRouter call.
# ---------------------------------------------------------------------------

def openrouter_chat(
    system_prompt: str,
    messages: List[Dict[str, str]],
    model: Optional[str] = None,   # kept for API-compat, ignored
) -> Dict[str, Any]:
    """Chat turn dispatcher. Uses Google Gemini as the primary provider
    (already configured in .env, real free tier). Falls through the
    same model list the onboarding / recruitment / memo AI use, so if
    one model hits its quota we automatically try the next.

    Returns {"reply", "action", "draft"} — same contract the route
    already expects. Never raises."""

    import logging
    log = logging.getLogger("uvicorn.error")

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not gemini_key:
        return {
            "reply": (
                "The AI assistant isn't configured yet — admin needs to "
                "set GEMINI_API_KEY in the server .env."
            ),
            "action": "ANSWER_ONLY",
        }

    try:
        import google.generativeai as genai
    except ImportError:
        return {
            "reply": (
                "The AI library isn't installed on the server "
                "(google.generativeai). Ask admin to run "
                "pip install google-generativeai."
            ),
            "action": "ANSWER_ONLY",
        }

    genai.configure(api_key=gemini_key)

    # Convert OpenAI-style history to Gemini's history format.
    # Gemini uses roles 'user' and 'model' and expects `parts` lists.
    history: List[Dict[str, Any]] = []
    latest_user_msg: Optional[str] = None

    for m in messages:
        role = m.get("role") or "user"
        content = (m.get("content") or "").strip()
        if not content:
            continue

        if role == "user":
            history.append({"role": "user", "parts": [content]})
        elif role == "assistant":
            history.append({"role": "model", "parts": [content]})

    # Gemini's start_chat wants history WITHOUT the final user turn,
    # then send_message() sends that latest turn. Peel it off.
    if history and history[-1]["role"] == "user":
        latest_user_msg = history[-1]["parts"][0]
        history = history[:-1]

    if not latest_user_msg:
        return {
            "reply": "Please say something.",
            "action": "ANSWER_ONLY",
        }

    # Try each model in the fallback chain until one accepts the call.
    env_model = (os.getenv("GEMINI_MODEL") or "").strip()
    model_chain = (
        ([env_model] + [m for m in GEMINI_MODEL_FALLBACKS if m != env_model])
        if env_model
        else list(GEMINI_MODEL_FALLBACKS)
    )

    last_exc: Optional[Exception] = None
    raw_text: str = ""
    quota_hit = False

    for model_name in model_chain:
        try:
            gm = genai.GenerativeModel(
                model_name=model_name,
                system_instruction=system_prompt,
                generation_config={
                    "response_mime_type": "application/json",
                    "temperature": 0.4,
                    "max_output_tokens": 500,
                },
            )
            chat = gm.start_chat(history=history)
            # 25-second cap on the underlying HTTP call — otherwise a
            # stuck Gemini stream can leave the browser spinning
            # "Thinking..." indefinitely.
            try:
                resp = chat.send_message(
                    latest_user_msg,
                    request_options={"timeout": 25},
                )
            except TypeError:
                # Older google-generativeai versions don't accept
                # request_options — fall back to a plain call.
                resp = chat.send_message(latest_user_msg)

            try:
                raw_text = (resp.text or "").strip()
            except Exception:
                raw_text = ""

            if raw_text:
                break

        except Exception as e:
            last_exc = e
            err_msg = str(e).lower()
            # Google's SDK raises ResourceExhausted (429) when quota / RPM
            # is hit; the message contains phrases like "quota exceeded",
            # "resource has been exhausted", or "429". A 404 "model not
            # available" or "rate" as substring of "generate" must NOT
            # be treated as quota.
            is_404 = "404" in err_msg or "not found" in err_msg or "not available" in err_msg
            if not is_404 and any(
                k in err_msg
                for k in ("quota", "429", "resource has been exhausted",
                          "rate limit", "exceeded")
            ):
                quota_hit = True
            log.info(
                "[leave-ai-chat] model %s failed (%s): %s — trying next",
                model_name, type(e).__name__, str(e)[:200],
            )
            continue

    if not raw_text:
        log.warning(
            "[leave-ai-chat] every Gemini model failed. last=%s: %s",
            type(last_exc).__name__ if last_exc else "None",
            str(last_exc)[:200] if last_exc else "",
        )

        if quota_hit:
            reply = (
                "I've hit today's free-tier limit on the AI service "
                "(Google Gemini gives 15 requests per minute + about "
                "1500 per day free). Please try again in a minute — or "
                "you can use the 'Apply for leave' form above without me."
            )
        else:
            err_snippet = str(last_exc)[:150] if last_exc else "unknown error"
            reply = (
                f"Sorry, the AI service failed: {err_snippet}. "
                "Please try again in a moment, or use the 'Apply for "
                "leave' form above."
            )

        return {
            "reply":  reply,
            "action": "ANSWER_ONLY",
        }

    # Strip markdown fences if the model wrapped its JSON in them anyway.
    text = raw_text
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {
            "reply": text[:400] or "I didn't understand that. Could you rephrase?",
            "action": "ANSWER_ONLY",
        }

    action = str(parsed.get("action") or "ANSWER_ONLY").upper()
    if action not in ("ANSWER_ONLY", "PROPOSE_LEAVE"):
        action = "ANSWER_ONLY"

    return {
        "reply":  str(parsed.get("reply") or "").strip() or "…",
        "action": action,
        "draft":  parsed.get("draft") if action == "PROPOSE_LEAVE" else None,
    }
