from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database.database import get_db

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
# LEGACY /login (now backed by Employee)
# =========================

@router.post("/login")
def legacy_login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Backward-compatible alias of /admin-login. Older clients
    that POST to /login keep working.
    """

    return admin_login(data, db)


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
