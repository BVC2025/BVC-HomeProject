"""
Self-service endpoints for the currently logged-in employee.

Mounted at /me. Everything here is self-only — the JWT identifies
the caller and we never trust an employee_id in the request body
without cross-checking against the token.

Endpoints:
  POST /me/change-password       — change own password
  GET  /me/login-history         — recent login / check-in history
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Employee, Attendance
from app.auth.auth_bearer import get_current_user
from app.services.auth_service import verify_password, hash_password


router = APIRouter(prefix="/me", tags=["Employee Self-Service"])


# =====================================================================
# Schemas
# =====================================================================

class PasswordChangeRequest(BaseModel):
    CURRENT_PASSWORD: str = Field(min_length=1)
    NEW_PASSWORD: str     = Field(min_length=6, max_length=128)


# =====================================================================
# Password change (self)
# =====================================================================

@router.post("/change-password")
def change_password(
    data: PasswordChangeRequest,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Employee changes their own password.

    Validates the current password before updating, then persists a
    fresh bcrypt hash. Admin-side password reset uses a different,
    permission-gated endpoint — we never accept an employee_id here.
    """

    emp_id = payload.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    emp = db.query(Employee).filter(Employee.ID == emp_id).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    if not verify_password(data.CURRENT_PASSWORD, emp.PASSWORD):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if data.CURRENT_PASSWORD == data.NEW_PASSWORD:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from the current one",
        )

    # Sanity: reject the most obvious weak choices.
    weak = {"password", "12345678", "qwerty", "abc12345"}
    if data.NEW_PASSWORD.lower() in weak:
        raise HTTPException(
            status_code=400,
            detail="That password is too common. Please pick a stronger one.",
        )

    emp.PASSWORD = hash_password(data.NEW_PASSWORD)
    db.commit()

    return {"message": "Password updated successfully"}


# =====================================================================
# Login history — proxied through the Attendance table since login +
# check-in are captured together for BVC's flow. Each row represents
# a day the employee was active on the system.
# =====================================================================

@router.get("/login-history")
def login_history(
    days: int = 60,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Recent login / activity history for the current employee.

    Returns one row per day with check-in time, status (Present /
    Late / Absent) and the device info captured by the biometric
    bridge when the punch landed. Web-only logins won't have a
    device string yet — the field is left blank for those rows.
    """

    emp_id = payload.get("employee_id")
    if not emp_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Clamp days into a sane window so the response stays small.
    days = max(1, min(int(days or 60), 180))
    cutoff = date.today() - timedelta(days=days)

    rows = (
        db.query(Attendance)
        .filter(
            Attendance.EMPLOYEE_ID == emp_id,
            Attendance.DATE >= cutoff,
        )
        .order_by(Attendance.DATE.desc())
        .all()
    )

    return {
        "employee_id": emp_id,
        "window_days": days,
        "history": [
            {
                "id":            r.ID,
                "date":          r.DATE.isoformat() if r.DATE else None,
                "check_in":      r.CHECK_IN.isoformat() if r.CHECK_IN else None,
                "check_out":     r.CHECK_OUT.isoformat() if r.CHECK_OUT else None,
                "status":        r.STATUS,
                "late_minutes":  r.LATE_MINUTES,
                "worked_hours":  r.WORKED_HOURS,
                "device_info":   r.DEVICE_INFO,
                "geofence":      r.GEOFENCE_STATUS,
            }
            for r in rows
        ],
    }
