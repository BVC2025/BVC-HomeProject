"""
Employee Portal Dashboard
=========================

Comprehensive read endpoints (and one task-status mutation) that power
the BVC24 Manufacturing ERP "employee portal" page. Aggregates the
employee's profile, task buckets, project participation, performance
KPIs, monthly productivity report, attendance snapshot and a gamified
rewards block into a single round-trip.

Notes on field mapping
----------------------
The product spec talks about ``ta.STATUS``, ``ta.STARTED_AT``,
``ta.COMPLETED_AT`` and a separate ``Task`` entity with ``t.TITLE``.
In this codebase the source-of-truth for an assignment is the
``TaskAssignment`` row itself; its columns map as:

    ta.STATUS        -> TaskAssignment.TASK_STATUS
    ta.STARTED_AT    -> TaskAssignment.START_TIME
    ta.COMPLETED_AT  -> TaskAssignment.END_TIME
    ta.ID / t.ID     -> TaskAssignment.TASK_ID
    t.TITLE          -> TaskAssignment.TASK_NAME
    t.PRIORITY       -> TaskAssignment.PRIORITY
    t.DUE_DATE       -> TaskAssignment.DUE_DATE

The endpoint output preserves the spec's key names verbatim so the
frontend contract stays clean.
"""

from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import (
    Attendance,
    Customer,
    Department,
    Designation,
    Employee,
    LeaveRequest,
    Project,
    TaskAssignment,
    WorkOrderStageProgress,
    WorkOrder,
)
from app.services.employee_performance_service import (
    compute_performance,
    compute_monthly_productivity_report,
    award_points_on_task_complete,
)
from app.services.stage_auto_unlock_service import handle_stage_completed
from app.auth.auth_bearer import get_current_user, assert_self_or_admin


router = APIRouter()


# Shared CODE-or-UUID resolver used at the top of every portal route —
# see backstory in app/utils/employee_resolver.py.
from app.utils.employee_resolver import resolve_employee_uuid as _resolve_employee_uuid  # noqa: E402


# ---------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------
_COMPLETED_STATUSES = {"COMPLETED", "DONE"}
_IN_PROGRESS_STATUSES = {"IN_PROGRESS"}
_PENDING_STATUSES = {"PENDING"}
_ON_HOLD_STATUSES = {"ON_HOLD"}

_ALLOWED_PATCH_STATUSES = {
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "ON_HOLD",
}

_MONTH_LABELS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _iso(dt) -> Optional[str]:
    """Safe isoformat for date / datetime / None."""
    if dt is None:
        return None
    try:
        return dt.isoformat()
    except Exception:
        return None


def _remaining_days(due: Optional[date]) -> int:
    """Whole days from today to DUE_DATE (negative when overdue)."""
    if due is None:
        return 0
    today = date.today()
    return (due - today).days


def _serialize_assignment(
    ta: TaskAssignment,
    project_name: Optional[str],
) -> Dict[str, Any]:
    """Build the task entry shape required by the portal spec."""

    return {
        # Spec uses ``ta.ID`` and ``t.ID`` as separate identifiers.
        # In this schema both resolve to TaskAssignment.TASK_ID.
        "id": ta.TASK_ID,
        "task_id": ta.TASK_ID,
        "title": ta.TASK_NAME,
        "priority": getattr(ta, "PRIORITY", None),
        "due_date": _iso(ta.DUE_DATE),
        "remaining_days": _remaining_days(ta.DUE_DATE),
        "status": ta.TASK_STATUS,
        "project_name": project_name,
        "project_id": ta.PROJECT_ID,
        "started_at": _iso(ta.START_TIME),
        "completed_at": _iso(ta.END_TIME),
    }


def _classify_completion(ta: TaskAssignment) -> str:
    """Same logic as employee_performance_service._classify_completion
    — re-implemented locally because the service version is private."""
    if ta is None or ta.END_TIME is None or ta.DUE_DATE is None:
        return "unknown"
    deadline = datetime.combine(ta.DUE_DATE, datetime.max.time())
    finished = ta.END_TIME
    if finished <= deadline - timedelta(hours=24):
        return "early"
    if finished <= deadline:
        return "on_time"
    return "late"


def _points_for(ta: TaskAssignment) -> int:
    """Mirror of the service's point table — +20 / +10 / -5 / 0."""
    bucket = _classify_completion(ta)
    if bucket == "early":
        return 20
    if bucket == "on_time":
        return 10
    if bucket == "late":
        return -5
    return 0


