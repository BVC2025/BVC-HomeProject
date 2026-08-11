"""
Help Desk — employee-submitted tickets.

Mounted at /helpdesk.

Employee endpoints:
  POST   /helpdesk                     — create a ticket (self only)
  GET    /helpdesk/my                  — list tickets for the given employee
  GET    /helpdesk/{ticket_id}         — detail (self or admin)

Admin endpoints:
  GET    /helpdesk/admin/list          — paginated + filtered list of ALL tickets
  GET    /helpdesk/admin/stats         — KPI tiles (total / open / in-progress / resolved / closed)
  PATCH  /helpdesk/{ticket_id}/status  — change status / assign / notes (any subset)
  PATCH  /helpdesk/{ticket_id}/assign  — set assignee only
  PATCH  /helpdesk/{ticket_id}/close   — mark CLOSED with optional resolution notes

Role gates:
  • Employee POST + /my        → self or admin (assert_self_or_admin)
  • GET /admin/*               → require("helpdesk.view.all")
  • PATCH /*                   → require("helpdesk.manage")
  • GET /{ticket_id}           → self or admin
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import HelpDeskTicket, Employee, Department
from app.auth.auth_bearer import (
    get_current_user,
    assert_self_or_admin,
    require,
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
    CATEGORY:    str = Field(min_length=1, max_length=30)
    SUBJECT:     str = Field(min_length=3, max_length=200)
    DESCRIPTION: Optional[str] = Field(default=None, max_length=4000)
    PRIORITY:    str = "MEDIUM"


class TicketStatusUpdate(BaseModel):
    STATUS:           Optional[str] = None
    ASSIGNED_TO_ID:   Optional[str] = None
    RESOLUTION_NOTES: Optional[str] = None
    INTERNAL_NOTES:   Optional[str] = None


class TicketAssign(BaseModel):
    ASSIGNED_TO_ID: str


class TicketClose(BaseModel):
    RESOLUTION_NOTES: Optional[str] = None


# =====================================================================
# Helpers
# =====================================================================

def _serialize(t: HelpDeskTicket, employee: Optional[Employee] = None,
               department_name: Optional[str] = None) -> dict:
    return {
        "ID":                 t.ID,
        "TICKET_NUMBER":      t.TICKET_NUMBER,
        "EMPLOYEE_ID":        t.EMPLOYEE_ID,
        "EMPLOYEE_NAME":      (employee.NAME if employee else None),
        "EMPLOYEE_CODE":      (employee.EMPLOYEE_CODE if employee else None),
        "DEPARTMENT":         department_name,
        "CATEGORY":           t.CATEGORY,
        "SUBJECT":            t.SUBJECT,
        "DESCRIPTION":        t.DESCRIPTION,
        "PRIORITY":           t.PRIORITY,
        "STATUS":             t.STATUS,
        "ASSIGNED_TO_ID":     t.ASSIGNED_TO_ID,
        "ASSIGNED_TO_NAME":   t.ASSIGNED_TO_NAME,
        "INTERNAL_NOTES":     t.INTERNAL_NOTES,
        "RESOLUTION_NOTES":   t.RESOLUTION_NOTES,
        "RESOLVED_AT":        t.RESOLVED_AT.isoformat() if t.RESOLVED_AT else None,
        "CLOSED_AT":          t.CLOSED_AT.isoformat() if t.CLOSED_AT else None,
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


def _department_name(db: Session, emp: Optional[Employee]) -> Optional[str]:
    if not emp or not getattr(emp, "DEPARTMENT_ID", None):
        return None
    dept = db.query(Department).filter(Department.ID == emp.DEPARTMENT_ID).first()
    if not dept:
        return None
    return getattr(dept, "NAME", None) or getattr(dept, "DEPARTMENT_NAME", None)


def _next_ticket_number(db: Session) -> str:
    """Format: HD-YYYY-MM-NNNN. Sequence resets each calendar month."""
    now = datetime.utcnow()
    prefix = f"HD-{now.year}-{now.month:02d}-"
    count = (
        db.query(HelpDeskTicket)
        .filter(HelpDeskTicket.TICKET_NUMBER.like(f"{prefix}%"))
        .count()
    )
    return f"{prefix}{(count + 1):04d}"


def _load_ticket(db: Session, ticket_id: int) -> HelpDeskTicket:
    ticket = db.query(HelpDeskTicket).filter(HelpDeskTicket.ID == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


def _serialize_with_join(db: Session, t: HelpDeskTicket) -> dict:
    emp = db.query(Employee).filter(Employee.ID == t.EMPLOYEE_ID).first()
    dept = _department_name(db, emp)
    return _serialize(t, employee=emp, department_name=dept)


# =====================================================================
# Employee endpoints
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
    if len(subject) < 3:
        raise HTTPException(status_code=400, detail="SUBJECT must be at least 3 characters")

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

    return _serialize_with_join(db, ticket)


@router.get("/my")
def list_my_tickets(
    employee_id: str,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Every ticket raised by a given employee, newest first."""

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
    dept = _department_name(db, emp)
    return [_serialize(t, employee=emp, department_name=dept) for t in rows]


