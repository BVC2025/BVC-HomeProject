"""
Workload-based auto-assignment.

`pick_least_loaded_employee` is the core: given a candidate
pool, returns the employee with the fewest active tasks
(PENDING + IN_PROGRESS + ON_HOLD), with stable tie-breaking.
"""

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import (
    Employee,
    TaskAssignment,
    Department,
    Project,
    Role
)


ACTIVE_TASK_STATUSES = ("PENDING", "IN_PROGRESS", "ON_HOLD")


# Roles that should NEVER receive auto-assigned tasks.
# Admins / HR are organisational, not execution roles —
# they should not be in the worker pool.
EXCLUDED_ROLES = {"SUPER_ADMIN", "ADMIN", "HR"}


def candidate_pool(
    db: Session,
    project: Project = None,
    department_id: int = None
):
    """
    Build the pool of candidate employees for an auto-assignment.

    Rules:
      - Only ACTIVE employees
      - Excludes SUPER_ADMIN / ADMIN / HR roles (organisational,
        not execution roles)
      - Scopes to the project's department when one is set;
        falls back to all eligible employees otherwise.
    """

    # Base query — active workers only, no admin/HR roles
    base_q = db.query(Employee).join(
        Role,
        Employee.ROLE_ID == Role.ID
    ).filter(
        Employee.STATUS == "ACTIVE",
        Role.NAME.notin_(EXCLUDED_ROLES)
    )

    chosen_dept = department_id

    if chosen_dept is None and project is not None:

        chosen_dept = project.DEPARTMENT_ID

    if chosen_dept is not None:

        scoped = base_q.filter(
            Employee.DEPARTMENT_ID == chosen_dept
        ).all()

        # If the dept exists but has no eligible employees,
        # fall back to all eligible employees so the request
        # still succeeds.
        if scoped:

            return scoped, chosen_dept

    return base_q.all(), None


def workload_summary(
    db: Session,
    employees: list[Employee]
):
    """
    Returns a list of dicts:
      [{EMPLOYEE, ACTIVE_COUNT}, ...]
    sorted by ACTIVE_COUNT ascending, then EMPLOYEE_CODE for
    stable tie-breaking.
    """

    if not employees:

        return []

    emp_ids = [e.ID for e in employees]

    # Aggregate active task counts in one query.
    # Only APPROVED tasks count toward an employee's workload
    # — proposals awaiting approval don't burden them yet.
    counts_rows = db.query(
        TaskAssignment.EMPLOYEE_ID,
        func.count(TaskAssignment.TASK_ID).label("cnt")
    ).filter(
        TaskAssignment.EMPLOYEE_ID.in_(emp_ids),
        TaskAssignment.TASK_STATUS.in_(ACTIVE_TASK_STATUSES),
        TaskAssignment.APPROVAL_STATUS == "APPROVED"
    ).group_by(TaskAssignment.EMPLOYEE_ID).all()

    count_map = {row[0]: row[1] for row in counts_rows}

    rows = [
        {
            "EMPLOYEE": e,
            "ACTIVE_COUNT": count_map.get(e.ID, 0)
        }
        for e in employees
    ]

    rows.sort(
        key=lambda r: (
            r["ACTIVE_COUNT"],
            r["EMPLOYEE"].EMPLOYEE_CODE or "ZZZ"
        )
    )

    return rows


def pick_least_loaded_employee(
    db: Session,
    project: Project = None,
    department_id: int = None
):
    """
    Convenience: returns (Employee, ACTIVE_COUNT, pool_dept_id)
    where ACTIVE_COUNT is the count *before* the new assignment.
    Returns (None, 0, None) if no candidates exist.
    """

    pool, dept_id = candidate_pool(db, project, department_id)

    summary = workload_summary(db, pool)

    if not summary:

        return None, 0, dept_id

    top = summary[0]

    return top["EMPLOYEE"], top["ACTIVE_COUNT"], dept_id


def serialize_summary_row(row):

    emp = row["EMPLOYEE"]

    return {
        "EMPLOYEE_ID": emp.ID,
        "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
        "NAME": emp.NAME,
        "DEPARTMENT_ID": emp.DEPARTMENT_ID,
        "ACTIVE_COUNT": row["ACTIVE_COUNT"]
    }


def department_name(db: Session, dept_id: int):

    if dept_id is None:

        return None

    d = db.query(Department).filter(Department.ID == dept_id).first()

    return d.NAME if d else None
