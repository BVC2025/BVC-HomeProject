"""Shift Management routes.

Admins define reusable ShiftTemplate rows (name + times + break etc.)
and then assign one ShiftAssignment per (employee, date) via the
calendar. There is no ShiftChangeRequest surface — this build assumes
admins own scheduling and employees just follow.

Endpoints
---------
Templates
  GET    /shifts?active_only=bool
  POST   /shifts
  PATCH  /shifts/{shift_id}
  DELETE /shifts/{shift_id}       (soft: sets IS_ACTIVE=False if
                                   any assignments reference it,
                                   otherwise hard delete)

Assignments (calendar)
  GET    /shifts/schedule/range?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
  POST   /shifts/schedule/assign
  DELETE /shifts/schedule/{assignment_id}
  POST   /shifts/schedule/auto-fill
  POST   /shifts/schedule/bulk
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Employee
from app.models.shift_models import ShiftTemplate, ShiftAssignment


router = APIRouter()


# =====================================================================
# Pydantic schemas
# =====================================================================

class ShiftIn(BaseModel):
    SHIFT_CODE: Optional[str] = None
    NAME: str
    START_TIME: str                             # "HH:MM" or "HH:MM:SS"
    END_TIME: str
    CROSS_MIDNIGHT: bool = False
    BREAK_MINUTES: int = 60
    CATEGORY: Optional[str] = None
    IS_NIGHT: bool = False
    NIGHT_ALLOWANCE_PCT: float = 0.0
    FLEX_WINDOW_MINUTES: int = 0
    COLOR: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    IS_ACTIVE: bool = True


class AssignIn(BaseModel):
    EMPLOYEE_ID: str
    SHIFT_ID: Optional[str] = None              # None → mark OFF
    SHIFT_DATE: str                             # YYYY-MM-DD
    NOTES: Optional[str] = None


class AutoFillIn(BaseModel):
    FROM_DATE: str
    TO_DATE: str
    SKIP_WEEKENDS: bool = True
    DEFAULT_SHIFT_ID: Optional[str] = None      # explicit override


class BulkIn(BaseModel):
    EMPLOYEE_IDS: List[str] = Field(default_factory=list)
    SHIFT_ID: Optional[str] = None
    FROM_DATE: str
    TO_DATE: str
    SKIP_WEEKENDS: bool = True
    OVERWRITE: bool = False


# =====================================================================
# Helpers
# =====================================================================

def _parse_time(s: str) -> time:
    if not s:
        raise HTTPException(400, "Time must be HH:MM.")
    parts = s.strip().split(":")
    try:
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError
        return time(h, m)
    except (ValueError, IndexError):
        raise HTTPException(400, f"Time '{s}' is not in HH:MM format.")


def _parse_date(s: str, field: str) -> date:
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{field} must be YYYY-MM-DD.")


def _serialise_shift(s: ShiftTemplate) -> Dict[str, Any]:
    return {
        "ID":                  s.ID,
        "SHIFT_CODE":          s.SHIFT_CODE,
        "NAME":                s.NAME,
        "START_TIME":          s.START_TIME.strftime("%H:%M") if s.START_TIME else None,
        "END_TIME":            s.END_TIME.strftime("%H:%M")   if s.END_TIME   else None,
        "CROSS_MIDNIGHT":      bool(s.CROSS_MIDNIGHT),
        "BREAK_MINUTES":       int(s.BREAK_MINUTES or 0),
        "CATEGORY":            s.CATEGORY,
        "IS_NIGHT":            bool(s.IS_NIGHT),
        "NIGHT_ALLOWANCE_PCT": float(s.NIGHT_ALLOWANCE_PCT or 0),
        "FLEX_WINDOW_MINUTES": int(s.FLEX_WINDOW_MINUTES or 0),
        "COLOR":               s.COLOR,
        "DESCRIPTION":         s.DESCRIPTION,
        "IS_ACTIVE":           bool(s.IS_ACTIVE),
        "CREATED_AT":          s.CREATED_AT.isoformat() if s.CREATED_AT else None,
    }


def _serialise_assignment(
    a: ShiftAssignment,
    shift: Optional[ShiftTemplate] = None,
) -> Dict[str, Any]:
    return {
        "ID":          a.ID,
        "EMPLOYEE_ID": a.EMPLOYEE_ID,
        "SHIFT_ID":    a.SHIFT_ID,
        "SHIFT_DATE":  a.SHIFT_DATE.isoformat() if a.SHIFT_DATE else None,
        "NOTES":       a.NOTES,
        "SHIFT_CODE":  shift.SHIFT_CODE if shift else None,
        "SHIFT_NAME":  shift.NAME if shift else None,
        "START_TIME":  shift.START_TIME.strftime("%H:%M") if shift and shift.START_TIME else None,
        "END_TIME":    shift.END_TIME.strftime("%H:%M")   if shift and shift.END_TIME   else None,
        "COLOR":       shift.COLOR if shift else None,
    }


def _default_vendor_id(db: Session) -> Optional[int]:
    row = db.query(Employee.VENDOR_ID).first()
    return row[0] if row else None


# =====================================================================
# Shift templates
# =====================================================================

@router.get("")
def list_shifts(
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:

    q = db.query(ShiftTemplate)
    if active_only:
        q = q.filter(ShiftTemplate.IS_ACTIVE.is_(True))
    rows = q.order_by(ShiftTemplate.NAME.asc()).all()
    return [_serialise_shift(s) for s in rows]


@router.post("")
def create_shift(
    payload: ShiftIn,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:

    start = _parse_time(payload.START_TIME)
    end   = _parse_time(payload.END_TIME)

    if not payload.CROSS_MIDNIGHT and start >= end:
        raise HTTPException(
            400,
            "END_TIME must be after START_TIME. Tick 'crosses midnight' "
            "for shifts that end the next day.",
        )

    code = (payload.SHIFT_CODE or "").strip() or None
    name = (payload.NAME or "").strip()
    if not name:
        raise HTTPException(400, "NAME is required.")

    # Uniqueness applies only against ACTIVE shifts — deactivated
    # (soft-deleted) rows are kept for audit but shouldn't block a
    # fresh template with the same name/code.
    exists = (
        db.query(ShiftTemplate.ID)
        .filter(
            ShiftTemplate.NAME == name,
            ShiftTemplate.IS_ACTIVE.is_(True),
        )
        .first()
    )
    if exists:
        raise HTTPException(400, f"An active shift named '{name}' already exists.")

    if code:
        code_dup = (
            db.query(ShiftTemplate.ID)
            .filter(
                ShiftTemplate.SHIFT_CODE == code,
                ShiftTemplate.IS_ACTIVE.is_(True),
            )
            .first()
        )
        if code_dup:
            raise HTTPException(400, f"An active shift with code '{code}' already exists.")

    s = ShiftTemplate(
        SHIFT_CODE          = code,
        NAME                = name,
        START_TIME          = start,
        END_TIME            = end,
        CROSS_MIDNIGHT      = bool(payload.CROSS_MIDNIGHT),
        BREAK_MINUTES       = int(payload.BREAK_MINUTES or 0),
        CATEGORY            = (payload.CATEGORY or "").strip() or None,
        IS_NIGHT            = bool(payload.IS_NIGHT),
        NIGHT_ALLOWANCE_PCT = float(payload.NIGHT_ALLOWANCE_PCT or 0),
        FLEX_WINDOW_MINUTES = int(payload.FLEX_WINDOW_MINUTES or 0),
        COLOR               = (payload.COLOR or "").strip() or None,
        DESCRIPTION         = (payload.DESCRIPTION or "").strip() or None,
        IS_ACTIVE           = bool(payload.IS_ACTIVE),
        VENDOR_ID           = _default_vendor_id(db),
    )
    db.add(s)
    db.commit()
    db.refresh(s)

    return _serialise_shift(s)


@router.patch("/{shift_id}")
def update_shift(
    shift_id: str,
    payload: ShiftIn,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:

    s = db.query(ShiftTemplate).filter(ShiftTemplate.ID == shift_id).first()
    if not s:
        raise HTTPException(404, "Shift not found.")

    start = _parse_time(payload.START_TIME)
    end   = _parse_time(payload.END_TIME)

    if not payload.CROSS_MIDNIGHT and start >= end:
        raise HTTPException(
            400,
            "END_TIME must be after START_TIME (unless it crosses midnight).",
        )

    code = (payload.SHIFT_CODE or "").strip() or None
    name = (payload.NAME or "").strip()
    if not name:
        raise HTTPException(400, "NAME is required.")

    dup = (
        db.query(ShiftTemplate.ID)
        .filter(
            ShiftTemplate.NAME == name,
            ShiftTemplate.ID != shift_id,
            ShiftTemplate.IS_ACTIVE.is_(True),
        )
        .first()
    )
    if dup:
        raise HTTPException(400, f"Another active shift is already named '{name}'.")

    if code:
        code_dup = (
            db.query(ShiftTemplate.ID)
            .filter(
                ShiftTemplate.SHIFT_CODE == code,
                ShiftTemplate.ID != shift_id,
                ShiftTemplate.IS_ACTIVE.is_(True),
            )
            .first()
        )
        if code_dup:
            raise HTTPException(400, f"Another active shift already uses code '{code}'.")

    s.SHIFT_CODE          = code
    s.NAME                = name
    s.START_TIME          = start
    s.END_TIME            = end
    s.CROSS_MIDNIGHT      = bool(payload.CROSS_MIDNIGHT)
    s.BREAK_MINUTES       = int(payload.BREAK_MINUTES or 0)
    s.CATEGORY            = (payload.CATEGORY or "").strip() or None
    s.IS_NIGHT            = bool(payload.IS_NIGHT)
    s.NIGHT_ALLOWANCE_PCT = float(payload.NIGHT_ALLOWANCE_PCT or 0)
    s.FLEX_WINDOW_MINUTES = int(payload.FLEX_WINDOW_MINUTES or 0)
    s.COLOR               = (payload.COLOR or "").strip() or None
    s.DESCRIPTION         = (payload.DESCRIPTION or "").strip() or None
    s.IS_ACTIVE           = bool(payload.IS_ACTIVE)

    db.commit()
    db.refresh(s)

    return _serialise_shift(s)


@router.delete("/{shift_id}")
def delete_shift(shift_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:

    s = db.query(ShiftTemplate).filter(ShiftTemplate.ID == shift_id).first()
    if not s:
        raise HTTPException(404, "Shift not found.")

    # Soft-delete if any assignments still reference it, so the
    # calendar doesn't lose historical data. Otherwise hard-delete.
    ref_count = (
        db.query(ShiftAssignment.ID)
        .filter(ShiftAssignment.SHIFT_ID == shift_id)
        .count()
    )

    if ref_count > 0:
        s.IS_ACTIVE = False
        db.commit()
        return {
            "ok": True,
            "soft_deleted": True,
            "reference_count": ref_count,
        }

    db.delete(s)
    db.commit()
    return {"ok": True, "soft_deleted": False}


# =====================================================================
# Assignments
# =====================================================================

@router.get("/schedule/range")
def list_assignments(
    from_date: str = Query(...),
    to_date:   str = Query(...),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:

    fr = _parse_date(from_date, "from_date")
    to = _parse_date(to_date,   "to_date")

    if fr > to:
        raise HTTPException(400, "from_date must be on or before to_date.")

    rows = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.SHIFT_DATE >= fr,
            ShiftAssignment.SHIFT_DATE <= to,
        )
        .all()
    )

    # Preload shift templates so the calendar can render each cell
    # with its code + colour without an N+1 query.
    shift_ids = {a.SHIFT_ID for a in rows if a.SHIFT_ID}
    templates = (
        db.query(ShiftTemplate).filter(ShiftTemplate.ID.in_(shift_ids)).all()
        if shift_ids else []
    )
    by_id = {t.ID: t for t in templates}

    return [_serialise_assignment(a, by_id.get(a.SHIFT_ID)) for a in rows]


@router.post("/schedule/assign")
def assign_shift(
    payload: AssignIn,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Upsert a single (employee, date) slot. NULL SHIFT_ID marks OFF."""

    emp = db.query(Employee).filter(Employee.ID == payload.EMPLOYEE_ID).first()
    if not emp:
        raise HTTPException(404, "Employee not found.")

    sd = _parse_date(payload.SHIFT_DATE, "SHIFT_DATE")

    if payload.SHIFT_ID:
        s = db.query(ShiftTemplate).filter(ShiftTemplate.ID == payload.SHIFT_ID).first()
        if not s:
            raise HTTPException(404, "Shift template not found.")

    # Delete-then-insert for the (EMPLOYEE_ID, SHIFT_DATE) slot.
    (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == emp.ID,
            ShiftAssignment.SHIFT_DATE  == sd,
        )
        .delete(synchronize_session=False)
    )

    a = ShiftAssignment(
        EMPLOYEE_ID = emp.ID,
        SHIFT_ID    = payload.SHIFT_ID or None,
        SHIFT_DATE  = sd,
        NOTES       = (payload.NOTES or "").strip() or None,
        VENDOR_ID   = emp.VENDOR_ID,
    )
    db.add(a)
    db.commit()
    db.refresh(a)

    tmpl = (
        db.query(ShiftTemplate).filter(ShiftTemplate.ID == a.SHIFT_ID).first()
        if a.SHIFT_ID else None
    )
    return _serialise_assignment(a, tmpl)


