"""
Performance scoring + suggested-increment engine for BVC24.

Inputs: completed TaskAssignments + Attendance rows over a date
range, joined to each employee.

Per task we measure:
  - completed_on_time:    END_TIME <= deadline (SHIFT_END that day)
  - minutes_before_deadline: how early (positive) or late (negative)
  - duration_minutes:     END_TIME - START_TIME

Aggregated per employee over the period:
  - on_time_rate:         completed_on_time / tasks_completed
  - avg_minutes_early:    mean(minutes_before_deadline) clamped >= 0
  - total_tasks:          count of completed tasks
  - performance_score (0–100):
        60 * on_time_rate
      + 25 * (avg_minutes_early / 120, capped at 1)
      + 15 * (total_tasks / target_tasks, capped at 1)

Increment band (suggested annual % raise):
  >= 90  -> 12.0%   "Outstanding"
  75–89  -> 8.0%    "Strong"
  60–74  -> 5.0%    "Meets expectations"
  40–59  -> 3.0%    "Below target"
  < 40   -> 0.0%    "Needs review"

These weights and bands are tunable constants at the top of this
file so HR can adjust without touching the rest of the system.
"""

from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    TaskAssignment,
    Attendance,
    Department
)


# ---- Weights ---------------------------------------------------------

W_ON_TIME = 60.0
W_EARLY = 25.0
W_VOLUME = 15.0

# How early (in minutes) is considered "max bonus" — diminishing
# returns above this. Two hours early before shift end = full marks.
EARLY_MINUTES_FOR_MAX_BONUS = 120

# Volume target: how many completed tasks per working day count as
# full volume score. Tasks beyond this don't add more.
TARGET_TASKS_PER_DAY = 1.5


# Bands: (min_score_inclusive, increment_percent, label)
INCREMENT_BANDS = [
    (90, 12.0, "Outstanding"),
    (75, 8.0,  "Strong"),
    (60, 5.0,  "Meets expectations"),
    (40, 3.0,  "Below target"),
    (0,  0.0,  "Needs review")
]


def _deadline_for(employee: Employee, day: date) -> datetime:

    end = employee.SHIFT_END or time(18, 0)

    return datetime.combine(day, end)


def _completed_tasks(
    db: Session,
    employee_id: str,
    date_from: date,
    date_to: date
) -> list[TaskAssignment]:
    """
    Treat both "DONE" (set by biometric auto-complete) and
    "COMPLETED" (set when an employee clicks ✓ on their dashboard)
    as completed for the performance score. Two code paths use
    different status strings historically; this normalises them.
    """

    return (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == employee_id,
            TaskAssignment.ASSIGNED_DATE >= date_from,
            TaskAssignment.ASSIGNED_DATE <= date_to,
            TaskAssignment.TASK_STATUS.in_(["DONE", "COMPLETED"]),
            TaskAssignment.END_TIME.isnot(None)
        )
        .all()
    )


def _band_for(score: float) -> tuple[float, str]:

    for threshold, pct, label in INCREMENT_BANDS:

        if score >= threshold:

            return pct, label

    return 0.0, "Needs review"


