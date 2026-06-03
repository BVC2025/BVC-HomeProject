from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta, time
from collections import defaultdict

from app.database.database import get_db

from app.models.models import (
    Employee,
    Department,
    Role,
    Project,
    TaskAssignment,
    Attendance,
    Notification,
    Setting
)

from app.schemas.employee_task_schema import (
    EmployeeLogin,
    EmployeeLogout,
    TaskStatusUpdate,
    TaskAssignmentCreate,
    DayUpdate
)

from app.auth.auth_bearer import get_current_employee

from app.services.auth_service import (
    find_employee_by_login,
    verify_password,
    build_login_response,
    hash_password
)

from app.services.seed_data import EMPLOYEES, TASKS

from app.services.workload_service import (
    candidate_pool,
    workload_summary,
    pick_least_loaded_employee,
    serialize_summary_row,
    department_name
)

from app.services.email_service import send_task_assignment_email

from app.services.attendance_settings_service import (
    get_office_hours,
    is_before_end,
    get_grace_minutes
)

from app.services.leave_service import auto_create_permission


router = APIRouter()


WORK_START_HOUR = 10
WORK_START_MINUTE = 0

CURRENT_DAY_KEY = "current_project_day"

VALID_TASK_STATUSES = {
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "ON_HOLD"
}


# =========================
# HELPERS
# =========================

def compute_login_status(login_dt: datetime, cutoff: time) -> str:
    """Cutoff is the configured office start time (Setting-driven).
    Login at or before the cutoff = PRESENT, after = LATE."""

    return "LATE" if login_dt.time() > cutoff else "PRESENT"


def ensure_today_attendance(
    db: Session,
    employee_id: str,
    now: datetime,
    vendor_id: int
):

    today = now.date()

    start, _ = get_office_hours(db)

    row = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == employee_id,
        Attendance.DATE == today
    ).first()

    if row is None:

        row = Attendance(
            EMPLOYEE_ID=employee_id,
            DATE=today,
            CHECK_IN=now,
            STATUS=compute_login_status(now, start),
            VENDOR_ID=vendor_id
        )

        db.add(row)

        db.commit()

        db.refresh(row)

        return row, True

    if row.CHECK_IN is None:

        row.CHECK_IN = now

        row.STATUS = compute_login_status(now, start)

        db.commit()

        db.refresh(row)

        return row, True

    return row, False


def get_pending_from_yesterday(
    db: Session,
    employee_id: str,
    today: date
):

    yesterday = today - timedelta(days=1)

    return db.query(TaskAssignment).filter(
        TaskAssignment.EMPLOYEE_ID == employee_id,
        TaskAssignment.ASSIGNED_DATE == yesterday,
        TaskAssignment.TASK_STATUS != "COMPLETED"
    ).all()


def push_notification(
    db: Session,
    title: str,
    message: str,
    ntype: str = "INFO",
    vendor_id: int = 1
):

    notif = Notification(
        TITLE=title,
        MESSAGE=message,
        TYPE=ntype,
        IS_READ=0,
        CREATED_AT=datetime.utcnow(),
        VENDOR_ID=vendor_id
    )

    db.add(notif)

    db.commit()


def serialize_task(
    t: TaskAssignment,
    project_name: str = None,
    assigned_by_name: str = None,
    project_priority: str = None
):
    """Serialize a TaskAssignment for the employee dashboard.

    Backward-compatible: all existing fields are preserved.
    New fields surfaced for the unified Employee Dashboard:
      - PRIORITY            (task-level if column present, else
                             falls back to the parent project's
                             priority, else None)
      - ASSIGNED_BY_NAME    (resolved from ASSIGNED_BY_ID join)
      - APPROVAL_STATUS     (already on the model — exposed here)
      - ASSIGNED_DATE_TIME  (UPDATED_AT alias — task creation/
                             update timestamp the UI shows)
    """

    # Task-level PRIORITY column was added in a recent migration;
    # tolerate older rows where it's missing or NULL by falling
    # back to the parent project's priority.
    task_priority = getattr(t, "PRIORITY", None) or project_priority

    return {
        "TASK_ID": t.TASK_ID,
        "EMPLOYEE_ID": t.EMPLOYEE_ID,
        "PROJECT_ID": t.PROJECT_ID,
        "PROJECT_NAME": project_name,
        "TASK_NAME": t.TASK_NAME,
        "TASK_DETAILS": t.TASK_DETAILS,
        "ASSIGNED_DATE": (
            t.ASSIGNED_DATE.isoformat()
            if t.ASSIGNED_DATE else None
        ),
        "ASSIGNED_DATE_TIME": (
            t.UPDATED_AT.isoformat()
            if t.UPDATED_AT else None
        ),
        "DUE_DATE": (
            t.DUE_DATE.isoformat()
            if t.DUE_DATE else None
        ),
        "PRIORITY": task_priority,
        "TASK_STATUS": t.TASK_STATUS,
        "APPROVAL_STATUS": getattr(t, "APPROVAL_STATUS", None),
        "ASSIGNED_BY_ID": t.ASSIGNED_BY_ID,
        "ASSIGNED_BY_NAME": assigned_by_name,
        "START_TIME": (
            t.START_TIME.isoformat()
            if t.START_TIME else None
        ),
        "END_TIME": (
            t.END_TIME.isoformat()
            if t.END_TIME else None
        ),
        "UPDATED_AT": (
            t.UPDATED_AT.isoformat()
            if t.UPDATED_AT else None
        )
    }


def get_current_day(db):

    row = db.query(Setting).filter(
        Setting.KEY == CURRENT_DAY_KEY
    ).first()

    if not row:

        return 1

    try:

        return max(1, min(30, int(row.VALUE)))

    except (ValueError, TypeError):

        return 1


