from datetime import date
from typing import Optional

from pydantic import BaseModel


class CrmLeadCreate(BaseModel):

    COMPANY_NAME: str
    VENDOR_ID: int = 1

    CONTACT_PERSON: Optional[str] = None
    DESIGNATION: Optional[str] = None
    PHONE: Optional[str] = None
    WHATSAPP_NUMBER: Optional[str] = None
    EMAIL: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None

    SOURCE: Optional[str] = "MANUAL"
    EXTERNAL_REFERENCE_ID: Optional[str] = None

    PRIORITY: Optional[str] = "MEDIUM"
    ASSIGNED_SALES_ID: Optional[str] = None
    FOLLOW_UP_DATE: Optional[date] = None
    REQUIREMENT_NOTES: Optional[str] = None


class CrmLeadUpdate(BaseModel):

    COMPANY_NAME: Optional[str] = None
    CONTACT_PERSON: Optional[str] = None
    DESIGNATION: Optional[str] = None
    PHONE: Optional[str] = None
    WHATSAPP_NUMBER: Optional[str] = None
    EMAIL: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None

    STATUS: Optional[str] = None
    PRIORITY: Optional[str] = None
    SCORE: Optional[int] = None
    ASSIGNED_SALES_ID: Optional[str] = None
    FOLLOW_UP_DATE: Optional[date] = None
    NEXT_MEETING_DATE: Optional[str] = None  # ISO datetime
    REQUIREMENT_NOTES: Optional[str] = None
    LOST_REASON: Optional[str] = None


class CrmActivityCreate(BaseModel):

    EVENT_TYPE: str
    # CALL / MEETING / EMAIL / WHATSAPP / NOTE

    EVENT_DETAIL: Optional[str] = None
    ACTOR_NAME: Optional[str] = None
