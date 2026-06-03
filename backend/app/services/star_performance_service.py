"""
Star-based monthly performance scoring for BVC24.

Four dimensions, weighted average for final overall:
  Attendance      25%  — days_present / working_days × 5
  Task Completion 30%  — on_time_completed / assigned × 5
  Productivity    25%  — estimated_hours / actual_hours × 5  (cap 5)
  Consistency     20%  — 5 − stddev(weekly_completion_rates)

All inputs read live from existing tables:
  Attendance              → days present, late, half-day
  TaskAssignment          → tasks assigned + completed + on-time
  WorkOrderStageProgress  → estimated + actual hours via STARTED_AT/COMPLETED_AT

Scores stored on PerformanceScore (one row per employee × month).
Re-running the same month overwrites the previous row so the MD
always sees fresh data.

This module is distinct from the legacy `performance_service.py`
which scored employees by per-task on-time / minutes-before-deadline.
That older flow drives the existing MD Review tab; this module
powers the new Star Performance Rating page.
"""

import calendar
import statistics
from datetime import date, datetime, timedelta
from typing import Dict, Tuple

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    Attendance,
    TaskAssignment,
    WorkOrderStageProgress,
    ProcessStage,
    Role,
    PerformanceScore
)


# Weight per dimension. Must sum to 1.0.
WEIGHTS = {
    "attendance":  0.25,
    "task":        0.30,
    "productivity": 0.25,
    "consistency": 0.20
}

# Roles excluded from scoring — admins manage the system, they
# don't run shop-floor work, so their stars would be misleading.
EXCLUDED_ROLES = {
    "super_admin", "admin", "system_administrator"
}


# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

def _month_range(year: int, month: int) -> Tuple[date, date]:

    first = date(year, month, 1)

    last_dom = calendar.monthrange(year, month)[1]

    return first, date(year, month, last_dom)


def _working_days_in_month(year: int, month: int) -> int:
    """Mon-Sat counted (Sundays off)."""

    first, last = _month_range(year, month)

    days = 0

    cursor = first

    while cursor <= last:

        if cursor.weekday() != 6:

            days += 1

        cursor = date.fromordinal(cursor.toordinal() + 1)

    return days


def _is_excluded_role(role_name: str) -> bool:

    return (role_name or "").strip().lower() in EXCLUDED_ROLES


def _snap_half_star(value: float) -> float:
    """Round to nearest 0.5, clamp to [0, 5]."""

    snapped = round(value * 2) / 2

    return max(0.0, min(5.0, snapped))


# ----------------------------------------------------------------
# Dimension calculators
# ----------------------------------------------------------------

def _score_attendance(
    db: Session, employee_id: str,
    year: int, month: int, working_days: int
) -> Dict:

    first, last = _month_range(year, month)

    rows = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == employee_id,
        Attendance.DATE >= first,
        Attendance.DATE <= last
    ).all()

    days_present = 0.0

    half_days = 0.0

    for r in rows:

        st = (r.STATUS or "").upper()

        if st == "HALF_DAY":

            half_days += 1

        elif st in ("PRESENT", "LATE"):

            days_present += 1

    effective = days_present + (half_days * 0.5)

    ratio = effective / working_days if working_days else 0

    stars = _snap_half_star(ratio * 5)

    return {
        "days_present": days_present,
        "half_days": half_days,
        "stars": stars,
        "ratio": round(ratio, 3)
    }


def _score_task_completion(
    db: Session, employee_id: str,
    year: int, month: int
) -> Dict:
    """Stars = (tasks completed on-time / tasks assigned in scope) × 5."""

    first, last = _month_range(year, month)

    first_dt = datetime(first.year, first.month, first.day)

    last_dt = datetime(last.year, last.month, last.day, 23, 59, 59)

    # Tasks active during this month: assigned within the month OR
    # carrying over from before but updated/completed inside it.
    assigned = db.query(TaskAssignment).filter(
        TaskAssignment.EMPLOYEE_ID == employee_id,
        TaskAssignment.ASSIGNED_DATE <= last,
        TaskAssignment.ASSIGNED_DATE >= first - timedelta(days=60)
    ).all()

    total_assigned = len(assigned)

    completed = 0

    on_time = 0

    for t in assigned:

        if (t.TASK_STATUS or "").upper() in ("COMPLETED", "DONE"):

            completed_at = t.UPDATED_AT

            if completed_at and first_dt <= completed_at <= last_dt:

                completed += 1

                if not t.DUE_DATE or completed_at.date() <= t.DUE_DATE:

                    on_time += 1

    ratio = (on_time / total_assigned) if total_assigned else 0

    stars = _snap_half_star(ratio * 5)

    return {
        "assigned": total_assigned,
        "completed": completed,
        "on_time": on_time,
        "stars": stars,
        "ratio": round(ratio, 3)
    }


