"""
Employee performance calculation service for the BVC24 Manufacturing
ERP employee portal.

Pure, read-only computations over the existing operational tables:

  - TaskAssignment  -- one row per task assigned to an employee
                       (TASK_STATUS, START_TIME, END_TIME, DUE_DATE)
  - Attendance      -- one row per (employee, date)
                       (STATUS in PRESENT / LATE / ABSENT / HALF_DAY)
  - WorkOrderStageProgress -- shop-floor stage work (STATUS,
                       STARTED_AT, COMPLETED_AT, ASSIGNED_TO_ID)
  - Project         -- to compute project contribution %

The functions in this module never write to the database; they only
read. All time-dependent calls (date.today / datetime.utcnow) are kept
inside function bodies so unit tests can freeze time per call.

Function map
------------
- compute_performance(db, employee_id, *, period_days=30)
      Snapshot of an employee's task / attendance numbers and a
      productivity score in [0, 100] plus a 0-5 star rating.

- compute_monthly_productivity_report(db, employee_id, months=6)
      Recent-first list of one entry per month for charting.

- award_points_on_task_complete(db, task_assignment_id)
      Pure calculation -- how many points THIS one completion is
      worth. Never persisted; the dashboard sums these live.
"""

from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models.models import (
    Attendance,
    Employee,
    Project,
    TaskAssignment,
    WorkOrderStageProgress,
)


# ---------------------------------------------------------------------
# Status vocabulary helpers
# ---------------------------------------------------------------------
# Historically two code paths have produced different "completed"
# strings on TaskAssignment: the employee-dashboard tick produces
# "COMPLETED" and the biometric auto-finisher produces "DONE". Both
# mean the same thing for performance purposes.
_COMPLETED_STATUSES = ("COMPLETED", "DONE")
_IN_PROGRESS_STATUSES = ("IN_PROGRESS",)
_PENDING_STATUSES = ("PENDING",)
_ON_HOLD_STATUSES = ("ON_HOLD",)

# Stage-progress equivalents on the production side.
_STAGE_COMPLETED_STATUSES = ("DONE", "COMPLETED")


def _safe_div(num: float, den: float) -> float:
    """Division that returns 0.0 when the denominator is 0 / None."""
    if not den:
        return 0.0
    return float(num) / float(den)


def _completion_seconds(ta: TaskAssignment) -> Optional[float]:
    """
    Total seconds spent on a single completed task assignment.
    Returns None when either timestamp is missing so callers can
    decide to skip rather than count zero.
    """
    if ta is None:
        return None
    if ta.START_TIME is None or ta.END_TIME is None:
        return None
    delta = ta.END_TIME - ta.START_TIME
    seconds = delta.total_seconds()
    if seconds < 0:
        return None
    return seconds


def _classify_completion(ta: TaskAssignment) -> str:
    """
    Categorise a completed task as 'early', 'on_time' or 'late'
    based on END_TIME vs DUE_DATE.

    Returns 'unknown' when we cannot tell (no DUE_DATE or no
    END_TIME). 'unknown' completions count as on_time for the
    on-time percentage (we don't penalise ambiguity).
    """
    if ta is None or ta.END_TIME is None or ta.DUE_DATE is None:
        return "unknown"

    # DUE_DATE is a Date; treat the deadline as end-of-day (23:59:59).
    deadline = datetime.combine(ta.DUE_DATE, datetime.max.time())
    finished = ta.END_TIME

    if finished <= deadline - timedelta(hours=24):
        return "early"
    if finished <= deadline:
        return "on_time"
    return "late"


def _points_for_completion(ta: TaskAssignment) -> int:
    """
    +20 if completed 24h+ before DUE_DATE, +10 if on-time,
    -5 if late, 0 when we can't classify.
    """
    bucket = _classify_completion(ta)
    if bucket == "early":
        return 20
    if bucket == "on_time":
        return 10
    if bucket == "late":
        return -5
    return 0


