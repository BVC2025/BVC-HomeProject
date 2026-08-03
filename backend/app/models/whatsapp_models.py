"""WhatsApp Cloud API integration models — a generic, ERP-wide communication
layer. Two tiers, deliberately separated:

  1. VendorWhatsAppConfig — the Meta connection itself (credentials, webhook,
     rate limits). ONE row per vendor, shared by every ERP module.
  2. WhatsAppModuleSetting — per-module automation behavior (welcome/
     re-engagement templates, AI-reply toggle, supported languages). ONE row
     per (vendor, module_code) — Lead Management's row uses
     MODULE_CODE="lead_module"; a future Sales/Support/CRM module adds its
     own row with its own templates, with ZERO schema change to either table.

WhatsAppConversation/WhatsAppMessage reference their originating record via
a generic (MODULE_CODE, SOURCE_RECORD_ID) pair rather than a hardcoded FK to
any one business table — SOURCE_RECORD_ID deliberately has no foreign key
(a polymorphic reference can't have one): for MODULE_CODE="lead_module" it
holds a Lead.ID; a future module would store its own entity's ID there. Lead
itself is untouched by this feature (no FK added to it, no columns added to
it) — a conversation/message can exist even before (or without) a matching
Lead.

Secrets on VendorWhatsAppConfig (ACCESS_TOKEN, APP_SECRET) are Fernet-
encrypted at rest via app.utils.crypto_utils — a deliberate, scoped deviation
from this codebase's usual "plain-text; masked in all read responses"
convention (see LeadPollingConfig.PULL_API_KEY, VendorEmailConfig.
SMTP_PASSWORD), because these specific values grant send-as-business
capability on a real WhatsApp Business Account. VERIFY_TOKEN stays
plain-text: it is a value *we* generate and must hand to Meta's dashboard
verbatim, not a Meta-issued secret."""

from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Text, Numeric,
    Index, UniqueConstraint, ForeignKey,
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from app.utils.datetime_utils import now_ist
import uuid