# =====================================================================
# Admin endpoints
# =====================================================================

@router.get("/admin/stats")
def admin_stats(
    db: Session = Depends(get_db),
    _admin: dict = Depends(require("helpdesk.view.all")),
):
    """KPI counts for the admin dashboard tiles."""

    def _count(status: str) -> int:
        return (
            db.query(HelpDeskTicket)
            .filter(HelpDeskTicket.STATUS == status)
            .count()
        )

    total = db.query(HelpDeskTicket).count()
    return {
        "total":       total,
        "open":        _count("OPEN"),
        "in_progress": _count("IN_PROGRESS"),
        "resolved":    _count("RESOLVED"),
        "closed":      _count("CLOSED"),
        "rejected":    _count("REJECTED"),
    }


@router.get("/admin/list")
def admin_list(
    q:        Optional[str] = None,
    status:   Optional[str] = None,
    category: Optional[str] = None,
    priority: Optional[str] = None,
    sort:     str = Query("newest", pattern="^(newest|oldest|priority)$"),
    page:     int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    db:       Session = Depends(get_db),
    _admin:   dict = Depends(require("helpdesk.view.all")),
):
    """Paginated ticket list for the admin help-desk page."""

    query = db.query(HelpDeskTicket)

    if status:
        s = status.upper().strip()
        if s in VALID_STATUSES:
            query = query.filter(HelpDeskTicket.STATUS == s)

    if category:
        c = category.upper().strip()
        if c in VALID_CATEGORIES:
            query = query.filter(HelpDeskTicket.CATEGORY == c)

    if priority:
        p = priority.upper().strip()
        if p in VALID_PRIORITIES:
            query = query.filter(HelpDeskTicket.PRIORITY == p)

    if q:
        needle = f"%{q.strip()}%"
        # Match against subject / ticket number / assigned name.
        # Employee name is filtered post-serialization since it lives on Employee.
        query = query.filter(
            or_(
                HelpDeskTicket.TICKET_NUMBER.ilike(needle),
                HelpDeskTicket.SUBJECT.ilike(needle),
                HelpDeskTicket.ASSIGNED_TO_NAME.ilike(needle),
                HelpDeskTicket.DESCRIPTION.ilike(needle),
            )
        )

    # Sorting
    if sort == "oldest":
        query = query.order_by(HelpDeskTicket.ID.asc())
    elif sort == "priority":
        # URGENT > HIGH > MEDIUM > LOW, then newest
        from sqlalchemy import case
        priority_rank = case(
            {"URGENT": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3},
            value=HelpDeskTicket.PRIORITY,
            else_=4,
        )
        query = query.order_by(priority_rank.asc(), HelpDeskTicket.ID.desc())
    else:
        query = query.order_by(HelpDeskTicket.ID.desc())

    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()

    items = [_serialize_with_join(db, t) for t in rows]

    # Post-filter for employee-name search
    if q:
        needle_lc = q.strip().lower()
        items = [
            it for it in items
            if needle_lc in (it.get("SUBJECT") or "").lower()
            or needle_lc in (it.get("TICKET_NUMBER") or "").lower()
            or needle_lc in (it.get("ASSIGNED_TO_NAME") or "").lower()
            or needle_lc in (it.get("EMPLOYEE_NAME") or "").lower()
            or needle_lc in (it.get("EMPLOYEE_CODE") or "").lower()
            or needle_lc in (it.get("DESCRIPTION") or "").lower()
        ] or items  # if narrowing removes everything, keep DB-matched rows

    return {
        "items":     items,
        "page":      page,
        "page_size": page_size,
        "total":     total,
    }


