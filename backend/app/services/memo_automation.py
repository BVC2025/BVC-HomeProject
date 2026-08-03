"""
Memo automation — weekly evaluator that issues WARNING or APPRECIATION
memos to employees based on attendance and task-completion data.

Rules (per employee, per ISO week):

  WARNING triggers  (any one is enough)
    • absent_days      > 1
    • late_marks       > 2
    • overdue_tasks    > 1

  APPRECIATION triggers  (all must be true)
    • absent_days   == 0
    • late_marks    == 0
    • overdue_tasks == 0
    • assigned_tasks > 0   (skip employees with no work)

Idempotency
    Each memo is written with AUTOMATION_KEY =
       AUTO-WEEK-<isoyear>W<isoweek>-<WARNING|APPRECIATION>-<employee_id>
    Before insert we check for that key; a second run on the same week
    is a no-op. If both warning and appreciation rules match (they can't
    — the sets are disjoint — but defensively), warning wins.

Delivery
    Every memo insert is paired with a Notification row targeted at the
    employee (EMPLOYEE_ID = emp.ID, REF_TYPE="MEMO", REF_ID=memo.ID) so
    the employee's dashboard shows a bell alert; clicking it opens the
    memo modal.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Attendance, EmployeeMemo, Employee, Notification, TaskAssignment,
)


# =====================================================================
# Thresholds — kept as constants so future admin-side settings can
# override them without touching the caller.
# =====================================================================

WARN_ABSENT_DAYS   = 1   # more than this → warning
WARN_LATE_MARKS    = 2
WARN_OVERDUE_TASKS = 1


# =====================================================================
# Datatypes
# =====================================================================

@dataclass
class EmployeeStats:
    employee_id:    str
    employee_name:  str
    employee_code:  Optional[str]
    absent_days:    int
    late_marks:     int
    assigned_tasks: int
    overdue_tasks:  int


@dataclass
class RunSummary:
    period_start:      date
    period_end:        date
    iso_year:          int
    iso_week:          int
    employees_scanned: int
    warnings_created:  int
    appreciations_created: int
    skipped_existing:  int
    ran_at:            datetime


# =====================================================================
# Helpers
# =====================================================================

def _current_week_bounds(today: Optional[date] = None) -> tuple[date, date, int, int]:
    """Return the Monday-Sunday bounds of the ISO week that CONTAINS
    the day before `today`. Called on Monday morning: `today` is Monday
    → we want to evaluate the PREVIOUS week (last Mon-Sun)."""
    today = today or date.today()
    # Roll back to yesterday, then jump to Monday of that ISO week.
    yday = today - timedelta(days=1)
    year, week, _ = yday.isocalendar()
    monday = yday - timedelta(days=yday.weekday())
    sunday = monday + timedelta(days=6)
    return monday, sunday, year, week


def _stats_for_employee(
    db: Session, emp: Employee, start: date, end: date
) -> EmployeeStats:
    """Attendance + task counts for one employee over [start, end]."""

    # Attendance: ABSENT and LATE inside the window.
    att_rows = (
        db.query(Attendance)
        .filter(
            Attendance.EMPLOYEE_ID == emp.ID,
            Attendance.DATE >= start,
            Attendance.DATE <= end,
        )
        .all()
    )
    absent_days = sum(1 for a in att_rows if (a.STATUS or "").upper() == "ABSENT")
    late_marks  = sum(1 for a in att_rows if (a.STATUS or "").upper() == "LATE")

    # Task assignments whose DUE_DATE falls inside the window. Overdue
    # = due within the window AND not COMPLETED.
    task_rows = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            TaskAssignment.DUE_DATE.isnot(None),
            TaskAssignment.DUE_DATE >= start,
            TaskAssignment.DUE_DATE <= end,
        )
        .all()
    )
    assigned_tasks = len(task_rows)
    overdue_tasks  = sum(
        1 for t in task_rows
        if (t.TASK_STATUS or "").upper() != "COMPLETED"
    )

    return EmployeeStats(
        employee_id=emp.ID,
        employee_name=emp.NAME or "",
        employee_code=getattr(emp, "EMPLOYEE_CODE", None),
        absent_days=absent_days,
        late_marks=late_marks,
        assigned_tasks=assigned_tasks,
        overdue_tasks=overdue_tasks,
    )


def _next_memo_number(db: Session) -> str:
    """MEMO-YYYY-NNNN. Sequence resets each calendar year, matches the
    existing manual-memo numbering."""
    year = datetime.utcnow().year
    prefix = f"MEMO-{year}-"
    count = (
        db.query(EmployeeMemo)
        .filter(EmployeeMemo.MEMO_NUMBER.like(f"{prefix}%"))
        .count()
    )
    return f"{prefix}{(count + 1):04d}"


def _automation_key(iso_year: int, iso_week: int,
                    memo_type: str, employee_id: str) -> str:
    return f"AUTO-WEEK-{iso_year}W{iso_week:02d}-{memo_type}-{employee_id}"


def _warning_body(stats: EmployeeStats, period_start: date, period_end: date) -> tuple[str, str, str]:
    """Return (subject, description, severity) for a warning memo."""
    reasons = []
    if stats.absent_days > WARN_ABSENT_DAYS:
        reasons.append(
            f"{stats.absent_days} absent day"
            + ("s" if stats.absent_days != 1 else "")
        )
    if stats.late_marks > WARN_LATE_MARKS:
        reasons.append(
            f"{stats.late_marks} late arrival"
            + ("s" if stats.late_marks != 1 else "")
        )
    if stats.overdue_tasks > WARN_OVERDUE_TASKS:
        reasons.append(
            f"{stats.overdue_tasks} incomplete task"
            + ("s" if stats.overdue_tasks != 1 else "")
        )
    reason_text = ", ".join(reasons) if reasons else "policy threshold exceeded"

    subject = "Warning memo — attendance & task performance"

    description = (
        f"Dear {stats.employee_name},\n\n"
        f"For the week of {period_start.strftime('%d %b %Y')} to "
        f"{period_end.strftime('%d %b %Y')}, the following was recorded "
        f"on your account: {reason_text}.\n\n"
        f"This falls below the attendance and task-completion standard "
        f"expected of every team member. Please treat this memo as a "
        f"formal warning and take immediate steps to correct the pattern.\n\n"
        f"Summary for the week:\n"
        f"  • Absent days     : {stats.absent_days}\n"
        f"  • Late arrivals   : {stats.late_marks}\n"
        f"  • Assigned tasks  : {stats.assigned_tasks}\n"
        f"  • Overdue tasks   : {stats.overdue_tasks}\n\n"
        f"If there are extenuating circumstances, please raise a help "
        f"desk ticket or speak with your reporting manager.\n\n"
        f"— Bharath Vending Corporation, HR"
    )

    # Severity scales with the count.
    severity = "MEDIUM"
    if stats.absent_days > 2 or stats.overdue_tasks > 3:
        severity = "HIGH"

    return subject, description, severity


def _appreciation_body(stats: EmployeeStats, period_start: date, period_end: date) -> tuple[str, str, str]:
    subject = "Appreciation memo — perfect week"
    description = (
        f"Dear {stats.employee_name},\n\n"
        f"For the week of {period_start.strftime('%d %b %Y')} to "
        f"{period_end.strftime('%d %b %Y')}, your record shows full "
        f"attendance and full task completion. Thank you for your "
        f"consistency — it directly contributes to what we deliver as a team.\n\n"
        f"Summary for the week:\n"
        f"  • Absent days     : {stats.absent_days}\n"
        f"  • Late arrivals   : {stats.late_marks}\n"
        f"  • Assigned tasks  : {stats.assigned_tasks}\n"
        f"  • Overdue tasks   : {stats.overdue_tasks}\n\n"
        f"Please keep it up.\n\n"
        f"— Bharath Vending Corporation, HR"
    )
    return subject, description, "LOW"


def _create_memo_and_notify(
    db: Session,
    emp: Employee,
    stats: EmployeeStats,
    memo_type: str,      # "WARNING" or "APPRECIATION"
    subject: str,
    description: str,
    severity: str,
    iso_year: int,
    iso_week: int,
    period_start: date,
    period_end: date,
) -> Optional[EmployeeMemo]:
    """Insert a memo + matching notification for the employee.
    Returns the memo, or None if one already exists for this week."""

    key = _automation_key(iso_year, iso_week, memo_type, emp.ID)

    exists = (
        db.query(EmployeeMemo)
        .filter(EmployeeMemo.AUTOMATION_KEY == key)
        .first()
    )
    if exists:
        return None

    memo = EmployeeMemo(
        MEMO_NUMBER=_next_memo_number(db),
        EMPLOYEE_ID=emp.ID,
        MEMO_TYPE=memo_type,
        SUBJECT=subject,
        DESCRIPTION=description,
        SEVERITY=severity,
        STATUS="ACTIVE",
        ISSUED_BY="System (Automation)",
        ISSUE_DATE=period_end,
        VENDOR_ID=emp.VENDOR_ID or 1,
        IS_AUTOMATED=1,
        AUTOMATION_KEY=key,
    )
    db.add(memo)
    db.flush()  # get memo.ID before creating the notification

    notif_title = (
        "Appreciation memo issued"
        if memo_type == "APPRECIATION"
        else "Warning memo issued"
    )
    notif_type = "SUCCESS" if memo_type == "APPRECIATION" else "WARNING"

    db.add(Notification(
        TITLE=notif_title,
        MESSAGE=subject,
        TYPE=notif_type,
        EMPLOYEE_ID=emp.ID,
        REF_TYPE="MEMO",
        REF_ID=memo.ID,
        VENDOR_ID=emp.VENDOR_ID or 1,
    ))

    return memo


# =====================================================================
# Public entrypoint
# =====================================================================

def run_weekly_automation(
    db: Session,
    period_start: Optional[date] = None,
    period_end:   Optional[date] = None,
) -> RunSummary:
    """Evaluate every ACTIVE employee for the given week and write the
    appropriate memos.  If dates are omitted, evaluates the PREVIOUS
    ISO week (Mon-Sun) — the intended behavior when the Monday-morning
    scheduler fires."""

    if period_start and period_end:
        # Derive the ISO week from the START of the range
        year, week, _ = period_start.isocalendar()
        start, end = period_start, period_end
    else:
        start, end, year, week = _current_week_bounds()

    employees = (
        db.query(Employee)
        .filter(Employee.STATUS == "ACTIVE")
        .all()
    )

    warnings = 0
    appreciations = 0
    skipped = 0

    for emp in employees:
        stats = _stats_for_employee(db, emp, start, end)

        # Determine memo type. Warning takes priority if triggers overlap.
        memo_type = None
        if (
            stats.absent_days   > WARN_ABSENT_DAYS
            or stats.late_marks  > WARN_LATE_MARKS
            or stats.overdue_tasks > WARN_OVERDUE_TASKS
        ):
            memo_type = "WARNING"
        elif (
            stats.absent_days   == 0
            and stats.late_marks == 0
            and stats.overdue_tasks == 0
            and stats.assigned_tasks > 0
        ):
            memo_type = "APPRECIATION"

        if not memo_type:
            continue

        if memo_type == "WARNING":
            subject, description, severity = _warning_body(stats, start, end)
        else:
            subject, description, severity = _appreciation_body(stats, start, end)

        memo = _create_memo_and_notify(
            db, emp, stats,
            memo_type=memo_type,
            subject=subject,
            description=description,
            severity=severity,
            iso_year=year, iso_week=week,
            period_start=start, period_end=end,
        )
        if memo is None:
            skipped += 1
            continue
        if memo_type == "WARNING":
            warnings += 1
        else:
            appreciations += 1

    db.commit()

    return RunSummary(
        period_start=start,
        period_end=end,
        iso_year=year,
        iso_week=week,
        employees_scanned=len(employees),
        warnings_created=warnings,
        appreciations_created=appreciations,
        skipped_existing=skipped,
        ran_at=datetime.utcnow(),
    )
