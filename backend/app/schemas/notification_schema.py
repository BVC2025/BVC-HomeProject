from typing import Optional

from pydantic import BaseModel


class NotificationCreate(BaseModel):

    TITLE: str
    MESSAGE: str
    TYPE: Optional[str] = "INFO"
    VENDOR_ID: Optional[int] = 1