def set_current_day(db, day):

    day = max(1, min(30, int(day)))

    row = db.query(Setting).filter(
        Setting.KEY == CURRENT_DAY_KEY
    ).first()

    if row:

        row.VALUE = str(day)

        row.UPDATED_AT = datetime.utcnow()

    else:

        row = Setting(
            KEY=CURRENT_DAY_KEY,
            VALUE=str(day),
            UPDATED_AT=datetime.utcnow()
        )

        db.add(row)

    db.commit()

    return day


# =========================
# SEED DEMO DATA
# =========================

@router.post("/seed-employees")
def seed_employees(
    db: Session = Depends(get_db)
):
    """
    Idempotent demo seed. Creates the 10 demo employees
    (EMP001..EMP010) under the right department + role,
    bcrypt-hashes the seed passwords, and gives each a
    starter task for today.

    Requires Module 1's /seed-org to have been run first
    so that Department + Role rows exist.
    """

    employee_role = db.query(Role).filter(
        Role.ROLE_NAME == "EMPLOYEE"
    ).first()

    if not employee_role:

        raise HTTPException(
            status_code=400,
            detail=(
                "EMPLOYEE role not found. Run "
                "/seed-org first."
            )
        )

    # Map department name → ID for fast lookup
    dept_map = {
        d.NAME: d.ID
        for d in db.query(Department).all()
    }

    today = date.today()

    employees_created = 0

    for emp_seed in EMPLOYEES:

        code = emp_seed["EMPLOYEE_ID"]

        existing = db.query(Employee).filter(
            Employee.EMPLOYEE_CODE == code
        ).first()

        if existing:

            # Backfill department / role / status / password
            changed = False

            if not existing.DEPARTMENT_ID and emp_seed.get("DEPARTMENT"):

                target_dept = emp_seed["DEPARTMENT"]

                # Try exact then a couple of fuzzy variants
                dept_id = (
                    dept_map.get(target_dept)
                    or dept_map.get(target_dept.title())
                    or dept_map.get("Quality Control")
                    if target_dept == "Quality Control"
                    else dept_map.get(target_dept)
                )

                if dept_id:

                    existing.DEPARTMENT_ID = dept_id

                    changed = True

            if not existing.ROLE_ID:

                existing.ROLE_ID = employee_role.ID

                changed = True

            if not existing.STATUS:

                existing.STATUS = "ACTIVE"

                changed = True

            if (
                existing.PASSWORD
                and not existing.PASSWORD.startswith("$2")
            ):

                existing.PASSWORD = hash_password(existing.PASSWORD)

                changed = True

            if changed:

                db.commit()

            continue

        dept_id = (
            dept_map.get(emp_seed["DEPARTMENT"])
            or dept_map.get(emp_seed["DEPARTMENT"].title())
        )

        emp = Employee(
            EMPLOYEE_CODE=code,
            NAME=emp_seed["EMPLOYEE_NAME"],
            PASSWORD=hash_password(emp_seed["PASSWORD"]),
            DEPARTMENT_ID=dept_id,
            ROLE_ID=employee_role.ID,
            STATUS="ACTIVE",
            VENDOR_ID=1,
            JOINING_DATE=today
        )

        db.add(emp)

        db.flush()

        employees_created += 1

    db.commit()

    # Seed today's task for each demo employee
    tasks_created = 0

    for emp_code, plan in TASKS.items():

        if not plan:

            continue

        emp = db.query(Employee).filter(
            Employee.EMPLOYEE_CODE == emp_code
        ).first()

        if not emp:

            continue

        has_today = db.query(TaskAssignment).filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            TaskAssignment.ASSIGNED_DATE == today
        ).first()

        if has_today:

            continue

        name, details = plan[0]

        db.add(TaskAssignment(
            EMPLOYEE_ID=emp.ID,
            TASK_NAME=name,
            TASK_DETAILS=details,
            ASSIGNED_DATE=today,
            DUE_DATE=today,
            TASK_STATUS="PENDING"
        ))

        tasks_created += 1

    db.commit()

    return {
        "message": (
            "Demo employees + today's tasks seeded"
            if (employees_created + tasks_created) > 0
            else "Already in sync"
        ),
        "employees_created": employees_created,
        "tasks_created": tasks_created
    }


@router.delete("/seed-employees")
def reset_seed(
    db: Session = Depends(get_db)
):
    """
    Scoped reset — wipes ONLY the demo (EMP*) employees and
    THEIR attendance + task assignments. Any other employee's
    attendance is preserved.
    """

    demo_ids = [
        row[0] for row in db.query(Employee.ID).filter(
            Employee.EMPLOYEE_CODE.like("EMP%")
        ).all()
    ]

    if not demo_ids:

        return {
            "message": "No demo employees found — nothing to reset.",
            "deleted_employees": 0,
            "deleted_attendance": 0,
            "deleted_tasks": 0
        }

    deleted_tasks = db.query(TaskAssignment).filter(
        TaskAssignment.EMPLOYEE_ID.in_(demo_ids)
    ).delete(synchronize_session=False)

    deleted_attendance = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID.in_(demo_ids)
    ).delete(synchronize_session=False)

    deleted_employees = db.query(Employee).filter(
        Employee.ID.in_(demo_ids)
    ).delete(synchronize_session=False)

    db.commit()

    return {
        "message": (
            f"Cleared {deleted_employees} demo employee(s) "
            f"and their data. Other employees + their "
            f"attendance are preserved."
        ),
        "deleted_employees": deleted_employees,
        "deleted_attendance": deleted_attendance,
        "deleted_tasks": deleted_tasks
    }


