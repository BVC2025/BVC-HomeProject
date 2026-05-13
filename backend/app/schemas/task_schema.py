from pydantic import BaseModel


class TaskCreate(BaseModel):

    TASK_NAME: str

    DESCRIPTION: str

    PROJECT_ID: int

    ASSIGNED_TO: str

    VENDOR_ID: int