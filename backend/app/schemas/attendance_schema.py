from typing import Optional

from pydantic import BaseModel


class CheckInRequest(BaseModel):

    EMPLOYEE_ID: str
    VENDOR_ID: int = 1


class CheckOutRequest(BaseModel):

    EMPLOYEE_ID: str


class MarkAbsentRequest(BaseModel):

    EMPLOYEE_ID: str
    VENDOR_ID: int = 1
    NOTE: Optional[str] = None
