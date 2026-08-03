from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, date, time
from typing import Optional
from pydantic import BaseModel

from app.database.database import get_db

from app.models.models import (
    Attendance,
    Employee,
    TaskAssignment,
    Project,
    Department,
    GeofenceSettings,
    AttendanceSecurityLog
)

from app.schemas.attendance_schema import (
    CheckInRequest,
    CheckOutRequest,
    MarkAbsentRequest
)

from app.routes.geofence import (
    haversine_meters,
    _get_or_create_settings as get_geofence_settings
)

from app.utils.employee_resolver import resolve_employee_uuid

from app.auth.auth_bearer import (
    get_current_admin,
    get_current_user,
    assert_self_or_admin,
    require,
    ADMIN_ROLES,
)

router = APIRouter()


# =========================
# Geofence helpers (used by both check-in and check-out)
# =========================

def _check_geofence(
    db: Session,
    vendor_id: int,
    lat: float | None,
    lng: float | None
) -> dict:
    """Return {allowed, distance_m, status, settings}.

    - allowed: True if inside radius OR enforcement is OFF OR no
      coordinates were sent (back-compat with legacy callers).
    - distance_m: metres from the configured office (None if no coords).
    - status: 'INSIDE' / 'OUTSIDE' / 'UNKNOWN'.
    """

    settings = get_geofence_settings(db, vendor_id)

    if lat is None or lng is None:

        return {
            "allowed": True,                  # back-compat
            "distance_m": None,
            "status": "UNKNOWN",
            "settings": settings
        }

    distance = haversine_meters(
        lat, lng, settings.LATITUDE, settings.LONGITUDE
    )

    inside = distance <= settings.RADIUS_METERS

    enforced = bool(settings.IS_ACTIVE)

    return {
        "allowed": inside or (not enforced),
        "distance_m": round(distance, 2),
        "status": "INSIDE" if inside else "OUTSIDE",
        "settings": settings
    }


def _log_failure(
    db: Session,
    employee_id: str | None,
    reason: str,
    lat: float | None,
    lng: float | None,
    distance: float | None,
    detail: str | None,
    device_info: str | None,
    ip: str | None,
    vendor_id: int
):
    """Record a blocked attempt in the security log table."""

    row = AttendanceSecurityLog(
        EMPLOYEE_ID=employee_id,
        LATITUDE=lat,
        LONGITUDE=lng,
        DISTANCE=distance,
        REASON=reason[:80],
        DETAIL=(detail or "")[:500] or None,
        DEVICE_INFO=(device_info or "")[:255] or None,
        IP_ADDRESS=ip,
        VENDOR_ID=vendor_id
    )

    db.add(row)

    db.commit()