# ---------------------------------------------------------------------
# 1) compute_performance
# ---------------------------------------------------------------------
def compute_performance(
    db: Session,
    employee_id: str,
    *,
    period_days: int = 30,
) -> dict:
    """
    Build the headline performance snapshot for an employee.

    Parameters
    ----------
    db : Session
        SQLAlchemy 2.x session (read-only here).
    employee_id : str
        Employee.ID -- UUID string.
    period_days : int, keyword-only, default 30
        Size of the rolling window in days, anchored on today.

    Returns
    -------
    dict
        See module docstring / schema described by the route layer.
    """

    today = date.today()
    now = datetime.utcnow()

    if period_days is None or period_days <= 0:
        period_days = 30

    window_start = today - timedelta(days=period_days)

    # -----------------------------------------------------------------
    # Pull all task assignments in the window
    # -----------------------------------------------------------------
    assignments: list[TaskAssignment] = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == employee_id,
            or_(
                TaskAssignment.ASSIGNED_DATE >= window_start,
                TaskAssignment.ASSIGNED_DATE.is_(None),
            ),
        )
        .all()
    )

    tasks_total = len(assignments)

    tasks_completed = 0
    tasks_in_progress = 0
    tasks_pending = 0
    tasks_on_hold = 0
    tasks_overdue = 0
    delayed_tasks = 0  # late completions

    on_time_count = 0      # completions that finished on-time or early
    classified_completions = 0  # completions we could classify
    completion_seconds_total = 0.0
    completion_seconds_count = 0
    total_points = 0

    for ta in assignments:
        status = (ta.TASK_STATUS or "").upper()

        if status in _COMPLETED_STATUSES:
            tasks_completed += 1
            bucket = _classify_completion(ta)
            if bucket == "late":
                delayed_tasks += 1
            if bucket in ("early", "on_time"):
                on_time_count += 1
                classified_completions += 1
            elif bucket == "late":
                classified_completions += 1
            # 'unknown' completions skip the on-time stats entirely.

            secs = _completion_seconds(ta)
            if secs is not None:
                completion_seconds_total += secs
                completion_seconds_count += 1

            total_points += _points_for_completion(ta)

        elif status in _IN_PROGRESS_STATUSES:
            tasks_in_progress += 1
        elif status in _ON_HOLD_STATUSES:
            tasks_on_hold += 1
        elif status in _PENDING_STATUSES or status == "":
            tasks_pending += 1
        else:
            # Unknown / future status strings -- treat as pending so
            # the counts still sum to tasks_total.
            tasks_pending += 1

        # Overdue = not completed and DUE_DATE is in the past.
        if (
            status not in _COMPLETED_STATUSES
            and ta.DUE_DATE is not None
            and ta.DUE_DATE < today
        ):
            tasks_overdue += 1

    # On-time percentage. If we have no classified completions, we
    # treat the metric as 100% (no negative signal yet) -- this keeps
    # brand new employees from looking bad.
    if classified_completions > 0:
        on_time_completion_pct = round(
            (on_time_count / classified_completions) * 100.0, 2
        )
    else:
        on_time_completion_pct = 100.0 if tasks_completed == 0 else 0.0
        # If they have completions but none are classifiable, we
        # cannot reward or punish -- 0 is the conservative pick.

    # Average completion duration in hours.
    if completion_seconds_count > 0:
        avg_completion_hours = round(
            (completion_seconds_total / completion_seconds_count) / 3600.0,
            2,
        )
    else:
        avg_completion_hours = 0.0

    # -----------------------------------------------------------------
    # Attendance over the same window
    # -----------------------------------------------------------------
    attendance_rows: list[Attendance] = (
        db.query(Attendance)
        .filter(
            Attendance.EMPLOYEE_ID == employee_id,
            Attendance.DATE >= window_start,
            Attendance.DATE <= today,
        )
        .all()
    )

    present_days = 0
    counted_days = 0
    for att in attendance_rows:
        s = (att.STATUS or "").upper()
        if s in ("PRESENT", "LATE", "HALF_DAY"):
            # HALF_DAY counts as 0.5 toward attendance.
            present_days += 0.5 if s == "HALF_DAY" else 1
            counted_days += 1
        elif s in ("ABSENT", "LEAVE"):
            counted_days += 1

    attendance_pct = round(_safe_div(present_days, counted_days) * 100.0, 2)
    if counted_days == 0:
        # No attendance rows recorded yet -- assume 100% so the
        # employee isn't punished for a missing data feed.
        attendance_pct = 100.0

    # Ratio of attendance to completion -- how productively are present
    # days being spent? If they're never present, the ratio is 0.
    attendance_vs_completion_ratio = round(
        _safe_div(tasks_completed, present_days),
        2,
    )

    # -----------------------------------------------------------------
    # Project contribution: of all completed task-assignments inside
    # the employee's projects during the window, what fraction did
    # THIS employee close?
    # -----------------------------------------------------------------
    project_ids = {
        ta.PROJECT_ID for ta in assignments if ta.PROJECT_ID is not None
    }

    if project_ids:
        project_total_completed = (
            db.query(func.count(TaskAssignment.TASK_ID))
            .filter(
                TaskAssignment.PROJECT_ID.in_(project_ids),
                func.upper(TaskAssignment.TASK_STATUS).in_(
                    _COMPLETED_STATUSES
                ),
                or_(
                    TaskAssignment.ASSIGNED_DATE >= window_start,
                    TaskAssignment.ASSIGNED_DATE.is_(None),
                ),
            )
            .scalar()
        ) or 0

        project_contribution_pct = round(
            _safe_div(tasks_completed, project_total_completed) * 100.0,
            2,
        )
    else:
        project_contribution_pct = 0.0

    # Fold in shop-floor stage completions as a bonus to project
    # contribution -- they don't live in TaskAssignment but they ARE
    # real work delivered by the employee.
    stage_completed = (
        db.query(func.count(WorkOrderStageProgress.ID))
        .filter(
            WorkOrderStageProgress.ASSIGNED_TO_ID == employee_id,
            func.upper(WorkOrderStageProgress.STATUS).in_(
                _STAGE_COMPLETED_STATUSES
            ),
            WorkOrderStageProgress.COMPLETED_AT.isnot(None),
            WorkOrderStageProgress.COMPLETED_AT >= datetime.combine(
                window_start, datetime.min.time()
            ),
        )
        .scalar()
    ) or 0

    # If they've only done stage work (no task assignments in projects),
    # surface that as 100% contribution to their own slice.
    if project_contribution_pct == 0.0 and stage_completed > 0:
        project_contribution_pct = 100.0

    # -----------------------------------------------------------------
    # Productivity score
    # -----------------------------------------------------------------
    completion_rate = _safe_div(tasks_completed, max(1, tasks_total))
    base = completion_rate * 60.0
    on_time_bonus = (on_time_completion_pct / 100.0) * 30.0
    attendance_bonus = (attendance_pct / 100.0) * 10.0
    penalty = min(20.0, tasks_overdue * 2.0)

    raw_score = base + on_time_bonus + attendance_bonus - penalty
    productivity_score = round(max(0.0, min(100.0, raw_score)), 2)

    # Convert to 0-5 stars and label it.
    overall_rating = round(productivity_score / 20.0, 1)
    if overall_rating < 0:
        overall_rating = 0.0
    if overall_rating > 5:
        overall_rating = 5.0

    if overall_rating >= 4.5:
        rating_label = "Excellent"
    elif overall_rating >= 3.5:
        rating_label = "Very Good"
    elif overall_rating >= 2.5:
        rating_label = "Good"
    elif overall_rating >= 1.5:
        rating_label = "Average"
    else:
        rating_label = "Needs Improvement"

    return {
        "period_days": int(period_days),
        "tasks_total": int(tasks_total),
        "tasks_completed": int(tasks_completed),
        "tasks_in_progress": int(tasks_in_progress),
        "tasks_pending": int(tasks_pending),
        "tasks_on_hold": int(tasks_on_hold),
        "tasks_overdue": int(tasks_overdue),
        "on_time_completion_pct": float(on_time_completion_pct),
        "delayed_tasks": int(delayed_tasks),
        "avg_completion_hours": float(avg_completion_hours),
        "productivity_score": float(productivity_score),
        "attendance_pct": float(attendance_pct),
        "attendance_vs_completion_ratio": float(
            attendance_vs_completion_ratio
        ),
        "project_contribution_pct": float(project_contribution_pct),
        "overall_rating": float(overall_rating),
        "rating_label": rating_label,
        "total_points": int(total_points),
    }


