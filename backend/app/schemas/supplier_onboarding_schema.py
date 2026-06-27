from pydantic import BaseModel, EmailStr
from typing import Optional, List, Any, Dict


# ── Admin: create invitation ────────────────────────────────────────
class InvitationCreate(BaseModel):
    VENDOR_ID: int = 1
    INVITED_EMAIL: Optional[str] = None
    INVITED_PHONE: Optional[str] = None
    INVITED_COMPANY_NAME: Optional[str] = None
    NOTES: Optional[str] = None
    # days until link expires; None = no expiry
    EXPIRES_IN_DAYS: Optional[int] = 30


# ── Public: auto-save draft ─────────────────────────────────────────
class DraftProductRow(BaseModel):
    """One product/material row submitted by the supplier."""
    product_name: str
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
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    website: Optional[str] = None

    products: Optional[List[DraftProductRow]] = None


# ── Admin: approve / reject ─────────────────────────────────────────
class ApprovalRequest(BaseModel):
    COMMENTS: Optional[str] = None


class RejectionRequest(BaseModel):
    REJECTION_REASON: str
    COMMENTS: Optional[str] = None