# =========================
# SEED ADMIN
# =========================

@router.post("/seed-admin")
def seed_admin(
    db: Session = Depends(get_db)
):
    """
    Creates the default admin login if it doesn't already exist.
    Login: code='ADMIN', password='admin123'.
    Change the password immediately after first login.
    """

    super_role = db.query(Role).filter(
        Role.ROLE_NAME == "SUPER_ADMIN"
    ).first()

    if not super_role:

        raise HTTPException(
            status_code=400,
            detail="SUPER_ADMIN role not found. Run /seed-org first."
        )

    existing = db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == "ADMIN"
    ).first()

    if existing:

        # Always force-reset the admin password on each seed call
        existing.PASSWORD = hash_password("admin123")

        existing.ROLE_ID = super_role.ID

        existing.STATUS = "ACTIVE"

        db.commit()

        return {
            "message": "Admin already existed — password reset to 'admin123'"
        }

    admin = Employee(
        EMPLOYEE_CODE="ADMIN",
        NAME="System Administrator",
        EMAIL="admin@bharath-vending.com",
        PASSWORD=hash_password("admin123"),
        ROLE_ID=super_role.ID,
        STATUS="ACTIVE",
        VENDOR_ID=1,
        JOINING_DATE=date.today()
    )

    db.add(admin)

    db.commit()

    return {
        "message": (
            "Admin created. Login with EMPLOYEE_CODE='ADMIN' "
            "/ PASSWORD='admin123' and change the password."
        ),
        "employee_id": admin.ID
    }


# =========================
# EMPLOYEE LOGIN
# =========================

