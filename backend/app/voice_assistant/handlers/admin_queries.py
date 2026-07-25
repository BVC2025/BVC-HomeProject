"""
Admin-only voice handlers.

Read-only, single-turn queries that HR / managers need at a glance:

  pending_approvals   — "how many pending leaves / approvals"
  attendance_summary  — "who's absent today", "attendance summary"
  employee_lookup     — "show me employee BVC008", "where is Puviyarasi"

Every handler enforces admin role before touching org-level data —
regular employees calling these routes are told to check their own page.
"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy.orm import Session

from app.auth.auth_bearer import ADMIN_ROLES
from app.models.models import Attendance, Employee, LeaveRequest, Department, Designation, Role
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


def _is_admin(employee: Employee, db) -> bool:
    """Best-effort role check via Role table (Employee.role relationship
    isn't defined on the model). This is a UX gate, not a security
    boundary — the /voice/query route enforces auth."""
    if not employee or not employee.ROLE_ID:
        return False
    role = db.query(Role).filter(Role.ID == employee.ROLE_ID).first()
    if not role:
        return False
    role_name = (getattr(role, "NAME", None) or "").upper()
    return role_name in ADMIN_ROLES


class PendingApprovalsHandler(BaseHandler):

    intent = "pending_approvals"

    async def handle(self, db, session, entities, employee) -> HandlerReply:
        session.active_intent = None; session.slots = {}
        if not _is_admin(employee, db):
            return HandlerReply(
                reply="That's an admin view. Ask your manager or open the Approvals page.",
                conversation_complete=True, action_taken="denied_not_admin",
            )
        pending = (
            db.query(LeaveRequest)
            .filter(LeaveRequest.STATUS == "PENDING")
            .count()
        )
        by_type = (
            db.query(LeaveRequest.LEAVE_TYPE)
            .filter(LeaveRequest.STATUS == "PENDING")
            .all()
        )
        buckets: dict[str, int] = {}
        for (lt,) in by_type:
            buckets[lt] = buckets.get(lt, 0) + 1
        if pending == 0:
            reply = "You're all caught up — no pending leave approvals."
        else:
            top = sorted(buckets.items(), key=lambda kv: -kv[1])[:3]
            top_text = ", ".join(f"{n} {lt.lower()}" for lt, n in top)
            reply = (
                f"{pending} pending approval{'s' if pending != 1 else ''} — {top_text}. "
                f"Open the Approval Center to act on them."
            )
        return HandlerReply(reply=reply, conversation_complete=True,
                            action_taken="pending_approvals_read")


class AttendanceSummaryHandler(BaseHandler):

    intent = "attendance_summary"

    async def handle(self, db, session, entities, employee) -> HandlerReply:
        session.active_intent = None; session.slots = {}
        if not _is_admin(employee, db):
            return HandlerReply(
                reply="That's an admin view. Check the Attendance page for your own record.",
                conversation_complete=True, action_taken="denied_not_admin",
            )
        today = date.today()
        rows = (
            db.query(Attendance)
            .filter(Attendance.DATE == today)
            .all()
        )
        present = sum(1 for r in rows if (r.STATUS or "").upper() == "PRESENT")
        late    = sum(1 for r in rows if (r.STATUS or "").upper() == "LATE")
        absent  = sum(1 for r in rows if (r.STATUS or "").upper() == "ABSENT")
        halfday = sum(1 for r in rows if (r.STATUS or "").upper() == "HALF_DAY")
        # Count active employees who have no row today at all
        total_emps = (
            db.query(Employee)
            .filter(Employee.STATUS == "ACTIVE")
            .count()
        )
        no_record = max(0, total_emps - len(rows))
        reply = (
            f"Today — {present} present, {late} late, {absent} absent, "
            f"{halfday} half-day. {no_record} employees have not marked yet."
        )
        return HandlerReply(reply=reply, conversation_complete=True,
                            action_taken="attendance_summary_read")


class EmployeeLookupHandler(BaseHandler):

    intent = "employee_lookup"

    async def handle(self, db, session, entities, employee) -> HandlerReply:
        session.active_intent = None; session.slots = {}
        if not _is_admin(employee, db):
            return HandlerReply(
                reply="Employee lookup is admin-only.",
                conversation_complete=True, action_taken="denied_not_admin",
            )
        target = str(
            entities.get("employee_query")
            or entities.get("name")
            or entities.get("code")
            or session.slots.get("_last_user_message")
            or ""
        ).strip()
        # Try code first (BVC008 style), then LIKE-match on NAME
        m = re.search(r"\b([A-Z]{2,4}\d{2,6})\b", target.upper())
        emp = None
        if m:
            emp = db.query(Employee).filter(Employee.EMPLOYEE_CODE == m.group(1)).first()
        if emp is None and target:
            # Strip the intent phrasing to get the name
            name_needle = re.sub(
                r"(show|find|lookup|about|employee|details|of|for|me)", " ", target, flags=re.I
            ).strip()
            if name_needle:
                emp = (
                    db.query(Employee)
                    .filter(Employee.NAME.ilike(f"%{name_needle}%"))
                    .first()
                )
        if not emp:
            return HandlerReply(
                reply="I couldn't find that employee. Try their employee code, like BVC008.",
                conversation_complete=True, action_taken="lookup_miss",
            )
        # Assemble a summary
        dept = None
        if emp.DEPARTMENT_ID:
            d = db.query(Department).filter(Department.ID == emp.DEPARTMENT_ID).first()
            if d:
                dept = getattr(d, "NAME", None) or getattr(d, "DEPARTMENT_NAME", None)
        desig = None
        if emp.DESIGNATION_ID:
            de = db.query(Designation).filter(Designation.ID == emp.DESIGNATION_ID).first()
            if de:
                desig = getattr(de, "TITLE", None) or getattr(de, "NAME", None)
        parts = [emp.NAME]
        if emp.EMPLOYEE_CODE: parts.append(f"code {emp.EMPLOYEE_CODE}")
        if desig:             parts.append(desig)
        if dept:              parts.append(f"in {dept}")
        if emp.PHONE:         parts.append(f"phone {emp.PHONE}")
        return HandlerReply(
            reply=". ".join(parts) + ".",
            conversation_complete=True, action_taken="lookup_hit",
        )
