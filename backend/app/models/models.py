from sqlalchemy import Column, String, Integer, ForeignKey, Float, Date, Time, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database.database import Base
from datetime import datetime, time
from sqlalchemy import DateTime
import uuid

class Vendor(Base):
    __tablename__ = "vendor"

    ID = Column(Integer, primary_key=True)
    VENDOR_NAME = Column(String(100))

    root_users = relationship("RootUser", back_populates="vendor")
class RootUser(Base):
    __tablename__ = "root_user"

    ID = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    EMAIL = Column(String(100), unique=True)

    PASSWORD = Column(String(255))

    STATUS = Column(String(20), default="ACTIVE")
    

    VENDOR_ID = Column(Integer, ForeignKey("vendor.ID"))

    vendor = relationship("Vendor", back_populates="root_users")


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

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

class Role(Base):

    __tablename__ = "role"

    ID = Column(Integer, primary_key=True, index=True)

    ROLE_NAME = Column(String(100))

    DESCRIPTION = Column(String(255), nullable=True)

    IS_SYSTEM = Column(Integer, default=0)
    # 1 = standard role seeded by us (cannot be deleted)
    # 0 = custom role created by admin

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )


class Department(Base):

    __tablename__ = "department"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "CODE",
            name="uq_dept_vendor_code"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    NAME = Column(String(100))

    CODE = Column(String(20))
    # short code per vendor — e.g. "SW", "WLD", "PRD"

    DESCRIPTION = Column(String(255), nullable=True)

    HEAD_EMPLOYEE_ID = Column(
        String(36),
        nullable=True
        # FK to employee.ID added in Module 2 once Employee
        # model is restructured — leave nullable for now
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)


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



class Customer(Base):
    """
    Customer master — companies that buy vending machines from
    BVC24. Rich enough to drive a customer-centric "command
    center" view connected to their Projects + Work Orders +
    machine models.
    """

    __tablename__ = "customer"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    # ---- Tenant scope ----
    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True,
        nullable=True
    )

    # ---- Core identity ----
    CUSTOMER_CODE = Column(String(20), index=True)
    # e.g. "CUST-001" — auto-generated if not supplied

    CUSTOMER_NAME = Column(String(100))
    # Company / business name

    CONTACT_PERSON = Column(String(100), nullable=True)

    DESIGNATION = Column(String(80), nullable=True)
    # e.g. "Purchase Manager", "CEO"

    # ---- Reach ----
    PHONE = Column(String(20))

    ALTERNATE_PHONE = Column(String(20), nullable=True)

    EMAIL = Column(String(100))

    WEBSITE = Column(String(200), nullable=True)

    # ---- Address ----
    ADDRESS = Column(String(255))
    # Combined address for back-compat with the old schema

    CITY = Column(String(80), nullable=True)

    STATE = Column(String(80), nullable=True)

    PINCODE = Column(String(15), nullable=True)

    COUNTRY = Column(String(60), default="India", nullable=True)

    # ---- KYC / Tax ----
    GST_NUMBER = Column(String(20), nullable=True, index=True)

    PAN_NUMBER = Column(String(15), nullable=True)

    # ---- Business meta ----
    INDUSTRY = Column(String(60), nullable=True, index=True)
    # Retail / Healthcare / Education / Metro / Office /
    # Hotel / Government / Other — drives segment analytics.

    SOURCE = Column(String(40), nullable=True)
    # Where the lead came from: Website / Exhibition /
    # Referral / Direct sales / Tender

    STATUS = Column(
        String(20),
        default="ACTIVE"
    )
    # LEAD / PROSPECT / ACTIVE / INACTIVE

    NOTES = Column(String(1000), nullable=True)

    # ============================================================
    # Phase 1 — Lead Pipeline + CRM Master fields
    # ============================================================

    # Who the customer is
    CUSTOMER_TYPE = Column(String(30), nullable=True)
    # INDIVIDUAL / COMPANY / DEALER / DISTRIBUTOR

    BUSINESS_TYPE = Column(String(60), nullable=True)
    # Free-text: "B2B Retail Chain", "Hospital Network", etc.

    NUMBER_OF_BRANCHES = Column(Integer, nullable=True)

    EXPECTED_MONTHLY_ORDERS = Column(Integer, nullable=True)

    EXISTING_MACHINE_USAGE = Column(Integer, default=0)
    # 0/1 — do they already have vending machines from someone else?

    CURRENT_VENDOR_NAME = Column(String(150), nullable=True)
    # Their incumbent supplier, if any

    WHATSAPP_NUMBER = Column(String(20), nullable=True)
    # Often different from main PHONE — used for follow-ups

    # Address split (kept ADDRESS as primary for back-compat)
    BILLING_ADDRESS = Column(String(500), nullable=True)

    SHIPPING_ADDRESS = Column(String(500), nullable=True)

    GOOGLE_MAP_LOCATION = Column(String(255), nullable=True)
    # Google Maps URL or "lat,lng" string for delivery routing

    # Lead pipeline fields
    LEAD_SOURCE = Column(String(40), nullable=True, index=True)
    # WEBSITE / COLD_CALL / REFERENCE / WALK_IN / EMAIL /
    # TRADE_FAIR / SOCIAL_MEDIA / OTHER

    LEAD_STATUS = Column(
        String(30),
        default="NEW",
        index=True
    )
    # NEW → CONTACTED → QUALIFIED → QUOTED → NEGOTIATING → WON / LOST

    LEAD_PRIORITY = Column(
        String(10),
        default="MEDIUM",
        index=True
    )
    # HIGH / MEDIUM / LOW

    LEAD_CREATED_DATE = Column(Date, nullable=True)

    ASSIGNED_SALES_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
        index=True
    )
    # The salesperson owning this lead

    FOLLOW_UP_DATE = Column(Date, nullable=True)

    NEXT_MEETING_DATE = Column(DateTime, nullable=True)

    REQUIREMENT_NOTES = Column(String(2000), nullable=True)
    # First-call notes — what the customer is looking for

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class CustomerContact(Base):
    """
    Additional contact persons attached to a Customer. The primary
    contact lives on Customer.CONTACT_PERSON; this table is for
    everyone ELSE in the buying organization — purchase manager,
    finance head, technical lead, etc.

    IS_PRIMARY=1 marks the "preferred contact for routing emails"
    so the sales team isn't guessing whom to call.
    """

    __tablename__ = "customer_contact"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    CUSTOMER_ID = Column(
        Integer,
        ForeignKey("customer.ID"),
        index=True
    )

    NAME = Column(String(100))

    DESIGNATION = Column(String(80), nullable=True)

    DEPARTMENT = Column(String(80), nullable=True)

    PHONE = Column(String(20), nullable=True)

    WHATSAPP = Column(String(20), nullable=True)

    EMAIL = Column(String(100), nullable=True)

    IS_PRIMARY = Column(Integer, default=0)

    NOTES = Column(String(500), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )


