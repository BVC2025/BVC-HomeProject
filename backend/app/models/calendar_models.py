"""Calendar module — schedules time-based activities (meetings, calls,
follow-ups, demos) between employees and leads/customers.

Design decisions:

* One flat table `calendar_event`. Additional attendees (beyond the
  single OWNER_ID) are stored inline in ATTENDEE_IDS as a
  comma-separated string. Keeps queries simple; upgrade to a
  dedicated attendee table only when the UI actually asks for
  per-attendee accept/decline state.
* OWNER_ID + CREATED_BY_ID are separate: the sales manager can
  create an event on their rep's calendar. Owner is who's expected
  to show up, created_by is who booked it.
* LEAD_ID + CUSTOMER_ID are both optional, both nullable. An event
  can be:
    - standalone (internal team meeting)                  — both NULL
    - lead-facing (pre-conversion)                        — LEAD_ID set
    - customer-facing (post-conversion / existing acct)   — CUSTOMER_ID set
  Rarely both, but not forbidden either (customer that came from a lead).
* REMINDER_MINUTES + REMINDER_SENT drive a scheduler job that
  creates a Notification when the event's start time approaches.
  Setting to 0 disables reminders for that event.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Integer, DateTime, Boolean, Text,
    ForeignKey, Index, Enum as SAEnum,
)

from app.models.models import Base


# Kept as small, well-known set. Anything outside → save as "OTHER"
# with the specifics in DESCRIPTION.
EVENT_TYPE_ENUM = SAEnum(
    "MEETING",
    "CALL",
    "FOLLOW_UP",
    "DEMO",
    "TASK",
    "OTHER",
    name="calendar_event_type",
)

EVENT_STATUS_ENUM = SAEnum(
    "SCHEDULED",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
    name="calendar_event_status",
)


class CalendarEvent(Base):
    """A single scheduled activity on someone's calendar."""

    __tablename__ = "calendar_event"

    __table_args__ = (
        Index("ix_calendar_event_vendor_start", "VENDOR_ID", "START_AT"),
        Index("ix_calendar_event_owner_start",  "OWNER_ID",  "START_AT"),
        Index("ix_calendar_event_lead",         "LEAD_ID"),
        Index("ix_calendar_event_customer",     "CUSTOMER_ID"),
        Index("ix_calendar_event_reminder",     "REMINDER_SENT", "START_AT"),
    )

    ID = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ---- Core content ----
    TITLE       = Column(String(200), nullable=False)
    DESCRIPTION = Column(Text,        nullable=True)
    EVENT_TYPE  = Column(EVENT_TYPE_ENUM, nullable=False, default="MEETING")
    LOCATION    = Column(String(300), nullable=True)   # room or meeting URL

    # ---- Timing ----
    START_AT = Column(DateTime, nullable=False)
    END_AT   = Column(DateTime, nullable=False)
    ALL_DAY  = Column(Boolean,  nullable=False, default=False)

    # ---- Status / lifecycle ----
    STATUS         = Column(EVENT_STATUS_ENUM, nullable=False, default="SCHEDULED")
    OUTCOME_NOTES  = Column(Text, nullable=True)   # filled on complete/no-show

    # ---- Ownership ----
    OWNER_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    CREATED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="SET NULL"),
        nullable=True,
    )
    # Additional attendees — comma-separated employee IDs. Kept flat
    # to avoid a join table until per-attendee state is actually needed.
    ATTENDEE_IDS = Column(Text, nullable=True)

    # ---- Optional links to CRM entities ----
    LEAD_ID = Column(
        String(36),
        ForeignKey("lead.ID", ondelete="SET NULL"),
        nullable=True,
    )
    # customer.ID is VARCHAR(36) UUID in the live schema despite the
    # legacy models.py declaring it as Integer — matching reality here
    # so the FK constraint can be created.
    CUSTOMER_ID = Column(
        String(36),
        ForeignKey("customer.ID", ondelete="SET NULL"),
        nullable=True,
    )

    # ---- Reminders ----
    REMINDER_MINUTES = Column(Integer, nullable=False, default=15)  # 0 = no reminder
    REMINDER_SENT    = Column(Boolean, nullable=False, default=False)

    # ---- Audit ----
    CREATED_AT = Column(DateTime, default=datetime.now, nullable=False)
    UPDATED_AT = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)
