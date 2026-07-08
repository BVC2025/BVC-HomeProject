"""
AI Agent — Phase 1: rule-based intent router.

  POST /ai/chat
    Body:  { message: str, session_id: Optional[str] }
    Auth:  JWT (any authenticated user — employee or admin)
    Returns:
      {
        matched:     bool,
        intent:      str | null,
        reply:       str,
        data:        object | null,
        suggestions: [str],
        source:      "intent_router" | "unmatched",
        elapsed_ms:  int
      }

Design principles (from the Phase-1 plan):

  1. Zero LLM calls in this router. Every response is a SQL lookup +
     deterministic string format, so p50 latency is <200ms.
  2. Role-scoped from day 1. Every handler reads employee_id + role
     from the JWT and filters accordingly. An employee sees only their
     own data; a manager/HR sees their own by default (broader admin
     queries land in Phase 6).
  3. Intent classifier is regex-based, first-match-wins. Ordered
     specific → general so ambiguous inputs resolve consistently.
  4. If no intent matches, returns matched=false so the frontend can
     fall back to the legacy /chat/stream (which still catches
     leave-application workflows) without user-visible seams.
"""

import re
import time
from datetime import date, datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_user, get_current_admin
from app.models.models import (
    Employee, Department, Designation,
    LeaveBalance, LeaveRequest,
    Attendance, HolidayCalendar,
    PayrollSlip, EmployeeDocument,
    TaskAssignment, Project,
    ShiftAssignment, Shift,
)
from app.services import ollama_client, rag_index, rag_service


router = APIRouter(prefix="/ai", tags=["AI Agent"])


# =====================================================================
# Request / response schemas
# =====================================================================


class ChatIn(BaseModel):

    message: str
    session_id: Optional[str] = None


class ChatOut(BaseModel):

    matched: bool
    intent: Optional[str] = None
    reply: str
    data: Optional[Dict[str, Any]] = None
    suggestions: List[str] = []
    source: str = "intent_router"
    scope: str = "EMPLOYEE"                  # caller's resolved role scope
    # RAG-specific fields (populated only when source == "rag")
    sources: List[Dict[str, Any]] = []
    elapsed_ms: int = 0


# =====================================================================
# Role scope — Phase 3
#
# We bucket every ADMIN_ROLES entry into three broad tiers so the intent
# handlers can decide what to show. This is intentionally coarser than
# the raw role list because chatbot semantics are simpler: an employee
# sees own; a manager sees own + direct reports; HR / admin sees org.
# =====================================================================


HR_ADMIN_ROLES = {"HR", "HR_MANAGER", "ADMIN", "SUPER_ADMIN"}


def _scope(role: str) -> str:
    """Bucket the JWT `role` claim into EMPLOYEE / MANAGER / HR_ADMIN."""

    r = (role or "").upper()

    if r in HR_ADMIN_ROLES:

        return "HR_ADMIN"

    # Anything ending in _MANAGER (SALES_MANAGER, PRODUCTION_MANAGER,
    # PURCHASE_MANAGER, INVENTORY_MANAGER, ACCOUNTS_MANAGER, …) is a
    # people manager for the purposes of the chatbot.
    if r.endswith("_MANAGER"):

        return "MANAGER"

    return "EMPLOYEE"


_SCOPE_RANK = {"EMPLOYEE": 0, "MANAGER": 1, "HR_ADMIN": 2}


def _require_scope(caller_scope: str, min_scope: str) -> Optional[Dict[str, Any]]:
    """Return a denial dict if `caller_scope` is lower than `min_scope`.
    None means access allowed."""

    if _SCOPE_RANK.get(caller_scope, 0) >= _SCOPE_RANK.get(min_scope, 2):

        return None

    return {
        "reply": (
            "This is a team-wide question and requires manager or HR "
            "access. As an employee, you can ask about your own leave, "
            "shift, tasks, attendance, payslip, or documents."
        ),
        "data": {"denied": True, "caller_scope": caller_scope, "min_scope": min_scope},
        "suggestions": [
            "Leave balance", "My attendance", "My pending tasks", "My profile",
        ],
    }


def _team_ids(db: Session, manager_id: str) -> List[str]:
    """Direct reports of this manager (people whose REPORTING_MANAGER_ID
    points to this employee)."""

    rows = (
        db.query(Employee.ID)
        .filter(Employee.REPORTING_MANAGER_ID == manager_id)
        .all()
    )

    return [r[0] for r in rows]


def _visible_employee_ids(
    db: Session,
    caller_id: str,
    caller_scope: str,
) -> Set[str]:
    """Set of employee IDs whose data the caller is allowed to see.

      • EMPLOYEE  → { self }
      • MANAGER   → { self } ∪ direct reports
      • HR_ADMIN  → every non-resigned employee in the org
    """

    if caller_scope == "HR_ADMIN":

        rows = (
            db.query(Employee.ID)
            .filter(Employee.STATUS.notin_({"RESIGNED", "TERMINATED"}))
            .all()
        )

        return {r[0] for r in rows}

    if caller_scope == "MANAGER":

        ids = set(_team_ids(db, caller_id))
        ids.add(caller_id)
        return ids

    return {caller_id}


def _fetch_names(db: Session, employee_ids: Set[str]) -> Dict[str, str]:
    """Bulk lookup id → name for pretty-printing manager/HR replies."""

    if not employee_ids:

        return {}

    rows = (
        db.query(Employee.ID, Employee.NAME)
        .filter(Employee.ID.in_(employee_ids))
        .all()
    )

    return {r[0]: r[1] for r in rows}


# =====================================================================
# Intent classifier
# =====================================================================
#
# Each entry: (intent_key, compiled_pattern, handler_fn)
# First pattern that matches wins. Order = most specific → most general.
# Patterns are re.IGNORECASE; boundaries used where needed to avoid
# partial-word matches (e.g. "payslip" shouldn't fire on "payslip*ery*").


