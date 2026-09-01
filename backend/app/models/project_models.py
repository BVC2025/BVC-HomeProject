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
    UniqueConstraint, Boolean, Index, Float,
)
from sqlalchemy.orm import relationship

from sqlalchemy import Enum as SAEnum

from app.database.database import Base

DURATION_UNIT_ENUM = SAEnum(
    "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS",
    name="duration_unit_enum", create_constraint=True,
)

# NOTE: an identically-named/valued "assignment_mode_enum" already exists on
# CustomerProjectAssignment (customer_models.py) — a different concept (how a
# converted Lead's customer is assigned) from this one (how a Project itself
# runs). Redefining the same enum name here is DB-safe and intentional: MySQL
# has no global named-enum-type concept (SAEnum(create_constraint=True)
# renders inline per column), so two independent SAEnum objects with the same
# name/values produce identical DDL at each site. customer_models.py's own
# top-of-file comment documents this exact pattern already.
ASSIGNMENT_MODE_ENUM = SAEnum(
    "PARALLEL", "SEQUENTIAL",
    name="assignment_mode_enum", create_constraint=True,
)

# How many employees of a given Department + Role a TaskTemplateRequirement
# needs, banded by experience — the future Auto Task Assignment engine
# matches employees against these bands rather than a raw years-of-
# experience number.
EXPERIENCE_LEVEL_ENUM = SAEnum(
    "FRESHER", "INTERMEDIATE", "EXPERIENCED",
    name="experience_level_enum", create_constraint=True,
)

# PROJECT: the task is created once for the whole project, regardless of
# quantity. UNIT: the task is created once per project unit/quantity.
# Actively read by task_generation_service.build_schedule_plan(): a
# PROJECT-scope task is scheduled once per project; a UNIT-scope task is
# scheduled once per CustomerProjectAssignment.QUANTITY, each unit
# progressing independently except where they contend for the same
# employees.
TASK_SCOPE_ENUM = SAEnum(
    "PROJECT", "UNIT",
    name="task_scope_enum", create_constraint=True,
)