# ---------------------------------------------------------------------
# 2) compute_monthly_productivity_report
# ---------------------------------------------------------------------
_MONTH_LABELS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    """First day of the month and first day of the next month."""
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 1, 1)
    return start, end


def compute_monthly_productivity_report(
    db: Session,
    employee_id: str,
    months: int = 6,
) -> list[dict]:
    """
    Per-month productivity breakdown, most recent month first.

    For each of the last `months` months we compute:
      - tasks_completed
      - on_time_pct      (early + on-time vs all classifiable completions)
      - productivity_score
            completion_rate * 60 + on_time_pct/100 * 30
            (we skip the attendance and overdue components here
            because monthly charts are about output, not punctuality)
    """

    today = date.today()

    if months is None or months <= 0:
        months = 6

    # Build the list of (year, month) anchors, most recent first.
    anchors: list[tuple[int, int]] = []
    y, m = today.year, today.month
    for _ in range(months):
        anchors.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1

    results: list[dict] = []

    for (year, month) in anchors:
        m_start, m_end = _month_bounds(year, month)

        # Tasks "in" the month = those whose ASSIGNED_DATE falls
        # in [m_start, m_end). If ASSIGNED_DATE is NULL we fall
        # back to END_TIME for completed tasks.
        rows: list[TaskAssignment] = (
            db.query(TaskAssignment)
            .filter(
                TaskAssignment.EMPLOYEE_ID == employee_id,
                or_(
                    and_(
                        TaskAssignment.ASSIGNED_DATE >= m_start,
                        TaskAssignment.ASSIGNED_DATE < m_end,
                    ),
                    and_(
                        TaskAssignment.ASSIGNED_DATE.is_(None),
                        TaskAssignment.END_TIME.isnot(None),
                        TaskAssignment.END_TIME >= datetime.combine(
                            m_start, datetime.min.time()
                        ),
                        TaskAssignment.END_TIME < datetime.combine(
                            m_end, datetime.min.time()
                        ),
                    ),
                ),
            )
            .all()
        )

        total = len(rows)
        completed = 0
        on_time = 0
        classified = 0

        for ta in rows:
            status = (ta.TASK_STATUS or "").upper()
            if status in _COMPLETED_STATUSES:
                completed += 1
                bucket = _classify_completion(ta)
                if bucket in ("early", "on_time"):
                    on_time += 1
                    classified += 1
                elif bucket == "late":
                    classified += 1

        if classified > 0:
            on_time_pct = round((on_time / classified) * 100.0, 2)
        else:
            on_time_pct = 100.0 if completed == 0 else 0.0

        completion_rate = _safe_div(completed, max(1, total))
        score_raw = completion_rate * 60.0 + (on_time_pct / 100.0) * 30.0
        productivity_score = round(max(0.0, min(100.0, score_raw)), 2)

        results.append(
            {
                "month_label": f"{_MONTH_LABELS[month - 1]} {year}",
                "tasks_completed": int(completed),
                "on_time_pct": float(on_time_pct),
                "productivity_score": float(productivity_score),
            }
        )

    return results


