"""Permission (sub-day) request handler."""

from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models.models import Employee, LeaveRequest
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


log = logging.getLogger("voice_assistant.permission")


class PermissionHandler(BaseHandler):

    intent = "permission_request"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:

        slots = session.slots
        for key in ("date", "duration_hours", "reason"):
            if entities.get(key) is not None and slots.get(key) is None:
                slots[key] = entities[key]
        if slots.get("date") and not slots.get("permission_date"):
            slots["permission_date"] = slots["date"]

        if not slots.get("permission_date"):
            return HandlerReply(reply="Which date for the permission?")

        try:
            pd = date.fromisoformat(slots["permission_date"])
            if pd < date.today():
                slots.pop("permission_date", None)
                slots.pop("date",            None)
                return HandlerReply(reply="That date is in the past. Which future date?")
        except Exception:
            slots.pop("permission_date", None)
            return HandlerReply(reply="I didn't catch the date. Which day?")

        if slots.get("duration_hours") is None:
            return HandlerReply(reply="How many hours do you need? Between half an hour and eight.")
        try:
            hours = float(slots["duration_hours"])
        except Exception:
            slots.pop("duration_hours", None)
            return HandlerReply(reply="Please say the duration in hours.")
        if hours <= 0 or hours > 8:
            slots.pop("duration_hours", None)
            return HandlerReply(reply="Permission must be between half an hour and eight hours. Try again.")

        if not slots.get("reason"):
            raw = str(slots.get("_last_user_message") or "").strip()
            consumed_this_turn = any(entities.get(k) is not None for k in (
                "date","permission_date","duration_hours",
            ))
            if raw and not consumed_this_turn and raw.lower() not in {
                "yes","no","cancel","stop","confirm","submit",
            } and len(raw) <= 200:
                slots["reason"] = raw
            if not slots.get("reason"):
                return HandlerReply(reply="What's the reason?")

        if not slots.get("_confirmed"):
            return HandlerReply(
                reply=(
                    f"Should I submit — {hours:g}-hour permission on {slots['permission_date']} "
                    f"for {slots['reason']}?"
                ),
            )

        try:
            req = LeaveRequest(
                EMPLOYEE_ID = employee.ID,
                LEAVE_TYPE  = "PERMISSION",
                START_DATE  = date.fromisoformat(slots["permission_date"]),
                END_DATE    = date.fromisoformat(slots["permission_date"]),
                DAYS        = 0,
                DURATION_HOURS = hours,
                REASON      = slots["reason"],
                STATUS      = "PENDING",
                APPROVAL_REQUESTED_AT = datetime.utcnow(),
                VENDOR_ID   = employee.VENDOR_ID or 1,
                PERMISSION_SUBTYPE = "SHORT_PERMISSION",
            )
            db.add(req)
            db.commit()
            db.refresh(req)
        except Exception:
            log.exception("permission submission failed")
            db.rollback()
            session.active_intent = None; session.slots = {}
            return HandlerReply(
                reply="Couldn't submit the permission. Please use the Permission page.",
                conversation_complete=True, action_taken="error",
            )

        session.active_intent = None; session.slots = {}
        return HandlerReply(
            reply=f"Done — {hours:g}-hour permission on {slots['permission_date']} sent for approval.",
            conversation_complete=True,
            action_taken="permission_submitted",
        )
