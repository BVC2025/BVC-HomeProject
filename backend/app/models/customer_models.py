from sqlalchemy import (
    Column, String, Integer, Date, DateTime, Text, Numeric,
    ForeignKey, Index, UniqueConstraint,
    Enum as SAEnum,
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from app.utils.datetime_utils import now_ist
import uuid


# HOLD: the assignment has a triggered Payment Milestone (see
# project_milestone_models.PaymentMilestone/CustomerProjectMilestoneStatus)
# whose required payment hasn't been made yet — set/cleared automatically
# by payment_milestone_service.evaluate_milestones_for_assignment(), never
# by hand. Every other value predates this feature and is otherwise
# unaffected (in practice, every existing row simply defaults to ASSIGNED —
# confirmed no other code transitions or filters on this column).
PROJECT_STATUS_ENUM = SAEnum(
    "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "HOLD",
    name="project_status_enum", create_constraint=True
)

# Quotation lifecycle — used by CustomerProjectQuotation, the child table
# below (one CustomerProjectAssignment "this Lead converted to this
# Customer+Project" row can have up to two CustomerProjectQuotation
# children: one FINAL_QUOTATION and one REVISED_QUOTATION).
QUOTATION_TYPE_ENUM = SAEnum(
    "FINAL_QUOTATION", "REVISED_QUOTATION",
    name="quotation_type_enum", create_constraint=True
)
QUOTATION_STATUS_ENUM = SAEnum(
    "PENDING", "APPROVED", "REJECTED",
    name="quotation_status_enum", create_constraint=True
)

# Reserved extension point (see CustomerProjectPayment below) — every
# payment recorded today lands as RECORDED; future phases can add e.g.
# VERIFIED/DISPUTED without a data migration since the column already exists.
PAYMENT_STATUS_ENUM = SAEnum(
    "RECORDED",
    name="customer_payment_status_enum", create_constraint=True
)

# CustomerProjectTask.STATUS lifecycle — set/transitioned by the
# automatic production scheduling / task assignment engine (see
# app/services/production_scheduling_service.py). EXTENDED/OVERDUE are
# distinct from IN_PROGRESS so a task that blew past its DUE_DATE (or had
# one) is visibly flagged rather than silently indistinguishable from one
# still on track.
TASK_STATUS_ENUM = SAEnum(
    "PENDING", "IN_PROGRESS", "COMPLETED", "EXTENDED", "OVERDUE",
    name="task_status_enum", create_constraint=True
)

# ProductionSchedule.STATUS — the propose/approve/reject workflow state
# for ONE CustomerProjectAssignment's automatic production scheduling.
# Deliberately separate from CustomerProjectAssignment.STATUS (which
# already means ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED/HOLD) — see
# ProductionSchedule's own docstring for why these are not merged.
PRODUCTION_SCHEDULE_STATUS_ENUM = SAEnum(
    "PROPOSED", "APPROVED", "REJECTED",
    name="production_schedule_status_enum", create_constraint=True
)


class Customer(Base):
    """
    Customer master — simplified to a fixed core identity/contact/tax
    columns. Anything vendor-specific beyond this core set is managed
    through the generic Custom Field Configuration system
    (CustomField / CustomFieldTableValue) rather than more fixed
    columns here.
    """

    __tablename__ = "customer"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False)

    NAME = Column(String(100), nullable=False)

    COMPANY_NAME = Column(String(100), nullable=True)

    PHONE_NUMBER = Column(String(20), nullable=False)

    EMAIL = Column(String(100), nullable=False)

    ADDRESS = Column(String(255), nullable=False)

    GST_NUMBER = Column(String(50), nullable=True)

    CITY = Column(String(120), nullable=True)

    STATE = Column(String(120), nullable=True)

    PINCODE = Column(String(15), nullable=True)

    COUNTRY_ISO = Column(String(5), nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)

    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    vendor_info = relationship("Vendor", back_populates="customer_info")
    # passive_deletes=True: let the DB's own ON DELETE CASCADE (the FK's
    # ondelete="CASCADE" below) remove assignment rows directly. Without
    # this, SQLAlchemy's default disconnect-on-delete behavior tries to
    # UPDATE each loaded child's CUSTOMER_ID to NULL first — which fails
    # with a NOT NULL constraint violation since that column is required.
    project_assignments = relationship("CustomerProjectAssignment", back_populates="customer", passive_deletes=True)


