from sqlalchemy import (
    Column, String, Integer, ForeignKey, Float, Date, Time,
    Text, DateTime, UniqueConstraint,
)
from app.database.database import Base
from datetime import datetime, time
import uuid


class Employee(Base):
    """
    Unified employee model (Module 2 of the enterprise rework).
    Replaces both IAMUser (project-level employees) and
    EmployeeAccount (demo employees with login). Every person
    who can log in or be assigned work lives here.
    """

    __tablename__ = "employee"

    ID = Column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4())
    )

    EMPLOYEE_CODE = Column(
        String(20),
        unique=True,
        index=True
    )
    # Human-facing code used at login. e.g. "EMP001", "ADMIN".

    NAME = Column(String(100))

    EMAIL = Column(String(100), unique=True, nullable=True)

    PHONE = Column(String(20), nullable=True)

    PASSWORD = Column(String(255))   # bcrypt

    DEPARTMENT_ID = Column(
        Integer,
        ForeignKey("department.ID"),
        nullable=True,
        index=True
    )

    DESIGNATION_ID = Column(
        Integer,
        ForeignKey("designation.ID"),
        nullable=True
    )

    ROLE_ID = Column(
        Integer,
        ForeignKey("role.ID"),
        index=True
    )

    REPORTING_MANAGER_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    JOINING_DATE = Column(Date, default=datetime.utcnow)

    SALARY = Column(Float, default=0.0)

    SHIFT_START = Column(Time, default=time(10, 0))

    SHIFT_END = Column(Time, default=time(18, 0))

    STATUS = Column(
        String(20),
        default="ACTIVE"
    )
    # ACTIVE / SUSPENDED / RESIGNED / TERMINATED

    PROFILE_SUBMITTED = Column(Integer, default=0)
    # 0 → employee hasn't filled their self-registration profile yet;
    # the EmployeeDashboard shows a locked form on first login.
    # 1 → employee submitted, dashboard goes read-only for them.
    # Admin can always edit regardless of this flag.

    SKILLS = Column(String(500), nullable=True)
    # comma-separated tags for now; JSON later

    FINGERPRINT_ID = Column(
        String(50),
        nullable=True,
        unique=True,
        index=True
    )
    # ID assigned to this employee on the biometric device
    # (e.g. ZKTeco/eSSL "USER_ID"). The device pushes this on
    # every scan — we use it to resolve back to Employee.ID.

    # ---- Profile / Resume fields (Module: Add Employee form) ----
    ADDRESS = Column(String(500), nullable=True)

    CITY = Column(String(100), nullable=True)

    STATE = Column(String(100), nullable=True)

    PINCODE = Column(String(15), nullable=True)

    DOB = Column(Date, nullable=True)

    GENDER = Column(String(20), nullable=True)
    # MALE / FEMALE / OTHER / PREFER_NOT_TO_SAY

    FATHER_NAME = Column(String(100), nullable=True)

    MOTHER_NAME = Column(String(100), nullable=True)

    MARITAL_STATUS = Column(String(20), nullable=True)
    # SINGLE / MARRIED / DIVORCED / WIDOWED

    OCCUPATION = Column(String(100), nullable=True)
    # Self-described occupation (e.g. "Mechanical Technician")

    QUALIFICATION = Column(String(200), nullable=True)
    # e.g. "BE Mechanical Engineering", "Diploma in Electronics"

    YEAR_OF_PASSING = Column(Integer, nullable=True)
    # e.g. 2018

    EXPERIENCE_YEARS = Column(Float, nullable=True, default=0.0)

    EXPERIENCE_DETAILS = Column(String(1000), nullable=True)
    # free-text — company names, roles held, etc.

    PAST_PROJECTS = Column(String(1000), nullable=True)
    # free-text — notable past projects worked on

    EMPLOYMENT_TYPE = Column(String(20), nullable=True)
    # FRESHER / EXPERIENCED

    NOTES = Column(String(1000), nullable=True)
    # admin's free-text notes about the employee

    PHOTO_URL = Column(String(255), nullable=True)
    # /static/employee/<file> — passport-size photo

    # ---- Phase A — HR Module expansion (added 2026-06-01) ----

    # 1. Master gap
    BLOOD_GROUP = Column(String(5), nullable=True)
    # A+ / A- / B+ / B- / O+ / O- / AB+ / AB-

    # 2. Personal Information gaps
    NATIONALITY = Column(String(50), nullable=True, default="Indian")

    EMERGENCY_CONTACT_NAME     = Column(String(100), nullable=True)
    EMERGENCY_CONTACT_PHONE    = Column(String(20),  nullable=True)
    EMERGENCY_CONTACT_RELATION = Column(String(50),  nullable=True)
    # e.g. Father / Spouse / Sibling

    # 3. Employment Details gaps
    CONFIRMATION_DATE = Column(Date, nullable=True)
    # Date probation ends and the employee is confirmed

    WORK_LOCATION = Column(String(200), nullable=True)
    # Office / site name — distinct from home ADDRESS

    # 4. Education gaps
    COLLEGE    = Column(String(200), nullable=True)
    UNIVERSITY = Column(String(200), nullable=True)
    PERCENTAGE = Column(Float, nullable=True)
    # Final mark — % or CGPA captured as a number

    # 5. Experience gaps
    PREVIOUS_COMPANY = Column(String(200), nullable=True)
    PREVIOUS_SALARY  = Column(Float, nullable=True)

    # 10. Payroll prep — bank + KYC IDs (used by Phase E too)
    BANK_ACCOUNT_NUMBER = Column(String(50),  nullable=True)
    BANK_NAME           = Column(String(100), nullable=True)
    IFSC_CODE           = Column(String(20),  nullable=True)
    PAN_NUMBER          = Column(String(20),  nullable=True)
    AADHAAR_NUMBER      = Column(String(20),  nullable=True)
    # Stored as plain string for now; encryption is a Phase F concern.

    # ---- End Phase A additions ----

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    TOKEN_VERSION = Column(Integer, nullable=False, default=1)
    # Bumped on password change / STATUS change / role or permission
    # change. Checked once per request (indexed PK lookup) so an
    # already-issued access token can be invalidated immediately
    # instead of waiting out its full lifetime.

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class Department(Base):

    __tablename__ = "department"

    __table_args__ = (
        UniqueConstraint("VENDOR_ID", "DEPARTMENT_CODE", name="uq_dept_vendor_code"),
    )

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID", ondelete="RESTRICT"), nullable=False, index=True)

    DEPARTMENT_CODE = Column(String(20), nullable=False)

    NAME = Column(String(100), nullable=False)

    DESCRIPTION = Column(String(500), nullable=True)

    HEAD_EMPLOYEE_ID = Column(
        String(36),
        nullable=True
        # FK to employee.ID added in Module 2 once Employee
        # model is restructured — leave nullable for now
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)
    UPDATED_AT = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Designation(Base):

    __tablename__ = "designation"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    TITLE = Column(String(100))

    DEPARTMENT_ID = Column(
        Integer,
        ForeignKey("department.ID"),
        index=True
    )

    BASE_SALARY = Column(Float, default=0.0)

    DESCRIPTION = Column(String(255), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)


