"""Recruitment Requisition — the pre-job approval step.

A department head raises a Requisition when they want to hire.
It sits in PENDING status until HR / management approves. Once
APPROVED, HR can convert the requisition to an open RecruitmentJob
row (the next stage of the pipeline). REJECTED requisitions stay for
audit; CONVERTED ones link to the job they became.
"""

from datetime import datetime, date

from sqlalchemy import (
    Column, Integer, String, Text, Float, Date, DateTime, ForeignKey,
)

from app.database.database import Base


class RecruitmentRequisition(Base):

    __tablename__ = "recruitment_requisition"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    # REQ-2026-0001 style, auto-assigned at create time.
    REQ_CODE = Column(String(30), unique=True, index=True, nullable=True)

    POSITION_TITLE = Column(String(150), nullable=False)
    DEPARTMENT     = Column(String(100), nullable=True)
    LOCATION       = Column(String(100), nullable=True)

    EMPLOYMENT_TYPE = Column(String(30), default="FULL_TIME")
    HEADCOUNT       = Column(Integer, default=1)

    EXPERIENCE_MIN_YEARS = Column(Float, nullable=True, default=0.0)
    EXPERIENCE_MAX_YEARS = Column(Float, nullable=True)

    BUDGET_CTC_MIN = Column(Float, nullable=True)
    BUDGET_CTC_MAX = Column(Float, nullable=True)

    REQUIRED_SKILLS    = Column(Text, nullable=True)
    PREFERRED_SKILLS   = Column(Text, nullable=True)
    REQUIRED_EDUCATION = Column(String(300), nullable=True)

    JUSTIFICATION = Column(Text, nullable=True)

    # LOW / NORMAL / HIGH / URGENT
    URGENCY = Column(String(20), default="NORMAL", index=True)

    NEEDED_BY_DATE = Column(Date, nullable=True)

    REQUESTED_BY_ID = Column(
        String(36), ForeignKey("employee.ID"), nullable=True, index=True,
    )

    # PENDING / APPROVED / REJECTED / CONVERTED
    STATUS = Column(String(20), default="PENDING", index=True)

    REJECTION_REASON = Column(Text, nullable=True)

    APPROVED_AT  = Column(DateTime, nullable=True)
    REJECTED_AT  = Column(DateTime, nullable=True)
    CONVERTED_AT = Column(DateTime, nullable=True)

    CONVERTED_JOB_ID = Column(
        Integer, ForeignKey("recruitment_job.ID"), nullable=True, index=True,
    )

    # One-shot secret in the MD's approval email. Cleared after use.
    APPROVAL_TOKEN = Column(String(64), nullable=True, index=True)

    VENDOR_ID  = Column(Integer, ForeignKey("vendor.ID"), nullable=True, index=True)
    CREATED_AT = Column(DateTime, default=datetime.now, nullable=False)
    UPDATED_AT = Column(
        DateTime, default=datetime.now, onupdate=datetime.now, nullable=False,
    )
