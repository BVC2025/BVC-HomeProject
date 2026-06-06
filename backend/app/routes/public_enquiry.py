"""
Public Customer Enquiry — no auth required.

Customers fill the chatbot at /enquiry and submit their requirements
in one shot. Each submission creates a Customer + CustomerRequirement
record that the admin sees in the Customer 360° view.

  POST /public/enquiry/submit   — no auth, single payload, returns thanks
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Customer, CustomerRequirement


router = APIRouter(prefix="/public/enquiry", tags=["Public Enquiry"])


# ---- Request schema ------------------------------------------------

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


# ---- Helpers -------------------------------------------------------

def _next_customer_code(db: Session, vendor_id: int) -> str:
    """Vendor-scoped CUST-NNN sequence."""

    last = (
        db.query(Customer)
        .filter(Customer.VENDOR_ID == vendor_id)
        .order_by(Customer.ID.desc())
        .first()
    )

    n = 1

    if last and last.CUSTOMER_CODE:

        try:

            n = int(last.CUSTOMER_CODE.split("-")[-1]) + 1

        except Exception:

            n = (last.ID or 0) + 1

    return f"CUST-{n:03d}"


def _parse_iso_date(s: Optional[str]) -> Optional[date]:

    if not s:

        return None

    try:

        return datetime.fromisoformat(s).date()

    except Exception:

        return None


# ---- Public endpoint ----------------------------------------------

@router.post("/submit")
def submit_enquiry(payload: EnquirySubmit, db: Session = Depends(get_db)):
    """Public — no auth. Accepts the full chatbot intake and persists
    a new Customer + their first CustomerRequirement in one transaction.

    Returns the customer code so the customer sees a friendly receipt.
    """

    c = payload.company

    r = payload.requirement

    if not c.CUSTOMER_NAME or not c.CUSTOMER_NAME.strip():

        raise HTTPException(status_code=400, detail="Company name is required.")

    if not c.PHONE or not c.PHONE.strip():

        raise HTTPException(status_code=400, detail="Phone number is required.")

    code = _next_customer_code(db, payload.VENDOR_ID)

    address_parts = [p for p in (c.CITY, c.STATE) if p]

    address = ", ".join(address_parts) if address_parts else None

    customer = Customer(
        CUSTOMER_CODE=code,
        CUSTOMER_NAME=c.CUSTOMER_NAME.strip(),
        CONTACT_PERSON=(c.CONTACT_PERSON or "").strip() or None,
        DESIGNATION=(c.DESIGNATION or "").strip() or None,
        PHONE=c.PHONE.strip(),
        EMAIL=(c.EMAIL or "").strip() or None,
        ADDRESS=address,
        CITY=(c.CITY or "").strip() or None,
        STATE=(c.STATE or "").strip() or None,
        INDUSTRY=(c.INDUSTRY or "").strip() or None,
        STATUS="LEAD",
        VENDOR_ID=payload.VENDOR_ID,
        # Lead/intake fields
        LEAD_SOURCE="WEBSITE",
        LEAD_STATUS="NEW",
        LEAD_PRIORITY="MEDIUM",
        LEAD_CREATED_DATE=date.today(),
        REQUIREMENT_NOTES=(payload.free_text_summary or "").strip() or None
    )

    db.add(customer)

    db.flush()           # gives us customer.ID without committing yet

    # Only create a requirement if at least one machine field was filled
    has_req = any([
        r.MACHINE_CATEGORY, r.MACHINE_NAME, r.QUANTITY,
        r.CAPACITY, r.TARGET_UNIT_PRICE, r.TARGET_DELIVERY_DATE,
        r.INSTALLATION_SITE, r.SPECIAL_NOTES
    ])

    if has_req:

        req = CustomerRequirement(
            CUSTOMER_ID=customer.ID,
            MACHINE_CATEGORY=(r.MACHINE_CATEGORY or "").strip() or None,
            MACHINE_NAME=(r.MACHINE_NAME or "").strip() or None,
            QUANTITY=r.QUANTITY or 1,
            CAPACITY=(r.CAPACITY or "").strip() or None,
            TARGET_UNIT_PRICE=r.TARGET_UNIT_PRICE,
            TARGET_DELIVERY_DATE=_parse_iso_date(r.TARGET_DELIVERY_DATE),
            INSTALLATION_SITE=(r.INSTALLATION_SITE or "").strip() or None,
            PRIORITY="MEDIUM",
            STATUS="DRAFT",
            SPECIAL_NOTES=(r.SPECIAL_NOTES or "").strip() or None,
            VENDOR_ID=payload.VENDOR_ID
        )

        db.add(req)

    db.commit()

    db.refresh(customer)

    # Fire-and-forget WhatsApp alert to MD (same pattern as enquiry route)
    try:

        from app.services.whatsapp_service import notify_md_safe

        msg = (
            f"🌐 *New Website Enquiry — BVC24*\n\n"
            f"👤 *{customer.CUSTOMER_NAME}*\n"
            f"📞 {customer.PHONE}\n"
            + (f"📧 {customer.EMAIL}\n" if customer.EMAIL else "")
            + (f"🏢 {customer.INDUSTRY}\n" if customer.INDUSTRY else "")
            + (f"📍 {address}\n" if address else "")
            + (
                f"\n🤖 {r.MACHINE_CATEGORY or 'machine'}"
                f" × {r.QUANTITY or 1}"
                if has_req else ""
            )
            + f"\n\nCode: {customer.CUSTOMER_CODE}"
        )

        notify_md_safe(msg)

    except Exception:

        pass    # non-fatal

    return {
        "success": True,
        "message": (
            f"Thanks {customer.CONTACT_PERSON or customer.CUSTOMER_NAME}! "
            f"We've recorded your enquiry. Our team will get in touch within 24 hours."
        ),
        "customer_code": customer.CUSTOMER_CODE,
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
