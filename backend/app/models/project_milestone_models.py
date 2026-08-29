"""Common, vendor-level Payment Milestone configuration — replaces the old
per-Project ProjectPaymentMilestone (project_models.py). A vendor configures
one shared ordered list of milestones (e.g. Initial/Middle/Final Payment)
that applies to every Customer Lead Project for that vendor, instead of
configuring it separately per project.

REQUIRED_PAYMENT_PERCENTAGE is INCREMENTAL — the amount due AT that
milestone (Initial 50% + Middle 30% + Final 20% = 100%), not a cumulative
threshold like the old model. Cumulative eligibility for a given milestone
is the sum of REQUIRED_PAYMENT_PERCENTAGE for every active milestone up to
and including it — see payment_milestone_service.cumulative_required_through().
"""

import uuid
from app.utils.datetime_utils import now_ist

from sqlalchemy import (
    Column, String, Integer, ForeignKey, Text, DateTime, Numeric,
    UniqueConstraint, Boolean,
)
from sqlalchemy.orm import relationship
from sqlalchemy import Enum as SAEnum

from app.database.database import Base


class PaymentMilestone(Base):
    """One vendor-wide payment milestone (e.g. "Initial Payment").
    MILESTONE_ORDER drives processing sequence.
    PROJECT_COMPLETION_TRIGGER_PERCENTAGE is when this milestone becomes
    applicable (0 = at project start); REQUIRED_PAYMENT_PERCENTAGE is the
    incremental percentage of total project value due once triggered."""

    __tablename__ = "payment_milestone"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "MILESTONE_ORDER", name="uq_payment_milestone_vendor_order"),
    )

    ID        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    MILESTONE_NAME  = Column(String(100), nullable=False)
    MILESTONE_ORDER = Column(Integer, nullable=False)

    # 0-100, validated in the route. When the customer's project reaches
    # (or exceeds) this completion percentage, the milestone becomes due.
    PROJECT_COMPLETION_TRIGGER_PERCENTAGE = Column(Numeric(5, 2), nullable=False)

    # 1-100, validated in the route. Incremental share of total project
    # value due at this milestone — see module docstring.
    REQUIRED_PAYMENT_PERCENTAGE = Column(Numeric(5, 2), nullable=False)

    DESCRIPTION = Column(Text, nullable=True)
    IS_ACTIVE   = Column(Boolean, nullable=False, default=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="payment_milestones")
    statuses = relationship(
        "CustomerProjectMilestoneStatus", back_populates="milestone",
        cascade="all, delete-orphan"
    )


MILESTONE_REQUEST_STATUS_ENUM = SAEnum(
    "PENDING", "REQUESTED", "COMPLETED",
    name="milestone_request_status_enum", create_constraint=True,
)


class CustomerProjectMilestoneStatus(Base):
    """Per-(CustomerProjectAssignment, PaymentMilestone) request/completion
    state. PaymentMilestone is vendor-wide/shared configuration; this table
    is where one specific customer project's progress against it lives.

    PENDING    — not yet triggered (project hasn't reached the trigger %).
    REQUESTED  — triggered, payment-request email sent, payment still
                 outstanding. The owning assignment is held (STATUS=HOLD)
                 for this reason while any row is REQUESTED.
    COMPLETED  — the cumulative amount due through this milestone has been
                 paid. Terminal — never re-requested (duplicate-request
                 prevention)."""

    __tablename__ = "customer_project_milestone_status"

    __table_args__ = (
        UniqueConstraint("CUSTOMER_PROJECT_ASSIGNMENT_ID", "PAYMENT_MILESTONE_ID", name="uq_cpms_assignment_milestone"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    CUSTOMER_PROJECT_ASSIGNMENT_ID = Column(
        String(36), ForeignKey("customer_project_assignment.ID", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    PAYMENT_MILESTONE_ID = Column(
        String(36), ForeignKey("payment_milestone.ID", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    STATUS       = Column(MILESTONE_REQUEST_STATUS_ENUM, nullable=False, default="PENDING")
    REQUESTED_AT = Column(DateTime, nullable=True)
    COMPLETED_AT = Column(DateTime, nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    assignment = relationship("CustomerProjectAssignment", back_populates="milestone_statuses")
    milestone  = relationship("PaymentMilestone", back_populates="statuses")
