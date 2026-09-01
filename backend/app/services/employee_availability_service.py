"""Employee availability for the automatic task assignment engine.

No date-range employee-occupancy checker existed anywhere in this
codebase before this file — the closest precedent is the overlap query
`LeaveRequest` already uses to detect a conflicting leave request
(`START_DATE <= requested_end AND END_DATE >= requested_start`), mirrored
here exactly but against `CustomerProjectTask`'s planned date range
instead of a leave date range.

An employee is considered occupied while they have a CustomerProjectTask
in PENDING, IN_PROGRESS, or EXTENDED status — matching the exact statuses
your requirement named. COMPLETED/OVERDUE tasks never block new work
(OVERDUE is a visibility flag, not an active-occupancy state — an overdue
task's employee is available for new work the moment their prior task's
planned window has passed, same as any other task)."""

from datetime import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import CustomerProjectTask

OCCUPIED_STATUSES = ("PENDING", "IN_PROGRESS", "EXTENDED")


def get_busy_until(db: Session, employee_id: str) -> Optional[datetime]:
    """The latest planned end (DUE_DATE) among this employee's currently
    occupied tasks, or None if they have none."""
    return db.query(func.max(CustomerProjectTask.DUE_DATE)).filter(
        CustomerProjectTask.EMPLOYEE_ID == employee_id,
        CustomerProjectTask.STATUS.in_(OCCUPIED_STATUSES),
        CustomerProjectTask.DUE_DATE.isnot(None),
    ).scalar()


def is_available(db: Session, employee_id: str, start: datetime, end: datetime) -> bool:
    """True if this employee has no occupied task whose planned window
    overlaps [start, end] — the same overlap idiom already used by
    LeaveRequest's own conflict check."""
    conflict = db.query(CustomerProjectTask.ID).filter(
        CustomerProjectTask.EMPLOYEE_ID == employee_id,
        CustomerProjectTask.STATUS.in_(OCCUPIED_STATUSES),
        CustomerProjectTask.PLANNED_START_DATE.isnot(None),
        CustomerProjectTask.DUE_DATE.isnot(None),
        CustomerProjectTask.PLANNED_START_DATE <= end,
        CustomerProjectTask.DUE_DATE >= start,
    ).first()
    return conflict is None


def next_available_instant(db: Session, employee_id: str, desired_start: datetime) -> datetime:
    """The earliest instant this employee could conceivably start new
    work — `desired_start` itself if they're free, or their busy-until
    instant otherwise. This is a raw calendar instant, not yet snapped to
    a valid company working moment — the caller passes it into
    company_schedule_service.calculate_task_schedule(), which normalizes
    it (before-open/after-close/inside-a-break) as part of its own
    scheduling math, so that normalization is not duplicated here."""
    busy_until = get_busy_until(db, employee_id)
    if busy_until and busy_until > desired_start:
        return busy_until
    return desired_start


class ReservationLedger:
    """Per-planning-pass overlay of employee busy-until instants — one
    instance created fresh at the top of each
    task_generation_service.build_schedule_plan() call, threaded through
    every find_candidates() call inside it. Never persisted, never shared
    across calls or requests.

    Why this is needed: `SessionLocal` is configured with
    `autoflush=False` (see database/database.py), and build_schedule_plan
    only flushes once at the very end. Without this ledger, every
    get_busy_until() call within ONE planning pass queries the DB exactly
    as it stood before the pass started — blind to employees just
    reserved moments earlier for a previous unit/parallel item in the
    SAME pass (and, in dry_run=True proposal mode, no CustomerProjectTask
    rows are ever added to query in the first place). That blindness is
    what let multiple parallel units/items match the same scarce
    employee to the same instant instead of correctly serializing the
    extra work.

    effective_busy_until() composes with (never replaces) the real
    get_busy_until() DB check — this class adds information, it never
    hides a genuine existing commitment."""

    def __init__(self):
        self._until: dict = {}

    def effective_busy_until(self, db: Session, employee_id: str) -> Optional[datetime]:
        db_val = get_busy_until(db, employee_id)
        reserved_val = self._until.get(employee_id)
        candidates = [v for v in (db_val, reserved_val) if v is not None]
        return max(candidates) if candidates else None

    def reserve(self, employee_id: str, until_instant: datetime) -> None:
        prev = self._until.get(employee_id)
        if not prev or until_instant > prev:
            self._until[employee_id] = until_instant
