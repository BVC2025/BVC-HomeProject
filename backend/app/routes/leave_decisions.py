"""
Leave Automation routes.

  POST /leave-ai/preview        — evaluate signals BEFORE submission
                                  (used by the leave form to show
                                   "Likely auto-approve / needs review")
  POST /leave-ai/evaluate/{id}  — evaluate an existing request, optionally
                                  apply the decision (stamp + balance moves +
                                  notifications)
  GET  /leave-ai/recommendations — manager queue: pending requests with
                                   their AI recommendation rendered inline
"""

from datetime import date
from typing import Optional, List
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin, get_current_user
from app.models.models import (
    Employee, LeaveRequest,
)
from app.services.leave_decision_service import (
    LeaveDecisionService, LeaveDecision,
)


router = APIRouter(prefix="/leave-ai", tags=["leave-ai"])


# =====================================================================
# Schemas
# =====================================================================


class LeavePreviewIn(BaseModel):
    employee_id: str
    leave_type: str = "CASUAL"   # CASUAL / SICK / EARNED / UNPAID / LOP / PERMISSION
    start_date: date
    end_date: date
    days: float = Field(gt=0)
    reason: Optional[str] = None


class DecisionOut(BaseModel):
    verdict: str
    confidence: float
    reason_summary: str
    blockers: List[str] = []
    warnings: List[str] = []
    signals: dict = {}


class PendingWithDecisionOut(BaseModel):
    leave_request_id: int
    employee_id: str
    employee_code: Optional[str] = None
    employee_name: str
    leave_type: Optional[str] = None
    start_date: date
    end_date: date
    days: float
    reason: Optional[str] = None
    status: str
    decision: DecisionOut


# =====================================================================
# Routes
# =====================================================================


@router.post("/preview", response_model=DecisionOut)
def preview(payload: LeavePreviewIn,
            db: Session = Depends(get_db),
            user: dict = Depends(get_current_user)):
    """Evaluate a hypothetical leave request WITHOUT saving anything.
    Use this from the leave form so the employee sees the AI verdict
    before clicking Submit."""
    emp = (db.query(Employee)
           .filter((Employee.ID == payload.employee_id) |
                   (Employee.EMPLOYEE_CODE == payload.employee_id)).first())
    if not emp:
        raise HTTPException(404, "Employee not found")

    fake = LeaveRequest(
        EMPLOYEE_ID=emp.ID,
        LEAVE_TYPE=payload.leave_type.upper(),
        START_DATE=payload.start_date, END_DATE=payload.end_date,
        DAYS=payload.days, REASON=payload.reason,
        VENDOR_ID=emp.VENDOR_ID,
    )

    svc = LeaveDecisionService(db)
    d = svc.evaluate(fake)
    return DecisionOut(**d.to_dict())


@router.post("/evaluate/{leave_id}", response_model=DecisionOut)
def evaluate(leave_id: int,
             apply: bool = Query(False, description="Stamp the decision onto the LeaveRequest"),
             db: Session = Depends(get_db),
             user: dict = Depends(get_current_admin)):
    req = db.get(LeaveRequest, leave_id)
    if not req:
        raise HTTPException(404, "Leave request not found")

    svc = LeaveDecisionService(db)
    d = svc.evaluate(req)
    if apply:
        svc.apply(req, d, actor_employee_id=user.get("employee_id"))
        db.commit()
    return DecisionOut(**d.to_dict())


@router.get("/recommendations", response_model=List[PendingWithDecisionOut])
def recommendations(limit: int = 50,
                    db: Session = Depends(get_db),
                    user: dict = Depends(get_current_user)):
    """Manager queue. Returns all PENDING_APPROVAL requests with their
    AI verdict + reasoning rendered inline."""
    vendor_id = user.get("vendor_id", 1)
    rows = (db.query(LeaveRequest, Employee)
            .join(Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID)
            .filter(LeaveRequest.VENDOR_ID == vendor_id,
                    LeaveRequest.STATUS == "PENDING_APPROVAL")
            .order_by(LeaveRequest.CREATED_AT.desc()).limit(limit).all())

    svc = LeaveDecisionService(db)
    out = []
    for r, e in rows:
        d = svc.evaluate(r)
        out.append(PendingWithDecisionOut(
            leave_request_id=r.ID, employee_id=e.ID,
            employee_code=e.EMPLOYEE_CODE, employee_name=e.NAME or "",
            leave_type=r.LEAVE_TYPE,
            start_date=r.START_DATE, end_date=r.END_DATE,
            days=float(r.DAYS or 0), reason=r.REASON, status=r.STATUS,
            decision=DecisionOut(**d.to_dict()),
        ))
    return out


@router.post("/bulk-auto-approve")
def bulk_auto_approve(db: Session = Depends(get_db),
                      user: dict = Depends(get_current_admin)):
    """Sweep all PENDING_APPROVAL requests and apply the AI decision where
    verdict == AUTO_APPROVE. Anything needing humans is left untouched.
    Useful as a cron or one-click HR action."""
    vendor_id = user.get("vendor_id", 1)
    rows = (db.query(LeaveRequest)
            .filter(LeaveRequest.VENDOR_ID == vendor_id,
                    LeaveRequest.STATUS == "PENDING_APPROVAL").all())
    svc = LeaveDecisionService(db)
    approved = 0
    flagged = 0
    untouched = 0
    for r in rows:
        d = svc.evaluate(r)
        if d.verdict == "AUTO_APPROVE":
            svc.apply(r, d, actor_employee_id=user.get("employee_id"))
            approved += 1
        elif d.verdict in ("RECOMMEND_REJECT", "NEEDS_HUMAN"):
            # Don't reject automatically — leave the row alone and emit
            # a Notification with the reason so the manager sees it.
            svc.apply(r, d, actor_employee_id=user.get("employee_id"))
            flagged += 1
        else:
            untouched += 1
    db.commit()
    return {
        "scanned": len(rows),
        "auto_approved": approved,
        "flagged_for_human": flagged,
        "untouched": untouched,
    }
