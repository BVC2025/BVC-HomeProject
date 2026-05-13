from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Customer,
    Project
)

from app.schemas.project_schema import (
    CustomerCreate,
    ProjectCreate
)

router = APIRouter()


# =========================
# CREATE CUSTOMER
# =========================

@router.post("/create-customer")
def create_customer(
    data: CustomerCreate,
    db: Session = Depends(get_db)
):

    try:

        customer = Customer(
            CUSTOMER_NAME=data.CUSTOMER_NAME,
            PHONE=data.PHONE,
            EMAIL=data.EMAIL,
            ADDRESS=data.ADDRESS,
            VENDOR_ID=data.VENDOR_ID
        )

        db.add(customer)

        db.commit()

        db.refresh(customer)

        return {
            "message": "Customer created successfully",
            "customer_id": customer.ID
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# CREATE PROJECT
# =========================

@router.post("/create-project")
def create_project(
    data: ProjectCreate,
    db: Session = Depends(get_db)
):

    try:

        project = Project(
            PROJECT_NAME=data.PROJECT_NAME,
            DESCRIPTION=data.DESCRIPTION,
            CUSTOMER_ID=data.CUSTOMER_ID,
            VENDOR_ID=data.VENDOR_ID
        )

        db.add(project)

        db.commit()

        db.refresh(project)

        return {
            "message": "Project created successfully",
            "project_id": project.ID
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# GET PROJECTS
# =========================

@router.get("/projects")
def get_projects(
    db: Session = Depends(get_db)
):

    projects = db.query(Project).all()

    return projects