@router.delete("/schedule/{assignment_id}")
def clear_assignment(assignment_id: str, db: Session = Depends(get_db)) -> Dict[str, Any]:

    a = db.query(ShiftAssignment).filter(ShiftAssignment.ID == assignment_id).first()
    if not a:
        raise HTTPException(404, "Assignment not found.")

    db.delete(a)
    db.commit()
    return {"ok": True, "id": assignment_id}


def _pick_default_shift(db: Session) -> Optional[ShiftTemplate]:
    """Fallback default: the earliest-created active shift."""
    return (
        db.query(ShiftTemplate)
        .filter(ShiftTemplate.IS_ACTIVE.is_(True))
        .order_by(ShiftTemplate.CREATED_AT.asc())
        .first()
    )


@router.post("/schedule/auto-fill")
def auto_fill(
    payload: AutoFillIn,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Fill every UNASSIGNED day in the range using the default active
    shift. Never overwrites existing assignments — a re-run is a no-op."""

    fr = _parse_date(payload.FROM_DATE, "FROM_DATE")
    to = _parse_date(payload.TO_DATE,   "TO_DATE")

    if fr > to:
        raise HTTPException(400, "FROM_DATE must be on or before TO_DATE.")

    if payload.DEFAULT_SHIFT_ID:
        default_shift = (
            db.query(ShiftTemplate)
            .filter(ShiftTemplate.ID == payload.DEFAULT_SHIFT_ID)
            .first()
        )
    else:
        default_shift = _pick_default_shift(db)

    if not default_shift:
        raise HTTPException(
            400,
            "No active shift template to auto-fill with. Create at least "
            "one active shift first.",
        )

    employees = (
        db.query(Employee)
        .filter((Employee.STATUS.is_(None)) | (Employee.STATUS == "ACTIVE"))
        .all()
    )

    # Preload existing (emp, date) pairs in the window so we skip in
    # constant time instead of per-cell query.
    existing = {
        (a.EMPLOYEE_ID, a.SHIFT_DATE)
        for a in (
            db.query(ShiftAssignment.EMPLOYEE_ID, ShiftAssignment.SHIFT_DATE)
            .filter(
                ShiftAssignment.SHIFT_DATE >= fr,
                ShiftAssignment.SHIFT_DATE <= to,
            )
            .all()
        )
    }

    created = 0
    skipped_existing = 0
    skipped_weekend = 0

    d = fr
    while d <= to:
        if payload.SKIP_WEEKENDS and d.weekday() == 6:      # Sunday only
            skipped_weekend += 1
            d = d + timedelta(days=1)
            continue

        for emp in employees:
            if (emp.ID, d) in existing:
                skipped_existing += 1
                continue

            db.add(ShiftAssignment(
                EMPLOYEE_ID = emp.ID,
                SHIFT_ID    = default_shift.ID,
                SHIFT_DATE  = d,
                VENDOR_ID   = emp.VENDOR_ID,
            ))
            existing.add((emp.ID, d))
            created += 1

        d = d + timedelta(days=1)

    db.commit()

    return {
        "created":              created,
        "skipped_existing":     skipped_existing,
        "skipped_weekend":      skipped_weekend,
        "default_shift_id":     default_shift.ID,
        "default_shift_name":   default_shift.NAME,
    }


# =====================================================================
# Employee self-portal endpoints
# ---------------------------------------------------------------------
# Employees see their own shift schedule via these read-only endpoints.
# All are scoped to the employee_id in the query string / path — we
# don't have a JWT-derived identity on the portal today, so this
# matches the existing pattern used by /leave/my-requests etc.
# =====================================================================

def _resolve_employee(db: Session, ident: str) -> Optional[Employee]:
    """Accept UUID or EMPLOYEE_CODE (BVC008 style) — same tolerant
    resolver used by leave-ai-chat, so the employee-portal cache key
    can be either form."""
    if not ident:
        return None
    e = db.query(Employee).filter(Employee.ID == ident).first()
    if e:
        return e
    return db.query(Employee).filter(Employee.EMPLOYEE_CODE == ident).first()


@router.get("/my/current")
def my_shift_today(
    employee_id: str = Query(...),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Today's shift for the employee. Returns { assignment, shift }
    or { shift: null } if it's an OFF day / unassigned."""

    emp = _resolve_employee(db, employee_id)
    if not emp:
        raise HTTPException(404, "Employee not found.")

    today = date.today()
    a = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == emp.ID,
            ShiftAssignment.SHIFT_DATE == today,
        )
        .first()
    )
    tmpl = (
        db.query(ShiftTemplate).filter(ShiftTemplate.ID == a.SHIFT_ID).first()
        if a and a.SHIFT_ID else None
    )

    return {
        "employee": {"id": emp.ID, "code": emp.EMPLOYEE_CODE, "name": emp.NAME or ""},
        "date":     today.isoformat(),
        "assignment": _serialise_assignment(a, tmpl) if a else None,
    }


