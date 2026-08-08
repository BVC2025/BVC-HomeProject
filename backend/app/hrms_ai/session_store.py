"""
Conversation-history table for the HRMS AI assistant.

One row per message (both user turns and assistant turns). Scoped
by SESSION_ID (client-generated), EMPLOYEE_ID (from JWT), and
VENDOR_ID (from JWT) so no employee ever sees another employee's
conversation.

Kept in the main MySQL DB but in its own table — never touches any
HRMS data. Deletable per-session without any cascading effects.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.database.database import Base


class HrmsAiConversation(Base):
    """One chat turn — user question or assistant answer."""

    __tablename__ = "hrms_ai_conversation"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    # Client-generated session identifier. Persisted in the browser's
    # localStorage so a page refresh keeps the same conversation.
    SESSION_ID = Column(String(64), nullable=False, index=True)

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
        index=True,
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True,
    )

    # 'user' | 'assistant' | 'system'
    ROLE = Column(String(16), nullable=False)

    # Full message text. TEXT column so long assistant answers fit.
    CONTENT = Column(Text, nullable=False)

    # BCP-47 language tag of this message (e.g. 'en', 'ta', 'hi'). NULL
    # if not detected.
    LANGUAGE = Column(String(8), nullable=True)

    # Server IST wall-clock (matching every other DateTime in the schema).
    CREATED_AT = Column(DateTime, default=datetime.now, index=True)