# =====================================================================
# Detail — self or admin
# =====================================================================

@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Full ticket detail. Accessible to the ticket owner or admin."""

    ticket = _load_ticket(db, ticket_id)
    assert_self_or_admin(ticket.EMPLOYEE_ID, payload)
    return _serialize_with_join(db, ticket)


# =====================================================================
# Admin ticket actions
# =====================================================================

def _apply_status(ticket: HelpDeskTicket, new_status: str) -> None:
    new_status = (new_status or "").upper().strip()
    if new_status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"STATUS must be one of {sorted(VALID_STATUSES)}",
        )
    ticket.STATUS = new_status
    now = datetime.utcnow()
    if new_status in ("RESOLVED", "CLOSED"):
        ticket.RESOLVED_AT = ticket.RESOLVED_AT or now
    if new_status == "CLOSED":
        ticket.CLOSED_AT = ticket.CLOSED_AT or now


@router.patch("/{ticket_id}/status")
def update_ticket_status(
    ticket_id: int,
    data: TicketStatusUpdate,
    db: Session = Depends(get_db),
    _admin: dict = Depends(require("helpdesk.manage")),
):
    """Admin: transition status, assign, or attach notes.
    Any subset of fields may be supplied."""

    ticket = _load_ticket(db, ticket_id)

    if data.STATUS is not None:
        _apply_status(ticket, data.STATUS)

    if data.ASSIGNED_TO_ID is not None:
        emp = _resolve_employee(db, data.ASSIGNED_TO_ID)
        if not emp:
            raise HTTPException(status_code=400, detail="Invalid ASSIGNED_TO_ID")
        ticket.ASSIGNED_TO_ID = emp.ID
        ticket.ASSIGNED_TO_NAME = emp.NAME

    if data.RESOLUTION_NOTES is not None:
        ticket.RESOLUTION_NOTES = (data.RESOLUTION_NOTES or "").strip() or None

    if data.INTERNAL_NOTES is not None:
        ticket.INTERNAL_NOTES = (data.INTERNAL_NOTES or "").strip() or None

    db.commit()
    db.refresh(ticket)
    return _serialize_with_join(db, ticket)


@router.patch("/{ticket_id}/assign")
def assign_ticket(
    ticket_id: int,
    data: TicketAssign,
    db: Session = Depends(get_db),
    _admin: dict = Depends(require("helpdesk.manage")),
):
    """Assign the ticket to an admin/staff member."""

    ticket = _load_ticket(db, ticket_id)

    emp = _resolve_employee(db, data.ASSIGNED_TO_ID)
    if not emp:
        raise HTTPException(status_code=400, detail="Invalid ASSIGNED_TO_ID")

    ticket.ASSIGNED_TO_ID = emp.ID
    ticket.ASSIGNED_TO_NAME = emp.NAME

    # Auto-move an untouched OPEN ticket into IN_PROGRESS when an admin
    # picks it up. Idempotent for tickets already past OPEN.
    if ticket.STATUS == "OPEN":
        ticket.STATUS = "IN_PROGRESS"

    db.commit()
    db.refresh(ticket)
    return _serialize_with_join(db, ticket)


@router.patch("/{ticket_id}/close")
def close_ticket(
    ticket_id: int,
    data: TicketClose,
    db: Session = Depends(get_db),
    _admin: dict = Depends(require("helpdesk.manage")),
):
    """Close a ticket with optional resolution notes."""

    ticket = _load_ticket(db, ticket_id)

    if data.RESOLUTION_NOTES is not None:
        ticket.RESOLUTION_NOTES = (data.RESOLUTION_NOTES or "").strip() or None

    _apply_status(ticket, "CLOSED")

    db.commit()
    db.refresh(ticket)
    return _serialize_with_join(db, ticket)
