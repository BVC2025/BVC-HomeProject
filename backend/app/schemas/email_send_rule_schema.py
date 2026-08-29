from typing import List, Optional
from pydantic import BaseModel


class EmailSendRuleRecipientIn(BaseModel):
    EMPLOYEE_ID: Optional[str] = None
    IS_LEAD_OWNER: bool = False


class EmailSendRuleUpdate(BaseModel):
    RECIPIENTS: List[EmailSendRuleRecipientIn] = []
