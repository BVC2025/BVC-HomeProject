from sqlalchemy import (
    Column, String, Integer, ForeignKey, Float, Date, Time,
    Text, UniqueConstraint, DateTime, Boolean, Numeric, JSON,
    Enum as SAEnum
)
from sqlalchemy.orm import relationship
from app.database.database import Base
from datetime import datetime
import re
import uuid
from app.utils.datetime_utils import now_ist

from app.models.project_models import (  # noqa: F401
    ProjectCategory, Project, TaskTemplate, TaskTemplateRequirement, TaskGroup, ProjectPricing,
    ProjectProductRequirement,
)
from app.models.project_milestone_models import PaymentMilestone, CustomerProjectMilestoneStatus  # noqa: F401
from app.models.supplier_models import Supplier  # noqa: F401
from app.models.email_models import VendorEmailConfig, EmailTemplate  # noqa: F401
from app.models.lead_models import LeadPollingConfig, Lead, LeadPollingLog, LeadModuleSetting  # noqa: F401
from app.models.customer_models import (  # noqa: F401
    Customer, CustomerProjectAssignment, CustomerProjectQuotation, CustomerProjectPurchaseOrder,
    CustomerProjectPayment, CustomerProjectTask, ProductionSchedule,
)
from app.models.project_quotation_models import ProjectQuotationTemplate  # noqa: F401
from app.models.whatsapp_models import (  # noqa: F401
    VendorWhatsAppConfig, WhatsAppModuleSetting, WhatsAppConversation, WhatsAppMessage, WhatsAppWebhookEvent,
)
from app.models.rbac_models import (  # noqa: F401
    RootUser, IAMUser, EmployeePermissionOverride, EmployeePermissionOverrideAudit,
)
from app.models.auth_models import RefreshToken, LoginLockout  # noqa: F401
from app.models.employee_models import (  # noqa: F401
    Employee, Department, Designation, EmployeeOnboardingSession,
    EmployeeDocument, EmployeeMemo, EmployeeAllowance, EmployeeStatusHistory,
)
from app.models.leave_models import (  # noqa: F401
    LeaveRequest, LeaveBalance, LeaveQuotaPolicy, AILeaveConversation, LeaveBalanceAdjustment,
)
from app.models.email_send_rule_models import EmailSendRule, EmailSendRuleRecipient  # noqa: F401
__all__ = ["ProjectCategory", "Project", "TaskTemplate", "ProjectPricing", "PaymentMilestone", "CustomerProjectMilestoneStatus", "Supplier", "VendorEmailConfig", "EmailTemplate", "LeadPollingConfig", "Lead", "LeadPollingLog", "LeadModuleSetting", "Customer", "CustomerProjectAssignment", "CustomerProjectQuotation", "CustomerProjectPurchaseOrder", "CustomerProjectPayment", "ProjectQuotationTemplate", "VendorWhatsAppConfig", "WhatsAppModuleSetting", "WhatsAppConversation", "WhatsAppMessage", "WhatsAppWebhookEvent", "RootUser", "IAMUser", "EmployeePermissionOverride", "EmployeePermissionOverrideAudit", "RefreshToken", "LoginLockout", "Employee", "Department", "Designation", "EmployeeOnboardingSession", "EmployeeDocument", "EmployeeMemo", "EmployeeAllowance", "EmployeeStatusHistory", "LeaveRequest", "LeaveBalance", "LeaveQuotaPolicy", "AILeaveConversation", "LeaveBalanceAdjustment", "EmailSendRule", "EmailSendRuleRecipient"]  # re-exported from dedicated model files

# ──────────────────────────────────────────────
# Shared SQLAlchemy Enum types
# ──────────────────────────────────────────────
FIELD_TYPE_ENUM = SAEnum(
    "TEXT", "NUMBER", "DATE", "DATETIME", "CHECKBOX",
    "RADIO", "SELECT", "TEXTAREA", "EMAIL", "PHONE",
    name="field_type_enum", create_constraint=True
)
UNIT_ENUM = SAEnum(
    "PCS", "KG", "GRAM", "LITER", "ML",
    "METER", "CM", "BOX", "PACK", "SET",
    name="unit_enum", create_constraint=True
)
DURATION_UNIT_ENUM = SAEnum(
    "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS",
    name="duration_unit_enum", create_constraint=True
)
TASK_STATUS_ENUM = SAEnum(
    "PENDING", "IN_PROGRESS", "COMPLETED", "EXTENDED", "OVERDUE",
    name="task_status_enum", create_constraint=True
)
ASSIGNMENT_MODE_ENUM = SAEnum(
    "PARALLEL", "SEQUENTIAL",
    name="assignment_mode_enum", create_constraint=True
)

# ──────────────────────────────────────────────
# Shared SQLAlchemy Enum types
# ──────────────────────────────────────────────
FIELD_TYPE_ENUM = SAEnum(
    "TEXT", "NUMBER", "DATE", "DATETIME", "CHECKBOX",
    "RADIO", "SELECT", "TEXTAREA", "EMAIL", "PHONE",
    name="field_type_enum", create_constraint=True
)
UNIT_ENUM = SAEnum(
    "PCS", "KG", "GRAM", "LITER", "ML",
    "METER", "CM", "BOX", "PACK", "SET",
    name="unit_enum", create_constraint=True
)
DURATION_UNIT_ENUM = SAEnum(
    "HOURS", "DAYS", "WEEKS", "MONTHS", "YEARS",
    name="duration_unit_enum", create_constraint=True
)
TASK_STATUS_ENUM = SAEnum(
    "PENDING", "IN_PROGRESS", "COMPLETED", "EXTENDED", "OVERDUE",
    name="task_status_enum", create_constraint=True
)
ASSIGNMENT_MODE_ENUM = SAEnum(
    "PARALLEL", "SEQUENTIAL",
    name="assignment_mode_enum", create_constraint=True
)