INTENT_PATTERNS: List[Tuple[str, re.Pattern]] = [

    # =========================================================
    # PHASE 6 — Manager conveniences (specific to team ops).
    # Ordered before Phase-3 team intents because their phrasing
    # is more specific (e.g. "team attendance last week" would
    # otherwise fire TEAM_ATTENDANCE_TODAY).
    # =========================================================

    # TEAM_ATTENDANCE_WEEK — "last week's team attendance",
    # "team attendance last 7 days"
    ("TEAM_ATTENDANCE_WEEK", re.compile(
        r"\b("
        r"team\s+attendance\s+(?:last|past|this)\s+(?:week|7\s+days)"
        r"|last\s+week(?:'s)?\s+team\s+attendance"
        r"|team\s+attendance\s+(?:week|weekly)"
        r"|weekly\s+team\s+attendance"
        r")\b",
        re.IGNORECASE,
    )),

    # TEAM_LEAVE_CALENDAR — "team leave calendar",
    # "who's on leave next week", "upcoming team leaves"
    ("TEAM_LEAVE_CALENDAR", re.compile(
        r"\b("
        r"team\s+leave\s+calendar"
        r"|(?:upcoming|next\s+week)\s+(?:team\s+)?leaves?"
        r"|leaves?\s+(?:next\s+week|coming\s+up|scheduled)"
        r"|who(?:'s|\s+is)\s+on\s+leave\s+(?:next|this\s+week)"
        r")\b",
        re.IGNORECASE,
    )),

    # TEAM_OT_HOURS — "team OT hours this month", "overtime team"
    ("TEAM_OT_HOURS", re.compile(
        r"\b("
        r"team\s+(?:ot|overtime)"
        r"|(?:ot|overtime)\s+(?:hours?|for\s+(?:team|the\s+team))"
        r"|(?:this\s+month(?:'s)?\s+)?team\s+overtime"
        r"|how\s+much\s+(?:ot|overtime)\s+(?:has\s+)?(?:my\s+)?team"
        r")\b",
        re.IGNORECASE,
    )),

    # TEAM_OVERDUE_TASKS — "team overdue tasks",
    # "what's my team behind on"
    ("TEAM_OVERDUE_TASKS", re.compile(
        r"\b("
        r"team\s+overdue\s+tasks?"
        r"|overdue\s+(?:team\s+)?tasks?"
        r"|team\s+(?:tasks?\s+)?behind(?:\s+on)?"
        r"|what(?:'s|\s+is)\s+(?:my\s+)?team\s+behind"
        r"|delayed\s+(?:team\s+)?tasks?"
        r")\b",
        re.IGNORECASE,
    )),

    # AT_RISK_ATTENDANCE — "who is at risk",
    # "employees with attendance issues"
    ("AT_RISK_ATTENDANCE", re.compile(
        r"\b("
        r"(?:employees?|people|who)\s+at\s+risk"
        r"|at[-\s]risk\s+(?:employees?|attendance)"
        r"|attendance\s+(?:issues|problems|risks?)"
        r"|(?:who|which\s+employees?)\s+(?:has|have)\s+(?:bad|poor)\s+attendance"
        r"|frequent\s+(?:late|absentees?)"
        r")\b",
        re.IGNORECASE,
    )),

    # EMPLOYEE_LEAVE_LOOKUP — "how many leaves has <Name> taken",
    # "<Name>'s leave balance", "leave history of <Name>"
    # NOTE: this pattern deliberately requires a hint of a name
    # (word starting with a capital letter or after 'has' / "'s")
    # so it doesn't clash with the self-scoped LEAVE_BALANCE.
    ("EMPLOYEE_LEAVE_LOOKUP", re.compile(
        r"\b("
        r"(?:how\s+many\s+leaves?\s+(?:has|have|did))\s+\S+"
        r"|leaves?\s+(?:taken\s+)?by\s+[A-Z]\S*"
        r"|leaves?\s+(?:of|for)\s+[A-Z]\S*"
        r"|[A-Z]\S*'s\s+leaves?"
        r"|leave\s+(?:history|balance)\s+(?:of|for)\s+[A-Z]\S*"
        r")\b",
        re.IGNORECASE,
    )),

    # =========================================================
    # MANAGER / HR-scoped intents — placed FIRST so team-oriented
    # phrasing wins before the self-scoped patterns fire.
    # =========================================================

    # PENDING_APPROVALS — "pending approvals", "leaves to approve"
    ("PENDING_APPROVALS", re.compile(
        r"\b("
        r"pending\s+approvals?"
        r"|leaves?\s+to\s+approve"
        r"|approve\s+leaves?"
        r"|approval\s+queue"
        r"|what\s+(?:do\s+i\s+need\s+to\s+approve|needs\s+my\s+approval)"
        r"|things?\s+to\s+approve"
        r")\b",
        re.IGNORECASE,
    )),

    # TEAM_ON_LEAVE_TODAY — "who's on leave today", "team on leave"
    ("TEAM_ON_LEAVE_TODAY", re.compile(
        r"\b("
        r"who(?:'s|\s+is)\s+on\s+leave(?:\s+today)?"
        r"|team\s+(?:on\s+)?leave(?:s|\s+today)?"
        r"|(?:team\s+)?absentees?"
        r"|who(?:'s|\s+is)\s+not\s+in(?:\s+today)?"
        r"|who\s+isn'?t\s+in\s+today"
        r")\b",
        re.IGNORECASE,
    )),

    # TEAM_ATTENDANCE_TODAY — "team attendance today", "team status"
    ("TEAM_ATTENDANCE_TODAY", re.compile(
        r"\b("
        r"team\s+attendance(?:\s+today)?"
        r"|(?:my\s+)?team\s+today"
        r"|team\s+status"
        r"|(?:team\s+)?(?:present|attendance)\s+today"
        r"|who(?:'s|\s+is)\s+(?:present|in)\s+today"
        r")\b",
        re.IGNORECASE,
    )),

    # TEAM_ROSTER — "my team", "who reports to me"
    ("TEAM_ROSTER", re.compile(
        r"\b("
        r"my\s+team\b(?!\s+attendance)(?!\s+today)"
        r"|team\s+(?:members|list|roster)"
        r"|who\s+reports\s+to\s+me"
        r"|direct\s+reports"
        r"|(?:show|list)\s+my\s+team"
        r")\b",
        re.IGNORECASE,
    )),

    # =========================================================
    # SELF-scoped intents (existing 10 from Phase 1)
    # =========================================================

    # LEAVE_BALANCE — "how many CL / SL / EL", "leave balance", etc.
    ("LEAVE_BALANCE", re.compile(
        r"\b("
        r"leave\s+balance"
        r"|(?:remaining|available|left)\s+leaves?"
        r"|(?:cl|sl|el|pl)\s+(?:balance|left|remaining|available)"
        r"|how\s+many\s+(?:cl|sl|el|pl|leaves|days)"
        r"|(?:casual|sick|earned|maternity)\s+leaves?"
        r")\b",
        re.IGNORECASE,
    )),

    # LEAVE_HISTORY — "my leaves", "leave history", "recent leaves"
    ("LEAVE_HISTORY", re.compile(
        r"\b("
        r"leave\s+(?:history|records?|requests?|list|applied)"
        r"|my\s+leaves"
        r"|recent\s+leaves"
        r"|applied\s+leaves"
        r")\b",
        re.IGNORECASE,
    )),

    # NEXT_SHIFT — "next shift", "today shift", "my roster"
    ("NEXT_SHIFT", re.compile(
        r"\b("
        r"next\s+shift"
        r"|today(?:'s)?\s+shift"
        r"|tomorrow(?:'s)?\s+shift"
        r"|my\s+shift"
        r"|my\s+roster"
        r"|shift\s+(?:for|on|today|tomorrow|this\s+week)"
        r"|when\s+(?:do\s+i|is\s+my)\s+(?:work|shift)"
        r")\b",
        re.IGNORECASE,
    )),

    # PAYSLIP — "my payslip", "salary", "net pay"
    ("PAYSLIP", re.compile(
        r"\b("
        r"pay\s*slip"
        r"|last\s+(?:month'?s?\s+)?(?:pay|salary)"
        r"|my\s+(?:salary|pay|net\s*pay|gross\s*pay)"
        r"|salary\s+(?:for|of|last)"
        r"|payroll\s+(?:for|of|last|month)"
        r")\b",
        re.IGNORECASE,
    )),

    # ATTENDANCE_STATS — "my attendance", "present days", "late count"
    ("ATTENDANCE_STATS", re.compile(
        r"\b("
        r"my\s+attendance"
        r"|attendance\s+(?:this\s+month|percentage|stats|summary|report)"
        r"|present\s+days"
        r"|absent\s+days"
        r"|how\s+many\s+(?:days|times)\s+(?:present|absent|late)"
        r"|late\s+count"
        r")\b",
        re.IGNORECASE,
    )),

    # PENDING_TASKS — "my tasks", "pending tasks", "assigned tasks"
    ("PENDING_TASKS", re.compile(
        r"\b("
        r"my\s+tasks?"
        r"|pending\s+tasks?"
        r"|assigned\s+tasks?"
        r"|(?:tasks?|todo)\s+(?:pending|due|list)"
        r"|(?:what|which)\s+tasks?"
        r"|(?:tasks?|work)\s+for\s+(?:today|me|this\s+week)"
        r")\b",
        re.IGNORECASE,
    )),

    # HOLIDAYS — "next holiday", "upcoming holidays", "holiday list"
    ("HOLIDAYS", re.compile(
        r"\b("
        r"next\s+holiday"
        r"|upcoming\s+holidays?"
        r"|holiday\s+(?:list|calendar|this\s+month)"
        r"|(?:list|show)\s+holidays"
        r"|holidays?\s+in\s+(?:this|next)\s+month"
        r")\b",
        re.IGNORECASE,
    )),

    # MY_MANAGER — "my manager", "reporting manager", "supervisor"
    ("MY_MANAGER", re.compile(
        r"\b("
        r"my\s+manager"
        r"|reporting\s+manager"
        r"|my\s+supervisor"
        r"|who(?:'s|\s+is)\s+my\s+(?:manager|supervisor|boss)"
        r"|who\s+do\s+i\s+report\s+to"
        r")\b",
        re.IGNORECASE,
    )),

    # MY_PROFILE — "my profile", "who am i", "my department"
    ("MY_PROFILE", re.compile(
        r"\b("
        r"my\s+profile"
        r"|my\s+details"
        r"|who\s+am\s+i"
        r"|my\s+(?:department|designation|role|employee\s+code|joining\s+date)"
        r"|profile\s+(?:info|details)"
        r")\b",
        re.IGNORECASE,
    )),

    # MY_DOCUMENTS — "my documents", "uploaded documents"
    ("MY_DOCUMENTS", re.compile(
        r"\b("
        r"my\s+documents?"
        r"|uploaded\s+documents?"
        r"|which\s+documents?"
        r"|documents?\s+(?:uploaded|submitted|on\s+file)"
        r"|(?:aadhaar|pan|bank)\s+(?:on\s+file|uploaded)"
        r")\b",
        re.IGNORECASE,
    )),
]


def classify(message: str) -> Optional[str]:
    """First matching intent wins. None means fall through to LLM."""

    for intent_key, pattern in INTENT_PATTERNS:

        if pattern.search(message):

            return intent_key

    return None


# =====================================================================
# Handlers — one per intent. All are read-only + role-scoped.
#
# Every handler has the same signature so they can be dispatched from
# a dict at the endpoint bottom:
#
#     handle(db, employee_id, role) -> {reply, data, suggestions}
#
# Returning `data` gives the frontend structured payload for future
# rendering (charts, tables) alongside the natural-language reply.
# =====================================================================