# Fallback office-start used only when the Setting rows are missing.
# Source of truth is attendance_settings_service.get_office_hours(db)
# — that reads from the `setting` table (configurable from the UI).
WORK_START_HOUR = 9
WORK_START_MINUTE = 15


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
    request: Request,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    # An employee can only check IN as themselves; admins (e.g. kiosk
    # operators or HR via the live floor board) may check in anyone.
    assert_self_or_admin(data.EMPLOYEE_ID, payload)

    # Normalise either UUID or EMPLOYEE_CODE (e.g. "EMP101") to the
    # canonical UUID. The /employee-login flow returns the CODE under
    # the EMPLOYEE_ID key, so self-service callers need this bridge.
    # Raises 404 here if the employee genuinely doesn't exist.
    data.EMPLOYEE_ID = resolve_employee_uuid(db, data.EMPLOYEE_ID)

    emp = db.query(Employee).filter(
        Employee.ID == data.EMPLOYEE_ID
    ).first()

    if not emp:

        raise HTTPException(
            status_code=404,
            detail="Employee not found"
        )

    ip = request.client.host if request.client else None

    # ---- Geofence gate (server-side re-validation) ----
    geo = _check_geofence(db, data.VENDOR_ID, data.LATITUDE, data.LONGITUDE)

    if not geo["allowed"] and not data.BYPASS_GEOFENCE:

        _log_failure(
            db, data.EMPLOYEE_ID, "OUTSIDE_GEOFENCE",
            data.LATITUDE, data.LONGITUDE, geo["distance_m"],
            f"Check-in blocked: {geo['distance_m']}m from office (max {geo['settings'].RADIUS_METERS}m)",
            data.DEVICE_INFO, ip, data.VENDOR_ID
        )

        raise HTTPException(
            status_code=403,
            detail=(
                f"Outside office geofence — you are {round(geo['distance_m'])}m "
                f"from {geo['settings'].OFFICE_NAME or 'the office'} "
                f"(max allowed {geo['settings'].RADIUS_METERS}m). "
                f"Move closer and try again."
            )
        )

    # If the caller explicitly bypassed the gate, log the override
    # for audit + tag the status so HR can filter on it later.
    if not geo["allowed"] and data.BYPASS_GEOFENCE:
        _log_failure(
            db, data.EMPLOYEE_ID, "GEOFENCE_BYPASSED",
            data.LATITUDE, data.LONGITUDE, geo["distance_m"],
            "Admin/employee bypassed geofence gate at check-in.",
            data.DEVICE_INFO, ip, data.VENDOR_ID
        )
        geo["status"] = "BYPASSED"

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

    # ---- Persist geo + device info ----
    record.CHECKIN_LATITUDE  = data.LATITUDE
    record.CHECKIN_LONGITUDE = data.LONGITUDE
    record.CHECKIN_DISTANCE  = geo["distance_m"]
    record.GEOFENCE_STATUS   = geo["status"]
    record.DEVICE_INFO       = (data.DEVICE_INFO or "")[:255] or record.DEVICE_INFO
    record.BROWSER_INFO      = (data.BROWSER_INFO or "")[:255] or record.BROWSER_INFO
    record.IP_ADDRESS        = ip or record.IP_ADDRESS

    db.commit()

    db.refresh(record)

    return {
        "message": "Checked in",
        "attendance_id": record.ID,
        "status": record.STATUS,
        "geofence_status": record.GEOFENCE_STATUS,
        "distance_meters": record.CHECKIN_DISTANCE
    }


# =========================
# CHECK OUT
# =========================

