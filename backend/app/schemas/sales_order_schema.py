from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class SOLineCreate(BaseModel):

    PRODUCT_MODEL_ID: Optional[int] = None
    QUOTATION_LINE_ID: Optional[int] = None
    DESCRIPTION: str
    HSN_CODE: Optional[str] = None
    QUANTITY: float = 1.0
    UNIT: Optional[str] = "nos"
    UNIT_PRICE: float = 0.0
    DISCOUNT_PERCENT: Optional[float] = 0.0
    SORT_ORDER: Optional[int] = 0


class SOLineUpdate(BaseModel):

    DESCRIPTION: Optional[str] = None
    HSN_CODE: Optional[str] = None
    QUANTITY: Optional[float] = None
    UNIT: Optional[str] = None
    UNIT_PRICE: Optional[float] = None
    DISCOUNT_PERCENT: Optional[float] = None
    SORT_ORDER: Optional[int] = None


class SalesOrderCreate(BaseModel):
    """Header + lines for a new SO."""

    CUSTOMER_ID: int
    QUOTATION_ID: Optional[int] = None
    SO_DATE: Optional[date] = None
    EXPECTED_DELIVERY_DATE: Optional[date] = None
    ADVANCE_DUE_DATE: Optional[date] = None
    DISCOUNT_PERCENT: Optional[float] = 0.0
    TAX_PERCENT: Optional[float] = 18.0
    ADVANCE_PERCENT: Optional[float] = 50.0
    DISPATCH_PERCENT: Optional[float] = 40.0
    INSTALLATION_PERCENT: Optional[float] = 10.0
    SHIPPING_ADDRESS: Optional[str] = None
    BILLING_ADDRESS: Optional[str] = None
    TERMS_AND_CONDITIONS: Optional[str] = None
    NOTES: Optional[str] = None
    PREPARED_BY: Optional[str] = None
    VENDOR_ID: Optional[int] = 1

    LINES: List[SOLineCreate] = []


class SalesOrderUpdate(BaseModel):

    SO_DATE: Optional[date] = None
    EXPECTED_DELIVERY_DATE: Optional[date] = None
    ADVANCE_DUE_DATE: Optional[date] = None
    DISCOUNT_PERCENT: Optional[float] = None
    TAX_PERCENT: Optional[float] = None
    ADVANCE_PERCENT: Optional[float] = None
    DISPATCH_PERCENT: Optional[float] = None
    INSTALLATION_PERCENT: Optional[float] = None
    SHIPPING_ADDRESS: Optional[str] = None
    BILLING_ADDRESS: Optional[str] = None
    TERMS_AND_CONDITIONS: Optional[str] = None
    NOTES: Optional[str] = None
    PREPARED_BY: Optional[str] = None


class SOCancellation(BaseModel):

    CANCEL_REASON: Optional[str] = None


class SOFromQuotation(BaseModel):
    """Auto-create a SO from an APPROVED quotation."""

    QUOTATION_ID: int
    EXPECTED_DELIVERY_DATE: Optional[date] = None
    ADVANCE_PERCENT: Optional[float] = 50.0
    DISPATCH_PERCENT: Optional[float] = 40.0
    INSTALLATION_PERCENT: Optional[float] = 10.0
    NOTES: Optional[str] = None
    VENDOR_ID: Optional[int] = 1


class SOPaymentRecord(BaseModel):
    """Record a payment milestone receipt."""

    MILESTONE: str  # ADVANCE / DISPATCH / INSTALLATION
    AMOUNT: float
    NOTES: Optional[str] = None
