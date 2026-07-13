"""
Small helper functions for attendance-driven business rules.

Any module that needs to answer "is this employee at work today?" or
"was this employee present on date X?" should route through here so
the definition stays consistent across the app.

An employee is considered PRESENT for any given day when:
  • An `attendance` row exists for (employee_id, date), AND
  • Its STATUS is 'PRESENT' or 'LATE' (both mean they physically
    punched in — LATE just means past the 9:15 cutoff).

Absence (no row + no punch) or STATUS = 'ABSENT' / 'HALF_DAY' returns
False. HALF_DAY is treated as "not present for a full day of work" —
task assignment shouldn't dump a full task on a half-day worker; if
you want to allow half-day assignments, gate with `is_at_office`
instead of `is_present_full_day`.
"""

from __future__ import annotations
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Attendance


PRESENT_STATUSES = {"PRESENT", "LATE"}


def is_present_on(
    db: Session,
    employee_id: str,
    on_date: Optional[date] = None,
) -> bool:
    """Definitive "at work today" check for downstream modules.

    - No attendance row for that day → False (implicit absence).
    - Row with STATUS PRESENT / LATE → True.
    - Row with STATUS ABSENT / HALF_DAY / anything else → False.
    """
    if not employee_id:
        return False

    target = on_date or date.today()

    row = (
        db.query(Attendance)
        .filter(
            Attendance.EMPLOYEE_ID == employee_id,
            Attendance.DATE == target,
        )
        .first()
    )
    if row is None:
        return False

    return (row.STATUS or "").upper() in PRESENT_STATUSES


def present_employee_ids_on(
    db: Session,
    on_date: Optional[date] = None,
) -> set:
    """Return the set of employee IDs marked PRESENT / LATE on the given day.

    Useful for filtering large candidate pools without N queries — the
    caller does one lookup, then does `emp.ID in present_ids` in-memory.
    """
    target = on_date or date.today()

    rows = (
        db.query(Attendance.EMPLOYEE_ID)
        .filter(
            Attendance.DATE == target,
            Attendance.STATUS.in_(list(PRESENT_STATUSES)),
        )
        .all()
    )
    return {r[0] for r in rows if r[0]}