@router.post("/check-out")
def check_out(
    data: CheckOutRequest,
    request: Request,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    # An employee can only check OUT as themselves; admins may
    # check out anyone (e.g. shift supervisor closing the floor).
    assert_self_or_admin(data.EMPLOYEE_ID, payload)

    # Accept either UUID or EMPLOYEE_CODE — see check-in route comment.
    data.EMPLOYEE_ID = resolve_employee_uuid(db, data.EMPLOYEE_ID)

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

    ip = request.client.host if request.client else None

    # ---- Geofence gate on check-out as well ----
    vendor_id = record.VENDOR_ID or 1

    geo = _check_geofence(db, vendor_id, data.LATITUDE, data.LONGITUDE)

    if not geo["allowed"] and not data.BYPASS_GEOFENCE:

        _log_failure(
            db, data.EMPLOYEE_ID, "OUTSIDE_GEOFENCE",
            data.LATITUDE, data.LONGITUDE, geo["distance_m"],
            f"Check-out blocked: {geo['distance_m']}m from office",
            data.DEVICE_INFO, ip, vendor_id
        )

        raise HTTPException(
            status_code=403,
            detail=(
                f"Outside office geofence — you are {round(geo['distance_m'])}m "
                f"from the office (max {geo['settings'].RADIUS_METERS}m). "
                f"Move closer to check out."
            )
        )

    if not geo["allowed"] and data.BYPASS_GEOFENCE:
        _log_failure(
            db, data.EMPLOYEE_ID, "GEOFENCE_BYPASSED",
            data.LATITUDE, data.LONGITUDE, geo["distance_m"],
            "Admin/employee bypassed geofence gate at check-out.",
            data.DEVICE_INFO, ip, vendor_id
        )
        # Keep the existing GEOFENCE_STATUS on the record (set at check-in
        # time) — checkout-side bypass doesn't overwrite the morning's
        # geofence verdict. Distance below is still computed + stored.

    now = datetime.now()

    record.CHECK_OUT = now

    # Compute worked hours + overtime
    delta = now - record.CHECK_IN

    hours = round(delta.total_seconds() / 3600, 2)

    record.WORKED_HOURS = hours

    # OT is no longer auto-derived from regular hours. Employees must
    # explicitly start a separate OT session (POST /attendance/ot-check-in)
    # for any time after their regular check-out to count as overtime.

    # ---- Persist check-out geo ----
    record.CHECKOUT_LATITUDE  = data.LATITUDE
    record.CHECKOUT_LONGITUDE = data.LONGITUDE
    record.CHECKOUT_DISTANCE  = geo["distance_m"]

    db.commit()

    return {
        "message": "Checked out",
        "attendance_id": record.ID,
        "worked_hours": record.WORKED_HOURS,
        "overtime_hours": record.OVERTIME_HOURS,
        "checkout_distance_meters": record.CHECKOUT_DISTANCE
    }


# =========================
# OT CHECK-IN / CHECK-OUT
# =========================
# Overtime is a SECOND session within the same day. The employee
# completes their regular check-out first, then starts an OT session
# when they continue working. OT hours are computed strictly from
# (OT_CHECK_OUT - OT_CHECK_IN).

class _OtRequest(BaseModel):
    EMPLOYEE_ID: str


@router.post("/ot-check-in")
def ot_check_in(
    data: _OtRequest,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Start the OT session for today. Requires regular check-out to
    be done first. Idempotent — re-calling while OT is in progress
    returns the existing OT_CHECK_IN."""

    assert_self_or_admin(data.EMPLOYEE_ID, payload)
    data.EMPLOYEE_ID = resolve_employee_uuid(db, data.EMPLOYEE_ID)

    today = date.today()
    record = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == data.EMPLOYEE_ID,
        Attendance.DATE == today
    ).first()

    if not record:
        raise HTTPException(
            status_code=404,
            detail="No check-in record for today. Check in first."
        )

    if not record.CHECK_OUT:
        raise HTTPException(
            status_code=400,
            detail="Complete the regular check-out before starting OT."
        )

    if record.OT_CHECK_OUT:
        raise HTTPException(
            status_code=400,
            detail="OT session for today is already closed."
        )

    if record.OT_CHECK_IN:
        # Idempotent — return the existing timestamp
        return {
            "message": "OT already in progress",
            "ot_check_in": record.OT_CHECK_IN.isoformat()
        }

    record.OT_CHECK_IN = datetime.now()
    db.commit()

    return {
        "message": "OT started",
        "attendance_id": record.ID,
        "ot_check_in": record.OT_CHECK_IN.isoformat()
    }


@router.post("/ot-check-out")
def ot_check_out(
    data: _OtRequest,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Close the OT session — computes OVERTIME_HOURS from the delta."""

    assert_self_or_admin(data.EMPLOYEE_ID, payload)
    data.EMPLOYEE_ID = resolve_employee_uuid(db, data.EMPLOYEE_ID)

    today = date.today()
    record = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == data.EMPLOYEE_ID,
        Attendance.DATE == today
    ).first()

    if not record or not record.OT_CHECK_IN:
        raise HTTPException(
            status_code=400,
            detail="No OT session in progress. Start OT first."
        )

    if record.OT_CHECK_OUT:
        raise HTTPException(
            status_code=400,
            detail="OT session for today is already closed."
        )

    now = datetime.now()
    record.OT_CHECK_OUT = now
    delta = now - record.OT_CHECK_IN
    record.OVERTIME_HOURS = max(0.0, round(delta.total_seconds() / 3600, 2))
    db.commit()

    return {
        "message": "OT closed",
        "attendance_id": record.ID,
        "ot_check_in":  record.OT_CHECK_IN.isoformat(),
        "ot_check_out": record.OT_CHECK_OUT.isoformat(),
        "overtime_hours": record.OVERTIME_HOURS
    }


# =========================
# MARK ABSENT
# =========================

@router.post("/mark-absent", dependencies=[Depends(require("attendance.mark.others"))])
def mark_absent(
    data: MarkAbsentRequest,
    db: Session = Depends(get_db)
):

    # Accept either UUID or EMPLOYEE_CODE — see check-in route comment.
    data.EMPLOYEE_ID = resolve_employee_uuid(db, data.EMPLOYEE_ID)

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

@router.get("/attendance", dependencies=[Depends(require("attendance.view.all"))])
def get_attendance(
    start_date:  Optional[date] = Query(None, description="Inclusive lower bound on DATE"),
    end_date:    Optional[date] = Query(None, description="Inclusive upper bound on DATE"),
    employee_id: Optional[str]  = Query(None, description="Employee UUID or EMPLOYEE_CODE"),
    status:      Optional[str]  = Query(None, description="PRESENT / LATE / ABSENT / HALF_DAY"),
    limit:       int            = Query(100, ge=1, le=1000),
    offset:      int            = Query(0,   ge=0),
    db: Session = Depends(get_db),
):
    """
    Filterable attendance history.

    Returns an envelope `{ total, rows }` so the UI can paginate. With no
    filters, returns the most-recent `limit` rows.
    """
    q = db.query(
        Attendance, Employee.NAME, Employee.EMPLOYEE_CODE
    ).outerjoin(
        Employee, Attendance.EMPLOYEE_ID == Employee.ID
    )

    if start_date:
        q = q.filter(Attendance.DATE >= start_date)
    if end_date:
        q = q.filter(Attendance.DATE <= end_date)
    if status:
        q = q.filter(Attendance.STATUS == status.upper().strip())
    if employee_id:
        # Accept either UUID or EMPLOYEE_CODE
        q = q.filter(
            (Attendance.EMPLOYEE_ID == employee_id) |
            (Employee.EMPLOYEE_CODE == employee_id)
        )

    total = q.count()

    rows = q.order_by(
        Attendance.DATE.desc(),
        Attendance.CHECK_IN.desc()
    ).offset(offset).limit(limit).all()

    out = []
    for record, name, code in rows:
        out.append({
            "ID": record.ID,
            "EMPLOYEE_ID": record.EMPLOYEE_ID,
            "EMPLOYEE_CODE": code,
            "EMPLOYEE_NAME": name,
            "DATE": record.DATE.isoformat() if record.DATE else None,
            "CHECK_IN":  record.CHECK_IN.isoformat()  if record.CHECK_IN  else None,
            "CHECK_OUT": record.CHECK_OUT.isoformat() if record.CHECK_OUT else None,
            "STATUS": record.STATUS,
            "WORKED_HOURS": record.WORKED_HOURS,
            "OVERTIME_HOURS": record.OVERTIME_HOURS,
            "OT_CHECK_IN":  record.OT_CHECK_IN.isoformat()  if record.OT_CHECK_IN  else None,
            "OT_CHECK_OUT": record.OT_CHECK_OUT.isoformat() if record.OT_CHECK_OUT else None,
            "REMARKS": record.REMARKS,
            "VENDOR_ID": record.VENDOR_ID,
            # ---- Geofence ----
            "CHECKIN_LATITUDE":   record.CHECKIN_LATITUDE,
            "CHECKIN_LONGITUDE":  record.CHECKIN_LONGITUDE,
            "CHECKIN_DISTANCE":   record.CHECKIN_DISTANCE,
            "CHECKOUT_LATITUDE":  record.CHECKOUT_LATITUDE,
            "CHECKOUT_LONGITUDE": record.CHECKOUT_LONGITUDE,
            "CHECKOUT_DISTANCE":  record.CHECKOUT_DISTANCE,
            "GEOFENCE_STATUS":    record.GEOFENCE_STATUS,
            "DEVICE_INFO":        record.DEVICE_INFO,
            "BROWSER_INFO":       record.BROWSER_INFO,
            "IP_ADDRESS":         record.IP_ADDRESS,
        })

    return {
        "total":  total,
        "limit":  limit,
        "offset": offset,
        "rows":   out,
    }


@router.get("/attendance/today")
def get_today_attendance(
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Today's attendance rows.

    - Admins see every employee's row.
    - Employees see only their own row (so the Employee Portal's
      attendance widget can render without a separate endpoint).
    """

    today = date.today()

    q = db.query(
        Attendance,
        Employee.NAME,
        Employee.EMPLOYEE_CODE
    ).outerjoin(
        Employee,
        Attendance.EMPLOYEE_ID == Employee.ID
    ).filter(
        Attendance.DATE == today
    )

    if payload.get("role") not in ADMIN_ROLES:
        # Scope to caller's own row only.
        q = q.filter(Attendance.EMPLOYEE_ID == payload.get("employee_id"))

    rows = q.all()

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
            "OVERTIME_HOURS": rec.OVERTIME_HOURS,
            "OT_CHECK_IN":  rec.OT_CHECK_IN.isoformat()  if rec.OT_CHECK_IN  else None,
            "OT_CHECK_OUT": rec.OT_CHECK_OUT.isoformat() if rec.OT_CHECK_OUT else None,
            # ---- Geofence (must match /attendance shape so the Today
            # ----  tab renders the same columns as All Records)
            "CHECKIN_LATITUDE":   rec.CHECKIN_LATITUDE,
            "CHECKIN_LONGITUDE":  rec.CHECKIN_LONGITUDE,
            "CHECKIN_DISTANCE":   rec.CHECKIN_DISTANCE,
            "CHECKOUT_LATITUDE":  rec.CHECKOUT_LATITUDE,
            "CHECKOUT_LONGITUDE": rec.CHECKOUT_LONGITUDE,
            "CHECKOUT_DISTANCE":  rec.CHECKOUT_DISTANCE,
            "GEOFENCE_STATUS":    rec.GEOFENCE_STATUS,
            "DEVICE_INFO":        rec.DEVICE_INFO,
            "BROWSER_INFO":       rec.BROWSER_INFO,
            "IP_ADDRESS":         rec.IP_ADDRESS
        }
        for rec, name, code in rows
    ]


@router.get("/attendance/live-board", dependencies=[Depends(require("attendance.view.all"))])
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


@router.delete("/attendance/{attendance_id}", dependencies=[Depends(require("attendance.delete"))])
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


# =====================================================================
# ATTENDANCE REPORT — per-employee aggregates over a date range
# =====================================================================

@router.get("/attendance/report",
            dependencies=[Depends(require("attendance.view.all"))])
def attendance_report(
    start_date: date = Query(..., description="Inclusive lower bound"),
    end_date:   date = Query(..., description="Inclusive upper bound"),
    db: Session = Depends(get_db),
):
    """
    Returns per-employee summary across the date range:
      - working_days (date range total)
      - present, absent, late, half_day counts
      - worked_hours, overtime_hours
      - attendance_pct
    Plus a totals block for the whole company.
    """
    if end_date < start_date:
        raise HTTPException(400, "end_date must be >= start_date")

    # Pre-load ACTIVE employees so we surface zeros for those with no
    # attendance rows in the range.
    employees = (db.query(Employee)
                 .filter(Employee.STATUS == "ACTIVE")
                 .order_by(Employee.NAME.asc()).all())

    # Aggregate attendance per employee in one query
    from collections import defaultdict
    buckets = defaultdict(lambda: {
        "present": 0, "absent": 0, "late": 0, "half_day": 0,
        "worked_hours": 0.0, "overtime_hours": 0.0,
    })
    rows = (db.query(Attendance)
            .filter(Attendance.DATE >= start_date,
                    Attendance.DATE <= end_date).all())
    for r in rows:
        b = buckets[r.EMPLOYEE_ID]
        s = (r.STATUS or "").upper()
        if   s == "PRESENT":  b["present"]  += 1
        elif s == "LATE":     b["late"]     += 1; b["present"] += 1
        elif s == "ABSENT":   b["absent"]   += 1
        elif s == "HALF_DAY": b["half_day"] += 1; b["present"] += 0.5
        b["worked_hours"]   += float(r.WORKED_HOURS or 0)
        b["overtime_hours"] += float(r.OVERTIME_HOURS or 0)

    # Working-day count = total days in range minus Sundays
    working_days = 0
    d = start_date
    while d <= end_date:
        if d.weekday() != 6:   # 6 = Sunday
            working_days += 1
        d = date.fromordinal(d.toordinal() + 1)

    items = []
    for emp in employees:
        b = buckets[emp.ID]
        present = b["present"]
        attendance_pct = (
            round(present / working_days * 100, 1)
            if working_days else 0.0
        )
        items.append({
            "employee_id":   emp.ID,
            "employee_code": emp.EMPLOYEE_CODE,
            "employee_name": emp.NAME,
            "working_days":  working_days,
            "present":       present,
            "absent":        b["absent"],
            "late":          b["late"],
            "half_day":      b["half_day"],
            "worked_hours":  round(b["worked_hours"], 1),
            "overtime_hours":round(b["overtime_hours"], 1),
            "attendance_pct": attendance_pct,
        })

    # Sort by attendance_pct desc so top performers show first
    items.sort(key=lambda r: (-r["attendance_pct"], r["employee_name"]))

    totals = {
        "employees":       len(items),
        "working_days":    working_days,
        "total_present":   sum(i["present"]  for i in items),
        "total_absent":    sum(i["absent"]   for i in items),
        "total_late":      sum(i["late"]     for i in items),
        "total_hours":     round(sum(i["worked_hours"]   for i in items), 1),
        "total_overtime":  round(sum(i["overtime_hours"] for i in items), 1),
        "avg_attendance_pct": (
            round(sum(i["attendance_pct"] for i in items) / len(items), 1)
            if items else 0.0
        ),
    }

    return {
        "start_date": start_date.isoformat(),
        "end_date":   end_date.isoformat(),
        "totals":     totals,
        "rows":       items,
    }


# =====================================================================
# EMPLOYEE TRACKING — per-employee daily attendance over last N days
# =====================================================================

@router.get("/attendance/employee/{employee_id}/tracking")
def employee_attendance_tracking(
    employee_id: str,
    days: int = Query(90, ge=7, le=365),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Per-employee tracking view used by the Attendance > Tracking tab.

      - summary KPIs (present, absent, late, hours, attendance %)
      - daily timeline (date → status) for the last N days, used by the
        UI to render a calendar heatmap
    """
    from datetime import timedelta as _td

    emp = (db.query(Employee)
           .filter((Employee.ID == employee_id) |
                   (Employee.EMPLOYEE_CODE == employee_id)).first())
    if not emp:
        raise HTTPException(404, "Employee not found")

    end_d   = date.today()
    start_d = end_d - _td(days=days - 1)

    rows = (db.query(Attendance)
            .filter(Attendance.EMPLOYEE_ID == emp.ID,
                    Attendance.DATE >= start_d,
                    Attendance.DATE <= end_d)
            .order_by(Attendance.DATE.asc()).all())

    by_date = {r.DATE: r for r in rows}

    timeline = []
    present, absent, late, half = 0, 0, 0, 0
    worked_hours, ot_hours = 0.0, 0.0

    d = start_d
    while d <= end_d:
        rec = by_date.get(d)
        if rec:
            s = (rec.STATUS or "").upper()
            if s == "PRESENT":  present += 1
            elif s == "LATE":   late    += 1; present += 1
            elif s == "ABSENT": absent  += 1
            elif s == "HALF_DAY": half += 1; present += 0.5
            worked_hours += float(rec.WORKED_HOURS or 0)
            ot_hours     += float(rec.OVERTIME_HOURS or 0)
            check_in_str = (
                rec.CHECK_IN.strftime("%H:%M") if rec.CHECK_IN else None
            )
            check_out_str = (
                rec.CHECK_OUT.strftime("%H:%M") if rec.CHECK_OUT else None
            )
            timeline.append({
                "date":          d.isoformat(),
                "weekday":       d.strftime("%a"),
                "status":        s,
                "check_in":      check_in_str,
                "check_out":     check_out_str,
                "worked_hours":  float(rec.WORKED_HOURS or 0),
                "overtime_hours":float(rec.OVERTIME_HOURS or 0),
            })
        else:
            # No row for that day — treat Sundays as WEEKLY_OFF, else NO_DATA
            timeline.append({
                "date":     d.isoformat(),
                "weekday":  d.strftime("%a"),
                "status":   "WEEKLY_OFF" if d.weekday() == 6 else "NO_DATA",
                "check_in": None, "check_out": None,
                "worked_hours": 0, "overtime_hours": 0,
            })
        d = date.fromordinal(d.toordinal() + 1)

    # Working days = days in range minus Sundays
    working_days = sum(1 for t in timeline if t["status"] != "WEEKLY_OFF")
    attendance_pct = round(present / working_days * 100, 1) if working_days else 0.0

    return {
        "employee": {
            "id":   emp.ID,
            "code": emp.EMPLOYEE_CODE,
            "name": emp.NAME,
            "department_id":  emp.DEPARTMENT_ID,
            "designation_id": emp.DESIGNATION_ID,
        },
        "window": {
            "start_date":   start_d.isoformat(),
            "end_date":     end_d.isoformat(),
            "days":         days,
            "working_days": working_days,
        },
        "summary": {
            "present":         present,
            "absent":          absent,
            "late":            late,
            "half_day":        half,
            "worked_hours":    round(worked_hours, 1),
            "overtime_hours":  round(ot_hours, 1),
            "attendance_pct":  attendance_pct,
        },
        "timeline": timeline,
    }