@router.post("/employee-login")
def employee_login(
    data: EmployeeLogin,
    db: Session = Depends(get_db)
):

    emp = find_employee_by_login(db, data.EMPLOYEE_ID)

    if not emp:

        raise HTTPException(
            status_code=404,
            detail="Employee not found"
        )

    if emp.STATUS and emp.STATUS.upper() != "ACTIVE":

        raise HTTPException(
            status_code=403,
            detail=f"Account is {emp.STATUS}"
        )

    if not verify_password(data.PASSWORD, emp.PASSWORD):

        raise HTTPException(
            status_code=401,
            detail="Invalid password"
        )

    now = datetime.now()

    attendance, fresh = ensure_today_attendance(
        db,
        emp.ID,
        now,
        emp.VENDOR_ID or 1
    )

    pending_yesterday = get_pending_from_yesterday(
        db,
        emp.ID,
        now.date()
    )

    if fresh and attendance.STATUS == "LATE":

        push_notification(
            db,
            title=f"Late login: {emp.NAME}",
            message=(
                f"{emp.EMPLOYEE_CODE} logged in at "
                f"{now.strftime('%H:%M')} "
                f"(after 10:00 AM cutoff)."
            ),
            ntype="WARNING",
            vendor_id=emp.VENDOR_ID or 1
        )

        # Phase D — auto-create a LATE_COMING Permission row when
        # the employee is past the configured grace window.
        try:

            office_start, _ = get_office_hours(db)

            late_grace_min, _ = get_grace_minutes(db)

            start_dt = datetime.combine(now.date(), office_start)

            minutes_late = max(0, int((now - start_dt).total_seconds() // 60))

            if minutes_late > late_grace_min:

                hours_late = round(minutes_late / 60.0, 2)

                auto_create_permission(
                    db,
                    employee_id=emp.ID,
                    on_date=now.date(),
                    subtype="LATE_COMING",
                    duration_hours=hours_late,
                    reason=(
                        f"Auto-recorded: logged in at "
                        f"{now.strftime('%H:%M')} "
                        f"({minutes_late} min after "
                        f"{office_start.strftime('%H:%M')} cutoff, "
                        f"beyond {late_grace_min} min grace)."
                    ),
                    vendor_id=emp.VENDOR_ID or 1
                )

        except Exception:

            # Best-effort: never block login on the permission write
            pass

    if fresh and pending_yesterday:

        push_notification(
            db,
            title="Pending tasks from yesterday",
            message=(
                f"{emp.NAME} has "
                f"{len(pending_yesterday)} task(s) "
                f"pending from yesterday."
            ),
            ntype="WARNING",
            vendor_id=emp.VENDOR_ID or 1
        )

    response = build_login_response(db, emp)

    response.update({
        "LOGIN_TIME": (
            attendance.CHECK_IN.isoformat()
            if attendance.CHECK_IN else None
        ),
        "ATTENDANCE_STATUS": attendance.STATUS,
        "HAS_PENDING_FROM_YESTERDAY": bool(pending_yesterday),
        "PENDING_FROM_YESTERDAY": [
            serialize_task(t) for t in pending_yesterday
        ]
    })

    # Backward-compat keys for the old frontend
    response["EMPLOYEE_ID"] = emp.EMPLOYEE_CODE

    response["EMPLOYEE_NAME"] = emp.NAME

    dept_name = None

    if emp.DEPARTMENT_ID:

        d = db.query(Department).filter(
            Department.ID == emp.DEPARTMENT_ID
        ).first()

        dept_name = d.NAME if d else None

    response["DEPARTMENT"] = dept_name

    return response


# =========================
# EMPLOYEE LOGOUT
# =========================

@router.post("/employee-logout")
def employee_logout(
    data: EmployeeLogout,
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):

    # accept either UUID id or EMPLOYEE_CODE
    emp = find_employee_by_login(db, data.EMPLOYEE_ID) or db.query(
        Employee
    ).filter(Employee.ID == data.EMPLOYEE_ID).first()

    if not emp:

        raise HTTPException(
            status_code=404,
            detail="Employee not found"
        )

    if user.get("employee_id") != emp.ID:

        raise HTTPException(
            status_code=403,
            detail="Token does not match employee"
        )

    now = datetime.now()

    start, end = get_office_hours(db)

    row = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == emp.ID,
        Attendance.DATE == now.date()
    ).first()

    # Rule 5 + 6: logout without a Check-In is invalid. Refuse with
    # the exact warning message and notify MD via the notification
    # bell so they can follow up with the employee.
    if row is None or row.CHECK_IN is None:

        warning = (
            "Attendance is not valid because you have logged out without "
            "checking in. Since only a logout record exists for today, "
            "this attendance entry will not be considered valid. Please "
            "inform the Managing Director (MD) about the reason for "
            "logging out without checking in."
        )

        push_notification(
            db,
            title=f"Invalid logout: {emp.NAME}",
            message=(
                f"{emp.EMPLOYEE_CODE} attempted to log out at "
                f"{now.strftime('%H:%M')} without a Check-In today."
            ),
            ntype="WARNING",
            vendor_id=emp.VENDOR_ID or 1
        )

        raise HTTPException(status_code=400, detail=warning)

    row.CHECK_OUT = now

    # Rule 3: logout before the configured office end time counts as
    # an Early Exit / Permission, not a normal logout. We keep the
    # CHECK_OUT stamp and overwrite STATUS only when this is the case;
    # otherwise the existing PRESENT / LATE status sticks.
    early_exit = is_before_end(now, end)

    if early_exit:

        row.STATUS = "EARLY_EXIT"

    worked = None

    if row.CHECK_IN and row.CHECK_OUT:

        delta = row.CHECK_OUT - row.CHECK_IN

        worked = round(delta.total_seconds() / 3600, 2)

        row.WORKED_HOURS = worked

        row.OVERTIME_HOURS = max(0, round(worked - 8, 2))

    db.commit()

    if early_exit:

        push_notification(
            db,
            title=f"Early exit: {emp.NAME}",
            message=(
                f"{emp.EMPLOYEE_CODE} checked out at "
                f"{now.strftime('%H:%M')}, before the "
                f"{end.strftime('%H:%M')} office close. "
                f"Recorded as Permission / Early Exit."
            ),
            ntype="WARNING",
            vendor_id=emp.VENDOR_ID or 1
        )

        # Phase D — auto-create EARLY_EXIT Permission past the grace.
        try:

            _, early_grace_min = get_grace_minutes(db)

            end_dt = datetime.combine(now.date(), end)

            minutes_early = max(0, int((end_dt - now).total_seconds() // 60))

            if minutes_early > early_grace_min:

                hours_early = round(minutes_early / 60.0, 2)

                auto_create_permission(
                    db,
                    employee_id=emp.ID,
                    on_date=now.date(),
                    subtype="EARLY_EXIT",
                    duration_hours=hours_early,
                    reason=(
                        f"Auto-recorded: checked out at "
                        f"{now.strftime('%H:%M')} "
                        f"({minutes_early} min before "
                        f"{end.strftime('%H:%M')} office close, "
                        f"beyond {early_grace_min} min grace)."
                    ),
                    vendor_id=emp.VENDOR_ID or 1
                )

        except Exception:

            # Best-effort: never block logout on the permission write
            pass

    return {
        "message": (
            "Recorded as Permission / Early Exit."
            if early_exit
            else "Logged out"
        ),
        "LOGIN_TIME":  row.CHECK_IN.isoformat(),
        "LOGOUT_TIME": row.CHECK_OUT.isoformat(),
        "WORKED_HOURS": worked,
        "STATUS": row.STATUS,
        "EARLY_EXIT": early_exit,
        "OFFICE_END": end.strftime("%H:%M")
    }


# =========================
# CURRENT DAY (legacy)
# =========================

@router.get("/current-day")
def current_day(
    db: Session = Depends(get_db)
):

    return {"day": get_current_day(db)}


@router.put("/current-day")
def update_current_day(
    data: DayUpdate,
    db: Session = Depends(get_db)
):

    day = set_current_day(db, data.day)

    return {"day": day}


# =========================
# EMPLOYEE: TASKS
# =========================

def resolve_employee(db: Session, employee_ref: str):
    """
    Accept either UUID or code (EMP001). Returns Employee or None.
    """

    emp = db.query(Employee).filter(
        Employee.ID == employee_ref
    ).first()

    if emp:

        return emp

    return db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == str(employee_ref).upper()
    ).first()


@router.get("/employee/{employee_ref}/today-task")
def today_task(
    employee_ref: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):

    emp = resolve_employee(db, employee_ref)

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    if user.get("employee_id") != emp.ID:

        raise HTTPException(
            status_code=403,
            detail="Cannot view another employee's tasks"
        )

    today = date.today()

    row = (
        db.query(
            TaskAssignment,
            Project.PROJECT_NAME,
            Project.PRIORITY,
            Employee.NAME
        )
        .outerjoin(
            Project,
            TaskAssignment.PROJECT_ID == Project.ID
        )
        .outerjoin(
            Employee,
            TaskAssignment.ASSIGNED_BY_ID == Employee.ID
        )
        .filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            TaskAssignment.ASSIGNED_DATE == today,
            TaskAssignment.APPROVAL_STATUS == "APPROVED"
        )
        .order_by(TaskAssignment.TASK_ID)
        .first()
    )

    if not row:

        # No task today — keep the original "empty" shape so
        # existing frontend code paths don't break.
        return {
            "EMPLOYEE_ID": emp.EMPLOYEE_CODE,
            "EMPLOYEE_NAME": emp.NAME,
            "DATE": today.isoformat(),
            "TASK_ID": None,
            "TASK_NAME": None,
            "TASK_DETAILS": None,
            "TASK_STATUS": "NO_TASK",
            "START_TIME": None,
            "END_TIME": None,
            "PROJECT_ID": None,
            "PROJECT_NAME": None,
            "PRIORITY": None,
            "ASSIGNED_BY_ID": None,
            "ASSIGNED_BY_NAME": None,
            "ASSIGNED_DATE": None,
            "DUE_DATE": None,
            "APPROVAL_STATUS": None
        }

    task, project_name, project_priority, assigned_by_name = row

    # Surface BOTH the legacy minimal fields (for any caller that
    # still uses them) AND the enriched dashboard fields.
    serialized = serialize_task(
        task,
        project_name=project_name,
        assigned_by_name=assigned_by_name,
        project_priority=project_priority
    )

    return {
        "EMPLOYEE_ID": emp.EMPLOYEE_CODE,
        "EMPLOYEE_NAME": emp.NAME,
        "DATE": today.isoformat(),
        # ---- Legacy minimal fields (unchanged) ----
        "TASK_ID": task.TASK_ID,
        "TASK_NAME": task.TASK_NAME,
        "TASK_DETAILS": task.TASK_DETAILS,
        "TASK_STATUS": task.TASK_STATUS,
        "START_TIME": (
            task.START_TIME.isoformat()
            if task.START_TIME else None
        ),
        "END_TIME": (
            task.END_TIME.isoformat()
            if task.END_TIME else None
        ),
        # ---- New unified-dashboard fields ----
        "PROJECT_ID": serialized["PROJECT_ID"],
        "PROJECT_NAME": serialized["PROJECT_NAME"],
        "PRIORITY": serialized["PRIORITY"],
        "ASSIGNED_BY_ID": serialized["ASSIGNED_BY_ID"],
        "ASSIGNED_BY_NAME": serialized["ASSIGNED_BY_NAME"],
        "ASSIGNED_DATE": serialized["ASSIGNED_DATE"],
        "ASSIGNED_DATE_TIME": serialized["ASSIGNED_DATE_TIME"],
        "DUE_DATE": serialized["DUE_DATE"],
        "APPROVAL_STATUS": serialized["APPROVAL_STATUS"]
    }


@router.get("/employee/{employee_ref}/tasks")
def all_tasks(
    employee_ref: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):

    emp = resolve_employee(db, employee_ref)

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    if user.get("employee_id") != emp.ID:

        raise HTTPException(
            status_code=403,
            detail="Cannot view another employee's tasks"
        )

    today = date.today()

    # Aliased join on Employee for assigned-by name resolution.
    # We use a fresh subquery alias because Employee is already used
    # implicitly elsewhere; keeping a dedicated alias avoids ambiguity.
    from sqlalchemy.orm import aliased

    AssignedBy = aliased(Employee)

    rows = (
        db.query(
            TaskAssignment,
            Project.PROJECT_NAME,
            Project.PRIORITY,
            AssignedBy.NAME
        )
        .outerjoin(
            Project,
            TaskAssignment.PROJECT_ID == Project.ID
        )
        .outerjoin(
            AssignedBy,
            TaskAssignment.ASSIGNED_BY_ID == AssignedBy.ID
        )
        .filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            TaskAssignment.APPROVAL_STATUS == "APPROVED"
        )
        .order_by(
            TaskAssignment.ASSIGNED_DATE.desc(),
            TaskAssignment.TASK_ID.asc()
        )
        .all()
    )

    serialized = [
        serialize_task(
            t,
            project_name=project_name,
            assigned_by_name=assigned_by_name,
            project_priority=project_priority
        )
        for t, project_name, project_priority, assigned_by_name in rows
    ]

    today_tasks = [
        t for t in serialized
        if t["ASSIGNED_DATE"] == today.isoformat()
    ]

    pending_tasks = [
        t for t in serialized
        if t["TASK_STATUS"] in ("PENDING", "IN_PROGRESS", "ON_HOLD")
    ]

    completed_tasks = [
        t for t in serialized
        if t["TASK_STATUS"] == "COMPLETED"
    ]

    by_date = defaultdict(list)

    for t in serialized:

        key = t["ASSIGNED_DATE"] or "unscheduled"

        by_date[key].append(t)

    return {
        "EMPLOYEE_ID": emp.EMPLOYEE_CODE,
        "EMPLOYEE_NAME": emp.NAME,
        "TODAY": today_tasks,
        "PENDING": pending_tasks,
        "COMPLETED": completed_tasks,
        "BY_DATE": dict(by_date),
        "TASKS": serialized
    }


