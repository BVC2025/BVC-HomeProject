"""
Employee Status Tracking — lifecycle workflow + audit trail.

Endpoints:
  PATCH /employees/{employee_id}/status
        Change an employee's status with a mandatory reason. Every
        change appends a row to employee_status_history.

  GET   /employees/{employee_id}/status-history
        Returns the full audit trail, newest first.

Status enum (string-typed for forward compatibility):
  ACTIVE         — default, currently employed
  ON_NOTICE      — resignation submitted, working notice period
  RESIGNED       — left voluntarily after notice
  TERMINATED     — involuntary exit
  RETIRED        — retirement
  ON_LEAVE_LONG  — extended leave (maternity, sabbatical, etc.)
"""

from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin, get_current_user
from app.models.models import (
    Employee, EmployeeStatusHistory, Notification,
)


router = APIRouter(tags=["employee-status"])


# =====================================================================
# Allowed transitions — enforced server-side so the UI can't silently
# create invalid lifecycle states.
# =====================================================================

ALLOWED_STATUSES = {
    "ACTIVE", "ON_NOTICE", "RESIGNED", "TERMINATED",
    "RETIRED", "ON_LEAVE_LONG",
}

# (from, to) pairs that HR is allowed to perform. The full DAG keeps
# the lifecycle predictable. Set to None to allow any-to-any.
ALLOWED_TRANSITIONS = {
    "ACTIVE":        {"ON_NOTICE", "TERMINATED", "RETIRED", "ON_LEAVE_LONG"},
    "ON_NOTICE":     {"RESIGNED", "TERMINATED", "ACTIVE"},   # ACTIVE = revoked resignation
    "ON_LEAVE_LONG": {"ACTIVE", "RESIGNED", "TERMINATED"},
    "RESIGNED":      {"ACTIVE"},     # Re-hire
    "TERMINATED":    {"ACTIVE"},     # Reinstatement after appeal
    "RETIRED":       {"ACTIVE"},     # Post-retirement rehire (consultant)
}


# =====================================================================
# Schemas
# =====================================================================


class StatusChangeIn(BaseModel):
    new_status: str = Field(..., description="One of: " + ", ".join(sorted(ALLOWED_STATUSES)))
    reason: str = Field(..., min_length=3, max_length=255)
    effective_date: Optional[date] = None
    notes: Optional[str] = None


class StatusHistoryRow(BaseModel):
    id: int
    employee_id: str
    old_status: Optional[str] = None
    new_status: str
    reason: str
    effective_date: date
    notes: Optional[str] = None
    changed_by_id: Optional[str] = None
    changed_by_name: Optional[str] = None
    changed_at: datetime


class StatusChangeOut(BaseModel):
    ok: bool
    employee_id: str
    old_status: Optional[str] = None
    new_status: str
    history_id: int


# =====================================================================
# Routes
# =====================================================================


def _resolve_employee(db: Session, ident: str) -> Employee:
    emp = (db.query(Employee)
           .filter((Employee.ID == ident) | (Employee.EMPLOYEE_CODE == ident))
           .first())
    if not emp:
        raise HTTPException(404, "Employee not found")
    return emp


@router.patch("/employees/{employee_id}/status", response_model=StatusChangeOut)
def change_status(employee_id: str, payload: StatusChangeIn,
                  db: Session = Depends(get_db),
                  user: dict = Depends(get_current_admin)):
    """Change an employee's lifecycle status. Admin only."""

    new_status = payload.new_status.upper().strip()
    if new_status not in ALLOWED_STATUSES:
        raise HTTPException(
            400,
            f"Invalid status '{new_status}'. Allowed: "
            f"{', '.join(sorted(ALLOWED_STATUSES))}"
        )

    emp = _resolve_employee(db, employee_id)
    old_status = (emp.STATUS or "ACTIVE").upper()

    if old_status == new_status:
        raise HTTPException(400, f"Employee already {new_status}.")

    # Enforce DAG transitions
    allowed_next = ALLOWED_TRANSITIONS.get(old_status, set())
    if new_status not in allowed_next:
        raise HTTPException(
            400,
            f"Cannot transition {old_status} → {new_status}. "
            f"Allowed from {old_status}: {', '.join(sorted(allowed_next)) or 'none'}"
        )

    eff = payload.effective_date or date.today()

    history = EmployeeStatusHistory(
        EMPLOYEE_ID=emp.ID,
        OLD_STATUS=old_status,
        NEW_STATUS=new_status,
        REASON=payload.reason.strip(),
        EFFECTIVE_DATE=eff,
        NOTES=(payload.notes or "").strip() or None,
        CHANGED_BY_ID=user.get("employee_id"),
        VENDOR_ID=emp.VENDOR_ID,
    )
    emp.STATUS = new_status

    db.add(history)
    db.flush()

    # Emit a notification so HR's bell icon picks it up
    db.add(Notification(
        TITLE=f"Status changed: {emp.NAME} → {new_status}",
        MESSAGE=(f"{old_status} → {new_status} · Effective {eff.isoformat()} · "
                 f"Reason: {payload.reason.strip()}")[:255],
        TYPE="EMPLOYEE_STATUS",
        VENDOR_ID=emp.VENDOR_ID,
    ))

    db.commit()
    db.refresh(history)
    return StatusChangeOut(
        ok=True, employee_id=emp.ID,
        old_status=old_status, new_status=new_status,
        history_id=history.ID,
    )


@router.get("/employees/{employee_id}/status-history",
            response_model=List[StatusHistoryRow])
def status_history(employee_id: str,
                   db: Session = Depends(get_db),
                   user: dict = Depends(get_current_user)):
    emp = _resolve_employee(db, employee_id)
    rows = (db.query(EmployeeStatusHistory)
            .filter(EmployeeStatusHistory.EMPLOYEE_ID == emp.ID)
            .order_by(EmployeeStatusHistory.CHANGED_AT.desc()).all())

    # Resolve actor names in one query
    actor_ids = {r.CHANGED_BY_ID for r in rows if r.CHANGED_BY_ID}
    actors = {}
    if actor_ids:
        for a in db.query(Employee).filter(Employee.ID.in_(actor_ids)).all():
            actors[a.ID] = a.NAME or a.EMPLOYEE_CODE or "—"

    return [StatusHistoryRow(
        id=r.ID, employee_id=r.EMPLOYEE_ID,
        old_status=r.OLD_STATUS, new_status=r.NEW_STATUS,
        reason=r.REASON, effective_date=r.EFFECTIVE_DATE,
        notes=r.NOTES, changed_by_id=r.CHANGED_BY_ID,
        changed_by_name=actors.get(r.CHANGED_BY_ID),
        changed_at=r.CHANGED_AT,
    ) for r in rows]


@router.get("/employees/status/allowed-transitions")
def allowed_transitions(user: dict = Depends(get_current_user)):
    """Returns the static lifecycle DAG so the UI can disable invalid options."""
    return {
        "statuses": sorted(ALLOWED_STATUSES),
        "transitions": {k: sorted(v) for k, v in ALLOWED_TRANSITIONS.items()},
    }