class CustomerRequirement(Base):
    """
    Phase 2 — Customer Requirements.

    A customer can request several different vending machines, each
    with its own specs and target terms. This table is the multi-row
    "what they want" list that later drives quotations, BOM picks
    and project creation.

    Lifecycle:
      DRAFT       — captured during enquiry, not finalized
      CONFIRMED   — customer locked the spec
      QUOTED      — quotation issued (links to Quotation later)
      ORDERED     — converted to Sales Order / Project
      CANCELLED   — dropped
    """

    __tablename__ = "customer_requirement"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    CUSTOMER_ID = Column(
        Integer,
        ForeignKey("customer.ID"),
        index=True
    )

    # ---- What machine ----
    MACHINE_CATEGORY = Column(String(60), nullable=True)
    # Coffee / Snack / Beverage / Combo / Custom

    MACHINE_NAME = Column(String(150), nullable=True)
    # Free-text label even if no product model exists yet

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        nullable=True,
        index=True
    )
    # Optional link to an existing ProductModel

    # ---- How many / how big ----
    QUANTITY = Column(Integer, default=1)

    CAPACITY = Column(String(60), nullable=True)
    # "10 selections", "200 cups", "5 trays" — free-text

    # ---- Commercials ----
    TARGET_UNIT_PRICE = Column(Float, nullable=True)

    TARGET_DELIVERY_DATE = Column(Date, nullable=True)

    # ---- Where it goes ----
    INSTALLATION_SITE = Column(String(255), nullable=True)
    # Which branch / address of the customer it ships to

    # ---- Workflow ----
    PRIORITY = Column(String(10), default="MEDIUM", index=True)
    # HIGH / MEDIUM / LOW

    STATUS = Column(String(20), default="DRAFT", index=True)
    # DRAFT / CONFIRMED / QUOTED / ORDERED / CANCELLED

    SPECIAL_NOTES = Column(String(2000), nullable=True)
    # Custom features, branding, refrigeration, etc.

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True,
        nullable=True
    )


class ProjectCategory(Base):

    __tablename__ = "project_category"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SECTION = Column(
        String(30),
        index=True
    )

    NAME = Column(
        String(100),
        unique=True
    )

    DESCRIPTION = Column(
        String(255),
        nullable=True
    )


class SubProjectTemplate(Base):

    __tablename__ = "sub_project_template"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    CATEGORY_ID = Column(
        Integer,
        ForeignKey("project_category.ID"),
        index=True
    )

    NAME = Column(
        String(100)
    )

    DESCRIPTION = Column(
        String(500),
        nullable=True
    )

    ESTIMATED_TOTAL_DAYS = Column(
        Integer,
        default=30
    )


class Project(Base):

    __tablename__ = "project"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    PROJECT_NAME = Column(
        String(200)
    )

    DESCRIPTION = Column(
        String(2000)
    )

    STATUS = Column(
        String(50),
        default="PENDING"
    )

    SUB_PROJECT_TEMPLATE_ID = Column(
        Integer,
        ForeignKey("sub_project_template.ID"),
        nullable=True,
        index=True
    )

    DEPARTMENT_ID = Column(
        Integer,
        ForeignKey("department.ID"),
        nullable=True,
        index=True
    )

    CUSTOMER_ID = Column(
        Integer,
        ForeignKey("customer.ID")
    )

    SKILLS_REQUIRED = Column(
        String(500),
        nullable=True
    )
    # comma-separated skill tags this project needs;
    # used by allocation_service for skill-overlap scoring.

    PRIORITY = Column(
        String(20),
        default="MEDIUM"
    )
    # HIGH / MEDIUM / LOW — weights into allocation score.

    # ---- NEW: Product-as-source linkage --------------------------
    # A Project is now an *instance* of a Product (Machine Model)
    # being built for a Customer. The product's BOM + stages flow
    # into the project's task graph automatically when the project
    # is created via the /projects/from-product endpoint.

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        nullable=True,
        index=True
    )

    QUANTITY = Column(
        Integer,
        default=1
    )
    # How many units of the product this project will deliver.

    TARGET_DATE = Column(
        Date,
        nullable=True
    )
    # When the project should be completed by.

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
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

    PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID")
    )

    ASSIGNED_TO = Column(
        String(36),
        ForeignKey("employee.ID")
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )


class MaterialCatalog(Base):

    __tablename__ = "material_catalog"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    MATERIAL_NAME = Column(
        String(100),
        unique=True,
        index=True
    )