@router.get("/employee/{employee_ref}/all-tasks")
def all_tasks_legacy(
    employee_ref: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):

    return all_tasks(employee_ref, db, user)


@router.get("/employee/{employee_ref}/pending-from-yesterday")
def pending_from_yesterday(
    employee_ref: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):

    emp = resolve_employee(db, employee_ref)

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    if user.get("employee_id") != emp.ID:

        raise HTTPException(status_code=403, detail="Forbidden")

    pending = get_pending_from_yesterday(db, emp.ID, date.today())

    return {
        "COUNT": len(pending),
        "TASKS": [serialize_task(t) for t in pending]
    }


# =========================
# TASK STATUS ACTIONS
# =========================

MANAGER_ROLES = {"SUPER_ADMIN", "ADMIN", "MANAGER", "PRODUCTION_HEAD"}


@router.put("/task-assignment/{task_id}/status")
def update_task_status(
    task_id: int,
    data: TaskStatusUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):

    new_status = data.TASK_STATUS.upper()

    if new_status not in VALID_TASK_STATUSES:

        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid status. Must be one of: "
                + ", ".join(VALID_TASK_STATUSES)
            )
        )

    task = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_ID == task_id
    ).first()

    if not task:

        raise HTTPException(status_code=404, detail="Task not found")

    # Owners always allowed. Admins / managers can update any task.
    is_owner = task.EMPLOYEE_ID == user.get("employee_id")

    is_manager = user.get("role") in MANAGER_ROLES

    if not (is_owner or is_manager):

        raise HTTPException(
            status_code=403,
            detail="You can only update your own tasks"
        )

    now = datetime.now()

    if new_status == "IN_PROGRESS" and task.START_TIME is None:

        task.START_TIME = now

    if new_status == "COMPLETED" and task.END_TIME is None:

        task.END_TIME = now

        if task.START_TIME is None:

            task.START_TIME = now

    # Resetting to PENDING from a managerial action — clear the times
    if new_status == "PENDING" and is_manager and not is_owner:

        task.START_TIME = None

        task.END_TIME = None

    task.TASK_STATUS = new_status

    task.UPDATED_AT = now

    db.commit()

    # ---- Propagate to the manufacturing Gantt --------------------
    # If the task came from the AI allocator, the corresponding
    # WorkOrderStageProgress row was set to IN_PROGRESS at
    # allocation time. Mirror the employee's UI action onto that
    # stage so the Production Gantt + MD Performance both reflect
    # what just happened.
    stage_synced = False

    if task.PROJECT_ID:

        try:

            from app.models.models import (
                WorkOrder,
                WorkOrderStageProgress,
                ProcessStage
            )

            in_progress_row = (
                db.query(WorkOrderStageProgress, WorkOrder)
                .join(
                    WorkOrder,
                    WorkOrderStageProgress.WORK_ORDER_ID == WorkOrder.ID
                )
                .filter(
                    WorkOrder.PROJECT_ID == task.PROJECT_ID,
                    WorkOrderStageProgress.ASSIGNED_TO_ID == task.EMPLOYEE_ID,
                    WorkOrderStageProgress.STATUS == "IN_PROGRESS"
                )
                .first()
            )

            if in_progress_row:

                progress, _ = in_progress_row

                if new_status == "COMPLETED":

                    progress.STATUS = "DONE"

                    progress.COMPLETED_AT = now

                    stage_synced = True

                elif new_status == "ON_HOLD":

                    # Reflect hold on the Gantt as PENDING so the next
                    # allocator scan can pick it up again.
                    progress.STATUS = "PENDING"

                    progress.ASSIGNED_TO_ID = None

                    stage_synced = True

                if stage_synced:

                    db.commit()

        except Exception as e:

            # Stage sync is best-effort — never fail the task update
            # if the production module isn't set up.
            print(f"[stage sync] {e}")

    project_name = None

    if task.PROJECT_ID:

        proj = db.query(Project).filter(
            Project.ID == task.PROJECT_ID
        ).first()

        project_name = proj.PROJECT_NAME if proj else None

    return {
        "message": "Task status updated",
        "TASK": serialize_task(task, project_name),
        "stage_synced_to_gantt": stage_synced
    }


