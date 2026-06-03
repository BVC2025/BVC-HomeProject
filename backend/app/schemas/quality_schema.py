from datetime import date
from typing import Optional, List

from pydantic import BaseModel


# ---- Checklist template -------------------------------------

class ChecklistItemCreate(BaseModel):

    PRODUCT_MODEL_ID: int
    CHECK_POINT: str
    DESCRIPTION: Optional[str] = None
    SEVERITY: str = "MAJOR"   # CRITICAL / MAJOR / MINOR
    SEQUENCE: int = 1


class ChecklistItemUpdate(BaseModel):

    CHECK_POINT: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    SEVERITY: Optional[str] = None
    SEQUENCE: Optional[int] = None
    IS_ACTIVE: Optional[int] = None


# ---- Inspection ----------------------------------------------

class InspectionCreate(BaseModel):

    WORK_ORDER_ID: int
    INSPECTOR_ID: Optional[str] = None
    NOTES: Optional[str] = None
    VENDOR_ID: int = 1


class InspectionResultUpdate(BaseModel):

    RESULT: str          # PASS / FAIL / NEEDS_REWORK / NA
    NOTES: Optional[str] = None


class InspectionFinalise(BaseModel):
    """Inspector marks the inspection complete; backend computes
    overall PASS/FAIL from results and (if needed) opens NCRs."""

    NOTES: Optional[str] = None


# ---- NCR -----------------------------------------------------

class NCRUpdate(BaseModel):

    STATUS: Optional[str] = None          # OPEN / IN_PROGRESS / CLOSED
    ROOT_CAUSE: Optional[str] = None
    CORRECTIVE_ACTION: Optional[str] = None
    ASSIGNED_TO_ID: Optional[str] = None
    SEVERITY: Optional[str] = None
