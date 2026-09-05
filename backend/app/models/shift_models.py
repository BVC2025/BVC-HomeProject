"""Shift Management models.

Two tables — no ShiftChangeRequest (per business decision: admins
assign, employees follow).

  ShiftTemplate    — Reusable shift definition (name, start/end time,
                     break minutes, night flag, colour, etc.).
  ShiftAssignment  — Which employee works which shift on which date.
                     One row per (EMPLOYEE_ID, SHIFT_DATE); SHIFT_ID
                     may be NULL to represent an explicit OFF day.
"""

from datetime import datetime
import uuid

from sqlalchemy import (
    Column, String, Text, Boolean, Integer, Float,
    Date, Time, DateTime, ForeignKey, UniqueConstraint, Index,
)

from app.database.database import Base


class ShiftTemplate(Base):

    __tablename__ = "shift_master"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Short admin-facing code shown on the calendar cells
    # (e.g. "G" for general, "N" for night, "E" for evening).
    SHIFT_CODE  = Column(String(20), nullable=True, index=True)

    NAME        = Column(String(120), nullable=False, index=True)
    START_TIME  = Column(Time, nullable=False)
    END_TIME    = Column(Time, nullable=False)

    # True when END_TIME is on the next calendar day
    # (e.g. START=22:00, END=06:00).
    CROSS_MIDNIGHT = Column(Boolean, default=False, nullable=False)

    # Unpaid mid-shift break, in minutes. Used by payroll to net
    # worked-hours calculations.
    BREAK_MINUTES = Column(Integer, default=60, nullable=False)

    # Loose grouping — e.g. GENERAL / PRODUCTION / OFFICE. Free-form.
    CATEGORY = Column(String(60), nullable=True)

    # Night-shift flag. If True, NIGHT_ALLOWANCE_PCT is applied on top
    # of basic in payroll.
    IS_NIGHT             = Column(Boolean, default=False, nullable=False)
    NIGHT_ALLOWANCE_PCT  = Column(Float,   default=0.0,   nullable=False)

    # Grace window either side of START_TIME within which arrival is
    # still PRESENT. Used by attendance status computation for flex
    # shifts.
    FLEX_WINDOW_MINUTES = Column(Integer, default=0, nullable=False)

    # Colour used on the shift-calendar cells so admins can eyeball
    # coverage. Stored as a hex string (e.g. "#dc2626").
    COLOR = Column(String(12), nullable=True)

    DESCRIPTION = Column(Text, nullable=True)

    # Soft delete via IS_ACTIVE — old assignments still reference the
    # shift for auditing.
    IS_ACTIVE = Column(Boolean, default=True, nullable=False)

    VENDOR_ID   = Column(Integer, ForeignKey("vendor.ID"), nullable=True, index=True)
    CREATED_AT  = Column(DateTime, default=datetime.now, nullable=False)
    UPDATED_AT  = Column(
        DateTime, default=datetime.now, onupdate=datetime.now, nullable=False,
    )


class ShiftAssignment(Base):

    __tablename__ = "shift_assignment"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # NULL means "employee has explicitly been marked OFF for this
    # date" — matches the frontend semantic when the admin picks the
    # OFF chip in the calendar.
    SHIFT_ID = Column(
        String(36),
        ForeignKey("shift_master.ID", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    SHIFT_DATE = Column(Date, nullable=False, index=True)

    # Free-form note the admin can add (e.g. "covering for Nasira").
    NOTES = Column(Text, nullable=True)

    VENDOR_ID  = Column(Integer, ForeignKey("vendor.ID"), nullable=True, index=True)
    CREATED_AT = Column(DateTime, default=datetime.now, nullable=False)
    UPDATED_AT = Column(
        DateTime, default=datetime.now, onupdate=datetime.now, nullable=False,
    )

    __table_args__ = (
        # One assignment per (employee, date). Bulk / assign endpoints
        # rely on this — an upsert-style flow deletes any existing
        # row for (EMPLOYEE_ID, SHIFT_DATE) before inserting.
        UniqueConstraint("EMPLOYEE_ID", "SHIFT_DATE", name="uq_shift_emp_date"),
        Index("ix_shift_asgn_date", "SHIFT_DATE"),
    )