def _compute_streak_and_badge(
    db: Session,
    employee_id: str,
) -> Dict[str, Any]:
    """
    Walk completed assignments newest-first and count how many were
    finished on time before a late one breaks the chain.

    Returns {"current_streak": int, "badge": str}.
    """

    completed_rows: List[TaskAssignment] = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == employee_id,
            TaskAssignment.END_TIME.isnot(None),
            func.upper(TaskAssignment.TASK_STATUS).in_(
                list(_COMPLETED_STATUSES)
            ),
        )
        .order_by(TaskAssignment.END_TIME.desc())
        .all()
    )

    streak = 0
    for ta in completed_rows:
        bucket = _classify_completion(ta)
        if bucket in ("early", "on_time", "unknown"):
            # "unknown" (no due date) counts toward the streak —
            # we don't punish data gaps.
            streak += 1
        else:
            break

    if streak >= 5:
        badge = "On Fire"
    elif streak >= 2:
        badge = "Steady"
    else:
        badge = "Getting Started"

    return {"current_streak": streak, "badge": badge}


def _compute_points_total(
    db: Session,
    employee_id: str,
) -> int:
    """Sum the live point value of every completed assignment."""
    rows: List[TaskAssignment] = (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == employee_id,
            func.upper(TaskAssignment.TASK_STATUS).in_(
                list(_COMPLETED_STATUSES)
            ),
        )
        .all()
    )
    return sum(_points_for(r) for r in rows)


def _attendance_summary_for_current_month(
    db: Session,
    employee_id: str,
) -> Dict[str, Any]:
    """Present / absent / leave day counts for the current month."""

    today = date.today()
    month_start = date(today.year, today.month, 1)
    if today.month == 12:
        next_month = date(today.year + 1, 1, 1)
    else:
        next_month = date(today.year, today.month + 1, 1)

    rows: List[Attendance] = (
        db.query(Attendance)
        .filter(
            Attendance.EMPLOYEE_ID == employee_id,
            Attendance.DATE >= month_start,
            Attendance.DATE < next_month,
        )
        .all()
    )

    present = 0
    absent = 0
    leave = 0
    for r in rows:
        s = (r.STATUS or "").upper()
        if s in ("PRESENT", "LATE"):
            present += 1
        elif s == "HALF_DAY":
            # half-day counts as 0.5 present, 0.5 absent
            present += 0  # tracked as a fractional day below
        elif s == "ABSENT":
            absent += 1
        elif s == "LEAVE":
            leave += 1

    # Layer LeaveRequest (APPROVED) days that overlap this month onto
    # the leave bucket — the attendance row may not exist for an
    # approved leave day.
    leave_rows: List[LeaveRequest] = (
        db.query(LeaveRequest)
        .filter(
            LeaveRequest.EMPLOYEE_ID == employee_id,
            func.upper(LeaveRequest.STATUS) == "APPROVED",
            LeaveRequest.END_DATE >= month_start,
            LeaveRequest.START_DATE < next_month,
        )
        .all()
    )
    approved_leave_days = 0.0
    for lr in leave_rows:
        if lr.DAYS:
            approved_leave_days += float(lr.DAYS)
    # Take the larger of the two signals so we don't double-count
    # attendance rows already marked LEAVE.
    leave = max(leave, int(round(approved_leave_days)))

    total = present + absent + leave
    if total > 0:
        pct = round((present / total) * 100.0, 2)
    else:
        pct = 0.0

    return {
        "present_days": int(present),
        "absent_days": int(absent),
        "leave_days": int(leave),
        "pct": float(pct),
        "month_label": f"{_MONTH_LABELS[today.month - 1]} {today.year}",
    }


