"""
chatbot_ai_service.py  —  General-purpose AI chatbot, Gemini-backed.

v1 capabilities:
  • Answers questions about the ERP (modules, workflows, policies)
  • Answers personal queries against the DB (own leave balance,
    attendance, memos, salary) for the calling user
  • Refuses cross-employee queries for non-admin roles
  • Multilingual — Gemini natively handles Tamil, Hindi, English,
    Tanglish; we just pass the user's message through
  • Falls back to a rule-based stub if Gemini is unreachable

v1 does NOT do form submission. The bot says "open the Leave page and
click Apply" rather than submitting a leave request on the user's
behalf. Form-automation is v1.1 once we have user trust + audit logging.

Public API:
    chat(db, user, message, conversation_history, page_context) -> str
"""

from __future__ import annotations

import os
import json
from datetime import date
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    Attendance,
    LeaveRequest,
    EmployeeMemo,
    HolidayCalendar,
    PayrollSlip,
)


# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------

# Try newer/cheaper models first, fall back if the account doesn't have
# access. Order matches what `leave_chatbot_service` uses to keep the
# two services on the same model footprint.
GEMINI_MODEL_CHAIN = [
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
]

# Roles allowed to query data about OTHER employees.
ADMIN_ROLES = {
    "ADMIN", "SUPER_ADMIN", "HR", "HR_MANAGER", "MANAGER",
    "MANAGING_DIRECTOR", "PRODUCTION_HEAD",
    "PRODUCTION_MANAGER", "SALES_MANAGER", "PURCHASE_MANAGER",
    "INVENTORY_MANAGER", "ACCOUNTS_MANAGER",
}


# ---------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------

