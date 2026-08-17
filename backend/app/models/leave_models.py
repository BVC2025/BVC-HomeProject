from sqlalchemy import (
    Column, String, Integer, ForeignKey, Float, Date,
    Text, UniqueConstraint, DateTime,
)
from app.database.database import Base
from datetime import datetime


class LeaveRequest(Base):
    """
    Employee leave application. Lifecycle:
      1. Employee POSTs /leave/apply -> STATUS = PENDING_APPROVAL,
         APPROVAL_TOKEN generated, email sent to authority.
      2. Authority clicks the approve / reject link in the email.
         GET /leave/decide/{token} validates the token and flips
         STATUS to APPROVED / REJECTED, stamps APPROVAL_RESOLVED_AT.
      3. Approved leave deducts from LeaveBalance.

    LEAVE_TYPE choices: CASUAL / SICK / EARNED / UNPAID / LOP
    """

    __tablename__ = "leave_request"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        index=True
    )

    LEAVE_TYPE = Column(
        String(20),
        default="CASUAL",
        index=True
    )

    START_DATE = Column(Date, index=True)

    END_DATE = Column(Date)

    DAYS = Column(Float, default=1.0)
    # may be fractional for half-day leave

    DURATION_HOURS = Column(Float, nullable=True)
    # Only populated when LEAVE_TYPE='PERMISSION'.
    # Permissions are tracked in hours (e.g. 2.5) instead of days;
    # DAYS is set to 0 for permission rows so quota accounting
    # (which is day-based) ignores them.

    PERMISSION_SUBTYPE = Column(
        String(20),
        nullable=True,
        index=True
    )
    # Phase D: only set when LEAVE_TYPE='PERMISSION'. Values:
    #   SHORT_PERMISSION — manual short permission (1-4 hours)
    #   HALF_DAY         — half-day permission (default 4h)
    #   LATE_COMING      — auto-created at login when after grace period
    #   EARLY_EXIT       — auto-created at logout when before grace period

    REASON = Column(String(500))

    STATUS = Column(
        String(30),
        default="PENDING_APPROVAL",
        index=True
    )
    # PENDING_APPROVAL / APPROVED / REJECTED / CANCELLED / EXPIRED

    APPROVAL_TOKEN = Column(
        String(64),
        unique=True,
        nullable=True,
        index=True
    )

    APPROVAL_REQUESTED_AT = Column(DateTime, nullable=True)

    APPROVAL_RESOLVED_AT = Column(DateTime, nullable=True)

    APPROVED_BY_EMAIL = Column(String(120), nullable=True)
    # captured at decision time for audit

    REJECTION_REASON = Column(String(500), nullable=True)

    # Phase 4 — AI Leave Agent + Task Gate.
    # Snapshot of AI recommendation captured at submit time
    # (verdict + rationale). MD sees this alongside Approve/Reject.
    AI_RECOMMENDATION = Column(Text, nullable=True)
    # JSON array of task commitments the employee promised at apply
    # time (task_id, promised_by, note).
    TASK_COMMITMENTS = Column(Text, nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class LeaveBalance(Base):
    """
    Per-employee annual quota tracker. One row per (employee, year).
    UNPAID / LOP don't draw from balance (unlimited but unpaid).

    Default quotas seeded by bvc24_seed and tunable here:
      - CASUAL: 12 days/year
      - SICK:   12 days/year
      - EARNED: 15 days/year
    """

    __tablename__ = "leave_balance"

    __table_args__ = (
        UniqueConstraint(
            "EMPLOYEE_ID", "YEAR",
            name="uq_leave_balance_employee_year"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        index=True
    )

    YEAR = Column(Integer, index=True)

    CASUAL_TOTAL = Column(Float, default=12.0)

    CASUAL_USED = Column(Float, default=0.0)

    SICK_TOTAL = Column(Float, default=12.0)

    SICK_USED = Column(Float, default=0.0)

    EARNED_TOTAL = Column(Float, default=15.0)

    EARNED_USED = Column(Float, default=0.0)

    # ---- Phase C — Maternity + Carryover (2026-06-02) ----
    # MATERNITY is only seeded with a non-zero quota for FEMALE
    # employees (defaults to 180 days, configurable via policy).
    MATERNITY_TOTAL = Column(Float, default=0.0)

    MATERNITY_USED = Column(Float, default=0.0)

    # Carryover from the prior year. `Available = TOTAL + CARRYOVER - USED`
    # Each type can be carried separately; auto-populated when a new
    # year's balance is created (capped by policy CARRYOVER_LIMIT_*).
    CASUAL_CARRYOVER    = Column(Float, default=0.0)
    SICK_CARRYOVER      = Column(Float, default=0.0)
    EARNED_CARRYOVER    = Column(Float, default=0.0)
    MATERNITY_CARRYOVER = Column(Float, default=0.0)

    # Which policy this balance was provisioned from (audit)
    POLICY_ID = Column(
        Integer,
        ForeignKey("leave_quota_policy.ID"),
        nullable=True
    )

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class LeaveQuotaPolicy(Base):
    """Per-scope leave quota override.

    Resolution order at balance-creation time:
      1. DESIGNATION match (Employee.DESIGNATION_ID)
      2. DEPARTMENT match (Employee.DEPARTMENT_ID)
      3. COMPANY default (SCOPE='COMPANY', SCOPE_ID=NULL)
      4. Hard-coded DEFAULT_QUOTAS (final fallback if no policy exists)

    Only the first matching active policy is applied; field-level
    inheritance / merging is intentionally not supported to keep the
    rules simple."""

    __tablename__ = "leave_quota_policy"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    POLICY_NAME = Column(String(100), nullable=False)

    SCOPE = Column(String(20), nullable=False, index=True)
    # COMPANY / DEPARTMENT / DESIGNATION

    SCOPE_ID = Column(Integer, nullable=True, index=True)
    # NULL for COMPANY-wide. department.ID or designation.ID otherwise.

    CASUAL_DAYS     = Column(Float, default=12.0)
    SICK_DAYS       = Column(Float, default=12.0)
    EARNED_DAYS     = Column(Float, default=15.0)
    MATERNITY_DAYS  = Column(Float, default=180.0)

    # Carryover caps (max days that survive a year-end roll)
    CARRYOVER_LIMIT_CASUAL    = Column(Float, default=0.0)
    CARRYOVER_LIMIT_SICK      = Column(Float, default=0.0)
    CARRYOVER_LIMIT_EARNED    = Column(Float, default=15.0)
    CARRYOVER_LIMIT_MATERNITY = Column(Float, default=0.0)

    IS_ACTIVE = Column(Integer, default=1)

    NOTES = Column(String(500), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


# ====================================================================
# AI Leave Agent — conversation state + audit trail
# ====================================================================
# One row per "session" of an employee chatting with the leave agent.
# Persists the state machine + message log + extracted fields so the
# conversation can resume across page reloads, and every AI-driven
# action has a complete audit trail.

class AILeaveConversation(Base):
    """Persistent state for an AI leave-request conversation."""

    __tablename__ = "ai_leave_conversation"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=False,
        index=True
    )

    # State machine. Values:
    #   COLLECTING  -> still gathering required info
    #   CONFIRMING  -> showed summary, awaiting yes/no
    #   EXECUTED    -> leave request submitted (terminal success)
    #   CANCELLED   -> employee cancelled mid-flow
    #   FAILED      -> validation/policy rejection
    STATE = Column(String(20), default="COLLECTING", index=True)

    # Detected intent for this session.
    # REQUEST / BALANCE / STATUS / CANCEL / MODIFY / UNKNOWN
    INTENT = Column(String(20), nullable=True)

    # Extracted-and-validated entity values, JSON-encoded.
    COLLECTED_JSON = Column(Text, nullable=True)

    # Full message log (chronological), JSON-encoded list.
    MESSAGES_JSON = Column(Text, nullable=True)

    # Links back to the LeaveRequest row that was created (if any).
    # ON DELETE SET NULL — if the leave request is deleted, the
    # conversation row stays (audit trail) with the link cleared.
    LEAVE_REQUEST_ID = Column(
        Integer,
        ForeignKey("leave_request.ID", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    RESULT_MESSAGE = Column(String(500), nullable=True)

    STARTED_AT   = Column(DateTime, default=datetime.utcnow)
    LAST_AT      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    COMPLETED_AT = Column(DateTime, nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True
    )


class LeaveBalanceAdjustment(Base):
    """Audit trail of every manual leave-balance adjustment by HR.

    Inserted by PATCH /leave/balance/{employee_id}/adjust — write-only.
    Each row records what HR credited/debited, which leave type, when,
    and the mandatory reason. Lets HR replay any balance change."""

    __tablename__ = "leave_balance_adjustment"

    ID            = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID   = Column(String(36), ForeignKey("employee.ID"),
                           nullable=False, index=True)
    YEAR          = Column(Integer, nullable=False)
    LEAVE_TYPE    = Column(String(20), nullable=False)
    # CASUAL / SICK / EARNED / MATERNITY
    DELTA_DAYS    = Column(Float, nullable=False)
    # +ve = credit (e.g. comp-off earned), -ve = debit (manual deduction)
    OLD_TOTAL     = Column(Float, nullable=True)
    NEW_TOTAL     = Column(Float, nullable=True)
    REASON        = Column(String(255), nullable=False)
    NOTES         = Column(Text, nullable=True)
    ADJUSTED_BY_ID = Column(String(36), ForeignKey("employee.ID"), nullable=True)
    ADJUSTED_AT   = Column(DateTime, default=datetime.utcnow)
    VENDOR_ID     = Column(Integer, ForeignKey("vendor.ID"),
                           nullable=False, index=True)