def _require_employee(db: Session, employee_id: str) -> Employee:
    """Every handler runs in the context of the current authenticated
    user, whose employee_id is the JWT subject. If the token points at
    a row that no longer exists (e.g. the employee was deleted mid-
    session), we surface a friendly message instead of a 500."""

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if emp is None:

        raise HTTPException(
            status_code=404,
            detail="Your employee record is missing. Please log out and back in.",
        )

    return emp


def _pluralize(n: int, singular: str, plural: Optional[str] = None) -> str:

    if n == 1:

        return f"{n} {singular}"

    return f"{n} {plural or singular + 's'}"


def _fmt_date(d) -> str:

    if not d:

        return "—"

    try:

        return d.strftime("%d %b %Y")

    except Exception:

        return str(d)


# ---------- 1. LEAVE_BALANCE ----------


def handle_leave_balance(db: Session, employee_id: str, role: str) -> dict:

    _require_employee(db, employee_id)

    year = date.today().year

    bal = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.EMPLOYEE_ID == employee_id,
            LeaveBalance.YEAR == year,
        )
        .first()
    )

    if bal is None:

        return {
            "reply": (
                "You don't have a leave balance for "
                f"{year} yet. Contact HR to have your quota initialised."
            ),
            "data": None,
            "suggestions": ["My profile", "My manager", "Next shift"],
        }

    def _remaining(total, used, carry):

        return round(
            max(0.0, float(total or 0) + float(carry or 0) - float(used or 0)),
            1,
        )

    casual = _remaining(bal.CASUAL_TOTAL, bal.CASUAL_USED, bal.CASUAL_CARRYOVER)
    sick   = _remaining(bal.SICK_TOTAL, bal.SICK_USED, bal.SICK_CARRYOVER)
    earned = _remaining(bal.EARNED_TOTAL, bal.EARNED_USED, bal.EARNED_CARRYOVER)
    matern = _remaining(bal.MATERNITY_TOTAL, bal.MATERNITY_USED, bal.MATERNITY_CARRYOVER)

    lines = [
        f"Your leave balance for {year}:",
        f"  • Casual (CL): **{casual}** left",
        f"  • Sick (SL):   **{sick}** left",
        f"  • Earned (EL): **{earned}** left",
    ]

    if float(bal.MATERNITY_TOTAL or 0) > 0:

        lines.append(f"  • Maternity:   **{matern}** left")

    reply = "\n".join(lines)

    return {
        "reply": reply,
        "data": {
            "year": year,
            "casual_remaining":    casual,
            "sick_remaining":      sick,
            "earned_remaining":    earned,
            "maternity_remaining": matern,
        },
        "suggestions": ["Apply leave", "Leave history", "My attendance"],
    }


# ---------- 2. LEAVE_HISTORY ----------


def handle_leave_history(db: Session, employee_id: str, role: str) -> dict:

    _require_employee(db, employee_id)

    rows = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.EMPLOYEE_ID == employee_id)
        .order_by(LeaveRequest.ID.desc())
        .limit(5)
        .all()
    )

    if not rows:

        return {
            "reply": "You haven't applied for any leaves yet.",
            "data": {"items": []},
            "suggestions": ["Leave balance", "Apply leave"],
        }

    lines = ["Your last few leave requests:"]

    items = []

    for r in rows:

        span = _fmt_date(r.START_DATE)

        if r.END_DATE and r.END_DATE != r.START_DATE:

            span += f" → {_fmt_date(r.END_DATE)}"

        lines.append(
            f"  • {span} · {r.LEAVE_TYPE or 'LEAVE'} · **{r.STATUS or 'PENDING'}**"
        )

        items.append({
            "start": r.START_DATE.isoformat() if r.START_DATE else None,
            "end":   r.END_DATE.isoformat() if r.END_DATE else None,
            "type":  r.LEAVE_TYPE,
            "status": r.STATUS,
        })

    return {
        "reply": "\n".join(lines),
        "data": {"items": items},
        "suggestions": ["Leave balance", "Apply leave"],
    }


# ---------- 3. NEXT_SHIFT ----------


def handle_next_shift(db: Session, employee_id: str, role: str) -> dict:

    _require_employee(db, employee_id)

    today = date.today()

    upcoming = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == employee_id,
            ShiftAssignment.SHIFT_DATE >= today,
        )
        .order_by(ShiftAssignment.SHIFT_DATE.asc())
        .limit(5)
        .all()
    )

    if not upcoming:

        # Fallback: read the default SHIFT_START/END on the Employee row
        emp = db.query(Employee).filter(Employee.ID == employee_id).first()

        if emp and emp.SHIFT_START and emp.SHIFT_END:

            return {
                "reply": (
                    "You don't have any scheduled shifts yet, but your "
                    f"default is **{emp.SHIFT_START.strftime('%H:%M')} — "
                    f"{emp.SHIFT_END.strftime('%H:%M')}**."
                ),
                "data": {
                    "default_start": emp.SHIFT_START.strftime("%H:%M"),
                    "default_end":   emp.SHIFT_END.strftime("%H:%M"),
                    "items": [],
                },
                "suggestions": ["My attendance", "Holidays"],
            }

        return {
            "reply": (
                "You don't have any scheduled shifts yet. Ask HR to "
                "assign you one on the Shift Management page."
            ),
            "data": {"items": []},
            "suggestions": ["My attendance", "Holidays"],
        }

    shift_ids = {a.SHIFT_ID for a in upcoming if a.SHIFT_ID}
    shifts = {}

    if shift_ids:

        for s in db.query(Shift).filter(Shift.ID.in_(shift_ids)).all():

            shifts[s.ID] = s

    lines = ["Your upcoming shifts:"]
    items = []

    for a in upcoming:

        d_label = _fmt_date(a.SHIFT_DATE)

        s = shifts.get(a.SHIFT_ID) if a.SHIFT_ID else None

        if s is None:

            lines.append(f"  • {d_label} · **OFF-day**")

            items.append({"date": a.SHIFT_DATE.isoformat(), "is_off": True})

        else:

            lines.append(
                f"  • {d_label} · **{s.NAME}** "
                f"({s.START_TIME.strftime('%H:%M')} — {s.END_TIME.strftime('%H:%M')})"
            )

            items.append({
                "date":  a.SHIFT_DATE.isoformat(),
                "shift": s.NAME,
                "start": s.START_TIME.strftime("%H:%M"),
                "end":   s.END_TIME.strftime("%H:%M"),
                "is_off": False,
            })

    return {
        "reply": "\n".join(lines),
        "data": {"items": items},
        "suggestions": ["My attendance", "Holidays", "Leave balance"],
    }


# ---------- 4. PAYSLIP ----------


def handle_payslip(db: Session, employee_id: str, role: str) -> dict:

    _require_employee(db, employee_id)

    slip = (
        db.query(PayrollSlip)
        .filter(PayrollSlip.EMPLOYEE_ID == employee_id)
        .order_by(PayrollSlip.ID.desc())
        .first()
    )

    if slip is None:

        return {
            "reply": (
                "You don't have any payslips yet. HR generates them at "
                "the end of each month."
            ),
            "data": None,
            "suggestions": ["My attendance", "My profile"],
        }

    period = "the most recent payroll"

    if slip.MONTH and slip.YEAR:

        try:

            period = datetime(slip.YEAR, slip.MONTH, 1).strftime("%B %Y")

        except Exception:

            pass

    base    = float(slip.BASE_SALARY or 0)
    dedn    = float(getattr(slip, "TOTAL_DEDUCTION", 0) or 0)
    incr    = float(getattr(slip, "INCREMENT", 0) or 0)
    net     = float(getattr(slip, "NET_PAY", 0) or 0) or (base - dedn + incr)

    lines = [
        f"Your payslip for **{period}**:",
        f"  • Base salary:   ₹{base:,.2f}",
        f"  • Deductions:    ₹{dedn:,.2f}",
        f"  • Increment:     ₹{incr:,.2f}",
        f"  • **Net pay:     ₹{net:,.2f}**",
    ]

    return {
        "reply": "\n".join(lines),
        "data": {
            "period": period,
            "base":   base,
            "deduction": dedn,
            "increment": incr,
            "net_pay": net,
        },
        "suggestions": ["My attendance", "Leave balance"],
    }


# ---------- 5. ATTENDANCE_STATS ----------