class VendorWhatsAppConfig(Base):
    """Per-vendor Meta WhatsApp Cloud API configuration. Replaces the need for
    any WhatsApp-related .env variable — every vendor plugs in their own
    WhatsApp Business Account once from the settings page (System ->
    WhatsApp Configuration), and every ERP module that sends or receives
    WhatsApp messages (today: Lead Management; in the future: Sales, CRM,
    Support, Marketing, ...) reuses this exact same row — there is no
    per-module WhatsApp config anywhere else in the codebase, by design.
    Structurally mirrors LeadPollingConfig/VendorEmailConfig, which are
    likewise one config shared across many otherwise-unrelated modules
    (see services/email_service.py's callers for that precedent)."""

    __tablename__ = "vendor_whatsapp_config"

    __table_args__ = (
        UniqueConstraint("PHONE_NUMBER_ID", name="uq_vwac_phone_number_id"),
        UniqueConstraint("VERIFY_TOKEN", name="uq_vwac_verify_token"),
        UniqueConstraint("VENDOR_ID", "ACCOUNT_LABEL", name="uq_vwac_vendor_label"),
        Index("ix_vwac_vendor_active", "VENDOR_ID", "IS_ACTIVE"),
        Index("ix_vwac_health", "HEALTH_STATUS"),
        Index("ix_vwac_created_at", "CREATED_AT"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)

    ACCOUNT_LABEL         = Column(String(150), nullable=False)
    BUSINESS_DISPLAY_NAME = Column(String(200), nullable=True)   # auto-filled by test-connection
    BUSINESS_PHONE_NUMBER = Column(String(30),  nullable=True)   # auto-filled by test-connection

    PHONE_NUMBER_ID = Column(String(64), nullable=False)  # webhook routing key
    WABA_ID         = Column(String(64), nullable=False)
    APP_ID          = Column(String(64), nullable=True)

    APP_SECRET   = Column(Text, nullable=True)   # Fernet-encrypted at rest (crypto_utils); masked in all read responses
    ACCESS_TOKEN = Column(Text, nullable=False)  # Fernet-encrypted at rest (crypto_utils); masked in all read responses
    ACCESS_TOKEN_FINGERPRINT = Column(String(16), nullable=True)  # sha256(plaintext)[:8] — confirms identity without decrypting
    TOKEN_EXPIRES_AT = Column(DateTime, nullable=True)  # NULL = permanent system-user token

    VERIFY_TOKEN = Column(String(200), nullable=False)  # our own shared secret — plain-text, shown in full to the admin

    API_BASE_URL       = Column(String(200), nullable=False, default="https://graph.facebook.com")
    GRAPH_API_VERSION  = Column(String(10),  nullable=False, default="v21.0")
    WEBHOOK_CALLBACK_URL = Column(String(500), nullable=True)  # display/copy convenience only
    WEBHOOK_ENABLED    = Column(Boolean, nullable=False, default=False)
    DEFAULT_COUNTRY_CODE = Column(String(5), nullable=False, default="91")
    DEFAULT_LANGUAGE     = Column(String(10), nullable=False, default="en")
    # Fallback language code used before any module-specific language
    # selection happens. Per-module template/behavior config — including
    # which languages a module's welcome flow offers — lives on
    # WhatsAppModuleSetting below, not here (this table is the Meta
    # connection only, shared by every module).

    MAX_SEND_PER_SECOND = Column(Integer, nullable=False, default=8)     # Meta tier ~80/s; kept conservative
    DAILY_SEND_CAP      = Column(Integer, nullable=False, default=900)   # under the 1,000/24h unverified-business tier

    HEALTH_STATUS        = Column(String(30), nullable=False, default="UNKNOWN")
    # UNKNOWN|HEALTHY|AUTH_FAILED|RATE_LIMITED|TEMPLATE_MISSING|ENCRYPTION_KEY_MISSING|DAILY_CAP_REACHED|AI_MODULE_INACTIVE|ERROR
    LAST_ERROR_CODE      = Column(String(30),  nullable=True)
    LAST_ERROR_MESSAGE   = Column(String(500), nullable=True)
    LAST_ERROR_AT        = Column(DateTime, nullable=True)
    LAST_SUCCESS_AT      = Column(DateTime, nullable=True)
    CONSECUTIVE_FAILURES = Column(Integer, nullable=False, default=0)
    PAUSED_UNTIL         = Column(DateTime, nullable=True)  # DB-backed circuit breaker — survives restart

    IS_ACTIVE = Column(Boolean, nullable=False, default=False)  # gates outbound sending (matches LeadPollingConfig default)

    CREATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    UPDATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="whatsapp_configs")


class WhatsAppModuleSetting(Base):
    """Per-vendor, per-module WhatsApp automation behavior — the templates
    and toggles that differ from one ERP module to the next, deliberately
    kept off VendorWhatsAppConfig (which is the shared Meta connection every
    module reuses unchanged). One row per (VENDOR_ID, MODULE_CODE); Lead
    Management's row uses MODULE_CODE="lead_module". A future module
    (Sales, Support, ...) adding its own WhatsApp automation just inserts
    its own row here — no change to this table's schema, no change to
    VendorWhatsAppConfig."""

    __tablename__ = "whatsapp_module_setting"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "MODULE_CODE", name="uq_wms_vendor_module"),
        Index("ix_wms_vendor_enabled", "VENDOR_ID", "IS_ENABLED"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)
    MODULE_CODE = Column(String(50), nullable=False)  # e.g. "lead_module"

    IS_ENABLED = Column(Boolean, nullable=False, default=True)            # this module participates in WhatsApp at all
    AUTO_TRIGGER_ENABLED = Column(Boolean, nullable=False, default=True)  # e.g. auto-send welcome when this module's record is created

    # Meta's 24-hour customer-service-window rule means the welcome message
    # (always first contact) and any reply sent after the window has closed
    # must use a pre-approved template, not free text.
    WELCOME_TEMPLATE_NAME   = Column(String(100), nullable=True)
    WELCOME_TEMPLATE_LANG   = Column(String(15),  nullable=False, default="en_US")
    WELCOME_TEMPLATE_PARAMS = Column(String(500), nullable=True)  # CSV of source-entity column names -> {{1}}..{{n}}
    REENGAGE_TEMPLATE_NAME  = Column(String(100), nullable=True)
    REENGAGE_TEMPLATE_LANG  = Column(String(15),  nullable=False, default="en_US")

    AI_REPLY_ENABLED = Column(Boolean, nullable=False, default=True)

    SUPPORTED_LANGUAGES = Column(String(200), nullable=False, default="en")
    # CSV of language codes this module's welcome flow offers (e.g. "ta,en").
    # Informational/admin-visible only — the language-selection buttons
    # themselves are baked into the approved Meta template at authoring
    # time, not constructed by this code; the AI already mirrors whatever
    # language the customer replies in regardless of this list. Adding a
    # language later is a Meta template update + editing this field, never
    # a code change.

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="whatsapp_module_settings")