# Describes how THIS group's own member tasks gate the next task/group in
# sequence — there is no external "depends on another group" concept.
# ALL: every member task of the group must be COMPLETED. ANY: any one
# member task must be COMPLETED. ONE: one specific, user-chosen member task
# (TaskGroup.DEPENDS_ON_TASK_TEMPLATE_ID) must be COMPLETED. Evaluated by
# the pure function task_dependency_service.can_task_start() — see that
# module's docstring for why this is a pure function rather than a live
# engine today. Lives on TaskGroup (not TaskTemplate) — dependency/grouping
# configuration is a project-level, group-scoped concept.
DEPENDENCY_RULE_ENUM = SAEnum(
    "ALL", "ANY", "ONE",
    name="dependency_rule_enum", create_constraint=True,
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

    # Business logic driven by this field will be added in a later phase;
    # for now it is only stored and surfaced in the Project forms.
    ASSIGNMENT_MODE = Column(ASSIGNMENT_MODE_ENUM, default="PARALLEL", nullable=False)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    category       = relationship("ProjectCategory", back_populates="projects")
    task_templates = relationship(
        "TaskTemplate", back_populates="project",
        order_by="TaskTemplate.SEQUENCE_NUMBER",
        cascade="all, delete-orphan"
    )
    task_groups = relationship(
        "TaskGroup", back_populates="project",
        order_by="TaskGroup.SEQUENCE_NUMBER",
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
    product_requirements = relationship(
        "ProjectProductRequirement", back_populates="project",
        cascade="all, delete-orphan"
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


class ProjectProductRequirement(Base):
    """Which inventory products (ProductMaster rows) a project needs, and
    how many of each — one row per unit of PROJECT_ID's Quantity=1
    baseline. Consumed automatically (multiplied by the winning
    CustomerProjectAssignment.QUANTITY) once production starts — see
    inventory_consumption_service.consume_stock_for_assignment(),
    called from production_scheduling_service.approve_schedule()/
    reject_and_reschedule()."""

    __tablename__ = "project_product_requirement"

    __table_args__ = (
        UniqueConstraint("PROJECT_ID", "PRODUCT_ID", name="uq_proj_product_req_project_product"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    PROJECT_ID = Column(String(36), ForeignKey("project.ID", ondelete="CASCADE"), nullable=False, index=True)
    VENDOR_ID  = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)
    PRODUCT_ID = Column(String(36), ForeignKey("product_master.ID", ondelete="RESTRICT"), nullable=False, index=True)

    REQUIRED_QTY = Column(Float, nullable=False, default=1.0)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    project = relationship("Project", back_populates="product_requirements")
    product = relationship("ProductMaster")


class TaskTemplate(Base):
    """A single task can need several manpower combinations (e.g. 1
    Experienced Supervisor + 2 Intermediate Technicians), so Department/
    Role/Experience/Count live on the child TaskTemplateRequirement rows
    below rather than directly on this row — see `requirements`."""

    __tablename__ = "task_template"

    ID              = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    PROJECT_ID      = Column(String(36), ForeignKey("project.ID", ondelete="RESTRICT"), nullable=False, index=True)
    VENDOR_ID       = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)
    NAME            = Column(String(100), nullable=False)
    DESCRIPTION     = Column(Text, nullable=True)
    DURATION_VALUE  = Column(Numeric(7, 2), default=1.0, nullable=False)
    DURATION_UNIT   = Column(DURATION_UNIT_ENUM, default="DAYS", nullable=False)
    SEQUENCE_NUMBER = Column(Integer, nullable=False, default=0)

    TASK_SCOPE      = Column(TASK_SCOPE_ENUM, default="PROJECT", nullable=False)

    # Real FK to a first-class TaskGroup row — replaces the old
    # EXECUTION_GROUP_ID (a loose, unconstrained shared string with no
    # backing table). NULL = not grouped, runs independently. A single
    # scalar FK naturally enforces "a task belongs to at most one group."
    # Deleting the group sets this back to NULL (see TaskGroup) — the task
    # template itself is never deleted by a group operation.
    TASK_GROUP_ID = Column(
        String(36),
        ForeignKey("task_group.ID", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    CREATED_AT      = Column(DateTime, default=now_ist)
    UPDATED_AT      = Column(DateTime, default=now_ist, onupdate=now_ist)

    project      = relationship("Project", back_populates="task_templates")
    requirements = relationship(
        "TaskTemplateRequirement", back_populates="task_template",
        cascade="all, delete-orphan"
    )
    task_group = relationship(
        "TaskGroup", foreign_keys=[TASK_GROUP_ID], back_populates="task_templates"
    )


class TaskTemplateRequirement(Base):
    """One Department + Role + Experience Level + Required Count manpower
    need under a TaskTemplate. A task with multiple requirements (e.g.
    Supervisor + Technician + Helper) is one TaskTemplate with several of
    these rows, not several TaskTemplates. Deliberately no FRESHER_COUNT/
    INTERMEDIATE_COUNT/EXPERIENCED_COUNT-style fixed columns — every
    combination is its own row so the set stays open-ended. This is also
    the shape the future Auto Task Assignment engine reads: find
    REQUIRED_COUNT employees matching DEPARTMENT_ID + ROLE_ID +
    EXPERIENCE_LEVEL."""

    __tablename__ = "task_template_requirement"

    ID               = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    TASK_TEMPLATE_ID = Column(String(36), ForeignKey("task_template.ID", ondelete="CASCADE"), nullable=False, index=True)

    DEPARTMENT_ID    = Column(Integer, ForeignKey("department.ID", ondelete="SET NULL"), nullable=True, index=True)
    ROLE_ID          = Column(Integer, ForeignKey("role.ID",       ondelete="SET NULL"), nullable=True, index=True)
    EXPERIENCE_LEVEL = Column(EXPERIENCE_LEVEL_ENUM, nullable=False)
    REQUIRED_COUNT   = Column(Integer, nullable=False, default=1)

    CREATED_AT       = Column(DateTime, default=now_ist)
    UPDATED_AT       = Column(DateTime, default=now_ist, onupdate=now_ist)

    task_template = relationship("TaskTemplate", back_populates="requirements")
    department    = relationship("Department", foreign_keys=[DEPARTMENT_ID])
    role          = relationship("Role",       foreign_keys=[ROLE_ID])


class TaskGroup(Base):
    """A first-class, named set of TaskTemplate rows (in the SAME project)
    that are eligible to run in parallel — the "Task Group" configuration
    unit. Replaces the old EXECUTION_GROUP_ID loose-string approach:
    membership is now a real FK on TaskTemplate.TASK_GROUP_ID rather than an
    arbitrary shared value with no backing row.

    DEPENDENCY_RULE (ALL/ANY/ONE) describes how this group's OWN member
    tasks gate the next task/group in sequence — there is no external
    "depends on another group" concept:
      - ALL: every member task must be COMPLETED.
      - ANY: any one member task must be COMPLETED.
      - ONE: the one specific member task named by
        DEPENDS_ON_TASK_TEMPLATE_ID must be COMPLETED.
    DEPENDS_ON_TASK_TEMPLATE_ID is therefore always one of this group's own
    `task_templates` (validated in project_template.py) and is NULL
    whenever DEPENDENCY_RULE is ALL/ANY. See task_dependency_service.py
    for the (still-unwired, pure) rule-evaluation function."""

    __tablename__ = "task_group"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    PROJECT_ID = Column(String(36), ForeignKey("project.ID", ondelete="CASCADE"), nullable=False, index=True)
    VENDOR_ID  = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    # Optional custom label — the frontend falls back to a computed
    # "Group N" (by creation/SEQUENCE_NUMBER order) when this is blank.
    NAME = Column(String(100), nullable=True)

    DEPENDENCY_RULE = Column(DEPENDENCY_RULE_ENUM, default="ALL", nullable=False)

    # Only meaningful (non-NULL) when DEPENDENCY_RULE == "ONE" — the single
    # member task whose completion gates the next task/group in sequence.
    # ON DELETE SET NULL: if that task template is ever deleted, this just
    # reverts to no explicit trigger rather than blocking the delete.
    DEPENDS_ON_TASK_TEMPLATE_ID = Column(
        String(36),
        ForeignKey("task_template.ID", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    SEQUENCE_NUMBER = Column(Integer, nullable=False, default=0)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    project = relationship("Project", back_populates="task_groups")
    task_templates = relationship(
        "TaskTemplate", back_populates="task_group",
        order_by="TaskTemplate.SEQUENCE_NUMBER",
        foreign_keys="TaskTemplate.TASK_GROUP_ID",
    )
    depends_on_task_template = relationship(
        "TaskTemplate", foreign_keys=[DEPENDS_ON_TASK_TEMPLATE_ID]
    )


# NOTE: TaskGroupDependency (table `task_group_dependency`) was removed
# here — it modeled an external "this group depends on an arbitrary task"
# edge with cross-group cycle detection, which turned out not to match the
# real requirement: a group's dependency can only ever be one of its own
# member tasks (see TaskGroup.DEPENDS_ON_TASK_TEMPLATE_ID above), which
# needs no child table and no cycle detection at all. The physical
# `task_group_dependency` table is deliberately left untouched in the
# database (not dropped, though it holds no rows) — same convention as
# TaskTemplateDependency/ProjectPaymentMilestone below.

# NOTE: TaskTemplateDependency (table `task_template_dependency`) was
# removed here — dependency/grouping configuration is now a project-level,
# group-scoped concept (see TaskGroup above) rather than a per-TaskTemplate
# edge. The physical `task_template_dependency` table and its data are
# deliberately left untouched in the database (not dropped) — see
# main.py's _migrate_backfill_task_groups_from_execution_groups() for the
# one-time, best-effort migration of any existing per-task grouping/
# dependency configuration into the new TaskGroup table.


# NOTE: ProjectPaymentMilestone (table `project_payment_milestone`) was
# removed here — Payment Milestones are now a common, vendor-level
# configuration (see app/models/project_milestone_models.py's
# PaymentMilestone) rather than a per-Project child list. The physical
# `project_payment_milestone` table and its data are deliberately left
# untouched in the database (not dropped) — see main.py's
# _migrate_seed_payment_milestones_from_legacy() for the one-time,
# best-effort migration of any existing per-project configuration into
# the new vendor-level table.
