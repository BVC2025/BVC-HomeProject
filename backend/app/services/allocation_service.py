"""
Rule-based AI allocator for biometric-triggered project & task
assignment (BVC24 — Bharath Vending Corporation).

Flow per employee per day:

  Scan 1: check-in  -> allocate first task   (SEQUENCE = 1)
  Scan 2: complete current task              -> if > 2h to shift end, allocate next (SEQUENCE = 2)
  Scan 3: complete current task              -> ... (SEQUENCE = 3)
  Last scan: no pending task remains         -> check-out

Each allocation event is logged in `daily_allocation` with the
score breakdown for full auditability. Allocation scoring is
deterministic (skill overlap + workload + project priority);
no LLM calls, no external API.
"""

from datetime import date, datetime, time, timedelta
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import (
    Employee,
    Project,
    TaskAssignment,
    DailyAllocation,
    Role
)


# Role names that should NEVER receive shop-floor task assignments
# on biometric check-in. Admins clock in to manage the ERP, not to
# execute manufacturing tasks.
_ADMIN_ROLE_NAMES = {
    "super_admin",
    "admin",
    "system_administrator",
    "manager",
}


def _is_admin_employee(db: Session, employee: Employee) -> bool:
    """True if this employee's role is an admin/management role."""

    if not employee or not employee.ROLE_ID:

        return False

    role = db.query(Role).filter(Role.ID == employee.ROLE_ID).first()

    if not role or not role.NAME:

        return False

    return role.NAME.strip().lower() in _ADMIN_ROLE_NAMES


# ---- Scoring weights -------------------------------------------------

W_SKILL = 0.6
W_WORKLOAD = 0.25
W_PRIORITY = 0.15

PRIORITY_SCORE = {
    "HIGH": 1.0,
    "MEDIUM": 0.6,
    "LOW": 0.3
}

ACTIVE_TASK_STATUSES = ("PENDING", "IN_PROGRESS", "ON_HOLD")

WORKLOAD_CAP = 8

# How much time must remain until SHIFT_END for the allocator to
# hand the employee another task after they complete one. Below
# this threshold we return "ready to leave" instead.
MIN_REMAINING_MINUTES_FOR_NEXT_TASK = 120


# ----------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------

def _split_skills(raw: Optional[str]) -> set[str]:

    if not raw:

        return set()

    return {
        s.strip().lower()
        for s in raw.split(",")
        if s.strip()
    }


def _skill_overlap(emp_skills: set[str], project_skills: set[str]) -> float:

    if not project_skills:

        return 0.5

    if not emp_skills:

        return 0.0

    matched = project_skills & emp_skills

    return len(matched) / len(project_skills)


def _employee_active_workload(db: Session, employee_id: str) -> int:

    return db.query(func.count(TaskAssignment.TASK_ID)).filter(
        TaskAssignment.EMPLOYEE_ID == employee_id,
        TaskAssignment.TASK_STATUS.in_(ACTIVE_TASK_STATUSES),
        TaskAssignment.APPROVAL_STATUS == "APPROVED"
    ).scalar() or 0


def _workload_score(active_count: int) -> float:

    if active_count >= WORKLOAD_CAP:

        return 0.0

    return 1.0 - (active_count / WORKLOAD_CAP)


def _candidate_projects(
    db: Session,
    vendor_id: int,
    department_id: Optional[int],
    exclude_project_ids: Optional[set[int]] = None
):

    base_q = db.query(Project).filter(
        Project.VENDOR_ID == vendor_id,
        Project.STATUS.in_(["PENDING", "IN_PROGRESS", "ACTIVE"])
    )

    if exclude_project_ids:

        base_q = base_q.filter(~Project.ID.in_(exclude_project_ids))

    if department_id is not None:

        scoped = base_q.filter(
            Project.DEPARTMENT_ID == department_id
        ).all()

        if scoped:

            return scoped

    return base_q.all()