def score_employee(
    db: Session,
    employee: Employee,
    date_from: date,
    date_to: date
) -> dict:

    tasks = _completed_tasks(db, employee.ID, date_from, date_to)

    total_tasks = len(tasks)

    if total_tasks == 0:

        return {
            "EMPLOYEE_ID": employee.ID,
            "EMPLOYEE_CODE": employee.EMPLOYEE_CODE,
            "NAME": employee.NAME,
            "DEPARTMENT_ID": employee.DEPARTMENT_ID,
            "period": {
                "from": date_from.isoformat(),
                "to": date_to.isoformat()
            },
            "total_tasks_completed": 0,
            "on_time_count": 0,
            "late_count": 0,
            "on_time_rate": 0.0,
            "avg_minutes_before_deadline": 0.0,
            "avg_duration_minutes": 0.0,
            "performance_score": 0.0,
            "suggested_increment_pct": 0.0,
            "band": "No data",
            "explanation": "No completed tasks in this period."
        }

    on_time_count = 0

    minutes_before_list = []

    duration_list = []

    for t in tasks:

        deadline = _deadline_for(employee, t.ASSIGNED_DATE)

        mins_before = (
            (deadline - t.END_TIME).total_seconds() / 60
            if t.END_TIME else 0
        )

        minutes_before_list.append(mins_before)

        if mins_before >= 0:

            on_time_count += 1

        if t.START_TIME and t.END_TIME:

            duration_list.append(
                (t.END_TIME - t.START_TIME).total_seconds() / 60
            )

    on_time_rate = on_time_count / total_tasks

    avg_mins_before = sum(minutes_before_list) / len(minutes_before_list)

    avg_duration = (
        sum(duration_list) / len(duration_list)
        if duration_list else 0
    )

    # Volume normalization — how many days in the period?
    period_days = max((date_to - date_from).days + 1, 1)

    target_total = TARGET_TASKS_PER_DAY * period_days

    volume_factor = min(total_tasks / target_total, 1.0) if target_total else 0

    early_factor = max(
        min(avg_mins_before / EARLY_MINUTES_FOR_MAX_BONUS, 1.0),
        0.0
    )

    score = (
        W_ON_TIME * on_time_rate
        + W_EARLY * early_factor
        + W_VOLUME * volume_factor
    )

    score = round(min(max(score, 0), 100), 1)

    increment_pct, band_label = _band_for(score)

    explanation = (
        f"On-time {round(on_time_rate * 100)}% "
        f"({on_time_count}/{total_tasks}) · "
        f"avg {round(avg_mins_before)} min before deadline · "
        f"volume {total_tasks}/{round(target_total, 1)} target"
    )

    return {
        "EMPLOYEE_ID": employee.ID,
        "EMPLOYEE_CODE": employee.EMPLOYEE_CODE,
        "NAME": employee.NAME,
        "DEPARTMENT_ID": employee.DEPARTMENT_ID,
        "period": {
            "from": date_from.isoformat(),
            "to": date_to.isoformat()
        },
        "total_tasks_completed": total_tasks,
        "on_time_count": on_time_count,
        "late_count": total_tasks - on_time_count,
        "on_time_rate": round(on_time_rate, 3),
        "avg_minutes_before_deadline": round(avg_mins_before, 1),
        "avg_duration_minutes": round(avg_duration, 1),
        "performance_score": score,
        "suggested_increment_pct": increment_pct,
        "band": band_label,
        "explanation": explanation
    }


def score_all_employees(
    db: Session,
    vendor_id: int,
    date_from: date,
    date_to: date,
    department_id: Optional[int] = None
) -> list[dict]:

    q = db.query(Employee).filter(
        Employee.VENDOR_ID == vendor_id,
        Employee.STATUS == "ACTIVE"
    )

    if department_id is not None:

        q = q.filter(Employee.DEPARTMENT_ID == department_id)

    rows = []

    for emp in q.all():

        rows.append(score_employee(db, emp, date_from, date_to))

    # Sort by score descending so the leaderboard reads top-to-bottom
    rows.sort(key=lambda r: -r["performance_score"])

    return rows


def task_breakdown_for_employee(
    db: Session,
    employee: Employee,
    date_from: date,
    date_to: date
) -> list[dict]:
    """
    Per-task detail for the MD's drill-down view. One row per
    completed task with the minutes-early figure that drives
    the aggregate score.
    """

    tasks = _completed_tasks(db, employee.ID, date_from, date_to)

    out = []

    for t in tasks:

        deadline = _deadline_for(employee, t.ASSIGNED_DATE)

        mins_before = (
            (deadline - t.END_TIME).total_seconds() / 60
            if t.END_TIME else 0
        )

        duration = (
            (t.END_TIME - t.START_TIME).total_seconds() / 60
            if (t.START_TIME and t.END_TIME) else None
        )

        out.append({
            "TASK_ID": t.TASK_ID,
            "TASK_NAME": t.TASK_NAME,
            "ASSIGNED_DATE": (
                t.ASSIGNED_DATE.isoformat()
                if t.ASSIGNED_DATE else None
            ),
            "START_TIME": (
                t.START_TIME.isoformat()
                if t.START_TIME else None
            ),
            "END_TIME": (
                t.END_TIME.isoformat()
                if t.END_TIME else None
            ),
            "duration_minutes": (
                round(duration, 1) if duration is not None else None
            ),
            "minutes_before_deadline": round(mins_before, 1),
            "on_time": mins_before >= 0
        })

    out.sort(key=lambda r: r["ASSIGNED_DATE"] or "", reverse=True)

    return out
