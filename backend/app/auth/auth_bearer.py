from typing import Optional

from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.auth.jwt_handler import verify_token
from app.database.database import get_db

security = HTTPBearer()


def _current_token_version(db: Session, principal_type: str, payload: dict):
    """Look up the live TOKEN_VERSION for whichever principal issued
    this token. Returns None if the principal no longer exists (a
    since-deleted row) — callers treat that as "invalid, reject"."""

    # Imported lazily to avoid a circular import at module load —
    # app.models.models pulls in the whole model graph.
    from app.models.models import Employee, RootUser, IAMUser

    if principal_type == "ROOT":
        row = db.query(RootUser).filter(RootUser.ID == payload.get("root_user_id")).first()
    elif principal_type == "IAM":
        row = db.query(IAMUser).filter(IAMUser.ID == payload.get("iam_user_id")).first()
    else:
        row = db.query(Employee).filter(Employee.ID == payload.get("employee_id")).first()

    return row.TOKEN_VERSION if row else None


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):

    token = credentials.credentials

    payload = verify_token(token)

    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token"
        )

    # TOKEN_VERSION check — additive and fully backward compatible.
    # Tokens issued before this change carry no "tv" claim at all, so
    # they skip this check entirely and behave exactly as before.
    # Only newly-issued tokens (once login/refresh start stamping
    # "tv") are subject to instant invalidation on password change /
    # STATUS change / role change.
    token_version = payload.get("tv")

    if token_version is not None:

        principal_type = payload.get("principal_type") or "EMPLOYEE"

        current_version = _current_token_version(db, principal_type, payload)

        if current_version is None or token_version != current_version:

            raise HTTPException(
                status_code=401,
                detail="Session invalidated — please log in again"
            )

    return payload


def get_current_root(
    payload: dict = Depends(get_current_user)
):
    """Root-only routes (account/security settings, IAM identity
    issuance itself). Requires principal_type == 'ROOT' — an ordinary
    Employee/IAM token, however privileged, is rejected."""

    if payload.get("principal_type") != "ROOT":

        raise HTTPException(
            status_code=403,
            detail="Root access required"
        )

    return payload


def get_effective_vendor_id(
    vendor_id: Optional[int] = Query(None),
    payload: dict = Depends(get_current_user),
) -> int:
    """The single source of truth for which vendor/account a request
    is scoped to. For an ordinary caller, the token's own vendor_id
    claim always wins — a client-supplied ?vendor_id= is ignored, so a
    caller can never read/write another tenant's data by changing a
    query parameter. ROOT and ADMIN/SUPER_ADMIN callers may pass an
    explicit vendor_id to work across accounts (support/ops tooling);
    everyone else is clamped to their own token."""

    token_vendor = payload.get("vendor_id")

    can_override = (
        payload.get("principal_type") == "ROOT"
        or payload.get("role") in ("ADMIN", "SUPER_ADMIN")
    )

    if can_override and vendor_id is not None:

        return vendor_id

    if token_vendor is not None:

        return token_vendor

    return vendor_id if vendor_id is not None else 1


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

    # Root always passes — unconditional access, never subject to the
    # role-string allowlist below. A pre-existing Employee token simply
    # has no principal_type claim and falls through unchanged.
    if payload.get("principal_type") == "ROOT":

        return payload

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

        # Root always passes — unconditional, never checked against
        # the permission catalogue at all.
        if payload.get("principal_type") == "ROOT":

            return payload

        # Full-admin bypass — the ADMIN and SUPER_ADMIN roles hold
        # every permission implicitly. Everyone else (HR_MANAGER,
        # SALES_MANAGER, etc.) needs the specific code granted via
        # RBAC role → permission mapping. This matches what the
        # System Administrator user expects: "I'm the admin, I can
        # do anything".
        if payload.get("role") in ("ADMIN", "SUPER_ADMIN"):

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


# RBAC/IAM-category codes — granting/revoking these via /rbac/* or the
# permission-override endpoint is Root-exclusive, regardless of what
# the requester themselves already holds. See assert_not_granting_root_only_codes.
ROOT_ONLY_PERMISSION_CODES = {"role.manage", "iam_user.manage", "permission.override.manage"}


def assert_not_granting_root_only_codes(payload: dict, codes) -> None:
    """Self-escalation guard: closes two escalation paths with one
    check — an IAM user/Admin granting themselves more power, and an
    IAM user/Admin granting an RBAC/IAM-category permission to any
    role (including one they don't personally hold otherwise). Only a
    request carrying principal_type == 'ROOT' is exempt."""

    if payload.get("principal_type") == "ROOT":

        return

    blocked = set(codes or []) & ROOT_ONLY_PERMISSION_CODES

    if blocked:

        raise HTTPException(
            status_code=403,
            detail=(
                "Only the Root User can grant or revoke these permissions: "
                + ", ".join(sorted(blocked))
            )
        )
