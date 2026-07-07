"""
Shift Management — REST endpoints.

  Shift templates (masters):
    GET    /shifts                              list all shifts
    POST   /shifts                              create a new shift template
    GET    /shifts/{id}                         detail
    PATCH  /shifts/{id}                         update
    DELETE /shifts/{id}                         soft-deactivate (IS_ACTIVE=0)

  Schedule (per-employee per-date assignments):
    GET    /shifts/schedule                     range list (?from=&to=&employee_id=)
    POST   /shifts/schedule/assign              set one employee's shift on one date
    POST   /shifts/schedule/bulk                bulk-assign N employees to one shift over date range
    POST   /shifts/schedule/auto-fill           fill missing days using Employee.SHIFT_START/END default
    DELETE /shifts/schedule/{id}                remove an assignment

  Change requests (approval workflow):
    GET    /shifts/change-requests              list (?status=PENDING&employee_id=)
    POST   /shifts/change-requests              create request
    POST   /shifts/change-requests/{id}/approve
    POST   /shifts/change-requests/{id}/reject
    POST   /shifts/change-requests/{id}/cancel  requester withdraws

All data is per-vendor scoped where VENDOR_ID is present.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import (
    Shift, ShiftAssignment, ShiftChangeRequest, Employee,
)


router = APIRouter(prefix="/shifts", tags=["Shifts"])


# =====================================================================
# Pydantic schemas
# =====================================================================


class ShiftCreate(BaseModel):
    SHIFT_CODE: str = Field(..., min_length=1, max_length=30)
    NAME: str       = Field(..., min_length=1, max_length=80)
    START_TIME: str                                  # ISO "HH:MM" or "HH:MM:SS"
    END_TIME: str
    CROSS_MIDNIGHT: bool = False
    BREAK_MINUTES: int = 60
    CATEGORY: str = "DAY"
    IS_NIGHT: bool = False
    NIGHT_ALLOWANCE_PCT: Optional[float] = 0.0
    FLEX_WINDOW_MINUTES: Optional[int] = 0
    COLOR: Optional[str] = "#3b82f6"
    DESCRIPTION: Optional[str] = None
    IS_ACTIVE: bool = True
    VENDOR_ID: Optional[int] = 1


class ShiftUpdate(BaseModel):
    SHIFT_CODE: Optional[str] = None
    NAME: Optional[str] = None
    START_TIME: Optional[str] = None
    END_TIME: Optional[str] = None
    CROSS_MIDNIGHT: Optional[bool] = None
    BREAK_MINUTES: Optional[int] = None
    CATEGORY: Optional[str] = None
    IS_NIGHT: Optional[bool] = None
    NIGHT_ALLOWANCE_PCT: Optional[float] = None
    FLEX_WINDOW_MINUTES: Optional[int] = None
    COLOR: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    IS_ACTIVE: Optional[bool] = None


class ShiftAssignmentIn(BaseModel):
    EMPLOYEE_ID: str
    SHIFT_ID: Optional[int] = None      # null = OFF-day
    SHIFT_DATE: str                     # ISO YYYY-MM-DD
    STATUS: Optional[str] = "SCHEDULED"
    NOTES: Optional[str] = None


class BulkAssignIn(BaseModel):
    EMPLOYEE_IDS: List[str]
    SHIFT_ID: Optional[int] = None      # null = OFF-day for all
    FROM_DATE: str                      # ISO YYYY-MM-DD (inclusive)
    TO_DATE: str                        # ISO YYYY-MM-DD (inclusive)
    SKIP_WEEKENDS: bool = False         # if True, don't create Sat/Sun rows
    OVERWRITE: bool = False             # if True, replace existing assignments


class AutoFillIn(BaseModel):
    FROM_DATE: str
    TO_DATE: str
    EMPLOYEE_IDS: Optional[List[str]] = None   # None = every ACTIVE employee
    SKIP_WEEKENDS: bool = True
    DEFAULT_SHIFT_ID: Optional[int] = None     # used when Employee has no SHIFT_START/END


class ChangeRequestCreate(BaseModel):
    REQUESTED_BY_ID: str
    SHIFT_DATE: str
    TO_SHIFT_ID: Optional[int] = None
    SWAP_WITH_EMPLOYEE_ID: Optional[str] = None
    REASON: Optional[str] = None


class ChangeRequestDecision(BaseModel):
    APPROVED_BY_ID: Optional[str] = None
    REJECTION_REASON: Optional[str] = None


# =====================================================================
# Helpers
# =====================================================================


def _parse_time(s: str) -> time:
    """Accept 'HH:MM' or 'HH:MM:SS'. Rejects anything else with 400."""

    if not s:

        raise HTTPException(status_code=400, detail="Time is required.")

    for fmt in ("%H:%M:%S", "%H:%M"):

        try:

            return datetime.strptime(s, fmt).time()

        except ValueError:

            continue

    raise HTTPException(
        status_code=400,
        detail=f"Time '{s}' must be ISO HH:MM or HH:MM:SS.",
    )


def _parse_date(s: str) -> date:

    if not s:

        raise HTTPException(status_code=400, detail="Date is required.")

    try:

        return datetime.strptime(s[:10], "%Y-%m-%d").date()

    except ValueError:

        raise HTTPException(
            status_code=400,
            detail=f"Date '{s}' must be ISO YYYY-MM-DD.",
        )


def _serialize_shift(s: Shift) -> dict:

    return {
        "ID":                  s.ID,
        "SHIFT_CODE":          s.SHIFT_CODE,
        "NAME":                s.NAME,
        "START_TIME":          s.START_TIME.strftime("%H:%M") if s.START_TIME else None,
        "END_TIME":            s.END_TIME.strftime("%H:%M") if s.END_TIME else None,
        "CROSS_MIDNIGHT":      bool(s.CROSS_MIDNIGHT),
        "BREAK_MINUTES":       s.BREAK_MINUTES,
        "CATEGORY":            s.CATEGORY,
        "IS_NIGHT":            bool(s.IS_NIGHT),
        "NIGHT_ALLOWANCE_PCT": s.NIGHT_ALLOWANCE_PCT,
        "FLEX_WINDOW_MINUTES": s.FLEX_WINDOW_MINUTES,
        "COLOR":               s.COLOR,
        "DESCRIPTION":         s.DESCRIPTION,
        "IS_ACTIVE":           bool(s.IS_ACTIVE),
        "VENDOR_ID":           s.VENDOR_ID,
        "CREATED_AT":          s.CREATED_AT.isoformat() if s.CREATED_AT else None,
        "UPDATED_AT":          s.UPDATED_AT.isoformat() if s.UPDATED_AT else None,
    }


def _serialize_assignment(a: ShiftAssignment, shift: Optional[Shift]) -> dict:

    return {
        "ID":                a.ID,
        "EMPLOYEE_ID":       a.EMPLOYEE_ID,
        "SHIFT_ID":          a.SHIFT_ID,
        "SHIFT_DATE":        a.SHIFT_DATE.isoformat() if a.SHIFT_DATE else None,
        "STATUS":            a.STATUS,
        "NOTES":             a.NOTES,
        "ASSIGNED_BY_ID":    a.ASSIGNED_BY_ID,
        "SHIFT_CODE":        shift.SHIFT_CODE if shift else None,
        "SHIFT_NAME":        shift.NAME if shift else None,
        "START_TIME":        shift.START_TIME.strftime("%H:%M") if shift and shift.START_TIME else None,
        "END_TIME":          shift.END_TIME.strftime("%H:%M") if shift and shift.END_TIME else None,
        "COLOR":             shift.COLOR if shift else None,
        "IS_NIGHT":          bool(shift.IS_NIGHT) if shift else False,
        "IS_OFF_DAY":        a.SHIFT_ID is None,
    }


def _serialize_change_request(r: ShiftChangeRequest, db: Session) -> dict:

    def _name(emp_id: Optional[str]) -> Optional[str]:
        if not emp_id:
            return None
        e = db.query(Employee).filter(Employee.ID == emp_id).first()
        return e.NAME if e else None

    def _shift_name(sid: Optional[int]) -> Optional[str]:
        if not sid:
            return None
        s = db.query(Shift).filter(Shift.ID == sid).first()
        return s.NAME if s else None

    return {
        "ID":                     r.ID,
        "REQUESTED_BY_ID":        r.REQUESTED_BY_ID,
        "REQUESTED_BY_NAME":      _name(r.REQUESTED_BY_ID),
        "SHIFT_DATE":             r.SHIFT_DATE.isoformat() if r.SHIFT_DATE else None,
        "FROM_SHIFT_ID":          r.FROM_SHIFT_ID,
        "FROM_SHIFT_NAME":        _shift_name(r.FROM_SHIFT_ID),
        "TO_SHIFT_ID":            r.TO_SHIFT_ID,
        "TO_SHIFT_NAME":          _shift_name(r.TO_SHIFT_ID),
        "SWAP_WITH_EMPLOYEE_ID":  r.SWAP_WITH_EMPLOYEE_ID,
        "SWAP_WITH_EMPLOYEE_NAME": _name(r.SWAP_WITH_EMPLOYEE_ID),
        "REASON":                 r.REASON,
        "STATUS":                 r.STATUS,
        "REJECTION_REASON":       r.REJECTION_REASON,
        "APPROVED_BY_ID":         r.APPROVED_BY_ID,
        "APPROVED_BY_NAME":       _name(r.APPROVED_BY_ID),
        "APPROVED_AT":            r.APPROVED_AT.isoformat() if r.APPROVED_AT else None,
        "CREATED_AT":             r.CREATED_AT.isoformat() if r.CREATED_AT else None,
    }


def _require_shift(db: Session, sid: int) -> Shift:

    s = db.query(Shift).filter(Shift.ID == sid).first()

    if s is None:

        raise HTTPException(status_code=404, detail=f"Shift {sid} not found.")

    return s


def _require_employee(db: Session, emp_id: str) -> Employee:

    e = db.query(Employee).filter(Employee.ID == emp_id).first()

    if e is None:

        raise HTTPException(status_code=404, detail=f"Employee {emp_id} not found.")

    return e


# =====================================================================
# Shift MASTER — CRUD
# =====================================================================


@router.get("")
def list_shifts(
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
):

    q = db.query(Shift)

    if active_only:

        q = q.filter(Shift.IS_ACTIVE == 1)

    return [_serialize_shift(s) for s in q.order_by(Shift.NAME).all()]


@router.post("")
def create_shift(body: ShiftCreate, db: Session = Depends(get_db)):

    start_t = _parse_time(body.START_TIME)
    end_t   = _parse_time(body.END_TIME)

    # If end < start and CROSS_MIDNIGHT wasn't set, force it — the shift
    # obviously crosses midnight.
    cross = bool(body.CROSS_MIDNIGHT) or end_t <= start_t

    s = Shift(
        SHIFT_CODE=body.SHIFT_CODE.strip().upper(),
        NAME=body.NAME.strip(),
        START_TIME=start_t,
        END_TIME=end_t,
        CROSS_MIDNIGHT=1 if cross else 0,
        BREAK_MINUTES=max(0, int(body.BREAK_MINUTES or 0)),
        CATEGORY=(body.CATEGORY or "DAY").upper(),
        IS_NIGHT=1 if body.IS_NIGHT else 0,
        NIGHT_ALLOWANCE_PCT=body.NIGHT_ALLOWANCE_PCT or 0.0,
        FLEX_WINDOW_MINUTES=body.FLEX_WINDOW_MINUTES or 0,
        COLOR=body.COLOR or "#3b82f6",
        DESCRIPTION=body.DESCRIPTION,
        IS_ACTIVE=1 if body.IS_ACTIVE else 0,
        VENDOR_ID=body.VENDOR_ID or 1,
    )

    db.add(s)

    try:

        db.commit()
        db.refresh(s)

    except Exception as exc:

        db.rollback()

        raise HTTPException(
            status_code=400,
            detail=(
                "Could not create shift — the SHIFT_CODE might be duplicate "
                f"in this vendor. ({exc})"
            ),
        )

    return _serialize_shift(s)


@router.get("/{shift_id}")
def get_shift(shift_id: int, db: Session = Depends(get_db)):

    return _serialize_shift(_require_shift(db, shift_id))


@router.patch("/{shift_id}")
def update_shift(shift_id: int, body: ShiftUpdate, db: Session = Depends(get_db)):

    s = _require_shift(db, shift_id)

    data = body.model_dump(exclude_unset=True)

    if "SHIFT_CODE" in data and data["SHIFT_CODE"]:

        s.SHIFT_CODE = data["SHIFT_CODE"].strip().upper()

    if "NAME" in data and data["NAME"]:

        s.NAME = data["NAME"].strip()

    if "START_TIME" in data and data["START_TIME"]:

        s.START_TIME = _parse_time(data["START_TIME"])

    if "END_TIME" in data and data["END_TIME"]:

        s.END_TIME = _parse_time(data["END_TIME"])

    for key in (
        "BREAK_MINUTES", "CATEGORY", "NIGHT_ALLOWANCE_PCT",
        "FLEX_WINDOW_MINUTES", "COLOR", "DESCRIPTION",
    ):

        if key in data:

            setattr(s, key, data[key])

    for bool_key in ("CROSS_MIDNIGHT", "IS_NIGHT", "IS_ACTIVE"):

        if bool_key in data:

            setattr(s, bool_key, 1 if data[bool_key] else 0)

    s.UPDATED_AT = datetime.utcnow()

    db.commit(); db.refresh(s)

    return _serialize_shift(s)


@router.delete("/{shift_id}")
def deactivate_shift(shift_id: int, db: Session = Depends(get_db)):
    """Soft-delete — sets IS_ACTIVE=0. Preserves history on existing
    ShiftAssignment rows that reference this shift."""

    s = _require_shift(db, shift_id)
    s.IS_ACTIVE = 0
    s.UPDATED_AT = datetime.utcnow()
    db.commit()

    return {"ok": True, "id": shift_id, "deactivated": True}


# =====================================================================
# SCHEDULE — per-employee per-date
# =====================================================================


@router.get("/schedule/range")
def list_schedule(
    from_date: str,
    to_date: str,
    employee_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return every ShiftAssignment in [from_date, to_date]. Optionally
    filter to a single employee."""

    d_from = _parse_date(from_date)
    d_to   = _parse_date(to_date)

    if d_from > d_to:

        raise HTTPException(status_code=400, detail="from_date must be <= to_date.")

    q = db.query(ShiftAssignment).filter(
        ShiftAssignment.SHIFT_DATE >= d_from,
        ShiftAssignment.SHIFT_DATE <= d_to,
    )

    if employee_id:

        q = q.filter(ShiftAssignment.EMPLOYEE_ID == employee_id)

    rows = q.order_by(
        ShiftAssignment.SHIFT_DATE.asc(),
        ShiftAssignment.EMPLOYEE_ID.asc(),
    ).all()

    # Bulk-load shifts to avoid N+1
    shift_ids = {r.SHIFT_ID for r in rows if r.SHIFT_ID}
    shifts_by_id = {}
    if shift_ids:
        for s in db.query(Shift).filter(Shift.ID.in_(shift_ids)).all():
            shifts_by_id[s.ID] = s

    return [
        _serialize_assignment(r, shifts_by_id.get(r.SHIFT_ID))
        for r in rows
    ]