def _assigned_projects_block(
    db: Session,
    employee_id: str,
) -> List[Dict[str, Any]]:
    """
    For every Project the employee has any TaskAssignment in, return
    summary stats: customer name, status, completion percentage on
    *the employee's own* slice, and a project-wide progress percent.
    """

    project_ids = [
        pid for (pid,) in (
            db.query(TaskAssignment.PROJECT_ID)
            .filter(
                TaskAssignment.EMPLOYEE_ID == employee_id,
                TaskAssignment.PROJECT_ID.isnot(None),
            )
            .distinct()
            .all()
        )
    ]

    if not project_ids:
        return []

    projects: List[Project] = (
        db.query(Project)
        .filter(Project.ID.in_(project_ids))
        .all()
    )

    # Customer lookup in one shot.
    customer_ids = {
        p.CUSTOMER_ID for p in projects if p.CUSTOMER_ID is not None
    }
    customer_name_by_id: Dict[int, str] = {}
    if customer_ids:
        for c in db.query(Customer).filter(
            Customer.ID.in_(customer_ids)
        ).all():
            customer_name_by_id[c.ID] = c.CUSTOMER_NAME

    out: List[Dict[str, Any]] = []
    for p in projects:
        # Project-wide progress %: completed / total task assignments
        total_q = (
            db.query(func.count(TaskAssignment.TASK_ID))
            .filter(TaskAssignment.PROJECT_ID == p.ID)
            .scalar()
        ) or 0

        completed_q = (
            db.query(func.count(TaskAssignment.TASK_ID))
            .filter(
                TaskAssignment.PROJECT_ID == p.ID,
                func.upper(TaskAssignment.TASK_STATUS).in_(
                    list(_COMPLETED_STATUSES)
                ),
            )
            .scalar()
        ) or 0

        if total_q > 0:
            progress_pct = round((completed_q / total_q) * 100.0, 2)
        else:
            progress_pct = 0.0

        # The employee's slice
        my_stages_count = (
            db.query(func.count(TaskAssignment.TASK_ID))
            .filter(
                TaskAssignment.PROJECT_ID == p.ID,
                TaskAssignment.EMPLOYEE_ID == employee_id,
            )
            .scalar()
        ) or 0

        my_completed_count = (
            db.query(func.count(TaskAssignment.TASK_ID))
            .filter(
                TaskAssignment.PROJECT_ID == p.ID,
                TaskAssignment.EMPLOYEE_ID == employee_id,
                func.upper(TaskAssignment.TASK_STATUS).in_(
                    list(_COMPLETED_STATUSES)
                ),
            )
            .scalar()
        ) or 0

        out.append({
            "id": p.ID,
            "name": p.PROJECT_NAME,
            "customer_name": customer_name_by_id.get(p.CUSTOMER_ID),
            "status": p.STATUS,
            "progress_pct": float(progress_pct),
            "my_stages_count": int(my_stages_count),
            "my_completed_count": int(my_completed_count),
        })

    return out


def _employee_profile(
    db: Session,
    employee_id: str,
) -> Dict[str, Any]:
    """Resolve human-readable designation + department names for the
    profile block."""

    emp: Optional[Employee] = (
        db.query(Employee)
        .filter(Employee.ID == employee_id)
        .first()
    )
    if emp is None:
        raise HTTPException(
            status_code=404,
            detail=f"Employee {employee_id} not found",
        )

    designation_title: Optional[str] = None
    if emp.DESIGNATION_ID:
        d = (
            db.query(Designation)
            .filter(Designation.ID == emp.DESIGNATION_ID)
            .first()
        )
        if d is not None:
            designation_title = d.TITLE

    department_name: Optional[str] = None
    if emp.DEPARTMENT_ID:
        d = (
            db.query(Department)
            .filter(Department.ID == emp.DEPARTMENT_ID)
            .first()
        )
        if d is not None:
            department_name = d.NAME

    return {
        "ID": emp.ID,
        "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
        "NAME": emp.NAME,
        "PHOTO_URL": getattr(emp, "PHOTO_URL", None),
        "DESIGNATION": designation_title,
        "DEPARTMENT": department_name,
    }


