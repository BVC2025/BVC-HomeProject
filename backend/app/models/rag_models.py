from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Text, Numeric,
    Index, ForeignKey
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from app.utils.datetime_utils import now_ist
import uuid

# Plain String status columns (majority convention in this codebase — see
# project_models.py's note: "matches supplier_models.py's Supplier.CURRENCY
# convention"). No DB-level ENUM for PROCESSING_STATUS / STATUS below.


class AIModule(Base):
    """Registry of AI Assistants available on the common RAG platform (Lead,
    Sales, HR, Inventory, ...). A small, admin-curated config table — one row
    per module, IS_ACTIVE toggle is enough, no soft-delete needed (mirrors
    LeadPollingConfig having no DELETED_AT either).

    Onboarding a new module is exactly one row here plus one
    backend/app/rag_modules/<code>_rag_module/prompts.py file — the core
    engine and every route in routes/rag.py already parameterize on
    MODULE_CODE, so nothing else needs to change."""

    __tablename__ = "ai_modules"

    __table_args__ = (
        Index("ix_aimod_active", "IS_ACTIVE"),
    )

    ID   = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    MODULE_NAME = Column(String(100), nullable=False)                 # "Lead AI Assistant"
    MODULE_CODE = Column(String(50),  nullable=False, unique=True, index=True)  # "lead"
    DESCRIPTION = Column(Text, nullable=True)

    VECTOR_COLLECTION_NAME = Column(String(100), nullable=False, unique=True)   # "lead_rag_collection"
    EMBEDDING_MODEL        = Column(String(150), nullable=False, default="BAAI/bge-small-en-v1.5")
    LLM_MODEL              = Column(String(100), nullable=False)                # resolved GEMINI_MODEL at seed time

    IS_ACTIVE = Column(Boolean, nullable=False, default=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    documents     = relationship("AIDocument", back_populates="module")
    chat_history  = relationship("AIChatHistory", back_populates="module")
    training_jobs = relationship("AITrainingJob", back_populates="module")


class AIDocument(Base):
    """One uploaded knowledge-base source file for a module (SOP, FAQ, price
    list, ...). MODULE_ID is the authoritative FK; MODULE_NAME is a
    denormalized display-cache column populated from module.MODULE_NAME at
    write time (matches this repo's habit of storing a snapshot string
    alongside a real FK, e.g. LeadPollingLog.API_TYPE) — never edited
    independently.

    Soft delete via DELETED_AT (nullable DateTime, filtered .is_(None)
    everywhere) — the repo-wide soft-delete convention. IS_ACTIVE is a
    separate enable/disable-from-retrieval toggle that keeps the row and
    file intact."""

    __tablename__ = "ai_documents"

    __table_args__ = (
        Index("ix_aidoc_module_active", "MODULE_ID", "IS_ACTIVE"),
        Index("ix_aidoc_status",        "PROCESSING_STATUS"),
        Index("ix_aidoc_created",       "CREATED_AT"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    MODULE_ID   = Column(String(36), ForeignKey("ai_modules.ID", ondelete="RESTRICT"), nullable=False, index=True)
    MODULE_NAME = Column(String(100), nullable=False)  # denormalized cache of module.MODULE_NAME

    TITLE       = Column(String(255), nullable=False)
    DESCRIPTION = Column(Text, nullable=True)

    FILE_NAME      = Column(String(255), nullable=False)   # original upload filename
    FILE_PATH      = Column(String(500), nullable=False)   # public /static/... URL
    FILE_SIZE      = Column(Integer, nullable=False)        # bytes
    FILE_TYPE      = Column(String(100), nullable=True)     # MIME type from UploadFile.content_type
    FILE_EXTENSION = Column(String(10), nullable=False)     # ".pdf", ".docx", ...

    VERSION           = Column(Integer, nullable=False, default=1)   # bumped on "replace"
    DOCUMENT_TAGS     = Column(String(500), nullable=True)           # comma-separated, no separate tag table
    DOCUMENT_CATEGORY = Column(String(100), nullable=True)           # e.g. "SOP", "FAQ", "Policy"

    IS_ACTIVE  = Column(Boolean, nullable=False, default=True)   # enable/disable from retrieval without deleting
    DELETED_AT = Column(DateTime, nullable=True)                 # soft delete

    IS_PROCESSED      = Column(Boolean, nullable=False, default=False)
    PROCESSING_STATUS = Column(String(20), nullable=False, default="PENDING")  # PENDING|RUNNING|COMPLETED|FAILED
    PROCESSING_ERROR  = Column(Text, nullable=True)

    TOTAL_CHUNKS  = Column(Integer, nullable=False, default=0)
    TOTAL_VECTORS = Column(Integer, nullable=False, default=0)

    CREATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    UPDATED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    module        = relationship("AIModule", back_populates="documents")
    training_jobs = relationship("AITrainingJob", back_populates="document")


class AIChatHistory(Base):
    """Append-only log of every RAG chat turn (question + final answer),
    never mutated after insert — matches LeadPollingLog's append-only
    convention (no UPDATED_AT)."""

    __tablename__ = "ai_chat_history"

    __table_args__ = (
        Index("ix_aichat_module_session", "MODULE_ID", "SESSION_ID"),
        Index("ix_aichat_user",           "USER_ID"),
        Index("ix_aichat_created",        "CREATED_AT"),
    )

    ID        = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    MODULE_ID = Column(String(36), ForeignKey("ai_modules.ID", ondelete="CASCADE"), nullable=False, index=True)
    USER_ID   = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True, index=True)
    SESSION_ID = Column(String(36), nullable=False, index=True)  # client-generated uuid4, groups one conversation

    QUESTION = Column(Text, nullable=False)
    ANSWER   = Column(Text, nullable=False)

    PROMPT_TOKENS     = Column(Integer, nullable=True)
    COMPLETION_TOKENS = Column(Integer, nullable=True)
    TOTAL_TOKENS      = Column(Integer, nullable=True)
    RESPONSE_TIME     = Column(Numeric(10, 3), nullable=True)   # seconds, wall-clock end-to-end
    MODEL_NAME        = Column(String(100), nullable=True)      # which fallback model actually answered

    CREATED_AT = Column(DateTime, default=now_ist)

    module = relationship("AIModule", back_populates="chat_history")


class AITrainingJob(Base):
    """One ingestion run for a single document (initial upload, replace, or
    manual retrain). AI_DOCUMENTS.PROCESSING_STATUS mirrors the latest job's
    STATUS; this table keeps the full history across retrains."""

    __tablename__ = "ai_training_job"

    __table_args__ = (
        Index("ix_aitj_module_status", "MODULE_ID", "STATUS"),
        Index("ix_aitj_document",      "DOCUMENT_ID"),
        Index("ix_aitj_created",       "CREATED_AT"),
    )

    ID          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    MODULE_ID   = Column(String(36), ForeignKey("ai_modules.ID", ondelete="CASCADE"), nullable=False, index=True)
    DOCUMENT_ID = Column(String(36), ForeignKey("ai_documents.ID", ondelete="CASCADE"), nullable=False, index=True)

    STATUS        = Column(String(20), nullable=False, default="PENDING")  # PENDING|RUNNING|COMPLETED|FAILED
    STARTED_AT    = Column(DateTime, nullable=True)
    COMPLETED_AT  = Column(DateTime, nullable=True)
    ERROR_MESSAGE = Column(Text, nullable=True)

    TOTAL_CHUNKS  = Column(Integer, nullable=False, default=0)
    TOTAL_VECTORS = Column(Integer, nullable=False, default=0)

    CREATED_AT = Column(DateTime, default=now_ist)

    module   = relationship("AIModule", back_populates="training_jobs")
    document = relationship("AIDocument", back_populates="training_jobs")
