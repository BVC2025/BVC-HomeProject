"""
Public Customer Enquiry — no auth required.

Customers fill the chatbot at /enquiry and submit their requirements
in one shot. Each submission creates a Customer record that the
admin sees in the Customer 360° view.

  POST /public/enquiry/submit   — no auth, single payload, returns thanks
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Customer


router = APIRouter(prefix="/public/enquiry", tags=["Public Enquiry"])


# ---- Request schema ------------------------------------------------
# NOTE: field names here are kept close to the legacy shape on purpose
# so the (separately being redesigned) PublicEnquiry.jsx frontend does
# not 422 mid-transition. Not every field below is persisted anymore —
# see submit_enquiry() for exactly what is written to the Customer row.

class CompanyBlock(BaseModel):

    CUSTOMER_NAME: str
    CONTACT_PERSON: Optional[str] = None
    DESIGNATION: Optional[str] = None
    PHONE: str
    EMAIL: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    INDUSTRY: Optional[str] = None


class RequirementBlock(BaseModel):

    MACHINE_CATEGORY: Optional[str] = None
    MACHINE_NAME: Optional[str] = None
    QUANTITY: Optional[int] = 1
    CAPACITY: Optional[str] = None
    TARGET_UNIT_PRICE: Optional[float] = None
    TARGET_DELIVERY_DATE: Optional[str] = None     # ISO yyyy-mm-dd
    INSTALLATION_SITE: Optional[str] = None
    SPECIAL_NOTES: Optional[str] = None


class EnquirySubmit(BaseModel):

    company: CompanyBlock
    requirement: RequirementBlock
    free_text_summary: Optional[str] = None
    VENDOR_ID: int = 1


# ---- Public endpoint ----------------------------------------------

@router.post("/submit")
def submit_enquiry(payload: EnquirySubmit, db: Session = Depends(get_db)):
    """Public — no auth. Accepts the full chatbot intake and persists
    a new Customer record.

    The Customer table only has room for NAME / PHONE_NUMBER / EMAIL /
    ADDRESS / GST_NUMBER (+ VENDOR_ID) these days, so CONTACT_PERSON,
    DESIGNATION, CITY, STATE, INDUSTRY and the machine requirement
    block are accepted (so the current frontend doesn't break) but are
    deliberately NOT persisted anywhere.

    Returns the customer id so the customer sees a friendly receipt.
    """

    c = payload.company

    r = payload.requirement

    if not c.CUSTOMER_NAME or not c.CUSTOMER_NAME.strip():

        raise HTTPException(status_code=400, detail="Company name is required.")

    if not c.PHONE or not c.PHONE.strip():

        raise HTTPException(status_code=400, detail="Phone number is required.")

    address_parts = [p for p in (c.CITY, c.STATE) if p]

    address = ", ".join(address_parts) if address_parts else "-"

    customer = Customer(
        NAME=c.CUSTOMER_NAME.strip(),
        PHONE_NUMBER=c.PHONE.strip(),
        EMAIL=(c.EMAIL or "").strip() or None,
        ADDRESS=address,
        VENDOR_ID=payload.VENDOR_ID
    )

    db.add(customer)

    db.commit()

    db.refresh(customer)

    # Fire-and-forget WhatsApp alert to MD (same pattern as enquiry route)
    try:

        from app.services.whatsapp_service import notify_md_safe

        has_req = any([
            r.MACHINE_CATEGORY, r.MACHINE_NAME, r.QUANTITY,
            r.CAPACITY, r.TARGET_UNIT_PRICE, r.TARGET_DELIVERY_DATE,
            r.INSTALLATION_SITE, r.SPECIAL_NOTES
        ])

        msg = (
            f"🌐 *New Website Enquiry — BVC24*\n\n"
            f"👤 *{customer.NAME}*\n"
            f"📞 {customer.PHONE_NUMBER}\n"
            + (f"📧 {customer.EMAIL}\n" if customer.EMAIL else "")
            + (f"📍 {address}\n" if address and address != "-" else "")
            + (
                f"\n🤖 {r.MACHINE_CATEGORY or 'machine'}"
                f" × {r.QUANTITY or 1}"
                if has_req else ""
            )
        )

        notify_md_safe(msg)

    except Exception:

        pass    # non-fatal

    return {
        "success": True,
        "message": (
            f"Thanks {customer.NAME}! "
            f"We've recorded your enquiry. Our team will get in touch within 24 hours."
        ),
        "customer_code": customer.ID,
        "customer_id": customer.ID
    }


# ---- Industry options (frontend uses this for the dropdown) -------

@router.get("/options")
def enquiry_options():
    """Frontend pulls dropdown choices from here so the chatbot
    stays in sync with the admin app's master lists."""

    return {
        "industries": [
            "Retail", "Healthcare", "Education", "Office",
            "Metro / Transport", "Hotel / Hospitality",
            "Government", "Manufacturing", "Other"
        ],
        "machine_categories": [
            {"key": "snack",          "label": "Snack vending"},
            {"key": "beverage",       "label": "Beverage vending"},
            {"key": "snack-beverage", "label": "Snack + Beverage combo"},
            {"key": "hot-beverage",   "label": "Hot beverage (coffee/tea)"},
            {"key": "custom",         "label": "Custom / Other"}
        ]
    }