def chat(
    db: Session,
    user: Dict[str, Any],
    message: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    page_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Reply to `message` from `user`.

    Args:
        db: DB session (used by the data-fetching tools).
        user: dict from the JWT payload — must include
            `role`, `employee_id`, optionally `code` and `name`.
        message: the user's raw input.
        conversation_history: prior turns in the same thread, each
            `{"role": "user"|"assistant", "content": "..."}`.
        page_context: which page the user is on (e.g. "/payroll").
            Lets the bot give page-aware answers.

    Returns:
        `{"reply": "<text>", "source": "gemini"|"fallback"|"refused"}`.
    """

    if not message or not message.strip():
        return {"reply": "Please type a message.", "source": "fallback"}

    # Pull live data the bot is allowed to see for THIS user
    user_facts = _gather_user_facts(db, user)

    reply = _ask_gemini(user, message, user_facts, conversation_history or [], page_context)

    if reply:
        return {"reply": reply, "source": "gemini"}

    return {
        "reply": _rule_based_fallback(message, user_facts),
        "source": "fallback",
    }


# ---------------------------------------------------------------------
# Data-gathering — role-gated. The LLM only sees what `user` may see.
# ---------------------------------------------------------------------

def _gather_user_facts(db: Session, user: Dict[str, Any]) -> Dict[str, Any]:
    """Build a structured snapshot of the calling user's own data plus
    company-wide read-only facts. NEVER includes other employees'
    personal data unless the caller is an admin role."""

    role = (user.get("role") or "").upper()
    is_admin = role in ADMIN_ROLES

    facts: Dict[str, Any] = {
        "today": date.today().isoformat(),
        "viewer_role": role or "EMPLOYEE",
        "viewer_is_admin": is_admin,
    }

    employee_id = user.get("employee_id")

    if not employee_id:
        return facts

    # Resolve UUID-or-CODE → Employee row (mirrors employee_resolver)
    emp = db.query(Employee).filter(Employee.ID == employee_id).first()
    if emp is None:
        emp = db.query(Employee).filter(
            Employee.EMPLOYEE_CODE == str(employee_id).upper()
        ).first()

    if emp is None:
        return facts

    # ---- Own profile ------------------------------------------------
    facts["me"] = {
        "name":      emp.NAME,
        "code":      emp.EMPLOYEE_CODE,
        "salary":    float(emp.SALARY or 0),
        "status":    emp.STATUS,
        "join_date": emp.JOINED_DATE.isoformat() if getattr(emp, "JOINED_DATE", None) else None,
    }

    # ---- Today's attendance ----------------------------------------
    today_att = (
        db.query(Attendance)
          .filter(Attendance.EMPLOYEE_ID == emp.ID,
                  Attendance.DATE == date.today())
          .first()
    )
    facts["my_attendance_today"] = (
        {
            "status":     today_att.STATUS,
            "check_in":   today_att.CHECK_IN.isoformat() if today_att.CHECK_IN else None,
            "check_out":  today_att.CHECK_OUT.isoformat() if today_att.CHECK_OUT else None,
        } if today_att else None
    )

    # ---- Recent leaves (last 10) -----------------------------------
    leaves = (
        db.query(LeaveRequest)
          .filter(LeaveRequest.EMPLOYEE_ID == emp.ID)
          .order_by(LeaveRequest.ID.desc())
          .limit(10).all()
    )
    facts["my_recent_leaves"] = [
        {
            "type":   l.LEAVE_TYPE,
            "from":   l.START_DATE.isoformat() if l.START_DATE else None,
            "to":     l.END_DATE.isoformat()   if l.END_DATE   else None,
            "days":   l.DAYS,
            "status": l.STATUS,
            "reason": (l.REASON or "")[:120],
        }
        for l in leaves
    ]

    # ---- Pending memos for the employee ----------------------------
    memos = (
        db.query(EmployeeMemo)
          .filter(EmployeeMemo.EMPLOYEE_ID == emp.ID,
                  EmployeeMemo.STATUS == "ACTIVE",
                  EmployeeMemo.DELETED_AT.is_(None))
          .order_by(EmployeeMemo.ID.desc())
          .limit(5).all()
    )
    facts["my_active_memos"] = [
        {
            "no":           m.MEMO_NUMBER,
            "type":         m.MEMO_TYPE,
            "severity":     m.SEVERITY,
            "subject":      m.SUBJECT,
            "acknowledged": bool(m.ACKNOWLEDGED_BY_EMPLOYEE),
            "issue_date":   m.ISSUE_DATE.isoformat() if m.ISSUE_DATE else None,
        }
        for m in memos
    ]

    # ---- Last payslip ----------------------------------------------
    last_slip = (
        db.query(PayrollSlip)
          .filter(PayrollSlip.EMPLOYEE_ID == emp.ID)
          .order_by(PayrollSlip.ID.desc())
          .first()
    )
    facts["my_last_payslip"] = (
        {
            "base":     float(last_slip.BASE_SALARY or 0),
            "net":      float(last_slip.NET_PAY     or 0),
            "stars":    float(last_slip.PERFORMANCE_STARS or 0),
            "bonus":    float(last_slip.STAR_BONUS  or 0),
            "status":   last_slip.STATUS,
        } if last_slip else None
    )

    # ---- Holidays this year (everyone sees these) ------------------
    holidays = (
        db.query(HolidayCalendar)
          .filter(HolidayCalendar.VENDOR_ID == (emp.VENDOR_ID or 1),
                  HolidayCalendar.HOLIDAY_DATE >= date(date.today().year, 1, 1),
                  HolidayCalendar.HOLIDAY_DATE <= date(date.today().year, 12, 31))
          .order_by(HolidayCalendar.HOLIDAY_DATE).all()
    )
    facts["holidays_this_year"] = [
        {"date": h.HOLIDAY_DATE.isoformat(), "name": h.NAME, "type": h.TYPE}
        for h in holidays
    ]

    return facts


# ---------------------------------------------------------------------
# Gemini call
# ---------------------------------------------------------------------

_SYSTEM_PROMPT = """You are the BVC24 ERP assistant — a helpful AI built into
the Bharath Vending Corporation enterprise system. You answer in the same
language the user wrote in (English, Tamil, Hindi, or mixed).

Your job:
  • Answer questions about the ERP: modules, workflows, how-to.
  • Answer the user's PERSONAL questions using the facts JSON below.
  • For admins, you may discuss any data they ask about.
  • For employees (non-admin), refuse politely if they ask about other
    people's salary, attendance, memos, etc. Say something like
    "I can only show you your own information" and offer to help with
    their own data instead.

Constraints:
  • Be concise. 2-4 sentences for most answers.
  • Never invent data. If the facts JSON doesn't have it, say you don't
    know and suggest where the user can find it (page name).
  • Never reveal API keys, passwords, JWT contents, or .env values.
  • For destructive actions ("delete my account", "approve all leaves"),
    refuse and tell the user to do it through the proper UI page.
  • For form submissions ("apply 2 days leave"), DO NOT submit on their
    behalf. Direct them to the Leave page and tell them what to fill.

Module map (sidebar paths):
  /              Dashboard (Business Health, KPIs, Approval Center)
  /employees     Employees — admin CRUD
  /memos         Memos — issue / view warnings, appreciations, etc.
  /attendance    Daily attendance + geofenced check-in
  /leave-management   Apply for leave / permission; view history
  /payroll       Monthly payroll generation + per-employee Mark Paid
  /star-performance   Monthly star ratings (Task/Attend/Leave/Permission)
  /holidays      Vendor holiday calendar
  /customers     CRM
  /quotations    Sales quotations
  /sales-orders  Sales orders
  /projects      Projects (auto-allocated from products)
  /machines      Machine status board
  /production    Production & BOM
  /quality       Quality management
  /suppliers     Supplier directory
  /purchase-orders   POs + goods receipt
  /inventory     Live stock
  /reports       PDF / Excel exports
  /rbac          Roles & permissions admin
"""


def _ask_gemini(
    user: Dict[str, Any],
    message: str,
    facts: Dict[str, Any],
    history: List[Dict[str, str]],
    page_context: Optional[str],
) -> Optional[str]:

    api_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not api_key:
        return None

    try:

        import google.generativeai as genai

        genai.configure(api_key=api_key)

    except Exception:

        return None

    # Build the user-facing prompt — system rules + facts + history + new message.
    history_text = "\n".join(
        f"{turn['role'].upper()}: {turn['content']}"
        for turn in history[-8:]   # last 8 turns of context, keeps prompts bounded
    )

    facts_json = json.dumps(facts, default=str, ensure_ascii=False)

    page_line = f"User is currently on page: {page_context}" if page_context else ""

    prompt = (
        f"{_SYSTEM_PROMPT}\n\n"
        f"--- FACTS YOU MAY USE ---\n{facts_json}\n\n"
        f"--- CONVERSATION SO FAR ---\n{history_text}\n\n"
        f"{page_line}\n\n"
        f"USER: {message}\n"
        f"ASSISTANT:"
    )

    preferred = (os.getenv("GEMINI_MODEL") or "").strip()

    chain = [preferred] + [m for m in GEMINI_MODEL_CHAIN if m != preferred] if preferred else GEMINI_MODEL_CHAIN

    for model_name in chain:

        try:

            model = genai.GenerativeModel(model_name)

            resp = model.generate_content(prompt)

            text = (resp.text or "").strip()

            if text:
                return text

        except Exception:

            # Try next model in the chain — quota / model-not-available / etc.
            continue

    return None


# ---------------------------------------------------------------------
# Rule-based fallback — kicks in only when Gemini is unreachable
# ---------------------------------------------------------------------

def _rule_based_fallback(message: str, facts: Dict[str, Any]) -> str:

    msg = (message or "").lower()

    if any(k in msg for k in ("hi", "hello", "hey", "vanakkam", "namaste")):
        return "Hello! I'm the BVC24 assistant. The AI is currently unavailable, but you can still navigate to modules like /attendance, /leave-management, /memos, /payroll."

    me = facts.get("me") or {}

    if "leave" in msg and facts.get("my_recent_leaves"):
        recent = facts["my_recent_leaves"][:3]
        return "Recent leaves:\n" + "\n".join(
            f"  • {l['from']} → {l['to']} · {l['type']} · {l['status']}"
            for l in recent
        )

    if "memo" in msg and facts.get("my_active_memos"):
        active = facts["my_active_memos"]
        return f"You have {len(active)} active memo(s). Open /memos to review them."

    if "salary" in msg or "pay" in msg or "payroll" in msg:
        slip = facts.get("my_last_payslip")
        if slip:
            return f"Your last payslip: net Rs.{slip['net']:,.0f} (base Rs.{slip['base']:,.0f} + bonus Rs.{slip['bonus']:,.0f} from {slip['stars']}★ rating)."
        return "I don't see a payslip on file yet. The Payroll page is at /payroll."

    if "holiday" in msg:
        hols = facts.get("holidays_this_year") or []
        if hols:
            upcoming = [h for h in hols if h["date"] >= facts["today"]][:3]
            if upcoming:
                return "Upcoming holidays:\n" + "\n".join(
                    f"  • {h['date']} — {h['name']}" for h in upcoming
                )
        return "Holiday list is on the /holidays page."

    return (
        "The AI assistant is currently unavailable. You can still browse "
        "the modules from the sidebar — try /attendance, /leave-management, "
        "/memos, or /payroll depending on what you need."
    )
