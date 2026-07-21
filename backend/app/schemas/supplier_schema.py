from typing import List, Optional

from pydantic import BaseModel


class SupplierCreate(BaseModel):

    SUPPLIER_CODE: str
    COMPANY_NAME: str
    CONTACT_PERSON: Optional[str] = None
    PHONE: Optional[str] = None
    EMAIL: Optional[str] = None
    ADDRESS_LINE1: Optional[str] = None
    ADDRESS_LINE2: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    GST_NUMBER: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    BANK_NAME: Optional[str] = None
    ACCOUNT_NUMBER: Optional[str] = None
    IFSC_CODE: Optional[str] = None
    CATEGORY: Optional[str] = None
    PAYMENT_TERMS: Optional[str] = None
    STATUS: str = "ACTIVE"
    NOTES: Optional[str] = None
    VENDOR_ID: int = 1
    # new fields
    REGISTRATION_NO: Optional[str] = None
    COMPANY_TYPE: Optional[str] = None
    WEBSITE: Optional[str] = None
    ALTERNATE_EMAIL: Optional[str] = None
    ALTERNATE_PHONE: Optional[str] = None
    YEARS_IN_BUSINESS: Optional[int] = None
    ANNUAL_TURNOVER: Optional[float] = None
    EMPLOYEE_COUNT: Optional[int] = None
    CERTIFICATIONS: Optional[List[str]] = None
    ADVANCE_PERCENT: Optional[float] = None
    CREDIT_DAYS: Optional[int] = None
    MINIMUM_ORDER_VALUE: Optional[float] = None
    LEAD_TIME_DAYS: Optional[int] = None
    DELIVERY_MODES: Optional[List[str]] = None


class SupplierUpdate(BaseModel):

    COMPANY_NAME: Optional[str] = None
    CONTACT_PERSON: Optional[str] = None
    PHONE: Optional[str] = None
    EMAIL: Optional[str] = None
    ADDRESS_LINE1: Optional[str] = None
    ADDRESS_LINE2: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    GST_NUMBER: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    BANK_NAME: Optional[str] = None
    ACCOUNT_NUMBER: Optional[str] = None
    IFSC_CODE: Optional[str] = None
    CATEGORY: Optional[str] = None
    PAYMENT_TERMS: Optional[str] = None
    STATUS: Optional[str] = None
    NOTES: Optional[str] = None
    # new fields
    REGISTRATION_NO: Optional[str] = None
    COMPANY_TYPE: Optional[str] = None
    WEBSITE: Optional[str] = None
    ALTERNATE_EMAIL: Optional[str] = None
    ALTERNATE_PHONE: Optional[str] = None
    YEARS_IN_BUSINESS: Optional[int] = None
    ANNUAL_TURNOVER: Optional[float] = None
    EMPLOYEE_COUNT: Optional[int] = None
    CERTIFICATIONS: Optional[List[str]] = None
    ADVANCE_PERCENT: Optional[float] = None
    CREDIT_DAYS: Optional[int] = None
    MINIMUM_ORDER_VALUE: Optional[float] = None
    LEAD_TIME_DAYS: Optional[int] = None
    DELIVERY_MODES: Optional[List[str]] = None