class MaterialDepartment(Base):
    """
    Many-to-many: which departments can see / use which
    materials. A material with no rows here is treated as
    "unclassified" — visible only to admins / managers.
    """

    __tablename__ = "material_department"

    MATERIAL_ID = Column(
        Integer,
        ForeignKey("material_catalog.ID"),
        primary_key=True
    )

    DEPARTMENT_ID = Column(
        Integer,
        ForeignKey("department.ID"),
        primary_key=True
    )


class Inventory(Base):

    __tablename__ = "inventory"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    MATERIAL_ID = Column(
        Integer,
        ForeignKey("material_catalog.ID"),
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


class WorkCenter(Base):
    """A physical or logical work-station capability used in routing.

    Odoo-style separation: ProcessStage = "WHAT to do in the process",
    WorkCenter = "WHERE / by what capability it gets done". Multiple
    Machines may belong to the same Work Center (e.g. three identical
    welding bays); routing assigns each stage to one Work Center, and
    the scheduler picks an available machine from that pool.

    Adding this table does NOT touch any existing data — current
    BOMs and Work Orders keep working without a Work Center reference.
    The Routing feature (next phase) starts populating it.
    """

    __tablename__ = "work_center"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "NAME",
            name="uq_work_center_vendor_name"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    NAME = Column(String(100), nullable=False)
    # Human-readable: "Laser Cutting", "Welding Bay", "Assembly Line A"

    CODE = Column(String(20), nullable=True)
    # Short code for reports: "LC", "WLD", "PAINT", "ASM", "TEST"

    CATEGORY = Column(String(40), default="ASSEMBLY")
    # FABRICATION / WELDING / PAINTING / ASSEMBLY / TESTING /
    # PACKAGING / QC / OTHER — informational grouping

    CAPACITY_PER_HOUR = Column(Float, default=1.0)
    # Theoretical throughput in units/hour. Used later for Gantt
    # scheduling. Default 1 = "one unit per hour" — safe placeholder.

    HOURLY_COST = Column(Float, default=0.0)
    # Optional costing field for future job-cost rollup.

    LOCATION = Column(String(200), nullable=True)
    # Free text — "Bay 3, Ground Floor"

    NOTES = Column(String(500), nullable=True)

    IS_ACTIVE = Column(Integer, default=1)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=False,
        default=1,
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class Machine(Base):

    __tablename__ = "machine"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    MACHINE_NAME = Column(String(100))

    MACHINE_TYPE = Column(String(50))

    STATUS = Column(
        String(20),
        default="IDLE"
    )

    LOCATION = Column(String(100), nullable=True)

    LAST_UPDATED = Column(
        DateTime,
        default=datetime.utcnow
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID")
    )

    # Auto-sync provenance: every manufactured unit of every active
    # Work Order becomes a Machine row, so the monitoring page is
    # populated automatically without manual entry.
    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        nullable=True,
        index=True
    )

    WORK_ORDER_ID = Column(
        Integer,
        ForeignKey("work_order.ID"),
        nullable=True,
        index=True
    )

    UNIT_NUMBER = Column(Integer, nullable=True)
    # 1..QUANTITY — which physical unit of the WO this is.

    SERIAL_NO = Column(String(60), nullable=True, index=True)
    # Globally unique-ish identifier e.g. "CVM-2001-WO0007-U01"


class MachineLog(Base):

    __tablename__ = "machine_log"

    ID = Column(
        Integer,
        primary_key=True,
        index=True
    )

    MACHINE_ID = Column(
        Integer,
        ForeignKey("machine.ID")
    )

    STATUS = Column(String(20))

    NOTE = Column(String(255), nullable=True)

    TIMESTAMP = Column(
        DateTime,
        default=datetime.utcnow
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

    PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID"),
        nullable=True,
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
        default=datetime.utcnow
    )

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=True
    )


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


class ProductModel(Base):
    """
    Catalog of vending machine models BVC24 manufactures.
    One row per machine variant (Snack Combo, Medicine
    Dispenser, Hot Food Box, etc.). Acts as the parent for the
    BOM (which materials go into one unit) and as the target of
    work orders (how many units to build).
    """

    __tablename__ = "product_model"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "MODEL_CODE",
            name="uq_product_model_vendor_code"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    MODEL_NAME = Column(String(150))

    MODEL_CODE = Column(String(40), index=True)
    # short SKU-style code per vendor, e.g. "BVC-SBC-01"

    CATEGORY = Column(String(60), nullable=True)
    # snack-beverage / medicine / hot-food / kiosk / fruits-veg /
    # cosmetics / alcohol — matches BVC24's product line.

    DESCRIPTION = Column(String(500), nullable=True)

    ESTIMATED_BUILD_DAYS = Column(Integer, default=7)

    STATUS = Column(
        String(20),
        default="ACTIVE"
    )
    # ACTIVE / DISCONTINUED

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class BOMItem(Base):
    """
    One line of the Bill of Materials for a ProductModel.
    Captures which material goes in, how many of it, and the
    unit of measure.

    Each line is classified as either:
      - PURCHASE: bought from an external Supplier
                  (PREFERRED_SUPPLIER_ID hints which supplier)
      - PROCESS:  produced in-house at a specific ProcessStage
                  (PROCESS_STAGE_ID points to the stage)

    Cost rollup intentionally not in this iteration —
    quantities only.
    """

    __tablename__ = "bom_item"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        index=True
    )

    MATERIAL_ID = Column(
        Integer,
        ForeignKey("material_catalog.ID"),
        nullable=True,
        index=True
    )

    MATERIAL_NAME = Column(String(150))
    # denormalized for fast list rendering even when the
    # material catalog entry is missing.

    QUANTITY = Column(Float, default=1.0)

    UNIT = Column(String(20), default="pcs")
    # pcs / kg / m / l / set

    ITEM_TYPE = Column(
        String(20),
        default="PURCHASE",
        index=True
    )
    # PURCHASE / PROCESS

    PREFERRED_SUPPLIER_ID = Column(
        Integer,
        ForeignKey("supplier.ID"),
        nullable=True,
        index=True
    )
    # Set when ITEM_TYPE = PURCHASE; the default vendor for
    # this part. Procurement picks it as the starting choice.

    PROCESS_STAGE_ID = Column(
        Integer,
        ForeignKey("process_stage.ID"),
        nullable=True,
        index=True
    )
    # Set when ITEM_TYPE = PROCESS; which stage produces it.

    NOTES = Column(String(255), nullable=True)

    # Excel-style BOM presentation fields. ITEM_NO mirrors the
    # "ITEM NO." column from the 8 Par BOM sheet (gaps are normal —
    # sub-components share the parent's number). IMAGE_URL points to
    # /static/bom/<file> served by the backend; uploaded per-line
    # via POST /production/bom/{id}/upload-image.
    ITEM_NO = Column(Integer, nullable=True)

    IMAGE_URL = Column(String(255), nullable=True)


