"""
Project Quotation Template — a per-project default quotation DOCUMENT
(header/letterhead, company info, line-items table, terms, signature,
footer, custom sections) that staff customize per project type.

Deliberately separate from the existing customer-facing sales Quotation
system (models.py: Quotation/QuotationLine/QuotationActivity/
QuotationNegotiation, tables quotation/quotation_line/...). This table
has no CUSTOMER_ID — Project itself is a reusable project TEMPLATE, not
a customer-specific job — so this is a reusable default document layout
per project type, not a computed sales artifact. A future phase may
merge this with real customer/lead data to feed the sales Quotation
module; that merge is out of scope here.
"""

import uuid
from app.utils.datetime_utils import now_ist

from sqlalchemy import (
    Column, String, Integer, ForeignKey, Text, Date, DateTime,
    UniqueConstraint, Index,
)
from sqlalchemy.orm import relationship

from app.database.database import Base


class ProjectQuotationTemplate(Base):
    """One row per Project (1:1). CONTENT_JSON is the structured, opaque
    editable source (frontend-owned shape — mirrors EmailTemplate.DESIGN_JSON);
    RENDERED_HTML is the server-rendered compiled output, regenerated on
    every save, and is the single source for preview + PDF + (alongside
    CONTENT_JSON) Word generation — avoiding the "two templates to keep
    in sync" problem already present in the existing sales-Quotation
    module (separate React print page + Python PDF builder)."""

    __tablename__ = "project_quotation_template"

    __table_args__ = (
        UniqueConstraint("PROJECT_ID", name="uq_pqt_project"),  # enforces 1:1
        Index("ix_pqt_vendor", "VENDOR_ID"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Integer FK — matches project.ID (see project_models.Project for the
    # backwards-compatibility rationale). Original ram-development draft
    # declared String(36) UUID; that mismatched the live DB and produced
    # MySQL error 3780 on CREATE TABLE.
    #
    # CASCADE (unlike TaskTemplate.PROJECT_ID's RESTRICT) — this is a true
    # 1:1 owned document; a DB-level backstop is safe even though the ORM
    # cascade="all, delete-orphan" on Project.quotation_template is what
    # actually fires on every normal delete through the app.

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    # RESTRICT to match Project.VENDOR_ID's own convention exactly.

    QUOTATION_NUMBER = Column(String(120), nullable=False)
    QUOTATION_DATE = Column(Date, nullable=False, default=lambda: now_ist().date())

    CONTENT_JSON = Column(Text, nullable=False)
    RENDERED_HTML = Column(Text, nullable=True)

    CREATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    UPDATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    project = relationship("Project", back_populates="quotation_template")
