from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class QuotationLineCreate(BaseModel):
    """One line on a new/updated quotation."""

    PRODUCT_MODEL_ID: Optional[int] = None
    REQUIREMENT_ID: Optional[int] = None
    DESCRIPTION: str
    HSN_CODE: Optional[str] = None
    QUANTITY: float = 1.0
    UNIT: Optional[str] = "nos"
    UNIT_PRICE: float = 0.0
    DISCOUNT_PERCENT: Optional[float] = 0.0
    SORT_ORDER: Optional[int] = 0


class QuotationLineUpdate(BaseModel):

    PRODUCT_MODEL_ID: Optional[int] = None
    DESCRIPTION: Optional[str] = None
    HSN_CODE: Optional[str] = None
    QUANTITY: Optional[float] = None
    UNIT: Optional[str] = None
    UNIT_PRICE: Optional[float] = None
    DISCOUNT_PERCENT: Optional[float] = None
    SORT_ORDER: Optional[int] = None


class QuotationCreate(BaseModel):
    """Create a quotation in one shot — header + lines."""

    CUSTOMER_ID: int
    QUOTATION_DATE: Optional[date] = None
    VALIDITY_DAYS: Optional[int] = 30
    DISCOUNT_PERCENT: Optional[float] = 0.0
    TAX_PERCENT: Optional[float] = 18.0
    TERMS_AND_CONDITIONS: Optional[str] = None
    NOTES: Optional[str] = None
    PREPARED_BY: Optional[str] = None
    VENDOR_ID: Optional[int] = 1

    LINES: List[QuotationLineCreate] = []


class QuotationUpdate(BaseModel):
    """Update header-level fields (use line-level endpoints to edit lines)."""

    QUOTATION_DATE: Optional[date] = None
    VALIDITY_DAYS: Optional[int] = None
    DISCOUNT_PERCENT: Optional[float] = None
    TAX_PERCENT: Optional[float] = None
    TERMS_AND_CONDITIONS: Optional[str] = None
    NOTES: Optional[str] = None
    PREPARED_BY: Optional[str] = None


class QuotationRejection(BaseModel):

    REJECTION_REASON: Optional[str] = None


class QuotationFromRequirement(BaseModel):
    """Auto-generate a quotation skeleton from one or more requirement
    rows on a customer. Uses BOM-based pricing if available."""

    CUSTOMER_ID: int
    REQUIREMENT_IDS: List[int]
    MARGIN_PERCENT: Optional[float] = 25.0
    # Markup applied on top of raw BOM cost
    VENDOR_ID: Optional[int] = 1


class AutoGenerateQuotation(BaseModel):
    """One-shot auto-generation of a draft (and optionally sent)
    quotation from ALL of a customer's active requirements.

    Difference vs QuotationFromRequirement:
      - That schema requires explicit REQUIREMENT_IDS picked by the
        sales rep in the UI.
      - This one is fully automatic — picks every DRAFT / CONFIRMED /
        QUOTED requirement the customer has, builds a quotation, and
        (by default) emails it. The flow the 'Generate Quotation'
        button on the customer drawer uses.
    """

    CUSTOMER_ID: int
    QUOTATION_DATE: Optional[date] = None
    DISCOUNT_PERCENT: Optional[float] = 0.0
    NOTES: Optional[str] = None
    AUTO_SEND_EMAIL: Optional[bool] = True
    MARGIN_PERCENT: Optional[float] = 25.0
    VALIDITY_DAYS: Optional[int] = 30
