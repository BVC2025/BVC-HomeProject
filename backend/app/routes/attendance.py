from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, date, time

from app.database.database import get_db

from app.models.models import (
    Attendance,
    Employee,
    TaskAssignment,
    Project,
    Department
)

from app.schemas.attendance_schema import (
    CheckInRequest,
    CheckOutRequest,
    MarkAbsentRequest
)

router = APIRouter()


WORK_START_HOUR = 10
WORK_START_MINUTE = 0


# =========================
# HELPERS
# =========================

def compute_status(check_in_time: datetime) -> str:

    if not check_in_time:

        return "PRESENT"

    cutoff = time(WORK_START_HOUR, WORK_START_MINUTE)

    return "LATE" if check_in_time.time() > cutoff else "PRESENT"


# =========================
# CHECK IN
# =========================

@router.post("/check-in")
def check_in(
    data: CheckInRequest,
    db: Session = Depends(get_db)
):

    emp = db.query(Employee).filter(
        Employee.ID == data.EMPLOYEE_ID
    ).first()

    if not emp:

        raise HTTPException(
            status_code=404,
            detail="Employee not found"
        )

    today = date.today()

    record = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == data.EMPLOYEE_ID,
        Attendance.DATE == today
    ).first()

    now = datetime.now()

    if record:

        if record.CHECK_IN:

            raise HTTPException(
                status_code=400,
                detail="Employee has already checked in today"
            )

        record.CHECK_IN = now

        record.STATUS = compute_status(now)

    else:

        record = Attendance(
            EMPLOYEE_ID=data.EMPLOYEE_ID,
            DATE=today,
            CHECK_IN=now,
            STATUS=compute_status(now),
            VENDOR_ID=data.VENDOR_ID
        )

        db.add(record)

    db.commit()

    db.refresh(record)

    return {
        "message": "Checked in",
        "attendance_id": record.ID,
        "status": record.STATUS
    }


# =========================
# CHECK OUT
# =========================

@router.post("/check-out")
def check_out(
    data: CheckOutRequest,
    db: Session = Depends(get_db)
):

    today = date.today()

    record = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == data.EMPLOYEE_ID,
        Attendance.DATE == today
    ).first()

    if not record:

        raise HTTPException(
            status_code=404,
            detail="No check-in record for today"
        )

    if not record.CHECK_IN:

        raise HTTPException(
            status_code=400,
            detail="Employee has not checked in today"
        )

    if record.CHECK_OUT:

        raise HTTPException(
            status_code=400,
            detail="Employee has already checked out today"
        )

    now = datetime.now()

    record.CHECK_OUT = now

    # Compute worked hours + overtime
    delta = now - record.CHECK_IN

    hours = round(delta.total_seconds() / 3600, 2)

    record.WORKED_HOURS = hours

    record.OVERTIME_HOURS = max(0, round(hours - 8, 2))

    db.commit()

    return {
        "message": "Checked out",
        "attendance_id": record.ID,
        "worked_hours": record.WORKED_HOURS,
        "overtime_hours": record.OVERTIME_HOURS
    }


# =========================
# MARK ABSENT
# =========================