# =========================
# LIST EMPLOYEE ACCOUNTS (admin)
# =========================

@router.get("/employee-accounts")
def list_employee_accounts(
    db: Session = Depends(get_db)
):

    rows = db.query(Employee).order_by(
        Employee.EMPLOYEE_CODE
    ).all()

    return [
        {
            "EMPLOYEE_ID": e.EMPLOYEE_CODE,
            "EMPLOYEE_UUID": e.ID,
            "EMPLOYEE_NAME": e.NAME,
            "ROLE_ID": e.ROLE_ID,
            "STATUS": e.STATUS
        }
        for e in rows
    ]


# =========================
# EMPLOYEE: ACCEPT / REJECT TASK ASSIGNMENT
# =========================
# Used by the new Product → Project flow. When a project is
# created from a product, each generated task is assigned to a
# skill-matched employee but starts in APPROVAL_STATUS=PENDING.
# The employee accepts (→ APPROVED) or rejects from their
# dashboard. Only APPROVED tasks show up in active work lists.

@router.patch("/task-assignment/{task_id}/accept")
def accept_task(
    task_id: int,
    db: Session = Depends(get_db)
):

    task = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_ID == task_id
    ).first()

    if not task:

        raise HTTPException(status_code=404, detail="Task not found")

    if task.APPROVAL_STATUS != "PENDING":

        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot accept — current approval status is "
                f"{task.APPROVAL_STATUS}"
            )
        )

    task.APPROVAL_STATUS = "APPROVED"

    task.UPDATED_AT = datetime.now()

    db.commit()

    db.refresh(task)

    return {
        "message": "Task accepted. It now appears in your active tasks.",
        "task_id": task.TASK_ID,
        "approval_status": task.APPROVAL_STATUS
    }