class WhatsAppConversation(Base):
    """One row per (vendor, customer WhatsApp number) — holds state that
    belongs to neither the vendor nor a single message: the 24h session-
    window clock, human-takeover toggle, and the lock target for
    concurrency control (SELECT ... FOR UPDATE on this row serializes
    processing per conversation). SOURCE_RECORD_ID is nullable, generic,
    and deliberately has NO foreign key: a conversation can exist before
    (or without) any matched record, and which table it refers to depends
    entirely on MODULE_CODE — for "lead_module" it's a Lead.ID; a future
    module stores its own entity's ID there instead. Lead itself is not
    modified by this feature."""

    __tablename__ = "whatsapp_conversation"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "WA_ID", name="uq_wac_vendor_waid"),
        Index("ix_wac_source_record", "SOURCE_RECORD_ID"),
        Index("ix_wac_config", "CONFIG_ID"),
        Index("ix_wac_needs_human", "VENDOR_ID", "NEEDS_HUMAN"),
        Index("ix_wac_last_inbound", "LAST_INBOUND_AT"),
        Index("ix_wac_created", "CREATED_AT"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)

    CONFIG_ID = Column(
        String(36), ForeignKey("vendor_whatsapp_config.ID", ondelete="SET NULL"), nullable=True, index=True
    )  # bare FK, no relationship — a conversation must survive config rotation/deletion
    SOURCE_RECORD_ID = Column(String(36), nullable=True, index=True)
    # Generic, polymorphic — deliberately NO foreign key (see class docstring
    # and MODULE_CODE below for which table this points into).

    WA_ID = Column(String(20), nullable=False, index=True)  # normalized digits-only MSISDN (Meta wa_id format)
    CONTACT_PROFILE_NAME = Column(String(200), nullable=True)  # webhook contacts[].profile.name

    MODULE_CODE = Column(String(50), nullable=True)
    # Which app.rag_modules.<code>_rag_module/ handles inbound AI replies for
    # this conversation — set once at creation (see whatsapp_outbox_service.
    # get_or_create_conversation) and never changed afterward. Nullable so
    # existing rows created before this column need no backfill: NULL is
    # treated as "lead_module" everywhere it's read (see
    # whatsapp_inbound_service.run_ai_turn). This is the seam that lets a
    # future module (Sales, Support, ...) register its own RAG module and
    # have its own conversations route to it, while sharing this same table,
    # the same webhook, and the same outbound/inbound scheduler ticks.

    SESSION_ID = Column(String(36), nullable=False, default=lambda: str(uuid.uuid4()))  # reused as AIChatHistory.SESSION_ID

    LAST_INBOUND_AT  = Column(DateTime, nullable=True)  # the 24h session-window clock
    LAST_OUTBOUND_AT = Column(DateTime, nullable=True)
    LAST_AI_REPLY_AT = Column(DateTime, nullable=True)
    INBOUND_COUNT    = Column(Integer, nullable=False, default=0)
    OUTBOUND_COUNT   = Column(Integer, nullable=False, default=0)

    WA_OPT_STATE = Column(String(20), nullable=False, default="ACTIVE")  # ACTIVE|NOT_ON_WHATSAPP|OPTED_OUT|BLOCKED
    AI_ENABLED   = Column(Boolean, nullable=False, default=True)         # human-takeover switch
    NEEDS_HUMAN  = Column(Boolean, nullable=False, default=False)
    HANDOFF_REASON = Column(String(300), nullable=True)
    LAST_ERROR_MESSAGE = Column(String(500), nullable=True)
    PREFERRED_LANGUAGE = Column(String(10), nullable=True)
    # ISO-ish language code (e.g. "en", "ta") explicitly confirmed by the
    # customer tapping a language button on the welcome template. NULL until
    # a button reply is seen — see app.utils.whatsapp_language_utils for the
    # button-title -> code mapping (extend that map, not this column, to
    # support a new language). Used as a soft default for the AI's reply
    # language (see whatsapp_inbound_service.run_ai_turn), never a hard lock:
    # the AI still follows the customer if they switch languages mid-chat.

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor = relationship("Vendor", back_populates="whatsapp_conversations")


