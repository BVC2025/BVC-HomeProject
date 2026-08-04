"""
CRM models — Phase 1 of the CRM & Sales workflow redesign.

Introduces `CrmLead` as the real pre-customer pipeline entity (until now,
"lead" fields lived directly on `Customer`, which conflated Enquiry/Lead/
Customer into one row — see the redesign plan for the full rationale).
A `CrmLead` only ever becomes a `Customer` via the explicit Won-conversion
service (`app/services/crm_conversion_service.py`); nothing else in this
file writes to `Customer`.

`CrmActivity` is the lead's event timeline, following the exact same
pattern already proven by `QuotationActivity`/`SalesOrderActivity` in
models.py — one event-sourced table per entity, not six separate
follow-up/call/meeting/email/whatsapp tables.
"""

from sqlalchemy import Column, Integer, String, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database.database import Base
from datetime import datetime


class CrmLead(Base):
    """
    Pre-customer sales pipeline entity. Carries a company/contact through
    the full CRM pipeline (NEW → ... → WON/LOST/CANCELLED); on WON, a real
    `Customer` row is created by `crm_conversion_service.convert_lead_to_
    customer()` and `CONVERTED_CUSTOMER_ID` is set here for traceability.
    """

    __tablename__ = "crm_lead"

    ID = Column(Integer, primary_key=True, index=True)

    # ---- Tenant scope ----
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID"), index=True, nullable=True)

    # ---- Identity ----
    LEAD_CODE = Column(String(20), index=True)
    # e.g. "LEAD-001" — auto-generated if not supplied

    COMPANY_NAME = Column(String(100))

    CONTACT_PERSON = Column(String(100), nullable=True)

    DESIGNATION = Column(String(80), nullable=True)

    # ---- Reach ----
    PHONE = Column(String(20), nullable=True)

    WHATSAPP_NUMBER = Column(String(20), nullable=True)

    EMAIL = Column(String(100), nullable=True)

    # ---- Address (kept minimal pre-conversion — full address capture is
    # a Customer-side concern once a lead is Won) ----
    CITY = Column(String(80), nullable=True)

    STATE = Column(String(80), nullable=True)

    # ---- Source / ingestion ----
    SOURCE = Column(String(40), index=True, nullable=True)
    # WEBSITE / PORTAL / PHONE / WHATSAPP / EMAIL / EXCEL_IMPORT /
    # INDIAMART / REFERRAL / TRADE_FAIR / SOCIAL_MEDIA / COLD_CALL /
    # MANUAL / OTHER — unifies the old Customer.LEAD_SOURCE enum and the
    # dead Lead model's INDIAMART/WEBSITE/MANUAL enum into one list.

    EXTERNAL_REFERENCE_ID = Column(String(100), index=True, nullable=True)
    # Dedup key for externally-ingested leads (e.g. IndiaMART lead id).
    # NULL for manually/portal-created leads.

    # ---- Pipeline ----
    STATUS = Column(String(30), default="NEW", index=True)
    # NEW / ASSIGNED / CONTACTED / QUALIFIED / REQUIREMENT_DISCUSSION /
    # PROPOSAL_NEEDED / QUOTATION_REQUESTED / QUOTATION_GENERATED /
    # NEGOTIATION / WON / LOST / CANCELLED

    PRIORITY = Column(String(10), default="MEDIUM", nullable=True)
    # HIGH / MEDIUM / LOW

    SCORE = Column(Integer, nullable=True)
    # Lead scoring — nullable for now; scoring logic itself is Phase 2+.

    ASSIGNED_SALES_ID = Column(String(36), ForeignKey("employee.ID"), nullable=True)

    FOLLOW_UP_DATE = Column(Date, nullable=True)

    NEXT_MEETING_DATE = Column(DateTime, nullable=True)

    REQUIREMENT_NOTES = Column(String(2000), nullable=True)
    # Free-text "what they're interested in" — deliberately not a
    # structured multi-row table pre-conversion; see plan doc for why.

    LOST_REASON = Column(String(500), nullable=True)

    # ---- Conversion tracking ----
    CONVERTED_CUSTOMER_ID = Column(Integer, ForeignKey("customer.ID"), nullable=True, index=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    activities = relationship(
        "CrmActivity", back_populates="lead",
        order_by="CrmActivity.CREATED_AT", cascade="all, delete-orphan"
    )


class CrmActivity(Base):
    """
    Timeline of everything that happened to a CrmLead — created, assigned,
    contacted, status changes, calls/meetings/emails/WhatsApp/notes,
    converted, lost. One row per event, ordered by CREATED_AT for the UI
    timeline — same pattern as QuotationActivity/SalesOrderActivity.
    """

    __tablename__ = "crm_activity"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    CRM_LEAD_ID = Column(Integer, ForeignKey("crm_lead.ID"), index=True)

    EVENT_TYPE = Column(String(40), index=True)
    # CREATED / ASSIGNED / STATUS_CHANGE / CALL / MEETING / EMAIL /
    # WHATSAPP / NOTE / CONVERTED / LOST

    EVENT_DETAIL = Column(String(500), nullable=True)

    ACTOR_TYPE = Column(String(20), nullable=True)
    # SYSTEM / SALES

    ACTOR_NAME = Column(String(150), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    lead = relationship("CrmLead", back_populates="activities")