def _score_project(
    employee: Employee,
    project: Project,
    active_workload: int
) -> tuple[float, dict]:

    emp_skills = _split_skills(employee.SKILLS)

    project_skills = _split_skills(project.SKILLS_REQUIRED)

    skill = _skill_overlap(emp_skills, project_skills)

    workload = _workload_score(active_workload)

    priority = PRIORITY_SCORE.get(
        (project.PRIORITY or "MEDIUM").upper(),
        0.6
    )

    total = (
        W_SKILL * skill
        + W_WORKLOAD * workload
        + W_PRIORITY * priority
    )

    breakdown = {
        "skill": round(skill, 3),
        "workload": round(workload, 3),
        "priority": round(priority, 3),
        "total": round(total, 3),
        "matched_skills": sorted(emp_skills & project_skills)
    }

    return total, breakdown


def _explain(breakdown: dict, project: Project) -> str:

    matched = breakdown.get("matched_skills") or []

    if matched:

        return (
            f"Allocated to '{project.PROJECT_NAME}' — "
            f"skills matched: {', '.join(matched)}. "
            f"Priority: {project.PRIORITY or 'MEDIUM'}."
        )

    return (
        f"Allocated to '{project.PROJECT_NAME}' — "
        f"no specific skill match; chosen on workload "
        f"and priority balance."
    )


def _create_task_assignment(
    db: Session,
    employee: Employee,
    project: Project,
    sequence: int
) -> TaskAssignment:
    """Create today's TaskAssignment for the project-name task."""

    today = date.today()

    task_name = (
        f"Task {sequence} — {project.PROJECT_NAME}"
        if sequence > 1
        else f"Today's work — {project.PROJECT_NAME}"
    )

    task_details = (
        project.DESCRIPTION
        or "Auto-allocated by biometric check-in."
    )

    assignment = TaskAssignment(
        EMPLOYEE_ID=employee.ID,
        TASK_NAME=task_name,
        TASK_DETAILS=task_details,
        ASSIGNED_DATE=today,
        DUE_DATE=today,
        TASK_STATUS="PENDING",
        APPROVAL_STATUS="APPROVED",
        ASSIGNED_BY_ID=None,
        START_TIME=datetime.utcnow(),
        UPDATED_AT=datetime.utcnow()
    )

    db.add(assignment)

    db.flush()

    return assignment


def _next_sequence(db: Session, employee_id: str, today: date) -> int:

    max_seq = db.query(func.max(DailyAllocation.SEQUENCE)).filter(
        DailyAllocation.EMPLOYEE_ID == employee_id,
        DailyAllocation.ALLOC_DATE == today
    ).scalar()

    return (max_seq or 0) + 1


def _serialize_allocation(
    alloc: DailyAllocation,
    project: Optional[Project],
    task: Optional[TaskAssignment],
    reused: bool = False
) -> dict:

    return {
        "allocated": project is not None,
        "reused_existing": reused,
        "sequence": alloc.SEQUENCE if alloc else 0,
        "score": round(alloc.SCORE or 0.0, 3) if alloc else 0,
        "breakdown": alloc.SCORE_BREAKDOWN if alloc else None,
        "reason": alloc.REASON if alloc else None,
        "project": (
            {
                "ID": project.ID,
                "PROJECT_NAME": project.PROJECT_NAME,
                "DESCRIPTION": project.DESCRIPTION,
                "PRIORITY": project.PRIORITY,
                "SKILLS_REQUIRED": project.SKILLS_REQUIRED,
                "STATUS": project.STATUS
            }
            if project else None
        ),
        "task": (
            {
                "TASK_ID": task.TASK_ID,
                "TASK_NAME": task.TASK_NAME,
                "TASK_DETAILS": task.TASK_DETAILS,
                "ASSIGNED_DATE": (
                    task.ASSIGNED_DATE.isoformat()
                    if task.ASSIGNED_DATE else None
                ),
                "DUE_DATE": (
                    task.DUE_DATE.isoformat()
                    if task.DUE_DATE else None
                ),
                "TASK_STATUS": task.TASK_STATUS,
                "START_TIME": (
                    task.START_TIME.isoformat()
                    if task.START_TIME else None
                ),
                "END_TIME": (
                    task.END_TIME.isoformat()
                    if task.END_TIME else None
                )
            }
            if task else None
        )
    }