class WhatsAppMessage(Base):
    """One row per inbound/outbound WhatsApp message. Serves three purposes
    at once: (1) idempotency — UNIQUE(VENDOR_ID, WA_MESSAGE_ID) is the entire
    dedupe mechanism for Meta's at-least-once webhook retries; (2) history
    reconstruction — WhatsApp has no browser to hold conversation state
    client-side, so the last ~20 rows for a conversation are read back before
    each AI turn; (3) the outbound queue + delivery tracker (STATUS/
    ATTEMPT_COUNT/NEXT_ATTEMPT_AT/DELIVERY_STATUS). DEDUP_KEY (nullable,
    unique) guarantees "exactly one welcome per lead" / "exactly one reply
    per inbound message" even under retries or duplicate dispatch — a
    nullable column in a MySQL UNIQUE index permits unlimited NULLs, so
    unconstrained sends (manual/test) simply leave it NULL.

    Deliberately not merged with AIChatHistory (rag_models.py): that table
    has no VENDOR_ID/SOURCE_RECORD_ID, is turn-shaped with QUESTION/ANSWER
    both NOT NULL (doesn't fit a lone inbound message or a delivery-status
    callback), has no idempotency key, and is documented append-only
    (delivery status must mutate here). AIChatHistory is still written
    once per AI turn so WhatsApp conversations appear in the existing
    admin Chat History page for free."""

    __tablename__ = "whatsapp_message"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "WA_MESSAGE_ID", name="uq_wam_vendor_wamid"),
        UniqueConstraint("VENDOR_ID", "DEDUP_KEY", name="uq_wam_vendor_dedup"),
        Index("ix_wam_conv_ts", "CONVERSATION_ID", "WA_TIMESTAMP", "CREATED_AT"),
        Index("ix_wam_dispatch", "STATUS", "NEXT_ATTEMPT_AT"),
        Index("ix_wam_inbound_scan", "DIRECTION", "PROCESSING_STATE", "NEXT_ATTEMPT_AT"),
        Index("ix_wam_source_record", "SOURCE_RECORD_ID"),
        Index("ix_wam_created", "CREATED_AT"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)

    CONVERSATION_ID = Column(
        String(36), ForeignKey("whatsapp_conversation.ID", ondelete="CASCADE"), nullable=False, index=True
    )
    SOURCE_RECORD_ID = Column(String(36), nullable=True, index=True)  # denormalized from the conversation; generic, no FK
    CONFIG_ID = Column(String(36), ForeignKey("vendor_whatsapp_config.ID", ondelete="SET NULL"), nullable=True)

    DIRECTION = Column(String(3), nullable=False)  # "IN" | "OUT"
    WA_MESSAGE_ID = Column(String(128), nullable=True)  # Meta wamid — the inbound idempotency key
    WA_TIMESTAMP = Column(DateTime, nullable=True)      # from messages[].timestamp — Meta does not guarantee ordering
    DEDUP_KEY = Column(String(150), nullable=True)      # e.g. "welcome:<source_record_id>", "reply:<inbound_wamid>"

    MESSAGE_TYPE = Column(String(20), nullable=False, default="text")
    # text|template|image|audio|video|document|location|sticker|interactive|button|unsupported
    BODY_TEXT = Column(Text, nullable=True)
    TEMPLATE_NAME = Column(String(100), nullable=True)
    TEMPLATE_LANG = Column(String(15), nullable=True)
    TEMPLATE_PARAMS_JSON = Column(Text, nullable=True)
    MEDIA_ID = Column(String(128), nullable=True)
    MEDIA_MIME = Column(String(100), nullable=True)
    MEDIA_URL = Column(String(500), nullable=True)  # outbound document/image link (e.g. an existing quotation PDF route)
    PURPOSE = Column(String(20), nullable=True)  # WELCOME|AI_REPLY|FALLBACK|REENGAGE|MANUAL|TEST|QUOTATION_PDF

    STATUS = Column(String(20), nullable=False, default="PENDING")
    # OUT: PENDING|SENDING|SENT|FAILED|BLOCKED|CANCELLED   IN: RECEIVED
    DELIVERY_STATUS = Column(String(20), nullable=True)   # sent|delivered|read|failed — from statuses[] webhook, forward-only
    PROCESSING_STATE = Column(String(20), nullable=True)  # IN only: PENDING|PROCESSING|PROCESSED|COALESCED|FAILED|DISCARDED
    ATTEMPT_COUNT = Column(Integer, nullable=False, default=0)
    MAX_ATTEMPTS = Column(Integer, nullable=False, default=5)
    NEXT_ATTEMPT_AT = Column(DateTime, nullable=True)  # backoff gate AND inbound debounce/coalesce gate
    ERROR_CODE = Column(String(30), nullable=True)     # Meta error.code, or GEMINI_FAILED / RETRIEVAL_FAILED / NO_CONFIG
    ERROR_MESSAGE = Column(String(500), nullable=True)
    NEEDS_HUMAN = Column(Boolean, nullable=False, default=False)

    QUEUED_AT = Column(DateTime, default=now_ist)
    SENT_AT = Column(DateTime, nullable=True)
    DELIVERED_AT = Column(DateTime, nullable=True)
    READ_AT = Column(DateTime, nullable=True)
    PROCESSED_AT = Column(DateTime, nullable=True)
    RESPONSE_TIME = Column(Numeric(10, 3), nullable=True)  # seconds — mirrors AIChatHistory.RESPONSE_TIME
    MODEL_NAME = Column(String(100), nullable=True)
    TOTAL_TOKENS = Column(Integer, nullable=True)
    RAW_PAYLOAD = Column(Text, nullable=True)  # the single message object, not the whole webhook envelope

    CREATED_AT = Column(DateTime, default=now_ist)


