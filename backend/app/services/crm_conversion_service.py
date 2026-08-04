"""
CRM Lead → Customer conversion — Phase 1 of the CRM & Sales workflow
redesign.

Single-call orchestration, same shape as `project_from_product_service.
create_project_from_product()`: one function, clear docstring of exactly
what it creates, raises plain ValueError on bad input (route layer turns
that into HTTPException).
"""

from typing import Any, Dict

from sqlalchemy.orm import Session

from app.models.crm_models import CrmLead, CrmActivity
from app.models.models import Customer


def _next_customer_code(db: Session, vendor_id: int) -> str:
    """Mirrors project.py's own `_next_customer_code` — kept local here
    rather than imported to avoid a circular import between the routes
    and services layers; same CUST-NNN numbering scheme either way."""

    count = db.query(Customer).filter(Customer.VENDOR_ID == vendor_id).count()

    return f"CUST-{count + 1:03d}"


def convert_lead_to_customer(db: Session, lead_id: int) -> Dict[str, Any]:
    """
    Converts a Won CrmLead into a real Customer master record.

    Creates:
      1. Customer — copies company/contact/reach fields plus the existing
         lead-pipeline columns Customer already carries (LEAD_SOURCE,
         LEAD_PRIORITY, ASSIGNED_SALES_ID, FOLLOW_UP_DATE, REQUIREMENT_
         NOTES) so anything still reading those columns elsewhere in the
         app keeps working unchanged. STATUS starts as PROSPECT (real
         customer master, no orders yet — ACTIVE means "receiving
         orders" per the Customers page KPI copy).
      2. CrmActivity "CONVERTED" event on the source lead.
      3. Sets CrmLead.STATUS='WON' (if not already) and CONVERTED_
         CUSTOMER_ID to the new customer's ID.

    Returns {"customer_id", "customer_code", "customer_name"} so the
    frontend can navigate straight to the new customer's 360° view.
    """

    lead = db.query(CrmLead).filter(CrmLead.ID == lead_id).first()

    if not lead:
        raise ValueError(f"CRM lead {lead_id} not found")

    if lead.CONVERTED_CUSTOMER_ID:
        raise ValueError(
            f"Lead {lead_id} was already converted to customer "
            f"{lead.CONVERTED_CUSTOMER_ID}"
        )

    code = _next_customer_code(db, lead.VENDOR_ID)

    customer = Customer(
        CUSTOMER_CODE=code,
        CUSTOMER_NAME=lead.COMPANY_NAME,
        CONTACT_PERSON=lead.CONTACT_PERSON,
        DESIGNATION=lead.DESIGNATION,
        PHONE=lead.PHONE,
        EMAIL=lead.EMAIL,
        WHATSAPP_NUMBER=lead.WHATSAPP_NUMBER,
        ADDRESS=lead.CITY or "",
        CITY=lead.CITY,
        STATE=lead.STATE,
        COUNTRY="India",
        STATUS="PROSPECT",
        VENDOR_ID=lead.VENDOR_ID,
        LEAD_SOURCE=lead.SOURCE,
        LEAD_STATUS="WON",
        LEAD_PRIORITY=lead.PRIORITY,
        ASSIGNED_SALES_ID=lead.ASSIGNED_SALES_ID,
        FOLLOW_UP_DATE=lead.FOLLOW_UP_DATE,
        REQUIREMENT_NOTES=lead.REQUIREMENT_NOTES,
    )

    db.add(customer)
    db.flush()  # populate customer.ID before using it below

    lead.STATUS = "WON"
    lead.CONVERTED_CUSTOMER_ID = customer.ID

    db.add(CrmActivity(
        CRM_LEAD_ID=lead.ID,
        EVENT_TYPE="CONVERTED",
        EVENT_DETAIL=f"Converted to customer {code} ({customer.CUSTOMER_NAME})",
        ACTOR_TYPE="SYSTEM",
    ))

    db.commit()
    db.refresh(customer)

    return {
        "customer_id": customer.ID,
        "customer_code": customer.CUSTOMER_CODE,
        "customer_name": customer.CUSTOMER_NAME,
    }
