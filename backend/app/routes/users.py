"""
Legacy users router — kept thin for backward compatibility.

Employee CRUD moved to routes/employee.py (uses the new
unified Employee model). Role management moved to
routes/organization.py (with permission assignment).

This file only exposes /create-role for old API consumers.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Role

from app.schemas.user_schema import RoleCreate
from app.auth.auth_bearer import require


router = APIRouter()


@router.post("/create-role", dependencies=[Depends(require("role.manage"))])
def create_role(
    data: RoleCreate,
    db: Session = Depends(get_db)
):
    """
    Legacy alias of POST /roles in the Organization router.
    """

    try:

        role = Role(
            NAME=data.ROLE_NAME,
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