class WhatsAppWebhookEvent(Base):
    """Append-only audit of every inbound webhook POST, including the ones
    that never produce a WhatsAppMessage row (unknown phone_number_id, bad
    signature, malformed payload) — the direct analogue of LeadPollingLog
    for polling. Pruned on a schedule (see whatsapp_scheduler.py); no other
    table has an FK pointing into this one."""

    __tablename__ = "whatsapp_webhook_event"

    __table_args__ = (
        Index("ix_wawe_received", "RECEIVED_AT"),
        Index("ix_wawe_vendor", "VENDOR_ID"),
        Index("ix_wawe_phoneid", "PHONE_NUMBER_ID"),
        Index("ix_wawe_result", "RESULT"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="SET NULL"), nullable=True, index=True)  # NULL = orphan/unresolvable
    PHONE_NUMBER_ID = Column(String(64), nullable=True, index=True)

    RECEIVED_AT = Column(DateTime, default=now_ist)
    SIGNATURE_STATUS = Column(String(20), nullable=True)  # VALID|INVALID|SKIPPED|MISSING
    RESULT = Column(String(30), nullable=False)
    # ACCEPTED|DUPLICATE|UNKNOWN_PHONE_ID|BAD_SIGNATURE|MALFORMED|STATUS_ONLY|TOO_LARGE|IGNORED

    MESSAGE_COUNT = Column(Integer, nullable=False, default=0)
    STATUS_COUNT = Column(Integer, nullable=False, default=0)
    CLAIMED_COUNT = Column(Integer, nullable=False, default=0)
    ERROR_MESSAGE = Column(String(500), nullable=True)
    RAW_BODY = Column(Text, nullable=True)  # truncated to 16 KB by the caller

    CREATED_AT = Column(DateTime, default=now_ist)
