from pydantic import BaseModel, EmailStr
from typing import Optional, List, Any, Dict


# ── Admin: create invitation ────────────────────────────────────────
class InvitationCreate(BaseModel):
    VENDOR_ID: int = 1
    INVITED_EMAIL: Optional[str] = None
    INVITED_PHONE: Optional[str] = None
    INVITED_COMPANY_NAME: Optional[str] = None
    NOTES: Optional[str] = None
    CREATED_BY_ID: Optional[str] = None
    # days until link expires; None = no expiry
    EXPIRES_IN_DAYS: Optional[int] = 30


# ── Public: auto-save draft ─────────────────────────────────────────
class DraftProductRow(BaseModel):
    """One product/material row submitted by the supplier."""
    product_name: str
    product_id: Optional[str] = None     # product_master.ID; None for free-text / restored rows
    description: Optional[str] = None
    unit: Optional[str] = "PCS"
    unit_price: Optional[float] = None
    moq: Optional[float] = None
    available_qty: Optional[float] = None
    lead_time_days: Optional[int] = None
    hsn_code: Optional[str] = None
    product_image: Optional[str] = None
    remarks: Optional[str] = None


class DraftSaveRequest(BaseModel):
    """Payload for auto-save (can be partial — any subset of fields)."""
    ENTRY_MODE: Optional[str] = "MANUAL"      # MANUAL or VOICE
    VOICE_TRANSCRIPT: Optional[str] = None

    # Company detail fields (all optional — saved as partial draft)
    company_name: Optional[str] = None
    registration_no: Optional[str] = None
    company_type: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    alternate_phone: Optional[str] = None
    email: Optional[str] = None
    alternate_email: Optional[str] = None
    website: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc_code: Optional[str] = None
    payment_terms: Optional[str] = None
    years_in_business: Optional[float] = None
    annual_turnover: Optional[float] = None
    employee_count: Optional[int] = None
    certifications: Optional[List[str]] = None
    advance_percent: Optional[float] = None
    credit_days: Optional[int] = None
    minimum_order_value: Optional[float] = None
    lead_time_days: Optional[int] = None
    delivery_modes: Optional[List[str]] = None

    products: Optional[List[DraftProductRow]] = None
    cf_values: Optional[dict] = None  # custom field values keyed by field ID


# ── Admin: approve / reject ─────────────────────────────────────────
class ApprovalRequest(BaseModel):
    COMMENTS: Optional[str] = None


class RejectionRequest(BaseModel):
    REJECTION_REASON: str
    COMMENTS: Optional[str] = None