@router.post("/schedule/assign")
def assign_shift(body: ShiftAssignmentIn, db: Session = Depends(get_db)):
    """Set (or replace) an employee's shift on a given date."""

    emp = _require_employee(db, body.EMPLOYEE_ID)

    if body.SHIFT_ID:

        _require_shift(db, body.SHIFT_ID)

    d = _parse_date(body.SHIFT_DATE)

    row = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == emp.ID,
            ShiftAssignment.SHIFT_DATE == d,
        )
        .first()
    )

    if row is None:

        row = ShiftAssignment(
            EMPLOYEE_ID=emp.ID,
            SHIFT_DATE=d,
            VENDOR_ID=emp.VENDOR_ID or 1,
        )
        db.add(row)

    row.SHIFT_ID = body.SHIFT_ID
    row.STATUS   = (body.STATUS or "SCHEDULED").upper()
    row.NOTES    = body.NOTES
    row.UPDATED_AT = datetime.utcnow()

    db.commit(); db.refresh(row)

    shift = None

    if row.SHIFT_ID:

        shift = db.query(Shift).filter(Shift.ID == row.SHIFT_ID).first()

    return _serialize_assignment(row, shift)


@router.post("/schedule/bulk")
def bulk_assign(body: BulkAssignIn, db: Session = Depends(get_db)):
    """Assign one shift (or an OFF-day if SHIFT_ID is null) to many
    employees across a date range. Skips weekends when requested.

    Idempotent by default (skips dates that already have an
    assignment). Set OVERWRITE=True to replace existing rows."""

    d_from = _parse_date(body.FROM_DATE)
    d_to   = _parse_date(body.TO_DATE)

    if d_from > d_to:

        raise HTTPException(status_code=400, detail="FROM_DATE must be <= TO_DATE.")

    if body.SHIFT_ID:

        shift = _require_shift(db, body.SHIFT_ID)
        vendor_id = shift.VENDOR_ID or 1

    else:

        shift = None
        vendor_id = 1

    if not body.EMPLOYEE_IDS:

        raise HTTPException(status_code=400, detail="EMPLOYEE_IDS is required.")

    # Preload existing rows
    existing = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID.in_(body.EMPLOYEE_IDS),
            ShiftAssignment.SHIFT_DATE >= d_from,
            ShiftAssignment.SHIFT_DATE <= d_to,
        )
        .all()
    )
    key = lambda a: (a.EMPLOYEE_ID, a.SHIFT_DATE)
    existing_by_key = {key(r): r for r in existing}

    created = 0
    updated = 0
    skipped = 0

    cur = d_from

    while cur <= d_to:

        # Monday = 0 … Sunday = 6
        if body.SKIP_WEEKENDS and cur.weekday() >= 5:

            cur += timedelta(days=1)
            continue

        for emp_id in body.EMPLOYEE_IDS:

            k = (emp_id, cur)

            row = existing_by_key.get(k)

            if row is not None:

                if not body.OVERWRITE:

                    skipped += 1
                    continue

                row.SHIFT_ID = body.SHIFT_ID
                row.STATUS = "SCHEDULED"
                row.UPDATED_AT = datetime.utcnow()
                updated += 1

            else:

                db.add(ShiftAssignment(
                    EMPLOYEE_ID=emp_id,
                    SHIFT_ID=body.SHIFT_ID,
                    SHIFT_DATE=cur,
                    STATUS="SCHEDULED",
                    VENDOR_ID=vendor_id,
                ))
                created += 1

        cur += timedelta(days=1)

    db.commit()

    return {
        "created": created,
        "updated": updated,
        "skipped_existing": skipped,
    }


