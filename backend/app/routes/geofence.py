"""
Geofenced Attendance — admin settings + runtime distance validation.

Endpoints
---------
  GET    /geofence/settings           Current office config (admin + portal)
  PUT    /geofence/settings           Admin-only: save office lat/lng/radius
  POST   /geofence/validate           Frontend pre-check: returns
                                      { allowed, distance_meters, radius }
                                      Used by the Attendance page to gate
                                      the biometric scanner.
  POST   /geofence/log-failure        Frontend reports a failure
                                      (outside fence, GPS denied, face
                                      verification failed, etc.) for the
                                      security log.
  GET    /geofence/dashboard          Admin dashboard widgets:
                                      present/absent/late/inside/outside
                                      counts for today.
  GET    /geofence/security-logs      Paginated security log feed
                                      (admin only) with employee name.

Distance is computed using the Haversine formula on the WGS-84
spherical-earth approximation. Accurate to ~0.5% over the
sub-kilometre distances we care about.
"""

from datetime import date, datetime, timedelta
from math import asin, cos, radians, sin, sqrt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    GeofenceSettings,
    AttendanceSecurityLog,
    Attendance,
    Employee
)

from app.auth.auth_bearer import (
    get_current_admin,
    get_current_user,
    require,
    ADMIN_ROLES,
)


router = APIRouter(prefix="/geofence", tags=["Geofence"])


# =====================================================================
# Distance — Haversine formula (km, then × 1000 for metres)
# =====================================================================

EARTH_RADIUS_METERS = 6_371_000.0


def haversine_meters(
    lat1: float, lng1: float,
    lat2: float, lng2: float
) -> float:
    """Great-circle distance between two lat/lng points in METRES.

    Inputs are decimal degrees. Returns a non-negative float.
    Accurate enough for sub-km work (~0.5% error)."""

    if None in (lat1, lng1, lat2, lng2):

        return float("inf")

    phi1, phi2 = radians(lat1), radians(lat2)

    dphi = radians(lat2 - lat1)

    dlmb = radians(lng2 - lng1)

    a = (
        sin(dphi / 2) ** 2
        + cos(phi1) * cos(phi2) * sin(dlmb / 2) ** 2
    )

    c = 2 * asin(sqrt(a))

    return EARTH_RADIUS_METERS * c


# =====================================================================
# Settings — single row per vendor (one office for v1)
# =====================================================================

DEFAULT_RADIUS_M = 100


def _get_or_create_settings(db: Session, vendor_id: int = 1) -> GeofenceSettings:
    """Return the (single) geofence row for this vendor, creating a
    sensible default if none exists yet."""

    row = (
        db.query(GeofenceSettings)
        .filter(GeofenceSettings.VENDOR_ID == vendor_id)
        .first()
    )

    if row:

        return row

    # Fallback to any row (older single-vendor installs)
    row = db.query(GeofenceSettings).first()

    if row:

        return row

    row = GeofenceSettings(
        VENDOR_ID=vendor_id,
        OFFICE_NAME="Head Office",
        LATITUDE=11.04105,
        LONGITUDE=77.03944,
        RADIUS_METERS=DEFAULT_RADIUS_M,
        IS_ACTIVE=1
    )

    db.add(row)

    db.commit()

    db.refresh(row)

    return row


def _serialize_settings(s: GeofenceSettings) -> dict:

    return {
        "ID": s.ID,
        "VENDOR_ID": s.VENDOR_ID,
        "OFFICE_NAME": s.OFFICE_NAME or "",
        "LATITUDE": s.LATITUDE,
        "LONGITUDE": s.LONGITUDE,
        "RADIUS_METERS": s.RADIUS_METERS,
        "IS_ACTIVE": bool(s.IS_ACTIVE),
        "CREATED_AT": s.CREATED_AT.isoformat() if s.CREATED_AT else None,
        "UPDATED_AT": s.UPDATED_AT.isoformat() if s.UPDATED_AT else None
    }


class SettingsBody(BaseModel):

    OFFICE_NAME: Optional[str] = None
    LATITUDE: float = Field(..., ge=-90, le=90)
    LONGITUDE: float = Field(..., ge=-180, le=180)
    RADIUS_METERS: int = Field(default=DEFAULT_RADIUS_M, ge=10, le=10_000)
    IS_ACTIVE: bool = True
    VENDOR_ID: int = 1


@router.get("/settings")
def get_settings(vendor_id: int = 1, db: Session = Depends(get_db)):
    """Current geofence config. Auto-seeds with the BVC24 head-office
    coordinates if no row exists yet, so the attendance flow has
    something to validate against from day one."""

    s = _get_or_create_settings(db, vendor_id)

    return _serialize_settings(s)


