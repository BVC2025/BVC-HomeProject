from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.auth.jwt_handler import verify_token

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):

    token = credentials.credentials

    payload = verify_token(token)

    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )

    return payload


EMPLOYEE_ROLES = {
    # Legacy
    "EMPLOYEE", "QC", "MANAGER", "PRODUCTION_HEAD", "HR", "ADMIN", "SUPER_ADMIN",
    # BVC24 9-role catalogue
    "MANAGING_DIRECTOR", "HR_MANAGER", "SALES_MANAGER", "PURCHASE_MANAGER",
    "PRODUCTION_MANAGER", "INVENTORY_MANAGER", "ACCOUNTS_MANAGER",
}

ADMIN_ROLES = {
    # Legacy roles
    "ADMIN", "SUPER_ADMIN", "HR", "MANAGER", "PRODUCTION_HEAD",
    # BVC24 9-role catalogue (Admin Module 2). EMPLOYEE excluded — they
    # use /employee-login for self-service.
    "MANAGING_DIRECTOR",
    "HR_MANAGER",
    "SALES_MANAGER",
    "PURCHASE_MANAGER",
    "PRODUCTION_MANAGER",
    "INVENTORY_MANAGER",
    "ACCOUNTS_MANAGER",
}


def get_current_employee(
    payload: dict = Depends(get_current_user)
):
    """
    Any authenticated user with a valid JWT passes through.
    Each endpoint then checks ownership (employee_id must
    match the path's employee), which is the real security
    boundary. We deliberately don't gate by role name here
    because old tokens may pre-date the role claim.
    """

    if not payload.get("employee_id"):

        raise HTTPException(
            status_code=403,
            detail="Authentication required — log in again"
        )

    return payload


def get_current_admin(
    payload: dict = Depends(get_current_user)
):
    """
    Admin-side routes — managers and above.
    """

    if payload.get("role") not in ADMIN_ROLES:

        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )

    return payload


def assert_self_or_admin(identifier, payload: dict) -> None:
    """Raise 403 unless the JWT belongs to either:
      - the same employee the path/body identifies (by UUID or CODE), OR
      - an admin/HR/manager role (full passthrough).

    Used by self-service endpoints where {employee_id} in the path or
    EMPLOYEE_ID in the body must match the caller's identity. Accepts
    either the employee UUID or the EMPLOYEE_CODE — both are valid
    identifiers in the URL surface.
    """

    if not identifier:
        # Nothing to compare against — caller's responsibility to
        # check the actual mutation makes sense. We don't 403 here.
        return

    if payload.get("role") in ADMIN_ROLES:
        return

    ident = str(identifier).strip()

    payload_id   = str(payload.get("employee_id") or "").strip()
    payload_code = str(payload.get("code") or "").strip()

    if ident == payload_id:
        return

    # Code comparison is case-insensitive to match find_employee_by_login
    if payload_code and ident.upper() == payload_code.upper():
        return

    raise HTTPException(
        status_code=403,
        detail="You can only access your own data."
    )


def require(*permission_codes: str):
    """
    FastAPI dependency factory that allows a route only if the
    current JWT carries at least ONE of the listed permission
    codes (OR logic). The JWT's `permissions` claim is populated
    when Module 2 (Employee 2.0) lands; until then existing
    routes are unguarded.

    Usage:
        @router.post("/tasks", dependencies=[Depends(require("task.assign"))])
        def assign_task(...): ...
    """

    def _checker(payload: dict = Depends(get_current_user)):

        # Super admin bypass
        if payload.get("role") == "SUPER_ADMIN":

            return payload

        granted = set(payload.get("permissions") or [])

        for code in permission_codes:

            if code in granted:

                return payload

        raise HTTPException(
            status_code=403,
            detail=(
                "Missing required permission: "
                + " | ".join(permission_codes)
            )
        )

    return _checker
