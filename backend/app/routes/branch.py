"""Admin / System Foundation — Branch / Location Management.

Mirrors routes/organization.py's Department CRUD pattern (same
list/search/create/update/delete shape, same org.view/org.manage
permission gating) since a Branch is the same kind of org-structure
master data.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database.database import get_db
from app.auth.auth_bearer import require
from app.models.employee_models import Branch, Employee
from app.schemas.org_schema import BranchCreate, BranchUpdate


router = APIRouter()


def _serialize(b: Branch) -> dict:
    return {
        "ID": b.ID,
        "NAME": b.NAME,
        "BRANCH_CODE": b.BRANCH_CODE,
        "ADDRESS": b.ADDRESS,
        "CITY": b.CITY,
        "STATE": b.STATE,
        "COUNTRY": b.COUNTRY,
        "PINCODE": b.PINCODE,
        "PHONE": b.PHONE,
        "EMAIL": b.EMAIL,
        "MANAGER_EMPLOYEE_ID": b.MANAGER_EMPLOYEE_ID,
        "LATITUDE": b.LATITUDE,
        "LONGITUDE": b.LONGITUDE,
        "VENDOR_ID": b.VENDOR_ID,
        "STATUS": b.STATUS,
        "CREATED_AT": b.CREATED_AT.isoformat() if b.CREATED_AT else None,
        "UPDATED_AT": b.UPDATED_AT.isoformat() if b.UPDATED_AT else None,
    }


@router.get("/branches", dependencies=[Depends(require("branch.view"))])
def list_branches(
    vendor_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Branch)

    if vendor_id is not None:
        q = q.filter(Branch.VENDOR_ID == vendor_id)

    if search:
        term = f"%{search}%"
        q = q.filter(
            Branch.NAME.ilike(term) | Branch.BRANCH_CODE.ilike(term)
        )

    rows = q.order_by(Branch.NAME).all()

    return [_serialize(b) for b in rows]


@router.get("/branches/{branch_id}", dependencies=[Depends(require("branch.view"))])
def get_branch(
    branch_id: int,
    db: Session = Depends(get_db)
):

    b = db.query(Branch).filter(Branch.ID == branch_id).first()

    if not b:
        raise HTTPException(status_code=404, detail="Branch not found")

    return _serialize(b)


@router.post("/branches", dependencies=[Depends(require("branch.manage"))])
def create_branch(
    data: BranchCreate,
    db: Session = Depends(get_db)
):

    existing = db.query(Branch).filter(
        Branch.VENDOR_ID == data.VENDOR_ID,
        Branch.BRANCH_CODE == data.BRANCH_CODE.upper()
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Branch code '{data.BRANCH_CODE}' already exists for this vendor"
        )

    branch = Branch(
        NAME=data.NAME,
        BRANCH_CODE=data.BRANCH_CODE.upper(),
        ADDRESS=data.ADDRESS,
        CITY=data.CITY,
        STATE=data.STATE,
        COUNTRY=data.COUNTRY,
        PINCODE=data.PINCODE,
        PHONE=data.PHONE,
        EMAIL=data.EMAIL,
        MANAGER_EMPLOYEE_ID=data.MANAGER_EMPLOYEE_ID,
        LATITUDE=data.LATITUDE,
        LONGITUDE=data.LONGITUDE,
        VENDOR_ID=data.VENDOR_ID,
    )

    db.add(branch)
    db.commit()
    db.refresh(branch)

    return {"message": "Branch created", "ID": branch.ID}


@router.put("/branches/{branch_id}", dependencies=[Depends(require("branch.manage"))])
def update_branch(
    branch_id: int,
    data: BranchUpdate,
    db: Session = Depends(get_db)
):

    branch = db.query(Branch).filter(Branch.ID == branch_id).first()

    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    updates = data.model_dump(exclude_unset=True)

    for key, value in updates.items():

        if key in ("BRANCH_CODE",) and value is not None:
            value = value.upper()

        if key == "STATUS" and value is not None:
            value = value.upper()

        setattr(branch, key, value)

    db.commit()

    return {"message": "Branch updated"}


@router.delete("/branches/{branch_id}", dependencies=[Depends(require("branch.manage"))])
def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db)
):

    branch = db.query(Branch).filter(Branch.ID == branch_id).first()

    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    in_use = db.query(Employee).filter(Employee.BRANCH_ID == branch_id).first()

    if in_use:
        raise HTTPException(
            status_code=400,
            detail="Branch has employees assigned. Reassign them first."
        )

    db.delete(branch)
    db.commit()

    return {"message": "Branch deleted"}
