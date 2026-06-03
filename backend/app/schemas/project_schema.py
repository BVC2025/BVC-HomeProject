from datetime import date
from typing import Optional

from pydantic import BaseModel


class CustomerCreate(BaseModel):

    CUSTOMER_NAME: str
    PHONE: str
    EMAIL: str
    ADDRESS: str
    VENDOR_ID: int

    # Extended fields (all optional for backwards-compat)
    CUSTOMER_CODE: Optional[str] = None
    CONTACT_PERSON: Optional[str] = None
    DESIGNATION: Optional[str] = None
    ALTERNATE_PHONE: Optional[str] = None
    WEBSITE: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY: Optional[str] = "India"
    GST_NUMBER: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    INDUSTRY: Optional[str] = None
    SOURCE: Optional[str] = None
    STATUS: Optional[str] = "ACTIVE"
    NOTES: Optional[str] = None

    # Order intake — the vending machine this customer wants.
    REQUESTED_MACHINE_NAME: Optional[str] = None
    REQUESTED_MACHINE_CATEGORY: Optional[str] = None
    REQUESTED_QUANTITY: Optional[int] = 1

    # ---- Phase 1: Master + Lead Pipeline fields ----
    CUSTOMER_TYPE: Optional[str] = None
    BUSINESS_TYPE: Optional[str] = None
    NUMBER_OF_BRANCHES: Optional[int] = None
    EXPECTED_MONTHLY_ORDERS: Optional[int] = None
    EXISTING_MACHINE_USAGE: Optional[int] = 0
    CURRENT_VENDOR_NAME: Optional[str] = None
    WHATSAPP_NUMBER: Optional[str] = None
    BILLING_ADDRESS: Optional[str] = None
    SHIPPING_ADDRESS: Optional[str] = None
    GOOGLE_MAP_LOCATION: Optional[str] = None
    LEAD_SOURCE: Optional[str] = None
    LEAD_STATUS: Optional[str] = "NEW"
    LEAD_PRIORITY: Optional[str] = "MEDIUM"
    LEAD_CREATED_DATE: Optional[date] = None
    ASSIGNED_SALES_ID: Optional[str] = None
    FOLLOW_UP_DATE: Optional[date] = None
    REQUIREMENT_NOTES: Optional[str] = None


class EnquiryCreate(BaseModel):
    """Quick lead intake — minimum fields to log an enquiry. Sales
    captures the basics now and enriches later."""

    CUSTOMER_NAME: str
    PHONE: str
    EMAIL: Optional[str] = None
    REQUIREMENT_NOTES: str
    LEAD_SOURCE: Optional[str] = "WEBSITE"
    LEAD_PRIORITY: Optional[str] = "MEDIUM"
    ASSIGNED_SALES_ID: Optional[str] = None
    INDUSTRY: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    VENDOR_ID: int = 1


class LeadStatusUpdate(BaseModel):

    LEAD_STATUS: Optional[str] = None
    LEAD_PRIORITY: Optional[str] = None
    FOLLOW_UP_DATE: Optional[date] = None
    NEXT_MEETING_DATE: Optional[str] = None  # ISO datetime
    ASSIGNED_SALES_ID: Optional[str] = None
    REMARKS: Optional[str] = None


class ContactCreate(BaseModel):

    NAME: str
    DESIGNATION: Optional[str] = None
    DEPARTMENT: Optional[str] = None
    PHONE: Optional[str] = None
    WHATSAPP: Optional[str] = None
    EMAIL: Optional[str] = None
    IS_PRIMARY: Optional[int] = 0
    NOTES: Optional[str] = None


class CustomerUpdate(BaseModel):

    CUSTOMER_NAME: Optional[str] = None
    CONTACT_PERSON: Optional[str] = None
    DESIGNATION: Optional[str] = None
    PHONE: Optional[str] = None
    ALTERNATE_PHONE: Optional[str] = None
    EMAIL: Optional[str] = None
    WEBSITE: Optional[str] = None
    ADDRESS: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY: Optional[str] = None
    GST_NUMBER: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    INDUSTRY: Optional[str] = None
    SOURCE: Optional[str] = None
    STATUS: Optional[str] = None
    NOTES: Optional[str] = None

    # ---- Phase 1: Master + Lead Pipeline (all editable) ----
    CUSTOMER_TYPE: Optional[str] = None
    BUSINESS_TYPE: Optional[str] = None
    NUMBER_OF_BRANCHES: Optional[int] = None
    EXPECTED_MONTHLY_ORDERS: Optional[int] = None
    EXISTING_MACHINE_USAGE: Optional[int] = None
    CURRENT_VENDOR_NAME: Optional[str] = None
    WHATSAPP_NUMBER: Optional[str] = None
    BILLING_ADDRESS: Optional[str] = None
    SHIPPING_ADDRESS: Optional[str] = None
    GOOGLE_MAP_LOCATION: Optional[str] = None
    LEAD_SOURCE: Optional[str] = None
    LEAD_STATUS: Optional[str] = None
    LEAD_PRIORITY: Optional[str] = None
    LEAD_CREATED_DATE: Optional[date] = None
    ASSIGNED_SALES_ID: Optional[str] = None
    FOLLOW_UP_DATE: Optional[date] = None
    REQUIREMENT_NOTES: Optional[str] = None


class RequirementCreate(BaseModel):
    """Phase 2 — one row in a customer's multi-spec requirements list."""

    MACHINE_CATEGORY: Optional[str] = None
    MACHINE_NAME: Optional[str] = None
    PRODUCT_MODEL_ID: Optional[int] = None
    QUANTITY: Optional[int] = 1
    CAPACITY: Optional[str] = None
    TARGET_UNIT_PRICE: Optional[float] = None
    TARGET_DELIVERY_DATE: Optional[date] = None
    INSTALLATION_SITE: Optional[str] = None
    PRIORITY: Optional[str] = "MEDIUM"
    STATUS: Optional[str] = "DRAFT"
    SPECIAL_NOTES: Optional[str] = None


class RequirementUpdate(BaseModel):

    MACHINE_CATEGORY: Optional[str] = None
    MACHINE_NAME: Optional[str] = None
    PRODUCT_MODEL_ID: Optional[int] = None
    QUANTITY: Optional[int] = None
    CAPACITY: Optional[str] = None
    TARGET_UNIT_PRICE: Optional[float] = None
    TARGET_DELIVERY_DATE: Optional[date] = None
    INSTALLATION_SITE: Optional[str] = None
    PRIORITY: Optional[str] = None
    STATUS: Optional[str] = None
    SPECIAL_NOTES: Optional[str] = None


class ProjectCreate(BaseModel):

    PROJECT_NAME: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    SUB_PROJECT_TEMPLATE_ID: Optional[int] = None
    DEPARTMENT_ID: Optional[int] = None
    CUSTOMER_ID: Optional[int] = None
    VENDOR_ID: int


class ProjectFromProductRequest(BaseModel):
    """The new BVC24 way to create a project.

    Required: a customer who wants a product + the product itself.
    Everything else (skills, stages, tasks, employee assignments,
    emails) is orchestrated automatically.
    """

    CUSTOMER_ID: int
    PRODUCT_MODEL_ID: int
    QUANTITY: int = 1
    PRIORITY: Optional[str] = "MEDIUM"   # HIGH / MEDIUM / LOW
    TARGET_DATE: Optional[date] = None
    NOTES: Optional[str] = None
    VENDOR_ID: int = 1


class TaskApprovalDecision(BaseModel):

    EMPLOYEE_ID: Optional[str] = None   # who's accepting/rejecting
    REASON: Optional[str] = None        # for rejections
