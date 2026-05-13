from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from app.database.database import get_db

from app.models.models import (
    Role,
    IAMUser
)

from app.schemas.user_schema import (
    RoleCreate,
    EmployeeCreate
)

router = APIRouter()

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)


# =========================
# CREATE ROLE
# =========================

@router.post("/create-role")
def create_role(
    data: RoleCreate,
    db: Session = Depends(get_db)
):

    try:

        role = Role(
            ROLE_NAME=data.ROLE_NAME,
            VENDOR_ID=data.VENDOR_ID
        )

        db.add(role)

        db.commit()

        db.refresh(role)

        return {
            "message": "Role created successfully",
            "role_id": role.ID
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# CREATE EMPLOYEE
# =========================

@router.post("/create-employee")
def create_employee(
    data: EmployeeCreate,
    db: Session = Depends(get_db)
):

    try:

        hashed_password = pwd_context.hash(
            data.PASSWORD
        )

        employee = IAMUser(
            NAME=data.NAME,
            EMAIL=data.EMAIL,
            PASSWORD=hashed_password,
            ROLE_ID=data.ROLE_ID,
            VENDOR_ID=data.VENDOR_ID,
            STATUS="ACTIVE"
        )

        db.add(employee)

        db.commit()

        db.refresh(employee)

        return {
            "message": "Employee created successfully",
            "employee_id": employee.ID
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# GET EMPLOYEES
# =========================

@router.get("/employees")
def get_employees(
    db: Session = Depends(get_db)
):

    employees = db.query(IAMUser).all()

    return employees