@router.put("/settings", dependencies=[Depends(require("geofence.settings.update"))])
def save_settings(body: SettingsBody, db: Session = Depends(get_db)):
    """Admin saves new office coordinates / radius. Single row per
    vendor — we UPSERT rather than insert."""

    s = _get_or_create_settings(db, body.VENDOR_ID)

    s.OFFICE_NAME = (body.OFFICE_NAME or "").strip() or "Head Office"
    s.LATITUDE = float(body.LATITUDE)
    s.LONGITUDE = float(body.LONGITUDE)
    s.RADIUS_METERS = int(body.RADIUS_METERS)
    s.IS_ACTIVE = 1 if body.IS_ACTIVE else 0

    db.commit()

    db.refresh(s)

    return {
        "message": "Geofence settings saved",
        "settings": _serialize_settings(s)
    }


# =====================================================================
# Runtime validation — frontend calls this before biometric scan
# =====================================================================

class ValidateBody(BaseModel):

    LATITUDE: float = Field(..., ge=-90, le=90)
    LONGITUDE: float = Field(..., ge=-180, le=180)
    VENDOR_ID: int = 1


@router.post("/validate")
def validate_location(body: ValidateBody, db: Session = Depends(get_db)):
    """Returns whether the given lat/lng is inside the office geofence.

    The frontend uses this BEFORE attempting biometric / face scan
    so the user sees a clear "you're 350m from office" message
    instead of just a generic check-in failure. The backend re-validates
    in /attendance/check-in so this isn't a security boundary."""

    s = _get_or_create_settings(db, body.VENDOR_ID)

    distance = haversine_meters(
        body.LATITUDE, body.LONGITUDE,
        s.LATITUDE, s.LONGITUDE
    )

    allowed = (not bool(s.IS_ACTIVE)) or (distance <= s.RADIUS_METERS)

    return {
        "allowed": bool(allowed),
        "distance_meters": round(distance, 2),
        "radius_meters": s.RADIUS_METERS,
        "office_name": s.OFFICE_NAME or "Head Office",
        "office_latitude": s.LATITUDE,
        "office_longitude": s.LONGITUDE,
        "enforcement_active": bool(s.IS_ACTIVE),
        "message": (
            "Inside office geofence ✓"
            if allowed else
            f"You're {round(distance)}m from the office "
            f"(max allowed {s.RADIUS_METERS}m). Move closer to mark attendance."
        )
    }


# =====================================================================
# Security logging — every failed attempt
# =====================================================================

class FailureBody(BaseModel):

    EMPLOYEE_ID: Optional[str] = None
    LATITUDE: Optional[float] = None
    LONGITUDE: Optional[float] = None
    DISTANCE: Optional[float] = None
    REASON: str
    # One of: OUTSIDE_GEOFENCE / GPS_DISABLED / PERMISSION_DENIED /
    #        LOCATION_TIMEOUT / INVALID_COORDS / FACE_FAILED / OTHER
    DETAIL: Optional[str] = None
    DEVICE_INFO: Optional[str] = None
    VENDOR_ID: int = 1


@router.post("/log-failure")
def log_failure(
    body: FailureBody,
    request: Request,
    db: Session = Depends(get_db)
):
    """Persist a failed attendance attempt for the security audit log."""

    ip = request.client.host if request.client else None

    log = AttendanceSecurityLog(
        EMPLOYEE_ID=(body.EMPLOYEE_ID or None),
        LATITUDE=body.LATITUDE,
        LONGITUDE=body.LONGITUDE,
        DISTANCE=body.DISTANCE,
        REASON=(body.REASON or "OTHER").upper()[:80],
        DETAIL=(body.DETAIL or "")[:500] or None,
        DEVICE_INFO=(body.DEVICE_INFO or "")[:255] or None,
        IP_ADDRESS=ip,
        VENDOR_ID=body.VENDOR_ID
    )

    db.add(log)

    db.commit()

    return {"message": "Failure logged", "id": log.ID}