class Vendor(Base):
    __tablename__ = "vendor"

    __table_args__ = (
        UniqueConstraint("ACCOUNT_ID", name="uq_vendor_account_id"),
    )

    ID = Column(Integer, primary_key=True)
    VENDOR_NAME = Column(String(100))

    # ---- RBAC Phase 1: Account-level extension ----
    ACCOUNT_ID = Column(String(12), nullable=True)
    # Unique, permanent account identifier (AWS-Account-ID style).
    # Generated once at vendor-creation time; no route ever accepts
    # it in an update payload, so it's treated as immutable.

    PRIMARY_CONTACT_NAME = Column(String(100), nullable=True)

    PRIMARY_CONTACT_EMAIL = Column(String(150), nullable=True)

    PRIMARY_CONTACT_PHONE = Column(String(20), nullable=True)

    ACCOUNT_STATUS = Column(String(20), nullable=False, default="ACTIVE")
    # ACTIVE / SUSPENDED / CLOSED

    ROOT_MFA_ENFORCED = Column(Integer, nullable=False, default=0)
    # Account-level policy switch (not enforced yet) — does this
    # account require its Root User to have MFA enabled.

    IAM_PASSWORD_MIN_LENGTH = Column(Integer, nullable=False, default=8)
    # Account-level policy switch (not enforced yet) — minimum
    # password length required for this account's IAM Users.

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    root_users = relationship("RootUser", back_populates="vendor")
    email_configurations = relationship(
        "VendorEmailConfig",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    email_templates = relationship(
        "EmailTemplate",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    lead_polling_configs = relationship(
        "LeadPollingConfig",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    leads = relationship(
        "Lead",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    lead_polling_logs = relationship(
        "LeadPollingLog",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    whatsapp_configs = relationship(
        "VendorWhatsAppConfig",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    whatsapp_module_settings = relationship(
        "WhatsAppModuleSetting",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    whatsapp_conversations = relationship(
        "WhatsAppConversation",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )
    customer_info = relationship(
        "Customer",
        back_populates="vendor_info",
        cascade="all, delete-orphan",
    )
    payment_milestones = relationship(
        "PaymentMilestone",
        back_populates="vendor",
        cascade="all, delete-orphan",
    )

# Employee moved to app/models/employee_models.py (re-exported below).

class Role(Base):

    __tablename__ = "role"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "NAME", name="uq_role_vendor_name"),
    )

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    DEPARTMENT_ID = Column(Integer, ForeignKey("department.ID", ondelete="SET NULL"), nullable=True, index=True)

    NAME = Column(String(100), nullable=False)

    CODE = Column(String(10), nullable=True)
    # Short code used to build Employee IDs (e.g. "SM" for
    # SALES_MANAGER, "ELE" for ELECTRICAL) — see derive_role_code()
    # below. Nullable/admin-editable, mirroring Department.DEPARTMENT_CODE;
    # auto-derived on backfill for pre-existing rows and on creation for
    # new ones, never hardcoded per-role in application code.

    DESCRIPTION = Column(String(500), nullable=True)

    IS_SYSTEM = Column(Integer, default=0)
    # 1 = standard role seeded by us (cannot be deleted)
    # 0 = custom role created by admin

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def derive_role_code(name: str) -> str:
    """Best-effort short code from a Role NAME, used whenever Role.CODE
    is blank (pre-existing rows on migration, or a role created without
    an explicit code). Multi-word names → initials of each word
    ("SALES_MANAGER" -> "SM"); single-word names → first 3 letters
    ("ELECTRICAL" -> "ELE"). Callers are responsible for resolving
    collisions against already-used codes (see main.py's role-code
    backfill migration) — this function alone doesn't guarantee
    uniqueness."""

    words = [w for w in re.split(r"[\s_\-]+", (name or "").strip()) if w]
    if not words:
        return "GEN"
    if len(words) == 1:
        return (words[0][:3] or "GEN").upper()
    return "".join(w[0] for w in words).upper()


# Department, Designation moved to app/models/employee_models.py (re-exported below).


class Permission(Base):

    __tablename__ = "permission"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True
    )

    CODE = Column(String(60), unique=True, index=True)
    # e.g. "task.assign", "employee.delete", "report.export"

    NAME = Column(String(120))
    # human-readable label for the admin UI

    CATEGORY = Column(String(40))
    # for grouping in the UI: "Employees", "Projects", "Tasks", ...

    DESCRIPTION = Column(String(255), nullable=True)


class RolePermission(Base):

    __tablename__ = "role_permission"

    ROLE_ID = Column(
        Integer,
        ForeignKey("role.ID"),
        primary_key=True
    )

    PERMISSION_ID = Column(
        Integer,
        ForeignKey("permission.ID"),
        primary_key=True
    )



class Task(Base):
    START_TIME = Column(DateTime, nullable=True)

    END_TIME = Column(DateTime, nullable=True)

    __tablename__ = "task"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    TASK_NAME = Column(
        String(100)
    )

    DESCRIPTION = Column(
        String(255)
    )

    STATUS = Column(
        String(50),
        default="PENDING"
    )

    PRIORITY = Column(
        String(50),
        default="MEDIUM"
    )

    ASSIGNED_TO = Column(
        String(36),
        ForeignKey("employee.ID")
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )


class Inventory(Base):

    __tablename__ = "inventory"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    PRODUCT_ID = Column(
        String(36),
        ForeignKey("product_master.ID", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    MATERIAL_NAME = Column(
        String(100)
    )

    QUANTITY = Column(
        Integer,
        default=0
    )

    UNIT_PRICE = Column(
        Float,
        default=0.0
    )

    MIN_STOCK = Column(
        Integer,
        default=0
    )
    # Reorder threshold. When QUANTITY drops at or below this value,
    # a low-stock Notification is generated. 0 means alerts disabled
    # for this row.

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )


class Setting(Base):

    __tablename__ = "setting"

    KEY = Column(String(50), primary_key=True)

    VALUE = Column(String(500))

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow
    )


class TaskAssignment(Base):

    __tablename__ = "task_assignment"

    TASK_ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True
    )

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        index=True
    )

    TASK_NAME = Column(String(150))

    TASK_DETAILS = Column(String(500))

    ASSIGNED_DATE = Column(Date, index=True)

    DUE_DATE = Column(Date, nullable=True)

    TASK_STATUS = Column(
        String(20),
        default="PENDING"
    )

    # ---- Approval workflow ----
    # PENDING_APPROVAL: created but not yet approved by authority
    # APPROVED:        confirmed; employee can see the task
    # REJECTED:        authority rejected; task is hidden, not deleted
    # EXPIRED:         24h passed without action
    APPROVAL_STATUS = Column(
        String(20),
        default="APPROVED",
        index=True
    )

    APPROVAL_TOKEN = Column(
        String(64),
        unique=True,
        nullable=True,
        index=True
    )

    APPROVAL_REQUESTED_AT = Column(DateTime, nullable=True)

    APPROVAL_RESOLVED_AT = Column(DateTime, nullable=True)

    ASSIGNED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    START_TIME = Column(DateTime, nullable=True)

    END_TIME = Column(DateTime, nullable=True)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow
    )

    # Link back to a Help Desk ticket when the task was auto-created
    # from a ticket assignment (Admin → Help Desk → Assign to). Used
    # to find + cancel the old task when the ticket is reassigned to
    # a different employee, so the assignee's Tasks list stays clean.
    HELPDESK_TICKET_ID = Column(
        Integer,
        ForeignKey("help_desk_ticket.ID"),
        nullable=True,
        index=True,
    )


# EmployeeAttendance removed in Module 2 — merged into Attendance
# (which now points to Employee.ID directly).


class Notification(Base):

    __tablename__ = "notification"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    TITLE = Column(String(150))

    MESSAGE = Column(String(500))

    TYPE = Column(
        String(20),
        default="INFO"
    )

    IS_READ = Column(
        Integer,
        default=0
    )

    CREATED_AT = Column(
        DateTime,
        # datetime.now() — the server clock is IST, and every other
        # DateTime column in this schema stores IST wall-clock. Using
        # utcnow() here made notification timestamps show up 5:30 h
        # behind reality on the frontend ('5h ago' for a just-issued
        # payslip). Local-clock keeps timestamps consistent with
        # ATTENDANCE, PAYROLL_RUN, MEMO, ALLOWANCE, etc.
        default=datetime.now
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True
    )

    # ---- Per-employee targeting (added for automated memo delivery) ----
    # NULL = broadcast to every employee (matches legacy behavior).
    # Non-NULL = only that employee should see it. The /notifications
    # endpoint filters on this when ?employee_id= is passed.
    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
        index=True,
    )

    # ---- Deep-link payload ----
    # REF_TYPE + REF_ID lets the frontend open the referenced record when
    # the notification is clicked, e.g. REF_TYPE="MEMO" REF_ID=42.
    REF_TYPE = Column(String(30), nullable=True)
    REF_ID   = Column(Integer, nullable=True)


class Attendance(Base):
    """
    Unified attendance table (Module 2).
    Replaces the old IAMUser-keyed Attendance AND the demo
    EmployeeAttendance. Every row is one (employee, date) pair.
    """

    __tablename__ = "attendance"

    __table_args__ = (
        UniqueConstraint(
            "EMPLOYEE_ID",
            "DATE",
            name="uq_attendance_employee_date"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        index=True
    )

    DATE = Column(
        Date,
        default=datetime.utcnow,
        index=True
    )

    CHECK_IN = Column(DateTime, nullable=True)

    CHECK_OUT = Column(DateTime, nullable=True)

    STATUS = Column(
        String(20),
        default="PRESENT"
    )
    # PRESENT / LATE / ABSENT / HALF_DAY

    WORKED_HOURS = Column(Float, nullable=True)

    OVERTIME_HOURS = Column(Float, default=0.0)

    # ---- Explicit OT session (separate from regular CHECK_IN/CHECK_OUT) ----
    # An employee logs OT only AFTER their regular check-out. OVERTIME_HOURS
    # above is computed from (OT_CHECK_OUT - OT_CHECK_IN) — regular hours over
    # 8 are NOT auto-credited as OT anymore.
    OT_CHECK_IN  = Column(DateTime, nullable=True)
    OT_CHECK_OUT = Column(DateTime, nullable=True)

    REMARKS = Column(String(255), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )

    # ---- Geofencing (Module: Geofenced Attendance) ----
    # Captured at check-in / check-out time so the admin can audit
    # exactly where the employee was when they marked attendance.
    CHECKIN_LATITUDE   = Column(Float, nullable=True)
    CHECKIN_LONGITUDE  = Column(Float, nullable=True)
    CHECKIN_DISTANCE   = Column(Float, nullable=True)   # metres from office
    CHECKOUT_LATITUDE  = Column(Float, nullable=True)
    CHECKOUT_LONGITUDE = Column(Float, nullable=True)
    CHECKOUT_DISTANCE  = Column(Float, nullable=True)

    GEOFENCE_STATUS    = Column(String(20), nullable=True)
    # INSIDE / OUTSIDE / UNKNOWN  — set at check-in time

    DEVICE_INFO        = Column(String(255), nullable=True)
    BROWSER_INFO       = Column(String(255), nullable=True)
    IP_ADDRESS         = Column(String(60), nullable=True)


# =====================================================================
# Geofence settings — single-row config per vendor for office location
# =====================================================================

class GeofenceSettings(Base):
    """Office coordinates + allowed radius. One row per vendor.
    Used by the attendance flow to validate that the employee is
    physically near the office before allowing biometric scan."""

    __tablename__ = "geofence_settings"

    ID            = Column(Integer, primary_key=True, autoincrement=True)
    VENDOR_ID     = Column(Integer, ForeignKey("vendor.ID"), index=True, nullable=True)
    OFFICE_NAME   = Column(String(150), nullable=True)
    LATITUDE      = Column(Float, nullable=False, default=0.0)
    LONGITUDE     = Column(Float, nullable=False, default=0.0)
    RADIUS_METERS = Column(Integer, nullable=False, default=50)
    IS_ACTIVE     = Column(Integer, default=1)
    # 1 = enforce geofencing, 0 = allow attendance from anywhere (kill-switch)
    CREATED_AT    = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# =====================================================================
# Attendance security log — every blocked / failed attempt
# =====================================================================

class AttendanceSecurityLog(Base):
    """One row per failed attendance attempt. Helps the admin spot
    employees trying to mark attendance from outside the office, GPS
    spoofing attempts, or simple GPS permission denials."""

    __tablename__ = "attendance_security_logs"

    ID          = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID = Column(String(36), ForeignKey("employee.ID"), index=True, nullable=True)
    LATITUDE    = Column(Float, nullable=True)
    LONGITUDE   = Column(Float, nullable=True)
    DISTANCE    = Column(Float, nullable=True)
    REASON      = Column(String(80), nullable=True, index=True)
    # OUTSIDE_GEOFENCE / GPS_DISABLED / PERMISSION_DENIED / FACE_FAILED / etc.
    DETAIL      = Column(String(500), nullable=True)
    DEVICE_INFO = Column(String(255), nullable=True)
    IP_ADDRESS  = Column(String(60), nullable=True)
    VENDOR_ID   = Column(Integer, ForeignKey("vendor.ID"), nullable=True)
    CREATED_AT  = Column(DateTime, default=datetime.utcnow, index=True)


class BiometricEvent(Base):
    """
    Raw event log from the biometric device (ZKTeco / eSSL /
    Mantra). One row per finger scan, regardless of whether
    the scan resolved to a known employee or triggered a
    successful check-in.

    The fingerprint device pushes a payload that typically
    looks like:
        {
          "device_id": "ZK-GATE-01",
          "fingerprint_id": "1042",     # device-side USER_ID
          "timestamp": "...",
          "verify_mode": "FP" | "FACE" | "CARD" | "PWD",
          "raw": "<vendor-specific blob>"
        }
    """

    __tablename__ = "biometric_event"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    DEVICE_ID = Column(String(50), index=True)

    FINGERPRINT_ID = Column(String(50), index=True)

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
        index=True
    )
    # null when the device fingerprint_id couldn't be matched
    # to any employee (unregistered finger).

    EVENT_TIME = Column(
        DateTime,
        default=datetime.utcnow,
        index=True
    )

    VERIFY_MODE = Column(String(20), nullable=True)
    # FP / FACE / CARD / PWD — what mode the device verified by.

    RESULT = Column(String(20), default="SUCCESS")
    # SUCCESS / UNKNOWN_USER / DUPLICATE / ERROR

    RAW_PAYLOAD = Column(String(1000), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True
    )