def handle_attendance_stats(db: Session, employee_id: str, role: str) -> dict:

    _require_employee(db, employee_id)

    today = date.today()
    first_of_month = today.replace(day=1)

    rows = (
        db.query(Attendance)
        .filter(
            Attendance.EMPLOYEE_ID == employee_id,
            Attendance.DATE >= first_of_month,
            Attendance.DATE <= today,
        )
        .all()
    )

    present = 0
    absent  = 0
    late    = 0
    leave_d = 0

    for a in rows:

        s = (a.STATUS or "").upper()

        if s in ("PRESENT", "P"):

            present += 1

        elif s in ("ABSENT", "A"):

            absent += 1

        elif s == "LATE":

            late += 1

        elif s in ("LEAVE", "ON_LEAVE"):

            leave_d += 1

    total = len(rows)

    pct = round((present + late) / total * 100, 1) if total > 0 else 0.0

    month_name = today.strftime("%B %Y")

    lines = [
        f"Your attendance for **{month_name}**:",
        f"  • Present: **{present}** days",
        f"  • Late:    **{late}** days",
        f"  • Absent:  **{absent}** days",
        f"  • Leave:   **{leave_d}** days",
        f"  • **Attendance rate: {pct}%**",
    ]

    return {
        "reply": "\n".join(lines),
        "data": {
            "month":       month_name,
            "present":     present,
            "late":        late,
            "absent":      absent,
            "leave":       leave_d,
            "percentage":  pct,
        },
        "suggestions": ["Leave balance", "Next shift", "Holidays"],
    }


# ---------- 6. PENDING_TASKS ----------


def handle_pending_tasks(db: Session, employee_id: str, role: str) -> dict:

    _require_employee(db, employee_id)

    DONE_STATES = {"COMPLETED", "DONE", "APPROVED", "CANCELLED"}

    rows = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == employee_id,
            ~func.upper(TaskAssignment.TASK_STATUS).in_(DONE_STATES),
        )
        .order_by(TaskAssignment.DUE_DATE.asc().nullslast())
        .limit(6)
        .all()
    )

    if not rows:

        return {
            "reply": "You have no pending tasks. Enjoy the breathing room.",
            "data": {"items": []},
            "suggestions": ["My attendance", "Next shift"],
        }

    project_ids = {r.PROJECT_ID for r in rows if r.PROJECT_ID}
    project_names = {}

    if project_ids:

        for p in db.query(Project).filter(Project.ID.in_(project_ids)).all():

            project_names[p.ID] = p.PROJECT_NAME

    lines = [f"You have **{_pluralize(len(rows), 'pending task')}**:"]
    items = []

    for r in rows:

        due_label = _fmt_date(r.DUE_DATE) if r.DUE_DATE else "no due date"

        proj = project_names.get(r.PROJECT_ID)

        lines.append(
            f"  • {r.TASK_NAME or 'Untitled'} · "
            f"{proj + ' · ' if proj else ''}due {due_label} · "
            f"{r.TASK_STATUS or 'PENDING'}"
        )

        items.append({
            "task_id":  r.TASK_ID,
            "name":     r.TASK_NAME,
            "project":  proj,
            "due_date": r.DUE_DATE.isoformat() if r.DUE_DATE else None,
            "status":   r.TASK_STATUS,
        })

    return {
        "reply": "\n".join(lines),
        "data": {"items": items},
        "suggestions": ["Next shift", "My attendance"],
    }


# ---------- 7. HOLIDAYS ----------


def handle_holidays(db: Session, employee_id: str, role: str) -> dict:

    emp = _require_employee(db, employee_id)

    today = date.today()
    horizon = today + timedelta(days=90)

    rows = (
        db.query(HolidayCalendar)
        .filter(
            HolidayCalendar.VENDOR_ID == (emp.VENDOR_ID or 1),
            HolidayCalendar.HOLIDAY_DATE >= today,
            HolidayCalendar.HOLIDAY_DATE <= horizon,
        )
        .order_by(HolidayCalendar.HOLIDAY_DATE.asc())
        .limit(8)
        .all()
    )

    if not rows:

        return {
            "reply": "No holidays are scheduled in the next 90 days.",
            "data": {"items": []},
            "suggestions": ["Leave balance", "Next shift"],
        }

    lines = ["Upcoming holidays:"]

    items = []

    for h in rows:

        lines.append(f"  • {_fmt_date(h.HOLIDAY_DATE)} · **{h.NAME}**")

        items.append({
            "date": h.HOLIDAY_DATE.isoformat(),
            "name": h.NAME,
        })

    return {
        "reply": "\n".join(lines),
        "data": {"items": items},
        "suggestions": ["Leave balance", "Next shift"],
    }


# ---------- 8. MY_MANAGER ----------


def handle_my_manager(db: Session, employee_id: str, role: str) -> dict:

    emp = _require_employee(db, employee_id)

    mgr_id = getattr(emp, "REPORTING_MANAGER_ID", None)

    if not mgr_id:

        return {
            "reply": (
                "You don't have a reporting manager assigned yet. HR "
                "can set one from the Employee page."
            ),
            "data": None,
            "suggestions": ["My profile", "My department"],
        }

    mgr = db.query(Employee).filter(Employee.ID == mgr_id).first()

    if mgr is None:

        return {
            "reply": "Your manager record isn't accessible. Contact HR.",
            "data": None,
            "suggestions": ["My profile"],
        }

    designation = None

    if mgr.DESIGNATION_ID:

        d = db.query(Designation).filter(Designation.ID == mgr.DESIGNATION_ID).first()

        designation = d.TITLE if d else None

    contact_bits = []

    if mgr.EMAIL:

        contact_bits.append(mgr.EMAIL)

    if mgr.PHONE:

        contact_bits.append(mgr.PHONE)

    contact = " · ".join(contact_bits) if contact_bits else "no contact on file"

    reply = (
        f"Your reporting manager is **{mgr.NAME}**"
        f"{' (' + designation + ')' if designation else ''}. "
        f"You can reach them at {contact}."
    )

    return {
        "reply": reply,
        "data": {
            "manager_id":     mgr.ID,
            "manager_name":   mgr.NAME,
            "designation":    designation,
            "email":          mgr.EMAIL,
            "phone":          mgr.PHONE,
            "employee_code":  mgr.EMPLOYEE_CODE,
        },
        "suggestions": ["My profile", "My department"],
    }


# ---------- 9. MY_PROFILE ----------


def handle_my_profile(db: Session, employee_id: str, role: str) -> dict:

    emp = _require_employee(db, employee_id)

    dept_name = None
    desig_title = None

    if emp.DEPARTMENT_ID:

        d = db.query(Department).filter(Department.ID == emp.DEPARTMENT_ID).first()

        dept_name = d.NAME if d else None

    if emp.DESIGNATION_ID:

        d = db.query(Designation).filter(Designation.ID == emp.DESIGNATION_ID).first()

        desig_title = d.TITLE if d else None

    lines = [f"Here's your profile:"]

    lines.append(f"  • **Name**: {emp.NAME}")
    lines.append(f"  • **Employee code**: {emp.EMPLOYEE_CODE or '—'}")

    if dept_name:

        lines.append(f"  • **Department**: {dept_name}")

    if desig_title:

        lines.append(f"  • **Designation**: {desig_title}")

    if emp.JOINING_DATE:

        lines.append(f"  • **Joining date**: {_fmt_date(emp.JOINING_DATE)}")

    if getattr(emp, "CORPORATE_EMAIL", None):

        lines.append(f"  • **Corporate email**: {emp.CORPORATE_EMAIL}")

    elif emp.EMAIL:

        lines.append(f"  • **Email**: {emp.EMAIL}")

    if emp.PHONE:

        lines.append(f"  • **Phone**: {emp.PHONE}")

    return {
        "reply": "\n".join(lines),
        "data": {
            "employee_id":     emp.ID,
            "employee_code":   emp.EMPLOYEE_CODE,
            "name":            emp.NAME,
            "department":      dept_name,
            "designation":     desig_title,
            "joining_date":    emp.JOINING_DATE.isoformat() if emp.JOINING_DATE else None,
            "corporate_email": getattr(emp, "CORPORATE_EMAIL", None),
            "personal_email":  emp.EMAIL,
            "phone":           emp.PHONE,
        },
        "suggestions": ["My manager", "My documents"],
    }


# ---------- 10. MY_DOCUMENTS ----------


def handle_my_documents(db: Session, employee_id: str, role: str) -> dict:

    emp = _require_employee(db, employee_id)

    docs = (
        db.query(EmployeeDocument)
        .filter(EmployeeDocument.EMPLOYEE_ID == employee_id)
        .all()
    )

    # Track structured KYC fields on the Employee row as "on file" too
    inferred = []

    if getattr(emp, "AADHAAR_NUMBER", None):

        inferred.append("Aadhaar")

    if getattr(emp, "PAN_NUMBER", None):

        inferred.append("PAN")

    if getattr(emp, "BANK_ACCOUNT_NUMBER", None):

        inferred.append("Bank account")

    if not docs and not inferred:

        return {
            "reply": (
                "You haven't uploaded any documents yet. Head to "
                "Onboarding → My Documents to add Aadhaar, PAN, and "
                "bank proof."
            ),
            "data": {"items": []},
            "suggestions": ["My profile", "My manager"],
        }

    lines = ["Documents on file:"]

    items = []

    seen_types = set()

    for d in docs:

        dtype = (d.DOC_TYPE or "OTHER").upper()

        seen_types.add(dtype)

        lines.append(f"  • **{dtype.replace('_', ' ')}** ({d.FILE_NAME or 'unnamed'})")

        items.append({
            "doc_type":  dtype,
            "file_name": d.FILE_NAME,
            "id":        d.ID,
        })

    # Mention inferred KYC that isn't already covered by an uploaded doc
    for label in inferred:

        key = label.upper().replace(" ", "_")

        if key not in seen_types and label.upper() not in seen_types:

            lines.append(f"  • **{label}** on record (structured, no scan)")

    return {
        "reply": "\n".join(lines),
        "data": {"items": items, "inferred": inferred},
        "suggestions": ["My profile", "My manager"],
    }


