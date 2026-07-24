from datetime import date
from typing import Optional, List

from pydantic import BaseModel


# ---- ProductModel ----------------------------------------------------

class ProductModelCreate(BaseModel):

    MODEL_NAME: str
    MODEL_CODE: str
    CATEGORY: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    ESTIMATED_BUILD_DAYS: int = 7
    STATUS: str = "ACTIVE"
    VENDOR_ID: int = 1


class ProductModelUpdate(BaseModel):

    MODEL_NAME: Optional[str] = None
    CATEGORY: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    ESTIMATED_BUILD_DAYS: Optional[int] = None
    STATUS: Optional[str] = None


# ---- BOM -------------------------------------------------------------

class BOMItemCreate(BaseModel):

    MATERIAL_ID: Optional[int] = None
    MATERIAL_NAME: str
    QUANTITY: float = 1.0
    UNIT: str = "pcs"
    NOTES: Optional[str] = None


class BOMItemUpdate(BaseModel):

    QUANTITY: Optional[float] = None
    UNIT: Optional[str] = None
    NOTES: Optional[str] = None
    PREFERRED_SUPPLIER_ID: Optional[int] = None
    ITEM_TYPE: Optional[str] = None
    PROCESS_STAGE_ID: Optional[int] = None
    ITEM_NO: Optional[int] = None
    IMAGE_URL: Optional[str] = None


# ---- Work Orders -----------------------------------------------------

class WorkOrderCreate(BaseModel):

    PRODUCT_MODEL_ID: int
    PROJECT_ID: Optional[int] = None
    QUANTITY: int = 1
    PLANNED_START_DATE: Optional[date] = None
    PLANNED_END_DATE: Optional[date] = None
    NOTES: Optional[str] = None
    VENDOR_ID: int = 1


class WorkOrderStatusUpdate(BaseModel):

    STATUS: str   # PLANNED / IN_PROGRESS / ON_HOLD / DONE / CANCELLED
    NOTES: Optional[str] = None
