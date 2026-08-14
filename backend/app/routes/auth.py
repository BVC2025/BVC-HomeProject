from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from app.database.database import get_db

from app.models.models import Department, Role, Employee
from app.models.rbac_models import RootUser, IAMUser

from app.auth.jwt_handler import create_token

from app.auth.auth_bearer import (
    get_current_user,
    ADMIN_ROLES
)

from app.services.auth_service import (
    find_employee_by_login,
    verify_password,
    hash_password,
    build_login_response,
    get_role_and_permissions,
    resolve_effective_permissions,
    issue_refresh_token,
    rotate_refresh_token,
    revoke_refresh_token,
    check_lockout,
    record_failed_login,
    reset_lockout,
)


router = APIRouter()


class LoginRequest(BaseModel):

    EMPLOYEE_CODE: Optional[str] = None
    EMAIL: Optional[str] = None
    PASSWORD: str


class RootLoginRequest(BaseModel):

    EMAIL: str
    PASSWORD: str


class IAMLoginRequest(BaseModel):

    USERNAME: str
    PASSWORD: str


class RefreshRequest(BaseModel):

    refresh_token: str


class LogoutRequest(BaseModel):

    refresh_token: str


def _locked_response(locked_until) -> HTTPException:

    return HTTPException(
        status_code=429,
        detail=(
            "Too many failed login attempts. Try again after "
            f"{locked_until.strftime('%H:%M:%S')}."
        )
    )


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

    locked_until = check_lockout(db, "EMPLOYEE", emp.ID)

    if locked_until:

        raise _locked_response(locked_until)

    if emp.STATUS and emp.STATUS.upper() != "ACTIVE":

        raise HTTPException(
            status_code=403,
            detail=f"Account is {emp.STATUS}"
        )

    if not verify_password(data.PASSWORD, emp.PASSWORD):

        record_failed_login(db, "EMPLOYEE", emp.ID)

        raise HTTPException(
            status_code=401,
            detail="Invalid password"
        )

    reset_lockout(db, "EMPLOYEE", emp.ID)

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

    locked_until = check_lockout(db, "EMPLOYEE", emp.ID)

    if locked_until:

        raise _locked_response(locked_until)

    if emp.STATUS and emp.STATUS.upper() != "ACTIVE":

        raise HTTPException(
            status_code=403,
            detail=f"Account is {emp.STATUS.lower()}"
        )

    if not verify_password(data.PASSWORD, emp.PASSWORD):

        record_failed_login(db, "EMPLOYEE", emp.ID)

        raise HTTPException(
            status_code=401,
            detail="Invalid password"
        )

    reset_lockout(db, "EMPLOYEE", emp.ID)

    response = build_login_response(db, emp)

    # Admin-shell routing must reflect REAL authorization, not just the
    # fixed 12-role-name allowlist below — otherwise a brand-new custom
    # role created via /rbac and granted real permissions would still
    # get routed into the self-service EmployeeDashboard shell, which
    # has no RBAC awareness at all, making those granted permissions
    # invisible to the employee. A role with zero resolved permissions
    # (the true self-service default) still correctly falls through to
    # the self-service shell, unchanged.
    is_admin = (response.get("role") in ADMIN_ROLES) or bool(response.get("permissions"))

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


# =========================
# ROOT LOGIN — separate identity, separate table, never touches
# Employee/IAMUser login paths above.
# =========================

@router.post("/root-login")
def root_login(
    data: RootLoginRequest,
    db: Session = Depends(get_db)
):

    root = db.query(RootUser).filter(RootUser.EMAIL == data.EMAIL.strip()).first()

    if not root:

        raise HTTPException(status_code=404, detail="Account not found")

    locked_until = check_lockout(db, "ROOT", root.ID)

    if locked_until:

        raise _locked_response(locked_until)

    if root.STATUS and root.STATUS.upper() != "ACTIVE":

        raise HTTPException(status_code=403, detail=f"Account is {root.STATUS}")

    if not verify_password(data.PASSWORD, root.PASSWORD):

        record_failed_login(db, "ROOT", root.ID)

        raise HTTPException(status_code=401, detail="Invalid password")

    reset_lockout(db, "ROOT", root.ID)

    root.LAST_LOGIN_AT = datetime.utcnow()
    db.commit()

    # Deliberately no "role"/"permissions" claims — Root is never
    # checked against the permission catalogue at all (auth_bearer.py
    # short-circuits on principal_type == "ROOT" before it would ever
    # look at those fields).
    token = create_token({
        "principal_type": "ROOT",
        "root_user_id": root.ID,
        "email": root.EMAIL,
        "vendor_id": root.VENDOR_ID,
        "tv": root.TOKEN_VERSION,
    })

    refresh_token = issue_refresh_token(db, "ROOT", root.ID, root.VENDOR_ID)

    return {
        "access_token": token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "principal_type": "ROOT",
        "root_user_id": root.ID,
        "email": root.EMAIL,
        "vendor_id": root.VENDOR_ID,
    }


# =========================
# IAM USER LOGIN — separate, parallel to /login. Never modifies the
# existing Employee login paths above.
# =========================

