from pydantic import BaseModel
from typing import Optional


# ── Stock thresholds (one row per ProductMaster, via InventoryStock) ──
class StockThresholdCreate(BaseModel):
    VENDOR_ID: int = 1
    PRODUCT_ID: str
    MIN_QTY: Optional[float] = 0.0
    MAX_QTY: Optional[float] = None


class StockThresholdUpdate(BaseModel):
    MIN_QTY: Optional[float] = None
    MAX_QTY: Optional[float] = None


# ── Stock operations ────────────────────────────────────────────────
class StockMovementRequest(BaseModel):
    VENDOR_ID: int = 1
    PRODUCT_ID: str
    QTY: float
    UNIT_COST: Optional[float] = None
    REASON: Optional[str] = None
    NOTES: Optional[str] = None
    PERFORMED_BY_ID: Optional[str] = None
    REFERENCE_TYPE: Optional[str] = None
    REFERENCE_ID: Optional[str] = None
    BATCH_ID: Optional[str] = None


# ── InventoryBatch ──────────────────────────────────────────────────
# BATCH_NUMBER is no longer client-supplied — the route auto-generates it
# (see inventory_batches.py's _generate_batch_number()). DC_FILE_URL/
# INVOICE_FILE_URL are also no longer accepted here: create_batch now takes
# multipart/form-data (Form fields + UploadFile), matching customer_payment.py's
# manual-payment upload pattern — this schema now only covers the scalar fields.
class BatchCreate(BaseModel):
    VENDOR_ID: int = 1
    PRODUCT_ID: str
    SUPPLIER_ID: Optional[int] = None
    RECEIVED_DATE: Optional[str] = None
    MANUFACTURING_DATE: Optional[str] = None
    EXPIRY_DATE: Optional[str] = None
    IS_NO_EXPIRY: Optional[bool] = False
    QTY_RECEIVED: float
    UNIT_COST: Optional[float] = None
    NOTES: Optional[str] = None
    CREATED_BY: Optional[str] = None


class BatchUpdate(BaseModel):
    STATUS: Optional[str] = None
    QTY_REMAINING: Optional[float] = None
    SUPPLIER_ID: Optional[int] = None
    EXPIRY_DATE: Optional[str] = None
    IS_NO_EXPIRY: Optional[bool] = None
    NOTES: Optional[str] = None
