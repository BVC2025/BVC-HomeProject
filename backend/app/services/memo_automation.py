"""
Memo automation — evaluates every active employee against BVC24's
policy triggers and issues WARNING or APPRECIATION memos.

BVC24 policy (admin request, 2026-08-31):

  WARNING is generated ONLY when a continuous / long-running issue
  crosses a defined threshold. A one-off absent or two late arrivals
  is NOT enough — earlier "any late day this week" behaviour is gone.

  Warning triggers (any one is enough):
    • 5+ consecutive LATE arrivals               (LATE_STREAK_DAYS)
    • 3+ consecutive absent/leave days           (LEAVE_STREAK_DAYS)
    • A single leave request >= 7 days           (LONG_LEAVE_DAYS)
    • A task pending for >= 7 days past due      (PENDING_TASK_DAYS)

  Appreciation triggers (fires freely to motivate — no continuity
  required):
    • 10+ consecutive on-time-present days       (ONTIME_STREAK_DAYS)
    • 5+ tasks completed in the last 30 days     (TASK_COMPLETIONS)

Idempotency
    Each memo is written with a stable AUTOMATION_KEY derived from
    the streak's first-day / leave-request / task id, so re-runs
    don't produce duplicates.

Delivery
    Every memo insert is paired with a Notification row targeted at
    the employee (bell alert on their dashboard).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Attendance, EmployeeMemo, Employee, LeaveRequest, Notification,
    TaskAssignment,
)


# =====================================================================
# Thresholds — kept as constants so future admin-side settings can
# override them without touching the caller.
# =====================================================================

# --- Warning thresholds (continuous/long-running issues) ---
LATE_STREAK_DAYS      = 5   # >= this many consecutive late days
LEAVE_STREAK_DAYS     = 3   # >= this many consecutive absent/leave days
LONG_LEAVE_DAYS       = 7   # single leave request of >= this many days
PENDING_TASK_DAYS     = 7   # task open + past DUE_DATE by >= this many days

# --- Appreciation thresholds (positive signals, fire freely) ---
ONTIME_STREAK_DAYS    = 10  # >= this many consecutive on-time-present days
TASK_COMPLETIONS      = 5   # >= this many tasks completed in last 30 days

# How far back the streak scanner looks for warning triggers.
LOOKBACK_DAYS = 60


# =====================================================================
# Datatypes
# =====================================================================

@dataclass
class RunSummary:
    period_start:      date
    period_end:        date
    employees_scanned: int
    warnings_created:  int
    appreciations_created: int
    skipped_existing:  int
    ran_at:            datetime


@dataclass
class _Streak:
    """Result of walking a date range and finding the longest run of
    consecutive days matching a predicate."""
    length:     int
    first_day:  Optional[date]
    last_day:   Optional[date]


# =====================================================================
# Helpers
# =====================================================================

def _next_memo_number(db: Session) -> str:
    """MEMO-YYYY-NNNN. Sequence resets each calendar year."""
    year = datetime.utcnow().year
    prefix = f"MEMO-{year}-"
    count = (
        db.query(EmployeeMemo)
        .filter(EmployeeMemo.MEMO_NUMBER.like(f"{prefix}%"))
        .count()
    )
    return f"{prefix}{(count + 1):04d}"


def _consecutive_run(
    dates_matching: List[date],
    scan_start: date,
    scan_end: date,
) -> _Streak:
    """Given a set of dates that 'match', return the longest run of
    consecutive matching days within [scan_start, scan_end].

    Skips Sundays — an absent on Saturday followed by a working Monday
    still counts as consecutive (Sunday off doesn't break the streak).
    """
    matching = set(dates_matching)
    best = _Streak(length=0, first_day=None, last_day=None)
    current_len = 0
    current_start: Optional[date] = None

    d = scan_start
    while d <= scan_end:
        if d.weekday() == 6:  # Sunday — skip without breaking the streak
            d += timedelta(days=1)
            continue

        if d in matching:
            if current_len == 0:
                current_start = d
            current_len += 1
            if current_len > best.length:
                best = _Streak(
                    length=current_len,
                    first_day=current_start,
                    last_day=d,
                )
        else:
            current_len = 0
            current_start = None

        d += timedelta(days=1)

    return best


def _late_dates(db: Session, emp: Employee,
                start: date, end: date) -> List[date]:
    rows = (
        db.query(Attendance.DATE)
          .filter(
              Attendance.EMPLOYEE_ID == emp.ID,
              Attendance.DATE >= start,
              Attendance.DATE <= end,
              Attendance.STATUS == "LATE",
          )
          .all()
    )
    return [r[0] for r in rows if r[0] is not None]


def _absent_or_leave_dates(db: Session, emp: Employee,
                           start: date, end: date) -> List[date]:
    """Dates where the employee was ABSENT / on LOP / on LEAVE.
    Union of Attendance rows with those statuses AND any active
    LeaveRequest overlap in the window."""
    dates: set = set()

    att_rows = (
        db.query(Attendance.DATE, Attendance.STATUS)
          .filter(
              Attendance.EMPLOYEE_ID == emp.ID,
              Attendance.DATE >= start,
              Attendance.DATE <= end,
          )
          .all()
    )
    for d, status in att_rows:
        s = (status or "").upper()
        if d is None:
            continue
        if s in ("ABSENT", "LOP", "HALF_LOP", "ON_LEAVE"):
            dates.add(d)

    # Approved / pending leave requests contribute their day range too.
    lv_rows = (
        db.query(LeaveRequest)
          .filter(
              LeaveRequest.EMPLOYEE_ID == emp.ID,
              LeaveRequest.START_DATE <= end,
              LeaveRequest.END_DATE   >= start,
              LeaveRequest.STATUS.in_(["APPROVED", "PENDING_APPROVAL"]),
          )
          .all()
    )
    for lv in lv_rows:
        d = max(lv.START_DATE, start)
        stop = min(lv.END_DATE, end)
        while d <= stop:
            dates.add(d)
            d += timedelta(days=1)

    return sorted(dates)


def _present_ontime_dates(db: Session, emp: Employee,
                          start: date, end: date) -> List[date]:
    rows = (
        db.query(Attendance.DATE, Attendance.STATUS, Attendance.CHECK_IN)
          .filter(
              Attendance.EMPLOYEE_ID == emp.ID,
              Attendance.DATE >= start,
              Attendance.DATE <= end,
          )
          .all()
    )
    out: List[date] = []
    for d, status, ci in rows:
        s = (status or "").upper()
        if s == "PRESENT" and ci is not None and d is not None:
            out.append(d)
    return out


def _long_leave_requests(db: Session, emp: Employee,
                         start: date, end: date) -> List[LeaveRequest]:
    """Approved leave requests whose day-span >= LONG_LEAVE_DAYS and
    that overlap the scan window."""
    lv_rows = (
        db.query(LeaveRequest)
          .filter(
              LeaveRequest.EMPLOYEE_ID == emp.ID,
              LeaveRequest.START_DATE <= end,
              LeaveRequest.END_DATE   >= start,
              LeaveRequest.STATUS == "APPROVED",
          )
          .all()
    )
    out = []
    for lv in lv_rows:
        span = (lv.END_DATE - lv.START_DATE).days + 1
        if span >= LONG_LEAVE_DAYS:
            out.append(lv)
    return out


def _stale_tasks(db: Session, emp: Employee, today: date) -> List[TaskAssignment]:
    """Tasks assigned to the employee whose DUE_DATE is >= PENDING_TASK_DAYS
    in the past AND which are still not COMPLETED."""
    cutoff = today - timedelta(days=PENDING_TASK_DAYS)
    rows = (
        db.query(TaskAssignment)
          .filter(
              TaskAssignment.EMPLOYEE_ID == emp.ID,
              TaskAssignment.DUE_DATE.isnot(None),
              TaskAssignment.DUE_DATE <= cutoff,
          )
          .all()
    )
    return [t for t in rows
            if (t.TASK_STATUS or "").upper() not in ("COMPLETED", "DONE", "CANCELLED")]


def _recent_task_completions(db: Session, emp: Employee,
                             today: date) -> int:
    cutoff = today - timedelta(days=30)
    return (
        db.query(TaskAssignment)
          .filter(
              TaskAssignment.EMPLOYEE_ID == emp.ID,
              TaskAssignment.TASK_STATUS.in_(["COMPLETED", "DONE"]),
              TaskAssignment.UPDATED_AT >= datetime(cutoff.year, cutoff.month, cutoff.day),
          )
          .count()
    )


# =====================================================================
# Memo body helpers
# =====================================================================

def _late_streak_body(emp: Employee, streak: _Streak) -> tuple[str, str, str, str]:
    """(subject, description, severity, automation_key)"""
    key = f"AUTO-LATE-STREAK-{streak.first_day.isoformat()}-{emp.ID}"
    subject = f"Warning memo — {streak.length} consecutive late arrivals"
    description = (
        f"Dear {emp.NAME or 'Colleague'},\n\n"
        f"Our records show that you were late for work on "
        f"{streak.length} consecutive working days from "
        f"{streak.first_day.strftime('%d %b %Y')} to "
        f"{streak.last_day.strftime('%d %b %Y')}.\n\n"
        f"Repeated late attendance affects both team schedules and "
        f"your own performance record. Please treat this memo as a "
        f"formal warning and correct your arrival time going forward.\n\n"
        f"If there's a genuine reason (health, transport, family), "
        f"please raise a help-desk ticket or speak with your reporting "
        f"manager immediately.\n\n"
        f"— Bharath Vending Corporation, HR"
    )
    severity = "HIGH" if streak.length >= LATE_STREAK_DAYS + 2 else "MEDIUM"
    return subject, description, severity, key


def _leave_streak_body(emp: Employee, streak: _Streak) -> tuple[str, str, str, str]:
    key = f"AUTO-LEAVE-STREAK-{streak.first_day.isoformat()}-{emp.ID}"
    subject = f"Warning memo — {streak.length} consecutive days away"
    description = (
        f"Dear {emp.NAME or 'Colleague'},\n\n"
        f"You were away from work for {streak.length} consecutive "
        f"working days from {streak.first_day.strftime('%d %b %Y')} "
        f"to {streak.last_day.strftime('%d %b %Y')}. Continuous absence "
        f"of this duration without prior sanction breaks HR policy.\n\n"
        f"Please regularise the leave by raising a formal request or "
        f"speak with your reporting manager to explain the reason. "
        f"Repeated occurrences may lead to further action.\n\n"
        f"— Bharath Vending Corporation, HR"
    )
    severity = "HIGH" if streak.length >= LEAVE_STREAK_DAYS + 2 else "MEDIUM"
    return subject, description, severity, key


def _long_leave_body(emp: Employee, lv: LeaveRequest) -> tuple[str, str, str, str]:
    span = (lv.END_DATE - lv.START_DATE).days + 1
    key = f"AUTO-LONGLEAVE-{lv.ID}-{emp.ID}"
    subject = f"Warning memo — long leave of {span} days"
    description = (
        f"Dear {emp.NAME or 'Colleague'},\n\n"
        f"You have been on leave for {span} days from "
        f"{lv.START_DATE.strftime('%d %b %Y')} to "
        f"{lv.END_DATE.strftime('%d %b %Y')} ({lv.LEAVE_TYPE or 'Leave'}).\n\n"
        f"Extended absences disrupt project deliverables. Please make "
        f"sure your work handoff notes are shared with the team, and "
        f"that your reporting manager is aware of the return-to-work "
        f"date.\n\n"
        f"— Bharath Vending Corporation, HR"
    )
    return subject, description, "MEDIUM", key


def _pending_task_body(emp: Employee, task: TaskAssignment,
                       today: date) -> tuple[str, str, str, str]:
    key = f"AUTO-STALETASK-{task.TASK_ID}-{emp.ID}"
    days_overdue = (today - task.DUE_DATE).days if task.DUE_DATE else 0
    task_title = getattr(task, "TASK_TITLE", None) or f"Task #{task.TASK_ID}"
    subject = f"Warning memo — task overdue by {days_overdue} days"
    description = (
        f"Dear {emp.NAME or 'Colleague'},\n\n"
        f"The task \"{task_title}\" has been in your queue for "
        f"{days_overdue} days past its due date "
        f"({task.DUE_DATE.strftime('%d %b %Y') if task.DUE_DATE else '—'}) "
        f"and is still not marked as completed. Current status: "
        f"{task.TASK_STATUS or 'OPEN'}.\n\n"
        f"Please close it out today, or leave a comment on the task "
        f"explaining why it's blocked so the team can help unblock you.\n\n"
        f"— Bharath Vending Corporation, HR"
    )
    severity = "HIGH" if days_overdue >= PENDING_TASK_DAYS + 7 else "MEDIUM"
    return subject, description, severity, key


def _appreciation_streak_body(emp: Employee, streak: _Streak) -> tuple[str, str, str, str]:
    key = f"AUTO-ONTIME-STREAK-{streak.first_day.isoformat()}-{emp.ID}"
    subject = f"Appreciation memo — {streak.length} on-time days in a row"
    description = (
        f"Dear {emp.NAME or 'Colleague'},\n\n"
        f"You've maintained {streak.length} consecutive working days "
        f"of on-time arrival from "
        f"{streak.first_day.strftime('%d %b %Y')} to "
        f"{streak.last_day.strftime('%d %b %Y')}. This kind of "
        f"consistency is exactly what keeps the team moving.\n\n"
        f"Keep it going — it doesn't go unnoticed.\n\n"
        f"— Bharath Vending Corporation, HR"
    )
    return subject, description, "LOW", key


def _appreciation_tasks_body(emp: Employee, count: int,
                             today: date) -> tuple[str, str, str, str]:
    # Bucket the key by the ISO week of `today` so we don't spam the
    # same person daily. One appreciation-for-tasks per calendar week.
    iso_year, iso_week, _ = today.isocalendar()
    key = f"AUTO-TASKS-{iso_year}W{iso_week:02d}-{emp.ID}"
    subject = f"Appreciation memo — {count} tasks completed this month"
    description = (
        f"Dear {emp.NAME or 'Colleague'},\n\n"
        f"You've completed {count} tasks in the last 30 days — a strong "
        f"output level that helped the team hit its delivery targets. "
        f"Thank you for the consistent effort.\n\n"
        f"— Bharath Vending Corporation, HR"
    )
    return subject, description, "LOW", key


# =====================================================================
# Memo writer
# =====================================================================

def _create_memo_and_notify(
    db: Session,
    emp: Employee,
    memo_type: str,      # "WARNING" or "APPRECIATION"
    subject: str,
    description: str,
    severity: str,
    automation_key: str,
    issue_date: date,
) -> Optional[EmployeeMemo]:
    """Insert a memo + matching notification for the employee.
    Returns the memo, or None if one already exists for this streak/leave/task."""

    exists = (
        db.query(EmployeeMemo)
        .filter(EmployeeMemo.AUTOMATION_KEY == automation_key)
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
        ISSUE_DATE=issue_date,
        VENDOR_ID=emp.VENDOR_ID or 1,
        IS_AUTOMATED=1,
        AUTOMATION_KEY=automation_key,
    )
    db.add(memo)
    db.flush()

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
    """Scan every ACTIVE employee for continuous-issue patterns and
    positive-signal patterns; write memos when a threshold is crossed.

    Idempotent — memos are keyed off the specific streak / leave request
    / task ID, so re-runs on the same data don't produce duplicates.

    Called once a week by the scheduler in main.py. `period_start` /
    `period_end` are used only for the returned RunSummary reporting;
    the actual scan window is `today - LOOKBACK_DAYS .. today`.
    """

    today = date.today()
    scan_start = today - timedelta(days=LOOKBACK_DAYS)
    scan_end   = today
    # `period_start` / `period_end` are informational only.
    reported_start = period_start or scan_start
    reported_end   = period_end   or scan_end

    employees = (
        db.query(Employee)
          .filter(Employee.STATUS == "ACTIVE")
          .all()
    )

    warnings = 0
    appreciations = 0
    skipped = 0

    for emp in employees:
        # ---- WARNING triggers ---------------------------------------

        # 1. Late streak
        late_days = _late_dates(db, emp, scan_start, scan_end)
        late_streak = _consecutive_run(late_days, scan_start, scan_end)
        if late_streak.length >= LATE_STREAK_DAYS:
            subject, description, severity, key = _late_streak_body(emp, late_streak)
            memo = _create_memo_and_notify(
                db, emp, "WARNING", subject, description, severity, key,
                issue_date=late_streak.last_day,
            )
            if memo:
                warnings += 1
            else:
                skipped += 1

        # 2. Leave / absent streak
        leave_days = _absent_or_leave_dates(db, emp, scan_start, scan_end)
        leave_streak = _consecutive_run(leave_days, scan_start, scan_end)
        if leave_streak.length >= LEAVE_STREAK_DAYS:
            subject, description, severity, key = _leave_streak_body(emp, leave_streak)
            memo = _create_memo_and_notify(
                db, emp, "WARNING", subject, description, severity, key,
                issue_date=leave_streak.last_day,
            )
            if memo:
                warnings += 1
            else:
                skipped += 1

        # 3. Single long-leave request
        for lv in _long_leave_requests(db, emp, scan_start, scan_end):
            subject, description, severity, key = _long_leave_body(emp, lv)
            memo = _create_memo_and_notify(
                db, emp, "WARNING", subject, description, severity, key,
                issue_date=lv.END_DATE,
            )
            if memo:
                warnings += 1
            else:
                skipped += 1

        # 4. Pending / stale tasks
        for t in _stale_tasks(db, emp, today):
            subject, description, severity, key = _pending_task_body(emp, t, today)
            memo = _create_memo_and_notify(
                db, emp, "WARNING", subject, description, severity, key,
                issue_date=today,
            )
            if memo:
                warnings += 1
            else:
                skipped += 1

        # ---- APPRECIATION triggers (fire freely) --------------------

        # 5. On-time streak
        ontime_days = _present_ontime_dates(db, emp, scan_start, scan_end)
        ontime_streak = _consecutive_run(ontime_days, scan_start, scan_end)
        if ontime_streak.length >= ONTIME_STREAK_DAYS:
            subject, description, severity, key = _appreciation_streak_body(
                emp, ontime_streak)
            memo = _create_memo_and_notify(
                db, emp, "APPRECIATION", subject, description, severity, key,
                issue_date=ontime_streak.last_day,
            )
            if memo:
                appreciations += 1
            else:
                skipped += 1

        # 6. High task completion count
        tasks_done = _recent_task_completions(db, emp, today)
        if tasks_done >= TASK_COMPLETIONS:
            subject, description, severity, key = _appreciation_tasks_body(
                emp, tasks_done, today)
            memo = _create_memo_and_notify(
                db, emp, "APPRECIATION", subject, description, severity, key,
                issue_date=today,
            )
            if memo:
                appreciations += 1
            else:
                skipped += 1

    db.commit()

    return RunSummary(
        period_start=reported_start,
        period_end=reported_end,
        employees_scanned=len(employees),
        warnings_created=warnings,
        appreciations_created=appreciations,
        skipped_existing=skipped,
        ran_at=datetime.utcnow(),
    )