def _bucket_assignments(
    db: Session,
    employee_id: str,
) -> Dict[str, Any]:
    """
    Pull every TaskAssignment for the employee (with the Project
    joinedload so we can serialize the project_name without N+1) and
    fan them out into the buckets the dashboard expects.
    """

    today = date.today()
    seven_days_out = today + timedelta(days=7)

    # TaskAssignment has no declared ORM relationship to Project in
    # this codebase, so a joinedload would be a no-op here. We resolve
    # project names with a single follow-up bulk query instead.
    rows: List[TaskAssignment] = (
        db.query(TaskAssignment)
        .filter(TaskAssignment.EMPLOYEE_ID == employee_id)
        .all()
    )

    # Bulk-resolve project names so we don't issue N queries.
    project_ids = {ta.PROJECT_ID for ta in rows if ta.PROJECT_ID}
    project_name_by_id: Dict[int, str] = {}
    if project_ids:
        for p in db.query(Project).filter(
            Project.ID.in_(project_ids)
        ).all():
            project_name_by_id[p.ID] = p.PROJECT_NAME

    today_tasks: List[Dict[str, Any]] = []
    pending_tasks: List[Dict[str, Any]] = []
    in_progress_tasks: List[Dict[str, Any]] = []
    on_hold_tasks: List[Dict[str, Any]] = []
    completed_tasks_raw: List[TaskAssignment] = []
    upcoming_tasks: List[Dict[str, Any]] = []

    total = 0
    cnt_today = 0
    cnt_pending = 0
    cnt_in_progress = 0
    cnt_completed = 0
    cnt_on_hold = 0
    cnt_upcoming = 0
    cnt_overdue = 0

    for ta in rows:
        total += 1
        status = (ta.TASK_STATUS or "").upper()
        is_done = status in _COMPLETED_STATUSES

        pname = project_name_by_id.get(ta.PROJECT_ID) if ta.PROJECT_ID else None
        entry = _serialize_assignment(ta, pname)

        # Buckets are exclusive by status, but a task can ALSO be in
        # the "today" / "upcoming" / "overdue" lists in parallel.
        if status in _PENDING_STATUSES or status == "":
            pending_tasks.append(entry)
            cnt_pending += 1
        elif status in _IN_PROGRESS_STATUSES:
            in_progress_tasks.append(entry)
            cnt_in_progress += 1
        elif status in _ON_HOLD_STATUSES:
            on_hold_tasks.append(entry)
            cnt_on_hold += 1
        elif is_done:
            completed_tasks_raw.append(ta)
            cnt_completed += 1
        else:
            # Unknown status — treat as pending so totals add up.
            pending_tasks.append(entry)
            cnt_pending += 1

        if not is_done and ta.DUE_DATE is not None:
            if ta.DUE_DATE == today:
                today_tasks.append(entry)
                cnt_today += 1
            if today < ta.DUE_DATE <= seven_days_out:
                upcoming_tasks.append(entry)
                cnt_upcoming += 1
            if ta.DUE_DATE < today:
                cnt_overdue += 1

    # Last 10 completed by END_TIME desc (None last).
    completed_tasks_raw.sort(
        key=lambda r: (r.END_TIME or datetime.min),
        reverse=True,
    )
    completed_tasks = [
        _serialize_assignment(
            ta,
            project_name_by_id.get(ta.PROJECT_ID) if ta.PROJECT_ID else None,
        )
        for ta in completed_tasks_raw[:10]
    ]

    summary = {
        "total": int(total),
        "today": int(cnt_today),
        "pending": int(cnt_pending),
        "in_progress": int(cnt_in_progress),
        "completed": int(cnt_completed),
        "on_hold": int(cnt_on_hold),
        "upcoming": int(cnt_upcoming),
        "overdue": int(cnt_overdue),
    }

    return {
        "task_summary": summary,
        "today_tasks": today_tasks,
        "pending_tasks": pending_tasks,
        "in_progress_tasks": in_progress_tasks,
        "on_hold_tasks": on_hold_tasks,
        "completed_tasks": completed_tasks,
        "upcoming_tasks": upcoming_tasks,
    }


# ---------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------
class TaskStatusPatch(BaseModel):
    status: str = Field(
        ...,
        description="One of PENDING / IN_PROGRESS / COMPLETED / ON_HOLD",
    )


