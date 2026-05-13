from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from app.database.database import get_db

from app.models.models import (
    Task
)

from app.schemas.task_schema import (
    TaskCreate
)

router = APIRouter()


# =========================
# CREATE TASK
# =========================

@router.post("/create-task")
def create_task(
    data: TaskCreate,
    db: Session = Depends(get_db)
):

    try:

        task = Task(
            TASK_NAME=data.TASK_NAME,
            DESCRIPTION=data.DESCRIPTION,
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
            detail=str(e)
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