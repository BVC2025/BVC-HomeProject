from sqlalchemy import (
    Column, String, Integer, Date, DateTime, Text,
    ForeignKey, Index,
    Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from datetime import datetime
import uuid


def utc_now() -> datetime:
    """UTC timestamp default for Customer Master timestamps."""
    return datetime.utcnow()


# NOTE: ASSIGNMENT_MODE_ENUM already exists in app.models.models, but is
# redefined here (identical name/values) rather than imported, because
# models.py imports THIS module before it defines ASSIGNMENT_MODE_ENUM
# itself — importing it back from models.py would be a circular import.
# MySQL has no global named-enum-type concept (SAEnum(create_constraint=True)
# renders as an inline column type at each site), so two independent
# SAEnum objects with the same name/values are DB-safe and produce
# identical DDL. Mirrors the same, pre-existing pattern in project_models.py
# (DURATION_UNIT_ENUM).
ASSIGNMENT_MODE_ENUM = SAEnum(
    "PARALLEL", "SEQUENTIAL",
    name="assignment_mode_enum", create_constraint=True
)

PROJECT_STATUS_ENUM = SAEnum(
    "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED",
    name="project_status_enum", create_constraint=True
)


class Customer(Base):
    """
    Customer master — simplified to a fixed core identity/contact/tax
    columns. Anything vendor-specific beyond this core set is managed
    through the generic Custom Field Configuration system
    (CustomField / CustomFieldTableValue) rather than more fixed
    columns here.
    """

    __tablename__ = "customer"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False)

    NAME = Column(String(100), nullable=False)

    COMPANY_NAME = Column(String(100), nullable=True)

    PHONE_NUMBER = Column(String(20), nullable=False)

    EMAIL = Column(String(100), nullable=False)

    ADDRESS = Column(String(255), nullable=False)

    GST_NUMBER = Column(String(50), nullable=True)

    CITY = Column(String(120), nullable=True)

    STATE = Column(String(120), nullable=True)

    PINCODE = Column(String(15), nullable=True)

    COUNTRY_ISO = Column(String(5), nullable=True)

    CREATED_AT = Column(DateTime, default=utc_now)

    UPDATED_AT = Column(DateTime, default=utc_now, onupdate=utc_now)

    vendor_info = relationship("Vendor", back_populates="customer_info")
    project_assignments = relationship("CustomerProjectAssignment", back_populates="customer")


class CustomerProjectAssignment(Base):
    """Records a Lead's conversion outcome: which Customer ended up
    assigned to which Project, and (if applicable) which Lead drove
    that conversion. Distinct from the legacy CustomerProject
    (table project_legacy) — that one was removed entirely (see the
    Lead-to-Customer-conversion feature's follow-up cleanup); this
    table's PROJECT_ID points at the catalog `project` table
    (project_models.Project), not project_legacy."""

    __tablename__ = "customer_project_assignment"

    __table_args__ = (
        Index("ix_cpa_vendor_status", "VENDOR_ID", "STATUS"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)

    CUSTOMER_ID = Column(String(36), ForeignKey("customer.ID", ondelete="CASCADE"), nullable=False, index=True)

    PROJECT_ID = Column(String(36), ForeignKey("project.ID", ondelete="RESTRICT"), nullable=False, index=True)

    # unique=True: at most one assignment row per Lead — the DB-level
    # duplicate-conversion guard (see convert_lead() in lead_management.py).
    # Nullable + unique still permits future non-lead-driven assignments
    # (MySQL treats each NULL as distinct under a unique index).
    LEAD_ID = Column(String(36), ForeignKey("lead.ID", ondelete="SET NULL"), nullable=True, unique=True, index=True)

    ASSIGNMENT_MODE = Column(ASSIGNMENT_MODE_ENUM, nullable=False, default="PARALLEL")

    START_DATE = Column(Date, nullable=True)

    END_DATE = Column(Date, nullable=True)

    STATUS = Column(PROJECT_STATUS_ENUM, nullable=False, default="ASSIGNED")

    CREATED_AT = Column(DateTime, default=utc_now)

    UPDATED_AT = Column(DateTime, default=utc_now, onupdate=utc_now)

    customer = relationship("Customer", back_populates="project_assignments")
