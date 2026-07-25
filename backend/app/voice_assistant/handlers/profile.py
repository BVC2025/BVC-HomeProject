"""Own-profile query handler — read-only single turn."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import Employee, Department, Designation
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


class ProfileHandler(BaseHandler):

    intent = "profile_query"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:

        field = str(entities.get("profile_field") or "").lower()

        dept_name = None
        if employee.DEPARTMENT_ID:
            d = db.query(Department).filter(Department.ID == employee.DEPARTMENT_ID).first()
            if d:
                dept_name = getattr(d, "NAME", None) or getattr(d, "DEPARTMENT_NAME", None)

        desig_name = None
        if employee.DESIGNATION_ID:
            de = db.query(Designation).filter(Designation.ID == employee.DESIGNATION_ID).first()
            if de:
                desig_name = getattr(de, "TITLE", None) or getattr(de, "NAME", None)

        session.active_intent = None; session.slots = {}

        # Field-specific answers
        if "department" in field:
            return HandlerReply(
                reply=f"You're in {dept_name or 'no department assigned'}.",
                conversation_complete=True, action_taken="profile_read",
            )
        if "designation" in field or "role" in field or "title" in field:
            return HandlerReply(
                reply=f"Your designation is {desig_name or 'not set'}.",
                conversation_complete=True, action_taken="profile_read",
            )
        if "joining" in field or "join date" in field:
            jd = employee.JOINING_DATE.isoformat() if employee.JOINING_DATE else "not on record"
            return HandlerReply(
                reply=f"You joined on {jd}.",
                conversation_complete=True, action_taken="profile_read",
            )
        if "code" in field or "employee id" in field:
            return HandlerReply(
                reply=f"Your employee code is {employee.EMPLOYEE_CODE}.",
                conversation_complete=True, action_taken="profile_read",
            )

        # Default: full summary
        parts = [f"You're {employee.NAME}"]
        if employee.EMPLOYEE_CODE:
            parts.append(f"code {employee.EMPLOYEE_CODE}")
        if desig_name:
            parts.append(desig_name)
        if dept_name:
            parts.append(f"in {dept_name}")
        return HandlerReply(
            reply=". ".join(parts) + ".",
            conversation_complete=True,
            action_taken="profile_read",
        )
