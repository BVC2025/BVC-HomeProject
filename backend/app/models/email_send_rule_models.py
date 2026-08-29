"""Email Send Rule — configures which employees get an internal
notification email for a given business event (a customer approving/
rejecting a Final or Revised Quotation, or a Purchase Order being
uploaded/reuploaded by a customer or by staff on their behalf). Recipients
are always concrete Employees, or the dynamic "Lead Owner" placeholder
(resolved to whichever employee currently owns the specific Lead at send
time — never stored as a fixed employee). See
email_send_rule_service.resolve_recipients() for the resolution/dedup
logic."""

from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime,
    ForeignKey, UniqueConstraint,
    Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from app.utils.datetime_utils import now_ist
import uuid

EMAIL_SEND_RULE_EVENT_ENUM = SAEnum(
    "QUOTATION_DECISION",  # "Customer Quotation Approval / Rejection" — Final/Revised, Approved/Rejected
    "PO_UPLOADED",         # "Purchase Order Uploaded / Reuploaded" — by customer or staff
    "PO_REQUESTED",        # "Purchase Order Requested / Re-requested" — auto-on-approval or manual
    name="email_send_rule_event_enum", create_constraint=True,
)


class EmailSendRule(Base):
    __tablename__ = "email_send_rule"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "EVENT_TYPE", name="uq_esr_vendor_event"),
    )

    ID        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)
    EVENT_TYPE = Column(EMAIL_SEND_RULE_EVENT_ENUM, nullable=False)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    recipients = relationship(
        "EmailSendRuleRecipient", back_populates="rule",
        cascade="all, delete-orphan", passive_deletes=True,
    )


class EmailSendRuleRecipient(Base):
    """One row per recipient. EMPLOYEE_ID set = a concrete employee.
    IS_LEAD_OWNER=True (EMPLOYEE_ID NULL) = the dynamic "Lead Owner"
    placeholder — resolved per-lead at send time, never a fixed employee.
    At most one IS_LEAD_OWNER row per rule is enforced at the application
    layer (the PUT-replace endpoint dedupes before insert) since a
    nullable-EMPLOYEE_ID unique index can't catch two NULLs in MySQL."""

    __tablename__ = "email_send_rule_recipient"

    __table_args__ = (
        UniqueConstraint("RULE_ID", "EMPLOYEE_ID", name="uq_esrr_rule_employee"),
    )

    ID      = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    RULE_ID = Column(String(36), ForeignKey("email_send_rule.ID", ondelete="CASCADE"), nullable=False, index=True)
    EMPLOYEE_ID  = Column(String(36), ForeignKey("employee.ID", ondelete="CASCADE"), nullable=True, index=True)
    IS_LEAD_OWNER = Column(Boolean, nullable=False, default=False)

    CREATED_AT = Column(DateTime, default=now_ist)

    rule = relationship("EmailSendRule", back_populates="recipients")
