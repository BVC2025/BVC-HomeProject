"""
Leave Chatbot — natural-language frontend for /leave/apply.

Single endpoint: POST /leave-chatbot/message
  Body: { employee_id, message, state }
  Returns: { reply, state, ready_to_submit, validation, suggestions }

When ready_to_submit=true, the frontend posts the SAME state object
to the existing POST /leave/apply endpoint. This route does NOT
duplicate any submission/email logic — the existing endpoint owns
that workflow completely.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database.database import get_db

from app.models.models import Employee

from app.services.leave_chatbot_service import handle_message


router = APIRouter(prefix="/leave-chatbot", tags=["Leave Chatbot"])


class ChatBody(BaseModel):

    employee_id: str               # UUID or EMPLOYEE_CODE — both accepted
    message: str = ""
    state: Optional[dict] = None
    # state from previous turn — frontend echoes it back each call


@router.post("/message")
def chat_message(body: ChatBody, db: Session = Depends(get_db)):
    """Process one chat turn. Stateless — frontend owns the state dict."""

    if not body.employee_id:

        raise HTTPException(400, "employee_id is required")

    # Accept both UUID and EMPLOYEE_CODE — Employee Portal sends the code
    emp = (
        db.query(Employee)
        .filter(
            or_(
                Employee.ID == body.employee_id,
                Employee.EMPLOYEE_CODE == body.employee_id
            )
        )
        .first()
    )

    if not emp:

        raise HTTPException(404, "Employee not found")

    result = handle_message(
        db=db,
        employee=emp,
        message=body.message,
        prior_state=body.state or {}
    )

    # Attach the resolved employee UUID so the frontend can POST it to
    # /leave/apply without a second lookup
    result["employee_uuid"] = emp.ID

    result["employee_name"] = emp.NAME

    return result


@router.get("/greeting/{employee_id}")
def initial_greeting(employee_id: str, db: Session = Depends(get_db)):
    """First-load message + the employee's current balance — so the
    chatbot can open with personalised context."""

    emp = (
        db.query(Employee)
        .filter(
            or_(
                Employee.ID == employee_id,
                Employee.EMPLOYEE_CODE == employee_id
            )
        )
        .first()
    )

    if not emp:

        raise HTTPException(404, "Employee not found")

    from app.services.leave_service import get_or_create_balance, remaining_for_type

    bal = get_or_create_balance(db, emp.ID)

    cl = remaining_for_type(bal, "CASUAL")

    sl = remaining_for_type(bal, "SICK")

    el = remaining_for_type(bal, "EARNED")

    first_name = (emp.NAME or "there").split()[0]

    return {
        "employee_uuid": emp.ID,
        "employee_name": emp.NAME,
        "greeting": (
            f"Hi {first_name}! 👋 I'm your leave assistant. Tell me what "
            "you need in plain English — e.g. *'I need casual leave tomorrow for "
            "a family function'* — and I'll draft the request for you. Your "
            "balance: "
            f"**CL {cl}d** · **SL {sl}d** · **EL {el}d**."
        ),
        "balance": {
            "CASUAL":    cl,
            "SICK":      sl,
            "EARNED":    el,
            "MATERNITY": remaining_for_type(bal, "MATERNITY") if hasattr(bal, "MATERNITY_TOTAL") else 0
        },
        "suggestions": [
            "Casual leave tomorrow",
            "Sick leave today",
            "Earned leave next monday",
            "Half day on 10th"
        ]
    }
