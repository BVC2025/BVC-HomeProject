"""
Leave application handler.

Conversation shape (matches the spec):

  U: Apply leave tomorrow.
  A: Full day or half day?
  U: Half day.
  A: Morning or afternoon?
  U: Afternoon.
  A: Reason?
  U: Doctor appointment.
  A: Should I submit — half-day (afternoon) casual leave on 2026-07-26 for doctor appointment?
  U: Yes.
  A: Done — leave request submitted.

Business rules enforced BEFORE submission (never delegated to Gemini):
  • Leave balance >= days requested (for CASUAL / SICK / EARNED)
  • Leave type is valid
  • Requested date is not in the past
  • Reason required when days > 2 (existing policy in leave.py)
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import Employee, LeaveRequest, LeaveBalance
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


log = logging.getLogger("voice_assistant.leave")


VALID_LEAVE_TYPES  = {"CASUAL", "SICK", "EARNED", "UNPAID", "LOP"}
QUOTA_BACKED_TYPES = {"CASUAL", "SICK", "EARNED"}


class LeaveHandler(BaseHandler):

    intent = "leave_request"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:

        slots = session.slots

        # ---- Merge freshly-extracted entities into slot state ----
        for key in ("date", "start_date", "end_date", "leave_type",
                    "half_day", "half_day_slot", "reason"):
            if entities.get(key) is not None and slots.get(key) is None:
                slots[key] = entities[key]

        # Normalise: a single "date" fills both start + end
        if slots.get("date") and not slots.get("start_date"):
            slots["start_date"] = slots["date"]
            slots["end_date"]   = slots["date"]

        # ---- Slot filling — ask ONE question at a time ----

        if not slots.get("start_date"):
            return HandlerReply(
                reply="Which date? You can say today, tomorrow, or a specific date.",
            )

        # Reject past dates immediately — user's time not wasted
        try:
            sd = date.fromisoformat(slots["start_date"])
            if sd < date.today():
                # Clear the bad date and re-ask
                slots.pop("start_date", None)
                slots.pop("end_date",   None)
                slots.pop("date",       None)
                return HandlerReply(
                    reply="That date is in the past. Which future date?",
                )
        except Exception:
            slots.pop("start_date", None)
            return HandlerReply(
                reply="I didn't catch the date. Which day would you like?",
            )

        if slots.get("half_day") is None:
            return HandlerReply(reply="Full day or half day?")

        if slots["half_day"] is True and not slots.get("half_day_slot"):
            return HandlerReply(reply="Morning or afternoon?")

        if not slots.get("leave_type"):
            return HandlerReply(
                reply="Casual leave, sick leave, or earned leave?",
            )
        leave_type = str(slots["leave_type"]).upper()
        if leave_type not in VALID_LEAVE_TYPES:
            slots.pop("leave_type", None)
            return HandlerReply(
                reply="I can file casual, sick, earned, unpaid, or LOP. Which one?",
            )
        slots["leave_type"] = leave_type

        if not slots.get("reason"):
            # Backstop for the reason slot: if Gemini / the fallback
            # extractor didn't pull a reason but the user just said
            # something free-form, treat the whole utterance as the
            # reason. Skip keywords that are clearly meta ("yes"/"no"/etc).
            raw = str(slots.get("_last_user_message") or "").strip()
            if raw and raw.lower() not in {
                "yes","no","yeah","yup","ok","okay","sure","submit",
                "cancel","stop","confirm","half day","full day",
                "morning","afternoon","casual","sick","earned",
            } and len(raw) <= 200 and len(raw.split()) >= 1:
                # Only use the raw message if this turn added no other
                # slot — otherwise it's ambiguous.
                consumed_this_turn = any(entities.get(k) is not None for k in (
                    "date","start_date","end_date","leave_type",
                    "half_day","half_day_slot",
                ))
                if not consumed_this_turn:
                    slots["reason"] = raw
            if not slots.get("reason"):
                return HandlerReply(reply="What's the reason?")

        # ---- Business-rule check BEFORE asking for confirmation ----
        days = 0.5 if slots["half_day"] else 1.0
        if leave_type in QUOTA_BACKED_TYPES:
            bal = (
                db.query(LeaveBalance)
                .filter(LeaveBalance.EMPLOYEE_ID == employee.ID)
                .first()
            )
            available = _remaining_for_type(bal, leave_type)
            if available < days:
                self._reset(session)
                return HandlerReply(
                    reply=(
                        f"You only have {available:g} day{'s' if available != 1 else ''} of "
                        f"{leave_type.lower()} leave left, but this request needs {days:g}. "
                        f"Try a different leave type or a shorter duration."
                    ),
                    conversation_complete=True,
                    action_taken="rejected_insufficient_balance",
                )

        # ---- Confirmation gate ----
        if not slots.get("_confirmed"):
            slots["_awaiting_confirm"] = True
            when = slots["start_date"]
            duration = (
                f"half-day ({slots.get('half_day_slot','—')})"
                if slots["half_day"] else "full-day"
            )
            return HandlerReply(
                reply=(
                    f"Should I submit — {duration} {leave_type.lower()} leave "
                    f"on {when} for {slots['reason']}?"
                ),
            )

        # ---- Submission ----
        try:
            new_leave = LeaveRequest(
                EMPLOYEE_ID = employee.ID,
                LEAVE_TYPE  = leave_type,
                START_DATE  = date.fromisoformat(slots["start_date"]),
                END_DATE    = date.fromisoformat(slots["end_date"] or slots["start_date"]),
                DAYS        = days,
                REASON      = slots["reason"],
                STATUS      = "PENDING",
                APPROVAL_REQUESTED_AT = datetime.utcnow(),
                VENDOR_ID   = employee.VENDOR_ID or 1,
            )
            db.add(new_leave)
            db.commit()
            db.refresh(new_leave)
            log.info("voice: created leave request #%s for %s", new_leave.ID, employee.ID)
        except Exception as exc:
            log.exception("voice: leave submission failed")
            db.rollback()
            self._reset(session)
            return HandlerReply(
                reply="Something went wrong submitting the request. Please try again from the leave page.",
                conversation_complete=True,
                action_taken="error",
            )

        self._reset(session)
        return HandlerReply(
            reply=(
                f"Done — {leave_type.lower()} leave for {slots.get('start_date')} "
                f"submitted for your manager's approval."
            ),
            conversation_complete=True,
            action_taken="leave_submitted",
        )

    @staticmethod
    def _reset(session: SessionState) -> None:
        session.active_intent = None
        session.slots = {}


def _remaining_for_type(bal: Optional[LeaveBalance], leave_type: str) -> float:
    if not bal:
        return 0.0
    totals = {
        "CASUAL": (bal.CASUAL_TOTAL, bal.CASUAL_USED),
        "SICK":   (bal.SICK_TOTAL,   bal.SICK_USED),
        "EARNED": (bal.EARNED_TOTAL, bal.EARNED_USED),
    }
    if leave_type not in totals:
        return 0.0
    total, used = totals[leave_type]
    return float((total or 0) - (used or 0))
