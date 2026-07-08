"""
Unified HR Assistant orchestrator.

Handles every Phase-1 HR intent through a single chat endpoint:

  Leave (delegates to LeaveAgent):
    LEAVE_REQUEST / LEAVE_CONFIRM / LEAVE_DENY / LEAVE_CANCEL
    LEAVE_BALANCE / LEAVE_STATUS

  Direct handlers in this file:
    ATTENDANCE      -> attendance summary + recent records
    SALARY_SLIP     -> latest payslip (or month-specific)
    EMPLOYEE_INFO   -> profile lookup (manager / department / joining etc.)
    HR_POLICY       -> Q&A from a curated policy snippet table
    HOLIDAY         -> upcoming holidays from holiday_calendar
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
import json

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    Attendance,
    LeaveBalance,
    LeaveRequest,
    PayrollSlip,
    HolidayCalendar,
    Department,
    Designation,
    AILeaveConversation,
)
from app.services.hr_assistant_brain import think as hr_think, HRBrainResult
from app.services.leave_agent_service import LeaveAgent


# ============================================================
# Public reply shape
# ============================================================

@dataclass
class HRReply:
    message: str
    intent:  str
    data:    Optional[Dict[str, Any]] = None     # structured payload (payslip ID, etc.)
    suggestions: Optional[List[str]] = None
    source:  str = "llm"
    session_id: Optional[int] = None
    state: Optional[str] = None                  # carried for leave flows

    def to_dict(self) -> dict:
        return {
            "message":     self.message,
            "intent":      self.intent,
            "data":        self.data or {},
            "suggestions": self.suggestions or [],
            "source":      self.source,
            "session_id":  self.session_id,
            "state":       self.state,
        }


# ============================================================
# HR_POLICY KNOWLEDGE BASE
# ============================================================
# Curated, hand-written answers for common policy questions. Keeping
# this small + explicit (vs RAG over docs) gives reliable answers in
# Phase 1; we can swap to RAG over policy PDFs later.

_POLICY_BOOK: Dict[str, str] = {
    "leave": (
        "BVC24 leave policy (annual):\n"
        "  • Casual Leave : 12 days/year\n"
        "  • Sick Leave   : 12 days/year\n"
        "  • Earned Leave : 15 days/year\n"
        "  • Maternity    : 26 weeks (female employees, after 80 days of service)\n"
        "  • Paternity    : 5 days\n"
        "  • Comp-Off     : 1 day per approved compensatory request\n"
        "  • Unpaid (LOP) : unlimited but unpaid; deducted from salary\n"
        "Leave applications need to be submitted at least 1 day in advance "
        "except sick leave (which can be applied same-day with a doctor's note)."
    ),
    "attendance": (
        "Attendance policy:\n"
        "  • Office hours: 09:15 AM to 06:00 PM (Monday to Saturday)\n"
        "  • Grace period: 10 minutes\n"
        "  • Late after 09:25 AM counts as a LATE mark\n"
        "  • Three LATE marks in a month = half-day deduction\n"
        "  • Check-in/out is geofenced (50m radius around office)"
    ),
    "notice_period": (
        "Notice period:\n"
        "  • Probation employees: 7 days\n"
        "  • Confirmed employees: 30 days\n"
        "  • Senior roles (Manager and above): 60 days\n"
        "Notice can be served or bought out at the company's discretion."
    ),
    "working_hours": (
        "Working hours:\n"
        "  • Monday to Saturday: 09:15 AM to 06:00 PM\n"
        "  • Lunch break: 01:00 PM to 02:00 PM\n"
        "  • Sundays: weekly off\n"
        "  • Second Saturday of each month: optional working day"
    ),
    "dress_code": (
        "Dress code:\n"
        "  • Weekdays (Mon-Fri): formal business attire\n"
        "  • Saturday: smart casual\n"
        "  • Customer-facing roles: business formals at all times\n"
        "  • Safety footwear required on production floor"
    ),
    "travel": (
        "Travel policy:\n"
        "  • Travel above 50 km from office requires prior manager approval\n"
        "  • Reimbursable: train fare (sleeper/3AC), bus tickets, "
        "auto/taxi fare with receipts\n"
        "  • Per-diem (food + incidentals): ₹500/day\n"
        "  • Submit claims via the Allowance section within 7 days of return"
    ),
    "reimbursement": (
        "Expense reimbursement:\n"
        "  • All office-related expenses can be claimed via Allowance section\n"
        "  • Categories: Travel, Food, Office Supplies, Fuel, Communication\n"
        "  • Original receipts required for amounts above ₹500\n"
        "  • MD/HR approval required; processed in the next payroll cycle"
    ),
    "holidays": (
        "Holiday policy:\n"
        "  • 12 paid national / regional holidays per year (see Holiday Calendar)\n"
        "  • Optional holidays (e.g. Sankranti, Easter): pick 2 per year\n"
        "  • Holidays that fall on a Sunday are not carried forward\n"
        "  • Working on a declared holiday earns a Comp-Off day"
    ),
}


def _policy_snippets_for_prompt() -> str:
    """Return the policy book as a single string for the Gemini prompt."""
    lines = []
    for topic, body in _POLICY_BOOK.items():
        lines.append(f"### {topic.upper()}\n{body}\n")
    return "\n".join(lines)


# ============================================================
# HRAssistant orchestrator
# ============================================================

class HRAssistant:

    def __init__(self, db: Session, employee: Employee):
        self.db = db
        self.employee = employee
        # We reuse the existing LeaveAgent for leave-flow turns so the
        # state machine, validation and submission logic stay in one
        # place. Only the lighter Q&A intents are handled here.
        self.leave_agent = LeaveAgent(db=db, employee=employee)

    # --------------------------------------------------------
    # Entry point
    # --------------------------------------------------------

    def handle_message(
        self, text: str, session_id: Optional[int] = None
    ) -> HRReply:

        text = (text or "").strip()
        first_name = (self.employee.NAME or "there").split(" ")[0]

        # If an active leave conversation is mid-collection / mid-
        # confirmation, route the message there first so we don't break
        # the state machine. The leave agent decides what to do.
        open_leave = (
            self.db.query(AILeaveConversation)
            .filter(AILeaveConversation.EMPLOYEE_ID == self.employee.ID)
            .filter(AILeaveConversation.STATE.in_(["COLLECTING", "CONFIRMING"]))
            .order_by(AILeaveConversation.ID.desc())
            .first()
        )
        if open_leave is not None:
            reply, conv = self.leave_agent.handle_message(text, session_id=open_leave.ID)
            return HRReply(
                message=reply.message,
                intent="LEAVE_REQUEST",
                suggestions=reply.suggestions,
                source=reply.source,
                session_id=conv.ID,
                state=conv.STATE,
                data={"leave_request_id": reply.leave_request_id} if reply.leave_request_id else None,
            )

        # Ask Gemini to classify intent + extract entities.
        history = self._history(open_leave)
        brain = hr_think(
            employee_name=self.employee.NAME or "",
            employee_first_name=first_name,
            today=date.today(),
            history=history,
            user_message=text,
            policy_snippets=_policy_snippets_for_prompt(),
        )

        # Gemini unavailable -> ultra-simple keyword fallback so the
        # assistant still works without an LLM key.
        if brain is None:
            return self._rule_fallback(text, first_name)

        return self._dispatch(brain, text)

    # --------------------------------------------------------
    # Dispatch by intent
    # --------------------------------------------------------

    def _dispatch(self, brain: HRBrainResult, original_text: str) -> HRReply:

        intent = brain.intent

        # ---- LEAVE flow ----
        if intent in {"LEAVE_REQUEST", "LEAVE_CONFIRM",
                     "LEAVE_DENY",    "LEAVE_CANCEL"}:
            reply, conv = self.leave_agent.handle_message(original_text)
            return HRReply(
                message=reply.message,
                intent=intent,
                suggestions=reply.suggestions,
                source="llm",
                session_id=conv.ID,
                state=conv.STATE,
                data={"leave_request_id": reply.leave_request_id} if reply.leave_request_id else None,
            )

        # ---- LEAVE Q&A ----
        if intent == "LEAVE_BALANCE":
            msg = self._handle_leave_balance() or brain.agent_reply
            return HRReply(message=msg, intent=intent,
                          suggestions=brain.suggestions or ["Apply for leave", "My leave history"])

        if intent == "LEAVE_STATUS":
            msg = self._handle_leave_status() or brain.agent_reply
            return HRReply(message=msg, intent=intent,
                          suggestions=brain.suggestions or ["Apply for leave", "Leave balance"])

        # ---- ATTENDANCE ----
        if intent == "ATTENDANCE":
            msg, data = self._handle_attendance(brain.entities)
            return HRReply(message=msg, intent=intent, data=data,
                          suggestions=brain.suggestions or ["Late marks", "Hours this month"])

        # ---- SALARY SLIP ----
        if intent == "SALARY_SLIP":
            msg, data = self._handle_salary_slip(brain.entities)
            return HRReply(message=msg, intent=intent, data=data,
                          suggestions=brain.suggestions or ["Salary history", "Reimbursements"])

        # ---- EMPLOYEE INFO ----
        if intent == "EMPLOYEE_INFO":
            msg = self._handle_employee_info(original_text)
            return HRReply(message=msg, intent=intent,
                          suggestions=brain.suggestions or ["My manager", "Joining date", "Department"])

        # ---- HR POLICY ----
        if intent == "HR_POLICY":
            msg = self._handle_hr_policy(brain.entities, original_text)
            return HRReply(message=msg, intent=intent,
                          suggestions=brain.suggestions or ["Leave policy", "Working hours", "Notice period"])

        # ---- HOLIDAY ----
        if intent == "HOLIDAY":
            msg = self._handle_holiday(brain.entities)
            return HRReply(message=msg, intent=intent,
                          suggestions=brain.suggestions or ["Holidays this month", "Next holiday"])

        # ---- GREETING / SMALLTALK / UNKNOWN ----
        if intent == "GREETING":
            first = (self.employee.NAME or "there").split(" ")[0]
            return HRReply(
                message=f"Hi {first}! I'm your HR assistant. Ask me about leave, attendance, payslips, holidays, or company policies.",
                intent=intent,
                suggestions=["I need leave tomorrow", "How many leaves do I have?",
                            "Send my latest payslip", "Next holiday"],
            )

        # SMALLTALK / UNKNOWN — pass Gemini's reply through.
        return HRReply(
            message=brain.agent_reply,
            intent=intent,
            suggestions=brain.suggestions,
        )

    # --------------------------------------------------------
    # Handler — LEAVE BALANCE
    # --------------------------------------------------------

    def _handle_leave_balance(self) -> Optional[str]:
        year = date.today().year
        row = (
            self.db.query(LeaveBalance)
            .filter(LeaveBalance.EMPLOYEE_ID == self.employee.ID)
            .filter(LeaveBalance.YEAR == year)
            .first()
        )
        if not row:
            return f"No leave quota on file for {year}. Please ask HR to seed your balance."
        cl = float(row.CASUAL_TOTAL or 0) - float(row.CASUAL_USED or 0)
        sl = float(row.SICK_TOTAL or 0)   - float(row.SICK_USED or 0)
        el = float(row.EARNED_TOTAL or 0) - float(row.EARNED_USED or 0)
        return (
            f"Your {year} leave balance:\n"
            f"  • Casual:  {cl} day(s) remaining (of {row.CASUAL_TOTAL})\n"
            f"  • Sick:    {sl} day(s) remaining (of {row.SICK_TOTAL})\n"
            f"  • Earned:  {el} day(s) remaining (of {row.EARNED_TOTAL})"
        )

    # --------------------------------------------------------
    # Handler — LEAVE STATUS
    # --------------------------------------------------------

    def _handle_leave_status(self) -> Optional[str]:
        recent = (
            self.db.query(LeaveRequest)
            .filter(LeaveRequest.EMPLOYEE_ID == self.employee.ID)
            .order_by(LeaveRequest.ID.desc())
            .limit(5)
            .all()
        )
        if not recent:
            return "You haven't submitted any leave requests yet."
        lines = ["Your recent leave requests:"]
        for lr in recent:
            lines.append(
                f"  • #{lr.ID} {lr.LEAVE_TYPE}  {lr.START_DATE} → {lr.END_DATE}  "
                f"({lr.DAYS} day) — {lr.STATUS}"
            )
        return "\n".join(lines)

    # --------------------------------------------------------
    # Handler — ATTENDANCE
    # --------------------------------------------------------

    def _handle_attendance(self, ent: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        today = date.today()
        year  = ent.get("year")  or today.year
        month = ent.get("month") or today.month

        from sqlalchemy import extract
        rows = (
            self.db.query(Attendance)
            .filter(Attendance.EMPLOYEE_ID == self.employee.ID)
            .filter(extract("year",  Attendance.DATE) == year)
            .filter(extract("month", Attendance.DATE) == month)
            .order_by(Attendance.DATE.desc())
            .all()
        )

        if not rows:
            return (
                f"No attendance records found for {_month_name(month)} {year}.",
                {"year": year, "month": month, "records": 0},
            )

        present = sum(1 for r in rows if r.STATUS == "PRESENT")
        late    = sum(1 for r in rows if r.STATUS == "LATE")
        absent  = sum(1 for r in rows if r.STATUS == "ABSENT")
        hours   = sum(float(r.WORKED_HOURS or 0) for r in rows)

        lines = [
            f"Attendance for {_month_name(month)} {year}:",
            f"  • Days present:  {present}",
            f"  • Days late:     {late}",
            f"  • Days absent:   {absent}",
            f"  • Hours worked:  {hours:.1f}",
        ]

        last3 = rows[:3]
        if last3:
            lines.append("\nLast 3 records:")
            for r in last3:
                lines.append(
                    f"  • {r.DATE}  "
                    f"in={_time(r.CHECK_IN)}  "
                    f"out={_time(r.CHECK_OUT)}  "
                    f"{r.STATUS}"
                )

        data = {
            "year": year, "month": month,
            "present": present, "late": late,
            "absent": absent, "hours": round(hours, 2),
            "records": len(rows),
        }
        return "\n".join(lines), data

    # --------------------------------------------------------
    # Handler — SALARY SLIP
    # --------------------------------------------------------

    def _handle_salary_slip(self, ent: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        target_month = ent.get("month")
        target_year  = ent.get("year")

        q = (
            self.db.query(PayrollSlip)
            .filter(PayrollSlip.EMPLOYEE_ID == self.employee.ID)
            .order_by(PayrollSlip.ID.desc())
        )

        slip = None
        if target_month or target_year:
            # PayrollSlip itself doesn't have year/month — they live on
            # PayrollRun. Try a join; fall back to the latest slip if
            # the join is not available on this schema.
            try:
                from app.models.models import PayrollRun
                q2 = (
                    self.db.query(PayrollSlip)
                    .join(PayrollRun, PayrollSlip.PAYROLL_RUN_ID == PayrollRun.ID)
                    .filter(PayrollSlip.EMPLOYEE_ID == self.employee.ID)
                )
                if target_year:
                    q2 = q2.filter(getattr(PayrollRun, "PAY_YEAR", PayrollRun.ID) == target_year)
                if target_month:
                    q2 = q2.filter(getattr(PayrollRun, "PAY_MONTH", PayrollRun.ID) == target_month)
                slip = q2.order_by(PayrollSlip.ID.desc()).first()
            except Exception:
                slip = None

        if slip is None:
            slip = q.first()

        if slip is None:
            return (
                "I couldn't find any payslip on file yet. "
                "Once HR finalizes the first payroll run for you, "
                "your payslips will appear here.",
                {},
            )

        net = getattr(slip, "NET_PAY", None) or getattr(slip, "NET_AMOUNT", None) or getattr(slip, "GROSS_PAY", None)
        gross = getattr(slip, "GROSS_PAY", None) or getattr(slip, "BASE_SALARY", None)
        deductions = getattr(slip, "TOTAL_DEDUCTIONS", None)

        lines = [
            f"Latest payslip on file (#{slip.ID}):",
        ]
        if gross is not None:
            lines.append(f"  • Gross:       ₹{_money(gross)}")
        if deductions is not None:
            lines.append(f"  • Deductions:  ₹{_money(deductions)}")
        if net is not None:
            lines.append(f"  • Net pay:     ₹{_money(net)}")
        if getattr(slip, "DAYS_PRESENT", None) is not None:
            lines.append(f"  • Days present: {slip.DAYS_PRESENT}")
        if getattr(slip, "DAYS_LATE", None):
            lines.append(f"  • Days late:    {slip.DAYS_LATE}")

        lines.append("\nGo to Payroll → My Payslips to download the PDF.")

        return "\n".join(lines), {
            "slip_id": slip.ID,
            "gross": gross, "net": net,
            "deductions": deductions,
        }

    # --------------------------------------------------------
    # Handler — EMPLOYEE INFO
    # --------------------------------------------------------

    def _handle_employee_info(self, original_text: str) -> str:
        emp = self.employee
        t = (original_text or "").lower()

        # Try to detect a specific question first, then fall back to a full profile dump.
        manager_name = None
        if getattr(emp, "REPORTING_MANAGER_ID", None):
            mgr = self.db.query(Employee).filter(Employee.ID == emp.REPORTING_MANAGER_ID).first()
            if mgr:
                manager_name = f"{mgr.NAME} ({mgr.EMPLOYEE_CODE})"

        dept_name = None
        if getattr(emp, "DEPARTMENT_ID", None):
            d = self.db.query(Department).filter(Department.ID == emp.DEPARTMENT_ID).first()
            if d:
                dept_name = getattr(d, "DEPARTMENT_NAME", None) or getattr(d, "NAME", None)

        desig_name = None
        if getattr(emp, "DESIGNATION_ID", None):
            de = self.db.query(Designation).filter(Designation.ID == emp.DESIGNATION_ID).first()
            if de:
                desig_name = getattr(de, "DESIGNATION_NAME", None) or getattr(de, "NAME", None)

        if "manager" in t and manager_name:
            return f"Your reporting manager is {manager_name}."
        if "department" in t and dept_name:
            return f"You're in the {dept_name} department."
        if "designation" in t or "role" in t or "position" in t:
            if desig_name:
                return f"Your designation is {desig_name}."
        if "join" in t and emp.JOINING_DATE:
            return f"You joined BVC24 on {emp.JOINING_DATE}."
        if "email" in t and emp.EMAIL:
            return f"Your registered email is {emp.EMAIL}."
        if "phone" in t and emp.PHONE:
            return f"Your registered phone is {emp.PHONE}."
        if "salary" in t and emp.SALARY:
            return f"Your monthly base salary is ₹{_money(emp.SALARY)}."

        # Full profile fallback
        lines = [f"Here's what I have on file for you, {emp.NAME}:"]
        lines.append(f"  • Employee code: {emp.EMPLOYEE_CODE}")
        if desig_name:    lines.append(f"  • Designation:   {desig_name}")
        if dept_name:     lines.append(f"  • Department:    {dept_name}")
        if manager_name:  lines.append(f"  • Manager:       {manager_name}")
        if emp.JOINING_DATE: lines.append(f"  • Joined:        {emp.JOINING_DATE}")
        if emp.EMAIL:     lines.append(f"  • Email:         {emp.EMAIL}")
        if emp.PHONE:     lines.append(f"  • Phone:         {emp.PHONE}")
        return "\n".join(lines)

    # --------------------------------------------------------
    # Handler — HR POLICY
    # --------------------------------------------------------

    def _handle_hr_policy(self, ent: Dict[str, Any], original_text: str) -> str:
        topic = (ent.get("policy_topic") or "").strip().lower()

        # If Gemini didn't tag a topic, do a keyword sweep on the text.
        if not topic:
            t = (original_text or "").lower()
            if "notice" in t:                      topic = "notice_period"
            elif "dress" in t or "clothes" in t:   topic = "dress_code"
            elif "travel" in t or "trip" in t:     topic = "travel"
            elif "reimburs" in t or "claim" in t:  topic = "reimbursement"
            elif "holiday" in t:                   topic = "holidays"
            elif "hours" in t or "timing" in t:    topic = "working_hours"
            elif "attendance" in t or "late" in t: topic = "attendance"
            elif "leave" in t:                     topic = "leave"

        if not topic or topic not in _POLICY_BOOK:
            return (
                "I don't have a specific answer for that policy. "
                "Available topics: leave · attendance · notice period · "
                "working hours · dress code · travel · reimbursement · holidays. "
                "Ask about any of those, or check the HR handbook for the rest."
            )

        return _POLICY_BOOK[topic]

    # --------------------------------------------------------
    # Handler — HOLIDAY CALENDAR
    # --------------------------------------------------------

    def _handle_holiday(self, ent: Dict[str, Any]) -> str:
        today = date.today()
        vendor_id = getattr(self.employee, "VENDOR_ID", None)

        target_month = ent.get("month")
        target_year  = ent.get("year")

        q = self.db.query(HolidayCalendar)
        if vendor_id:
            q = q.filter(HolidayCalendar.VENDOR_ID == vendor_id)

        if target_month and target_year:
            from sqlalchemy import extract
            q = (
                q.filter(extract("year",  HolidayCalendar.HOLIDAY_DATE) == target_year)
                 .filter(extract("month", HolidayCalendar.HOLIDAY_DATE) == target_month)
                 .order_by(HolidayCalendar.HOLIDAY_DATE)
            )
            rows = q.all()
            if not rows:
                return f"No holidays in {_month_name(target_month)} {target_year}."
            lines = [f"Holidays in {_month_name(target_month)} {target_year}:"]
            for h in rows:
                lines.append(f"  • {h.HOLIDAY_DATE}  —  {h.NAME}  ({h.TYPE})")
            return "\n".join(lines)

        # Default: next 5 upcoming holidays
        rows = (
            q.filter(HolidayCalendar.HOLIDAY_DATE >= today)
             .order_by(HolidayCalendar.HOLIDAY_DATE)
             .limit(5)
             .all()
        )
        if not rows:
            return "No upcoming holidays on file. Ask HR to seed the holiday calendar."

        next_h = rows[0]
        days_to = (next_h.HOLIDAY_DATE - today).days
        when = (
            "today"      if days_to == 0 else
            "tomorrow"   if days_to == 1 else
            f"in {days_to} days"
        )
        lines = [f"Next holiday: **{next_h.NAME}** on {next_h.HOLIDAY_DATE} ({when})."]
        if len(rows) > 1:
            lines.append("\nAfter that:")
            for h in rows[1:]:
                lines.append(f"  • {h.HOLIDAY_DATE}  —  {h.NAME}")
        return "\n".join(lines)

    # --------------------------------------------------------
    # Rule-based fallback for when Gemini is offline
    # --------------------------------------------------------

    def _rule_fallback(self, text: str, first_name: str) -> HRReply:
        t = (text or "").lower()

        # Simple keyword routing — coarse but works without the LLM.
        if any(k in t for k in ["leave balance", "how many leaves", "leaves left", "remaining leaves"]):
            return HRReply(
                message=self._handle_leave_balance() or "Sorry, can't fetch balance right now.",
                intent="LEAVE_BALANCE", source="rule",
            )
        if any(k in t for k in ["leave status", "my leave status", "leave history"]):
            return HRReply(
                message=self._handle_leave_status() or "No leave records.",
                intent="LEAVE_STATUS", source="rule",
            )
        if any(k in t for k in ["attendance", "late mark", "hours worked"]):
            msg, data = self._handle_attendance({})
            return HRReply(message=msg, intent="ATTENDANCE", data=data, source="rule")
        if any(k in t for k in ["payslip", "salary slip", "net pay", "salary"]):
            msg, data = self._handle_salary_slip({})
            return HRReply(message=msg, intent="SALARY_SLIP", data=data, source="rule")
        if any(k in t for k in ["holiday", "next off", "off day"]):
            return HRReply(message=self._handle_holiday({}),
                          intent="HOLIDAY", source="rule")
        if any(k in t for k in ["manager", "department", "joining", "designation", "my email", "my phone", "my role"]):
            return HRReply(message=self._handle_employee_info(t),
                          intent="EMPLOYEE_INFO", source="rule")
        if any(k in t for k in ["notice period", "policy", "dress code", "working hours"]):
            return HRReply(message=self._handle_hr_policy({}, text),
                          intent="HR_POLICY", source="rule")
        if any(k in t for k in ["leave", "off", "off day"]):
            # Delegate to the leave agent
            reply, conv = self.leave_agent.handle_message(text)
            return HRReply(
                message=reply.message, intent="LEAVE_REQUEST",
                suggestions=reply.suggestions, source="rule",
                session_id=conv.ID, state=conv.STATE,
                data={"leave_request_id": reply.leave_request_id} if reply.leave_request_id else None,
            )

        return HRReply(
            message=(f"Hi {first_name}! I can help with leave, attendance, payslips, "
                    f"holidays, your profile, or company policies. What would you like to know?"),
            intent="GREETING",
            suggestions=["My leave balance", "Attendance this month",
                        "Latest payslip", "Next holiday", "Notice period"],
            source="rule",
        )

    # --------------------------------------------------------
    # Helpers
    # --------------------------------------------------------

    def _history(self, conv: Optional[AILeaveConversation]) -> List[Dict[str, str]]:
        if not conv:
            return []
        try:
            msgs = json.loads(conv.MESSAGES_JSON or "[]")
        except Exception:
            msgs = []
        return [{"role": m.get("role", "?"), "text": m.get("text", "")} for m in msgs[-10:]]


# ============================================================
# Small format helpers
# ============================================================

def _money(n) -> str:
    try:
        return f"{float(n):,.2f}"
    except Exception:
        return str(n)


def _time(dt) -> str:
    if not dt:
        return "—"
    try:
        return dt.strftime("%I:%M %p")
    except Exception:
        try:
            return str(dt)[11:16]
        except Exception:
            return "—"


_MONTHS = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _month_name(m: int) -> str:
    if not isinstance(m, int) or m < 1 or m > 12:
        return "?"
    return _MONTHS[m]