@router.post("/mark-absent")
def mark_absent(
    data: MarkAbsentRequest,
    db: Session = Depends(get_db)
):

    today = date.today()

    existing = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == data.EMPLOYEE_ID,
        Attendance.DATE == today
    ).first()

    if existing:

        existing.STATUS = "ABSENT"

        existing.CHECK_IN = None

        existing.CHECK_OUT = None

        existing.WORKED_HOURS = None

        existing.OVERTIME_HOURS = 0

        if data.NOTE:

            existing.REMARKS = data.NOTE

        db.commit()

        return {"message": "Marked absent"}

    record = Attendance(
        EMPLOYEE_ID=data.EMPLOYEE_ID,
        DATE=today,
        STATUS="ABSENT",
        REMARKS=data.NOTE,
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(record)

    db.commit()

    return {"message": "Marked absent"}


# =========================
# LIST
# =========================

@router.get("/attendance")
def get_attendance(
    db: Session = Depends(get_db)
):

    rows = db.query(
        Attendance,
        Employee.NAME,
        Employee.EMPLOYEE_CODE
    ).outerjoin(
        Employee,
        Attendance.EMPLOYEE_ID == Employee.ID
    ).order_by(
        Attendance.DATE.desc(),
        Attendance.CHECK_IN.desc()
    ).all()

    out = []

    for record, name, code in rows:

        out.append({
            "ID": record.ID,
            "EMPLOYEE_ID": record.EMPLOYEE_ID,
            "EMPLOYEE_CODE": code,
            "EMPLOYEE_NAME": name,
            "DATE": (
                record.DATE.isoformat()
                if record.DATE else None
            ),
            "CHECK_IN": (
                record.CHECK_IN.isoformat()
                if record.CHECK_IN else None
            ),
            "CHECK_OUT": (
                record.CHECK_OUT.isoformat()
                if record.CHECK_OUT else None
            ),
            "STATUS": record.STATUS,
            "WORKED_HOURS": record.WORKED_HOURS,
            "OVERTIME_HOURS": record.OVERTIME_HOURS,
            "REMARKS": record.REMARKS,
            "VENDOR_ID": record.VENDOR_ID
        })

    return out


@router.get("/attendance/today")
def get_today_attendance(
    db: Session = Depends(get_db)
):

    today = date.today()

    rows = db.query(
        Attendance,
        Employee.NAME,
        Employee.EMPLOYEE_CODE
    ).outerjoin(
        Employee,
        Attendance.EMPLOYEE_ID == Employee.ID
    ).filter(
        Attendance.DATE == today
    ).all()

    return [
        {
            "ID": rec.ID,
            "EMPLOYEE_ID": rec.EMPLOYEE_ID,
            "EMPLOYEE_CODE": code,
            "EMPLOYEE_NAME": name,
            "DATE": today.isoformat(),
            "CHECK_IN": (
                rec.CHECK_IN.isoformat()
                if rec.CHECK_IN else None
            ),
            "CHECK_OUT": (
                rec.CHECK_OUT.isoformat()
                if rec.CHECK_OUT else None
            ),
            "STATUS": rec.STATUS,
            "WORKED_HOURS": rec.WORKED_HOURS,
            "OVERTIME_HOURS": rec.OVERTIME_HOURS
        }
        for rec, name, code in rows
    ]


@router.get("/attendance/live-board")
def live_floor_board(
    db: Session = Depends(get_db)
):
    """
    Live shop-floor display: one tile per ACTIVE employee with
    today's CHECK_IN / CHECK_OUT, current task, status. Powers
    the "Floor Board" view in the Attendance page — refreshes
    every 10 seconds for a live wall display.
    """

    today = date.today()

    employees = (
        db.query(Employee, Department)
        .outerjoin(Department, Employee.DEPARTMENT_ID == Department.ID)
        .filter(Employee.STATUS == "ACTIVE")
        .order_by(Employee.EMPLOYEE_CODE)
        .all()
    )

    # Pre-load today's attendance keyed by employee
    attendance_rows = (
        db.query(Attendance)
        .filter(Attendance.DATE == today)
        .all()
    )

    att_map = {a.EMPLOYEE_ID: a for a in attendance_rows}

    # Pre-load active tasks
    active_tasks = (
        db.query(TaskAssignment, Project)
        .outerjoin(Project, TaskAssignment.PROJECT_ID == Project.ID)
        .filter(
            TaskAssignment.ASSIGNED_DATE == today,
            TaskAssignment.TASK_STATUS.in_(
                ["PENDING", "IN_PROGRESS"]
            )
        )
        .all()
    )

    task_map = {}

    for task, proj in active_tasks:

        # last wins, but each employee really only has one
        task_map[task.EMPLOYEE_ID] = (task, proj)

    # Completed-task counts today (matches MD Performance logic)
    completed_today = (
        db.query(
            TaskAssignment.EMPLOYEE_ID,
            func.count(TaskAssignment.TASK_ID)
        )
        .filter(
            TaskAssignment.ASSIGNED_DATE == today,
            TaskAssignment.TASK_STATUS.in_(["DONE", "COMPLETED"])
        )
        .group_by(TaskAssignment.EMPLOYEE_ID)
        .all()
    )

    completed_map = {emp_id: cnt for emp_id, cnt in completed_today}

    out = []

    for emp, dept in employees:

        att = att_map.get(emp.ID)

        task_pair = task_map.get(emp.ID)

        current_task = task_pair[0] if task_pair else None

        current_proj = task_pair[1] if task_pair else None

        out.append({
            "EMPLOYEE_ID": emp.ID,
            "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
            "NAME": emp.NAME,
            "DEPARTMENT": dept.NAME if dept else None,
            "DEPARTMENT_CODE": dept.CODE if dept else None,
            "SKILLS": emp.SKILLS,
            "CHECK_IN": (
                att.CHECK_IN.isoformat()
                if (att and att.CHECK_IN) else None
            ),
            "CHECK_OUT": (
                att.CHECK_OUT.isoformat()
                if (att and att.CHECK_OUT) else None
            ),
            "STATUS": att.STATUS if att else "NOT_CHECKED_IN",
            "WORKED_HOURS": att.WORKED_HOURS if att else None,
            "OVERTIME_HOURS": (
                att.OVERTIME_HOURS if att else None
            ),
            "CURRENT_TASK_ID": (
                current_task.TASK_ID if current_task else None
            ),
            "CURRENT_TASK_NAME": (
                current_task.TASK_NAME if current_task else None
            ),
            "CURRENT_TASK_STATUS": (
                current_task.TASK_STATUS if current_task else None
            ),
            "CURRENT_PROJECT": (
                current_proj.PROJECT_NAME if current_proj else None
            ),
            "TASKS_COMPLETED_TODAY": completed_map.get(emp.ID, 0)
        })

    # Sort: checked-in first, then by check-in time desc
    out.sort(
        key=lambda r: (
            0 if r["CHECK_IN"] else 1,
            -(
                int(r["CHECK_IN"].replace(":", "").replace("-", "")
                    .replace("T", "")[8:14])
                if r["CHECK_IN"] else 0
            )
        )
    )

    # Summary tile data
    total = len(out)

    in_office = sum(
        1 for r in out
        if r["CHECK_IN"] and not r["CHECK_OUT"]
    )

    checked_out = sum(1 for r in out if r["CHECK_OUT"])

    not_in = total - in_office - checked_out

    return {
        "summary": {
            "total_active": total,
            "in_office": in_office,
            "checked_out": checked_out,
            "not_checked_in": not_in
        },
        "employees": out,
        "as_of": datetime.now().isoformat()
    }


@router.delete("/attendance/{attendance_id}")
def delete_attendance(
    attendance_id: int,
    db: Session = Depends(get_db)
):

    record = db.query(Attendance).filter(
        Attendance.ID == attendance_id
    ).first()

    if not record:

        raise HTTPException(
            status_code=404,
            detail="Attendance record not found"
        )

    db.delete(record)

    db.commit()

    return {"message": "Attendance deleted"}