class WorkOrder(Base):
    """
    A production run: 'build N units of model X'. Optionally
    tied to a customer Project (the sales order that triggered
    the production). Status moves PLANNED -> IN_PROGRESS ->
    DONE (or ON_HOLD / CANCELLED off the happy path).
    """

    __tablename__ = "work_order"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    WO_NUMBER = Column(
        String(30),
        unique=True,
        index=True
    )
    # human-friendly identifier, e.g. "WO-2026-0001"

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        index=True
    )

    PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID"),
        nullable=True,
        index=True
    )

    QUANTITY = Column(Integer, default=1)

    STATUS = Column(
        String(20),
        default="PLANNED",
        index=True
    )
    # PLANNED / IN_PROGRESS / ON_HOLD / DONE / CANCELLED

    PLANNED_START_DATE = Column(Date, nullable=True)

    PLANNED_END_DATE = Column(Date, nullable=True)

    ACTUAL_START_DATE = Column(Date, nullable=True)

    ACTUAL_END_DATE = Column(Date, nullable=True)

    NOTES = Column(String(500), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class Supplier(Base):
    """
    Supplier master — companies BVC24 buys raw materials,
    components or services from. Distinct from `Vendor`, which
    in this codebase represents the *tenant* (BVC24 itself).

    Mirrors Employee master: full contact + KYC details so PO
    workflow doesn't need to re-prompt. One row per supplier,
    scoped to a tenant via VENDOR_ID.
    """

    __tablename__ = "supplier"

    __table_args__ = (
        UniqueConstraint(
            "VENDOR_ID", "SUPPLIER_CODE",
            name="uq_supplier_vendor_code"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SUPPLIER_CODE = Column(
        String(30),
        index=True
    )
    # short SKU-style code per tenant, e.g. "SUP-SHEET-01"

    COMPANY_NAME = Column(String(150))

    CONTACT_PERSON = Column(String(100), nullable=True)

    PHONE = Column(String(30), nullable=True)

    EMAIL = Column(String(120), nullable=True)

    ADDRESS_LINE1 = Column(String(200), nullable=True)

    ADDRESS_LINE2 = Column(String(200), nullable=True)

    CITY = Column(String(80), nullable=True)

    STATE = Column(String(80), nullable=True)

    PINCODE = Column(String(15), nullable=True)

    GST_NUMBER = Column(String(20), nullable=True, index=True)

    PAN_NUMBER = Column(String(15), nullable=True)

    BANK_NAME = Column(String(100), nullable=True)

    ACCOUNT_NUMBER = Column(String(40), nullable=True)

    IFSC_CODE = Column(String(20), nullable=True)

    CATEGORY = Column(String(60), nullable=True, index=True)
    # e.g. "Sheet Metal", "Electronics", "Motors", "Display",
    # "Payment Hardware", "Refrigeration", "Packaging"

    PAYMENT_TERMS = Column(String(60), nullable=True)
    # e.g. "NET 30", "Advance 50%", "COD"

    STATUS = Column(
        String(20),
        default="ACTIVE"
    )
    # ACTIVE / INACTIVE / BLACKLISTED

    NOTES = Column(String(500), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class ProcessStage(Base):
    """
    One manufacturing step in the per-machine production flow.
    A ProductModel has an ordered list of stages: Design,
    Mechanical, Electrical, Wiring, Assembly, QC, etc.

    Each Work Order auto-spawns one WorkOrderStageProgress per
    active stage, which the shop floor marks ✓ DONE or ✗ FAILED
    independently (free order — no strict gating).
    """

    __tablename__ = "process_stage"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        index=True
    )

    SEQUENCE = Column(Integer, default=1)

    STAGE_NAME = Column(String(120))

    STAGE_TYPE = Column(
        String(40),
        default="ASSEMBLY"
    )
    # DESIGN / MECHANICAL / ELECTRICAL / WIRING / FABRICATION /
    # ASSEMBLY / TESTING / QC / PACKAGING / OTHER

    DESCRIPTION = Column(String(500), nullable=True)

    ESTIMATED_HOURS = Column(Float, default=8.0)

    IS_ACTIVE = Column(Integer, default=1)


class WorkOrderStageProgress(Base):
    """
    Per-WorkOrder progress on a specific ProcessStage. Created
    automatically when a Work Order is opened — one row per
    active stage of the WO's ProductModel.
    """

    __tablename__ = "wo_stage_progress"

    __table_args__ = (
        UniqueConstraint(
            "WORK_ORDER_ID", "STAGE_ID",
            name="uq_wo_stage"
        ),
    )

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    WORK_ORDER_ID = Column(
        Integer,
        ForeignKey("work_order.ID"),
        index=True
    )

    STAGE_ID = Column(
        Integer,
        ForeignKey("process_stage.ID"),
        index=True
    )

    STATUS = Column(
        String(20),
        default="PENDING",
        index=True
    )
    # PENDING / IN_PROGRESS / DONE / FAILED / SKIPPED

    ASSIGNED_TO_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    STARTED_AT = Column(DateTime, nullable=True)

    COMPLETED_AT = Column(DateTime, nullable=True)

    NOTES = Column(String(500), nullable=True)
    # FAILED status — capture the reason here (the "X mark" note)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class QCChecklistItem(Base):
    """
    Template item: one row per (ProductModel, inspection point).
    Pre-dispatch QC for that model walks through every active
    row and produces a QCInspectionResult per item.
    """

    __tablename__ = "qc_checklist_item"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        index=True
    )

    SEQUENCE = Column(Integer, default=1)
    # display order within the checklist

    CHECK_POINT = Column(String(255))
    # short label, e.g. "All dispensing motors functional"

    DESCRIPTION = Column(String(500), nullable=True)
    # longer instruction for the inspector

    SEVERITY = Column(
        String(20),
        default="MAJOR"
    )
    # MAJOR / MINOR / CRITICAL — drives NCR escalation

    IS_ACTIVE = Column(Integer, default=1)


class QCInspection(Base):
    """
    One inspection cycle for a Work Order. Captures who
    inspected, when, overall result, and rolls up per-item
    results via QCInspectionResult.
    """

    __tablename__ = "qc_inspection"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    WORK_ORDER_ID = Column(
        Integer,
        ForeignKey("work_order.ID"),
        index=True
    )

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        index=True
    )

    INSPECTOR_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    INSPECTION_DATE = Column(Date, default=datetime.utcnow)

    STATUS = Column(
        String(20),
        default="PENDING",
        index=True
    )
    # PENDING / PASS / FAIL / REWORK

    PASS_COUNT = Column(Integer, default=0)

    FAIL_COUNT = Column(Integer, default=0)

    REWORK_COUNT = Column(Integer, default=0)

    NOTES = Column(String(500), nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class QCInspectionResult(Base):
    """
    One row per (QCInspection, checklist item). Captures the
    inspector's verdict for that specific check.
    """

    __tablename__ = "qc_inspection_result"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    INSPECTION_ID = Column(
        Integer,
        ForeignKey("qc_inspection.ID"),
        index=True
    )

    CHECKLIST_ITEM_ID = Column(
        Integer,
        ForeignKey("qc_checklist_item.ID"),
        nullable=True
    )

    CHECK_POINT = Column(String(255))
    # denormalised label so the result stays readable even if
    # the checklist item is edited later.

    RESULT = Column(
        String(20),
        default="PENDING"
    )
    # PASS / FAIL / NEEDS_REWORK / NA

    NOTES = Column(String(500), nullable=True)

    RECORDED_AT = Column(DateTime, default=datetime.utcnow)


class NCR(Base):
    """
    Non-Conformance Report — auto-created when an inspection
    item is marked FAIL or NEEDS_REWORK. Tracks corrective
    action and closure separately from the inspection itself
    so RCA work can outlive the original inspection cycle.
    """

    __tablename__ = "ncr"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    NCR_NUMBER = Column(
        String(30),
        unique=True,
        index=True
    )
    # e.g. "NCR-2026-0001"

    INSPECTION_ID = Column(
        Integer,
        ForeignKey("qc_inspection.ID"),
        nullable=True,
        index=True
    )

    WORK_ORDER_ID = Column(
        Integer,
        ForeignKey("work_order.ID"),
        nullable=True,
        index=True
    )

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        nullable=True
    )

    CHECK_POINT = Column(String(255))

    SEVERITY = Column(
        String(20),
        default="MAJOR"
    )
    # CRITICAL / MAJOR / MINOR

    DESCRIPTION = Column(String(1000))

    ROOT_CAUSE = Column(String(1000), nullable=True)

    CORRECTIVE_ACTION = Column(String(1000), nullable=True)

    STATUS = Column(
        String(20),
        default="OPEN",
        index=True
    )
    # OPEN / IN_PROGRESS / CLOSED

    REPORTED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    ASSIGNED_TO_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    OPENED_AT = Column(DateTime, default=datetime.utcnow)

    CLOSED_AT = Column(DateTime, nullable=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True
    )


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

    PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID"),
        nullable=True
    )

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

    # Per-slip payment workflow (simpler than run-level statuses).
    # 'PENDING' on generation; flips to 'PAID' when the admin clicks
    # Mark Paid against this employee's row.
    STATUS = Column(String(20), default="PENDING")
    PAID_AT = Column(DateTime, nullable=True)

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