# ---------------------------------------------------------------------
# (1) GET /employee/{employee_id}/portal-dashboard
# ---------------------------------------------------------------------
@router.get(
    "/employee/{employee_id}/portal-dashboard",
    tags=["Employee Portal"],
)
def get_portal_dashboard(
    employee_id: str,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Single-call aggregate for the employee portal page."""

    assert_self_or_admin(employee_id, payload)

    # Accept either UUID or CODE — see _resolve_employee_uuid docstring.
    employee_id = _resolve_employee_uuid(db, employee_id)

    profile = _employee_profile(db, employee_id)
    buckets = _bucket_assignments(db, employee_id)
    assigned_projects = _assigned_projects_block(db, employee_id)
    perf = compute_performance(db, employee_id)
    monthly = compute_monthly_productivity_report(db, employee_id)
    attendance = _attendance_summary_for_current_month(db, employee_id)
    streak_info = _compute_streak_and_badge(db, employee_id)
    points_total = _compute_points_total(db, employee_id)

    # Map perf keys to the names the EmployeeDashboard frontend reads.
    # Backend service uses operational names (productivity_score,
    # on_time_completion_pct, total_points); frontend uses shorter
    # display names (score, on_time_pct, total_points_earned).
    # We expose BOTH so other consumers of `performance` keep working.
    productivity_block = {
        "score":                    float(perf.get("productivity_score") or 0),
        "rating":                   float(perf.get("overall_rating") or 0),
        "rating_label":             perf.get("rating_label") or "Getting Started",
        "badge":                    streak_info.get("badge") or "Getting Started",
        "on_time_pct":              float(perf.get("on_time_completion_pct") or 0),
        "attendance_pct":           float(perf.get("attendance_pct") or 0),
        "avg_completion_hours":     float(perf.get("avg_completion_hours") or 0),
        "project_contribution_pct": float(perf.get("project_contribution_pct") or 0),
        "delayed_tasks":            int(perf.get("delayed_tasks") or 0),
        "tasks_completed":          int(perf.get("tasks_completed") or 0),
        "tasks_total":              int(perf.get("tasks_total") or 0),
        "tasks_overdue":            int(perf.get("tasks_overdue") or 0),
        "total_points_earned":      int(perf.get("total_points") or 0),
        "current_streak":           int(streak_info.get("current_streak") or 0),
        "points_total":             int(points_total or 0),
    }

    return {
        "employee": profile,
        "profile":  profile,    # alias — some components read portal.profile
        "task_summary": buckets["task_summary"],
        "today_tasks": buckets["today_tasks"],
        "pending_tasks": buckets["pending_tasks"],
        "in_progress_tasks": buckets["in_progress_tasks"],
        "on_hold_tasks": buckets["on_hold_tasks"],
        "completed_tasks": buckets["completed_tasks"],
        "upcoming_tasks": buckets["upcoming_tasks"],
        "tasks": {
            "today":       buckets["today_tasks"],
            "pending":     buckets["pending_tasks"],
            "in_progress": buckets["in_progress_tasks"],
            "on_hold":     buckets["on_hold_tasks"],
            "upcoming":    buckets["upcoming_tasks"],
            "completed":   buckets["completed_tasks"],
        },
        "assigned_projects": assigned_projects,
        "projects":          assigned_projects,   # alias
        "performance":       perf,                # raw, backend-style names
        "productivity":      productivity_block,  # display-friendly names
        "monthly_report":       monthly,
        "monthly_productivity": monthly,          # alias — chart reads this
        "attendance_summary": attendance,
        "attendance":         attendance,         # alias
        "kpis": {
            "score":          productivity_block["score"],
            "tasks_done":     productivity_block["tasks_completed"],
            "tasks_overdue":  productivity_block["tasks_overdue"],
            "attendance_pct": productivity_block["attendance_pct"],
        },
        "rewards": {
            "points_total": int(points_total),
            "current_streak": int(streak_info["current_streak"]),
            "badge": streak_info["badge"],
        },
    }


# ---------------------------------------------------------------------
# (2) PATCH /employee/{employee_id}/tasks/{assignment_id}/status
# ---------------------------------------------------------------------
@router.patch(
    "/employee/{employee_id}/tasks/{assignment_id}/status",
    tags=["Employee Portal"],
)
def patch_task_status(
    employee_id: str,
    assignment_id: int,
    body: TaskStatusPatch,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Mutate the STATUS of one of the employee's assigned tasks and
    cascade the side-effects (points, stage unlock, performance)."""

    assert_self_or_admin(employee_id, payload)

    # Accept either UUID or CODE — see _resolve_employee_uuid docstring.
    employee_id = _resolve_employee_uuid(db, employee_id)

    new_status = (body.status or "").upper().strip()

    if new_status not in _ALLOWED_PATCH_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid status '{body.status}'. Allowed: "
                f"{sorted(_ALLOWED_PATCH_STATUSES)}"
            ),
        )

    ta: Optional[TaskAssignment] = (
        db.query(TaskAssignment)
        .filter(TaskAssignment.TASK_ID == assignment_id)
        .first()
    )

    if ta is None:
        raise HTTPException(
            status_code=404,
            detail=f"Task assignment {assignment_id} not found",
        )

    if ta.EMPLOYEE_ID != employee_id:
        raise HTTPException(
            status_code=403,
            detail="This task is not assigned to that employee.",
        )

    now = datetime.utcnow()

    points_awarded = 0
    on_time = False
    unlock_result: Optional[Dict[str, Any]] = None

    try:
        ta.TASK_STATUS = new_status

        if new_status == "IN_PROGRESS":
            # START_TIME is the schema column behind the spec's
            # STARTED_AT name.
            if ta.START_TIME is None:
                ta.START_TIME = now

        elif new_status == "COMPLETED":
            # END_TIME is the schema column behind the spec's
            # COMPLETED_AT name.
            ta.END_TIME = now
            # Flush so the points calculator (which re-reads the row)
            # sees the END_TIME we just stamped.
            db.flush()

            try:
                award = award_points_on_task_complete(db, ta.TASK_ID)
                points_awarded = int(award.get("points_awarded") or 0)
                on_time = bool(award.get("on_time"))
            except Exception as exc_pts:
                # Points are advisory; don't fail the whole commit.
                points_awarded = 0
                on_time = False
                unlock_result = {
                    "unlocked": False,
                    "reason": f"points-award failed: {exc_pts}",
                }

            # Mirror onto a paired WorkOrderStageProgress row if one
            # exists for this employee + project. We match on
            # (ASSIGNED_TO_ID == employee, WO belongs to this project,
            # STATUS != DONE) and pick the oldest in-flight stage.
            try:
                wo_progress = (
                    db.query(WorkOrderStageProgress)
                    .join(
                        WorkOrder,
                        WorkOrder.ID == WorkOrderStageProgress.WORK_ORDER_ID,
                    )
                    .filter(
                        WorkOrderStageProgress.ASSIGNED_TO_ID == employee_id,
                        WorkOrder.PROJECT_ID == ta.PROJECT_ID,
                        func.upper(WorkOrderStageProgress.STATUS).notin_(
                            ["DONE", "COMPLETED", "SKIPPED"]
                        ),
                    )
                    .order_by(WorkOrderStageProgress.ID.asc())
                    .first()
                )
                if wo_progress is not None:
                    wo_progress.STATUS = "DONE"
                    wo_progress.COMPLETED_AT = now
                    db.flush()
                    unlock_result = handle_stage_completed(
                        db, wo_progress.ID
                    )
            except Exception as exc_stage:
                # Stage unlock is best-effort; don't bury the
                # primary status update.
                if unlock_result is None:
                    unlock_result = {
                        "unlocked": False,
                        "reason": (
                            f"stage-unlock failed: {exc_stage}"
                        ),
                    }

        elif new_status == "ON_HOLD":
            # No HOLD_AT column on TaskAssignment in this schema —
            # silently skip the stamp as the spec allows.
            pass

        elif new_status == "PENDING":
            # Resetting a task — leave timestamps as historical
            # evidence; the next IN_PROGRESS transition will not
            # overwrite an existing START_TIME.
            pass

        ta.UPDATED_AT = now
        db.commit()

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update task status: {exc}",
        )

    # Refresh performance AFTER commit so the score reflects the
    # new state of the world.
    try:
        fresh_perf = compute_performance(db, employee_id)
    except Exception as exc_perf:
        fresh_perf = {
            "error": f"perf-recompute failed: {exc_perf}",
        }

    return {
        "message": (
            f"Task {assignment_id} status updated to {new_status}."
        ),
        "new_status": new_status,
        "points_awarded": int(points_awarded),
        "on_time": bool(on_time),
        "unlock_result": unlock_result,
        "performance": fresh_perf,
    }


# ---------------------------------------------------------------------
# (3) GET /employee/{employee_id}/performance-only
# ---------------------------------------------------------------------
@router.get(
    "/employee/{employee_id}/performance-only",
    tags=["Employee Portal"],
)
def get_performance_only(
    employee_id: str,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Cheap polling endpoint — just the headline performance dict."""

    assert_self_or_admin(employee_id, payload)

    # Accept either UUID or CODE — see _resolve_employee_uuid docstring.
    employee_id = _resolve_employee_uuid(db, employee_id)

    # Existence check so the polling caller gets a clean 404 rather
    # than a zero-row dict that masks a typo in the ID.
    exists = (
        db.query(Employee.ID)
        .filter(Employee.ID == employee_id)
        .first()
    )
    if exists is None:
        raise HTTPException(
            status_code=404,
            detail=f"Employee {employee_id} not found",
        )

    return compute_performance(db, employee_id)
