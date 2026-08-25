from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class QuotationLineCreate(BaseModel):
    """One line on a new/updated quotation."""

    PRODUCT_MODEL_ID: Optional[int] = None
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

    CUSTOMER_ID: str
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


class AutoGenerateLineInput(BaseModel):
    """One machine/line the caller wants priced and added to the
    auto-generated quotation. Supplied directly by the caller —
    there are no CustomerRequirement rows to pick from anymore."""

    PRODUCT_MODEL_ID: Optional[int] = None
    MACHINE_NAME: Optional[str] = None
    MACHINE_CATEGORY: Optional[str] = None
    CAPACITY: Optional[str] = None
    QUANTITY: float = 1.0
    TARGET_UNIT_PRICE: Optional[float] = None
    SPECIAL_NOTES: Optional[str] = None


class AutoGenerateQuotation(BaseModel):
    """One-shot auto-generation of a draft (and optionally sent)
    quotation from a caller-supplied list of machine lines.

    The pricing/feature-detection logic (category base price +
    free-text feature detection) runs against each LINES entry —
    the caller no longer picks from CustomerRequirement rows, they
    supply the machine details directly.
    """

    CUSTOMER_ID: str
    LINES: List[AutoGenerateLineInput]
    QUOTATION_DATE: Optional[date] = None
    DISCOUNT_PERCENT: Optional[float] = 0.0
    NOTES: Optional[str] = None
    PREPARED_BY: Optional[str] = None
    AUTO_SEND_EMAIL: Optional[bool] = True
    MARGIN_PERCENT: Optional[float] = 25.0
    VALIDITY_DAYS: Optional[int] = 30
