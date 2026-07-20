"""
Help Desk — employee-submitted tickets.

Endpoints (mounted at /helpdesk):
  POST /helpdesk                  — create a ticket (self only)
  GET  /helpdesk/my               — list tickets for the current employee
  GET  /helpdesk/{ticket_id}      — detail (self or admin)
  PATCH /helpdesk/{ticket_id}/status  — admin: change status / assign / resolve

Employees can only see and act on their own tickets. Admin routes
are gated on get_current_admin; everything else uses assert_self_or_admin
so the same helpers work for the admin app when someone browses a
subordinate's tickets.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import HelpDeskTicket, Employee
from app.auth.auth_bearer import (
    get_current_user,
    get_current_admin,
    assert_self_or_admin,
)


router = APIRouter(prefix="/helpdesk", tags=["Help Desk"])


# =====================================================================
# Constants
# =====================================================================

VALID_CATEGORIES = {
    "COMPLAINT", "IT_REQUEST", "HR_REQUEST", "MAINTENANCE", "OTHER",
}

VALID_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "URGENT"}

VALID_STATUSES = {
    "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED", "REJECTED",
}


# =====================================================================
# Schemas
# =====================================================================

class TicketCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    EMPLOYEE_ID: str
    CATEGORY: str = Field(min_length=1, max_length=30)
    SUBJECT: str = Field(min_length=1, max_length=200)
    DESCRIPTION: Optional[str] = None
    PRIORITY: str = "MEDIUM"


class TicketStatusUpdate(BaseModel):
    STATUS: Optional[str] = None
    ASSIGNED_TO_ID: Optional[str] = None
    RESOLUTION_NOTES: Optional[str] = None


# =====================================================================
# Helpers
# =====================================================================

def _serialize(t: HelpDeskTicket) -> dict:
    return {
        "ID":                 t.ID,
        "TICKET_NUMBER":      t.TICKET_NUMBER,
        "EMPLOYEE_ID":        t.EMPLOYEE_ID,
        "CATEGORY":           t.CATEGORY,
        "SUBJECT":            t.SUBJECT,
        "DESCRIPTION":        t.DESCRIPTION,
        "PRIORITY":           t.PRIORITY,
        "STATUS":             t.STATUS,
        "ASSIGNED_TO_ID":     t.ASSIGNED_TO_ID,
        "ASSIGNED_TO_NAME":   t.ASSIGNED_TO_NAME,
        "RESOLUTION_NOTES":   t.RESOLUTION_NOTES,
        "RESOLVED_AT":        t.RESOLVED_AT.isoformat() if t.RESOLVED_AT else None,
        "VENDOR_ID":          t.VENDOR_ID,
        "CREATED_AT":         t.CREATED_AT.isoformat() if t.CREATED_AT else None,
        "UPDATED_AT":         t.UPDATED_AT.isoformat() if t.UPDATED_AT else None,
    }


def _resolve_employee(db: Session, ident: str) -> Optional[Employee]:
    """Accepts either UUID or EMPLOYEE_CODE."""
    if not ident:
        return None
    return (
        db.query(Employee)
        .filter(
            (Employee.ID == ident) | (Employee.EMPLOYEE_CODE == ident)
        )
        .first()
    )


def _next_ticket_number(db: Session) -> str:
    """Format: HD-YYYY-MM-NNNN. Sequence resets each calendar month.
    Uses a simple count-of-rows-for-month approach which is fine at
    BVC's scale (bulk creation is not a concern)."""

    now = datetime.utcnow()
    year_month = f"HD-{now.year}-{now.month:02d}-"

    count = (
        db.query(HelpDeskTicket)
        .filter(HelpDeskTicket.TICKET_NUMBER.like(f"{year_month}%"))
        .count()
    )
    return f"{year_month}{(count + 1):04d}"


# =====================================================================
# Endpoints
# =====================================================================

@router.post("")
def create_ticket(
    data: TicketCreate,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Employees create tickets for themselves; admins may create on
    behalf of another employee."""

    assert_self_or_admin(data.EMPLOYEE_ID, payload)

    emp = _resolve_employee(db, data.EMPLOYEE_ID)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    category = (data.CATEGORY or "").upper().strip()
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"CATEGORY must be one of {sorted(VALID_CATEGORIES)}",
        )

    priority = (data.PRIORITY or "MEDIUM").upper().strip()
    if priority not in VALID_PRIORITIES:
        priority = "MEDIUM"

    subject = (data.SUBJECT or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="SUBJECT is required")

    ticket = HelpDeskTicket(
        TICKET_NUMBER=_next_ticket_number(db),
        EMPLOYEE_ID=emp.ID,
        CATEGORY=category,
        SUBJECT=subject,
        DESCRIPTION=(data.DESCRIPTION or "").strip() or None,
        PRIORITY=priority,
        STATUS="OPEN",
        VENDOR_ID=emp.VENDOR_ID or 1,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    return _serialize(ticket)


@router.get("/my")
def list_my_tickets(
    employee_id: str,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """List every ticket for a given employee, newest first."""

    assert_self_or_admin(employee_id, payload)

    emp = _resolve_employee(db, employee_id)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    rows = (
        db.query(HelpDeskTicket)
        .filter(HelpDeskTicket.EMPLOYEE_ID == emp.ID)
        .order_by(HelpDeskTicket.ID.desc())
        .all()
    )
    return [_serialize(t) for t in rows]


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Full ticket detail. Only accessible to the ticket owner or admin."""

    ticket = db.query(HelpDeskTicket).filter(HelpDeskTicket.ID == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    assert_self_or_admin(ticket.EMPLOYEE_ID, payload)

    return _serialize(ticket)


@router.patch("/{ticket_id}/status")
def update_ticket_status(
    ticket_id: int,
    data: TicketStatusUpdate,
    db: Session = Depends(get_db),
    _admin: dict = Depends(get_current_admin),
):
    """Admin: transition status, assign, or attach resolution notes.
    Any subset of fields may be supplied."""

    ticket = db.query(HelpDeskTicket).filter(HelpDeskTicket.ID == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if data.STATUS is not None:
        new_status = data.STATUS.upper().strip()
        if new_status not in VALID_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"STATUS must be one of {sorted(VALID_STATUSES)}",
            )
        ticket.STATUS = new_status
        if new_status in ("RESOLVED", "CLOSED"):
            ticket.RESOLVED_AT = ticket.RESOLVED_AT or datetime.utcnow()

    if data.ASSIGNED_TO_ID is not None:
        emp = _resolve_employee(db, data.ASSIGNED_TO_ID)
        if not emp:
            raise HTTPException(status_code=400, detail="Invalid ASSIGNED_TO_ID")
        ticket.ASSIGNED_TO_ID = emp.ID
        ticket.ASSIGNED_TO_NAME = emp.NAME

    if data.RESOLUTION_NOTES is not None:
        ticket.RESOLUTION_NOTES = data.RESOLUTION_NOTES.strip() or None

    db.commit()
    db.refresh(ticket)

    return _serialize(ticket)