# ====================================================================
# HR Module — Employee Onboarding (candidate self-onboarding chatbot)
# ====================================================================

class EmployeeOnboardingSession(Base):
    """One row per employee onboarding invitation.

    COLLECTED_DATA is a JSON-encoded dict of every Employee field
    captured by the chatbot so far. CHAT_HISTORY is a JSON list of
    {role, text, ts} entries used for audit + replay. STATUS moves
    OPEN -> SUBMITTED -> APPROVED / REJECTED (or EXPIRED if the
    invite link times out)."""

    __tablename__ = "employee_onboarding_session"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    TOKEN = Column(String(64), unique=True, nullable=False, index=True)
    # URL-safe random token; appears in /portal/employee-onboarding/<TOKEN>

    INVITED_EMAIL = Column(String(255), nullable=True)

    INVITED_PHONE = Column(String(50), nullable=True)

    INVITED_NAME = Column(String(150), nullable=True)
    # admin-prefilled hint

    EMPLOYEE_CODE = Column(String(50), nullable=True)
    # admin-prefilled if pre-allocated

    PASSWORD_HASH = Column(String(255), nullable=True)
    # bcrypt hash of the candidate's chosen-at-invite password.
    # nullable so old rows still load — set by admin invite, used
    # for /employee-onboarding/{token}/login, then copied onto
    # Employee.PASSWORD at approval time.

    # Admin-chosen role assignment at invite time. Surfaced as a pair
    # of dropdowns on the InviteEmployeeModal; carried through to the
    # candidate's form as the default selection; copied onto the
    # Employee row at approval.
    DEPARTMENT_ID = Column(
        Integer,
        ForeignKey("department.ID"),
        nullable=True,
        index=True,
    )

    DESIGNATION_ID = Column(
        Integer,
        ForeignKey("designation.ID"),
        nullable=True,
        index=True,
    )

    STATUS = Column(String(30), default="OPEN")
    # OPEN / SUBMITTED / APPROVED / REJECTED / EXPIRED

    COLLECTED_DATA = Column(Text, nullable=True)
    # JSON string

    CHAT_HISTORY = Column(Text, nullable=True)
    # JSON list of {role, text, ts}

    PHOTO_URL = Column(String(500), nullable=True)
    # uploaded during chat

    CURRENT_FIELD = Column(String(80), nullable=True)
    # tracks where the chatbot left off

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )
    # set on approve

    APPROVED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    APPROVED_AT = Column(DateTime, nullable=True)

    REJECT_REASON = Column(String(500), nullable=True)

    NOTES = Column(String(1000), nullable=True)
    # admin notes during review

    EXPIRES_AT = Column(DateTime, nullable=True)

    SUBMITTED_AT = Column(DateTime, nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


# ====================================================================
# HR Module — Phase B: Employee Documents (2026-06-02)
# ====================================================================
# One row per uploaded file. Files live under static/employee-docs/
# <employee_id>/<uuid>.<ext>. DOC_TYPE is a friendly category tag so
# HR can filter Aadhaar vs Resume vs Certificate quickly.


class EmployeeDocument(Base):
    """One row per file uploaded against an employee. Supports the
    HR documents requirement: Aadhaar / Resume / Offer Letter / PAN /
    Certificates / Other.

    FILE_URL is the public /static/employee-docs/... path; the actual
    file lives on disk under backend/static/employee-docs/<emp_id>/.
    """

    __tablename__ = "employee_document"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=False,
        index=True
    )

    DOC_TYPE = Column(String(30), nullable=False, index=True)
    # AADHAAR / PAN / RESUME / OFFER_LETTER / CERTIFICATE /
    # EXPERIENCE_LETTER / EDUCATIONAL / OTHER

    TITLE = Column(String(200), nullable=True)
    # Optional friendly name (e.g. "B.E. Provisional Certificate")

    FILE_URL = Column(String(500), nullable=False)
    # /static/employee-docs/<emp_id>/<uuid>.<ext>

    FILE_NAME = Column(String(255), nullable=True)
    # Original filename the user uploaded (for download UX)

    MIME = Column(String(100), nullable=True)

    SIZE_BYTES = Column(Integer, nullable=True)

    STATUS = Column(String(20), default="ACTIVE")
    # ACTIVE / ARCHIVED / REJECTED — keeps history without deleting

    NOTES = Column(String(500), nullable=True)

    UPLOADED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    UPLOADED_AT = Column(DateTime, default=datetime.utcnow)


