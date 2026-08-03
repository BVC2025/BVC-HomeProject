"""
LeaveAgent — orchestrator for AI-driven leave conversations.

Architecture:
  ┌────────────────────────────────────────────────────────────────┐
  │ User message                                                    │
  │   │                                                             │
  │   ▼                                                             │
  │ ┌──────────────────────────────────────────┐                    │
  │ │  llm_leave_brain.think()  (Gemini)      │                    │
  │ │   - Understands the message in context   │                    │
  │ │   - Updates collected fields             │                    │
  │ │   - Generates the agent_reply            │                    │
  │ │   - Decides next_state                   │                    │
  │ └─────────────────┬────────────────────────┘                    │
  │                   │ if Gemini unavailable                       │
  │                   ▼                                             │
  │ ┌──────────────────────────────────────────┐                    │
  │ │  Rule-based fallback                     │                    │
  │ │  (intent classifier + entity extractor)  │                    │
  │ └──────────────────────────────────────────┘                    │
  │                   │                                             │
  │                   ▼                                             │
  │ ┌──────────────────────────────────────────┐                    │
  │ │  Orchestrator (this file)                │                    │
  │ │  - Persists conversation state           │                    │
  │ │  - Validates against LeaveBalance        │                    │
  │ │  - Creates LeaveRequest on confirmation  │                    │
  │ │  - Emits Notification                    │                    │
  │ └──────────────────────────────────────────┘                    │
  └────────────────────────────────────────────────────────────────┘

The AI never touches the database directly. Only this orchestrator
can create/modify rows — and it does so through the existing
LeaveRequest / Notification models.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Tuple, Any
import json

from sqlalchemy.orm import Session

from app.models.models import (
    AILeaveConversation,
    Employee,
    LeaveBalance,
    LeaveRequest,
    Notification,
)
from app.services.llm_leave_brain import think as llm_think, BrainResult
from app.services.leave_intent_classifier import (
    Intent,
    default_classifier,
)
from app.services.leave_entity_extractor import (
    LeaveEntities,
    default_extractor,
)


SUPPORTED_LEAVE_TYPES = {"CASUAL", "SICK", "EARNED", "MATERNITY",
                        "PATERNITY", "COMP_OFF", "LOP"}


# ============================================================
# Public reply shape
# ============================================================

@dataclass
class AgentReply:
    message: str
    state:   str
    collected: dict
    requires_confirmation: bool = False
    leave_request_id: Optional[int] = None
    suggestions: Optional[List[str]] = None
    source: str = "llm"             # "llm" | "rule" | "system"

    def to_dict(self) -> dict:
        return {
            "message": self.message,
            "state": self.state,
            "collected": self.collected,
            "requires_confirmation": self.requires_confirmation,
            "leave_request_id": self.leave_request_id,
            "suggestions": self.suggestions or [],
            "source": self.source,
        }


# ============================================================
# LeaveAgent — LLM-first orchestrator
# ============================================================

class LeaveAgent:

    REQUIRED_FIELDS = ("leave_type", "start_date", "end_date", "reason")

    def __init__(self, db: Session, employee: Employee):
        self.db = db
        self.employee = employee

    # ------------------------------------------------------------
    # Entry point
    # ------------------------------------------------------------

    def handle_message(
        self, text: str, session_id: Optional[int] = None
    ) -> Tuple[AgentReply, AILeaveConversation]:

        text = (text or "").strip()
        conv = self._load_or_create(session_id)
        self._append_message(conv, role="user", text=text)

        # Try the LLM brain first.
        reply = self._think_with_llm(conv, text)

        # Fall back to rules if Gemini is unreachable / returned junk.
        if reply is None:
            reply = self._think_with_rules(conv, text)

        # Persist outbound message + state.
        self._append_message(conv, role="agent", text=reply.message)
        conv.LAST_AT = datetime.utcnow()
        self.db.commit()
        self.db.refresh(conv)

        reply.state = conv.STATE
        reply.collected = self._collected(conv).to_dict()
        return reply, conv

    # ------------------------------------------------------------
    # LLM path
    # ------------------------------------------------------------

    def _think_with_llm(
        self, conv: AILeaveConversation, text: str
    ) -> Optional[AgentReply]:

        history = self._history_for_prompt(conv)
        collected = self._collected(conv).to_dict()
        balance_snapshot = self._balance_snapshot()

        first_name = (self.employee.NAME or "there").split(" ")[0]

        brain = llm_think(
            employee_name=self.employee.NAME or "",
            employee_first_name=first_name,
            today=date.today(),
            state=conv.STATE,
            collected=collected,
            history=history,
            user_message=text,
            balance_snapshot=balance_snapshot,
        )
        if brain is None:
            return None

        # Merge LLM updates into the persisted collected state.
        merged = self._collected(conv).merge(
            LeaveEntities.from_dict({
                **collected,
                **brain.updates,
            })
        )

        # Set intent now so we can audit later.
        if brain.intent in ("REQUEST", "BALANCE", "STATUS",
                            "CANCEL", "MODIFY"):
            conv.INTENT = brain.intent

        # Route by next_state.
        next_state = brain.next_state

        if next_state == "EXECUTE":
            # Commit collected state first, then validate + submit.
            self._set_collected(conv, merged)
            # Refresh from DB so the submit path sees fresh balance.
            ok, msg = self._validate_against_balance(merged)
            if not ok:
                conv.STATE = "FAILED"
                return AgentReply(
                    message=msg,
                    state=conv.STATE,
                    collected=merged.to_dict(),
                    suggestions=brain.suggestions,
                    source="llm",
                )
            submit_reply = self._submit_leave(conv)
            submit_reply.source = "llm"
            return submit_reply

        if next_state == "CONFIRMING":
            # Still verify we actually have all the required fields.
            missing = [f for f in self.REQUIRED_FIELDS if not getattr(merged, f)]
            if missing:
                # LLM jumped ahead — stay in COLLECTING.
                conv.STATE = "COLLECTING"
            else:
                # Run a server-side balance check BEFORE we ask for
                # confirmation, even though the LLM may have read the
                # snapshot, in case of race conditions.
                ok, balance_msg = self._validate_against_balance(merged)
                if not ok:
                    conv.STATE = "FAILED"
                    self._set_collected(conv, merged)
                    return AgentReply(
                        message=balance_msg,
                        state=conv.STATE,
                        collected=merged.to_dict(),
                        suggestions=brain.suggestions,
                        source="llm",
                    )
                conv.STATE = "CONFIRMING"
            self._set_collected(conv, merged)
            return AgentReply(
                message=brain.agent_reply,
                state=conv.STATE,
                collected=merged.to_dict(),
                requires_confirmation=(conv.STATE == "CONFIRMING"),
                suggestions=brain.suggestions or (
                    ["Yes, submit it", "No, cancel"]
                    if conv.STATE == "CONFIRMING" else None
                ),
                source="llm",
            )

        if next_state == "CANCELLED":
            conv.STATE = "CANCELLED"
            conv.COMPLETED_AT = datetime.utcnow()
            conv.RESULT_MESSAGE = "Cancelled by employee"
            return AgentReply(
                message=brain.agent_reply,
                state=conv.STATE,
                collected=merged.to_dict(),
                suggestions=brain.suggestions,
                source="llm",
            )

        if next_state == "DONE_INFO":
            # Pure informational turn — keep state as it was, but if
            # the intent was BALANCE / STATUS / GREETING we serve them
            # with REAL data instead of trusting the LLM's recall.
            if brain.intent == "BALANCE":
                return AgentReply(
                    message=self._render_balance_text() or brain.agent_reply,
                    state=conv.STATE,
                    collected=merged.to_dict(),
                    suggestions=brain.suggestions,
                    source="llm",
                )
            if brain.intent == "STATUS":
                return AgentReply(
                    message=self._render_status_text() or brain.agent_reply,
                    state=conv.STATE,
                    collected=merged.to_dict(),
                    suggestions=brain.suggestions,
                    source="llm",
                )
            return AgentReply(
                message=brain.agent_reply,
                state=conv.STATE,
                collected=merged.to_dict(),
                suggestions=brain.suggestions,
                source="llm",
            )

        # Default — COLLECTING
        conv.STATE = "COLLECTING"
        self._set_collected(conv, merged)
        return AgentReply(
            message=brain.agent_reply,
            state=conv.STATE,
            collected=merged.to_dict(),
            suggestions=brain.suggestions,
            source="llm",
        )

    # ------------------------------------------------------------
    # Rule-based fallback path (kicks in if Gemini fails)
    # ------------------------------------------------------------

    def _think_with_rules(
        self, conv: AILeaveConversation, text: str
    ) -> AgentReply:

        # CONFIRMING + user message handled distinctly.
        if conv.STATE == "CONFIRMING":
            intent = default_classifier.classify(text).intent
            if intent == Intent.CONFIRM:
                reply = self._submit_leave(conv)
                reply.source = "rule"
                return reply
            if intent in (Intent.DENY, Intent.CANCEL):
                conv.STATE = "CANCELLED"
                conv.COMPLETED_AT = datetime.utcnow()
                conv.RESULT_MESSAGE = "Cancelled by employee"
                return AgentReply(
                    message="OK, I won't submit anything. "
                            "Let me know whenever you'd like to try again.",
                    state=conv.STATE,
                    collected=self._collected(conv).to_dict(),
                    source="rule",
                )
            # Anything else mid-confirm: treat as amendment.
            conv.STATE = "COLLECTING"

        # Pull intent + entities.
        intent_result = default_classifier.classify(text)
        existing = self._collected(conv)
        new = default_extractor.extract(text)
        merged = existing.merge(new)

        if not merged.leave_type and (merged.start_date or merged.reason):
            merged.leave_type = "CASUAL"
        self._set_collected(conv, merged)

        # Handle non-request intents.
        if intent_result.intent == Intent.BALANCE:
            return AgentReply(
                message=self._render_balance_text() or "I couldn't fetch your balance.",
                state=conv.STATE,
                collected=merged.to_dict(),
                source="rule",
            )
        if intent_result.intent == Intent.STATUS:
            return AgentReply(
                message=self._render_status_text() or "No leave history found.",
                state=conv.STATE,
                collected=merged.to_dict(),
                source="rule",
            )
        if intent_result.intent == Intent.GREETING:
            first = (self.employee.NAME or "there").split(" ")[0]
            return AgentReply(
                message=f"Hi {first}! Tell me what kind of leave you need.",
                state=conv.STATE,
                collected=merged.to_dict(),
                suggestions=[
                    "I need leave tomorrow",
                    "How many leaves do I have?",
                ],
                source="rule",
            )
        if intent_result.intent == Intent.CANCEL:
            conv.STATE = "CANCELLED"
            conv.COMPLETED_AT = datetime.utcnow()
            conv.RESULT_MESSAGE = "Cancelled by employee"
            return AgentReply(
                message="OK, cancelled. Let me know when you'd like to try again.",
                state=conv.STATE,
                collected=merged.to_dict(),
                source="rule",
            )

        # REQUEST / MODIFY / UNKNOWN -> collecting flow.
        conv.INTENT = "REQUEST"
        conv.STATE = "COLLECTING"

        if merged.start_date and merged.end_date and merged.start_date > merged.end_date:
            return AgentReply(
                message="The start date is after the end date — could you give me the correct dates?",
                state=conv.STATE,
                collected=merged.to_dict(),
                source="rule",
            )

        missing = [f for f in self.REQUIRED_FIELDS if not getattr(merged, f)]
        if missing:
            return self._ask_for_missing(merged, missing[0], conv)

        ok, msg = self._validate_against_balance(merged)
        if not ok:
            conv.STATE = "FAILED"
            return AgentReply(
                message=msg,
                state=conv.STATE,
                collected=merged.to_dict(),
                source="rule",
            )

        conv.STATE = "CONFIRMING"
        return AgentReply(
            message=f"{self._render_summary(merged)}\n\nShould I submit this request to your manager?",
            state=conv.STATE,
            collected=merged.to_dict(),
            requires_confirmation=True,
            suggestions=["Yes, submit it", "No, cancel"],
            source="rule",
        )

    # ------------------------------------------------------------
    # Submit — same as before, defensive against schema drift
    # ------------------------------------------------------------

    def _submit_leave(self, conv: AILeaveConversation) -> AgentReply:
        entities = self._collected(conv)

        ok, msg = self._validate_against_balance(entities)
        if not ok:
            conv.STATE = "FAILED"
            return AgentReply(
                message=msg + "\n\nLet me know if you'd like to try a different date.",
                state=conv.STATE,
                collected=entities.to_dict(),
            )

        days_used = float(entities.days or 0)
        if entities.half_day:
            days_used = 0.5

        try:
            lr = LeaveRequest(
                EMPLOYEE_ID=self.employee.ID,
                LEAVE_TYPE=entities.leave_type,
                START_DATE=entities.start_date,
                END_DATE=entities.end_date,
                DAYS=days_used,
                REASON=entities.reason or "(no reason given)",
                STATUS="PENDING_APPROVAL",
                CREATED_AT=datetime.utcnow(),
                VENDOR_ID=getattr(self.employee, "VENDOR_ID", None),
            )
            self.db.add(lr)
            self.db.flush()
        except Exception as ex:
            self.db.rollback()
            conv.STATE = "FAILED"
            return AgentReply(
                message=f"Couldn't submit the leave request: {type(ex).__name__}. "
                        f"Please try again, or apply via the form.",
                state=conv.STATE,
                collected=entities.to_dict(),
            )

        try:
            self.db.add(Notification(
                TYPE="INFO",
                TITLE=f"Leave request submitted (#{lr.ID})",
                MESSAGE=(
                    f"{self.employee.NAME}'s {entities.leave_type} leave "
                    f"for {entities.start_date} to {entities.end_date} "
                    f"is awaiting manager approval."
                ),
                CREATED_AT=datetime.utcnow(),
                IS_READ=0,
                VENDOR_ID=getattr(self.employee, "VENDOR_ID", None),
            ))
        except Exception:
            pass

        conv.STATE = "EXECUTED"
        conv.LEAVE_REQUEST_ID = lr.ID
        conv.COMPLETED_AT = datetime.utcnow()
        conv.RESULT_MESSAGE = f"Leave request #{lr.ID} submitted"

        return AgentReply(
            message=(
                f"Done. I've submitted your {entities.leave_type} leave for "
                f"{entities.start_date} to {entities.end_date} "
                f"({entities.days} day{'s' if entities.days != 1 else ''}). "
                f"Request #{lr.ID} is now pending manager approval. "
                f"You'll get a notification once it's reviewed."
            ),
            state=conv.STATE,
            collected=entities.to_dict(),
            leave_request_id=lr.ID,
        )

    # ------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------

    def _validate_against_balance(
        self, entities: LeaveEntities
    ) -> Tuple[bool, str]:
        if not entities.leave_type or not entities.start_date or not entities.end_date:
            return False, "I'm still missing some information."

        if entities.start_date > entities.end_date:
            return False, "Start date is after end date — please correct it."

        today = date.today()
        if entities.start_date < today:
            return False, ("That start date is in the past. "
                          "Please choose today or a future date.")

        days_needed = float(entities.days or 1)
        if entities.half_day:
            days_needed = 0.5

        if entities.leave_type == "LOP":
            return True, ""

        balance = self._balance_for(entities.leave_type, entities.start_date.year)
        if balance is None:
            return True, ""    # no quota row -> let it through

        if days_needed > balance:
            return False, (
                f"You only have {balance} day(s) of "
                f"{entities.leave_type} leave left this year, but the "
                f"request is for {int(days_needed) if days_needed.is_integer() else days_needed} day(s). "
                f"You could split this or use LOP for the overage."
            )

        return True, ""

    def _balance_for(self, leave_type: str, year: int) -> Optional[float]:
        row = (
            self.db.query(LeaveBalance)
            .filter(
                LeaveBalance.EMPLOYEE_ID == self.employee.ID,
                LeaveBalance.YEAR == year,
            ).first()
        )
        if not row:
            return None
        if leave_type == "CASUAL":
            return float(row.CASUAL_TOTAL or 0) - float(row.CASUAL_USED or 0)
        if leave_type == "SICK":
            return float(row.SICK_TOTAL or 0) - float(row.SICK_USED or 0)
        if leave_type == "EARNED":
            return float(row.EARNED_TOTAL or 0) - float(row.EARNED_USED or 0)
        return None

    def _balance_snapshot(self) -> Optional[Dict[str, Any]]:
        year = date.today().year
        row = (
            self.db.query(LeaveBalance)
            .filter(
                LeaveBalance.EMPLOYEE_ID == self.employee.ID,
                LeaveBalance.YEAR == year,
            ).first()
        )
        if not row:
            return None
        return {
            "year": year,
            "casual_remaining": float(row.CASUAL_TOTAL or 0) - float(row.CASUAL_USED or 0),
            "sick_remaining":   float(row.SICK_TOTAL   or 0) - float(row.SICK_USED   or 0),
            "earned_remaining": float(row.EARNED_TOTAL or 0) - float(row.EARNED_USED or 0),
        }

    # ------------------------------------------------------------
    # Templated info responses (used by both LLM and rule paths)
    # ------------------------------------------------------------

    def _render_balance_text(self) -> Optional[str]:
        snap = self._balance_snapshot()
        if not snap:
            return None
        return (
            f"Here's your {snap['year']} leave balance:\n"
            f"  • Casual:  {snap['casual_remaining']} day(s) remaining\n"
            f"  • Sick:    {snap['sick_remaining']} day(s) remaining\n"
            f"  • Earned:  {snap['earned_remaining']} day(s) remaining"
        )

    def _render_status_text(self) -> Optional[str]:
        recent = (
            self.db.query(LeaveRequest)
            .filter(LeaveRequest.EMPLOYEE_ID == self.employee.ID)
            .order_by(LeaveRequest.ID.desc())
            .limit(3)
            .all()
        )
        if not recent:
            return None
        lines = ["Your most recent leave requests:"]
        for lr in recent:
            lines.append(
                f"  • #{lr.ID} {lr.LEAVE_TYPE} "
                f"{lr.START_DATE} → {lr.END_DATE} "
                f"({lr.DAYS} day) — {lr.STATUS}"
            )
        return "\n".join(lines)

    def _render_summary(self, e: LeaveEntities) -> str:
        days_txt = f"{e.days} day" + ("" if e.days == 1 else "s")
        if e.half_day:
            days_txt += " (half day)"
        return (
            "Here's what I have:\n"
            f"  • Type:     {e.leave_type}\n"
            f"  • From:     {e.start_date}\n"
            f"  • To:       {e.end_date}\n"
            f"  • Duration: {days_txt}\n"
            f"  • Reason:   {e.reason or '(no reason given)'}"
        )

    # ------------------------------------------------------------
    # Helpers — same as before (persistence, missing-field prompts)
    # ------------------------------------------------------------

    def _ask_for_missing(
        self, entities: LeaveEntities, field: str, conv: AILeaveConversation
    ) -> AgentReply:
        if field == "leave_type":
            return AgentReply(
                message="What type of leave would you like? (Casual / Sick / Earned)",
                state=conv.STATE, collected=entities.to_dict(),
                suggestions=["Casual", "Sick", "Earned"], source="rule",
            )
        if field == "start_date":
            return AgentReply(
                message="What date would you like the leave to start?",
                state=conv.STATE, collected=entities.to_dict(),
                suggestions=["Tomorrow", "Next Monday"], source="rule",
            )
        if field == "end_date":
            return AgentReply(
                message=f"And what's the last day of the leave? (start is {entities.start_date})",
                state=conv.STATE, collected=entities.to_dict(),
                suggestions=["Same day"], source="rule",
            )
        if field == "reason":
            return AgentReply(
                message="What's the reason for the leave?",
                state=conv.STATE, collected=entities.to_dict(),
                suggestions=["Family function", "Medical", "Personal"], source="rule",
            )
        return AgentReply(
            message="Could you give me more detail?",
            state=conv.STATE, collected=entities.to_dict(), source="rule",
        )

    def _load_or_create(self, session_id: Optional[int]) -> AILeaveConversation:
        if session_id:
            row = (
                self.db.query(AILeaveConversation)
                .filter(AILeaveConversation.ID == session_id)
                .filter(AILeaveConversation.EMPLOYEE_ID == self.employee.ID)
                .first()
            )
            if row and row.STATE not in {"EXECUTED", "CANCELLED", "FAILED"}:
                return row

        open_row = (
            self.db.query(AILeaveConversation)
            .filter(AILeaveConversation.EMPLOYEE_ID == self.employee.ID)
            .filter(AILeaveConversation.STATE.in_(["COLLECTING", "CONFIRMING"]))
            .order_by(AILeaveConversation.ID.desc())
            .first()
        )
        if open_row:
            return open_row

        row = AILeaveConversation(
            EMPLOYEE_ID=self.employee.ID,
            STATE="COLLECTING",
            COLLECTED_JSON=json.dumps({}),
            MESSAGES_JSON=json.dumps([]),
            STARTED_AT=datetime.utcnow(),
            LAST_AT=datetime.utcnow(),
            VENDOR_ID=getattr(self.employee, "VENDOR_ID", None),
        )
        self.db.add(row)
        self.db.flush()
        return row

    def _collected(self, conv: AILeaveConversation) -> LeaveEntities:
        try:
            return LeaveEntities.from_dict(json.loads(conv.COLLECTED_JSON or "{}"))
        except Exception:
            return LeaveEntities()

    def _set_collected(self, conv: AILeaveConversation, e: LeaveEntities) -> None:
        conv.COLLECTED_JSON = json.dumps(e.to_dict())

    def _append_message(self, conv: AILeaveConversation, role: str, text: str) -> None:
        try:
            msgs = json.loads(conv.MESSAGES_JSON or "[]")
        except Exception:
            msgs = []
        msgs.append({
            "role": role, "text": text,
            "at": datetime.utcnow().isoformat() + "Z",
        })
        if len(msgs) > 100:
            msgs = msgs[-100:]
        conv.MESSAGES_JSON = json.dumps(msgs)

    def _history_for_prompt(self, conv: AILeaveConversation) -> List[Dict[str, str]]:
        try:
            msgs = json.loads(conv.MESSAGES_JSON or "[]")
        except Exception:
            msgs = []
        # Convert {role, text, at} -> {role, content} that the LLM expects.
        return [{"role": m.get("role", "?"), "text": m.get("text", "")} for m in msgs[-10:]]
