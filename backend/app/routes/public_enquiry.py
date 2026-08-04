"""
Public Customer Enquiry — no auth required.

Customers fill the chatbot at /enquiry and submit their requirements in
one shot. This is the "Enquiry" stage of the CRM pipeline (see the CRM &
Sales redesign plan) — each submission creates a CrmLead (STATUS='NEW'),
NOT a Customer directly. The lead only becomes a real Customer once
someone on the sales side moves it through the pipeline to Won via
POST /crm/leads/{id}/convert.

  POST /public/enquiry/submit   — no auth, single payload, returns thanks
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.crm_models import CrmLead, CrmActivity


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

def _next_lead_code(db: Session, vendor_id: int) -> str:
    """Vendor-scoped LEAD-NNN sequence."""

    last = (
        db.query(CrmLead)
        .filter(CrmLead.VENDOR_ID == vendor_id)
        .order_by(CrmLead.ID.desc())
        .first()
    )

    n = 1

    if last and last.LEAD_CODE:

        try:

            n = int(last.LEAD_CODE.split("-")[-1]) + 1

        except Exception:

            n = (last.ID or 0) + 1

    return f"LEAD-{n:03d}"


# ---- Public endpoint ----------------------------------------------

@router.post("/submit")
def submit_enquiry(payload: EnquirySubmit, db: Session = Depends(get_db)):
    """Public — no auth. Accepts the full chatbot intake and persists a
    new CrmLead (the Enquiry stage of the CRM pipeline) in one
    transaction. Structured requirement details (machine category,
    quantity, target price, etc.) are folded into REQUIREMENT_NOTES as a
    readable summary — pre-conversion requirements are a text summary,
    not the structured multi-row CustomerRequirement table (that only
    starts existing once the lead is Won and becomes a real Customer).

    Returns the lead code so the customer sees a friendly receipt.
    """

    c = payload.company

    r = payload.requirement

    if not c.CUSTOMER_NAME or not c.CUSTOMER_NAME.strip():

        raise HTTPException(status_code=400, detail="Company name is required.")

    if not c.PHONE or not c.PHONE.strip():

        raise HTTPException(status_code=400, detail="Phone number is required.")

    code = _next_lead_code(db, payload.VENDOR_ID)

    address_parts = [p for p in (c.CITY, c.STATE) if p]

    address = ", ".join(address_parts) if address_parts else None

    has_req = any([
        r.MACHINE_CATEGORY, r.MACHINE_NAME, r.QUANTITY,
        r.CAPACITY, r.TARGET_UNIT_PRICE, r.TARGET_DELIVERY_DATE,
        r.INSTALLATION_SITE, r.SPECIAL_NOTES
    ])

    notes_parts = []

    if payload.free_text_summary and payload.free_text_summary.strip():
        notes_parts.append(payload.free_text_summary.strip())

    if has_req:
        req_bits = [
            f"Machine: {r.MACHINE_NAME or r.MACHINE_CATEGORY}",
            f"Qty: {r.QUANTITY or 1}",
        ]
        if r.CAPACITY:
            req_bits.append(f"Capacity: {r.CAPACITY}")
        if r.TARGET_UNIT_PRICE:
            req_bits.append(f"Target price: ₹{r.TARGET_UNIT_PRICE}/unit")
        if r.TARGET_DELIVERY_DATE:
            req_bits.append(f"Needed by: {r.TARGET_DELIVERY_DATE}")
        if r.INSTALLATION_SITE:
            req_bits.append(f"Install site: {r.INSTALLATION_SITE}")
        if r.SPECIAL_NOTES:
            req_bits.append(f"Notes: {r.SPECIAL_NOTES}")
        notes_parts.append(" · ".join(req_bits))

    lead = CrmLead(
        LEAD_CODE=code,
        COMPANY_NAME=c.CUSTOMER_NAME.strip(),
        CONTACT_PERSON=(c.CONTACT_PERSON or "").strip() or None,
        DESIGNATION=(c.DESIGNATION or "").strip() or None,
        PHONE=c.PHONE.strip(),
        EMAIL=(c.EMAIL or "").strip() or None,
        CITY=(c.CITY or "").strip() or None,
        STATE=(c.STATE or "").strip() or None,
        SOURCE="WEBSITE",
        STATUS="NEW",
        PRIORITY="MEDIUM",
        REQUIREMENT_NOTES="\n".join(notes_parts) or None,
        VENDOR_ID=payload.VENDOR_ID,
    )

    db.add(lead)

    db.flush()           # gives us lead.ID without committing yet

    db.add(CrmActivity(
        CRM_LEAD_ID=lead.ID,
        EVENT_TYPE="CREATED",
        EVENT_DETAIL="Submitted via public website enquiry form",
        ACTOR_TYPE="SYSTEM",
    ))

    db.commit()

    db.refresh(lead)

    # Fire-and-forget WhatsApp alert to MD (same pattern as enquiry route)
    try:

        from app.services.whatsapp_service import notify_md_safe

        msg = (
            f"🌐 *New Website Enquiry — BVC24*\n\n"
            f"👤 *{lead.COMPANY_NAME}*\n"
            f"📞 {lead.PHONE}\n"
            + (f"📧 {lead.EMAIL}\n" if lead.EMAIL else "")
            + (f"📍 {address}\n" if address else "")
            + (
                f"\n🤖 {r.MACHINE_CATEGORY or 'machine'}"
                f" × {r.QUANTITY or 1}"
                if has_req else ""
            )
            + f"\n\nLead: {lead.LEAD_CODE}"
        )

        notify_md_safe(msg)

    except Exception:

        pass    # non-fatal

    return {
        "success": True,
        "message": (
            f"Thanks {lead.CONTACT_PERSON or lead.COMPANY_NAME}! "
            f"We've recorded your enquiry. Our team will get in touch within 24 hours."
        ),
        "lead_code": lead.LEAD_CODE,
        "lead_id": lead.ID,
        # Kept for the existing PublicEnquiry.jsx reference-number display,
        # which reads `result.customer_code` — same value, new meaning.
        "customer_code": lead.LEAD_CODE,
        "customer_id": lead.ID,
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
