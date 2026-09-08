from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Text,
    Index, UniqueConstraint, ForeignKey,
    Enum as SAEnum
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from app.utils.datetime_utils import now_ist
import uuid

LEAD_POLL_API_TYPE_ENUM = SAEnum(
    "DATE_RANGE", "DATETIME_RANGE", "LAST_24_HOURS",
    name="lead_poll_api_type_enum", create_constraint=True
)
LEAD_POLL_STATUS_ENUM = SAEnum(
    "PENDING", "SUCCESS", "NO_LEADS", "RATE_LIMITED", "AUTH_FAILED", "ERROR",
    name="lead_poll_status_enum", create_constraint=True
)
LEAD_STATUS_ENUM = SAEnum(
    "NEW", "VIEWED", "CONVERTED", "IGNORED",
    "QUOTE_APPROVAL_PENDING", "QUOTE_APPROVED", "QUOTE_REJECTED",
    "REVISED_QUOTE_APPROVAL_PENDING", "REVISED_QUOTE_APPROVED", "REVISED_QUOTE_REJECTED",
    "PO_REQUESTED", "PO_RECEIVED",
    # Set automatically by the production scheduling engine — never a
    # plain field edit (see lead_management.py's _SYSTEM_ONLY_LEAD_STATUSES).
    # PRODUCTION_SCHEDULE_REQUESTED is set by
    # production_scheduling_service.evaluate_and_propose_schedule() the
    # moment a schedule is proposed (whether triggered automatically by a
    # payment milestone, or manually via the Edit Lead modal's
    # request-production-schedule endpoint) — the lead sits here awaiting
    # staff approval. PRODUCTION_SCHEDULED is set as a side effect of
    # production_scheduling_service.approve_schedule()/
    # reject_and_reschedule() locking in that schedule (staff clicking
    # Approve/Reject-with-a-date on the Production Schedule Approval
    # page); PRODUCTION_STARTED is set automatically by
    # production_reminder_scheduler.py's daily start-date tick once the
    # scheduled production start date actually arrives.
    "PRODUCTION_SCHEDULE_REQUESTED", "PRODUCTION_SCHEDULED", "PRODUCTION_STARTED",
    name="lead_status_enum", create_constraint=True
)
LEAD_SOURCE_ENUM = SAEnum(
    "INDIAMART", "WEBSITE", "MANUAL",
    name="lead_source_enum", create_constraint=True
)
LEAD_CUSTOMER_ASSIGNMENT_TYPE_ENUM = SAEnum(
    "NEW", "EXISTING",
    name="lead_customer_assignment_type_enum", create_constraint=True
)


class LeadPollingConfig(Base):
    """Per-vendor config for a pull-style lead source integration (e.g. IndiaMART's
    Pull API). Stores credentials/URLs/polling cadence — not the leads themselves."""

    __tablename__ = "lead_polling_config"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "ACCOUNT_LABEL", "API_TYPE", name="uq_lpc_vendor_label_type"),
        Index("ix_lpc_vendor_active", "VENDOR_ID", "IS_ACTIVE"),
        Index("ix_lpc_last_synced",   "LAST_SYNCED_AT"),
        Index("ix_lpc_created_at",    "CREATED_AT"),
    )

    ID        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    ACCOUNT_LABEL   = Column(String(150), nullable=False)
    PLATFORM_NAME   = Column(String(50),  nullable=False, default="IndiaMART")
    BASE_URL        = Column(String(500), nullable=False, default="https://mapi.indiamart.com/")
    ENDPOINT_URL    = Column(String(500), nullable=False, default="wservce/crm/crmListing/v2/")
    PULL_API_KEY    = Column(String(500), nullable=False)  # plain-text; masked in all read responses
    API_TYPE        = Column(LEAD_POLL_API_TYPE_ENUM, nullable=False, default="LAST_24_HOURS")
    API_DESCRIPTION = Column(String(500), nullable=True)
    IS_ACTIVE       = Column(Boolean, nullable=False, default=False)

    POLL_INTERVAL_MINUTES = Column(Integer, nullable=False, default=5)
    # Enforced >= 5 in the route/schema layer (IndiaMART's own rate-limit floor).

    LAST_SYNCED_AT      = Column(DateTime, nullable=True)
    LAST_SYNC_STATUS    = Column(LEAD_POLL_STATUS_ENUM, nullable=True, default="PENDING")
    LAST_SYNC_MESSAGE   = Column(String(500), nullable=True)
    LAST_LEAD_COUNT     = Column(Integer, nullable=True, default=0)
    CONSECUTIVE_FAILURES = Column(Integer, nullable=False, default=0)

    CREATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    UPDATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="lead_polling_configs")


