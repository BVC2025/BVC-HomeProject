from pydantic import BaseModel
from typing import Optional
from datetime import date


class EmployeeLogin(BaseModel):

    EMPLOYEE_ID: str
    PASSWORD: str


class TaskStatusUpdate(BaseModel):

    TASK_STATUS: str


class DayUpdate(BaseModel):

    day: int


class TaskAssignmentCreate(BaseModel):

    EMPLOYEE_ID: Optional[str] = None
    TASK_NAME: str
    TASK_DETAILS: Optional[str] = ""
    PROJECT_ID: Optional[int] = None
    ASSIGNED_DATE: Optional[date] = None
    DUE_DATE: Optional[date] = None
    ASSIGNED_BY_ID: Optional[str] = None
    AUTO_ASSIGN: Optional[bool] = False
    DEPARTMENT_ID: Optional[int] = None
    # When AUTO_ASSIGN is true, EMPLOYEE_ID is ignored and
    # the system picks the least-loaded employee from the
    # project's department (or from DEPARTMENT_ID override).


class EmployeeLogout(BaseModel):

    EMPLOYEE_ID: str
