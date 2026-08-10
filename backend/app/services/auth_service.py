"""
Login support: bcrypt verify + JWT payload builder.

Both admin login and employee login go through these helpers
so the token shape is consistent across the system.
"""

import bcrypt
import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    Role,
    Permission,
    RolePermission
)

from app.auth.jwt_handler import create_token


BCRYPT_ROUNDS = 4  # dev. bump to 12 in production.

REFRESH_TOKEN_TTL_DAYS = 14
MAX_FAILED_LOGIN_ATTEMPTS = 5
LOCKOUT_MINUTES = 15


def hash_password(plain: str) -> str:

    return bcrypt.hashpw(
        plain.encode("utf-8"),
        bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:

    if not hashed:

        return False

    # Legacy plain-text fallback (pre-bcrypt seed data)
    if not hashed.startswith("$2"):

        return plain == hashed

    try:

        return bcrypt.checkpw(
            plain.encode("utf-8"),
            hashed.encode("utf-8")
        )

    except Exception as e:

        print(f"bcrypt verify failed: {e}")

        return False


def find_employee_by_login(db: Session, identifier: str):
    """
    Accept either EMPLOYEE_CODE (e.g. 'EMP001') or EMAIL.
    """

    if not identifier:

        return None

    ident = identifier.strip()

    emp = db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == ident.upper()
    ).first()

    if emp:

        return emp

    return db.query(Employee).filter(
        Employee.EMAIL == ident
    ).first()


def get_role_and_permissions(db: Session, role_id):
    """
    Returns (role_name, [permission_codes]) for the employee's
    assigned role. Empty list if the role has no permissions yet.
    """

    if not role_id:

        return (None, [])

    role = db.query(Role).filter(Role.ID == role_id).first()

    if not role:

        return (None, [])

    perm_codes = [
        p.CODE
        for p in db.query(Permission).join(
            RolePermission,
            RolePermission.PERMISSION_ID == Permission.ID
        ).filter(
            RolePermission.ROLE_ID == role_id
        ).all()
    ]

    return (role.NAME, perm_codes)


def resolve_effective_permissions(db: Session, employee_id: str, role_codes: list) -> list:
    """
    Role's granted codes, unioned with this employee's active GRANT
    overrides, minus their active DENY overrides. Expired overrides
    (EXPIRES_AT in the past) are ignored.

    Resolution order: explicit DENY override > explicit GRANT override
    > role default > implicit deny — mirrors AWS IAM's "explicit Deny
    always wins" rule. With zero override rows (today, before any are
    created) this returns exactly role_codes unchanged.
    """

    from app.models.rbac_models import EmployeePermissionOverride

    now = datetime.utcnow()

    overrides = (
        db.query(EmployeePermissionOverride, Permission)
          .join(Permission, Permission.ID == EmployeePermissionOverride.PERMISSION_ID)
          .filter(EmployeePermissionOverride.EMPLOYEE_ID == employee_id)
          .all()
    )

    active = [
        (ov, p) for ov, p in overrides
        if ov.EXPIRES_AT is None or ov.EXPIRES_AT > now
    ]

    grants = {p.CODE for ov, p in active if ov.EFFECT == "GRANT"}
    denies = {p.CODE for ov, p in active if ov.EFFECT == "DENY"}

    effective = (set(role_codes) | grants) - denies

    return sorted(effective)


def hash_refresh_token(raw: str) -> str:
    """sha256 hex digest — a refresh token is high-entropy (unlike a
    password), so a deterministic hash allows a direct indexed
    lookup; bcrypt's per-hash random salt would force an unindexed
    row-by-row scan instead."""

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_refresh_token(db: Session, principal_type: str, principal_id: str, vendor_id) -> str:
    """Creates a new refresh_token row and returns the RAW token —
    only the hash is ever persisted."""

    from app.models.auth_models import RefreshToken

    raw = secrets.token_urlsafe(48)

    db.add(RefreshToken(
        PRINCIPAL_TYPE=principal_type,
        PRINCIPAL_ID=principal_id,
        TOKEN_HASH=hash_refresh_token(raw),
        ISSUED_AT=datetime.utcnow(),
        EXPIRES_AT=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
        VENDOR_ID=vendor_id,
    ))
    db.commit()

    return raw


def _revoke_all_refresh_tokens(db: Session, principal_type: str, principal_id: str, reason: str):

    from app.models.auth_models import RefreshToken

    db.query(RefreshToken).filter(
        RefreshToken.PRINCIPAL_TYPE == principal_type,
        RefreshToken.PRINCIPAL_ID == principal_id,
        RefreshToken.REVOKED_AT.is_(None),
    ).update(
        {"REVOKED_AT": datetime.utcnow(), "REVOKED_REASON": reason},
        synchronize_session=False,
    )
    db.commit()


def revoke_refresh_token(db: Session, raw_token: str, reason: str = "LOGOUT"):
    """Revokes exactly the presented token (used by POST /auth/logout —
    other sessions/devices for the same principal stay logged in)."""

    from app.models.auth_models import RefreshToken

    row = db.query(RefreshToken).filter(
        RefreshToken.TOKEN_HASH == hash_refresh_token(raw_token)
    ).first()

    if row and row.REVOKED_AT is None:
        row.REVOKED_AT = datetime.utcnow()
        row.REVOKED_REASON = reason
        db.commit()


