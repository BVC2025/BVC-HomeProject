"""Attendance-penalty auto-deduction service.

Scans every active employee once a day (via a background scheduler in
`app.main`) and creates a half-day LOP `LeaveRequest` row when either:

    1. LATE marks in the current calendar month reach 3
       → penalty key: `AUTO-LATE-<YYYY-MM>-<emp_id>`

    2. Approved permission hours in the current calendar month exceed 2
       → penalty key: `AUTO-PERM-<YYYY-MM>-<emp_id>`

Idempotency
-----------
Each auto-created row's `REASON` starts with `[<penalty_key>] …`. Before
inserting, the service queries for any existing row with that prefix for
that employee. If one exists (regardless of STATUS — including CANCELLED
after admin waive), no new row is created. This guarantees:

  * The scheduler can restart mid-run without duplicate rows.
  * The scheduler can be triggered manually alongside the cron without
    duplicate rows.
  * A previously-waived deduction stays waived — the same trigger this
    month will not re-fire.

New month
---------
On the 1st of a new month, `<YYYY-MM>` in the key changes automatically,
so a fresh deduction becomes eligible if the employee crosses the
threshold again that month.

Admin control
-------------
Auto-created rows land in STATUS = `PENDING_APPROVAL`. Admins review
them via the /attendance-penalties endpoints and mark them APPROVED
(payroll then deducts) or CANCELLED (waived). Nothing is deducted
automatically at scan time.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Attendance, Employee, Notification
from app.models.leave_models import LeaveRequest


LATE_THRESHOLD_PER_MONTH = 3
PERMISSION_FREE_HOURS_PER_MONTH = 2.0
LOP_DAYS_PER_TRIGGER = 0.5

_log = logging.getLogger("uvicorn")


# ---------------------------------------------------------------------------
# Idempotency helpers
# ---------------------------------------------------------------------------

def build_late_key(when: date, employee_id: str) -> str:
    return f"AUTO-LATE-{when.year:04d}-{when.month:02d}-{employee_id}"


def build_perm_key(when: date, employee_id: str) -> str:
    return f"AUTO-PERM-{when.year:04d}-{when.month:02d}-{employee_id}"


def _tag_reason(key: str, body: str) -> str:
    return f"[{key}] {body}"


def _exists_for_key(db: Session, employee_id: str, key: str) -> bool:
    """Any auto-created LOP row for this key already present?

    Matches ANY status (PENDING_APPROVAL, APPROVED, CANCELLED). Once an
    admin has seen and decided on the penalty, we never re-issue it for
    the same trigger."""

    prefix = f"[{key}]"
    row = (
        db.query(LeaveRequest.ID)
        .filter(
            LeaveRequest.EMPLOYEE_ID == employee_id,
            LeaveRequest.LEAVE_TYPE == "LOP",
            LeaveRequest.REASON.like(f"{prefix}%"),
        )
        .first()
    )
    return row is not None


# ---------------------------------------------------------------------------
# Data windows
# ---------------------------------------------------------------------------

def _month_bounds(today: date) -> Tuple[date, date]:
    first = today.replace(day=1)
    if today.month == 12:
        next_first = date(today.year + 1, 1, 1)
    else:
        next_first = date(today.year, today.month + 1, 1)
    last = next_first - timedelta(days=1)
    return first, last


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class ScanSummary:
    ran_at: str
    late_penalties_created: int = 0
    permission_penalties_created: int = 0
    late_skipped_existing: int = 0
    permission_skipped_existing: int = 0
    employees_scanned: int = 0

    def as_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Late scan
# ---------------------------------------------------------------------------

def _apply_late_penalty(
    db: Session,
    emp: Employee,
    today: date,
    summary: ScanSummary,
) -> None:

    month_start, month_end = _month_bounds(today)

    late_count = (
        db.query(func.count(Attendance.ID))
        .filter(
            Attendance.EMPLOYEE_ID == emp.ID,
            Attendance.STATUS == "LATE",
            Attendance.DATE >= month_start,
            Attendance.DATE <= today,
        )
        .scalar()
    ) or 0

    if late_count < LATE_THRESHOLD_PER_MONTH:
        return

    key = build_late_key(today, emp.ID)

    if _exists_for_key(db, emp.ID, key):
        summary.late_skipped_existing += 1
        return

    # Anchor the deduction to the 3rd late's date (or today if we can't
    # determine it — we still land inside the same month).
    third_late = (
        db.query(Attendance.DATE)
        .filter(
            Attendance.EMPLOYEE_ID == emp.ID,
            Attendance.STATUS == "LATE",
            Attendance.DATE >= month_start,
            Attendance.DATE <= today,
        )
        .order_by(Attendance.DATE.asc())
        .offset(LATE_THRESHOLD_PER_MONTH - 1)
        .limit(1)
        .scalar()
    ) or today

    lr = LeaveRequest(
        EMPLOYEE_ID=emp.ID,
        LEAVE_TYPE="LOP",
        START_DATE=third_late,
        END_DATE=third_late,
        DAYS=LOP_DAYS_PER_TRIGGER,
        REASON=_tag_reason(
            key,
            f"Auto-generated: {late_count} late arrivals in "
            f"{today.strftime('%B %Y')} exceeded the threshold of "
            f"{LATE_THRESHOLD_PER_MONTH}. Half-day salary deduction "
            f"pending admin review.",
        ),
        STATUS="PENDING_APPROVAL",
        VENDOR_ID=emp.VENDOR_ID,
        CREATED_AT=datetime.now(),
    )
    db.add(lr)
    db.flush()

    _emit_admin_notification(
        db,
        emp,
        title="Auto LOP: 3+ late arrivals",
        message=(
            f"{emp.NAME} ({emp.EMPLOYEE_CODE}) crossed {LATE_THRESHOLD_PER_MONTH} "
            f"late arrivals in {today.strftime('%B %Y')} (actual: {late_count}). "
            f"A half-day LOP row is now pending your review."
        ),
    )

    summary.late_penalties_created += 1


# ---------------------------------------------------------------------------
# Permission scan
# ---------------------------------------------------------------------------

def _apply_permission_penalty(
    db: Session,
    emp: Employee,
    today: date,
    summary: ScanSummary,
) -> None:

    month_start, month_end = _month_bounds(today)

    hours_used = (
        db.query(func.coalesce(func.sum(LeaveRequest.DURATION_HOURS), 0))
        .filter(
            LeaveRequest.EMPLOYEE_ID == emp.ID,
            LeaveRequest.LEAVE_TYPE == "PERMISSION",
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE >= month_start,
            LeaveRequest.START_DATE <= today,
        )
        .scalar()
    ) or 0.0

    hours_used = float(hours_used)

    if hours_used <= PERMISSION_FREE_HOURS_PER_MONTH:
        return

    key = build_perm_key(today, emp.ID)

    if _exists_for_key(db, emp.ID, key):
        summary.permission_skipped_existing += 1
        return

    # Anchor to the latest approved permission date this month (or today).
    trigger_date = (
        db.query(func.max(LeaveRequest.START_DATE))
        .filter(
            LeaveRequest.EMPLOYEE_ID == emp.ID,
            LeaveRequest.LEAVE_TYPE == "PERMISSION",
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE >= month_start,
            LeaveRequest.START_DATE <= today,
        )
        .scalar()
    ) or today

    lr = LeaveRequest(
        EMPLOYEE_ID=emp.ID,
        LEAVE_TYPE="LOP",
        START_DATE=trigger_date,
        END_DATE=trigger_date,
        DAYS=LOP_DAYS_PER_TRIGGER,
        REASON=_tag_reason(
            key,
            f"Auto-generated: {hours_used:.2f}h of permission taken in "
            f"{today.strftime('%B %Y')} exceeded the free allowance of "
            f"{PERMISSION_FREE_HOURS_PER_MONTH:.0f}h. Half-day salary "
            f"deduction pending admin review.",
        ),
        STATUS="PENDING_APPROVAL",
        VENDOR_ID=emp.VENDOR_ID,
        CREATED_AT=datetime.now(),
    )
    db.add(lr)
    db.flush()

    _emit_admin_notification(
        db,
        emp,
        title="Auto LOP: permission over 2h",
        message=(
            f"{emp.NAME} ({emp.EMPLOYEE_CODE}) used {hours_used:.2f}h of "
            f"permission in {today.strftime('%B %Y')}, exceeding the 2h "
            f"free allowance. A half-day LOP row is now pending your review."
        ),
    )

    summary.permission_penalties_created += 1


def _emit_admin_notification(
    db: Session,
    emp: Employee,
    title: str,
    message: str,
) -> None:
    try:
        db.add(Notification(
            EMPLOYEE_ID=None,
            TITLE=title,
            MESSAGE=message,
            TYPE="ATTENDANCE_PENALTY",
            IS_READ=0,
            VENDOR_ID=emp.VENDOR_ID,
            CREATED_AT=datetime.now(),
        ))
    except Exception:
        # Notification is best-effort — never fail the penalty insert.
        pass


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_scan(db: Session, today: Optional[date] = None) -> ScanSummary:
    """Scan every employee once and apply any missing penalty rows.

    Idempotent — safe to call multiple times per day. Returns a summary
    of what changed."""

    today = today or date.today()
    summary = ScanSummary(ran_at=datetime.now().isoformat(timespec="seconds"))

    employees: List[Employee] = (
        db.query(Employee)
        .filter(
            (Employee.STATUS.is_(None)) | (Employee.STATUS != "INACTIVE")
        )
        .all()
    )

    for emp in employees:
        try:
            _apply_late_penalty(db, emp, today, summary)
            _apply_permission_penalty(db, emp, today, summary)
        except Exception as exc:
            db.rollback()
            _log.warning(
                "[attendance-penalty] scan for %s failed: %s: %s",
                emp.EMPLOYEE_CODE, type(exc).__name__, exc,
            )
            continue

        summary.employees_scanned += 1

    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        _log.warning("[attendance-penalty] final commit failed: %s", exc)

    _log.info(
        "[attendance-penalty] scan complete: %d employees, "
        "%d late penalties, %d permission penalties, "
        "%d late skipped, %d permission skipped",
        summary.employees_scanned,
        summary.late_penalties_created,
        summary.permission_penalties_created,
        summary.late_skipped_existing,
        summary.permission_skipped_existing,
    )

    return summary


# ---------------------------------------------------------------------------
# Query helpers used by the admin route.
# ---------------------------------------------------------------------------

def is_auto_penalty(row: LeaveRequest) -> bool:
    r = (row.REASON or "").strip()
    return r.startswith("[AUTO-LATE-") or r.startswith("[AUTO-PERM-")


def penalty_kind(row: LeaveRequest) -> Optional[str]:
    r = (row.REASON or "").strip()
    if r.startswith("[AUTO-LATE-"):
        return "LATE"
    if r.startswith("[AUTO-PERM-"):
        return "PERMISSION"
    return None
