"""
Login support: bcrypt verify + JWT payload builder.

Both admin login and employee login go through these helpers
so the token shape is consistent across the system.
"""

import bcrypt

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    Role,
    Permission,
    RolePermission
)

from app.auth.jwt_handler import create_token


BCRYPT_ROUNDS = 4  # dev. bump to 12 in production.


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

    return (role.ROLE_NAME, perm_codes)


def build_login_response(db: Session, emp: Employee) -> dict:
    """
    Issues JWT and returns the standard login response shape
    used by /admin-login, /employee-login, and any future
    SSO callback.
    """

    role_name, perms = get_role_and_permissions(db, emp.ROLE_ID)

    token = create_token({
        "employee_id": emp.ID,
        "code": emp.EMPLOYEE_CODE,
        "name": emp.NAME,
        "role": role_name or "EMPLOYEE",
        "permissions": perms,
        "department_id": emp.DEPARTMENT_ID,
        "vendor_id": emp.VENDOR_ID
    })

    return {
        "access_token": token,
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
