"""Persistent transcript of the Voice Leave Assistant.

Every turn of the chatbot (both user and assistant) is stored here so
admins can review what employees have been asking. This is a
compliance / monitoring surface — designed to detect abuse, off-topic
use, or attempts to extract data the RBAC prompt already refuses.

Kept in its own file (rather than in `models.py`) because the chatbot
is a self-contained feature and this table is only read from the
admin history route + written from the /leave-ai-chat/message endpoint.
"""

from datetime import datetime
import uuid

from sqlalchemy import (
    Column,
    String,
    Text,
    DateTime,
    ForeignKey,
    Integer,
    Index,
)

from app.database.database import Base


class LeaveChatMessage(Base):

    __tablename__ = "leave_chat_message"

    ID = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # The employee whose session this belongs to. Always the resolved
    # UUID, never the EMPLOYEE_CODE.
    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 'user' or 'assistant' — matches the OpenAI/Gemini role convention.
    ROLE = Column(String(16), nullable=False)

    # The raw message text. TEXT rather than VARCHAR — Tamil replies
    # with formatting can exceed 500 chars and we don't want to lose
    # the audit trail.
    CONTENT = Column(Text, nullable=False)

    # Language pill the employee had selected when this turn was sent
    # ('auto' | 'en' | 'ta' | 'thanglish'). NULL for very old rows.
    LANGUAGE = Column(String(16), nullable=True)

    # Action the model emitted ('ANSWER_ONLY' or 'PROPOSE_LEAVE').
    # Only set on assistant rows.
    ACTION = Column(String(32), nullable=True)

    # Vendor scoping so multi-tenant admin filters work.
    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True,
    )

    # Use server local time (IST on our server) to match the
    # convention used by every other table in the project — the
    # frontend renders these directly with `new Date(iso)` which
    # treats no-tz strings as local time.
    CREATED_AT = Column(
        DateTime,
        default=datetime.now,
        nullable=False,
        index=True,
    )

    __table_args__ = (
        Index("ix_leave_chat_emp_created", "EMPLOYEE_ID", "CREATED_AT"),
    )
