from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.database.database import get_db

from app.models.models import Department

from app.auth.auth_bearer import (
    get_current_user,
    ADMIN_ROLES
)

from app.services.auth_service import (
    find_employee_by_login,
    verify_password,
    build_login_response
)


router = APIRouter()


class LoginRequest(BaseModel):

    EMPLOYEE_CODE: Optional[str] = None
    EMAIL: Optional[str] = None
    PASSWORD: str


# =========================
# ADMIN LOGIN
# =========================

@router.post("/admin-login")
def admin_login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Login for admin-side users (SUPER_ADMIN / ADMIN / HR /
    MANAGER / PRODUCTION_HEAD). Accepts either EMPLOYEE_CODE
    or EMAIL plus password.
    """

    identifier = data.EMPLOYEE_CODE or data.EMAIL

    if not identifier:

        raise HTTPException(
            status_code=400,
            detail="EMPLOYEE_CODE or EMAIL is required"
        )

    emp = find_employee_by_login(db, identifier)

    if not emp:

        raise HTTPException(
            status_code=404,
            detail="Account not found"
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

    response = build_login_response(db, emp)

    if response["role"] not in ADMIN_ROLES:

        raise HTTPException(
            status_code=403,
            detail=(
                "This account does not have admin "
                "access. Use the Employee login instead."
            )
        )

    return response


# =========================
# UNIFIED /login — one endpoint, auto-detects admin vs employee.
# =========================

@router.post("/login")
def unified_login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Single sign-in endpoint used by the merged login form.

    Admins get the standard response + is_admin=True.
    Non-admins additionally get the same attendance/pending-tasks
    payload the legacy /employee-login returned, so the employee
    dashboard has everything it needs from one call.
    """

    identifier = data.EMPLOYEE_CODE or data.EMAIL

    if not identifier:

        raise HTTPException(
            status_code=400,
            detail="Employee ID or email is required"
        )

    emp = find_employee_by_login(db, identifier)

    if not emp:

        raise HTTPException(
            status_code=404,
            detail="Account not found"
        )

    if emp.STATUS and emp.STATUS.upper() != "ACTIVE":

        raise HTTPException(
            status_code=403,
            detail=f"Account is {emp.STATUS.lower()}"
        )

    if not verify_password(data.PASSWORD, emp.PASSWORD):

        raise HTTPException(
            status_code=401,
            detail="Invalid password"
        )

    response = build_login_response(db, emp)

    is_admin = response.get("role") in ADMIN_ROLES

    response["is_admin"] = is_admin
    response["EMPLOYEE_ID"] = emp.EMPLOYEE_CODE
    response["EMPLOYEE_NAME"] = emp.NAME

    # For non-admin users, run the same attendance/pending flow the
    # legacy /employee-login used, so the employee portal keeps its
    # check-in time and pending-yesterday banner from a single call.
    if not is_admin:

        # Import lazily to avoid a circular import at module load
        # (employee_task.py imports several services that in turn
        # import from routes).
        from app.routes.employee_task import (
            ensure_today_attendance,
            get_pending_from_yesterday,
            serialize_task,
            push_notification
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

        dept_name = None

        if emp.DEPARTMENT_ID:

            d = db.query(Department).filter(
                Department.ID == emp.DEPARTMENT_ID
            ).first()

            dept_name = d.NAME if d else None

        response["DEPARTMENT"] = dept_name

    return response


# =========================
# PROTECTED ROUTE
# =========================

@router.get("/me")
def get_me(
    current_user=Depends(get_current_user)
):

    return {
        "message": "Protected route working",
        "user": current_user
    }