class Lead(Base):
    """Generic lead record — stores leads regardless of where they came from
    (IndiaMART Pull API, a future company-website integration, or manual entry
    by sales staff). Deliberately has NO link to LeadPollingConfig: a lead's
    origin is captured only via LEAD_SOURCE, so it survives config changes/
    deletion and stays meaningful for manually-created and website leads too."""

    __tablename__ = "lead"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "EXTERNAL_REFERENCE_ID", name="uq_lead_vendor_extref"),
        Index("ix_lead_vendor_source", "VENDOR_ID", "LEAD_SOURCE"),
        Index("ix_lead_vendor_status", "VENDOR_ID", "LEAD_STATUS"),
        Index("ix_lead_vendor_enqtype", "VENDOR_ID", "ENQUIRY_TYPE"),
        Index("ix_lead_enq_time",    "ENQUIRY_TIME"),
        Index("ix_lead_assigned",   "ASSIGNED_TO_ID"),
        Index("ix_lead_created",    "CREATED_AT"),
        Index("ix_lead_mobile",     "CONTACT_MOBILE"),
        Index("ix_lead_email",      "CONTACT_EMAIL"),
    )

    ID        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    LEAD_SOURCE = Column(LEAD_SOURCE_ENUM, nullable=False)  # no default — every insert path sets it explicitly

    CREATED_BY_ID  = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    ASSIGNED_TO_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True, index=True)

    EXTERNAL_REFERENCE_ID = Column(String(64), nullable=True)  # source's own dedup key (e.g. IndiaMART's UNIQUE_QUERY_ID); null for manual/website leads
    ENQUIRY_TYPE          = Column(String(10), nullable=True)  # e.g. IndiaMART's W/B/P/BIZ/WA — plain string, open value set
    ENQUIRY_TIME          = Column(DateTime, nullable=True)

    CONTACT_NAME    = Column(String(200), nullable=True)
    CONTACT_MOBILE  = Column(String(30),  nullable=True, index=True)
    CONTACT_EMAIL   = Column(String(200), nullable=True, index=True)
    COMPANY_NAME    = Column(String(255), nullable=True)
    ADDRESS         = Column(String(500), nullable=True)
    CITY            = Column(String(120), nullable=True)
    STATE           = Column(String(120), nullable=True)
    PINCODE         = Column(String(15),  nullable=True)
    COUNTRY_ISO     = Column(String(5),   nullable=True)
    LEAD_MESSAGE    = Column(Text, nullable=True)
    PRODUCT_INTEREST = Column(String(500), nullable=True)

    # --- Lead-to-Customer conversion linkage (nullable: only populated
    # once a project is picked / a customer path is chosen; pre-existing
    # leads created before this feature stay NULL on all four). PROJECT_ID
    # points at the catalog `project` table (see project_models.Project) —
    # the same one already used by the Add/Edit Lead modal's Category ->
    # Product cascade, which now persists the picked project's real ID
    # here instead of only its name (still written into PRODUCT_INTEREST
    # above for backward compatibility). CUSTOMER_ID/CUSTOMER_ASSIGNMENT_TYPE
    # are set either at lead-creation time (Existing Customer picked, or
    # New Customer chosen) or later at conversion time as a fallback for
    # leads created before this feature existed. ---
    PROJECT_ID  = Column(String(36), ForeignKey("project.ID",  ondelete="SET NULL"), nullable=True, index=True)
    CUSTOMER_ID = Column(String(36), ForeignKey("customer.ID", ondelete="SET NULL"), nullable=True, index=True)
    CUSTOMER_ASSIGNMENT_TYPE = Column(LEAD_CUSTOMER_ASSIGNMENT_TYPE_ENUM, nullable=True)
    GST_NUMBER  = Column(String(50), nullable=True)

    RAW_SOURCE_PAYLOAD = Column(Text, nullable=True)  # full JSON of the source lead, forward-compat
    LEAD_STATUS        = Column(LEAD_STATUS_ENUM, nullable=False, default="NEW")
    SOURCE_FETCHED_AT  = Column(DateTime, nullable=True)  # when an automated sync captured it; null for manual leads

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="leads")


class LeadModuleSetting(Base):
    """Per-vendor Lead Management automation settings that aren't part of
    the WhatsApp module settings (WhatsAppModuleSetting, module_code=
    "lead_module") — kept as its own small table rather than adding an
    unrelated email-automation flag there, since that table's name/purpose
    is specifically WhatsApp. Singleton per vendor, get-or-create-on-read,
    matching WhatsAppModuleSetting's own convention."""

    __tablename__ = "lead_module_setting"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", name="uq_lms_vendor"),
    )

    ID        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False)

    # Whether approving a Final/Revised Quotation automatically emails the
    # customer a Purchase Order Request. When False/unconfigured, sending
    # is manual only (see the "Send Purchase Order Request" lead action).
    AUTO_SEND_PO_REQUEST_ENABLED = Column(Boolean, nullable=False, default=False)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)


class LeadPollingLog(Base):
    """Append-only audit of every polling attempt against a LeadPollingConfig —
    success or failure. Rows are NEVER updated after insert (matches
    SupplierApprovalLog's append-only convention) and are truncated wholesale
    twice daily by the scheduler (see backend/app/scheduler.py)."""

    __tablename__ = "lead_polling_log"

    __table_args__ = (
        Index("ix_lpl_vendor",    "VENDOR_ID"),
        Index("ix_lpl_config",    "CONFIG_ID"),
        Index("ix_lpl_status",    "STATUS"),
        Index("ix_lpl_poll_time", "POLL_TIME"),
    )

    ID        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)
    CONFIG_ID = Column(
        String(36),
        ForeignKey("lead_polling_config.ID", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )  # bare FK, no relationship — a log row must survive config deletion

    POLL_TIME = Column(DateTime, nullable=False, default=now_ist)
    API_TYPE  = Column(String(30), nullable=True)  # snapshot of the type used for this attempt
    STATUS    = Column(LEAD_POLL_STATUS_ENUM, nullable=False)

    ERROR_MESSAGE    = Column(String(500), nullable=True)
    ERROR_DETAILS    = Column(Text, nullable=True)
    RESPONSE_DETAILS = Column(Text, nullable=True)

    DURATION_MS = Column(Integer, nullable=True)
    LEAD_COUNT  = Column(Integer, nullable=False, default=0)  # leads retrieved that attempt

    CREATED_AT = Column(DateTime, default=now_ist)

    vendor = relationship("Vendor", back_populates="lead_polling_logs")