def _score_productivity(
    db: Session, employee_id: str,
    year: int, month: int
) -> Dict:
    """Stars based on estimated vs actual hours on completed stages."""

    first, last = _month_range(year, month)

    rows = (
        db.query(WorkOrderStageProgress, ProcessStage)
        .join(ProcessStage,
              WorkOrderStageProgress.STAGE_ID == ProcessStage.ID)
        .filter(
            WorkOrderStageProgress.ASSIGNED_TO_ID == employee_id,
            WorkOrderStageProgress.STATUS == "DONE",
            WorkOrderStageProgress.COMPLETED_AT.isnot(None)
        )
        .all()
    )

    estimated = 0.0

    actual = 0.0

    for prog, stage in rows:

        if not prog.COMPLETED_AT:

            continue

        if not (first <= prog.COMPLETED_AT.date() <= last):

            continue

        est = float(stage.ESTIMATED_HOURS or 0)

        estimated += est

        if prog.STARTED_AT:

            elapsed_h = (
                prog.COMPLETED_AT - prog.STARTED_AT
            ).total_seconds() / 3600.0

            actual += max(0.5, elapsed_h)

        else:

            actual += est

    if actual <= 0 or estimated <= 0:

        return {
            "estimated_hours": round(estimated, 2),
            "actual_hours": round(actual, 2),
            "stars": 2.5,
            "ratio": 1.0
        }

    ratio = estimated / actual

    # Cap at 1.0 — finishing in half the time still maxes at 5★
    stars = _snap_half_star(min(ratio, 1.0) * 5)

    return {
        "estimated_hours": round(estimated, 2),
        "actual_hours": round(actual, 2),
        "stars": stars,
        "ratio": round(ratio, 3)
    }


def _score_consistency(
    db: Session, employee_id: str,
    year: int, month: int
) -> Dict:
    """Penalize high variance across weekly completion counts."""

    first, last = _month_range(year, month)

    weekly_counts = []

    cursor = first

    while cursor <= last:

        week_end = min(cursor + timedelta(days=6), last)

        cnt = db.query(TaskAssignment).filter(
            TaskAssignment.EMPLOYEE_ID == employee_id,
            TaskAssignment.TASK_STATUS.in_(["COMPLETED", "DONE"]),
            TaskAssignment.UPDATED_AT >= datetime(
                cursor.year, cursor.month, cursor.day
            ),
            TaskAssignment.UPDATED_AT < datetime(
                week_end.year, week_end.month, week_end.day, 23, 59, 59
            )
        ).count()

        weekly_counts.append(cnt)

        cursor = week_end + timedelta(days=1)

    if len(weekly_counts) < 2:

        return {
            "weekly_counts": weekly_counts,
            "stddev": 0,
            "stars": 2.5
        }

    sd = statistics.stdev(weekly_counts) if len(weekly_counts) > 1 else 0

    # Map stddev → stars: sd=0 → 5★, sd≥5 → 0★
    stars = _snap_half_star(max(0.0, 5.0 - sd))

    return {
        "weekly_counts": weekly_counts,
        "stddev": round(sd, 3),
        "stars": stars
    }


# ----------------------------------------------------------------
# Public API
# ----------------------------------------------------------------

def compute_performance_for_employee(
    db: Session,
    employee: Employee,
    year: int,
    month: int
) -> PerformanceScore:
    """Idempotently compute one employee's PerformanceScore for the
    period. Overwrites the existing row if one exists."""

    working_days = _working_days_in_month(year, month)

    att = _score_attendance(
        db, employee.ID, year, month, working_days
    )

    task = _score_task_completion(db, employee.ID, year, month)

    prod = _score_productivity(db, employee.ID, year, month)

    cons = _score_consistency(db, employee.ID, year, month)

    overall = (
        att["stars"] * WEIGHTS["attendance"]
        + task["stars"] * WEIGHTS["task"]
        + prod["stars"] * WEIGHTS["productivity"]
        + cons["stars"] * WEIGHTS["consistency"]
    )

    overall = _snap_half_star(overall)

    score = db.query(PerformanceScore).filter(
        PerformanceScore.EMPLOYEE_ID == employee.ID,
        PerformanceScore.PAY_YEAR == year,
        PerformanceScore.PAY_MONTH == month
    ).first()

    if not score:

        score = PerformanceScore(
            EMPLOYEE_ID=employee.ID,
            PAY_YEAR=year,
            PAY_MONTH=month
        )

        db.add(score)

    score.WORKING_DAYS = working_days

    score.DAYS_PRESENT = att["days_present"]

    score.HALF_DAYS = att["half_days"]

    score.TASKS_ASSIGNED = task["assigned"]

    score.TASKS_COMPLETED = task["completed"]

    score.TASKS_ON_TIME = task["on_time"]

    score.ESTIMATED_HOURS = prod["estimated_hours"]

    score.ACTUAL_HOURS = prod["actual_hours"]

    score.ATTENDANCE_STARS = att["stars"]

    score.TASK_STARS = task["stars"]

    score.PRODUCTIVITY_STARS = prod["stars"]

    score.CONSISTENCY_STARS = cons["stars"]

    score.OVERALL_STARS = overall

    db.flush()

    return score


def compute_performance_for_all(
    db: Session,
    vendor_id: int,
    year: int,
    month: int
) -> Dict:
    """Compute scores for every active non-admin employee. Returns
    a summary dict for the API response."""

    role_cache = {
        r.ID: (r.ROLE_NAME or "")
        for r in db.query(Role).all()
    }

    employees = db.query(Employee).filter(
        Employee.VENDOR_ID == vendor_id,
        Employee.STATUS == "ACTIVE"
    ).all()

    eligible = [
        e for e in employees
        if not _is_excluded_role(role_cache.get(e.ROLE_ID, ""))
    ]

    scored = 0

    for emp in eligible:

        try:

            compute_performance_for_employee(db, emp, year, month)

            scored += 1

        except Exception:

            db.rollback()

    db.commit()

    return {
        "year": year,
        "month": month,
        "total_employees": len(employees),
        "eligible_employees": len(eligible),
        "scored": scored
    }