class Quotation(Base):
    """
    A formal price offer issued to a customer. One quotation can
    have many lines (different machines / configurations). When the
    customer accepts, the quotation is "converted" → a Sales Order
    that in turn spawns Projects.

    Lifecycle:
      DRAFT       — being prepared
      GENERATED   — auto-generated from requirements, awaiting send
      SENT        — emailed/shared with customer
      VIEWED      — customer opened the public link
      NEGOTIATION — customer wants modifications, sales rep iterating
      APPROVED    — customer accepted (ready to convert)
      REJECTED    — customer said no
      CONVERTED   — turned into a sales order / project
      EXPIRED     — past validity, no decision
    """

    __tablename__ = "quotation"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    QUOTATION_NUMBER = Column(String(30), unique=True, index=True)

    CUSTOMER_ID = Column(
        Integer,
        ForeignKey("customer.ID"),
        index=True
    )

    QUOTATION_DATE = Column(Date, default=datetime.utcnow)

    VALIDITY_DAYS = Column(Integer, default=30)

    EXPIRY_DATE = Column(Date, nullable=True)

    STATUS = Column(String(20), default="DRAFT", index=True)

    SUBTOTAL = Column(Float, default=0.0)

    DISCOUNT_PERCENT = Column(Float, default=0.0)

    DISCOUNT_AMOUNT = Column(Float, default=0.0)

    TAX_PERCENT = Column(Float, default=18.0)

    TAX_AMOUNT = Column(Float, default=0.0)

    GRAND_TOTAL = Column(Float, default=0.0)

    TERMS_AND_CONDITIONS = Column(String(3000), nullable=True)

    NOTES = Column(String(2000), nullable=True)

    PREPARED_BY = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    SENT_AT = Column(DateTime, nullable=True)

    APPROVED_AT = Column(DateTime, nullable=True)

    REJECTED_AT = Column(DateTime, nullable=True)

    REJECTION_REASON = Column(String(500), nullable=True)

    # ---- Tracking (sharing + view) ----
    PUBLIC_TOKEN = Column(String(64), unique=True, index=True, nullable=True)
    # Opaque random token for the public share URL /q/<token>

    EMAIL_SENT_AT = Column(DateTime, nullable=True)
    # Last time an email was successfully dispatched to the customer

    EMAIL_SENT_COUNT = Column(Integer, default=0)
    # Number of times the quotation has been emailed (incl. resends)

    LAST_EMAIL_STATUS = Column(String(200), nullable=True)
    # Success message or error from the email provider

    VIEWED_AT = Column(DateTime, nullable=True)
    # First time the customer opened the public link

    LAST_VIEWED_AT = Column(DateTime, nullable=True)
    # Most recent view

    VIEW_COUNT = Column(Integer, default=0)
    # How many times the public link has been opened

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True,
        nullable=True
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class QuotationActivity(Base):
    """
    Timeline of everything that happened to a Quotation — created,
    sent, emailed, viewed, approved, etc. One row per event, ordered
    by CREATED_AT for the UI timeline.
    """

    __tablename__ = "quotation_activity"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    QUOTATION_ID = Column(
        Integer,
        ForeignKey("quotation.ID"),
        index=True
    )

    EVENT_TYPE = Column(String(40), index=True)
    # CREATED / SENT / EMAIL_SENT / EMAIL_FAILED / VIEWED /
    # APPROVED / REJECTED / EXPIRED / CONVERTED / RESENT

    EVENT_DETAIL = Column(String(500), nullable=True)
    # Free-text — e.g. "Email to procurement@xyz.in" or
    # "Viewed from IP 49.205.x.x"

    ACTOR_TYPE = Column(String(20), nullable=True)
    # SYSTEM / SALES / CUSTOMER

    ACTOR_NAME = Column(String(150), nullable=True)
    # Salesperson name or "customer" or "system"

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)


