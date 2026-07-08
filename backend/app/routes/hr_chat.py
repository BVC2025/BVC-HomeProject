"""
HR Chat Assistant — unified Phase-1 employee self-service endpoint.

Covers all Phase-1 AI Employee Assistant intents:
  - Leave Request (delegates to LeaveAgent)
  - Leave Balance / Status
  - Attendance Query
  - Salary Slip Request
  - Employee Information
  - HR Policy Q&A
  - Holiday Calendar

  POST /hr-assistant/chat   { EMPLOYEE_ID, MESSAGE, SESSION_ID? }
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.services.hr_assistant_service import HRAssistant
from app.utils.employee_resolver import require_employee


router = APIRouter(prefix="/hr-assistant", tags=["HR Assistant"])


class ChatRequest(BaseModel):
    EMPLOYEE_ID: str = Field(..., description="UUID or EMPLOYEE_CODE")
    MESSAGE:     str = Field(..., min_length=1, max_length=2000)
    SESSION_ID:  Optional[int] = None


@router.post("/chat")
def chat(body: ChatRequest, db: Session = Depends(get_db)):
    employee = require_employee(db, body.EMPLOYEE_ID)
    assistant = HRAssistant(db=db, employee=employee)
    try:
        reply = assistant.handle_message(body.MESSAGE, session_id=body.SESSION_ID)
    except Exception as ex:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"HR assistant error: {type(ex).__name__}: {ex}",
        )
    return reply.to_dict()
