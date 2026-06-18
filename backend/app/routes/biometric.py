"""
Biometric device integration for BVC24.

Single endpoint `/biometric/scan` handles the full day:

  - First scan      -> check-in + allocate first task
  - Subsequent scan -> complete current task; if shift time
                       remains, allocate the next task;
                       otherwise mark "ready to leave"
  - Final scan      -> check-out (when no pending task remains)

A 5-minute debounce protects against double-tap scans: a scan
that arrives within 5 minutes of the last allocation is treated
as a status query, not a completion. Real ZKTeco devices already
debounce at the device level, but this guards the API too.
"""

from datetime import datetime, date, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import case

from app.database.database import get_db

from app.models.models import (
    Employee,
    Attendance,
    BiometricEvent,
    TaskAssignment,
    Project,
    ProductModel,
    BOMItem
)

from app.schemas.biometric_schema import (
    BiometricScanRequest,
    BiometricEnrollRequest
)

from app.services.allocation_service import (
    allocate_for_employee,
    complete_active_task,
    get_active_task,
    current_allocation_view,
    can_assign_next_task,
    time_remaining_to_shift_end,
    shift_end_today
)


router = APIRouter(prefix="/biometric", tags=["Biometric"])


# Match attendance.py — anyone scanning in after 9:15 AM is LATE.
WORK_START_HOUR = 9
WORK_START_MINUTE = 15

# Debounce window — a scan within this many seconds of the
# current task's START_TIME is treated as a no-op status query
# rather than a completion. Protects against accidental rescans.
SCAN_DEBOUNCE_SECONDS = 300


def _compute_attendance_status(check_in_time: datetime) -> str:

    if not check_in_time:

        return "PRESENT"

    cutoff = time(WORK_START_HOUR, WORK_START_MINUTE)

    return (
        "LATE"
        if check_in_time.time() > cutoff
        else "PRESENT"
    )


def _parse_event_time(raw: str | None) -> datetime:

    if not raw:

        return datetime.now()

    try:

        return datetime.fromisoformat(raw)

    except ValueError:

        return datetime.now()


def _serialize_employee(emp: Employee) -> dict:

    return {
        "ID": emp.ID,
        "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
        "NAME": emp.NAME,
        "DEPARTMENT_ID": emp.DEPARTMENT_ID,
        "SKILLS": emp.SKILLS,
        "SHIFT_END": (
            emp.SHIFT_END.isoformat()
            if emp.SHIFT_END else "18:00:00"
        )
    }


def _serialize_attendance(att: Attendance) -> dict:

    return {
        "ID": att.ID,
        "DATE": att.DATE.isoformat() if att.DATE else None,
        "CHECK_IN": (
            att.CHECK_IN.isoformat() if att.CHECK_IN else None
        ),
        "CHECK_OUT": (
            att.CHECK_OUT.isoformat() if att.CHECK_OUT else None
        ),
        "STATUS": att.STATUS,
        "WORKED_HOURS": att.WORKED_HOURS,
        "OVERTIME_HOURS": att.OVERTIME_HOURS
    }