class QuotationNegotiation(Base):
    """
    Transcript of the AI Negotiation Assistant chat held on the
    public `/q/{token}` quotation page. One row per message (either
    from the customer or from the assistant). Auditable so sales can
    later review what was promised by the bot.
    """

    __tablename__ = "quotation_negotiation"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    QUOTATION_ID = Column(
        Integer,
        ForeignKey("quotation.ID"),
        index=True
    )

    ROLE = Column(String(20), index=True)
    # 'customer' | 'assistant'

    CONTENT = Column(Text)
    # Raw chat message body. Text (unbounded) because customers may
    # type long descriptions of their requirements.

    INTENT = Column(String(30), nullable=True)
    # DISCOUNT | WARRANTY | INSTALL | DELIVERY | QUANTITY | INFO | OTHER
    # NULL for customer rows (intent is classified by the bot).

    ACTION = Column(String(30), nullable=True)
    # AUTO_APPROVE | COUNTER | DECLINE | INFO_ONLY (bot rows only)

    DISCOUNT_PERCENT = Column(Float, nullable=True)
    # The discount the bot offered on this turn (if any).

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)


class QuotationLine(Base):
    """
    One line item on a quotation. Either references an existing
    ProductModel or describes a custom build via DESCRIPTION.
    LINE_TOTAL is denormalized so we don't re-compute on every read.
    """

    __tablename__ = "quotation_line"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    QUOTATION_ID = Column(
        Integer,
        ForeignKey("quotation.ID"),
        index=True
    )

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        nullable=True,
        index=True
    )

    REQUIREMENT_ID = Column(
        Integer,
        ForeignKey("customer_requirement.ID"),
        nullable=True,
        index=True
    )

    DESCRIPTION = Column(String(500))

    HSN_CODE = Column(String(20), nullable=True)

    QUANTITY = Column(Float, default=1.0)

    UNIT = Column(String(20), default="nos")

    UNIT_PRICE = Column(Float, default=0.0)

    DISCOUNT_PERCENT = Column(Float, default=0.0)

    LINE_TOTAL = Column(Float, default=0.0)

    SORT_ORDER = Column(Integer, default=0)


