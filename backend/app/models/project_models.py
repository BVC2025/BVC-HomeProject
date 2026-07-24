"""
Project Management SQLAlchemy models.

This file is a merge target: the ram-development branch redesigned the
project schema (UUID PKs, new columns like NAME/CATEGORY_ID) while
puvi-development's DB still has the original schema (Integer PKs,
PROJECT_NAME/CUSTOMER_ID/DEPARTMENT_ID, plus 77+ places in old routes
that read Project.STATUS, Project.DEPARTMENT_ID etc.).

To keep both universes running against the existing MySQL DB without a
destructive data migration:

  * IDs stay Integer autoincrement (matches DB and every FK column
    already in task/task_assignment/work_order/purchase_order).
  * All original columns are preserved so old routes keep working.
  * The ram-development additions (NAME, CATEGORY_ID, BOM_MODE,
    ESTIMATED_TOTAL_DAYS, CREATED_AT/UPDATED_AT) are appended as
    nullable columns; the auto-migrate hook in app/main.py ALTERs
    the live table to add them.
  * Project.NAME is exposed as a `synonym` of Project.PROJECT_NAME
    so ram-development's `Project.NAME` queries and the legacy
    `Project.PROJECT_NAME` accesses read/write the same DB column.

DURATION_UNIT_ENUM is defined once here so all task-template code shares
a single SAEnum instance in Base.metadata.
"""

import uuid
from app.utils.datetime_utils import now_ist

from sqlalchemy import (
    Column, String, Integer, ForeignKey, Text, DateTime, Numeric,
    UniqueConstraint, Boolean, Index, Date,
)
from sqlalchemy.orm import relationship, synonym

from sqlalchemy import Enum as SAEnum

from app.database.database import Base

DURATION_UNIT_ENUM = SAEnum(
    "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS",
    name="duration_unit_enum", create_constraint=True,
)


class ProjectCategory(Base):

    __tablename__ = "project_category"

    # DB column is INT auto_increment. UNIQUE(VENDOR_ID, NAME) is added
    # lazily by auto-migrate once VENDOR_ID exists on all rows.
    ID = Column(Integer, primary_key=True, autoincrement=True)

    # ram-development columns — nullable so existing rows aren't broken.
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=True, index=True)

    NAME = Column(String(100), nullable=True)

    # SECTION lived on the legacy schema; keep it so legacy reads work.
    SECTION = Column(String(30), nullable=True, index=True)

    DESCRIPTION = Column(String(500), nullable=True)

    CREATED_AT = Column(DateTime, nullable=True, default=now_ist)
    UPDATED_AT = Column(DateTime, nullable=True, default=now_ist, onupdate=now_ist)

    projects = relationship("Project", back_populates="category")


class Project(Base):

    __tablename__ = "project"

    # No cross-column UniqueConstraint here — CATEGORY_ID / NAME may be
    # NULL on legacy rows and MySQL would reject the constraint.

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    # ---------- Original (legacy) columns — still populated by many
    #            routes (ai_chat, chatbot, attendance, biometric, connect,
    #            project, project_template, purchase_order, etc.) ----------
    PROJECT_NAME             = Column(String(200), nullable=True)
    DESCRIPTION              = Column(String(2000), nullable=True)
    STATUS                   = Column(String(50),  nullable=True, default="PENDING")
    SUB_PROJECT_TEMPLATE_ID  = Column(Integer, ForeignKey("sub_project_template.ID"), nullable=True, index=True)
    DEPARTMENT_ID            = Column(Integer, ForeignKey("department.ID"),           nullable=True, index=True)
    CUSTOMER_ID              = Column(Integer, ForeignKey("customer.ID"),             nullable=True)
    SKILLS_REQUIRED          = Column(String(500), nullable=True)
    PRIORITY                 = Column(String(20),  nullable=True, default="MEDIUM")
    PRODUCT_MODEL_ID         = Column(Integer, nullable=True, index=True)
    QUANTITY                 = Column(Integer, nullable=True, default=1)
    TARGET_DATE              = Column(Date,    nullable=True)
    VENDOR_ID                = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=True, index=True)

    # ---------- ram-development additions — nullable so existing rows
    #            (which lack these columns until auto-migrate ALTERs the
    #            table) don't break ----------
    CATEGORY_ID          = Column(Integer, ForeignKey("project_category.ID", ondelete="RESTRICT"), nullable=True, index=True)
    BOM_MODE             = Column(String(20), nullable=True)
    ESTIMATED_TOTAL_DAYS = Column(Numeric(10, 2), nullable=True, default=0.0)

    CREATED_AT = Column(DateTime, nullable=True, default=now_ist)
    UPDATED_AT = Column(DateTime, nullable=True, default=now_ist, onupdate=now_ist)

    # ---------- Attribute alias ----------
    # ram-development's routes (project_template.py, project_quotation_service.py)
    # use `Project.NAME` for what puvi-development already stored as
    # `PROJECT_NAME`. Synonym makes both attribute names read/write the
    # SAME DB column — no data duplication.
    NAME = synonym("PROJECT_NAME")

    # ---------- Relationships ----------
    category       = relationship("ProjectCategory", back_populates="projects", foreign_keys=[CATEGORY_ID])
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

    # New table — no existing data, keep UUID PK.
    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # FK must match project.ID's actual DB type (Integer) or MySQL rejects
    # the constraint (error 3780). This is the root cause of the merge
    # failure that motivated this rewrite.
    PROJECT_ID = Column(Integer, ForeignKey("project.ID", ondelete="CASCADE"), nullable=False, index=True)
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

    # New table — no existing data, keep UUID PK.
    ID              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # FK type matches project.ID (Integer). See ProjectPricing.PROJECT_ID
    # for context.
    PROJECT_ID      = Column(Integer, ForeignKey("project.ID", ondelete="RESTRICT"), nullable=False, index=True)
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
