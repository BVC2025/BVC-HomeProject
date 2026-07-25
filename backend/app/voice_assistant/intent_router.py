"""
Routes an extracted intent to the correct handler, applies conversation
rules (confirm / cancel / deny), and returns the final HandlerReply.

Design choices:

  1. Once a handler is active in a session, subsequent messages are
     treated as slot fills for THAT handler regardless of what Gemini
     re-classifies them as — unless the user explicitly cancels.
     This is what makes the multi-turn flow feel natural. Without it
     "yes" or "morning" would be re-classified as `unknown` every turn.

  2. "affirm" / "deny" are meta-intents. They only make sense in the
     context of an active handler awaiting confirmation.

  3. "cancel" always wins and clears session state.
"""

from __future__ import annotations

import logging
from typing import Dict

from sqlalchemy.orm import Session

from app.models.models import Employee
from app.voice_assistant.handlers.base import BaseHandler, HandlerReply
from app.voice_assistant.handlers.admin_queries   import (
    AttendanceSummaryHandler,
    EmployeeLookupHandler,
    PendingApprovalsHandler,
)
from app.voice_assistant.handlers.balance         import LeaveBalanceHandler
from app.voice_assistant.handlers.hr_policy       import HRPolicyHandler
from app.voice_assistant.handlers.leave           import LeaveHandler
from app.voice_assistant.handlers.payslip         import PayslipHandler
from app.voice_assistant.handlers.permission      import PermissionHandler
from app.voice_assistant.handlers.profile         import ProfileHandler
from app.voice_assistant.handlers.regularization  import RegularizationHandler
from app.voice_assistant.schemas import ExtractedIntent, SessionState


log = logging.getLogger("voice_assistant.router")


HANDLERS: Dict[str, BaseHandler] = {
    # Employee-scoped
    "leave_request":             LeaveHandler(),
    "permission_request":        PermissionHandler(),
    "attendance_regularization": RegularizationHandler(),
    "leave_balance":             LeaveBalanceHandler(),
    "payslip_request":           PayslipHandler(),
    "hr_policy":                 HRPolicyHandler(),
    "profile_query":             ProfileHandler(),
    # Admin / HR-scoped
    "pending_approvals":         PendingApprovalsHandler(),
    "attendance_summary":        AttendanceSummaryHandler(),
    "employee_lookup":           EmployeeLookupHandler(),
}


async def route(
    db: Session,
    session: SessionState,
    extracted: ExtractedIntent,
    employee: Employee,
) -> HandlerReply:

    # ---- 1. Cancel — nuke everything, exit ----
    if extracted.intent == "cancel":
        session.active_intent = None
        session.slots = {}
        return HandlerReply(
            reply="Okay, cancelled.",
            conversation_complete=True,
            action_taken="cancelled",
        )

    # ---- 2. affirm / deny only meaningful mid-flow ----
    if extracted.intent == "affirm":
        if session.active_intent and session.slots.get("_awaiting_confirm"):
            # Promote to _confirmed and re-dispatch to the active handler
            session.slots["_confirmed"] = True
            session.slots.pop("_awaiting_confirm", None)
            handler = HANDLERS.get(session.active_intent)
            if handler:
                return await handler.handle(db, session, extracted.entities, employee)
        # affirm with no context
        return HandlerReply(reply="What would you like me to do?")

    if extracted.intent == "deny":
        # Denying at a confirmation → cancel just this request
        session.active_intent = None
        session.slots = {}
        return HandlerReply(
            reply="Okay, I won't submit that. Anything else?",
            conversation_complete=False,
            action_taken="denied",
        )

    # ---- 3. If a handler is already active, stay with it ----
    if session.active_intent and session.active_intent in HANDLERS:
        handler = HANDLERS[session.active_intent]
        return await handler.handle(db, session, extracted.entities, employee)

    # ---- 4. Fresh intent — activate handler ----
    handler = HANDLERS.get(extracted.intent)
    if handler is None:
        return HandlerReply(
            reply=(
                "I can help with leave, permission, attendance regularization, "
                "leave balance, payslips, HR policy, or your profile. What would you like?"
            ),
        )

    session.active_intent = extracted.intent
    session.slots = session.slots or {}
    return await handler.handle(db, session, extracted.entities, employee)
