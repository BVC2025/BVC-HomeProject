"""
Star-based monthly performance scoring for BVC24.

Four equal-weight dimensions, averaged for the final overall:
  Attendance   25%  — days_present / working_days × 5
  Task         25%  — completed / assigned × 5  (5 if no tasks assigned)
  Leave        25%  — 5 − unpaid_leave_days       (floor at 0)
  Permission   25%  — 5 − permission_hours / 4    (floor at 0)

All inputs read live from existing tables:
  Attendance     → days present, late, half-day
  TaskAssignment → tasks assigned + completed
  LeaveRequest   → unpaid leave + permission hours

Scores stored on PerformanceScore (one row per employee × month).
Re-running the same month overwrites the previous row so the MD
always sees fresh data.

The OVERALL_STARS this module produces drives the STAR_BONUS that
payroll adds on top of the calculated salary
(see `payroll_service.calculate_star_bonus`).
"""

import calendar
import statistics
from datetime import date, datetime, timedelta
from typing import Dict, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    Attendance,
    TaskAssignment,
    WorkOrderStageProgress,
    ProcessStage,
    Role,
    LeaveRequest,
    PerformanceScore
)


# Equal weight across all four dimensions. Must sum to 1.0.
WEIGHTS = {
    "attendance": 0.25,
    "task":       0.25,
    "leave":      0.25,
    "permission": 0.25
}

# Penalty curves — chosen to be intuitive for staff:
#   1 unpaid leave day  = −1 star  (5 unpaid days → 0★)
#   4 permission hours  = −1 star  (20h → 0★, roughly half-day×5)
LEAVE_PENALTY_PER_DAY = 1.0
PERMISSION_PENALTY_PER_HOUR = 0.25

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


def _score_leave(
    db: Session, employee_id: str,
    year: int, month: int
) -> Dict:
    """5★ if no unpaid leave was taken this month. Each unpaid leave
    day removes 1 star (floor 0). Paid leave (CASUAL/SICK/EARNED) is
    an entitlement and does not affect the score."""

    first, last = _month_range(year, month)

    unpaid_days = db.query(
        func.coalesce(func.sum(LeaveRequest.DAYS), 0.0)
    ).filter(
        LeaveRequest.EMPLOYEE_ID == employee_id,
        LeaveRequest.LEAVE_TYPE.in_(["UNPAID", "LOP"]),
        LeaveRequest.STATUS == "APPROVED",
        LeaveRequest.START_DATE >= first,
        LeaveRequest.START_DATE <= last
    ).scalar() or 0.0

    raw = 5.0 - (unpaid_days * LEAVE_PENALTY_PER_DAY)

    stars = _snap_half_star(raw)

    return {
        "unpaid_days": round(unpaid_days, 2),
        "stars": stars
    }


def _score_permission(
    db: Session, employee_id: str,
    year: int, month: int
) -> Dict:
    """5★ if no permission hours used this month. Each hour removes
    0.25 stars (i.e. 4h = 1 star, 20h = 0★)."""

    first, last = _month_range(year, month)

    hours = db.query(
        func.coalesce(func.sum(LeaveRequest.DURATION_HOURS), 0.0)
    ).filter(
        LeaveRequest.EMPLOYEE_ID == employee_id,
        LeaveRequest.LEAVE_TYPE == "PERMISSION",
        LeaveRequest.STATUS == "APPROVED",
        LeaveRequest.START_DATE >= first,
        LeaveRequest.START_DATE <= last
    ).scalar() or 0.0

    raw = 5.0 - (hours * PERMISSION_PENALTY_PER_HOUR)

    stars = _snap_half_star(raw)

    return {
        "hours": round(hours, 2),
        "stars": stars
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

    # Phase 2: vendor-aware working-day count (Sundays + declared
    # holidays). Falls back to Sundays-only if the table is empty.
    from app.services.working_days_service import working_days_in_month

    working_days = working_days_in_month(
        db, year, month,
        vendor_id=(employee.VENDOR_ID or 1),
    )

    att  = _score_attendance(db, employee.ID, year, month, working_days)

    task = _score_task_completion(db, employee.ID, year, month)

    leave = _score_leave(db, employee.ID, year, month)

    perm  = _score_permission(db, employee.ID, year, month)

    overall = (
        att["stars"]   * WEIGHTS["attendance"]
        + task["stars"]  * WEIGHTS["task"]
        + leave["stars"] * WEIGHTS["leave"]
        + perm["stars"]  * WEIGHTS["permission"]
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

    score.LEAVE_DAYS_TAKEN = leave["unpaid_days"]

    score.PERMISSION_HOURS_TAKEN = perm["hours"]

    score.ATTENDANCE_STARS = att["stars"]

    score.TASK_STARS = task["stars"]

    score.LEAVE_STARS = leave["stars"]

    score.PERMISSION_STARS = perm["stars"]

    # Legacy fields blanked so old data isn't misleading
    score.PRODUCTIVITY_STARS = 0.0

    score.CONSISTENCY_STARS = 0.0

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
        r.ID: (r.NAME or "")
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