@router.post("/schedule/auto-fill")
def auto_fill_schedule(body: AutoFillIn, db: Session = Depends(get_db)):
    """The "fully automated" primitive: for every ACTIVE employee that
    doesn't already have an assignment on a given date in the range,
    look up their SHIFT_START / SHIFT_END on the Employee row and match
    it against Shift templates. If nothing matches, use
    DEFAULT_SHIFT_ID or fall back to the first ACTIVE Shift for this
    vendor."""

    d_from = _parse_date(body.FROM_DATE)
    d_to   = _parse_date(body.TO_DATE)

    if d_from > d_to:

        raise HTTPException(status_code=400, detail="FROM_DATE must be <= TO_DATE.")

    # Employee scope
    emp_q = db.query(Employee).filter(
        Employee.STATUS.notin_(("RESIGNED", "TERMINATED"))
    )

    if body.EMPLOYEE_IDS:

        emp_q = emp_q.filter(Employee.ID.in_(body.EMPLOYEE_IDS))

    employees = emp_q.all()

    if not employees:

        return {"created": 0, "skipped_existing": 0, "employees_scoped": 0}

    # Preload shifts and existing assignments
    all_shifts = db.query(Shift).filter(Shift.IS_ACTIVE == 1).all()

    def _match_shift(emp: Employee) -> Optional[int]:

        # 1) Exact match on start + end
        if emp.SHIFT_START and emp.SHIFT_END:

            for s in all_shifts:

                if (
                    s.VENDOR_ID == emp.VENDOR_ID
                    and s.START_TIME == emp.SHIFT_START
                    and s.END_TIME == emp.SHIFT_END
                ):

                    return s.ID

        # 2) Caller-supplied fallback
        if body.DEFAULT_SHIFT_ID:

            return body.DEFAULT_SHIFT_ID

        # 3) First active shift for this vendor
        for s in all_shifts:

            if s.VENDOR_ID == emp.VENDOR_ID:

                return s.ID

        return None

    emp_ids = [e.ID for e in employees]

    existing = {
        (r.EMPLOYEE_ID, r.SHIFT_DATE)
        for r in db.query(ShiftAssignment.EMPLOYEE_ID, ShiftAssignment.SHIFT_DATE)
        .filter(
            ShiftAssignment.EMPLOYEE_ID.in_(emp_ids),
            ShiftAssignment.SHIFT_DATE >= d_from,
            ShiftAssignment.SHIFT_DATE <= d_to,
        )
        .all()
    }

    created = 0
    skipped = 0
    unassigned_no_shift = 0

    cur = d_from

    while cur <= d_to:

        if body.SKIP_WEEKENDS and cur.weekday() >= 5:

            cur += timedelta(days=1)
            continue

        for emp in employees:

            k = (emp.ID, cur)

            if k in existing:

                skipped += 1
                continue

            sid = _match_shift(emp)

            if sid is None:

                unassigned_no_shift += 1
                continue

            db.add(ShiftAssignment(
                EMPLOYEE_ID=emp.ID,
                SHIFT_ID=sid,
                SHIFT_DATE=cur,
                STATUS="SCHEDULED",
                VENDOR_ID=emp.VENDOR_ID or 1,
            ))
            created += 1

        cur += timedelta(days=1)

    db.commit()

    return {
        "created": created,
        "skipped_existing": skipped,
        "unassigned_no_shift": unassigned_no_shift,
        "employees_scoped": len(employees),
    }