def _build_task_sheet_payload(
    db: Session,
    employee: Employee,
    active_task_id: int | None,
    active_project_id: int | None
) -> dict:
    """Extra data the printed task sheet needs beyond the active
    allocation: the employee's other pending tasks, and the BOM
    rolled up for the active project so the worker knows which
    materials to fetch from stores.

    Kept lean (no joins to deep relations) so the biometric scan
    endpoint stays fast — first scan of the morning is on the
    critical path.
    """

    # ---- 1. Other pending tasks (exclude the currently active one)
    pending_q = db.query(TaskAssignment).filter(
        TaskAssignment.EMPLOYEE_ID == employee.ID,
        TaskAssignment.TASK_STATUS.in_(
            ["PENDING", "IN_PROGRESS", "ON_HOLD"]
        )
    )

    if active_task_id:

        pending_q = pending_q.filter(
            TaskAssignment.TASK_ID != active_task_id
        )

    # MySQL doesn't support `NULLS LAST` — emulate with a CASE that
    # sorts NULLs after real dates by mapping NULL -> 1, value -> 0.
    pending_rows = pending_q.order_by(
        case(
            (TaskAssignment.DUE_DATE.is_(None), 1),
            else_=0
        ),
        TaskAssignment.DUE_DATE.asc(),
        TaskAssignment.ASSIGNED_DATE.asc()
    ).limit(20).all()

    # Bulk-load project names for these tasks in one query
    proj_ids = {
        t.PROJECT_ID for t in pending_rows if t.PROJECT_ID
    }

    proj_names = {}

    if proj_ids:

        for p in db.query(Project).filter(
            Project.ID.in_(proj_ids)
        ).all():

            proj_names[p.ID] = p.PROJECT_NAME

    pending_tasks = [
        {
            "TASK_ID": t.TASK_ID,
            "TASK_NAME": t.TASK_NAME,
            "TASK_STATUS": t.TASK_STATUS,
            "APPROVAL_STATUS": t.APPROVAL_STATUS,
            "PROJECT_NAME": proj_names.get(t.PROJECT_ID),
            "DUE_DATE": (
                t.DUE_DATE.isoformat() if t.DUE_DATE else None
            )
        }
        for t in pending_rows
    ]

    # ---- 2. BOM materials for the active project's product ----
    bom_for_project = []

    project_quantity = 1

    if active_project_id:

        project = db.query(Project).filter(
            Project.ID == active_project_id
        ).first()

        if project and project.PRODUCT_MODEL_ID:

            project_quantity = project.QUANTITY or 1

            rows = (
                db.query(BOMItem)
                .filter(
                    BOMItem.PRODUCT_MODEL_ID
                    == project.PRODUCT_MODEL_ID
                )
                .order_by(
                    case(
                        (BOMItem.ITEM_NO.is_(None), 1),
                        else_=0
                    ),
                    BOMItem.ITEM_NO.asc(),
                    BOMItem.ID
                )
                .limit(40)
                .all()
            )

            for item in rows:

                bom_for_project.append({
                    "ID": item.ID,
                    "ITEM_NO": item.ITEM_NO,
                    "MATERIAL_NAME": item.MATERIAL_NAME,
                    "PER_UNIT_QUANTITY": item.QUANTITY,
                    "TOTAL_QUANTITY": round(
                        (item.QUANTITY or 0) * project_quantity, 3
                    ),
                    "UNIT": item.UNIT,
                    "ITEM_TYPE": item.ITEM_TYPE or "PURCHASE"
                })

    return {
        "pending_tasks": pending_tasks,
        "pending_count": len(pending_tasks),
        "bom_for_project": bom_for_project,
        "project_quantity": project_quantity
    }


# ----------------------------------------------------------------
# ENROLL
# ----------------------------------------------------------------

@router.post("/enroll")
def enroll_fingerprint(
    data: BiometricEnrollRequest,
    db: Session = Depends(get_db)
):

    employee = db.query(Employee).filter(
        Employee.ID == data.EMPLOYEE_ID
    ).first()

    if not employee:

        raise HTTPException(
            status_code=404,
            detail="Employee not found"
        )

    clash = db.query(Employee).filter(
        Employee.FINGERPRINT_ID == data.FINGERPRINT_ID,
        Employee.ID != data.EMPLOYEE_ID
    ).first()

    if clash:

        raise HTTPException(
            status_code=409,
            detail=(
                f"FINGERPRINT_ID {data.FINGERPRINT_ID} is already "
                f"enrolled for employee {clash.EMPLOYEE_CODE}"
            )
        )

    employee.FINGERPRINT_ID = data.FINGERPRINT_ID

    db.commit()

    return {
        "message": "Fingerprint enrolled",
        "EMPLOYEE_ID": employee.ID,
        "EMPLOYEE_CODE": employee.EMPLOYEE_CODE,
        "FINGERPRINT_ID": employee.FINGERPRINT_ID
    }


# ----------------------------------------------------------------
# SCAN — the main state-machine endpoint
# ----------------------------------------------------------------

