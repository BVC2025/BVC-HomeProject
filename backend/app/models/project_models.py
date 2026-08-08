"""
Project Management SQLAlchemy models.

Moved from app/models/models.py for cleaner module organisation.
Table names, columns, constraints, indexes, relationships, and FK rules
are identical to the original definitions — zero schema change.

DURATION_UNIT_ENUM is imported from models.py (defined at line ~24 there)
rather than redefined, so there is exactly one SAEnum object per type name
in the shared Base.metadata.
"""

import uuid
from app.utils.datetime_utils import now_ist

from sqlalchemy import (
    Column, String, Integer, ForeignKey, Text, DateTime, Numeric,
    UniqueConstraint, Boolean, Index,
)
from sqlalchemy.orm import relationship

from sqlalchemy import Enum as SAEnum

from app.database.database import Base

DURATION_UNIT_ENUM = SAEnum(
    "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS",
    name="duration_unit_enum", create_constraint=True,
)


class ProjectCategory(Base):

    __tablename__ = "project_category"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "NAME", name="uq_proj_cat_vendor_name"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    NAME = Column(String(100), nullable=False)

    DESCRIPTION = Column(String(500), nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    projects = relationship("Project", back_populates="category", cascade="all, delete-orphan")


class Project(Base):

    __tablename__ = "project"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "CATEGORY_ID", "NAME", name="uq_project_vendor_cat_name"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    CATEGORY_ID = Column(
        String(36),
        ForeignKey("project_category.ID", ondelete="RESTRICT"),
        nullable=False,
        index=True
    )

    NAME = Column(String(100), nullable=False)

    DESCRIPTION = Column(String(500), nullable=True)

    BOM_MODE = Column(String(20), nullable=True)

    ESTIMATED_TOTAL_DAYS = Column(Numeric(10, 2), default=0.0, nullable=False)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    category       = relationship("ProjectCategory", back_populates="projects")
    task_templates = relationship(
        "TaskTemplate", back_populates="project",
        order_by="TaskTemplate.SEQUENCE_NUMBER",
        cascade="all, delete-orphan"
    )
    quotation_template = relationship(
        "ProjectQuotationTemplate", back_populates="project",
        uselist=False, cascade="all, delete-orphan"
    )
    pricing = relationship(
        "ProjectPricing", back_populates="project",
        uselist=False, cascade="all, delete-orphan"
    )


class ProjectPricing(Base):

    __tablename__ = "project_pricing"

    __table_args__ = (
        UniqueConstraint("PROJECT_ID", name="uq_project_pricing_project"),
        Index("ix_project_pricing_vendor", "VENDOR_ID"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    PROJECT_ID = Column(String(36), ForeignKey("project.ID", ondelete="CASCADE"), nullable=False, index=True)
    VENDOR_ID  = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    # Plain string, no ENUM — matches supplier_models.py's Supplier.CURRENCY convention.
    CURRENCY = Column(String(5), nullable=False, default="INR")

    ORIGINAL_PRICE            = Column(Numeric(14, 2), nullable=False, default=0)
    MINIMUM_NEGOTIATION_PRICE = Column(Numeric(14, 2), nullable=True)
    NEGOTIATION_PERCENT       = Column(Numeric(5, 2), nullable=True)
    PACKING_CHARGE            = Column(Numeric(14, 2), nullable=False, default=0)
    TRANSPORTATION_CHARGE     = Column(Numeric(14, 2), nullable=False, default=0)
    INSTALLATION_CHARGE       = Column(Numeric(14, 2), nullable=False, default=0)
    SERVICE_CHARGE            = Column(Numeric(14, 2), nullable=False, default=0)
    ADDITIONAL_CHARGES        = Column(Numeric(14, 2), nullable=False, default=0)
    TAX_AMOUNT                = Column(Numeric(14, 2), nullable=False, default=0)
    DISCOUNT_AMOUNT           = Column(Numeric(14, 2), nullable=False, default=0)
    FINAL_PRICE               = Column(Numeric(14, 2), nullable=False, default=0)  # server-computed only

    REMARKS   = Column(Text, nullable=True)
    IS_ACTIVE = Column(Boolean, nullable=False, default=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    project = relationship("Project", back_populates="pricing")


class TaskTemplate(Base):
    __tablename__ = "task_template"

    ID              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    PROJECT_ID      = Column(String(36), ForeignKey("project.ID", ondelete="RESTRICT"), nullable=False, index=True)
    VENDOR_ID       = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)
    NAME            = Column(String(100), nullable=False)
    DESCRIPTION     = Column(Text, nullable=True)
    DURATION_VALUE  = Column(Numeric(7, 2), default=1.0, nullable=False)
    DURATION_UNIT   = Column(DURATION_UNIT_ENUM, default="DAYS", nullable=False)
    SEQUENCE_NUMBER = Column(Integer, nullable=False, default=0)
    DEPARTMENT_ID   = Column(Integer, ForeignKey("department.ID", ondelete="SET NULL"), nullable=True, index=True)
    ROLE_ID         = Column(Integer, ForeignKey("role.ID",       ondelete="SET NULL"), nullable=True, index=True)
    CREATED_AT      = Column(DateTime, default=now_ist)
    UPDATED_AT      = Column(DateTime, default=now_ist, onupdate=now_ist)

    project    = relationship("Project", back_populates="task_templates")
    department = relationship("Department", foreign_keys=[DEPARTMENT_ID])
    role       = relationship("Role",       foreign_keys=[ROLE_ID])