# ---------------------------------------------------------------------
# 3) award_points_on_task_complete
# ---------------------------------------------------------------------
def award_points_on_task_complete(
    db: Session,
    task_assignment_id: int,
) -> dict:
    """
    Pure calculator -- "how many points would this completion earn?"
    Nothing is persisted; callers (and the dashboard) sum these on
    the fly when they render the employee's points panel.

    Returns
    -------
    dict
        {
          "points_awarded": int,    # +20 / +10 / -5 / 0
          "on_time": bool,          # True for early OR on-time
          "message": str            # short human-readable reason
        }
    """

    if task_assignment_id is None:
        return {
            "points_awarded": 0,
            "on_time": False,
            "message": "No task assignment id supplied.",
        }

    ta: Optional[TaskAssignment] = (
        db.query(TaskAssignment)
        .filter(TaskAssignment.TASK_ID == task_assignment_id)
        .first()
    )

    if ta is None:
        return {
            "points_awarded": 0,
            "on_time": False,
            "message": (
                f"Task assignment #{task_assignment_id} not found."
            ),
        }

    if ta.END_TIME is None:
        return {
            "points_awarded": 0,
            "on_time": False,
            "message": (
                "Task is not completed yet (END_TIME is empty)."
            ),
        }

    if ta.DUE_DATE is None:
        # No deadline recorded -- award the on-time amount as a
        # safe default rather than penalising the employee.
        return {
            "points_awarded": 10,
            "on_time": True,
            "message": "No due date on file; awarded standard 10 points.",
        }

    bucket = _classify_completion(ta)

    if bucket == "early":
        return {
            "points_awarded": 20,
            "on_time": True,
            "message": "Completed 24h+ before due date. +20 points.",
        }
    if bucket == "on_time":
        return {
            "points_awarded": 10,
            "on_time": True,
            "message": "Completed on time. +10 points.",
        }
    if bucket == "late":
        return {
            "points_awarded": -5,
            "on_time": False,
            "message": "Completed after the due date. -5 points.",
        }

    # bucket == "unknown" -- shouldn't reach here because we already
    # short-circuit on missing END_TIME / DUE_DATE above.
    return {
        "points_awarded": 0,
        "on_time": False,
        "message": "Could not classify completion timing.",
    }