@router.patch("/task-assignment/{task_id}/reject")
def reject_task(
    task_id: int,
    db: Session = Depends(get_db)
):
    """
    Employee declines an assigned task. The system tries to
    re-allocate it to the next best-matching employee (excluding
    the one who rejected). If nobody else matches, the task is
    left unassigned (EMPLOYEE_ID = None) for the admin to handle.
    """

    task = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_ID == task_id
    ).first()

    if not task:

        raise HTTPException(status_code=404, detail="Task not found")

    if task.APPROVAL_STATUS != "PENDING":

        raise HTTPException(
            status_code=409,
            detail=(
                f"Cannot reject — current approval status is "
                f"{task.APPROVAL_STATUS}"
            )
        )

    rejected_by = task.EMPLOYEE_ID

    # Try to reassign to the next best employee using the same
    # skill-based picker.
    new_assignee = None

    new_score = 0

    try:

        from app.services.project_from_product_service import (
            find_best_employee,
            STAGE_TYPE_SKILLS
        )

        # Try to infer the stage type from the task name; fall
        # back to using the project's SKILLS_REQUIRED.
        project = db.query(Project).filter(
            Project.ID == task.PROJECT_ID
        ).first() if task.PROJECT_ID else None

        required = (
            project.SKILLS_REQUIRED if project else ""
        ) or ""

        vendor_id = (
            project.VENDOR_ID if project else 1
        )

        dept_id = project.DEPARTMENT_ID if project else None

        new_assignee, new_score = find_best_employee(
            db,
            required_skills=required,
            vendor_id=vendor_id,
            department_id=dept_id,
            exclude_employee_ids={rejected_by} if rejected_by else None
        )

    except Exception:

        new_assignee = None

    if new_assignee:

        # Reassign: keep APPROVAL_STATUS = PENDING for the new
        # employee to decide.
        task.EMPLOYEE_ID = new_assignee.ID

        task.UPDATED_AT = datetime.now()

        db.commit()

        return {
            "message": (
                f"Task rejected. Reassigned to {new_assignee.NAME} "
                f"(skill score {int(new_score * 100)}%). "
                f"Awaiting their acceptance."
            ),
            "task_id": task.TASK_ID,
            "approval_status": "PENDING",
            "reassigned_to": {
                "ID": new_assignee.ID,
                "NAME": new_assignee.NAME,
                "EMPLOYEE_CODE": new_assignee.EMPLOYEE_CODE
            }
        }

    # Nobody else to reassign to — mark rejected
    task.APPROVAL_STATUS = "REJECTED"

    task.EMPLOYEE_ID = None

    task.UPDATED_AT = datetime.now()

    db.commit()

    return {
        "message": (
            "Task rejected. No alternative employee with matching "
            "skills was found — admin must reassign manually."
        ),
        "task_id": task.TASK_ID,
        "approval_status": "REJECTED"
    }


@router.get("/employee/{employee_ref}/pending-acceptance")
def list_pending_acceptance(
    employee_ref: str,
    db: Session = Depends(get_db)
):
    """List the tasks waiting on this employee's accept/reject.
    `employee_ref` accepts either the UUID or the EMPLOYEE_CODE
    so the employee dashboard can pass whatever it has."""

    emp = (
        db.query(Employee)
        .filter(
            (Employee.ID == employee_ref)
            | (Employee.EMPLOYEE_CODE == employee_ref)
        )
        .first()
    )

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    rows = (
        db.query(TaskAssignment, Project)
        .outerjoin(Project, TaskAssignment.PROJECT_ID == Project.ID)
        .filter(
            TaskAssignment.EMPLOYEE_ID == emp.ID,
            TaskAssignment.APPROVAL_STATUS == "PENDING"
        )
        .order_by(TaskAssignment.UPDATED_AT.desc())
        .all()
    )

    return [
        {
            "TASK_ID": t.TASK_ID,
            "TASK_NAME": t.TASK_NAME,
            "TASK_DETAILS": t.TASK_DETAILS,
            "ASSIGNED_DATE": (
                t.ASSIGNED_DATE.isoformat()
                if t.ASSIGNED_DATE else None
            ),
            "DUE_DATE": (
                t.DUE_DATE.isoformat() if t.DUE_DATE else None
            ),
            "PROJECT_ID": t.PROJECT_ID,
            "PROJECT_NAME": p.PROJECT_NAME if p else None,
            "PROJECT_PRIORITY": p.PRIORITY if p else None,
            "APPROVAL_STATUS": t.APPROVAL_STATUS
        }
        for t, p in rows
    ]


# =========================
# ADMIN: ASSIGN TASKS
# =========================

@router.post("/task-assignment")
def assign_task(
    data: TaskAssignmentCreate,
    db: Session = Depends(get_db)
):

    project_name = None

    proj = None

    if data.PROJECT_ID is not None:

        proj = db.query(Project).filter(
            Project.ID == data.PROJECT_ID
        ).first()

        if not proj:

            raise HTTPException(
                status_code=400,
                detail=f"Project {data.PROJECT_ID} not found"
            )

        project_name = proj.PROJECT_NAME

    auto_used = False

    if data.AUTO_ASSIGN:

        emp, prior_count, dept_id = pick_least_loaded_employee(
            db,
            project=proj,
            department_id=data.DEPARTMENT_ID
        )

        if not emp:

            raise HTTPException(
                status_code=400,
                detail=(
                    "Auto-assign: no eligible employees found. "
                    "Add at least one ACTIVE employee in the "
                    "project's department."
                )
            )

        auto_used = True

    else:

        emp = resolve_employee(db, data.EMPLOYEE_ID)

        if not emp:

            raise HTTPException(
                status_code=404,
                detail="Employee not found"
            )

    assigned_date = data.ASSIGNED_DATE or date.today()

    task = TaskAssignment(
        EMPLOYEE_ID=emp.ID,
        PROJECT_ID=data.PROJECT_ID,
        TASK_NAME=data.TASK_NAME,
        TASK_DETAILS=data.TASK_DETAILS or "",
        ASSIGNED_DATE=assigned_date,
        DUE_DATE=data.DUE_DATE or assigned_date,
        TASK_STATUS="PENDING",
        ASSIGNED_BY_ID=data.ASSIGNED_BY_ID,
        UPDATED_AT=datetime.utcnow()
    )

    db.add(task)

    db.commit()

    db.refresh(task)

    project_clause = (
        f" for project '{project_name}'"
        if project_name else ""
    )

    auto_clause = "[Auto-assigned] " if auto_used else ""

    push_notification(
        db,
        title=(
            "New task auto-assigned"
            if auto_used else "New task assigned"
        ),
        message=(
            f"{auto_clause}{emp.NAME} has a new task: "
            f"{task.TASK_NAME}{project_clause} "
            f"(due "
            f"{task.DUE_DATE.isoformat() if task.DUE_DATE else 'n/a'})."
        ),
        ntype="INFO",
        vendor_id=emp.VENDOR_ID or 1
    )

    # Send email to the assignee
    email_ok, email_msg = send_task_assignment_email(
        employee=emp,
        task_name=task.TASK_NAME,
        task_details=task.TASK_DETAILS,
        project_name=project_name,
        due_date=task.DUE_DATE,
        is_auto=auto_used
    )

    return {
        "message": (
            f"Task auto-assigned to {emp.NAME} ({emp.EMPLOYEE_CODE})"
            if auto_used else "Task assigned"
        ),
        "auto_assigned": auto_used,
        "assignee": {
            "ID": emp.ID,
            "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
            "NAME": emp.NAME,
            "DEPARTMENT_ID": emp.DEPARTMENT_ID,
            "EMAIL": emp.EMAIL
        },
        "EMAIL_SENT": email_ok,
        "EMAIL_MESSAGE": email_msg,
        "TASK": serialize_task(task, project_name)
    }