# ====================================================================
# HR Module — Employee Memo Management
# ====================================================================
# Permanent audit trail of warnings, appreciations, disciplinary
# actions, customer complaints and performance recognitions.
# Soft delete only (DELETED_AT). Every row also stores who created /
# last updated it for compliance.

class EmployeeMemo(Base):
    """One row per official memo issued to an employee."""

    __tablename__ = "employee_memos"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    MEMO_NUMBER = Column(String(30), unique=True, index=True, nullable=True)
    # Auto-generated: MEMO-2026-0001

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=False,
        index=True
    )

    MEMO_TYPE = Column(String(40), nullable=False, index=True)
    # WARNING / APPRECIATION / DISCIPLINARY / INFORMATION /
    # CUSTOMER_COMPLAINT / PERFORMANCE_RECOGNITION / SHOW_CAUSE_NOTICE

    SUBJECT = Column(String(200), nullable=False)

    DESCRIPTION = Column(String(4000), nullable=True)

    SEVERITY = Column(String(20), default="LOW", index=True)
    # LOW / MEDIUM / HIGH / CRITICAL

    STATUS = Column(String(20), default="ACTIVE", index=True)
    # ACTIVE / CLOSED / CANCELLED

    ISSUED_BY = Column(String(100), nullable=True)
    # Free-text name of the person issuing — keeps the memo readable
    # even if the issuer's employee row is later deleted.

    ISSUE_DATE = Column(Date, nullable=True, index=True)

    ATTACHMENT_URL = Column(String(500), nullable=True)
    # /static/memos/<memo_id>/<uuid>.<ext>

    ATTACHMENT_NAME = Column(String(255), nullable=True)

    ACKNOWLEDGED_BY_EMPLOYEE = Column(Integer, default=0)
    # 0 = pending, 1 = acknowledged

    ACKNOWLEDGED_DATE = Column(DateTime, nullable=True)

    REMARKS = Column(String(2000), nullable=True)

    # ---- Audit ----
    CREATED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    UPDATED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

    DELETED_AT = Column(DateTime, nullable=True, index=True)
    # Soft delete — set to a timestamp instead of removing the row

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True
    )

    # ---- Automation ----
    IS_AUTOMATED = Column(Integer, default=0, index=True)
    # 1 = generated by memo_automation.py; 0 = written manually by admin

    AUTOMATION_KEY = Column(String(80), unique=True, nullable=True, index=True)
    # Idempotency key. Format:
    #   AUTO-WEEK-<isoyear>W<isoweek>-<WARNING|APPRECIATION>-<employee_id>
    # A unique index guarantees the automation cannot double-write for
    # the same employee in the same week, even across concurrent runs.


