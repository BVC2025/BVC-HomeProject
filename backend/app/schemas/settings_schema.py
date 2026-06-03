from typing import Optional

from pydantic import BaseModel


class EmailAlertsToggle(BaseModel):

    enabled: bool


class TestEmailRequest(BaseModel):

    recipient: Optional[str] = None