@router.get("/workload-preview")
def workload_preview(
    project_id: int = None,
    department_id: int = None,
    db: Session = Depends(get_db)
):
    """
    Preview who would be auto-assigned without committing.
    Returns the full candidate pool with their active task
    counts, sorted by least loaded first. Frontend uses this
    to show "Will be assigned to: X" before the user clicks.
    """

    proj = None

    if project_id is not None:

        proj = db.query(Project).filter(
            Project.ID == project_id
        ).first()

        if not proj:

            raise HTTPException(
                status_code=404,
                detail=f"Project {project_id} not found"
            )

    pool, dept_id = candidate_pool(
        db,
        project=proj,
        department_id=department_id
    )

    summary = workload_summary(db, pool)

    return {
        "DEPARTMENT_ID": dept_id,
        "DEPARTMENT_NAME": department_name(db, dept_id),
        "CANDIDATE_COUNT": len(summary),
        "WINNER": (
            serialize_summary_row(summary[0])
            if summary else None
        ),
        "POOL": [serialize_summary_row(r) for r in summary]
    }


@router.get("/project/{project_id}/tasks")
def list_project_tasks(
    project_id: int,
    db: Session = Depends(get_db)
):
    """
    Lists every task assigned for a project, joined with
    the assignee's name + code. Used by the admin
    'Assign Tasks' panel on the Projects page.
    """

    proj = db.query(Project).filter(
        Project.ID == project_id
    ).first()

    if not proj:

        raise HTTPException(
            status_code=404,
            detail="Project not found"
        )

    rows = db.query(
        TaskAssignment,
        Employee.NAME,
        Employee.EMPLOYEE_CODE
    ).outerjoin(
        Employee,
        TaskAssignment.EMPLOYEE_ID == Employee.ID
    ).filter(
        TaskAssignment.PROJECT_ID == project_id
    ).order_by(
        TaskAssignment.ASSIGNED_DATE.desc(),
        TaskAssignment.TASK_ID.desc()
    ).all()

    out = []

    for ta, emp_name, emp_code in rows:

        row = serialize_task(ta, proj.PROJECT_NAME)

        row["EMPLOYEE_NAME"] = emp_name

        row["EMPLOYEE_CODE"] = emp_code

        out.append(row)

    return {
        "PROJECT_ID": proj.ID,
        "PROJECT_NAME": proj.PROJECT_NAME,
        "TASKS": out
    }


@router.delete("/task-assignment/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db)
):

    task = db.query(TaskAssignment).filter(
        TaskAssignment.TASK_ID == task_id
    ).first()

    if not task:

        raise HTTPException(status_code=404, detail="Task not found")

    db.delete(task)

    db.commit()

    return {"message": "Task deleted"}


# =========================
# EMPLOYEE ATTENDANCE LIST (admin)
# =========================

@router.get("/employee-attendance")
def list_employee_attendance(
    db: Session = Depends(get_db)
):

    rows = db.query(
        Attendance,
        Employee.NAME,
        Employee.EMPLOYEE_CODE,
        Employee.DEPARTMENT_ID
    ).outerjoin(
        Employee,
        Attendance.EMPLOYEE_ID == Employee.ID
    ).order_by(
        Attendance.DATE.desc(),
        Attendance.CHECK_IN.desc()
    ).all()

    out = []

    for record, name, code, dept_id in rows:

        out.append({
            "ID": record.ID,
            "EMPLOYEE_ID": record.EMPLOYEE_ID,
            "EMPLOYEE_CODE": code,
            "EMPLOYEE_NAME": name,
            "DEPARTMENT_ID": dept_id,
            "DATE": (
                record.DATE.isoformat()
                if record.DATE else None
            ),
            "LOGIN_TIME": (
                record.CHECK_IN.isoformat()
                if record.CHECK_IN else None
            ),
            "LOGOUT_TIME": (
                record.CHECK_OUT.isoformat()
                if record.CHECK_OUT else None
            ),
            "STATUS": record.STATUS,
            "WORKED_HOURS": record.WORKED_HOURS,
            "OVERTIME_HOURS": record.OVERTIME_HOURS
        })

    return out