@router.get("/my/range")
def my_shifts_range(
    employee_id: str = Query(...),
    from_date:   str = Query(...),
    to_date:     str = Query(...),
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Employee's shifts in a date range — for the mini-calendar in
    the self-portal."""

    emp = _resolve_employee(db, employee_id)
    if not emp:
        raise HTTPException(404, "Employee not found.")

    fr = _parse_date(from_date, "from_date")
    to = _parse_date(to_date,   "to_date")
    if fr > to:
        raise HTTPException(400, "from_date must be on or before to_date.")

    rows = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == emp.ID,
            ShiftAssignment.SHIFT_DATE >= fr,
            ShiftAssignment.SHIFT_DATE <= to,
        )
        .order_by(ShiftAssignment.SHIFT_DATE.asc())
        .all()
    )

    shift_ids = {a.SHIFT_ID for a in rows if a.SHIFT_ID}
    templates = (
        db.query(ShiftTemplate).filter(ShiftTemplate.ID.in_(shift_ids)).all()
        if shift_ids else []
    )
    by_id = {t.ID: t for t in templates}

    return [_serialise_assignment(a, by_id.get(a.SHIFT_ID)) for a in rows]


@router.get("/my/upcoming")
def my_upcoming_shifts(
    employee_id: str = Query(...),
    days: int = Query(14, ge=1, le=60),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """The next N days of the employee's schedule + a small summary
    (shifts count by type). Powers the top card on the self-portal."""

    emp = _resolve_employee(db, employee_id)
    if not emp:
        raise HTTPException(404, "Employee not found.")

    today = date.today()
    end = today + timedelta(days=days - 1)

    rows = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == emp.ID,
            ShiftAssignment.SHIFT_DATE >= today,
            ShiftAssignment.SHIFT_DATE <= end,
        )
        .order_by(ShiftAssignment.SHIFT_DATE.asc())
        .all()
    )

    shift_ids = {a.SHIFT_ID for a in rows if a.SHIFT_ID}
    templates = (
        db.query(ShiftTemplate).filter(ShiftTemplate.ID.in_(shift_ids)).all()
        if shift_ids else []
    )
    by_id = {t.ID: t for t in templates}

    # Summary: count shifts per template code (or "OFF" when SHIFT_ID null).
    summary: Dict[str, int] = {}
    for a in rows:
        key = "OFF"
        if a.SHIFT_ID and a.SHIFT_ID in by_id:
            t = by_id[a.SHIFT_ID]
            key = t.SHIFT_CODE or t.NAME or "SHIFT"
        summary[key] = summary.get(key, 0) + 1

    return {
        "employee":  {"id": emp.ID, "code": emp.EMPLOYEE_CODE, "name": emp.NAME or ""},
        "from_date": today.isoformat(),
        "to_date":   end.isoformat(),
        "days":      days,
        "summary":   summary,
        "days_assigned": len(rows),
        "days_unassigned": days - len(rows),
        "assignments": [
            _serialise_assignment(a, by_id.get(a.SHIFT_ID)) for a in rows
        ],
    }


@router.post("/schedule/bulk")
def bulk_assign(
    payload: BulkIn,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Assign SHIFT_ID (may be NULL = OFF) to every listed employee
    across every day in the window. OVERWRITE=True clears existing
    assignments in the window first; otherwise existing cells are
    preserved."""

    if not payload.EMPLOYEE_IDS:
        raise HTTPException(400, "EMPLOYEE_IDS must not be empty.")

    fr = _parse_date(payload.FROM_DATE, "FROM_DATE")
    to = _parse_date(payload.TO_DATE,   "TO_DATE")

    if fr > to:
        raise HTTPException(400, "FROM_DATE must be on or before TO_DATE.")

    if payload.SHIFT_ID:
        s = db.query(ShiftTemplate).filter(ShiftTemplate.ID == payload.SHIFT_ID).first()
        if not s:
            raise HTTPException(404, "Shift template not found.")

    emps = (
        db.query(Employee)
        .filter(Employee.ID.in_(payload.EMPLOYEE_IDS))
        .all()
    )
    if not emps:
        raise HTTPException(404, "No matching employees.")

    vendor_by_emp = {e.ID: e.VENDOR_ID for e in emps}

    created = 0
    overwritten = 0
    skipped_existing = 0
    skipped_weekend = 0

    for emp in emps:
        d = fr
        while d <= to:
            if payload.SKIP_WEEKENDS and d.weekday() == 6:
                skipped_weekend += 1
                d = d + timedelta(days=1)
                continue

            existing = (
                db.query(ShiftAssignment)
                .filter(
                    ShiftAssignment.EMPLOYEE_ID == emp.ID,
                    ShiftAssignment.SHIFT_DATE  == d,
                )
                .first()
            )

            if existing and not payload.OVERWRITE:
                skipped_existing += 1
                d = d + timedelta(days=1)
                continue

            if existing:
                existing.SHIFT_ID = payload.SHIFT_ID or None
                overwritten += 1
            else:
                db.add(ShiftAssignment(
                    EMPLOYEE_ID = emp.ID,
                    SHIFT_ID    = payload.SHIFT_ID or None,
                    SHIFT_DATE  = d,
                    VENDOR_ID   = vendor_by_emp.get(emp.ID),
                ))
                created += 1

            d = d + timedelta(days=1)

    db.commit()

    return {
        "created":          created,
        "overwritten":      overwritten,
        "skipped_existing": skipped_existing,
        "skipped_weekend":  skipped_weekend,
        "employees_touched": len(emps),
    }