@router.get("/security-logs")
def list_security_logs(
    limit: int = 50,
    reason: Optional[str] = None,
    employee_id: Optional[str] = None,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Recent geofence/attendance failures with the employee name joined.

    - Admins can query any employee_id (or omit it for global view).
    - Employees can only see their own failures — any employee_id
      query is forced to their own identity.
    """

    is_admin = payload.get("role") in ADMIN_ROLES

    if not is_admin:
        # Non-admins are scoped to their own failures only.
        own_id = payload.get("employee_id")
        if employee_id and employee_id != own_id:
            raise HTTPException(
                status_code=403,
                detail="You can only view your own attendance attempts."
            )
        employee_id = own_id

    q = (
        db.query(AttendanceSecurityLog, Employee)
        .outerjoin(Employee, AttendanceSecurityLog.EMPLOYEE_ID == Employee.ID)
        .order_by(AttendanceSecurityLog.CREATED_AT.desc())
    )

    if reason:

        q = q.filter(AttendanceSecurityLog.REASON == reason.upper())

    if employee_id:

        q = q.filter(AttendanceSecurityLog.EMPLOYEE_ID == employee_id)

    rows = q.limit(min(limit, 500)).all()

    return [
        {
            "ID": log.ID,
            "EMPLOYEE_ID": log.EMPLOYEE_ID,
            "EMPLOYEE_NAME": emp.NAME if emp else None,
            "EMPLOYEE_CODE": emp.EMPLOYEE_CODE if emp else None,
            "LATITUDE": log.LATITUDE,
            "LONGITUDE": log.LONGITUDE,
            "DISTANCE": log.DISTANCE,
            "REASON": log.REASON,
            "DETAIL": log.DETAIL,
            "DEVICE_INFO": log.DEVICE_INFO,
            "IP_ADDRESS": log.IP_ADDRESS,
            "CREATED_AT": log.CREATED_AT.isoformat() if log.CREATED_AT else None
        }
        for log, emp in rows
    ]


# =====================================================================
# DELETE security log entries (admin cleanup)
# =====================================================================

@router.delete("/security-logs/{log_id}", dependencies=[Depends(require("geofence.logs.delete"))])
def delete_security_log(log_id: int, db: Session = Depends(get_db)):
    """Permanently remove a single security log entry. Use sparingly —
    these entries are normally kept as an audit trail of failed
    attendance attempts."""

    row = (
        db.query(AttendanceSecurityLog)
        .filter(AttendanceSecurityLog.ID == log_id)
        .first()
    )

    if not row:

        raise HTTPException(404, "Security log entry not found")

    db.delete(row)

    db.commit()

    return {"message": f"Security log entry {log_id} deleted"}


@router.delete("/security-logs", dependencies=[Depends(require("geofence.logs.delete"))])
def delete_security_logs_bulk(
    reason: Optional[str]      = None,
    employee_id: Optional[str] = None,
    older_than_days: Optional[int] = None,
    confirm: bool              = False,
    db: Session = Depends(get_db)
):
    """Bulk-delete security logs by filter. Requires ?confirm=true to
    prevent accidental wipes. If no filter is given AND confirm=true,
    deletes ALL logs (full reset)."""

    if not confirm:

        raise HTTPException(
            400,
            "Pass ?confirm=true to actually delete. Optional filters: "
            "?reason=PERMISSION_DENIED  ?employee_id=...  ?older_than_days=30"
        )

    q = db.query(AttendanceSecurityLog)

    if reason:

        q = q.filter(AttendanceSecurityLog.REASON == reason.upper())

    if employee_id:

        q = q.filter(AttendanceSecurityLog.EMPLOYEE_ID == employee_id)

    if older_than_days is not None and older_than_days > 0:

        cutoff = datetime.utcnow() - timedelta(days=older_than_days)

        q = q.filter(AttendanceSecurityLog.CREATED_AT < cutoff)

    deleted = q.delete(synchronize_session=False)

    db.commit()

    return {"message": f"Deleted {deleted} security log entr(y/ies)", "count": deleted}


# =====================================================================
# Dashboard — widget counters
# =====================================================================

@router.get("/dashboard", dependencies=[Depends(require("geofence.dashboard.view"))])
def geofence_dashboard(db: Session = Depends(get_db)):
    """Today's attendance counters broken down by geofence status.
    Drives the widget row on the admin attendance dashboard."""

    today = date.today()

    rows = db.query(Attendance).filter(Attendance.DATE == today).all()

    active_emp_count = (
        db.query(Employee).filter(Employee.STATUS == "ACTIVE").count()
    )

    present = sum(1 for r in rows if r.STATUS in ("PRESENT", "LATE", "HALF_DAY"))

    late    = sum(1 for r in rows if r.STATUS == "LATE")

    inside  = sum(1 for r in rows if r.GEOFENCE_STATUS == "INSIDE")

    outside = sum(1 for r in rows if r.GEOFENCE_STATUS == "OUTSIDE")

    absent  = max(0, active_emp_count - present)

    failures_today = (
        db.query(AttendanceSecurityLog)
        .filter(AttendanceSecurityLog.CREATED_AT >= datetime.combine(today, datetime.min.time()))
        .count()
    )

    return {
        "date": today.isoformat(),
        "active_employees": active_emp_count,
        "present_today":  present,
        "absent_today":   absent,
        "late_today":     late,
        "inside_geofence":  inside,
        "outside_geofence": outside,
        "security_failures_today": failures_today
    }