# ----------------------------------------------------------------
# Public API
# ----------------------------------------------------------------

def get_active_task(
    db: Session,
    employee_id: str
) -> Optional[TaskAssignment]:
    """
    The employee's currently open task for today — what they
    should be working on right now. Returns None if no pending
    task remains (i.e. the employee is ready to check out).
    """

    today = date.today()

    return (
        db.query(TaskAssignment)
        .filter(
            TaskAssignment.EMPLOYEE_ID == employee_id,
            TaskAssignment.ASSIGNED_DATE == today,
            TaskAssignment.TASK_STATUS.in_(["PENDING", "IN_PROGRESS"]),
            TaskAssignment.APPROVAL_STATUS == "APPROVED"
        )
        .order_by(TaskAssignment.UPDATED_AT.desc())
        .first()
    )


def shift_end_today(employee: Employee) -> datetime:
    """Today's deadline for this employee, derived from SHIFT_END."""

    end = employee.SHIFT_END or time(18, 0)

    return datetime.combine(date.today(), end)


def complete_active_task(
    db: Session,
    employee: Employee
) -> Optional[dict]:
    """
    Mark the employee's current active task as DONE, capture the
    completion time, and return a stats dict the route layer can
    surface to the UI / store in the day's performance record.
    """

    task = get_active_task(db, employee.ID)

    if not task:

        return None

    now = datetime.now()

    task.TASK_STATUS = "DONE"

    task.END_TIME = now

    task.UPDATED_AT = now

    db.commit()

    deadline = shift_end_today(employee)

    minutes_before_deadline = round(
        (deadline - now).total_seconds() / 60,
        1
    )

    duration_minutes = None

    if task.START_TIME:

        duration_minutes = round(
            (now - task.START_TIME).total_seconds() / 60,
            1
        )

    return {
        "task_id": task.TASK_ID,
        "task_name": task.TASK_NAME,
        "project_id": None,  # project_legacy FK removed
        "completed_at": now.isoformat(),
        "duration_minutes": duration_minutes,
        "minutes_before_deadline": minutes_before_deadline,
        "on_time": minutes_before_deadline >= 0
    }


def time_remaining_to_shift_end(employee: Employee) -> float:
    """Minutes remaining until SHIFT_END today (negative if past)."""

    deadline = shift_end_today(employee)

    return (deadline - datetime.now()).total_seconds() / 60


def can_assign_next_task(employee: Employee) -> bool:

    return (
        time_remaining_to_shift_end(employee)
        >= MIN_REMAINING_MINUTES_FOR_NEXT_TASK
    )


