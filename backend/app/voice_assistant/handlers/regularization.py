"""
Attendance regularization request handler.

Regularization = employee asks HR to fix a missed / wrong check-in
or check-out. We capture the request into a LeaveRequest row with
LEAVE_TYPE='ATTENDANCE_REGULARIZATION' so it flows through the same
manager-approval pipeline. When approved, HR patches Attendance.
"""

from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models.models import Employee, LeaveRequest
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


log = logging.getLogger("voice_assistant.regularization")


class RegularizationHandler(BaseHandler):

    intent = "attendance_regularization"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:

        slots = session.slots
        for key in ("date", "reason"):
            if entities.get(key) is not None and slots.get(key) is None:
                slots[key] = entities[key]

        if not slots.get("date"):
            return HandlerReply(
                reply="Which date needs regularization?",
            )

        try:
            d = date.fromisoformat(slots["date"])
            if d > date.today():
                slots.pop("date", None)
                return HandlerReply(
                    reply="Regularization is for past dates only. Which day?",
                )
        except Exception:
            slots.pop("date", None)
            return HandlerReply(reply="I didn't catch the date.")

        if not slots.get("reason"):
            raw = str(slots.get("_last_user_message") or "").strip()
            consumed_this_turn = entities.get("date") is not None
            if raw and not consumed_this_turn and raw.lower() not in {
                "yes","no","cancel","stop","confirm","submit",
            } and len(raw) <= 300:
                slots["reason"] = raw
            if not slots.get("reason"):
                return HandlerReply(
                    reply="What went wrong that day? Missed check-in, wrong check-out, or something else?",
                )

        if not slots.get("_confirmed"):
            return HandlerReply(
                reply=(
                    f"Should I file an attendance regularization for {slots['date']} — "
                    f"reason: {slots['reason']}?"
                ),
            )

        try:
            req = LeaveRequest(
                EMPLOYEE_ID = employee.ID,
                LEAVE_TYPE  = "ATTENDANCE_REGULARIZATION",
                START_DATE  = d,
                END_DATE    = d,
                DAYS        = 0,
                REASON      = slots["reason"],
                STATUS      = "PENDING",
                APPROVAL_REQUESTED_AT = datetime.utcnow(),
                VENDOR_ID   = employee.VENDOR_ID or 1,
            )
            db.add(req)
            db.commit()
        except Exception:
            log.exception("regularization submission failed")
            db.rollback()
            session.active_intent = None; session.slots = {}
            return HandlerReply(
                reply="Couldn't file the regularization. Please raise it on the Attendance page.",
                conversation_complete=True, action_taken="error",
            )

        session.active_intent = None; session.slots = {}
        return HandlerReply(
            reply=f"Filed — regularization for {slots['date']} sent to your manager.",
            conversation_complete=True,
            action_taken="regularization_submitted",
        )