# =====================================================================
# Manager / HR-scoped handlers (Phase 3)
#
# Each handler starts with an explicit `_require_scope(..., "MANAGER")`
# gate. An EMPLOYEE hitting one of these intents gets a friendly
# rejection instead of accidentally seeing team data.
# =====================================================================


# ---------- 11. PENDING_APPROVALS ----------


def handle_pending_approvals(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    q = db.query(LeaveRequest).filter(LeaveRequest.STATUS == "PENDING_APPROVAL")

    if scope == "MANAGER":

        team = _team_ids(db, employee_id)

        if not team:

            return {
                "reply": (
                    "No one reports to you directly, so there are no "
                    "approvals in your queue."
                ),
                "data": {"count": 0, "items": []},
                "suggestions": ["Team roster", "Team on leave today"],
            }

        q = q.filter(LeaveRequest.EMPLOYEE_ID.in_(team))

    rows = q.order_by(LeaveRequest.ID.desc()).limit(10).all()

    if not rows:

        return {
            "reply": "No pending leave approvals right now — inbox zero.",
            "data": {"count": 0, "items": []},
            "suggestions": ["Team on leave today", "Team attendance today"],
        }

    names = _fetch_names(db, {r.EMPLOYEE_ID for r in rows})

    lines = [f"You have **{_pluralize(len(rows), 'pending approval')}**:"]

    items = []

    for r in rows:

        span = _fmt_date(r.START_DATE)

        if r.END_DATE and r.END_DATE != r.START_DATE:

            span += f" → {_fmt_date(r.END_DATE)}"

        who = names.get(r.EMPLOYEE_ID) or "Unknown employee"

        lines.append(f"  • **{who}** · {r.LEAVE_TYPE or 'LEAVE'} · {span}")

        items.append({
            "id":            r.ID,
            "employee_id":   r.EMPLOYEE_ID,
            "employee_name": who,
            "leave_type":    r.LEAVE_TYPE,
            "start":         r.START_DATE.isoformat() if r.START_DATE else None,
            "end":           r.END_DATE.isoformat() if r.END_DATE else None,
            "days":          float(r.DAYS or 0),
        })

    return {
        "reply": "\n".join(lines),
        "data": {"count": len(rows), "items": items},
        "suggestions": ["Team on leave today", "Team attendance today", "Team roster"],
    }


# ---------- 12. TEAM_ON_LEAVE_TODAY ----------


def handle_team_on_leave_today(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    today = date.today()

    visible = _visible_employee_ids(db, employee_id, scope)

    # Manager without any direct reports still sees themselves — but
    # that isn't useful for this specific query. Explicit friendly reply.
    if scope == "MANAGER" and visible == {employee_id}:

        return {
            "reply": "No one reports to you directly, so there's no team leave to show.",
            "data": {"count": 0, "items": []},
            "suggestions": ["Team roster"],
        }

    rows = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE <= today,
            LeaveRequest.END_DATE   >= today,
            LeaveRequest.EMPLOYEE_ID.in_(visible),
        )
        .order_by(LeaveRequest.START_DATE.asc())
        .all()
    )

    if not rows:

        return {
            "reply": (
                "**Nobody is on approved leave today.** "
                f"({today.strftime('%d %b %Y')})"
            ),
            "data": {"count": 0, "items": []},
            "suggestions": ["Team attendance today", "Pending approvals"],
        }

    names = _fetch_names(db, {r.EMPLOYEE_ID for r in rows})

    scope_label = "your team" if scope == "MANAGER" else "the organisation"

    lines = [
        f"**{_pluralize(len(rows), 'person', 'people')} in {scope_label} on leave today** "
        f"({today.strftime('%d %b %Y')}):"
    ]

    items = []

    for r in rows:

        who = names.get(r.EMPLOYEE_ID) or "Unknown"

        until = _fmt_date(r.END_DATE) if r.END_DATE and r.END_DATE != today else "today"

        lines.append(f"  • **{who}** · {r.LEAVE_TYPE or 'LEAVE'} · until {until}")

        items.append({
            "employee_id":   r.EMPLOYEE_ID,
            "employee_name": who,
            "leave_type":    r.LEAVE_TYPE,
            "until":         r.END_DATE.isoformat() if r.END_DATE else None,
        })

    return {
        "reply": "\n".join(lines),
        "data": {"count": len(rows), "items": items},
        "suggestions": ["Pending approvals", "Team attendance today", "Team roster"],
    }


# ---------- 13. TEAM_ATTENDANCE_TODAY ----------


