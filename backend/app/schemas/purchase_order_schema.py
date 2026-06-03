from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class POLineCreate(BaseModel):

    MATERIAL_ID: Optional[int] = None
    BOM_ITEM_ID: Optional[int] = None
    DESCRIPTION: str
    HSN_CODE: Optional[str] = None
    QUANTITY: float = 1.0
    UNIT: Optional[str] = "pcs"
    UNIT_PRICE: float = 0.0
    DISCOUNT_PERCENT: Optional[float] = 0.0
    SORT_ORDER: Optional[int] = 0


class POLineUpdate(BaseModel):

    MATERIAL_ID: Optional[int] = None
    DESCRIPTION: Optional[str] = None
    HSN_CODE: Optional[str] = None
    QUANTITY: Optional[float] = None
    UNIT: Optional[str] = None
    UNIT_PRICE: Optional[float] = None
    DISCOUNT_PERCENT: Optional[float] = None
    SORT_ORDER: Optional[int] = None


class PurchaseOrderCreate(BaseModel):
    """Create a PO with header + lines in one shot."""

    SUPPLIER_ID: int
    PO_DATE: Optional[date] = None
    EXPECTED_DELIVERY_DATE: Optional[date] = None
    DISCOUNT_PERCENT: Optional[float] = 0.0
    TAX_PERCENT: Optional[float] = 18.0
    DELIVERY_ADDRESS: Optional[str] = None
    TERMS_AND_CONDITIONS: Optional[str] = None
    NOTES: Optional[str] = None
    PREPARED_BY: Optional[str] = None
    LINKED_PROJECT_ID: Optional[int] = None
    VENDOR_ID: Optional[int] = 1

    LINES: List[POLineCreate] = []


class PurchaseOrderUpdate(BaseModel):

    SUPPLIER_ID: Optional[int] = None
    PO_DATE: Optional[date] = None
    EXPECTED_DELIVERY_DATE: Optional[date] = None
    DISCOUNT_PERCENT: Optional[float] = None
    TAX_PERCENT: Optional[float] = None
    DELIVERY_ADDRESS: Optional[str] = None
    TERMS_AND_CONDITIONS: Optional[str] = None
    NOTES: Optional[str] = None
    PREPARED_BY: Optional[str] = None
    LINKED_PROJECT_ID: Optional[int] = None


class POCancellation(BaseModel):

    CANCEL_REASON: Optional[str] = None


class GRNLineInput(BaseModel):
    """One line on a GRN — references a PO line."""

    PO_LINE_ID: int
    QUANTITY_RECEIVED: float = 0.0
    QUANTITY_REJECTED: Optional[float] = 0.0
    REJECTION_REASON: Optional[str] = None


class GRNCreate(BaseModel):
    """Record a goods receipt against a PO."""

    PO_ID: int
    RECEIVED_DATE: Optional[date] = None
    RECEIVED_BY: Optional[str] = None
    INVOICE_NUMBER: Optional[str] = None
    NOTES: Optional[str] = None
    FINALIZE: bool = False
    # If True, GRN is created in FINAL status and Inventory is updated
    # immediately. If False, stays in DRAFT for later review.

    LINES: List[GRNLineInput] = []


class AutoFromProjectRequest(BaseModel):
    """Generate POs from a project's BOM. Groups BOM items by their
    PREFERRED_SUPPLIER_ID → one PO per supplier."""

    PROJECT_ID: int
    EXPECTED_DELIVERY_DATE: Optional[date] = None
    PREPARED_BY: Optional[str] = None
    INCLUDE_UNASSIGNED: bool = False
    # If True, BOM items without a preferred supplier go into a
    # "needs supplier" placeholder PO (so the user sees them).
    VENDOR_ID: Optional[int] = 1
