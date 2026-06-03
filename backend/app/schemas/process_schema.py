from typing import Optional

from pydantic import BaseModel


class ProcessStageCreate(BaseModel):

    PRODUCT_MODEL_ID: int
    STAGE_NAME: str
    STAGE_TYPE: str = "ASSEMBLY"
    DESCRIPTION: Optional[str] = None
    SEQUENCE: int = 1
    ESTIMATED_HOURS: float = 8.0


class ProcessStageUpdate(BaseModel):

    STAGE_NAME: Optional[str] = None
    STAGE_TYPE: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    SEQUENCE: Optional[int] = None
    ESTIMATED_HOURS: Optional[float] = None
    IS_ACTIVE: Optional[int] = None


class WOStageProgressUpdate(BaseModel):

    STATUS: str   # PENDING / IN_PROGRESS / DONE / FAILED / SKIPPED
    ASSIGNED_TO_ID: Optional[str] = None
    NOTES: Optional[str] = None


class BOMItemTypeUpdate(BaseModel):
    """Used by the BOM editor to flip an item between PURCHASE
    and PROCESS, and to attach the relevant supplier or stage."""

    ITEM_TYPE: str   # PURCHASE / PROCESS
    PREFERRED_SUPPLIER_ID: Optional[int] = None
    PROCESS_STAGE_ID: Optional[int] = None
