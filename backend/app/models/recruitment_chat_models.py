"""Persistent transcript of the Deepthi recruitment voice/chat agent.

Every turn (both user utterance and Deepthi's reply) is stored here so
admins can review what HR / department heads have been asking. This is
a compliance + monitoring surface, and also lets you resume a long
requisition conversation across page reloads.

Kept in its own file (rather than in `models.py`) because the recruitment
agent is a self-contained feature and this table is only read from the
admin history routes + written from the /recruitment/voice-agent/interpret
endpoint.
"""

from datetime import datetime
import uuid

from sqlalchemy import (
    Column, String, Text, DateTime, ForeignKey, Integer, Index,
)

from app.database.database import Base


class RecruitmentChatMessage(Base):

    __tablename__ = "recruitment_chat_message"

    ID = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # Optional employee link — the HR user who was talking to Deepthi.
    # NULL when the caller isn't identifiable (e.g. a public/demo turn).
    # Always the resolved UUID, never the EMPLOYEE_CODE.
    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # 'user' or 'assistant' — matches the OpenAI/Gemini role convention.
    ROLE = Column(String(16), nullable=False)

    # Raw text. TEXT (not VARCHAR) because Tamil replies + structured
    # JSON drafts can exceed 500 chars easily.
    CONTENT = Column(Text, nullable=False)

    # Detected language for this turn — best-effort script sniff on
    # the user's utterance; NULL for assistant rows.
    LANGUAGE = Column(String(16), nullable=True)

    # Action the model emitted for assistant rows:
    # 'CHIT_CHAT' | 'NEED_MORE' | 'PROPOSE_DRAFT'. NULL on user rows.
    ACTION = Column(String(32), nullable=True)

    # Which LLM produced this reply (assistant rows only):
    # 'gemini · gemini-flash-lite-latest', 'qwen-2.5-72b-instruct',
    # 'regex-fallback', 'noop'. Lets ops see fallback rates over time.
    PROVIDER = Column(String(60), nullable=True)

    # When the assistant proposed a draft, we snapshot it as JSON so
    # the transcript reconstructs the exact requisition preview HR
    # saw at that moment — even if the schema evolves later.
    DRAFT_SNAPSHOT = Column(Text, nullable=True)

    # Session key — groups turns of one back-and-forth. The frontend
    # generates a random UUID per "New Requisition" opening and sends
    # it on every request so the transcript stays contiguous.
    SESSION_ID = Column(
        String(36),
        nullable=True,
        index=True,
    )

    # Vendor scoping so the admin history filter is multi-tenant safe.
    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True,
    )

    CREATED_AT = Column(
        DateTime,
        default=datetime.now,
        nullable=False,
        index=True,
    )

    __table_args__ = (
        Index("ix_recruit_chat_emp_created", "EMPLOYEE_ID", "CREATED_AT"),
        Index("ix_recruit_chat_session",     "SESSION_ID"),
    )
