from typing import Optional

from pydantic import BaseModel


# CustomerCreate / CustomerUpdate removed — the routes that used them
# (/create-customer, PATCH /customers/{id}) were retired in favor of
# backend/app/routes/customer_master.py's CustomerMasterCreate/Update.


class ProjectCreate(BaseModel):

    PROJECT_NAME: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    SUB_PROJECT_TEMPLATE_ID: Optional[int] = None
    DEPARTMENT_ID: Optional[int] = None
    CUSTOMER_ID: Optional[str] = None
    VENDOR_ID: int


class TaskApprovalDecision(BaseModel):

    EMPLOYEE_ID: Optional[str] = None   # who's accepting/rejecting
    REASON: Optional[str] = None        # for rejections