class EmployeeAllowance(Base):
    """One row per expense claim submitted by an employee."""

    __tablename__ = "employee_allowance"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    EMPLOYEE_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=False,
        index=True
    )

    CATEGORY = Column(String(40), nullable=False, index=True)
    # TRAVEL / FOOD / ACCOMMODATION / OFFICE_SUPPLIES / FUEL /
    # COMMUNICATION / CLIENT_MEETING / TRAINING / OTHER

    AMOUNT = Column(Float, nullable=False, default=0.0)

    EXPENSE_DATE = Column(Date, nullable=False, index=True)

    DESCRIPTION = Column(String(1000), nullable=True)

    RECEIPT_URL = Column(String(500), nullable=True)

    STATUS = Column(String(20), default="PENDING", index=True)
    # PENDING / APPROVED / REJECTED

    SUBMITTED_AT = Column(DateTime, default=datetime.utcnow, index=True)

    REVIEWED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    REVIEWED_AT = Column(DateTime, nullable=True)

    REVIEW_NOTES = Column(String(1000), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True,
        index=True
    )


class EmployeeStatusHistory(Base):
    """Audit trail of every employee status change.
    Inserted by PATCH /employees/{id}/status — never updated, never
    deleted. HR can replay an employee's whole lifecycle from this table:
      ACTIVE → ON_NOTICE → RESIGNED / TERMINATED / RETIRED / ON_LEAVE_LONG
    """

    __tablename__ = "employee_status_history"

    ID              = Column(Integer, primary_key=True, autoincrement=True)
    EMPLOYEE_ID     = Column(String(36), ForeignKey("employee.ID"),
                             nullable=False, index=True)
    OLD_STATUS      = Column(String(30), nullable=True)
    NEW_STATUS      = Column(String(30), nullable=False)
    REASON          = Column(String(255), nullable=False)
    EFFECTIVE_DATE  = Column(Date, nullable=False,
                             default=lambda: datetime.utcnow().date())
    NOTES           = Column(Text, nullable=True)
    CHANGED_BY_ID   = Column(String(36), ForeignKey("employee.ID"), nullable=True)
    CHANGED_AT      = Column(DateTime, default=datetime.utcnow)
    VENDOR_ID       = Column(Integer, ForeignKey("vendor.ID"),
                             nullable=False, index=True)