@router.post("/scan")
def biometric_scan(
    data: BiometricScanRequest,
    db: Session = Depends(get_db)
):

    event_time = _parse_event_time(data.TIMESTAMP)

    # ---- 1. Resolve fingerprint → Employee, log event ----------
    # Accept either a real enrolled FINGERPRINT_ID or, as a
    # fallback, the EMPLOYEE_CODE (EMP001, BVC001, ...). This lets
    # the gate UI work even when fingerprints haven't been enrolled
    # yet — any active employee code becomes a valid scan token.

    scan_token = (data.FINGERPRINT_ID or "").strip()

    employee = db.query(Employee).filter(
        Employee.FINGERPRINT_ID == scan_token
    ).first()

    if not employee and scan_token:
        employee = db.query(Employee).filter(
            Employee.EMPLOYEE_CODE == scan_token
        ).first()

    event = BiometricEvent(
        DEVICE_ID=data.DEVICE_ID,
        FINGERPRINT_ID=data.FINGERPRINT_ID,
        EMPLOYEE_ID=employee.ID if employee else None,
        EVENT_TIME=event_time,
        VERIFY_MODE=data.VERIFY_MODE,
        RESULT="SUCCESS" if employee else "UNKNOWN_USER",
        RAW_PAYLOAD=data.RAW_PAYLOAD,
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(event)

    if not employee:

        db.commit()

        raise HTTPException(
            status_code=404,
            detail=(
                f"No employee enrolled with fingerprint "
                f"{data.FINGERPRINT_ID} on device {data.DEVICE_ID}"
            )
        )

    if employee.STATUS != "ACTIVE":

        event.RESULT = "ERROR"

        db.commit()

        raise HTTPException(
            status_code=403,
            detail=(
                f"Employee {employee.EMPLOYEE_CODE} is not "
                f"active (status: {employee.STATUS})"
            )
        )

    db.commit()

    # ---- 2. State machine ---------------------------------------

    today = event_time.date()

    attendance = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == employee.ID,
        Attendance.DATE == today
    ).first()

    # -- State D: already checked out -----------------------------

    if attendance and attendance.CHECK_OUT:

        return {
            "action": "ALREADY_OUT",
            "message": (
                f"{employee.NAME}, you've already checked out today."
            ),
            "employee": _serialize_employee(employee),
            "attendance": _serialize_attendance(attendance),
            "event_id": event.ID
        }

    # -- State A: first scan today -> check-in --------------------

    if not attendance or not attendance.CHECK_IN:

        if attendance:

            attendance.CHECK_IN = event_time

            attendance.STATUS = _compute_attendance_status(event_time)

        else:

            attendance = Attendance(
                EMPLOYEE_ID=employee.ID,
                DATE=today,
                CHECK_IN=event_time,
                STATUS=_compute_attendance_status(event_time),
                VENDOR_ID=employee.VENDOR_ID
            )

            db.add(attendance)

        db.commit()

        db.refresh(attendance)

        allocation = allocate_for_employee(db, employee)

        # Enrich the response with pending tasks + BOM so the
        # printed task sheet can show the worker their full pending
        # list and the materials they need to fetch from stores.
        active_task = (allocation or {}).get("task") or {}

        active_project = (allocation or {}).get("project") or {}

        task_sheet_extras = _build_task_sheet_payload(
            db,
            employee,
            active_task_id=active_task.get("TASK_ID"),
            active_project_id=active_project.get("ID")
        )

        return {
            "action": "CHECKED_IN",
            "message": f"Welcome, {employee.NAME}",
            "employee": _serialize_employee(employee),
            "attendance": _serialize_attendance(attendance),
            "allocation": allocation,
            "event_id": event.ID,
            **task_sheet_extras
        }

    # -- States B / C / E: post check-in --------------------------

    active_task = get_active_task(db, employee.ID)

    if active_task:

        # Debounce: if the current task was started within the
        # last SCAN_DEBOUNCE_SECONDS, treat this scan as a status
        # query — don't auto-complete.
        started = active_task.START_TIME or active_task.UPDATED_AT

        if started and (
            (datetime.now() - started).total_seconds()
            < SCAN_DEBOUNCE_SECONDS
        ):

            view = current_allocation_view(db, employee)

            return {
                "action": "TASK_IN_PROGRESS",
                "message": (
                    f"{employee.NAME}, your current task is still "
                    f"active — please complete it before the next scan."
                ),
                "employee": _serialize_employee(employee),
                "attendance": _serialize_attendance(attendance),
                "allocation": view,
                "event_id": event.ID
            }

        # ---- State B: complete current task --------------------

        completion = complete_active_task(db, employee)

        # Decide whether to allocate next or signal ready-to-leave
        if can_assign_next_task(employee):

            next_allocation = allocate_for_employee(db, employee)

            # Re-enrich the response for the print sheet — the next
            # task may belong to a different project, so the BOM
            # rolled up here is for the newly-allocated work.
            nxt_task = (next_allocation or {}).get("task") or {}

            nxt_project = (next_allocation or {}).get("project") or {}

            task_sheet_extras = _build_task_sheet_payload(
                db,
                employee,
                active_task_id=nxt_task.get("TASK_ID"),
                active_project_id=nxt_project.get("ID")
            )

            return {
                "action": "TASK_COMPLETED_NEXT_ASSIGNED",
                "message": (
                    "Task completed — next task assigned."
                ),
                "employee": _serialize_employee(employee),
                "attendance": _serialize_attendance(attendance),
                "completion": completion,
                "allocation": next_allocation,
                "event_id": event.ID,
                **task_sheet_extras
            }

        else:

            mins_left = round(time_remaining_to_shift_end(employee), 1)

            return {
                "action": "TASK_COMPLETED_READY_TO_LEAVE",
                "message": (
                    "Task completed. You can check out anytime."
                ),
                "employee": _serialize_employee(employee),
                "attendance": _serialize_attendance(attendance),
                "completion": completion,
                "minutes_to_shift_end": mins_left,
                "event_id": event.ID
            }

    # ---- State C: no active task -> check-out -------------------

    now = datetime.now()

    attendance.CHECK_OUT = now

    if attendance.CHECK_IN:

        delta = now - attendance.CHECK_IN

        hours = round(delta.total_seconds() / 3600, 2)

        attendance.WORKED_HOURS = hours

        attendance.OVERTIME_HOURS = max(0, round(hours - 8, 2))

    db.commit()

    db.refresh(attendance)

    # Day summary: tasks completed today
    completed_today = db.query(TaskAssignment).filter(
        TaskAssignment.EMPLOYEE_ID == employee.ID,
        TaskAssignment.ASSIGNED_DATE == today,
        TaskAssignment.TASK_STATUS == "DONE"
    ).count()

    return {
        "action": "CHECKED_OUT",
        "message": (
            f"Goodbye, {employee.NAME}. "
            f"Worked {attendance.WORKED_HOURS or 0}h — "
            f"{completed_today} task(s) completed."
        ),
        "employee": _serialize_employee(employee),
        "attendance": _serialize_attendance(attendance),
        "tasks_completed_today": completed_today,
        "event_id": event.ID
    }


# ----------------------------------------------------------------
# RECENT EVENTS
# ----------------------------------------------------------------

@router.get("/events")
def list_events(
    limit: int = 50,
    db: Session = Depends(get_db)
):

    rows = (
        db.query(BiometricEvent, Employee.NAME, Employee.EMPLOYEE_CODE)
        .outerjoin(
            Employee,
            BiometricEvent.EMPLOYEE_ID == Employee.ID
        )
        .order_by(BiometricEvent.EVENT_TIME.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "ID": evt.ID,
            "DEVICE_ID": evt.DEVICE_ID,
            "FINGERPRINT_ID": evt.FINGERPRINT_ID,
            "EMPLOYEE_ID": evt.EMPLOYEE_ID,
            "EMPLOYEE_NAME": name,
            "EMPLOYEE_CODE": code,
            "EVENT_TIME": (
                evt.EVENT_TIME.isoformat()
                if evt.EVENT_TIME else None
            ),
            "VERIFY_MODE": evt.VERIFY_MODE,
            "RESULT": evt.RESULT
        }
        for evt, name, code in rows
    ]