def handle_team_attendance_today(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    today = date.today()

    visible = _visible_employee_ids(db, employee_id, scope)

    if scope == "MANAGER" and visible == {employee_id}:

        return {
            "reply": "No one reports to you directly yet, so there's no team attendance to show.",
            "data": None,
            "suggestions": ["Team roster"],
        }

    rows = (
        db.query(Attendance)
        .filter(
            Attendance.DATE == today,
            Attendance.EMPLOYEE_ID.in_(visible),
        )
        .all()
    )

    present  = 0
    late     = 0
    absent   = 0
    on_leave = 0

    for a in rows:

        s = (a.STATUS or "").upper()

        if s in ("PRESENT", "P"):

            present += 1

        elif s == "LATE":

            late += 1

        elif s in ("ABSENT", "A"):

            absent += 1

        elif s in ("LEAVE", "ON_LEAVE"):

            on_leave += 1

    total_visible = len(visible)

    unmarked = max(0, total_visible - len(rows))

    scope_label = "Your team" if scope == "MANAGER" else "Organisation"

    lines = [
        f"**{scope_label} attendance for {today.strftime('%d %b %Y')}** ({total_visible} people):",
        f"  • Present:      **{present}**",
        f"  • Late:         **{late}**",
        f"  • Absent:       **{absent}**",
        f"  • On leave:     **{on_leave}**",
    ]

    if unmarked > 0:

        lines.append(f"  • Not yet marked: {unmarked}")

    return {
        "reply": "\n".join(lines),
        "data": {
            "date":     today.isoformat(),
            "total":    total_visible,
            "present":  present,
            "late":     late,
            "absent":   absent,
            "on_leave": on_leave,
            "unmarked": unmarked,
        },
        "suggestions": ["Team on leave today", "Pending approvals", "Team roster"],
    }


# ---------- 14. TEAM_ROSTER ----------


def handle_team_roster(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    if scope == "MANAGER":

        team_ids = _team_ids(db, employee_id)

        if not team_ids:

            return {
                "reply": (
                    "No one reports to you directly yet. HR can set the "
                    "reporting-manager link on each employee's profile."
                ),
                "data": {"members": []},
                "suggestions": ["My profile"],
            }

        team = (
            db.query(Employee)
            .filter(Employee.ID.in_(team_ids))
            .order_by(Employee.NAME.asc())
            .all()
        )

        title = "Your direct reports"

    else:

        # HR_ADMIN — cap at 25 so we don't blast the chat with 500 rows
        team = (
            db.query(Employee)
            .filter(Employee.STATUS.notin_({"RESIGNED", "TERMINATED"}))
            .order_by(Employee.NAME.asc())
            .limit(25)
            .all()
        )

        title = f"Active employees (first {min(len(team), 25)})"

    if not team:

        return {
            "reply": "No employees found.",
            "data": {"members": []},
            "suggestions": ["Team on leave today"],
        }

    # Bulk-load department names for pretty printing
    dept_ids = {e.DEPARTMENT_ID for e in team if e.DEPARTMENT_ID}

    dept_names = {}

    if dept_ids:

        for d in db.query(Department).filter(Department.ID.in_(dept_ids)).all():

            dept_names[d.ID] = d.NAME

    lines = [f"**{title}** ({len(team)} member{'s' if len(team) != 1 else ''}):"]

    members = []

    for e in team:

        d = dept_names.get(e.DEPARTMENT_ID) if e.DEPARTMENT_ID else None

        lines.append(
            f"  • **{e.NAME}** · {e.EMPLOYEE_CODE or 'no code'}"
            f"{' · ' + d if d else ''}"
        )

        members.append({
            "employee_id":   e.ID,
            "name":          e.NAME,
            "employee_code": e.EMPLOYEE_CODE,
            "department":    d,
        })

    return {
        "reply": "\n".join(lines),
        "data": {"count": len(team), "members": members},
        "suggestions": ["Team on leave today", "Team attendance today", "Pending approvals"],
    }


# =====================================================================
# Phase 6 — richer manager conveniences
# =====================================================================


# ---------- 15. TEAM_ATTENDANCE_WEEK ----------


def handle_team_attendance_week(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    today = date.today()

    # Last 7 calendar days including today
    start = today - timedelta(days=6)

    visible = _visible_employee_ids(db, employee_id, scope)

    if scope == "MANAGER" and visible == {employee_id}:

        return {
            "reply": "No one reports to you directly yet.",
            "data": None,
            "suggestions": ["Team roster"],
        }

    rows = (
        db.query(Attendance)
        .filter(
            Attendance.DATE >= start,
            Attendance.DATE <= today,
            Attendance.EMPLOYEE_ID.in_(visible),
        )
        .all()
    )

    # Roll up per employee
    per_emp: Dict[str, Dict[str, int]] = {}

    for a in rows:

        stat = (a.STATUS or "").upper()

        e = per_emp.setdefault(
            a.EMPLOYEE_ID,
            {"present": 0, "late": 0, "absent": 0, "leave": 0},
        )

        if stat in ("PRESENT", "P", "ON_TIME"):

            e["present"] += 1

        elif stat == "LATE":

            e["late"] += 1

        elif stat in ("ABSENT", "A"):

            e["absent"] += 1

        elif stat in ("LEAVE", "ON_LEAVE"):

            e["leave"] += 1

    names = _fetch_names(db, set(per_emp.keys()) | visible)

    # Sort worst-first (highest absent, then late)
    ranked = sorted(
        per_emp.items(),
        key=lambda kv: (-kv[1]["absent"], -kv[1]["late"]),
    )

    scope_label = "your team" if scope == "MANAGER" else "the organisation"

    lines = [
        f"**Attendance for {scope_label}** from "
        f"{start.strftime('%d %b')} → {today.strftime('%d %b %Y')}:",
    ]

    items = []

    for emp_id, stats in ranked[:15]:

        who = names.get(emp_id) or "Unknown"

        lines.append(
            f"  • **{who}** — P {stats['present']} · L {stats['late']} · "
            f"A {stats['absent']} · Lv {stats['leave']}"
        )

        items.append({
            "employee_id":   emp_id,
            "employee_name": who,
            **stats,
        })

    if not per_emp:

        lines.append("  (No attendance rows for this period.)")

    if len(ranked) > 15:

        lines.append(f"  … and {len(ranked) - 15} more")

    return {
        "reply": "\n".join(lines),
        "data": {
            "from_date": start.isoformat(),
            "to_date":   today.isoformat(),
            "items":     items,
        },
        "suggestions": ["Team attendance today", "Team OT hours", "At-risk employees"],
    }


# ---------- 16. TEAM_LEAVE_CALENDAR ----------


def handle_team_leave_calendar(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    today = date.today()

    horizon = today + timedelta(days=30)

    visible = _visible_employee_ids(db, employee_id, scope)

    rows = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.END_DATE   >= today,
            LeaveRequest.START_DATE <= horizon,
            LeaveRequest.EMPLOYEE_ID.in_(visible),
        )
        .order_by(LeaveRequest.START_DATE.asc())
        .all()
    )

    if not rows:

        return {
            "reply": (
                "No approved leaves in the next 30 days — the team is "
                "at full capacity."
            ),
            "data": {"items": []},
            "suggestions": ["Team roster", "Pending approvals"],
        }

    names = _fetch_names(db, {r.EMPLOYEE_ID for r in rows})

    lines = [
        f"**Approved leaves** through {horizon.strftime('%d %b %Y')}:"
    ]

    items = []

    for r in rows:

        who = names.get(r.EMPLOYEE_ID) or "Unknown"

        span = _fmt_date(r.START_DATE)

        if r.END_DATE and r.END_DATE != r.START_DATE:

            span += f" → {_fmt_date(r.END_DATE)}"

        days_label = ""

        if r.DAYS and float(r.DAYS) > 0:

            days_label = f" · {r.DAYS} day{'s' if float(r.DAYS) != 1 else ''}"

        lines.append(
            f"  • {span} · **{who}** · {r.LEAVE_TYPE or 'LEAVE'}{days_label}"
        )

        items.append({
            "start":         r.START_DATE.isoformat() if r.START_DATE else None,
            "end":           r.END_DATE.isoformat() if r.END_DATE else None,
            "employee_id":   r.EMPLOYEE_ID,
            "employee_name": who,
            "leave_type":    r.LEAVE_TYPE,
            "days":          float(r.DAYS or 0),
        })

    return {
        "reply": "\n".join(lines),
        "data": {"items": items},
        "suggestions": ["Team on leave today", "Pending approvals"],
    }


# ---------- 17. TEAM_OT_HOURS ----------


def handle_team_ot_hours(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    today = date.today()
    first_of_month = today.replace(day=1)

    visible = _visible_employee_ids(db, employee_id, scope)

    if scope == "MANAGER" and visible == {employee_id}:

        return {
            "reply": "No one reports to you directly yet.",
            "data": None,
            "suggestions": ["Team roster"],
        }

    # Per-employee OT sum via Python roll-up (portable; SQL sum-group is
    # trivial to add later if data volume grows).
    rows = (
        db.query(Attendance)
        .filter(
            Attendance.DATE >= first_of_month,
            Attendance.DATE <= today,
            Attendance.EMPLOYEE_ID.in_(visible),
        )
        .all()
    )

    per_emp: Dict[str, float] = {}

    for a in rows:

        ot = float(getattr(a, "OVERTIME_HOURS", 0) or 0)

        if ot <= 0:

            continue

        per_emp[a.EMPLOYEE_ID] = per_emp.get(a.EMPLOYEE_ID, 0.0) + ot

    total_ot = round(sum(per_emp.values()), 1)

    month_name = today.strftime("%B %Y")

    if not per_emp:

        return {
            "reply": f"No OT logged in {month_name}.",
            "data": {"month": month_name, "total_hours": 0, "items": []},
            "suggestions": ["Team attendance today", "Team roster"],
        }

    names = _fetch_names(db, set(per_emp.keys()))

    ranked = sorted(per_emp.items(), key=lambda kv: -kv[1])

    lines = [
        f"**Team OT hours for {month_name}** — total **{total_ot} h**:",
    ]

    items = []

    for emp_id, hours in ranked[:15]:

        who = names.get(emp_id) or "Unknown"

        lines.append(f"  • **{who}** — {round(hours, 1)} h")

        items.append({
            "employee_id":   emp_id,
            "employee_name": who,
            "ot_hours":      round(hours, 1),
        })

    if len(ranked) > 15:

        lines.append(f"  … and {len(ranked) - 15} more")

    return {
        "reply": "\n".join(lines),
        "data": {
            "month":       month_name,
            "total_hours": total_ot,
            "items":       items,
        },
        "suggestions": ["Team attendance this week", "Team roster"],
    }


# ---------- 18. AT_RISK_ATTENDANCE ----------


def handle_at_risk_attendance(db: Session, employee_id: str, role: str) -> dict:
    """Employees with poor recent attendance. Formula mirrors
    attendance_ai.py's risk score so the two views stay consistent."""

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    today = date.today()

    # 30-day look-back (matches attendance_ai's window)
    start = today - timedelta(days=30)

    visible = _visible_employee_ids(db, employee_id, scope)

    if scope == "MANAGER" and visible == {employee_id}:

        return {
            "reply": "No one reports to you directly yet.",
            "data": None,
            "suggestions": ["Team roster"],
        }

    rows = (
        db.query(Attendance)
        .filter(
            Attendance.DATE >= start,
            Attendance.DATE <= today,
            Attendance.EMPLOYEE_ID.in_(visible),
        )
        .all()
    )

    counters: Dict[str, Dict[str, int]] = {}

    for a in rows:

        stat = (a.STATUS or "").upper()

        c = counters.setdefault(
            a.EMPLOYEE_ID,
            {"late": 0, "absent": 0, "early": 0},
        )

        if stat == "LATE":

            c["late"] += 1

        elif stat in ("ABSENT", "A"):

            c["absent"] += 1

        elif stat == "EARLY_EXIT":

            c["early"] += 1

    # Same weighting as attendance_ai.py risk formula
    ranked: List[Tuple[str, int, Dict[str, int]]] = []

    for emp_id, c in counters.items():

        risk = min(100, c["late"] * 8 + c["absent"] * 15 + c["early"] * 5)

        if risk > 0:

            ranked.append((emp_id, risk, c))

    ranked.sort(key=lambda t: -t[1])

    if not ranked:

        return {
            "reply": (
                "No attendance risk flags in the last 30 days — team is "
                "looking clean."
            ),
            "data": {"items": []},
            "suggestions": ["Team attendance this week", "Team roster"],
        }

    names = _fetch_names(db, {t[0] for t in ranked})

    top = ranked[:8]

    lines = [
        f"**{_pluralize(len(ranked), 'employee', 'employees')} at attendance risk** "
        f"(last 30 days):",
    ]

    items = []

    for emp_id, risk, c in top:

        who = names.get(emp_id) or "Unknown"

        lines.append(
            f"  • **{who}** — risk **{risk}** "
            f"(late {c['late']}, absent {c['absent']}, early {c['early']})"
        )

        items.append({
            "employee_id":   emp_id,
            "employee_name": who,
            "risk_score":    risk,
            "late":          c["late"],
            "absent":        c["absent"],
            "early_exit":    c["early"],
        })

    if len(ranked) > len(top):

        lines.append(f"  … and {len(ranked) - len(top)} more")

    return {
        "reply": "\n".join(lines),
        "data": {"window_days": 30, "items": items},
        "suggestions": ["Team attendance this week", "Pending approvals"],
    }


# ---------- 19. TEAM_OVERDUE_TASKS ----------


def handle_team_overdue_tasks(db: Session, employee_id: str, role: str) -> dict:

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    visible = _visible_employee_ids(db, employee_id, scope)

    if scope == "MANAGER" and visible == {employee_id}:

        return {
            "reply": "No one reports to you directly yet.",
            "data": None,
            "suggestions": ["Team roster"],
        }

    today = date.today()

    DONE_STATES = {"COMPLETED", "DONE", "APPROVED", "CANCELLED"}

    rows = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID.in_(visible),
            TaskAssignment.DUE_DATE.isnot(None),
            TaskAssignment.DUE_DATE < today,
            ~func.upper(TaskAssignment.TASK_STATUS).in_(DONE_STATES),
        )
        .order_by(TaskAssignment.DUE_DATE.asc())
        .limit(15)
        .all()
    )

    if not rows:

        return {
            "reply": "No overdue tasks in the team. Clean slate.",
            "data": {"items": []},
            "suggestions": ["Team attendance this week", "Team roster"],
        }

    names = _fetch_names(db, {r.EMPLOYEE_ID for r in rows})

    project_ids = {r.PROJECT_ID for r in rows if r.PROJECT_ID}

    project_names = {}

    if project_ids:

        for p in db.query(Project).filter(Project.ID.in_(project_ids)).all():

            project_names[p.ID] = p.PROJECT_NAME

    lines = [f"**{_pluralize(len(rows), 'overdue task')}** in your team:"]

    items = []

    for r in rows:

        who = names.get(r.EMPLOYEE_ID) or "Unknown"

        proj = project_names.get(r.PROJECT_ID) if r.PROJECT_ID else None

        days_overdue = (today - r.DUE_DATE).days

        lines.append(
            f"  • **{r.TASK_NAME or 'Untitled'}** — {who}"
            f"{' · ' + proj if proj else ''} · {days_overdue}d overdue"
        )

        items.append({
            "task_id":      r.TASK_ID,
            "task_name":    r.TASK_NAME,
            "employee_id":  r.EMPLOYEE_ID,
            "employee_name": who,
            "project":      proj,
            "due_date":     r.DUE_DATE.isoformat() if r.DUE_DATE else None,
            "days_overdue": days_overdue,
            "status":       r.TASK_STATUS,
        })

    return {
        "reply": "\n".join(lines),
        "data": {"items": items},
        "suggestions": ["Team roster", "Team attendance this week"],
    }


# ---------- 20. EMPLOYEE_LEAVE_LOOKUP ----------


def _extract_name_from_message(message: str) -> Optional[str]:
    """Very light-touch NER: grab the token(s) most likely to be a
    person's name. We look for capitalised words that aren't the
    first word of the sentence and aren't common English stopwords.

    Returns the raw candidate string; the caller matches it against
    visible-employee names using substring/casefold. Deliberately
    conservative — false negatives are fine because the caller
    surfaces "no match found" gracefully."""

    if not message:

        return None

    # Strip common lead-in phrases so the interesting words surface
    stripped = re.sub(
        r"^(how\s+many\s+leaves?\s+(?:has|have|did)\s+|leaves?\s+(?:taken\s+)?by\s+"
        r"|leaves?\s+(?:of|for)\s+|leave\s+(?:history|balance)\s+(?:of|for)\s+)",
        "",
        message,
        flags=re.IGNORECASE,
    ).strip()

    # Match capitalised chunks
    matches = re.findall(r"\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?", stripped)

    stopwords = {
        "How", "Many", "Leaves", "Leave", "Has", "Have", "Did",
        "The", "Of", "For", "By", "Taken", "History", "Balance",
        "This", "Year", "Month",
    }

    for m in matches:

        first = m.split(" ", 1)[0]

        if first in stopwords:

            continue

        return m

    # Fallback — the last non-trivial token
    tokens = re.findall(r"\b[A-Za-z]{3,}\b", stripped)

    for tok in reversed(tokens):

        if tok.capitalize() not in stopwords:

            return tok

    return None


def _find_employee_by_name_hint(
    db: Session,
    hint: str,
    visible_ids: Set[str],
) -> Optional[Employee]:
    """Find an employee whose NAME contains `hint` (case-insensitive)
    AND whose ID is in `visible_ids` — enforces the scope guard."""

    if not hint or not visible_ids:

        return None

    like = f"%{hint.lower()}%"

    rows = (
        db.query(Employee)
        .filter(
            Employee.ID.in_(visible_ids),
            func.lower(Employee.NAME).like(like),
        )
        .all()
    )

    if not rows:

        return None

    # Prefer exact case-insensitive match if we have one
    for r in rows:

        if (r.NAME or "").strip().lower() == hint.strip().lower():

            return r

    # Otherwise return the first match — usually correct because the
    # visible pool is small (team members or org).
    return rows[0]


def handle_employee_leave_lookup(
    db: Session,
    employee_id: str,
    role: str,
    message: str = "",
) -> dict:
    """Answer questions like 'how many leaves has Ramesh taken this
    year?'. Scope-gated: manager sees team; HR sees org. Employee
    can't use this at all — it's a MANAGER-level intent."""

    scope = _scope(role)

    denial = _require_scope(scope, "MANAGER")

    if denial is not None:

        return denial

    hint = _extract_name_from_message(message)

    if not hint:

        return {
            "reply": (
                "I need a name to look up. Try: "
                "\"How many leaves has Ramesh taken this year?\""
            ),
            "data": None,
            "suggestions": ["Team roster", "Pending approvals"],
        }

    visible = _visible_employee_ids(db, employee_id, scope)

    target = _find_employee_by_name_hint(db, hint, visible)

    if target is None:

        return {
            "reply": (
                f"I couldn't find **{hint}** in your visible team. "
                "Try their full name, or check the team roster."
            ),
            "data": {"hint": hint, "found": False},
            "suggestions": ["Team roster"],
        }

    # Look up leave balance + approved leaves this year
    year = date.today().year

    balance = (
        db.query(LeaveBalance)
        .filter(
            LeaveBalance.EMPLOYEE_ID == target.ID,
            LeaveBalance.YEAR == year,
        )
        .first()
    )

    approved_days = 0.0

    if balance is not None:

        approved_days = round(
            float(balance.CASUAL_USED or 0)
            + float(balance.SICK_USED or 0)
            + float(balance.EARNED_USED or 0)
            + float(balance.MATERNITY_USED or 0),
            1,
        )

    recent = (
        db.query(LeaveRequest)
        .filter(LeaveRequest.EMPLOYEE_ID == target.ID)
        .order_by(LeaveRequest.ID.desc())
        .limit(3)
        .all()
    )

    lines = [
        f"**{target.NAME}** — leave summary for {year}:",
        f"  • Total taken: **{approved_days} day{'s' if approved_days != 1 else ''}**",
    ]

    if balance:

        def _rem(t, u, c):

            return round(
                max(0.0, float(t or 0) + float(c or 0) - float(u or 0)),
                1,
            )

        lines.append(
            f"  • Remaining — CL {_rem(balance.CASUAL_TOTAL, balance.CASUAL_USED, balance.CASUAL_CARRYOVER)}, "
            f"SL {_rem(balance.SICK_TOTAL, balance.SICK_USED, balance.SICK_CARRYOVER)}, "
            f"EL {_rem(balance.EARNED_TOTAL, balance.EARNED_USED, balance.EARNED_CARRYOVER)}"
        )

    if recent:

        lines.append("  • Recent requests:")

        for r in recent:

            span = _fmt_date(r.START_DATE)

            if r.END_DATE and r.END_DATE != r.START_DATE:

                span += f" → {_fmt_date(r.END_DATE)}"

            lines.append(f"     - {span} · {r.LEAVE_TYPE or 'LEAVE'} · {r.STATUS or 'PENDING'}")

    return {
        "reply": "\n".join(lines),
        "data": {
            "employee_id":     target.ID,
            "employee_name":   target.NAME,
            "employee_code":   target.EMPLOYEE_CODE,
            "year":            year,
            "total_days_used": approved_days,
        },
        "suggestions": ["Team roster", "Pending approvals"],
    }


# =====================================================================
# Dispatch table
# =====================================================================


HANDLERS: Dict[str, Callable] = {
    # Phase 6 — manager conveniences
    "TEAM_ATTENDANCE_WEEK":  handle_team_attendance_week,
    "TEAM_LEAVE_CALENDAR":   handle_team_leave_calendar,
    "TEAM_OT_HOURS":         handle_team_ot_hours,
    "AT_RISK_ATTENDANCE":    handle_at_risk_attendance,
    "TEAM_OVERDUE_TASKS":    handle_team_overdue_tasks,
    "EMPLOYEE_LEAVE_LOOKUP": handle_employee_leave_lookup,
    # Manager / HR (Phase 3)
    "PENDING_APPROVALS":     handle_pending_approvals,
    "TEAM_ON_LEAVE_TODAY":   handle_team_on_leave_today,
    "TEAM_ATTENDANCE_TODAY": handle_team_attendance_today,
    "TEAM_ROSTER":           handle_team_roster,
    # Self-scoped (Phase 1)
    "LEAVE_BALANCE":         handle_leave_balance,
    "LEAVE_HISTORY":         handle_leave_history,
    "NEXT_SHIFT":            handle_next_shift,
    "PAYSLIP":               handle_payslip,
    "ATTENDANCE_STATS":      handle_attendance_stats,
    "PENDING_TASKS":         handle_pending_tasks,
    "HOLIDAYS":              handle_holidays,
    "MY_MANAGER":            handle_my_manager,
    "MY_PROFILE":            handle_my_profile,
    "MY_DOCUMENTS":          handle_my_documents,
}


# =====================================================================
# Endpoints
# =====================================================================


@router.post("/chat", response_model=ChatOut)
def ai_chat(
    body: ChatIn,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Rule-based intent router. Every response is a SQL lookup — no
    LLM calls, no external API. Returns matched=false when no intent
    fires, so the frontend can fall back to the legacy `/chat/stream`."""

    started = time.perf_counter()

    message = (body.message or "").strip()

    if not message:

        raise HTTPException(status_code=400, detail="message is required.")

    employee_id = payload.get("employee_id")
    role        = (payload.get("role") or "EMPLOYEE").upper()
    caller_scope = _scope(role)

    if not employee_id:

        raise HTTPException(
            status_code=401,
            detail="Session missing employee_id — please log in again.",
        )

    intent = classify(message)

    if intent is None or intent not in HANDLERS:

        # -----------------------------------------------------------
        # PHASE 2 — RAG fallback for open-ended questions.
        # If Ollama is reachable and we have relevant indexed content,
        # generate a grounded answer with source citations. Any failure
        # (Ollama down, empty index, no relevant chunks) drops through
        # to the "not understood" response below — which the frontend
        # then hands to /chat/stream.
        # -----------------------------------------------------------
        try:

            rag_out = rag_service.answer(message, db)

        except Exception as rag_exc:

            import logging

            logging.getLogger("uvicorn").warning(
                "ai_chat RAG fallback failed: %s", rag_exc
            )
            rag_out = None

        if rag_out and rag_out.get("reply"):

            return ChatOut(
                matched=True,
                intent="RAG",
                reply=rag_out["reply"],
                sources=rag_out.get("sources", []),
                suggestions=[
                    "Leave balance", "Attendance policy",
                    "Upcoming holidays", "My profile",
                ],
                source="rag",
                scope=caller_scope,
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )

        return ChatOut(
            matched=False,
            reply=(
                "I can help with leave balance, shift, payslip, "
                "attendance, tasks, holidays, manager, profile, or "
                "documents. Try one of those, or ask more specifically."
            ),
            suggestions=[
                "Leave balance", "Next shift", "My attendance",
                "Pending tasks", "Holidays", "My profile",
            ],
            source="unmatched",
            scope=caller_scope,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
        )

    try:

        # EMPLOYEE_LEAVE_LOOKUP needs the raw message so it can extract
        # the person's name — every other handler is content-free.
        if intent == "EMPLOYEE_LEAVE_LOOKUP":

            result = HANDLERS[intent](db, employee_id, role, message=message)

        else:

            result = HANDLERS[intent](db, employee_id, role)

    except HTTPException:

        raise

    except Exception as exc:

        import logging

        logging.getLogger("uvicorn").exception(
            "ai_chat handler %s failed: %s", intent, exc
        )

        return ChatOut(
            matched=False,
            intent=intent,
            reply=(
                "I recognised your question but ran into an internal "
                "error looking up the data. Please try again in a "
                "moment, or use the sidebar menu directly."
            ),
            source="handler_error",
            scope=caller_scope,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
        )

    # If the handler produced a "denied" data payload, the denial
    # message IS the answer — return matched=True so the frontend
    # shows it instead of falling through to /chat/stream. Distinguish
    # the source for observability + so the UI can style it differently.
    was_denied = bool((result.get("data") or {}).get("denied"))

    return ChatOut(
        matched=True,
        intent=intent,
        reply=result["reply"],
        data=result.get("data"),
        suggestions=result.get("suggestions", []),
        source="scope_denied" if was_denied else "intent_router",
        scope=caller_scope,
        elapsed_ms=int((time.perf_counter() - started) * 1000),
    )


@router.get("/chat/suggestions")
def ai_chat_suggestions(payload: dict = Depends(get_current_user)):
    """Chip suggestions shown when the user opens the chatbot. Curated
    per role scope so managers/HR see team-oriented prompts alongside
    the self-scoped ones."""

    scope = _scope(payload.get("role") or "")

    self_scope = [
        "How many leaves do I have?",
        "What's my next shift?",
        "Show my last payslip",
        "My attendance this month",
        "My pending tasks",
        "Next holidays",
        "Who is my manager?",
        "My profile details",
        "My uploaded documents",
    ]

    if scope == "EMPLOYEE":

        return {"scope": scope, "suggestions": self_scope}

    manager_scope = [
        "Pending approvals",
        "Who is on leave today?",
        "Team attendance today",
        "Team attendance this week",
        "Team overdue tasks",
        "Team OT hours",
        "At-risk employees",
        "Upcoming team leaves",
        "My team",
    ]

    if scope == "MANAGER":

        # Interleave: manager prompts first so the most-useful action
        # sits at the top of the chip strip.
        return {"scope": scope, "suggestions": manager_scope + self_scope}

    # HR_ADMIN — same manager prompts but ordered to feel org-wide.
    return {
        "scope": scope,
        "suggestions": manager_scope + self_scope,
    }


@router.get("/chat/health")
def ai_chat_health(payload: Optional[dict] = Depends(get_current_user)):
    """Inspect the whole AI stack (intent router + role scope + Ollama
    + RAG index) in one call. Auth is required so we can also report
    the caller's resolved scope — helpful when debugging why a manager
    can't see team data (usually because their role in the JWT is
    plain 'EMPLOYEE')."""

    llm = ollama_client.health()

    idx = rag_index.info()

    role = (payload.get("role") or "") if payload else ""

    caller_scope = _scope(role) if payload else None

    return {
        "status": "ok",
        "phase": 3,
        "intent_count": len(INTENT_PATTERNS),
        "intents": [k for k, _ in INTENT_PATTERNS],
        "caller": {
            "employee_id": payload.get("employee_id") if payload else None,
            "role":        role,
            "scope":       caller_scope,
        },
        "ollama": llm,
        "rag": {
            "indexed_chunks":  idx["chunks"],
            "embedding_model": idx["model"],
            "built_at":        idx["built_at"],
            "backend":         idx["backend"],
        },
    }


@router.get("/rag/info")
def ai_rag_info(_admin: dict = Depends(get_current_admin)):
    """Admin-only — inspect the index in more detail (path, dimension,
    build backend)."""

    return {
        "index":  rag_index.info(),
        "ollama": ollama_client.health(),
    }


@router.post("/rag/reindex")
def ai_rag_reindex(
    db: Session = Depends(get_db),
    _admin: dict = Depends(get_current_admin),
):
    """Admin-only — rebuild the whole RAG knowledge base from:
      • DB (departments, designations, shifts, holidays)
      • docs/policies/*.md

    Idempotent. Returns a report of what was seen / embedded / failed."""

    result = rag_service.reindex(db)

    return result
