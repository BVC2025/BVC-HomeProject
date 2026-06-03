from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from app.database.database import get_db

from app.models.models import (
    Task,
    Project,
    Employee,
    Vendor
)

from app.schemas.task_schema import TaskCreate

router = APIRouter()


# =========================
# CREATE TASK
# =========================

@router.post("/create-task")
def create_task(
    data: TaskCreate,
    db: Session = Depends(get_db)
):

    if not data.TASK_NAME or not data.TASK_NAME.strip():

        raise HTTPException(
            status_code=400,
            detail="Task name is required"
        )

    project = db.query(Project).filter(
        Project.ID == data.PROJECT_ID
    ).first()

    if not project:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Project ID {data.PROJECT_ID} does not exist. "
                "Create a project first or pick an existing one."
            )
        )

    assignee = db.query(Employee).filter(
        Employee.ID == data.ASSIGNED_TO
    ).first()

    if not assignee:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Assigned employee '{data.ASSIGNED_TO}' does not exist. "
                "Pick a valid employee from the dropdown."
            )
        )

    vendor = db.query(Vendor).filter(
        Vendor.ID == data.VENDOR_ID
    ).first()

    if not vendor:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Vendor ID {data.VENDOR_ID} does not exist. "
                "Create the vendor record first."
            )
        )

    try:

        task = Task(
            TASK_NAME=data.TASK_NAME.strip(),
            DESCRIPTION=data.DESCRIPTION,
            STATUS="PENDING",
            PRIORITY="MEDIUM",
            PROJECT_ID=data.PROJECT_ID,
            ASSIGNED_TO=data.ASSIGNED_TO,
            VENDOR_ID=data.VENDOR_ID
        )

        db.add(task)

        db.commit()

        db.refresh(task)

        return {
            "message": "Task created successfully",
            "task_id": task.ID
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)}"
        )


# =========================
# GET TASKS
# =========================

@router.get("/tasks")
def get_tasks(
    db: Session = Depends(get_db)
):

    tasks = db.query(Task).all()

    return tasks


# =========================
# START TASK
# =========================

@router.put("/start-task/{task_id}")
def start_task(
    task_id: int,
    db: Session = Depends(get_db)
):

    task = db.query(Task).filter(
        Task.ID == task_id
    ).first()

    if not task:

        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    task.STATUS = "IN_PROGRESS"

    task.START_TIME = datetime.utcnow()

    db.commit()

    return {
        "message": "Task started"
    }


# =========================
# COMPLETE TASK
# =========================

@router.put("/complete-task/{task_id}")
def complete_task(
    task_id: int,
    db: Session = Depends(get_db)
):

    task = db.query(Task).filter(
        Task.ID == task_id
    ).first()

    if not task:

        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    task.STATUS = "COMPLETED"

    task.END_TIME = datetime.utcnow()

    db.commit()

    return {
        "message": "Task completed"
    }


# =========================
# HOLD TASK
# =========================

@router.put("/hold-task/{task_id}")
def hold_task(
    task_id: int,
    db: Session = Depends(get_db)
):

    task = db.query(Task).filter(
        Task.ID == task_id
    ).first()

    if not task:

        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )

    task.STATUS = "ON_HOLD"

    db.commit()

    return {
        "message": "Task on hold"
    }
