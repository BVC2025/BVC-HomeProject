"""
Leave <-> Attendance sync.

When a LeaveRequest is APPROVED, we write one Attendance row per day
in the requested range with STATUS derived from LEAVE_TYPE. That way
the Monthly calculation, the Attendance page, and the employee's ESS
portal all see the leave as an actual attendance entry — no duplicated
logic across the modules.

When a previously-APPROVED leave is cancelled or rejected, we undo
those Attendance rows, but only the ones we wrote (identified by
STATUS in {CL, SL, EL, LOP, HALF_*} AND no CHECK_IN punch). Any row
where the employee actually punched is left intact.

Called from app.routes.leave on approval / cancel paths.
"""

from datetime import date, timedelta
from typing import Iterable

from sqlalchemy.orm import Session

from app.models.models import Attendance, LeaveRequest


# LEAVE_TYPE  ->  attendance STATUS token
# Half-day requests (DAYS < 1) get a HALF_ prefix.
LEAVE_TYPE_TO_STATUS = {
    "CASUAL":  "CL",
    "SICK":    "SL",
    "EARNED":  "EL",
    "UNPAID":  "LOP",
    "LOP":     "LOP",
}

# STATUS values considered "leave-generated" — safe to overwrite/remove
# when the underlying leave lifecycle changes.
LEAVE_STATUSES = {
    "CL", "SL", "EL", "LOP",
    "HALF_CL", "HALF_SL", "HALF_EL", "HALF_LOP",
}


def _status_for_leave(leave: LeaveRequest) -> str | None:
    """Return the Attendance.STATUS token for this leave, or None if
    the leave type isn't day-based (e.g. hourly PERMISSION)."""
    token = LEAVE_TYPE_TO_STATUS.get((leave.LEAVE_TYPE or "").upper())
    if not token:
        return None
    is_half = leave.DAYS is not None and leave.DAYS < 1.0
    return f"HALF_{token}" if is_half else token


def _iter_dates(start: date, end: date) -> Iterable[date]:
    """Yield each date from start to end (inclusive)."""
    cur = start
    while cur <= end:
        yield cur
        cur = cur + timedelta(days=1)


def write_attendance_for_leave(db: Session, leave: LeaveRequest) -> int:
    """Upsert one Attendance row per day covered by this leave.

    - Rows with an existing CHECK_IN punch are preserved (we only
      stamp a REMARKS note pointing to the leave).
    - Rows with STATUS=ABSENT or empty get upgraded to the leave
      status.
    - Existing leave rows (from a previous approve) are refreshed.

    Returns number of rows written or refreshed.
    """
    if not leave or not leave.START_DATE or not leave.END_DATE:
        return 0

    status = _status_for_leave(leave)
    if status is None:
        # PERMISSION and other hourly types don't fill a day
        return 0

    remark = f"leave:{leave.ID}:{(leave.LEAVE_TYPE or '').upper()}"
    touched = 0

    for day in _iter_dates(leave.START_DATE, leave.END_DATE):
        row = (
            db.query(Attendance)
              .filter(
                  Attendance.EMPLOYEE_ID == leave.EMPLOYEE_ID,
                  Attendance.DATE == day,
              )
              .first()
        )

        if row is None:
            row = Attendance(
                EMPLOYEE_ID=leave.EMPLOYEE_ID,
                DATE=day,
                STATUS=status,
                VENDOR_ID=leave.VENDOR_ID,
                REMARKS=remark,
            )
            db.add(row)
            touched += 1
            continue

        if row.CHECK_IN is not None:
            # Employee actually punched — don't overwrite the punch,
            # but tag it so the calc/UI knows there's a paid leave
            # for the same date.
            if not (row.REMARKS or "").startswith("leave:"):
                row.REMARKS = remark
                touched += 1
            continue

        # No punch — safe to upgrade whatever STATUS was there.
        row.STATUS = status
        row.REMARKS = remark
        touched += 1

    db.commit()
    return touched


def remove_attendance_for_leave(db: Session, leave: LeaveRequest) -> int:
    """Undo write_attendance_for_leave — used when an approved leave
    is later cancelled or rejected. Only removes rows we wrote (no
    CHECK_IN, STATUS in LEAVE_STATUSES, or REMARKS tagged with this
    leave.ID). Real punches are left alone.

    Returns number of rows removed / cleared.
    """
    if not leave or not leave.START_DATE or not leave.END_DATE:
        return 0

    tag = f"leave:{leave.ID}:"
    touched = 0

    for day in _iter_dates(leave.START_DATE, leave.END_DATE):
        row = (
            db.query(Attendance)
              .filter(
                  Attendance.EMPLOYEE_ID == leave.EMPLOYEE_ID,
                  Attendance.DATE == day,
              )
              .first()
        )
        if row is None:
            continue

        is_ours = (row.REMARKS or "").startswith(tag)
        is_leave_row = (row.STATUS or "").upper() in LEAVE_STATUSES

        if row.CHECK_IN is None and (is_ours or is_leave_row):
            # Row was created purely by this leave — delete it.
            db.delete(row)
            touched += 1
        elif is_ours and row.CHECK_IN is not None:
            # Row had a real punch but was tagged by this leave —
            # clear the tag, keep the punch.
            row.REMARKS = None
            touched += 1

    db.commit()
    return touched