class DailyAllocation(Base):
    """
    The output of the AI allocator for a given employee on a
    given day. One row per allocation event — an employee can
    have multiple rows per day when they finish one task and
    the system allocates a new one. SEQUENCE = 1 for the first
    task of the day, 2 for the second, etc.
    """

    __tablename__ = "daily_allocation"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        index=True
    )

    ALLOC_DATE = Column(Date, index=True)

    SEQUENCE = Column(Integer, default=1)
    # 1, 2, 3 ... — position of this task in the day's chain.

    TASK_ASSIGNMENT_ID = Column(
        Integer,
        ForeignKey("task_assignment.TASK_ID"),
        nullable=True
    )

    SCORE = Column(Float, default=0.0)

    SCORE_BREAKDOWN = Column(String(500), nullable=True)
    # e.g. "skill=0.75 workload=0.4 priority=1.0"

    REASON = Column(String(255), nullable=True)
    # human-readable explanation surfaced in the UI.

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True
    )


# ====================================================================
# Payroll — monthly salary calculation
# ====================================================================

class PayrollRun(Base):
    """
    One row per (vendor, year, month). Holds the run header so we
    can list past payroll runs, see who generated them, freeze/edit
    state. Per-employee numbers live in PayrollSlip.

    Lifecycle:
      DRAFT       -> just generated, can be re-run / edited
      FINALIZED   -> locked, used for accounting
      PAID        -> money disbursed (manually flagged for now)
    """

    __tablename__ = "payroll_run"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "PAY_YEAR", "PAY_MONTH",
            name="uq_payroll_run_period"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    PAY_YEAR = Column(Integer, index=True)

    PAY_MONTH = Column(Integer, index=True)
    # 1..12

    WORKING_DAYS = Column(Integer, default=26)
    # Days the per-day rate is computed against. Configurable per
    # run so e.g. a 4-Sunday February (24 days) can be handled.

    STATUS = Column(
        String(20),
        default="DRAFT",
        index=True
    )
    # DRAFT / FINALIZED / PAID

    TOTAL_GROSS = Column(Float, default=0.0)

    TOTAL_DEDUCTIONS = Column(Float, default=0.0)

    TOTAL_NET = Column(Float, default=0.0)

    EMPLOYEE_COUNT = Column(Integer, default=0)

    NOTES = Column(String(500), nullable=True)

    GENERATED_BY = Column(String(120), nullable=True)
    # employee code / name of whoever pressed Generate

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    FINALIZED_AT = Column(DateTime, nullable=True)


class PayrollSlip(Base):
    """
    One row per (PayrollRun, Employee). Stores the calculated
    breakdown: attendance count, leave splits, task bonus, late
    penalty, and the final net pay. We snapshot all the numbers so
    a run finalized in March still shows the right values even if
    the employee's SALARY changes later.
    """

    __tablename__ = "payroll_slip"

    __table_args__ = (
        UniqueConstraint(
            "PAYROLL_RUN_ID", "EMPLOYEE_ID",
            name="uq_payroll_slip"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    PAYROLL_RUN_ID = Column(
        Integer,
        ForeignKey("payroll_run.ID"),
        index=True
    )

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        index=True
    )

    # --- Input snapshots (captured at run time) ---
    BASE_SALARY = Column(Float, default=0.0)
    # Employee.SALARY at the moment of generation

    WORKING_DAYS = Column(Integer, default=26)

    PER_DAY_RATE = Column(Float, default=0.0)
    # BASE_SALARY / WORKING_DAYS

    # --- Attendance counters ---
    DAYS_PRESENT = Column(Integer, default=0)

    DAYS_LATE = Column(Integer, default=0)
    # subset of DAYS_PRESENT — counted only for late penalty

    DAYS_HALF = Column(Float, default=0.0)
    # half-day attendance entries — count as 0.5 each

    # --- Leave splits ---
    PAID_LEAVE_DAYS = Column(Float, default=0.0)
    # CASUAL / SICK / EARNED — counted for salary

    UNPAID_LEAVE_DAYS = Column(Float, default=0.0)
    # UNPAID / LOP — not counted for salary

    ABSENT_DAYS = Column(Float, default=0.0)
    # Working days with neither attendance nor approved leave

    # --- Tasks ---
    TASKS_COMPLETED = Column(Integer, default=0)

    TASK_BONUS_PER_TASK = Column(Float, default=100.0)
    # Configurable bonus rate per completed task

    # --- Money ---
    EARNED_BASIC = Column(Float, default=0.0)
    # PER_DAY_RATE × paid days (present + paid_leave + half×0.5)

    TASK_BONUS = Column(Float, default=0.0)

    OT_HOURS = Column(Float, default=0.0)
    # captured from Attendance.OVERTIME_HOURS sum

    OT_PAY = Column(Float, default=0.0)

    LATE_PENALTY = Column(Float, default=0.0)

    ABSENCE_DEDUCTION = Column(Float, default=0.0)
    # Auto-computed by the generator UI as (Basic ÷ Working Days) ×
    # unpaid_absent_days. Persisted here so it flows into
    # TOTAL_DEDUCTIONS and shows on the payslip preview as a line
    # item. Was previously silently dropped on save.

    OTHER_DEDUCTIONS = Column(Float, default=0.0)
    # legacy placeholder; the typed columns below replaced it

    # ---- Phase E: Salary breakdown (earnings) ----
    HRA                  = Column(Float, default=0.0)
    DA                   = Column(Float, default=0.0)
    CONVEYANCE_ALLOWANCE = Column(Float, default=0.0)
    MEDICAL_ALLOWANCE    = Column(Float, default=0.0)
    SPECIAL_ALLOWANCE    = Column(Float, default=0.0)
    OTHER_ALLOWANCES     = Column(Float, default=0.0)
    ANNUAL_BONUS         = Column(Float, default=0.0)
    INCENTIVES           = Column(Float, default=0.0)

    # ---- Phase E: Statutory deductions ----
    PF_EMPLOYEE     = Column(Float, default=0.0)
    PF_EMPLOYER     = Column(Float, default=0.0)
    ESI_EMPLOYEE    = Column(Float, default=0.0)
    ESI_EMPLOYER    = Column(Float, default=0.0)
    PROFESSIONAL_TAX = Column(Float, default=0.0)

    GROSS_PAY = Column(Float, default=0.0)

    TOTAL_DEDUCTIONS = Column(Float, default=0.0)

    NET_PAY = Column(Float, default=0.0)

    NOTES = Column(String(500), nullable=True)

    # Per-slip payment workflow. Transitions:
    #   PENDING   → default on generation (draft, HR still editing)
    #   SUBMITTED → HR clicked "Submit" on PayslipGenerator; the slip
    #               is now visible in Payroll Records and locked from
    #               further edits by the employee-facing side.
    #   PAID      → admin clicked "Mark Paid" against this row.
    STATUS = Column(String(20), default="PENDING")
    SUBMITTED_AT = Column(DateTime, nullable=True)
    PAID_AT = Column(DateTime, nullable=True)

    # HR-picked date shown on the payslip preview + PDF. Distinct from
    # CREATED_AT (system stamp) and PAID_AT (money-actually-disbursed
    # stamp). Populated by the PayslipGenerator via /generate-for-employee.
    PAY_DATE = Column(Date, nullable=True)

    # Sum of LeaveRequest.DURATION_HOURS for TYPE='PERMISSION' rows
    # falling inside this slip's pay period. Surfaced as an input
    # column on the employee-list view; does not itself affect pay.
    PERMISSION_HOURS = Column(Float, default=0.0)

    # Snapshot of the employee's PerformanceScore.OVERALL_STARS for
    # this pay period (0.0–5.0). Drives STAR_BONUS below.
    PERFORMANCE_STARS = Column(Float, default=0.0)

    # Star-rating-driven bonus added on top of the salary calculation.
    # bonus = round(PERFORMANCE_STARS × BONUS_PER_STAR), included in
    # GROSS_PAY and NET_PAY.
    STAR_BONUS = Column(Float, default=0.0)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)