@router.delete("/schedule/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):

    row = (
        db.query(ShiftAssignment)
        .filter(ShiftAssignment.ID == assignment_id)
        .first()
    )

    if row is None:

        raise HTTPException(status_code=404, detail=f"Assignment {assignment_id} not found.")

    db.delete(row)
    db.commit()

    return {"ok": True, "deleted_id": assignment_id}


# =====================================================================
# CHANGE REQUESTS
# =====================================================================


@router.get("/change-requests")
def list_change_requests(
    status: Optional[str] = None,
    employee_id: Optional[str] = None,
    db: Session = Depends(get_db),
):

    q = db.query(ShiftChangeRequest)

    if status:

        q = q.filter(ShiftChangeRequest.STATUS == status.upper())

    if employee_id:

        q = q.filter(ShiftChangeRequest.REQUESTED_BY_ID == employee_id)

    rows = q.order_by(ShiftChangeRequest.ID.desc()).all()

    return [_serialize_change_request(r, db) for r in rows]


@router.post("/change-requests")
def create_change_request(body: ChangeRequestCreate, db: Session = Depends(get_db)):
    """Create a PENDING change request. FROM_SHIFT_ID is auto-derived
    from the existing ShiftAssignment on that date (if any)."""

    emp = _require_employee(db, body.REQUESTED_BY_ID)

    d = _parse_date(body.SHIFT_DATE)

    if body.TO_SHIFT_ID:

        _require_shift(db, body.TO_SHIFT_ID)

    if body.SWAP_WITH_EMPLOYEE_ID:

        _require_employee(db, body.SWAP_WITH_EMPLOYEE_ID)

        if body.SWAP_WITH_EMPLOYEE_ID == emp.ID:

            raise HTTPException(
                status_code=400,
                detail="Cannot swap with yourself.",
            )

    # Derive FROM_SHIFT_ID
    current = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == emp.ID,
            ShiftAssignment.SHIFT_DATE == d,
        )
        .first()
    )

    from_shift_id = current.SHIFT_ID if current else None

    req = ShiftChangeRequest(
        REQUESTED_BY_ID=emp.ID,
        SHIFT_DATE=d,
        FROM_SHIFT_ID=from_shift_id,
        TO_SHIFT_ID=body.TO_SHIFT_ID,
        SWAP_WITH_EMPLOYEE_ID=body.SWAP_WITH_EMPLOYEE_ID,
        REASON=body.REASON,
        STATUS="PENDING",
        VENDOR_ID=emp.VENDOR_ID or 1,
    )

    db.add(req); db.commit(); db.refresh(req)

    return _serialize_change_request(req, db)