class CustomerProjectAssignment(Base):
    """Records a Lead's conversion outcome: which Customer ended up
    assigned to which Project, and (if applicable) which Lead drove
    that conversion. Distinct from the legacy CustomerProject
    (table project_legacy) — that one was removed entirely (see the
    Lead-to-Customer-conversion feature's follow-up cleanup); this
    table's PROJECT_ID points at the catalog `project` table
    (project_models.Project), not project_legacy.

    One row per Lead (LEAD_ID stays unique — unchanged from the original
    conversion feature). The quotation lifecycle for that conversion (up
    to one FINAL_QUOTATION and one REVISED_QUOTATION) lives in the child
    table CustomerProjectQuotation below, not on this row — kept as a
    separate table (rather than extra columns here) so each quotation
    send/response is independently queryable/debuggable."""

    __tablename__ = "customer_project_assignment"

    __table_args__ = (
        Index("ix_cpa_vendor_status", "VENDOR_ID", "STATUS"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)

    CUSTOMER_ID = Column(String(36), ForeignKey("customer.ID", ondelete="CASCADE"), nullable=False, index=True)

    PROJECT_ID = Column(String(36), ForeignKey("project.ID", ondelete="RESTRICT"), nullable=False, index=True)

    # unique=True: at most one assignment row per Lead — the DB-level
    # duplicate-conversion guard (see convert_lead() in lead_management.py).
    # Nullable + unique still permits future non-lead-driven assignments
    # (MySQL treats each NULL as distinct under a unique index).
    LEAD_ID = Column(String(36), ForeignKey("lead.ID", ondelete="SET NULL"), nullable=True, unique=True, index=True)

    # How many units of PROJECT_ID the customer purchased/requested under
    # this specific Lead/Customer assignment (e.g. Lead 001 -> Project A ->
    # Quantity 4). Multiplies into the accepted quotation price wherever
    # "total project value" is computed — see customer_payment_service.
    # Captured at PO-upload time (see routes/po_actions.py); defaults to 1
    # (today's implicit single-unit behavior) until then.
    QUANTITY = Column(Integer, nullable=False, default=1)

    START_DATE = Column(Date, nullable=True)

    END_DATE = Column(Date, nullable=True)

    STATUS = Column(PROJECT_STATUS_ENUM, nullable=False, default="ASSIGNED")

    # Staff-maintained (no automatic task-based rollup exists in this
    # codebase today — Task/TaskAssignment have no link to Project at all).
    # Updated from the Customer Payments page as real project work
    # progresses; every update re-evaluates configured Payment Milestones
    # against it (see payment_milestone_service.evaluate_milestones_for_assignment).
    PROJECT_COMPLETION_PERCENTAGE = Column(Numeric(5, 2), nullable=False, default=0)

    CREATED_AT = Column(DateTime, default=now_ist)

    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    customer = relationship("Customer", back_populates="project_assignments")
    milestone_statuses = relationship(
        "CustomerProjectMilestoneStatus", back_populates="assignment",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    # passive_deletes=True: same reasoning as Customer.project_assignments
    # above — let the DB's ON DELETE CASCADE (below) remove quotations
    # directly rather than SQLAlchemy trying to UPDATE them to NULL first.
    quotations = relationship(
        "CustomerProjectQuotation", back_populates="assignment",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    purchase_order = relationship(
        "CustomerProjectPurchaseOrder", back_populates="assignment",
        uselist=False, cascade="all, delete-orphan", passive_deletes=True,
    )
    payments = relationship(
        "CustomerProjectPayment", back_populates="assignment",
        cascade="all, delete-orphan", passive_deletes=True,
        order_by="CustomerProjectPayment.PAYMENT_DATE",
    )
    tasks = relationship(
        "CustomerProjectTask", back_populates="assignment",
        cascade="all, delete-orphan", passive_deletes=True,
    )
    production_schedule = relationship(
        "ProductionSchedule", back_populates="assignment",
        uselist=False, cascade="all, delete-orphan", passive_deletes=True,
    )


class CustomerProjectTask(Base):
    """One live, assignable unit of work under a CustomerProjectAssignment
    — the runtime counterpart of a catalog TaskTemplate (project_models.py)
    once a Lead's Purchase Order + payment milestone has cleared and the
    project's master task list is ready to be worked. TASK_TEMPLATE_ID/
    EMPLOYEE_ID are both nullable (RESTRICT, not SET NULL, matching your
    spec — a resolved template/employee reference should block deletion
    rather than silently detach) since a row can exist before either is
    resolved. Model/table only for now — the auto-assignment engine that
    populates these rows and the Gantt Chart view that reads them are a
    separate, later phase."""

    __tablename__ = "customer_project_task"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    ASSIGNMENT_ID = Column(
        String(36), ForeignKey("customer_project_assignment.ID", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    TASK_TEMPLATE_ID = Column(String(36), ForeignKey("task_template.ID", ondelete="RESTRICT"), nullable=True)

    EMPLOYEE_ID = Column(String(36), ForeignKey("employee.ID", ondelete="RESTRICT"), nullable=True)

    # 1-based unit index for TASK_SCOPE=UNIT task templates (one row set
    # per project unit); NULL for TASK_SCOPE=PROJECT (created once).
    PROJECT_UNIT_NUMBER = Column(Integer, nullable=True)

    ESTIMATED_DAYS  = Column(Integer, default=0)
    ESTIMATED_HOURS = Column(Numeric(5, 2), default=0.0)
    EXTEND_COUNT    = Column(Integer, default=0)

    # Populated by task_generation_service.py at generation time.
    # DUE_DATE (below) is the planned END — kept as originally named.
    ASSIGNED_DATE      = Column(DateTime, nullable=True)
    PLANNED_START_DATE = Column(DateTime, nullable=True)
    ACTUAL_START_DATE  = Column(DateTime, nullable=True)  # set when STATUS -> IN_PROGRESS

    DUE_DATE        = Column(DateTime, nullable=True)
    COMPLETED_DATE  = Column(DateTime, nullable=True)

    STATUS = Column(TASK_STATUS_ENUM, default="PENDING")

    # Idempotency guards for production_reminder_scheduler.py — each is
    # stamped once its reminder email is sent, never re-sent.
    DAY_BEFORE_REMINDER_SENT_AT = Column(DateTime, nullable=True)
    START_DATE_REMINDER_SENT_AT = Column(DateTime, nullable=True)

    CREATED_AT = Column(DateTime, nullable=False, default=now_ist)
    UPDATED_AT = Column(DateTime, nullable=False, default=now_ist, onupdate=now_ist)

    assignment = relationship("CustomerProjectAssignment", back_populates="tasks")
    task_template = relationship("TaskTemplate", foreign_keys=[TASK_TEMPLATE_ID])
    employee = relationship("Employee", foreign_keys=[EMPLOYEE_ID])


class ProductionSchedule(Base):
    """One row per CustomerProjectAssignment — tracks the automatic
    production-scheduling workflow triggered once the first configured
    Payment Milestone is reached (see payment_milestone_service.
    evaluate_milestones_for_assignment(), which calls
    production_scheduling_service.evaluate_and_propose_schedule()).

    Deliberately does NOT reuse or extend CustomerProjectAssignment.STATUS
    (ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED/HOLD already means something
    else — the post-production progress of the assignment) — this row's
    own STATUS (PROPOSED/APPROVED/REJECTED) plus TASKS_GENERATED_AT fully
    describe the new pre-production workflow's state, so the two systems
    never conflict.

    PLAN_SNAPSHOT_JSON captures the proposed task/manpower/employee-
    candidate breakdown used to build the approval email and review page.
    The real source of truth once APPROVED is the actual generated
    CustomerProjectTask rows, not this snapshot — it exists purely for
    audit/display of what was originally proposed."""

    __tablename__ = "production_schedule"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # unique=True: at most one schedule per assignment — a DB-level
    # IntegrityError backstops the application-level idempotency check in
    # evaluate_and_propose_schedule() against a concurrent duplicate-fire.
    ASSIGNMENT_ID = Column(
        String(36), ForeignKey("customer_project_assignment.ID", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )

    SUGGESTED_START_DATE = Column(DateTime, nullable=False)
    SUGGESTED_REASON     = Column(Text, nullable=True)

    ESTIMATED_DURATION_DAYS   = Column(Numeric(10, 2), nullable=True)
    ESTIMATED_COMPLETION_DATE = Column(DateTime, nullable=True)

    # Set only when the suggested date is rejected and a new one chosen —
    # must be >= SUGGESTED_START_DATE (enforced in
    # production_scheduling_service.reject_and_reschedule()).
    CHOSEN_START_DATE = Column(DateTime, nullable=True)

    STATUS = Column(PRODUCTION_SCHEDULE_STATUS_ENUM, nullable=False, default="PROPOSED")

    PLAN_SNAPSHOT_JSON = Column(Text, nullable=True)

    APPROVED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    APPROVED_AT    = Column(DateTime, nullable=True)

    REJECTED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    REJECTED_AT    = Column(DateTime, nullable=True)
    REJECT_REASON  = Column(Text, nullable=True)

    # Idempotency guard for task_generation_service.py — CustomerProjectTask
    # rows are generated exactly once, the instant this is first set.
    TASKS_GENERATED_AT = Column(DateTime, nullable=True)

    CREATED_AT = Column(DateTime, nullable=False, default=now_ist)
    UPDATED_AT = Column(DateTime, nullable=False, default=now_ist, onupdate=now_ist)

    assignment = relationship("CustomerProjectAssignment", back_populates="production_schedule")


class CustomerProjectQuotation(Base):
    """The quotation-history child of one CustomerProjectAssignment row —
    at most one FINAL_QUOTATION and one REVISED_QUOTATION per assignment
    (enforced by uq_cpq_assignment_type), each independently tracking its
    own price, status (PENDING/APPROVED/REJECTED), send time, customer
    response time, and (REVISED_QUOTATION only) revision reason. Kept as
    its own table rather than columns on CustomerProjectAssignment so each
    quotation send/response is independently queryable and debuggable."""

    __tablename__ = "customer_project_quotation"

    __table_args__ = (
        UniqueConstraint("ASSIGNMENT_ID", "QUOTATION_TYPE", name="uq_cpq_assignment_type"),
        Index("ix_cpq_status", "QUOTATION_STATUS"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    ASSIGNMENT_ID = Column(
        String(36), ForeignKey("customer_project_assignment.ID", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    QUOTATION_TYPE   = Column(QUOTATION_TYPE_ENUM, nullable=False)
    QUOTATION_STATUS = Column(QUOTATION_STATUS_ENUM, nullable=False, default="PENDING")
    QUOTED_PRICE     = Column(Numeric(14, 2), nullable=False)
    REVISION_REASON  = Column(Text, nullable=True)  # REVISED_QUOTATION only

    # Required by the API when QUOTATION_STATUS is set to REJECTED (never
    # required on APPROVED) — enforced in quotation_actions.py / lead_management.py,
    # not at the DB layer, since the row is created before a decision exists.
    REJECTION_REASON = Column(Text, nullable=True)

    # Opaque, high-entropy public token for the email Accept/Reject links —
    # same secrets.token_urlsafe()-in-a-unique-column convention already
    # used by LeaveRequest.APPROVAL_TOKEN / SupplierInvitation.TOKEN.
    ACTION_TOKEN = Column(String(64), unique=True, nullable=True, index=True)

    SENT_AT      = Column(DateTime, nullable=True)
    RESPONDED_AT = Column(DateTime, nullable=True)

    # Set once a Purchase Order Request email has actually been sent for
    # this (APPROVED) quotation — the duplicate-send guard shared by both
    # the automatic (on-approval) and manual "Send Purchase Order Request"
    # paths. Never set on a REJECTED quotation.
    PO_REQUEST_SENT_AT = Column(DateTime, nullable=True)

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    assignment = relationship("CustomerProjectAssignment", back_populates="quotations")


class CustomerProjectPurchaseOrder(Base):
    """The Purchase Order document for one CustomerProjectAssignment row —
    exactly one row per assignment (unlike CustomerProjectQuotation, a PO
    is corrected/replaced in place, never versioned as FINAL/REVISED). The
    row is created (get-or-create, UPLOAD_TOKEN generated once) the first
    time a Purchase Order Request email is sent, auto or manual; FILE_*/
    COMMENTS/UPLOADED_AT are populated once the customer (or, on their
    behalf, staff) actually uploads a PDF, and updated in place on every
    re-upload. Mirrors CustomerProjectQuotation's shape (UUID PK, FK to
    the parent assignment, an opaque never-rotated public token, lifecycle
    timestamps) for the same debuggability reason that table was split out
    as its own child table rather than columns on the assignment row."""

    __tablename__ = "customer_project_purchase_order"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    ASSIGNMENT_ID = Column(
        String(36), ForeignKey("customer_project_assignment.ID", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )

    # Opaque, high-entropy public token for the customer's upload link —
    # same secrets.token_urlsafe()-in-a-unique-column convention as
    # CustomerProjectQuotation.ACTION_TOKEN, but never rotated/burned: the
    # same link keeps working for repeat re-uploads.
    UPLOAD_TOKEN = Column(String(64), unique=True, nullable=True, index=True)

    FILE_URL   = Column(String(500), nullable=True)
    FILE_NAME  = Column(String(255), nullable=True)
    MIME       = Column(String(100), nullable=True)
    SIZE_BYTES = Column(Integer, nullable=True)

    COMMENTS = Column(Text, nullable=True)

    UPLOADED_AT  = Column(DateTime, nullable=True)

    # 0 = never uploaded, 1 = first upload, 2+ = reuploaded — lets the
    # staff notification email say "Uploaded" vs "Reuploaded".
    UPLOAD_COUNT = Column(Integer, nullable=False, default=0)

    UPLOADED_BY_SOURCE = Column(String(20), nullable=True)  # "CUSTOMER" | "STAFF"
    UPLOADED_BY_EMPLOYEE_ID = Column(
        String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True,
    )

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    assignment = relationship("CustomerProjectAssignment", back_populates="purchase_order")


class CustomerProjectPayment(Base):
    """One customer payment record against the accepted (APPROVED)
    CustomerProjectQuotation of a CustomerProjectAssignment — unlike
    CustomerProjectPurchaseOrder (exactly one row per assignment), an
    assignment can have MANY payments (e.g. 60% then 40%, or several
    partial installments). PAYMENT_PERCENTAGE is always server-computed
    from the accepted quotation amount at the time the row is created —
    never trusted from the client. Mirrors CustomerProjectPurchaseOrder's
    file-metadata columns and CUSTOMER/STAFF provenance columns for the
    same reasons that table already established."""

    __tablename__ = "customer_project_payment"

    __table_args__ = (
        Index("ix_cpp_assignment", "CUSTOMER_PROJECT_ASSIGNMENT_ID"),
    )

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="CASCADE"), nullable=False, index=True)

    CUSTOMER_PROJECT_ASSIGNMENT_ID = Column(
        String(36), ForeignKey("customer_project_assignment.ID", ondelete="CASCADE"),
        nullable=False, index=True,
    )

    PAYMENT_AMOUNT     = Column(Numeric(14, 2), nullable=False)
    PAYMENT_PERCENTAGE = Column(Numeric(5, 2), nullable=False)  # server-computed, see customer_payment_service.record_payment
    # DateTime (not just Date) so the actual time-of-payment is captured —
    # populated via now_ist()'s naive-IST convention, same as every other
    # timestamp column in this codebase, so formatDateTime() on the frontend
    # renders a real time instead of a fabricated one.
    PAYMENT_DATE       = Column(DateTime, nullable=False)

    FILE_URL   = Column(String(500), nullable=True)
    FILE_NAME  = Column(String(255), nullable=True)
    MIME       = Column(String(100), nullable=True)
    SIZE_BYTES = Column(Integer, nullable=True)

    PAYMENT_REFERENCE_NUMBER = Column(String(100), nullable=True)
    PAYMENT_STATUS = Column(PAYMENT_STATUS_ENUM, nullable=False, default="RECORDED")

    # Best-effort attribution — set only when THIS payment is the one that
    # brought a milestone's cumulative requirement from REQUESTED to
    # COMPLETED (see payment_milestone_service.evaluate_milestones_for_assignment).
    # NULL for payments made ahead of any triggered milestone, or when a
    # milestone became satisfied via a completion-percentage update alone.
    MILESTONE_ID = Column(
        String(36), ForeignKey("payment_milestone.ID", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    COMMENTS = Column(Text, nullable=True)

    RECORDED_BY_SOURCE = Column(String(20), nullable=True)  # "CUSTOMER" | "STAFF"
    RECORDED_BY_EMPLOYEE_ID = Column(
        String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True,
    )

    CREATED_AT = Column(DateTime, default=now_ist)
    UPDATED_AT = Column(DateTime, default=now_ist, onupdate=now_ist)

    assignment = relationship("CustomerProjectAssignment", back_populates="payments")