# ====================================================================
# Phase E: Per-employee salary structure (component breakdown)
# ====================================================================

class SalaryStructure(Base):
    """One row per Employee (latest revision). Stores the monthly
    component breakdown that drives payroll generation.

    If no row exists for an employee, payroll falls back to using
    Employee.SALARY as the BASIC and computes statutory deductions
    from that. Once a row is added, gross = sum of components.
    """

    __tablename__ = "salary_structure"

    __table_args__ = (
        UniqueConstraint(
            "EMPLOYEE_ID",
            name="uq_salary_structure_employee"
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
        nullable=False,
        index=True
    )

    # ---- Earnings (monthly amounts in INR) ----
    BASIC                = Column(Float, default=0.0)
    HRA                  = Column(Float, default=0.0)
    DA                   = Column(Float, default=0.0)
    CONVEYANCE_ALLOWANCE = Column(Float, default=0.0)
    MEDICAL_ALLOWANCE    = Column(Float, default=0.0)
    SPECIAL_ALLOWANCE    = Column(Float, default=0.0)
    OTHER_ALLOWANCES     = Column(Float, default=0.0)
    ANNUAL_BONUS         = Column(Float, default=0.0)
    # Annual bonus paid monthly as 1/12 — store the per-month figure
    INCENTIVES           = Column(Float, default=0.0)
    # Recurring incentive; one-off bonuses use the slip-level field

    # ---- State (for Professional Tax slab) ----
    PT_STATE = Column(String(40), nullable=True, default="TAMIL_NADU")

    # ---- Opt-outs ----
    PF_APPLICABLE  = Column(Integer, default=1)  # 1 = deduct PF
    ESI_APPLICABLE = Column(Integer, default=1)  # 1 = deduct ESI

    NOTES = Column(String(500), nullable=True)

    EFFECTIVE_FROM = Column(Date, nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


# ====================================================================
# Performance — monthly star rating per employee
# ====================================================================

class PerformanceScore(Base):
    """
    One row per (employee, year, month). Stored monthly so the MD
    can see history + comparisons. Stars 0.0-5.0 in 0.5 increments
    (displayed as half-stars in the UI). Final OVERALL_STARS is the
    weighted average of the 4 dimensions.

    Weights:
      attendance     25%
      task_completion 30%
      productivity   25%
      consistency    20%
    """

    __tablename__ = "performance_score"

    __table_args__ = (
        UniqueConstraint(
            "EMPLOYEE_ID", "PAY_YEAR", "PAY_MONTH",
            name="uq_perf_period"
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

    PAY_YEAR = Column(Integer, index=True)

    PAY_MONTH = Column(Integer, index=True)

    # --- Inputs (snapshot at computation time) ---
    WORKING_DAYS = Column(Integer, default=26)

    DAYS_PRESENT = Column(Float, default=0.0)

    HALF_DAYS = Column(Float, default=0.0)

    TASKS_ASSIGNED = Column(Integer, default=0)

    TASKS_COMPLETED = Column(Integer, default=0)

    TASKS_ON_TIME = Column(Integer, default=0)

    ESTIMATED_HOURS = Column(Float, default=0.0)
    # Sum of estimated_hours across completed tasks' stages

    ACTUAL_HOURS = Column(Float, default=0.0)
    # Sum of actual_hours across the same tasks (from WorkOrderStageProgress)

    # --- Inputs added for the Leave + Permission dimensions ---
    LEAVE_DAYS_TAKEN = Column(Float, default=0.0)
    # Approved UNPAID/LOP leave days in this pay period

    PERMISSION_HOURS_TAKEN = Column(Float, default=0.0)
    # Approved PERMISSION leave duration (hours) in this pay period

    # --- Outputs (4 star scores + overall) ---
    # Active dimensions (current scheme): attendance + task + leave + permission
    ATTENDANCE_STARS = Column(Float, default=0.0)

    TASK_STARS = Column(Float, default=0.0)

    LEAVE_STARS = Column(Float, default=0.0)

    PERMISSION_STARS = Column(Float, default=0.0)

    # Legacy dimensions — no longer used in the overall, kept so old
    # rows still serialise without a NULL surprise.
    PRODUCTIVITY_STARS = Column(Float, default=0.0)

    CONSISTENCY_STARS = Column(Float, default=0.0)

    OVERALL_STARS = Column(Float, default=0.0)
    # Equal-weight average of attendance + task + leave + permission

    # --- MD actions taken based on this score ---
    RECOMMENDED_FOR_PROMOTION = Column(Integer, default=0)  # 0/1

    RECOMMENDED_FOR_INCREMENT = Column(Integer, default=0)

    REWARDED = Column(Integer, default=0)

    MD_REMARKS = Column(String(500), nullable=True)

    NOTES = Column(String(500), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


# ====================================================================
# Phase 3 — Quotation Module
# ====================================================================

class PurchaseOrder(Base):
    """
    A purchase order BVC24 issues to a Supplier when buying raw
    materials / components. One PO has many lines; lines link to
    Materials. Receipts (GRNs) update QUANTITY_RECEIVED on each line
    so we can track partial deliveries.

    Lifecycle:
      DRAFT             — being prepared internally
      SENT              — emailed/shared with the supplier
      CONFIRMED         — supplier acknowledged
      PARTIAL_RECEIVED  — some lines received, others pending
      RECEIVED          — all lines fully received
      CANCELLED         — voided
    """

    __tablename__ = "purchase_order"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    PO_NUMBER = Column(String(30), unique=True, index=True)

    SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID"),
        index=True
    )

    PO_DATE = Column(Date, default=datetime.utcnow)

    EXPECTED_DELIVERY_DATE = Column(Date, nullable=True)

    STATUS = Column(String(30), default="DRAFT", index=True)

    SUBTOTAL = Column(Float, default=0.0)

    DISCOUNT_PERCENT = Column(Float, default=0.0)

    DISCOUNT_AMOUNT = Column(Float, default=0.0)

    TAX_PERCENT = Column(Float, default=18.0)

    TAX_AMOUNT = Column(Float, default=0.0)

    GRAND_TOTAL = Column(Float, default=0.0)

    DELIVERY_ADDRESS = Column(String(500), nullable=True)
    # Defaults to BVC24's address but can be overridden per-PO
    # (drop-ship to project site, etc.)

    TERMS_AND_CONDITIONS = Column(String(3000), nullable=True)

    NOTES = Column(String(2000), nullable=True)

    PREPARED_BY = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )


    SENT_AT = Column(DateTime, nullable=True)

    CONFIRMED_AT = Column(DateTime, nullable=True)

    CANCELLED_AT = Column(DateTime, nullable=True)

    CANCEL_REASON = Column(String(500), nullable=True)

    EMAIL_SENT_AT = Column(DateTime, nullable=True)

    EMAIL_SENT_COUNT = Column(Integer, default=0)

    LAST_EMAIL_STATUS = Column(String(200), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True,
        nullable=True
    )

    # Set only when this PO was auto-generated by the low-stock reorder
    # workflow (inventory_reorder_service) — links it to the batch of
    # sibling per-supplier POs proposed together for one consolidated
    # approval. NULL for a manually-created PO.
    BATCH_ID = Column(
        String(36),
        ForeignKey("purchase_order_approval_batch.ID", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

    approval_batch = relationship("PurchaseOrderApprovalBatch", back_populates="purchase_orders")


class PurchaseOrderLine(Base):
    """
    One line on a PO. Links to ProductMaster when possible (so we
    can update Inventory on receipt). QUANTITY_RECEIVED is the
    rolling sum across GRNs — when it reaches QUANTITY, the line is
    fully received.
    """

    __tablename__ = "purchase_order_line"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    PO_ID = Column(
        Integer,
        ForeignKey("purchase_order.ID"),
        index=True
    )

    PRODUCT_ID = Column(
        String(36),
        ForeignKey("product_master.ID", ondelete="SET NULL"),
        nullable=True,
        index=True
    )

    DESCRIPTION = Column(String(500))

    HSN_CODE = Column(String(20), nullable=True)

    QUANTITY = Column(Float, default=1.0)

    QUANTITY_RECEIVED = Column(Float, default=0.0)

    UNIT = Column(String(20), default="pcs")

    UNIT_PRICE = Column(Float, default=0.0)

    DISCOUNT_PERCENT = Column(Float, default=0.0)

    LINE_TOTAL = Column(Float, default=0.0)

    SORT_ORDER = Column(Integer, default=0)


class GoodsReceiptNote(Base):
    """
    GRN — records a delivery from a supplier against a PO. One PO
    can have many GRNs (partial deliveries). Finalizing a GRN pushes
    received quantities into Inventory.

    Lifecycle:
      DRAFT     — being recorded (counts not committed to Inventory)
      FINAL     — locked, Inventory has been updated
    """

    __tablename__ = "goods_receipt_note"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    GRN_NUMBER = Column(String(30), unique=True, index=True)

    PO_ID = Column(
        Integer,
        ForeignKey("purchase_order.ID"),
        index=True
    )

    RECEIVED_DATE = Column(Date, default=datetime.utcnow)

    RECEIVED_BY = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    STATUS = Column(String(20), default="DRAFT")
    # DRAFT / FINAL

    INVOICE_NUMBER = Column(String(50), nullable=True)
    # Supplier's invoice / delivery challan number

    NOTES = Column(String(2000), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True,
        nullable=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    FINALIZED_AT = Column(DateTime, nullable=True)


class GoodsReceiptLine(Base):
    """One line on a GRN — what was received against a specific PO line."""

    __tablename__ = "goods_receipt_line"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    GRN_ID = Column(
        Integer,
        ForeignKey("goods_receipt_note.ID"),
        index=True
    )

    PO_LINE_ID = Column(
        Integer,
        ForeignKey("purchase_order_line.ID"),
        index=True
    )

    QUANTITY_RECEIVED = Column(Float, default=0.0)

    QUANTITY_REJECTED = Column(Float, default=0.0)
    # Bad/damaged units — don't update Inventory but keep audit trail

    REJECTION_REASON = Column(String(500), nullable=True)


class PurchaseOrderActivity(Base):
    """Timeline for PO events — created / sent / confirmed / received."""

    __tablename__ = "purchase_order_activity"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    PO_ID = Column(
        Integer,
        ForeignKey("purchase_order.ID"),
        index=True
    )

    EVENT_TYPE = Column(String(40), index=True)
    # CREATED / SENT / EMAIL_SENT / EMAIL_FAILED / CONFIRMED /
    # GRN_RECORDED / GRN_FINALIZED / CANCELLED / RECEIVED

    EVENT_DETAIL = Column(String(500), nullable=True)

    ACTOR_TYPE = Column(String(20), nullable=True)
    # SYSTEM / SALES / SUPPLIER / WAREHOUSE

    ACTOR_NAME = Column(String(150), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)


class PurchaseOrderApprovalBatch(Base):
    """One row per automatic-reorder proposal cycle — groups the N
    per-supplier DRAFT PurchaseOrder rows that
    inventory_reorder_service.evaluate_and_propose_reorder() creates
    together (one supplier's low-stock products = one PO; several
    suppliers triggered at once = several POs, all under one batch) so
    they can be reviewed and Approved/Rejected as a single consolidated
    decision, mirroring production_scheduling_service.ProductionSchedule's
    propose -> approve/reject shape. A manually-created PO (Part D of the
    inventory-automation feature) simply has no PurchaseOrder row
    pointing at any batch."""

    __tablename__ = "purchase_order_approval_batch"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    STATUS = Column(String(20), default="PROPOSED", index=True)  # PROPOSED / APPROVED / REJECTED
    TRIGGER_TYPE = Column(String(20), default="LOW_STOCK")  # LOW_STOCK / MANUAL

    # Human-readable note — e.g. lists any low-stock products that
    # couldn't be assigned a supplier and were left out of this batch,
    # so the approver isn't left wondering why a known-low product isn't
    # on any of the batch's POs.
    TRIGGER_NOTE = Column(String(1000), nullable=True)

    APPROVED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    APPROVED_AT = Column(DateTime, nullable=True)

    REJECTED_BY_ID = Column(String(36), ForeignKey("employee.ID", ondelete="SET NULL"), nullable=True)
    REJECTED_AT = Column(DateTime, nullable=True)
    REJECT_REASON = Column(String(500), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    purchase_orders = relationship("PurchaseOrder", back_populates="approval_batch")


# ====================================================================
# Phase 5 — Sales Order Module
# ====================================================================
# Sales Orders are the formal contract that follows an APPROVED
# quotation. Each SO line represents a machine/product to be built,
# and finalizing the SO auto-spawns Projects that drive the
# manufacturing workflow already wired in Phases 1-4.

class HolidayCalendar(Base):
    """Vendor-scoped list of non-working calendar dates."""

    __tablename__ = "holiday_calendar"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "HOLIDAY_DATE",
            name="uq_holiday_per_vendor_per_date"
        ),
    )

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=False,
        default=1,
        index=True
    )

    HOLIDAY_DATE = Column(Date, nullable=False, index=True)

    NAME = Column(String(120), nullable=False)
    # Human-readable label — e.g. "Diwali", "Republic Day", "Sankranti"

    TYPE = Column(String(30), default="NATIONAL")
    # NATIONAL / REGIONAL / COMPANY — informational only

    IS_OPTIONAL = Column(Integer, default=0)
    # 0/1: optional holidays (e.g. Easter) — counted in the working-day
    # math only if the admin explicitly marks them as such.

    NOTES = Column(String(500), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


# ====================================================================
# Admin Module 3 — Company Master Settings (2026-06-02)
# ====================================================================
# One row per vendor. Single source of truth for company branding used
# on quotations, sales orders, purchase orders, GRNs, payslips, invoice
# headers, and PDF reports. Auto-seeded with BVC's existing hardcoded
# values on first start so nothing breaks for legacy deployments.

# ====================================================================
# Admin Module 4 — Approval Center (2026-06-02)
# ====================================================================
# Two new tables that fill the gaps in the unified approval feed:
#   * SupplierPayment — admin records a payment to a supplier against
#     a PO. Pending until approved; once approved, the PO's PAID_AMOUNT
#     reflects it.
#   * DiscountRequest — when a customer asks for a discount via the
#     negotiation bot (or admin logs a manual request), the row goes
#     into PENDING; admin approves/rejects.


class SupplierPayment(Base):
    """Payment recorded against a Purchase Order. Pending admin
    approval until reviewed."""

    __tablename__ = "supplier_payment"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    PO_ID = Column(
        Integer,
        ForeignKey("purchase_order.ID"),
        nullable=False,
        index=True
    )

    AMOUNT = Column(Float, nullable=False, default=0.0)

    PAYMENT_DATE = Column(Date, nullable=True)

    PAYMENT_MODE = Column(String(30), nullable=True)
    # BANK_TRANSFER / UPI / CHEQUE / CASH

    REFERENCE_NO = Column(String(100), nullable=True)
    # Bank txn ID / cheque number / UPI reference

    STATUS = Column(String(20), default="PENDING_APPROVAL", index=True)
    # PENDING_APPROVAL / APPROVED / REJECTED

    NOTES = Column(String(500), nullable=True)

    REJECTION_REASON = Column(String(500), nullable=True)

    REQUESTED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    APPROVED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    APPROVED_AT = Column(DateTime, nullable=True)

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


class CompanyMaster(Base):
    """Company master / branding settings — one row per vendor."""

    __tablename__ = "company_master"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID",
            name="uq_company_master_vendor"
        ),
    )

    ID = Column(Integer, primary_key=True, autoincrement=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=False,
        index=True
    )

    # ---- Identity ----
    LEGAL_NAME = Column(String(200), nullable=False)
    SHORT_NAME = Column(String(50),  nullable=True)
    TAGLINE    = Column(String(200), nullable=True)

    # ---- Statutory / regulatory ----
    GST_NUMBER = Column(String(20), nullable=True)
    PAN_NUMBER = Column(String(20), nullable=True)
    CIN_NUMBER = Column(String(21), nullable=True)
    # Optional UDYAM / MSME etc — kept on NOTES for now

    # ---- Address ----
    ADDRESS_LINE_1 = Column(String(255), nullable=True)
    ADDRESS_LINE_2 = Column(String(255), nullable=True)
    CITY    = Column(String(100), nullable=True)
    STATE   = Column(String(100), nullable=True)
    PINCODE = Column(String(15),  nullable=True)
    COUNTRY = Column(String(60),  nullable=True, default="India")

    # ---- Contact ----
    EMAIL   = Column(String(120), nullable=True)
    PHONE   = Column(String(40),  nullable=True)
    WEBSITE = Column(String(200), nullable=True)

    # ---- Bank / payment details ----
    BANK_NAME           = Column(String(120), nullable=True)
    BANK_ACCOUNT_NUMBER = Column(String(50),  nullable=True)
    BANK_IFSC           = Column(String(20),  nullable=True)
    BANK_BRANCH         = Column(String(120), nullable=True)
    UPI_ID              = Column(String(100), nullable=True)

    # ---- Branding ----
    LOGO_URL = Column(String(255), nullable=True)
    # e.g. /static/company/<uuid>.png — written by the upload endpoint

    NOTES = Column(String(1000), nullable=True)

    # ---- Working schedule ----
    # WORK_START_TIME/WORK_END_TIME nullable = no schedule configured yet;
    # the scheduler and task-duration calculation both fall back to the
    # existing hardcoded 8-hour assumption in that case (see
    # project_template.py's _to_days()) — zero behavior change for any
    # vendor that hasn't opted in.
    WORK_START_TIME = Column(Time, nullable=True)
    WORK_END_TIME   = Column(Time, nullable=True)

    # Server-computed only (never accepted as direct API input) — mirrors
    # ProjectPricing.FINAL_PRICE's own "server-computed only" convention.
    # Recalculated by company_schedule_service.recalculate_and_store_work_hours()
    # whenever WORK_START_TIME/WORK_END_TIME/breaks change.
    WORK_HOURS = Column(Numeric(5, 2), nullable=False, default=0.0)

    WORKING_TIMEZONE = Column(String(50), nullable=False, default="Asia/Kolkata")

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

    working_breaks = relationship(
        "CompanyWorkingBreak",
        back_populates="company",
        cascade="all, delete-orphan",
        order_by="CompanyWorkingBreak.SEQUENCE_NUMBER",
    )


class CompanyWorkingBreak(Base):
    """Configurable company break period (morning tea, lunch, evening tea,
    etc.) — a company can have any number of these. Deliberately a child
    table rather than fixed MORNING_BREAK_START/END-style columns, so the
    set of breaks stays open-ended (same reasoning already applied to
    TaskTemplateRequirement's Department+Role+Experience rows)."""

    __tablename__ = "company_working_break"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    COMPANY_MASTER_ID = Column(
        Integer,
        ForeignKey("company_master.ID", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    BREAK_NAME = Column(String(100), nullable=False)
    BREAK_START_TIME = Column(Time, nullable=False)
    BREAK_END_TIME   = Column(Time, nullable=False)

    SEQUENCE_NUMBER = Column(Integer, nullable=False, default=0)
    IS_ACTIVE = Column(Boolean, nullable=False, default=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("CompanyMaster", back_populates="working_breaks")


# =============================================================
# AUDIT LOG — Phase 3 security hardening
# -------------------------------------------------------------
# Single forensic table that records every state-changing request
# (POST / PUT / PATCH / DELETE). Read-only GETs are not logged
# to keep the table small. Written by AuditMiddleware in main.py
# after the response is built, so the user's request latency is
# barely affected.
# =============================================================
class AuditLog(Base):

    __tablename__ = "audit_log"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    # Caller identity (null = anonymous request, e.g. failed login)
    USER_ID    = Column(String(36),  index=True, nullable=True)
    USER_CODE  = Column(String(50),  index=True, nullable=True)
    USER_ROLE  = Column(String(50),  index=True, nullable=True)
    USER_NAME  = Column(String(150),               nullable=True)

    # Action
    METHOD = Column(String(10), index=True)
    PATH   = Column(String(500), index=True)

    # Target heuristically extracted from the URL path. Lets you
    # answer "show every change made to LEAVE id=42" without parsing
    # the full URL on read.
    TARGET_TYPE = Column(String(50), index=True, nullable=True)
    TARGET_ID   = Column(String(100), index=True, nullable=True)

    # Response
    STATUS_CODE = Column(Integer, index=True)

    # Forensics
    IP_ADDRESS  = Column(String(45),  nullable=True)
    USER_AGENT  = Column(String(500), nullable=True)

    CREATED_AT  = Column(DateTime, default=datetime.utcnow, index=True)

# ====================================================================
# Employee Allowance / Expense Claim
# ====================================================================
# Employee submits an office-related expense (travel, food, supplies,
# etc.). MD / approver gets an email notification, reviews the request
# in the admin Allowances page, and approves or rejects it.

# EmployeeAllowance moved to app/models/employee_models.py (re-exported below).


# ====================================================================
# Announcement — HR-authored company-wide posts
# ====================================================================
# One row per HR announcement. Powers the ESS "Announcements" panel
# (Meeting / Event / Notice tabs) and the HR-side "Announcements"
# admin page. Notice-type is the lightweight alternative to issuing
# a formal INFORMATION memo — no employee ack required, just an
# announcement everyone can read.
#
# Soft-delete via IS_ACTIVE — HR can restore accidentally-removed
# posts by flipping the flag back in the DB. Hard deletes are not
# exposed.

class Announcement(Base):

    __tablename__ = "announcement"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=False,
        index=True,
    )

    # MEETING / EVENT / NOTICE — one enum, three lanes.
    TYPE = Column(String(20), nullable=False, index=True)

    TITLE = Column(String(200), nullable=False)

    DESCRIPTION = Column(String(2000), nullable=True)

    # For MEETING / EVENT — when it happens. Null for NOTICE.
    EVENT_DATE = Column(Date, nullable=True, index=True)

    # 'HH:MM' — free-form so HR can leave it blank when time is TBD.
    EVENT_TIME = Column(String(10), nullable=True)

    LOCATION = Column(String(200), nullable=True)

    # Soft delete. Default 1 (active). Toggle to 0 to hide from list.
    IS_ACTIVE = Column(Integer, default=1, nullable=False, index=True)

    CREATED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
    )

    CREATED_AT = Column(DateTime, default=datetime.now, index=True)

    UPDATED_AT = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# AILeaveConversation moved to app/models/leave_models.py (re-exported below).


# =====================================================================
# Phase 2 — AI Recruitment Assistant
# =====================================================================
# All additive. Recruitment lives in its own namespace until a candidate
# is officially hired, at which point a normal Employee row is created
# through the existing onboarding flow.

class RecruitmentJob(Base):
    """An open position the company is hiring for."""

    __tablename__ = "recruitment_job"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    JOB_CODE = Column(String(30), unique=True, index=True, nullable=True)
    # Auto-generated: JOB-2026-0001

    TITLE = Column(String(150), nullable=False)
    DEPARTMENT = Column(String(100), nullable=True)
    LOCATION = Column(String(100), nullable=True)

    EMPLOYMENT_TYPE = Column(String(30), default="FULL_TIME")
    # FULL_TIME / PART_TIME / CONTRACT / INTERN

    EXPERIENCE_MIN_YEARS = Column(Float, nullable=True, default=0.0)
    EXPERIENCE_MAX_YEARS = Column(Float, nullable=True)

    SALARY_MIN = Column(Float, nullable=True)
    SALARY_MAX = Column(Float, nullable=True)

    REQUIRED_SKILLS = Column(String(1000), nullable=True)
    # Comma-separated skills, e.g. "Python, FastAPI, MySQL, React"

    PREFERRED_SKILLS = Column(String(1000), nullable=True)

    REQUIRED_EDUCATION = Column(String(200), nullable=True)
    # e.g. "B.E. Mechanical" or "B.Tech / MCA"

    DESCRIPTION = Column(String(4000), nullable=True)

    STATUS = Column(String(20), default="OPEN", index=True)
    # OPEN / ON_HOLD / FILLED / CANCELLED

    OPENINGS = Column(Integer, default=1)

    OPENED_AT = Column(DateTime, default=datetime.utcnow)
    CLOSED_AT = Column(DateTime, nullable=True)

    CREATED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True,
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Candidate(Base):
    """One row per unique candidate (deduped by email)."""

    __tablename__ = "recruitment_candidate"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    CANDIDATE_CODE = Column(String(30), unique=True, index=True, nullable=True)
    # Auto-generated: CAND-2026-0001

    # ----- Identity -----
    FULL_NAME = Column(String(150), nullable=False)
    EMAIL     = Column(String(120), index=True, nullable=True)
    PHONE     = Column(String(30),  nullable=True)
    LOCATION  = Column(String(120), nullable=True)

    # ----- Resume (raw + parsed) -----
    RESUME_URL = Column(String(500), nullable=True)
    # /static/recruitment/resumes/<id>/<file>

    RESUME_TEXT = Column(Text, nullable=True)
    # Full plain-text extraction for searching / re-parsing

    PARSED_JSON = Column(Text, nullable=True)
    # JSON blob with skills, education list, work_experience list,
    # certifications, languages, projects, total_experience_years

    # ----- Quick-search fields (denormalised from parsed JSON) -----
    TOTAL_EXPERIENCE_YEARS = Column(Float, nullable=True, default=0.0)
    HIGHEST_QUALIFICATION  = Column(String(200), nullable=True)
    SKILLS                 = Column(String(2000), nullable=True)
    # Comma-separated for SQL LIKE searches

    # ----- Status -----
    STATUS = Column(String(30), default="NEW", index=True)
    # NEW / SCREENED / SHORTLISTED / INTERVIEWING / OFFERED /
    # HIRED / REJECTED / ON_HOLD

    SOURCE = Column(String(50), nullable=True)
    # WEBSITE / REFERRAL / LINKEDIN / AGENCY / WALK_IN / OTHER

    NOTES = Column(String(2000), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True,
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CandidateApplication(Base):
    """Links a candidate to a specific job + holds screening results."""

    __tablename__ = "recruitment_application"

    __table_args__ = (
        UniqueConstraint(
            "CANDIDATE_ID", "JOB_ID",
            name="uq_candidate_per_job",
        ),
    )

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    CANDIDATE_ID = Column(
        Integer,
        ForeignKey("recruitment_candidate.ID", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    JOB_ID = Column(
        Integer,
        ForeignKey("recruitment_job.ID", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    # ----- Screening results -----
    SCREENING_STATUS = Column(String(20), default="PENDING", index=True)
    # PENDING / HIGHLY_SUITABLE / SUITABLE / PARTIALLY_SUITABLE / NOT_SUITABLE

    SKILL_MATCH_PCT       = Column(Float, default=0.0)
    EXPERIENCE_MATCH_PCT  = Column(Float, default=0.0)
    EDUCATION_MATCH_PCT   = Column(Float, default=0.0)
    OVERALL_SCORE         = Column(Float, default=0.0)
    # Weighted: 0.5 * skill + 0.3 * experience + 0.2 * education

    MATCHING_SKILLS = Column(String(2000), nullable=True)
    MISSING_SKILLS  = Column(String(2000), nullable=True)

    SCREENING_SUMMARY = Column(Text, nullable=True)
    # AI-generated narrative, e.g. "Strong Python / FastAPI fit; lacks
    # MySQL exposure; senior-level experience."

    SCREENED_AT = Column(DateTime, nullable=True)

    # ----- Pipeline state -----
    STATUS = Column(String(30), default="APPLIED", index=True)
    # APPLIED / SCREENING / SHORTLISTED / INTERVIEWED / OFFERED /
    # HIRED / REJECTED / WITHDRAWN

    REJECTION_REASON = Column(String(500), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Interview(Base):
    """One scheduled interview for a candidate application."""

    __tablename__ = "recruitment_interview"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    APPLICATION_ID = Column(
        Integer,
        ForeignKey("recruitment_application.ID", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    ROUND = Column(Integer, default=1)
    # 1 = screening, 2 = technical, 3 = HR, etc.

    ROUND_TYPE = Column(String(40), nullable=True)
    # SCREENING / TECHNICAL / HR / MANAGERIAL / FINAL

    SCHEDULED_AT = Column(DateTime, nullable=False, index=True)

    DURATION_MINUTES = Column(Integer, default=45)

    MODE = Column(String(20), default="ONLINE")
    # ONLINE / IN_PERSON / PHONE

    MEETING_LINK = Column(String(500), nullable=True)
    LOCATION     = Column(String(200), nullable=True)

    INTERVIEWER_NAME  = Column(String(150), nullable=True)
    INTERVIEWER_EMAIL = Column(String(120), nullable=True)

    STATUS = Column(String(20), default="SCHEDULED", index=True)
    # SCHEDULED / RESCHEDULED / COMPLETED / NO_SHOW / CANCELLED

    # ----- After the interview -----
    SCORE = Column(Float, nullable=True)               # 0-10
    RECOMMENDATION = Column(String(30), nullable=True) # HIRE / REJECT / HOLD / NEXT_ROUND
    FEEDBACK = Column(Text, nullable=True)

    SUGGESTED_QUESTIONS = Column(Text, nullable=True)
    # AI-generated, based on candidate's skills + JD

    CREATED_AT  = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OfferLetter(Base):
    """One offer letter draft per application (latest wins)."""

    __tablename__ = "recruitment_offer"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    APPLICATION_ID = Column(
        Integer,
        ForeignKey("recruitment_application.ID", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )

    OFFER_NUMBER = Column(String(40), unique=True, index=True, nullable=True)
    # Auto-generated: OFFER-2026-0001

    JOB_TITLE = Column(String(150), nullable=False)
    DEPARTMENT = Column(String(100), nullable=True)

    COMPENSATION_CTC = Column(Float, nullable=False)
    COMPENSATION_BREAKDOWN = Column(Text, nullable=True)
    # JSON: { "basic": ..., "hra": ..., "allowances": ..., "bonus": ... }

    BENEFITS = Column(Text, nullable=True)
    # Free-text or JSON list

    JOINING_DATE = Column(Date, nullable=True)
    PROBATION_MONTHS = Column(Integer, default=6)
    NOTICE_PERIOD_DAYS = Column(Integer, default=30)

    EMPLOYMENT_TERMS = Column(Text, nullable=True)
    SPECIAL_CLAUSES  = Column(Text, nullable=True)

    LETTER_PDF_URL = Column(String(500), nullable=True)
    # /static/recruitment/offers/<id>/<file>.pdf

    STATUS = Column(String(20), default="DRAFTED", index=True)
    # DRAFTED / REVIEWED / SENT / ACCEPTED / REJECTED / EXPIRED

    SENT_AT     = Column(DateTime, nullable=True)
    RESPONDED_AT = Column(DateTime, nullable=True)

    # One-time token embedded in the Accept/Reject links in the email.
    # Cleared after the candidate responds so the same link can't be
    # reused.
    RESPONSE_TOKEN = Column(String(64), nullable=True, index=True)

    CREATED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# =====================================================================
# POST-JOINING ONBOARDING — checklist, assets, training, welcome kit
# =====================================================================


class AssetMaster(Base):
    """Catalogue of allocatable assets — Laptop, Phone, ID Card, Locker, etc.
    Per-vendor list managed by HR. Instances are tracked in AssetAllocation."""

    __tablename__ = "asset_master"

    ID          = Column(Integer, primary_key=True, autoincrement=True)
    NAME        = Column(String(80), nullable=False)
    CATEGORY    = Column(String(40), nullable=False)
    # LAPTOP / PHONE / ID_CARD / LOCKER / TOOL / VEHICLE / OTHER
    DESCRIPTION = Column(String(255), nullable=True)
    IS_ACTIVE   = Column(Integer, default=1)
    VENDOR_ID   = Column(Integer, ForeignKey("vendor.ID"), nullable=False, index=True)
    CREATED_AT  = Column(DateTime, default=datetime.utcnow)


class AssetAllocation(Base):
    """One row per asset issuance to an employee."""

    __tablename__ = "asset_allocation"

    ID              = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID     = Column(String(36), ForeignKey("employee.ID"),
                             nullable=False, index=True)
    ASSET_MASTER_ID = Column(Integer, ForeignKey("asset_master.ID"),
                             nullable=False)
    SERIAL_NUMBER   = Column(String(80), nullable=True)
    ISSUED_DATE     = Column(Date, nullable=True)
    RETURNED_DATE   = Column(Date, nullable=True)
    STATUS          = Column(String(20), default="ISSUED")
    # ISSUED / RETURNED / LOST / DAMAGED
    NOTES           = Column(String(255), nullable=True)
    ISSUED_BY_ID    = Column(String(36), ForeignKey("employee.ID"), nullable=True)
    VENDOR_ID       = Column(Integer, ForeignKey("vendor.ID"),
                             nullable=False, index=True)
    CREATED_AT      = Column(DateTime, default=datetime.utcnow)


class TrainingProgram(Base):
    """Catalogue of trainings — Induction, Safety, ISO 9001, etc."""

    __tablename__ = "training_program"

    ID            = Column(Integer, primary_key=True, autoincrement=True)
    NAME          = Column(String(120), nullable=False)
    DESCRIPTION   = Column(Text, nullable=True)
    DURATION_DAYS = Column(Integer, default=1)
    IS_MANDATORY  = Column(Integer, default=0)
    # If 1, every new joiner gets it auto-assigned via the checklist seeder.
    IS_ACTIVE     = Column(Integer, default=1)
    VENDOR_ID     = Column(Integer, ForeignKey("vendor.ID"),
                           nullable=False, index=True)
    CREATED_AT    = Column(DateTime, default=datetime.utcnow)


class TrainingAssignment(Base):
    """Per-employee training tracking."""

    __tablename__ = "training_assignment"

    ID                  = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID         = Column(String(36), ForeignKey("employee.ID"),
                                 nullable=False, index=True)
    TRAINING_PROGRAM_ID = Column(Integer, ForeignKey("training_program.ID"),
                                 nullable=False)
    ASSIGNED_DATE       = Column(Date, default=lambda: datetime.utcnow().date())
    DUE_DATE            = Column(Date, nullable=True)
    COMPLETED_DATE      = Column(Date, nullable=True)
    STATUS              = Column(String(20), default="ASSIGNED")
    # ASSIGNED / IN_PROGRESS / COMPLETED / SKIPPED
    SCORE               = Column(Float, nullable=True)
    NOTES               = Column(String(255), nullable=True)
    ASSIGNED_BY_ID      = Column(String(36), ForeignKey("employee.ID"),
                                 nullable=True)
    VENDOR_ID           = Column(Integer, ForeignKey("vendor.ID"),
                                 nullable=False, index=True)
    CREATED_AT          = Column(DateTime, default=datetime.utcnow)


class WelcomeKitItem(Base):
    """Catalogue of welcome-kit items — T-shirt, Mug, Notebook, Backpack, etc."""

    __tablename__ = "welcome_kit_item"

    ID          = Column(Integer, primary_key=True, autoincrement=True)
    NAME        = Column(String(80), nullable=False)
    DESCRIPTION = Column(String(255), nullable=True)
    IS_DEFAULT  = Column(Integer, default=1)
    # If 1, auto-added to every new joiner's welcome kit by the seeder.
    IS_ACTIVE   = Column(Integer, default=1)
    VENDOR_ID   = Column(Integer, ForeignKey("vendor.ID"),
                         nullable=False, index=True)
    CREATED_AT  = Column(DateTime, default=datetime.utcnow)


class WelcomeKitIssuance(Base):
    """Per-employee record of which kit items have been handed over."""

    __tablename__ = "welcome_kit_issuance"

    ID                  = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID         = Column(String(36), ForeignKey("employee.ID"),
                                 nullable=False, index=True)
    WELCOME_KIT_ITEM_ID = Column(Integer, ForeignKey("welcome_kit_item.ID"),
                                 nullable=False)
    ISSUED_DATE         = Column(Date, nullable=True)
    STATUS              = Column(String(20), default="PENDING")
    # PENDING / ISSUED / DECLINED
    NOTES               = Column(String(255), nullable=True)
    ISSUED_BY_ID        = Column(String(36), ForeignKey("employee.ID"),
                                 nullable=True)
    VENDOR_ID           = Column(Integer, ForeignKey("vendor.ID"),
                                 nullable=False, index=True)
    CREATED_AT          = Column(DateTime, default=datetime.utcnow)


# LeaveBalanceAdjustment moved to app/models/leave_models.py (re-exported below).


# EmployeeStatusHistory moved to app/models/employee_models.py (re-exported below).


class MonthlyAttendanceReport(Base):
    """One row per (employee, year, month). Auto-generated by the
    MonthlyReportService — aggregates attendance + leave + overtime +
    salary deduction signals so HR has a one-row summary to act on at
    payroll time."""

    __tablename__ = "monthly_attendance_report"
    __table_args__ = (
        UniqueConstraint("EMPLOYEE_ID", "YEAR", "MONTH",
                         name="uq_mar_emp_year_month"),
    )

    ID            = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID   = Column(String(36), ForeignKey("employee.ID"),
                           nullable=False, index=True)
    YEAR          = Column(Integer, nullable=False, index=True)
    MONTH         = Column(Integer, nullable=False, index=True)
    # 1-12

    # --- Day counts ---
    TOTAL_DAYS         = Column(Integer, default=0)
    WORKING_DAYS       = Column(Integer, default=0)
    HOLIDAYS           = Column(Integer, default=0)
    SUNDAYS            = Column(Integer, default=0)
    PRESENT_DAYS       = Column(Float,   default=0.0)
    ABSENT_DAYS        = Column(Float,   default=0.0)
    HALF_DAYS          = Column(Float,   default=0.0)
    LATE_COUNT         = Column(Integer, default=0)
    EARLY_EXIT_COUNT   = Column(Integer, default=0)

    # --- Leave breakdown ---
    PAID_LEAVES        = Column(Float, default=0.0)
    UNPAID_LEAVES      = Column(Float, default=0.0)
    CL_USED            = Column(Float, default=0.0)
    SICK_USED          = Column(Float, default=0.0)
    EARNED_USED        = Column(Float, default=0.0)
    EXCESS_LEAVES      = Column(Float, default=0.0)
    # Sum of leave days that exceed the employee's available balance for
    # the calendar year (treated as unpaid).

    # --- Hours ---
    WORKED_HOURS       = Column(Float, default=0.0)
    OVERTIME_HOURS     = Column(Float, default=0.0)
    EXPECTED_HOURS     = Column(Float, default=0.0)

    # --- Compliance / KPIs ---
    ATTENDANCE_PCT     = Column(Float, default=0.0)
    HOUR_COMPLIANCE_PCT= Column(Float, default=0.0)

    # --- Salary impact ---
    MONTHLY_SALARY     = Column(Float, default=0.0)
    DAILY_WAGE         = Column(Float, default=0.0)
    ABSENCE_DEDUCTION  = Column(Float, default=0.0)
    LATE_DEDUCTION     = Column(Float, default=0.0)
    OT_PAYABLE         = Column(Float, default=0.0)
    NET_PAYABLE        = Column(Float, default=0.0)

    # --- AI insights — free-form narrative HR can paste into the payslip ---
    INSIGHTS_JSON      = Column(Text, nullable=True)
    PDF_PATH           = Column(String(500), nullable=True)

    STATUS             = Column(String(20), default="GENERATED", index=True)
    # GENERATED / SHARED / LOCKED

    GENERATED_BY_ID    = Column(String(36), ForeignKey("employee.ID"),
                                nullable=True)
    VENDOR_ID          = Column(Integer, ForeignKey("vendor.ID"),
                                nullable=False, index=True)
    CREATED_AT         = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT         = Column(DateTime, default=datetime.utcnow,
                                onupdate=datetime.utcnow)


class AttendanceAlert(Base):
    """An automated alert raised by the AttendanceMonitor when an employee's
    attendance pattern breaches a configured threshold.

    Severity is computed on creation (INFO / WARNING / CRITICAL). The same
    alert key is deduplicated per (employee, day) so re-running the monitor
    multiple times in a day doesn't spam notifications."""

    __tablename__ = "attendance_alert"
    __table_args__ = (
        UniqueConstraint("EMPLOYEE_ID", "ALERT_KEY", "ALERT_DATE",
                         name="uq_alert_emp_key_date"),
    )

    ID            = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID   = Column(String(36), ForeignKey("employee.ID"),
                           nullable=False, index=True)
    ALERT_KEY     = Column(String(40), nullable=False, index=True)
    # LATE_PATTERN / ABSENT_PATTERN / OT_ABUSE / EARLY_EXIT_PATTERN
    SEVERITY      = Column(String(20), nullable=False, default="WARNING")
    # INFO / WARNING / CRITICAL
    ALERT_DATE    = Column(Date, nullable=False, default=lambda: datetime.utcnow().date())
    WINDOW_DAYS   = Column(Integer, default=30)
    METRIC_VALUE  = Column(Float, nullable=True)
    THRESHOLD     = Column(Float, nullable=True)
    TITLE         = Column(String(180), nullable=False)
    DETAIL        = Column(Text, nullable=True)
    STATUS        = Column(String(20), default="OPEN", index=True)
    # OPEN / ACKNOWLEDGED / DISMISSED
    ACKNOWLEDGED_BY_ID = Column(String(36), ForeignKey("employee.ID"), nullable=True)
    ACKNOWLEDGED_AT    = Column(DateTime, nullable=True)
    VENDOR_ID     = Column(Integer, ForeignKey("vendor.ID"), nullable=False, index=True)
    CREATED_AT    = Column(DateTime, default=datetime.utcnow)


class OnboardingChecklistItem(Base):
    """Single row per (employee, checklist key). Auto-seeded on hire by
    OnboardingService. Keys are stable strings so the UI renders a
    fixed-order checklist without joining seven tables per request."""

    __tablename__ = "onboarding_checklist_item"
    __table_args__ = (
        UniqueConstraint("EMPLOYEE_ID", "ITEM_KEY", name="uq_chk_emp_key"),
    )

    ID              = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID     = Column(String(36), ForeignKey("employee.ID"),
                             nullable=False, index=True)
    ITEM_KEY        = Column(String(60), nullable=False)
    LABEL           = Column(String(120), nullable=False)
    CATEGORY        = Column(String(30), nullable=False)
    # DOC / DEPT / ROLE / ASSET / TRAINING / KIT / OTHER
    STATUS          = Column(String(20), default="PENDING")
    # PENDING / DONE / SKIPPED
    COMPLETED_DATE  = Column(Date, nullable=True)
    COMPLETED_BY_ID = Column(String(36), ForeignKey("employee.ID"), nullable=True)
    NOTES           = Column(String(255), nullable=True)
    SORT_ORDER      = Column(Integer, default=100)
    VENDOR_ID       = Column(Integer, ForeignKey("vendor.ID"),
                             nullable=False, index=True)
    CREATED_AT      = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT      = Column(DateTime, default=datetime.utcnow,
                             onupdate=datetime.utcnow)

# ──────────────────────────────────────────────
# Custom Fields System
# ──────────────────────────────────────────────

class CustomField(Base):
    __tablename__ = "custom_fields"

    ID          = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    TABLE_NAME  = Column(String(100), nullable=False, index=True)
    FIELD_NAME  = Column(String(50),  nullable=False)
    FIELD_TYPE  = Column(FIELD_TYPE_ENUM, nullable=False)
    OPTIONS     = Column(JSON, nullable=True)
    IS_REQUIRED = Column(Boolean, default=False, nullable=False)
    SORT_ORDER  = Column(Integer, nullable=False, default=0)
    VENDOR_ID   = Column(Integer, ForeignKey("vendor.ID"), nullable=True, index=True)
    CREATED_AT  = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    values = relationship("CustomFieldTableValue", back_populates="field", cascade="all, delete-orphan")


class CustomFieldTableValue(Base):
    __tablename__ = "custom_fields_table_values"

    ID                 = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    TABLE_NAME         = Column(String(100), nullable=False, index=True)
    TABLE_ROW_ID       = Column(String(36),  nullable=False, index=True)
    CUSTOM_FIELD_ID    = Column(String(36), ForeignKey("custom_fields.ID", ondelete="CASCADE"), nullable=False)
    CUSTOM_FIELD_VALUE = Column(JSON, nullable=True)
    CREATED_AT         = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT         = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    field = relationship("CustomField", back_populates="values")


# =====================================================================
# Help Desk — employee-submitted tickets
# =====================================================================

class HelpDeskTicket(Base):
    """One employee-raised ticket. Admins triage, assign, and resolve."""

    __tablename__ = "helpdesk_ticket"

    ID               = Column(Integer, primary_key=True, autoincrement=True, index=True)
    TICKET_NUMBER    = Column(String(30), unique=True, index=True, nullable=False)

    EMPLOYEE_ID      = Column(String(36), ForeignKey("employee.ID"), index=True, nullable=False)

    CATEGORY         = Column(String(30), nullable=False, index=True)
    # COMPLAINT / IT_REQUEST / HR_REQUEST / MAINTENANCE / OTHER

    SUBJECT          = Column(String(200), nullable=False)
    DESCRIPTION      = Column(Text, nullable=True)

    PRIORITY         = Column(String(10), nullable=False, default="MEDIUM", index=True)
    # LOW / MEDIUM / HIGH / URGENT

    STATUS           = Column(String(20), nullable=False, default="OPEN", index=True)
    # OPEN / IN_PROGRESS / RESOLVED / CLOSED / REJECTED

    ASSIGNED_TO_ID   = Column(String(36), ForeignKey("employee.ID"), nullable=True, index=True)
    ASSIGNED_TO_NAME = Column(String(150), nullable=True)

    INTERNAL_NOTES   = Column(Text, nullable=True)
    RESOLUTION_NOTES = Column(Text, nullable=True)

    RESOLVED_AT      = Column(DateTime, nullable=True)
    CLOSED_AT        = Column(DateTime, nullable=True)

    VENDOR_ID        = Column(Integer, ForeignKey("vendor.ID"), nullable=True, index=True)

    CREATED_AT       = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    employee     = relationship("Employee", foreign_keys=[EMPLOYEE_ID])
    assigned_to  = relationship("Employee", foreign_keys=[ASSIGNED_TO_ID])
