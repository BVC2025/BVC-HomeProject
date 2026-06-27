from pydantic import BaseModel
from typing import Optional, Any


# ── ProductMaster ───────────────────────────────────────────────────
class ProductCreate(BaseModel):
    VENDOR_ID: int = 1
    CATEGORY_ID: Optional[str] = None
    DEPARTMENT_ID: Optional[int] = None
    PRODUCT_CODE: str
    PRODUCT_NAME: str
    DESCRIPTION: Optional[str] = None
    HSN_CODE: Optional[str] = None
    UNIT: Optional[str] = "PCS"
    IMAGE_URL: Optional[str] = None
    SPECIFICATIONS: Optional[Any] = None
    STATUS: Optional[str] = "ACTIVE"


class ProductUpdate(BaseModel):
    CATEGORY_ID: Optional[str] = None
    DEPARTMENT_ID: Optional[int] = None
    PRODUCT_CODE: Optional[str] = None
    PRODUCT_NAME: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    HSN_CODE: Optional[str] = None
    UNIT: Optional[str] = None
    IMAGE_URL: Optional[str] = None
    SPECIFICATIONS: Optional[Any] = None
    STATUS: Optional[str] = None


# ── InventoryCategory ───────────────────────────────────────────────
class CategoryCreate(BaseModel):
    VENDOR_ID: int = 1
    NAME: str
    CODE: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    SORT_ORDER: Optional[int] = 0


class CategoryUpdate(BaseModel):
    NAME: Optional[str] = None
    CODE: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    SORT_ORDER: Optional[int] = None
    IS_ACTIVE: Optional[bool] = None


# ── SupplierProduct pricing ─────────────────────────────────────────
class SupplierProductCreate(BaseModel):
    VENDOR_ID: int = 1
    SUPPLIER_ID: int
    PRODUCT_ID: str
    UNIT_PRICE: float
    CURRENCY: Optional[str] = "INR"
    MOQ: Optional[float] = 1.0
    LEAD_TIME_DAYS: Optional[int] = 7
    AVAILABLE_QTY: Optional[float] = None
    IS_PREFERRED: Optional[bool] = False
    STATUS: Optional[str] = "ACTIVE"
    NOTES: Optional[str] = None


class SupplierProductPriceUpdate(BaseModel):
    UNIT_PRICE: float
    AVAILABLE_QTY: Optional[float] = None
    LEAD_TIME_DAYS: Optional[int] = None
    MOQ: Optional[float] = None
    CHANGE_REASON: Optional[str] = None
    CHANGED_BY_ID: Optional[str] = None
    CHANGED_BY_ROLE: Optional[str] = "EMPLOYEE"  # "EMPLOYEE" or "SUPPLIER"
