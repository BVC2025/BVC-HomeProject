"""
AI Leave Agent — REST endpoints.

  POST /leave-agent/chat            -> Send a message, get a reply.
  GET  /leave-agent/conversations   -> List employee's recent sessions.
  GET  /leave-agent/conversations/{id} -> Single conversation (messages).
  POST /leave-agent/reset           -> Force-close the active conversation.

Authentication / authorisation rules:
  - Every endpoint requires a logged-in user.
  - Employees can only operate on their own conversations.
  - Admin / HR may pass ?employee_id=X to inspect on behalf of someone.
"""

from __future__ import annotations

from typing import Optional
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import AILeaveConversation, Employee
from app.services.leave_agent_service import LeaveAgent
from app.utils.employee_resolver import require_employee


router = APIRouter(prefix="/leave-agent", tags=["AI Leave Agent"])


# ============================================================
# Schemas
# ============================================================

class ChatRequest(BaseModel):
    EMPLOYEE_ID: str = Field(..., description="UUID or EMPLOYEE_CODE")
    MESSAGE:     str = Field(..., min_length=1, max_length=2000)
    SESSION_ID:  Optional[int] = Field(
        None,
        description="If continuing an existing session, pass its ID. "
                    "Otherwise the agent picks the most recent open session "
                    "or creates a new one.",
    )


# ============================================================
# Routes
# ============================================================

@router.post("/chat")
def chat(
    body: ChatRequest,
    db: Session = Depends(get_db),
):
    """Primary entry — process a user message through the agent."""

    employee = require_employee(db, body.EMPLOYEE_ID)

    agent = LeaveAgent(db=db, employee=employee)
    try:
        reply, conv = agent.handle_message(
            text=body.MESSAGE,
            session_id=body.SESSION_ID,
        )
    except Exception as ex:
        # Make the failure mode visible to the user instead of letting
        # FastAPI 500 surface as a generic "agent is offline" in the UI.
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Leave agent error: {type(ex).__name__}: {ex}",
        )

    out = reply.to_dict()
    out["session_id"] = conv.ID
    return out


@router.get("/conversations")
def list_conversations(
    employee_id: str,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """Most recent conversations for an employee — for showing history."""

    employee = require_employee(db, employee_id)

    rows = (
        db.query(AILeaveConversation)
        .filter(AILeaveConversation.EMPLOYEE_ID == employee.ID)
        .order_by(AILeaveConversation.ID.desc())
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return [_serialize_conv(r, include_messages=False) for r in rows]


@router.get("/conversations/{conv_id}")
def get_conversation(
    conv_id: int,
    db: Session = Depends(get_db),
):
    """One conversation including its full message log."""
    row = db.query(AILeaveConversation).filter(
        AILeaveConversation.ID == conv_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _serialize_conv(row, include_messages=True)


@router.post("/reset")
def reset(
    employee_id: str,
    db: Session = Depends(get_db),
):
    """Close any open conversation so the next /chat starts fresh."""
    employee = require_employee(db, employee_id)
    closed = 0
    rows = (
        db.query(AILeaveConversation)
        .filter(AILeaveConversation.EMPLOYEE_ID == employee.ID)
        .filter(AILeaveConversation.STATE.in_(["COLLECTING", "CONFIRMING"]))
        .all()
    )
    for r in rows:
        r.STATE = "CANCELLED"
        r.COMPLETED_AT = datetime.utcnow()
        r.RESULT_MESSAGE = "Reset by user"
        closed += 1
    db.commit()
    return {"closed": closed}


# ============================================================
# Helpers
# ============================================================

def _serialize_conv(r: AILeaveConversation, include_messages: bool) -> dict:
    try:
        collected = json.loads(r.COLLECTED_JSON) if r.COLLECTED_JSON else {}
    except Exception:
        collected = {}
    out = {
        "ID": r.ID,
        "EMPLOYEE_ID": r.EMPLOYEE_ID,
        "STATE": r.STATE,
        "INTENT": r.INTENT,
        "LEAVE_REQUEST_ID": r.LEAVE_REQUEST_ID,
        "RESULT_MESSAGE": r.RESULT_MESSAGE,
        "STARTED_AT":   r.STARTED_AT.isoformat()   if r.STARTED_AT   else None,
        "LAST_AT":      r.LAST_AT.isoformat()      if r.LAST_AT      else None,
        "COMPLETED_AT": r.COMPLETED_AT.isoformat() if r.COMPLETED_AT else None,
        "collected": collected,
    }
    if include_messages:
        try:
            msgs = json.loads(r.MESSAGES_JSON) if r.MESSAGES_JSON else []
        except Exception:
            msgs = []
        out["messages"] = msgs
    return out