@router.post("/iam-login")
def iam_login(
    data: IAMLoginRequest,
    db: Session = Depends(get_db)
):

    iam = db.query(IAMUser).filter(IAMUser.USERNAME == data.USERNAME.strip()).first()

    if not iam:

        raise HTTPException(status_code=404, detail="Account not found")

    locked_until = check_lockout(db, "IAM", iam.ID)

    if locked_until:

        raise _locked_response(locked_until)

    if iam.STATUS and iam.STATUS.upper() != "ACTIVE":

        raise HTTPException(status_code=403, detail=f"Account is {iam.STATUS}")

    if not verify_password(data.PASSWORD, iam.PASSWORD):

        record_failed_login(db, "IAM", iam.ID)

        raise HTTPException(status_code=401, detail="Invalid password")

    reset_lockout(db, "IAM", iam.ID)

    iam.LAST_LOGIN_AT = datetime.utcnow()
    db.commit()

    # Role/permissions are resolved via the linked Employee record only
    # — an IAM user carries no role/permission data of its own. An
    # IAM user with no EMPLOYEE_ID (a pure service account) simply
    # gets no role and no permissions.
    role_name, role_perms, department_id = (None, [], None)

    if iam.EMPLOYEE_ID:

        emp = db.query(Employee).filter(Employee.ID == iam.EMPLOYEE_ID).first()

        if emp:

            role_name, role_perms = get_role_and_permissions(db, emp.ROLE_ID)
            department_id = emp.DEPARTMENT_ID

    perms = resolve_effective_permissions(db, iam.EMPLOYEE_ID, role_perms) if iam.EMPLOYEE_ID else role_perms

    token = create_token({
        "principal_type": "IAM",
        "iam_user_id": iam.ID,
        "employee_id": iam.EMPLOYEE_ID,
        "username": iam.USERNAME,
        "role": role_name or "EMPLOYEE",
        "permissions": perms,
        "department_id": department_id,
        "vendor_id": iam.VENDOR_ID,
        "tv": iam.TOKEN_VERSION,
    })

    refresh_token = issue_refresh_token(db, "IAM", iam.ID, iam.VENDOR_ID)

    return {
        "access_token": token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "principal_type": "IAM",
        "iam_user_id": iam.ID,
        "username": iam.USERNAME,
        "role": role_name or "EMPLOYEE",
        "permissions": perms,
        "vendor_id": iam.VENDOR_ID,
    }


# =========================
# REFRESH / LOGOUT — additive, new. Existing /login response gains a
# refresh_token field; frontends that don't know about it are
# unaffected.
# =========================

@router.post("/auth/refresh")
def refresh_access_token(
    data: RefreshRequest,
    db: Session = Depends(get_db)
):

    status_, row, new_raw = rotate_refresh_token(db, data.refresh_token)

    if status_ == "invalid":

        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if status_ == "expired":

        raise HTTPException(status_code=401, detail="Refresh token expired — please log in again")

    if status_ == "reuse_detected":

        raise HTTPException(
            status_code=401,
            detail="Session invalidated — this refresh token was already used. Please log in again."
        )

    # status_ == "ok" — re-derive the principal fresh from the DB
    # (never trust the old token's claims) so a role/permission change
    # since the last login is picked up immediately.
    principal_type = row.PRINCIPAL_TYPE

    if principal_type == "ROOT":

        root = db.query(RootUser).filter(RootUser.ID == row.PRINCIPAL_ID).first()

        if not root or (root.STATUS and root.STATUS.upper() != "ACTIVE"):

            raise HTTPException(status_code=401, detail="Account no longer active")

        token = create_token({
            "principal_type": "ROOT",
            "root_user_id": root.ID,
            "email": root.EMAIL,
            "vendor_id": root.VENDOR_ID,
            "tv": root.TOKEN_VERSION,
        })

        return {"access_token": token, "refresh_token": new_raw, "token_type": "bearer"}

    if principal_type == "IAM":

        iam = db.query(IAMUser).filter(IAMUser.ID == row.PRINCIPAL_ID).first()

        if not iam or (iam.STATUS and iam.STATUS.upper() != "ACTIVE"):

            raise HTTPException(status_code=401, detail="Account no longer active")

        role_name, role_perms, department_id = (None, [], None)

        if iam.EMPLOYEE_ID:

            emp = db.query(Employee).filter(Employee.ID == iam.EMPLOYEE_ID).first()

            if emp:

                role_name, role_perms = get_role_and_permissions(db, emp.ROLE_ID)
                department_id = emp.DEPARTMENT_ID

        perms = resolve_effective_permissions(db, iam.EMPLOYEE_ID, role_perms) if iam.EMPLOYEE_ID else role_perms

        token = create_token({
            "principal_type": "IAM",
            "iam_user_id": iam.ID,
            "employee_id": iam.EMPLOYEE_ID,
            "username": iam.USERNAME,
            "role": role_name or "EMPLOYEE",
            "permissions": perms,
            "department_id": department_id,
            "vendor_id": iam.VENDOR_ID,
            "tv": iam.TOKEN_VERSION,
        })

        return {"access_token": token, "refresh_token": new_raw, "token_type": "bearer"}

    # EMPLOYEE (legacy)
    emp = db.query(Employee).filter(Employee.ID == row.PRINCIPAL_ID).first()

    if not emp or (emp.STATUS and emp.STATUS.upper() != "ACTIVE"):

        raise HTTPException(status_code=401, detail="Account no longer active")

    response = build_login_response(db, emp)

    # build_login_response mints its own fresh refresh token too — we
    # only want the one from rotate_refresh_token above to stay live,
    # so revoke the extra one it just issued to avoid an orphaned row.
    revoke_refresh_token(db, response["refresh_token"], reason="ROTATED")

    response["refresh_token"] = new_raw

    return response


@router.post("/auth/logout")
def logout(
    data: LogoutRequest,
    db: Session = Depends(get_db)
):

    revoke_refresh_token(db, data.refresh_token, reason="LOGOUT")

    # Always 200 — never reveal whether the token existed.
    return {"message": "Logged out."}