@router.post("/change-requests/{req_id}/approve")
def approve_change_request(
    req_id: int,
    body: ChangeRequestDecision,
    db: Session = Depends(get_db),
):
    """Approve a PENDING request. Mutates the underlying ShiftAssignment
    (creates one if none existed). For swap requests, also mutates the
    swap partner's assignment atomically."""

    r = (
        db.query(ShiftChangeRequest)
        .filter(ShiftChangeRequest.ID == req_id)
        .first()
    )

    if r is None:

        raise HTTPException(status_code=404, detail=f"Request {req_id} not found.")

    if r.STATUS != "PENDING":

        raise HTTPException(
            status_code=400,
            detail=f"Only PENDING requests can be approved (current: {r.STATUS}).",
        )

    # Requester's assignment on that date
    row = (
        db.query(ShiftAssignment)
        .filter(
            ShiftAssignment.EMPLOYEE_ID == r.REQUESTED_BY_ID,
            ShiftAssignment.SHIFT_DATE == r.SHIFT_DATE,
        )
        .first()
    )

    if row is None:

        emp = _require_employee(db, r.REQUESTED_BY_ID)
        row = ShiftAssignment(
            EMPLOYEE_ID=r.REQUESTED_BY_ID,
            SHIFT_DATE=r.SHIFT_DATE,
            VENDOR_ID=emp.VENDOR_ID or 1,
        )
        db.add(row)

    if r.SWAP_WITH_EMPLOYEE_ID:

        # SWAP: partner takes the requester's original shift; requester
        # takes whatever the partner had.
        partner_row = (
            db.query(ShiftAssignment)
            .filter(
                ShiftAssignment.EMPLOYEE_ID == r.SWAP_WITH_EMPLOYEE_ID,
                ShiftAssignment.SHIFT_DATE == r.SHIFT_DATE,
            )
            .first()
        )

        partner = _require_employee(db, r.SWAP_WITH_EMPLOYEE_ID)

        if partner_row is None:

            partner_row = ShiftAssignment(
                EMPLOYEE_ID=r.SWAP_WITH_EMPLOYEE_ID,
                SHIFT_DATE=r.SHIFT_DATE,
                VENDOR_ID=partner.VENDOR_ID or 1,
            )
            db.add(partner_row)

        requester_original_shift = row.SHIFT_ID
        partner_original_shift   = partner_row.SHIFT_ID

        row.SHIFT_ID          = partner_original_shift
        partner_row.SHIFT_ID  = requester_original_shift
        row.STATUS            = "SWAPPED"
        partner_row.STATUS    = "SWAPPED"

    else:

        # Simple change: assign the requested shift (may be null = OFF)
        row.SHIFT_ID = r.TO_SHIFT_ID
        row.STATUS   = "SCHEDULED"

    r.STATUS = "APPROVED"
    r.APPROVED_BY_ID = body.APPROVED_BY_ID
    r.APPROVED_AT    = datetime.utcnow()
    r.REJECTION_REASON = None
    r.UPDATED_AT     = datetime.utcnow()

    db.commit(); db.refresh(r)

    return _serialize_change_request(r, db)