# ====================================================================
# Phase 4 — Purchase Order Module
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

    LINKED_PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID"),
        nullable=True,
        index=True
    )
    # Optional — the project this PO is feeding materials to.
    # Lets us roll up "PO total per project" reports later.

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

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class PurchaseOrderLine(Base):
    """
    One line on a PO. Links to MaterialCatalog when possible (so we
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

    MATERIAL_ID = Column(
        Integer,
        ForeignKey("material_catalog.ID"),
        nullable=True,
        index=True
    )

    BOM_ITEM_ID = Column(
        Integer,
        ForeignKey("bom_item.ID"),
        nullable=True,
        index=True
    )
    # Optional — when PO was auto-generated from a BOM, this points
    # back to the originating BOM line.

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


# ====================================================================
# Phase 5 — Sales Order Module
# ====================================================================
# Sales Orders are the formal contract that follows an APPROVED
# quotation. Each SO line represents a machine/product to be built,
# and finalizing the SO auto-spawns Projects that drive the
# manufacturing workflow already wired in Phases 1-4.

class SalesOrder(Base):
    """
    Customer-facing sales contract. Spawned from an APPROVED
    Quotation (or hand-created from scratch). Each line becomes a
    Project; payment milestones drive when invoices fire.

    Lifecycle:
      DRAFT          — building / negotiating
      CONFIRMED      — customer accepted, advance received
      IN_PRODUCTION  — projects spawned, manufacturing started
      SHIPPED        — goods dispatched to customer
      DELIVERED      — customer signed acceptance
      CLOSED         — final payment received, contract complete
      CANCELLED      — voided before close
    """

    __tablename__ = "sales_order"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SO_NUMBER = Column(String(30), unique=True, index=True)

    CUSTOMER_ID = Column(
        Integer,
        ForeignKey("customer.ID"),
        index=True
    )

    QUOTATION_ID = Column(
        Integer,
        ForeignKey("quotation.ID"),
        nullable=True,
        index=True
    )
    # Optional source quotation — auto-set when created via
    # /sales-orders/from-quotation

    SO_DATE = Column(Date, default=datetime.utcnow)

    EXPECTED_DELIVERY_DATE = Column(Date, nullable=True)

    ADVANCE_DUE_DATE = Column(Date, nullable=True)
    # Date by which the customer must pay the advance.  When
    # /confirm is fired we email this to them. Status stays
    # AWAITING_ADVANCE until ADVANCE_RECEIVED >= required advance.

    STATUS = Column(String(20), default="DRAFT", index=True)

    SUBTOTAL = Column(Float, default=0.0)

    DISCOUNT_PERCENT = Column(Float, default=0.0)

    DISCOUNT_AMOUNT = Column(Float, default=0.0)

    TAX_PERCENT = Column(Float, default=18.0)

    TAX_AMOUNT = Column(Float, default=0.0)

    GRAND_TOTAL = Column(Float, default=0.0)

    # ---- Payment milestones (sum should be 100) ----
    ADVANCE_PERCENT = Column(Float, default=50.0)

    DISPATCH_PERCENT = Column(Float, default=40.0)

    INSTALLATION_PERCENT = Column(Float, default=10.0)

    ADVANCE_RECEIVED = Column(Float, default=0.0)

    DISPATCH_RECEIVED = Column(Float, default=0.0)

    INSTALLATION_RECEIVED = Column(Float, default=0.0)

    # ---- Operational fields ----
    SHIPPING_ADDRESS = Column(String(500), nullable=True)

    BILLING_ADDRESS = Column(String(500), nullable=True)

    TERMS_AND_CONDITIONS = Column(String(3000), nullable=True)

    NOTES = Column(String(2000), nullable=True)

    PREPARED_BY = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True
    )

    CONFIRMED_AT = Column(DateTime, nullable=True)

    PRODUCTION_STARTED_AT = Column(DateTime, nullable=True)

    SHIPPED_AT = Column(DateTime, nullable=True)

    DELIVERED_AT = Column(DateTime, nullable=True)

    CLOSED_AT = Column(DateTime, nullable=True)

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

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


class SalesOrderLine(Base):
    """One product on a sales order. Each line maps 1-to-1 to a
    spawned Project once the SO is confirmed and production starts."""

    __tablename__ = "sales_order_line"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SO_ID = Column(
        Integer,
        ForeignKey("sales_order.ID"),
        index=True
    )

    PRODUCT_MODEL_ID = Column(
        Integer,
        ForeignKey("product_model.ID"),
        nullable=True,
        index=True
    )

    QUOTATION_LINE_ID = Column(
        Integer,
        ForeignKey("quotation_line.ID"),
        nullable=True,
        index=True
    )
    # Trace back to the originating quotation line for audit

    SPAWNED_PROJECT_ID = Column(
        Integer,
        ForeignKey("project.ID"),
        nullable=True,
        index=True
    )
    # Set when /spawn-projects creates a project for this line.
    # NULL means the project hasn't been kicked off yet.

    DESCRIPTION = Column(String(500))

    HSN_CODE = Column(String(20), nullable=True)

    QUANTITY = Column(Float, default=1.0)

    UNIT = Column(String(20), default="nos")

    UNIT_PRICE = Column(Float, default=0.0)

    DISCOUNT_PERCENT = Column(Float, default=0.0)

    LINE_TOTAL = Column(Float, default=0.0)

    SORT_ORDER = Column(Integer, default=0)


class SalesOrderActivity(Base):
    """Timeline for SO events — created, confirmed, projects spawned,
    payment received, shipped, etc."""

    __tablename__ = "sales_order_activity"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SO_ID = Column(
        Integer,
        ForeignKey("sales_order.ID"),
        index=True
    )

    EVENT_TYPE = Column(String(40), index=True)
    # CREATED / CONFIRMED / EMAIL_SENT / EMAIL_FAILED /
    # PROJECTS_SPAWNED / PAYMENT_RECEIVED / SHIPPED / DELIVERED /
    # CLOSED / CANCELLED

    EVENT_DETAIL = Column(String(500), nullable=True)

    ACTOR_TYPE = Column(String(20), nullable=True)

    ACTOR_NAME = Column(String(150), nullable=True)

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)

# =================================================================
# Customer Self-Onboarding Portal (Phase: portal MVP)
# =================================================================
#
# Three tables drive the customer self-serve onboarding flow:
#
# 1. CustomerOnboardingSession   one row per invitation; carries
#                                 status, partial data, and the
#                                 eventually-created CUSTOMER_ID.
# 2. CustomerPortalUser           the customer's portal account
#                                 (username + bcrypt password,
#                                 session key for stateless auth).
# 3. CustomerChatMessage          full chat transcript for audit
#                                 and admin replay.

class CustomerOnboardingSession(Base):
    """One row per onboarding invite. PARTIAL_DATA is a JSON-encoded
    dict of all the fields the AI has extracted so far. Status
    transitions: INVITED -> REGISTERED -> IN_PROGRESS -> SUBMITTED.
    On SUBMITTED, CUSTOMER_ID points at the new Customer row in CRM."""

    __tablename__ = "customer_onboarding_session"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    TOKEN = Column(
        String(64),
        unique=True,
        index=True
    )
    # URL-safe random token; appears in /portal/onboarding/<TOKEN>

    STATUS = Column(
        String(20),
        default="INVITED",
        index=True
    )
    # INVITED  -> link generated, customer hasn't opened it yet
    # REGISTERED -> customer set username + password
    # IN_PROGRESS -> at least one chat exchange happened
    # SUBMITTED -> customer clicked Submit; CUSTOMER_ID is set

    NAME_HINT = Column(String(200), nullable=True)
    # Optional company name pre-filled by admin in the invite form

    EMAIL_HINT = Column(String(150), nullable=True)
    # Optional email pre-filled by admin (used for invitation email)

    INVITED_BY_ID = Column(String(36), nullable=True)
    # employee.ID of the admin who generated the link

    PARTIAL_DATA = Column(Text, nullable=True)
    # JSON-encoded dict of every Customer field collected so far

    PROGRESS_PCT = Column(Integer, default=0)
    # 0..100 computed from required-fields-filled / total-required

    NEXT_FIELD_HINT = Column(String(50), nullable=True)
    # AI's last-suggested next field key (for resume)

    CUSTOMER_ID = Column(
        Integer,
        ForeignKey("customer.ID"),
        nullable=True,
        index=True
    )
    # Filled once SUBMITTED — links to the created Customer row

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        index=True,
        default=1
    )

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)

    REGISTERED_AT = Column(DateTime, nullable=True)

    LAST_ACTIVITY_AT = Column(DateTime, nullable=True)

    SUBMITTED_AT = Column(DateTime, nullable=True)


class CustomerPortalUser(Base):
    """The customer's portal account (username + bcrypt password).
    Bound to a single onboarding session. SESSION_KEY is a random
    string used as a bearer token on subsequent portal API calls."""

    __tablename__ = "customer_portal_user"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SESSION_ID = Column(
        Integer,
        ForeignKey("customer_onboarding_session.ID"),
        unique=True,
        index=True
    )

    USERNAME = Column(String(80), index=True)

    PASSWORD = Column(String(255))
    # bcrypt hash

    SESSION_KEY = Column(String(80), nullable=True, index=True)
    # rotated on each login; sent back to the portal client and
    # validated on every API call (lightweight bearer token, no JWT)

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    LAST_LOGIN_AT = Column(DateTime, nullable=True)


class CustomerChatMessage(Base):
    """Append-only transcript of the AI <-> customer conversation."""

    __tablename__ = "customer_chat_message"

    ID = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
        index=True
    )

    SESSION_ID = Column(
        Integer,
        ForeignKey("customer_onboarding_session.ID"),
        index=True
    )

    ROLE = Column(String(20))
    # 'user' | 'assistant' | 'system'

    CONTENT = Column(Text)

    FIELD_KEY = Column(String(60), nullable=True)
    # When assistant asked for a specific field, store the key here
    # (helps admin replay see which question targeted which field)

    EXTRACTED_FIELDS = Column(Text, nullable=True)
    # JSON: fields the AI extracted from this user message

    CREATED_AT = Column(DateTime, default=datetime.utcnow, index=True)


# =================================================================
# Employee Self-Onboarding Portal (chatbot-driven invite flow)
# =================================================================
#
# Mirrors CustomerOnboardingSession but for new hires. Admin
# generates an invite token, the candidate fills out their
# profile via a chatbot, then admin reviews & approves — at
# which point the Employee row is created (or linked, if
# EMPLOYEE_CODE was pre-allocated).

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


# ====================================================================
# Holiday Calendar (Phase 2 — replaces hardcoded 26 working days)
# ====================================================================
# One row per declared holiday. Used by:
#   - payroll_service._working_days_in_month(year, month, vendor_id)
#   - star_performance_service (working-day denominator)
#
# Sundays are implicitly holidays (handled in code, not stored). Saturday
# may or may not be a holiday depending on company policy — for BVC24,
# Saturdays are working days. To mark a Saturday as off, just add a row.

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


class DiscountRequest(Base):
    """A customer discount ask that requires admin sign-off (because
    it exceeds the auto-approve cap). Created either by the
    quotation negotiation bot or manually by an admin from the
    Approval Center."""

    __tablename__ = "discount_request"

    ID = Column(Integer, primary_key=True, autoincrement=True)

    QUOTATION_ID = Column(
        Integer,
        ForeignKey("quotation.ID"),
        nullable=False,
        index=True
    )

    REQUESTED_DISCOUNT_PERCENT = Column(Float, nullable=False)

    CUSTOMER_REASON = Column(String(500), nullable=True)
    # What the customer said (from the negotiation chat)

    BOT_ACTION = Column(String(20), nullable=True)
    # AUTO_APPROVE / COUNTER / DECLINE / INFO_ONLY / ESCALATE

    STATUS = Column(String(20), default="PENDING", index=True)
    # PENDING / APPROVED / REJECTED

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

    CREATED_AT = Column(DateTime, default=datetime.utcnow)

    UPDATED_AT = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )


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