def allocate_for_employee(
    db: Session,
    employee: Employee
) -> dict:
    """
    Score all candidate projects, allocate the best one, create
    a TaskAssignment for today, and log a DailyAllocation row.

    Used by:
      - First scan of the day (check-in)
      - Any subsequent scan after task completion when more than
        MIN_REMAINING_MINUTES_FOR_NEXT_TASK remain to shift end.

    Same-day projects the employee already worked on today are
    de-prioritized: we exclude them from the candidate pool so
    the chain of tasks shows variety. (If only one project is
    available, the exclusion is dropped.)

    Admins / SUPER_ADMIN / managers are short-circuited: they get
    a "no task allocation needed" response so their check-in still
    records attendance but doesn't generate a manufacturing task.
    """

    # Admin/management roles: log a no-op DailyAllocation so the
    # attendance audit trail is complete, but never assign a task.
    # Uses the same response shape as a regular allocation (via
    # _serialize_allocation) so the biometric endpoint + frontend
    # can render it uniformly — just with project=None and a clear
    # REASON explaining why no task was allocated.
    if _is_admin_employee(db, employee):

        today = date.today()

        sequence = _next_sequence(db, employee.ID, today)

        alloc = DailyAllocation(
            EMPLOYEE_ID=employee.ID,
            ALLOC_DATE=today,
            SEQUENCE=sequence,
            TASK_ASSIGNMENT_ID=None,
            SCORE=0.0,
            SCORE_BREAKDOWN="admin role — task allocation skipped",
            REASON=(
                f"{employee.NAME} is an administrator. Admins manage "
                f"the ERP and aren't allocated shop-floor tasks."
            ),
            VENDOR_ID=employee.VENDOR_ID
        )

        db.add(alloc)

        db.commit()

        db.refresh(alloc)

        return _serialize_allocation(alloc, project=None, task=None)

    today = date.today()

    sequence = _next_sequence(db, employee.ID, today)

    # Projects we've already allocated to this employee today.
    # DailyAllocation.PROJECT_ID (the project_legacy FK) was removed,
    # so this can no longer be tracked — always starts empty.
    already_today_ids = set()

    candidates = _candidate_projects(
        db,
        vendor_id=employee.VENDOR_ID,
        department_id=employee.DEPARTMENT_ID,
        exclude_project_ids=already_today_ids
    )

    if not candidates and already_today_ids:

        # Only previously-allocated projects remain — drop the
        # exclusion so we still allocate something.
        candidates = _candidate_projects(
            db,
            vendor_id=employee.VENDOR_ID,
            department_id=employee.DEPARTMENT_ID
        )

    if not candidates:

        alloc = DailyAllocation(
            EMPLOYEE_ID=employee.ID,
            ALLOC_DATE=today,
            SEQUENCE=sequence,
            TASK_ASSIGNMENT_ID=None,
            SCORE=0.0,
            SCORE_BREAKDOWN="no open projects",
            REASON=(
                "No open projects available for allocation. "
                "Please contact your supervisor."
            ),
            VENDOR_ID=employee.VENDOR_ID
        )

        db.add(alloc)

        db.commit()

        return _serialize_allocation(alloc, None, None)

    active_workload = _employee_active_workload(db, employee.ID)

    scored = []

    for project in candidates:

        score, breakdown = _score_project(
            employee, project, active_workload
        )

        scored.append((score, breakdown, project))

    scored.sort(key=lambda r: (-r[0], r[2].ID))

    best_score, best_breakdown, best_project = scored[0]

    task_assignment = _create_task_assignment(
        db, employee, best_project, sequence
    )

    reason = _explain(best_breakdown, best_project)

    alloc = DailyAllocation(
        EMPLOYEE_ID=employee.ID,
        ALLOC_DATE=today,
        SEQUENCE=sequence,
        TASK_ASSIGNMENT_ID=task_assignment.TASK_ID,
        SCORE=best_score,
        SCORE_BREAKDOWN=(
            f"skill={best_breakdown['skill']} "
            f"workload={best_breakdown['workload']} "
            f"priority={best_breakdown['priority']}"
        ),
        REASON=reason,
        VENDOR_ID=employee.VENDOR_ID
    )

    db.add(alloc)

    db.commit()

    db.refresh(alloc)

    return _serialize_allocation(alloc, best_project, task_assignment)


def current_allocation_view(
    db: Session,
    employee: Employee
) -> Optional[dict]:
    """
    Read-only: returns the employee's currently open task +
    its allocation context, without making any changes. Used
    when a scan happens too soon after the last allocation
    (we don't want to mark complete or re-allocate yet).
    """

    task = get_active_task(db, employee.ID)

    if not task:

        return None

    # TaskAssignment.PROJECT_ID (the project_legacy FK) was removed —
    # no remaining way to resolve a task's linked project.
    project = None

    alloc = (
        db.query(DailyAllocation)
        .filter(
            DailyAllocation.TASK_ASSIGNMENT_ID == task.TASK_ID
        )
        .first()
    )

    return _serialize_allocation(alloc, project, task, reused=True)
