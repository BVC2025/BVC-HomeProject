"""Leave balance query — read-only, single turn."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.models import Employee, LeaveBalance
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.schemas import SessionState


class LeaveBalanceHandler(BaseHandler):

    intent = "leave_balance"

    async def handle(
        self,
        db: Session,
        session: SessionState,
        entities: dict,
        employee: Employee,
    ) -> HandlerReply:

        bal = (
            db.query(LeaveBalance)
            .filter(LeaveBalance.EMPLOYEE_ID == employee.ID)
            .first()
        )
        if not bal:
            session.active_intent = None; session.slots = {}
            return HandlerReply(
                reply="I couldn't find a leave balance record for you. Please contact HR.",
                conversation_complete=True,
                action_taken="balance_missing",
            )

        casual = float((bal.CASUAL_TOTAL or 0) - (bal.CASUAL_USED or 0))
        sick   = float((bal.SICK_TOTAL   or 0) - (bal.SICK_USED   or 0))
        earned = float((bal.EARNED_TOTAL or 0) - (bal.EARNED_USED or 0))

        session.active_intent = None; session.slots = {}
        return HandlerReply(
            reply=(
                f"You have {casual:g} casual, {sick:g} sick, and {earned:g} earned "
                f"leave days remaining."
            ),
            conversation_complete=True,
            action_taken="balance_read",
        )
