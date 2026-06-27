from pydantic import BaseModel
from typing import Optional


# ── InventoryItem ───────────────────────────────────────────────────
class InventoryItemCreate(BaseModel):
    VENDOR_ID: int = 1
    PRODUCT_ID: str
    LOCATION: Optional[str] = None
    BATCH_TRACKING: Optional[bool] = False
    REORDER_LEVEL: Optional[float] = 0.0
    REORDER_QTY: Optional[float] = 0.0
    SAFETY_STOCK: Optional[float] = 0.0
    MAX_STOCK: Optional[float] = 0.0


class InventoryItemUpdate(BaseModel):
    LOCATION: Optional[str] = None
    BATCH_TRACKING: Optional[bool] = None
    REORDER_LEVEL: Optional[float] = None
    REORDER_QTY: Optional[float] = None
    SAFETY_STOCK: Optional[float] = None
    MAX_STOCK: Optional[float] = None


# ── Stock operations ────────────────────────────────────────────────
class StockMovementRequest(BaseModel):
    VENDOR_ID: int = 1
    INVENTORY_ITEM_ID: str
    QTY: float
    UNIT_COST: Optional[float] = None
    REASON: Optional[str] = None
    NOTES: Optional[str] = None
    PERFORMED_BY_ID: Optional[str] = None
    REFERENCE_TYPE: Optional[str] = None
    REFERENCE_ID: Optional[str] = None
    BATCH_ID: Optional[str] = None


class StockTransferRequest(BaseModel):
    VENDOR_ID: int = 1
    FROM_ITEM_ID: str      # InventoryItem at source location
    TO_ITEM_ID: str        # InventoryItem at destination location
    QTY: float
    REASON: Optional[str] = None
    PERFORMED_BY_ID: Optional[str] = None


# ── InventoryBatch ──────────────────────────────────────────────────
class BatchCreate(BaseModel):
    VENDOR_ID: int = 1
    INVENTORY_ITEM_ID: str
    BATCH_NUMBER: str
    LOT_NUMBER: Optional[str] = None
    SUPPLIER_ID: Optional[int] = None
    PO_ID: Optional[int] = None
    GRN_ID: Optional[int] = None
    MANUFACTURING_DATE: Optional[str] = None
    EXPIRY_DATE: Optional[str] = None
    QTY_RECEIVED: float
    UNIT_COST: Optional[float] = None
    NOTES: Optional[str] = None


class BatchUpdate(BaseModel):
    STATUS: Optional[str] = None
    QTY_REMAINING: Optional[float] = None
    NOTES: Optional[str] = None