@router.post("/change-requests/{req_id}/reject")
def reject_change_request(
    req_id: int,
    body: ChangeRequestDecision,
    db: Session = Depends(get_db),
):

    r = (
        db.query(ShiftChangeRequest)
        .filter(ShiftChangeRequest.ID == req_id)
        .first()
    )

    if r is None:

        raise HTTPException(status_code=404, detail=f"Request {req_id} not found.")

    if r.STATUS != "PENDING":

        raise HTTPException(
            status_code=400,
            detail=f"Only PENDING requests can be rejected (current: {r.STATUS}).",
        )

    reason = (body.REJECTION_REASON or "").strip()

    if not reason:

        raise HTTPException(
            status_code=400,
            detail="REJECTION_REASON is required.",
        )

    r.STATUS = "REJECTED"
    r.REJECTION_REASON = reason
    r.APPROVED_BY_ID = body.APPROVED_BY_ID
    r.APPROVED_AT    = datetime.utcnow()
    r.UPDATED_AT     = datetime.utcnow()

    db.commit(); db.refresh(r)

    return _serialize_change_request(r, db)


@router.post("/change-requests/{req_id}/cancel")
def cancel_change_request(req_id: int, db: Session = Depends(get_db)):
    """Requester withdraws their own PENDING request."""

    r = (
        db.query(ShiftChangeRequest)
        .filter(ShiftChangeRequest.ID == req_id)
        .first()
    )

    if r is None:

        raise HTTPException(status_code=404, detail=f"Request {req_id} not found.")

    if r.STATUS != "PENDING":

        raise HTTPException(
            status_code=400,
            detail=f"Only PENDING requests can be cancelled (current: {r.STATUS}).",
        )

    r.STATUS = "CANCELLED"
    r.UPDATED_AT = datetime.utcnow()

    db.commit(); db.refresh(r)

    return _serialize_change_request(r, db)