def rotate_refresh_token(db: Session, raw_token: str):
    """Validates + rotates a refresh token for POST /auth/refresh.

    Returns (status, row, new_raw_token):
      "ok"             — valid, rotated; new_raw_token is set
      "reuse_detected" — token was already rotated/revoked once
                         before (theft signal) — every refresh token
                         for this principal has now been revoked
      "invalid"        — unknown token
      "expired"        — past EXPIRES_AT
    """

    from app.models.auth_models import RefreshToken

    row = db.query(RefreshToken).filter(
        RefreshToken.TOKEN_HASH == hash_refresh_token(raw_token)
    ).first()

    if not row:
        return ("invalid", None, None)

    if row.ROTATED_AT is not None or row.REVOKED_AT is not None:
        _revoke_all_refresh_tokens(db, row.PRINCIPAL_TYPE, row.PRINCIPAL_ID, "REUSE_DETECTED")
        return ("reuse_detected", row, None)

    if row.EXPIRES_AT < datetime.utcnow():
        return ("expired", row, None)

    new_raw = secrets.token_urlsafe(48)

    new_row = RefreshToken(
        PRINCIPAL_TYPE=row.PRINCIPAL_TYPE,
        PRINCIPAL_ID=row.PRINCIPAL_ID,
        TOKEN_HASH=hash_refresh_token(new_raw),
        ISSUED_AT=datetime.utcnow(),
        EXPIRES_AT=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_TTL_DAYS),
        VENDOR_ID=row.VENDOR_ID,
    )
    db.add(new_row)
    db.flush()

    row.ROTATED_AT = datetime.utcnow()
    row.REPLACED_BY_ID = new_row.ID

    db.commit()

    return ("ok", row, new_raw)


def bump_token_version(db: Session, principal) -> None:
    """Call after password change / STATUS change / role change to
    instantly invalidate every outstanding access token for this
    principal (checked once per request in auth_bearer.get_current_user)."""

    principal.TOKEN_VERSION = (principal.TOKEN_VERSION or 1) + 1
    db.commit()


def check_lockout(db: Session, principal_type: str, principal_id: str):
    """Returns the LOCKED_UNTIL datetime if this principal is currently
    locked out from a login attempt, else None."""

    from app.models.auth_models import LoginLockout

    row = db.query(LoginLockout).filter(
        LoginLockout.PRINCIPAL_TYPE == principal_type,
        LoginLockout.PRINCIPAL_ID == principal_id,
    ).first()

    if row and row.LOCKED_UNTIL and row.LOCKED_UNTIL > datetime.utcnow():
        return row.LOCKED_UNTIL

    return None


def record_failed_login(db: Session, principal_type: str, principal_id: str) -> None:

    from app.models.auth_models import LoginLockout

    row = db.query(LoginLockout).filter(
        LoginLockout.PRINCIPAL_TYPE == principal_type,
        LoginLockout.PRINCIPAL_ID == principal_id,
    ).first()

    now = datetime.utcnow()

    if not row:
        row = LoginLockout(PRINCIPAL_TYPE=principal_type, PRINCIPAL_ID=principal_id, FAILED_COUNT=0)
        db.add(row)

    row.FAILED_COUNT = (row.FAILED_COUNT or 0) + 1
    row.LAST_FAILED_AT = now

    if row.FAILED_COUNT >= MAX_FAILED_LOGIN_ATTEMPTS:
        row.LOCKED_UNTIL = now + timedelta(minutes=LOCKOUT_MINUTES)

    db.commit()


def reset_lockout(db: Session, principal_type: str, principal_id: str) -> None:

    from app.models.auth_models import LoginLockout

    row = db.query(LoginLockout).filter(
        LoginLockout.PRINCIPAL_TYPE == principal_type,
        LoginLockout.PRINCIPAL_ID == principal_id,
    ).first()

    if row and (row.FAILED_COUNT or row.LOCKED_UNTIL):
        row.FAILED_COUNT = 0
        row.LOCKED_UNTIL = None
        db.commit()


def build_login_response(db: Session, emp: Employee) -> dict:
    """
    Issues JWT and returns the standard login response shape
    used by /admin-login, /employee-login, and any future
    SSO callback. Additive fields (refresh_token, tv claim) don't
    change any existing field — old frontend code that doesn't know
    about them just ignores them.
    """

    role_name, role_perms = get_role_and_permissions(db, emp.ROLE_ID)

    perms = resolve_effective_permissions(db, emp.ID, role_perms)

    token = create_token({
        "employee_id": emp.ID,
        "code": emp.EMPLOYEE_CODE,
        "name": emp.NAME,
        "role": role_name or "EMPLOYEE",
        "permissions": perms,
        "department_id": emp.DEPARTMENT_ID,
        "vendor_id": emp.VENDOR_ID,
        "tv": emp.TOKEN_VERSION,
    })

    refresh_token = issue_refresh_token(db, "EMPLOYEE", emp.ID, emp.VENDOR_ID)

    return {
        "access_token": token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "employee_id": emp.ID,
        "code": emp.EMPLOYEE_CODE,
        "name": emp.NAME,
        "email": emp.EMAIL,
        "department_id": emp.DEPARTMENT_ID,
        "role": role_name or "EMPLOYEE",
        "permissions": perms,
        "vendor_id": emp.VENDOR_ID
    }
