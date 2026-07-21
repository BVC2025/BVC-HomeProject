from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Index, UniqueConstraint, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from app.utils.datetime_utils import now_ist
import uuid


class VendorEmailConfig(Base):
    __tablename__ = "vendor_email_config"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "FROM_EMAIL", name="uq_vec_vendor_from_email"),
        Index("ix_vec_vendor_active", "VENDOR_ID", "IS_ACTIVE"),
        Index("ix_vec_from_email",    "FROM_EMAIL"),
        Index("ix_vec_created_at",    "CREATED_AT"),
    )

    ID            = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID     = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    SMTP_HOST     = Column(String(200), nullable=False)
    SMTP_PORT     = Column(Integer,     nullable=False, default=587)
    SMTP_USERNAME = Column(String(200), nullable=False)
    SMTP_PASSWORD = Column(String(500), nullable=False)  # plain-text; masked in all read responses
    FROM_NAME     = Column(String(200), nullable=False)
    FROM_EMAIL    = Column(String(200), nullable=False)
    BCC_NAME      = Column(String(200), nullable=True)
    BCC_EMAIL     = Column(String(200), nullable=True)
    IS_ACTIVE     = Column(Boolean,     nullable=False, default=False)

    CREATED_AT    = Column(DateTime, default=now_ist)
    UPDATED_AT    = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="email_configurations")


class EmailTemplate(Base):
    __tablename__ = "email_template"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "TEMPLATE_TYPE", name="uq_et_vendor_type"),
        Index("ix_et_vendor_id", "VENDOR_ID"),
    )

    ID            = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID     = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)
    TEMPLATE_TYPE = Column(String(100), nullable=False)
    DISPLAY_NAME  = Column(String(200), nullable=False)
    SUBJECT       = Column(String(500), nullable=False)
    BODY_HTML     = Column(Text,        nullable=False)
    DESIGN_JSON   = Column(Text,        nullable=True)
    CREATED_AT    = Column(DateTime, default=now_ist)
    UPDATED_AT    = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="email_templates")
