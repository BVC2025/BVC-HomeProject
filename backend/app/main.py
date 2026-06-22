# ---------------------------------------------------------------
# Load .env BEFORE anything else — every module below this line
# uses os.getenv() and relies on the values being present.
# ---------------------------------------------------------------
import os
from pathlib import Path
from dotenv import load_dotenv

# .env lives in the backend folder (parent of `app/`)
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

load_dotenv(dotenv_path=_ENV_PATH, override=True)

print(f"[startup] .env loaded from: {_ENV_PATH}")
print(f"[startup] APPROVER_EMAIL = {os.getenv('APPROVER_EMAIL', '(empty)')}")
print(f"[startup] SMTP_HOST      = {os.getenv('SMTP_HOST', '(empty)')}")
# ---------------------------------------------------------------

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from app.routes import employee
from app.database.database import engine
from app.models.models import Base
from app.routes.users import router as users_router
from app.routes.auth import router as auth_router
from app.routes.vendor import router as vendor_router
from app.routes.project import router as project_router
from app.routes.task import router as task_router
from app.routes.inventory import router as inventory_router
from app.routes.analytics import router as analytics_router
from app.routes.attendance import router as attendance_router
from app.routes.machine import router as machine_router
from app.routes.notification import router as notification_router
from app.routes.reports import router as reports_router
from app.routes.settings import router as settings_router
from app.routes.employee_task import router as employee_task_router
from app.routes.project_template import router as project_template_router
from app.routes.organization import router as organization_router
from app.routes.task_approval import router as task_approval_router
from app.routes.chatbot import router as chatbot_router
from app.routes.biometric import router as biometric_router
from app.routes.bvc24_seed import router as bvc24_seed_router
from app.routes.performance import router as performance_router
from app.routes.production import router as production_router
from app.routes.quality import router as quality_router
from app.routes.supplier import router as supplier_router
from app.routes.process import router as process_router
from app.routes.leave import router as leave_router
from app.routes.connect import router as connect_router
from app.routes.payroll import router as payroll_router
from app.routes.quotation import router as quotation_router
from app.routes.purchase_order import router as purchase_order_router
from app.routes.procurement_seed import router as procurement_seed_router
from app.routes.hr_assistant import router as hr_assistant_router
from app.routes.sales_order import router as sales_order_router
from app.routes.whatsapp import router as whatsapp_router
from app.routes.onboarding import router as onboarding_router
from app.routes.employee_onboarding import router as employee_onboarding_router
from app.routes.employee_documents import router as employee_documents_router
from app.routes.admin_dashboard import router as admin_dashboard_router
from app.routes.approvals import router as approvals_router
# ai_command router removed Phase 2 — front-end stub was deleted
from app.routes.dashboard_aggregators import router as dashboard_aggregators_router
from app.routes.ai import router as ai_router
from app.routes.public_enquiry import router as public_enquiry_router
from app.routes.geofence import router as geofence_router
from app.routes.employee_memos import router as employee_memos_router
from app.routes.leave_chatbot import router as leave_chatbot_router
from app.routes.employee_portal import router as employee_portal_router
from app.routes.audit import router as audit_router  # Phase 3 security
from app.routes.rbac import router as rbac_router    # Phase 2 RBAC
from app.routes.holiday import router as holiday_router    # Phase 2 Holiday Calendar
from app.routes.chatbot_ai import router as chatbot_ai_router  # AI chatbot v1 (Gemini)
from app.routes.work_center import router as work_center_router  # Mfg Phase 1 — Work Centers
from app.routes.allowance import router as allowance_router  # Employee expense claims
from app.routes.leave_agent import router as leave_agent_router  # AI Leave Agent
from app.routes.hr_chat import router as hr_chat_router          # Unified HR Assistant
from app.routes.recruitment import router as recruitment_router  # Phase 2 — AI Recruitment Assistant
from app.routes.employee_payslips import router as my_payslips_router  # Employee self-service payslips
from fastapi.middleware.cors import CORSMiddleware

# Phase 3 — Audit log
from starlette.middleware.base import BaseHTTPMiddleware
from app.services.audit_service import should_audit, write_audit_row


app = FastAPI(
    title="Bharath Vending ERP API",
    description=(
        "Vendor-based Manufacturing ERP — endpoints for "
        "auth, employees, tasks, projects, inventory, "
        "attendance, machines, notifications and more."
    ),
    version="1.0.0"
)


class AuditMiddleware(BaseHTTPMiddleware):
    """Logs every state-changing HTTP request to the audit_log table.

    GETs/HEADs/OPTIONS are skipped (handled in should_audit()) so the
    table stays small and write volume stays low. Failed requests
    (4xx/5xx) ARE captured — that's the most forensically useful
    case (intrusion attempts, permission violations, etc.).

    Also surfaces CORS preflight failures to stdout — these are easy
    to miss because they never reach a route handler and never get
    audited. When an OPTIONS request returns 400, we log the Origin
    so you can extend the CORS allow-list without debugging blind.
    """

    async def dispatch(self, request, call_next):

        # Run the actual request first
        response = await call_next(request)

        # Decide AFTER we have a status code so we can include it
        method = request.method
        path = request.url.path

        # CORS preflight diagnostic — only log the bad ones to keep
        # noise low. A 200 OPTIONS means CORS approved; a 400 means
        # the Origin was rejected by CORSMiddleware.
        if method == "OPTIONS" and response.status_code == 400:
            origin = request.headers.get("origin", "<missing>")
            print(
                f"[cors-reject] OPTIONS {path}  origin={origin}  "
                f"-> 400 (extend allow_origins / allow_origin_regex in main.py)"
            )

        if not should_audit(method, path):
            return response

        try:
            write_audit_row(
                method=method,
                path=path,
                status_code=response.status_code,
                auth_header=request.headers.get("authorization"),
                client_ip=(request.client.host if request.client else None),
                user_agent=request.headers.get("user-agent", "")[:500],
            )
        except Exception as e:
            # Never let audit failure break the response.
            print(f"[audit-middleware] {type(e).__name__}: {e}")

        return response


# Audit MUST run AFTER CORS (so OPTIONS preflight short-circuits
# and never reaches our logger). Order: CORS added second runs
# first → audit added first runs second.
app.add_middleware(AuditMiddleware)

# CORS — explicit allow-list. allow_origins=["*"] is incompatible with
# allow_credentials=True per the CORS spec (browsers reject the combo),
# so we enumerate. Override via env: CORS_ALLOWED_ORIGINS="a.com,b.com".
# LAN IPs (for mobile-on-WiFi testing) are matched by regex below.
_DEFAULT_CORS_ORIGINS = [
    "https://erp.bvc24.com",        # production frontend
    "https://api.bvc24.com",        # in case anything self-loads
    "http://localhost:5173",        # vite dev
    "http://localhost:5174",        # vite dev (alt port)
    "http://localhost:4173",        # vite preview (production build)
    "http://127.0.0.1:5173",
    "http://127.0.0.1:4173",
]

_env_origins = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()

if _env_origins:

    _cors_origins = [o.strip() for o in _env_origins.split(",") if o.strip()]

else:

    _cors_origins = _DEFAULT_CORS_ORIGINS

# The regex below covers TWO dynamic-origin families that can't be
# enumerated in the static list above:
#
#   1. LAN IPs over HTTP — for mobile-on-WiFi testing.
#      e.g. http://192.168.1.56:5173 / http://10.0.0.5:4173
#
#   2. Cloudflare Quick Tunnel hostnames — *.trycloudflare.com over HTTPS.
#      These rotate on every `cloudflared` restart, so a pinned URL
#      would force a code edit every time the tunnel comes back up.
#      Generic pattern: lowercase letters/digits/hyphens, then
#      ".trycloudflare.com". Named-tunnel hosts (erp.bvc24.com,
#      api.bvc24.com) are in the static list and don't need a regex.
_CORS_ORIGIN_REGEX = (
    r"^http://(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.[\d.]+:\d{4}$"
    r"|^https://[a-z0-9-]+\.trycloudflare\.com$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Static file serving for user-uploaded assets (BOM line images,
# etc.). Backend writes to backend/static/, frontend reads via
# /static/<subpath>. Directory is auto-created if missing so a
# fresh install doesn't crash on startup.
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

(_STATIC_DIR / "bom").mkdir(parents=True, exist_ok=True)

(_STATIC_DIR / "employee").mkdir(parents=True, exist_ok=True)

(_STATIC_DIR / "company").mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

Base.metadata.create_all(bind=engine)


def _auto_migrate():
    """Idempotently add columns that newer code expects but were
    introduced after the table already existed in production.
    create_all() only creates new tables — it never ALTERs existing
    ones, so without this hook those new ORM fields would 500 on
    every read until the user runs ALTER TABLE by hand."""

    import logging

    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    # (table, column, DDL fragment for the ADD COLUMN clause)
    pending = [
        ("machine",  "PRODUCT_MODEL_ID", "INT NULL"),
        ("machine",  "WORK_ORDER_ID",    "INT NULL"),
        ("machine",  "UNIT_NUMBER",      "INT NULL"),
        ("machine",  "SERIAL_NO",        "VARCHAR(60) NULL"),
        ("project",  "PRODUCT_MODEL_ID", "INT NULL"),
        ("project",  "QUANTITY",         "INT NULL DEFAULT 1"),
        ("project",  "TARGET_DATE",      "DATE NULL"),
        ("bom_item", "ITEM_NO",          "INT NULL"),
        ("bom_item", "IMAGE_URL",        "VARCHAR(255) NULL"),
        # ---- Employee profile / resume fields ----
        ("employee", "ADDRESS",            "VARCHAR(500) NULL"),
        ("employee", "CITY",               "VARCHAR(100) NULL"),
        ("employee", "STATE",              "VARCHAR(100) NULL"),
        ("employee", "PINCODE",            "VARCHAR(15) NULL"),
        ("employee", "DOB",                "DATE NULL"),
        ("employee", "GENDER",             "VARCHAR(20) NULL"),
        ("employee", "FATHER_NAME",        "VARCHAR(100) NULL"),
        ("employee", "MOTHER_NAME",        "VARCHAR(100) NULL"),
        ("employee", "MARITAL_STATUS",     "VARCHAR(20) NULL"),
        ("employee", "OCCUPATION",         "VARCHAR(100) NULL"),
        ("employee", "QUALIFICATION",      "VARCHAR(200) NULL"),
        ("employee", "YEAR_OF_PASSING",    "INT NULL"),
        ("employee", "EXPERIENCE_YEARS",   "FLOAT NULL DEFAULT 0"),
        ("employee", "EXPERIENCE_DETAILS", "VARCHAR(1000) NULL"),
        ("employee", "PAST_PROJECTS",      "VARCHAR(1000) NULL"),
        ("employee", "EMPLOYMENT_TYPE",    "VARCHAR(20) NULL"),
        ("employee", "NOTES",              "VARCHAR(1000) NULL"),
        ("employee", "PHOTO_URL",          "VARCHAR(255) NULL"),
        ("employee", "PROFILE_SUBMITTED",  "INT NOT NULL DEFAULT 0"),
        # ---- Customer Master + Lead Pipeline (Phase 1) ----
        ("customer", "VENDOR_ID",            "INT NULL"),
        ("customer", "CUSTOMER_TYPE",        "VARCHAR(30) NULL"),
        ("customer", "BUSINESS_TYPE",        "VARCHAR(60) NULL"),
        ("customer", "NUMBER_OF_BRANCHES",   "INT NULL"),
        ("customer", "EXPECTED_MONTHLY_ORDERS", "INT NULL"),
        ("customer", "EXISTING_MACHINE_USAGE", "INT NULL DEFAULT 0"),
        ("customer", "CURRENT_VENDOR_NAME",  "VARCHAR(150) NULL"),
        ("customer", "WHATSAPP_NUMBER",      "VARCHAR(20) NULL"),
        ("customer", "BILLING_ADDRESS",      "VARCHAR(500) NULL"),
        ("customer", "SHIPPING_ADDRESS",     "VARCHAR(500) NULL"),
        ("customer", "GOOGLE_MAP_LOCATION",  "VARCHAR(255) NULL"),
        ("customer", "LEAD_SOURCE",          "VARCHAR(40) NULL"),
        ("customer", "LEAD_STATUS",          "VARCHAR(30) NULL DEFAULT 'NEW'"),
        ("customer", "LEAD_PRIORITY",        "VARCHAR(10) NULL DEFAULT 'MEDIUM'"),
        ("customer", "LEAD_CREATED_DATE",    "DATE NULL"),
        ("customer", "ASSIGNED_SALES_ID",    "VARCHAR(36) NULL"),
        ("customer", "FOLLOW_UP_DATE",       "DATE NULL"),
        ("customer", "NEXT_MEETING_DATE",    "DATETIME NULL"),
        ("customer", "REQUIREMENT_NOTES",    "VARCHAR(2000) NULL"),
        # ---- Phase 3: Quotation tracking (send/view) ----
        ("quotation", "PUBLIC_TOKEN",       "VARCHAR(64) NULL"),
        ("quotation", "EMAIL_SENT_AT",      "DATETIME NULL"),
        ("quotation", "EMAIL_SENT_COUNT",   "INT NOT NULL DEFAULT 0"),
        ("quotation", "LAST_EMAIL_STATUS",  "VARCHAR(200) NULL"),
        ("quotation", "VIEWED_AT",          "DATETIME NULL"),
        ("quotation", "LAST_VIEWED_AT",     "DATETIME NULL"),
        ("quotation", "VIEW_COUNT",         "INT NOT NULL DEFAULT 0"),
        # ---- Phase 5: SO advance-due tracking ----
        ("sales_order", "ADVANCE_DUE_DATE", "DATE NULL"),
        # ---- Unified Employee Dashboard (Permission support) ----
        # LEAVE_TYPE='PERMISSION' rows track sub-day time-off in hours
        ("leave_request",   "DURATION_HOURS", "FLOAT NULL"),
        # Per-task PRIORITY surfaced on the employee dashboard cards
        ("task_assignment", "PRIORITY",       "VARCHAR(10) NULL"),
        # ---- Employee onboarding: admin-chosen password at invite time ----
        # Replaces the AI chatbot flow with admin-sets-password-at-invite +
        # candidate logs in to fill the registration form.
        ("employee_onboarding_session", "PASSWORD_HASH", "VARCHAR(255) NULL"),
        # Phase 2 — admin can pre-set role at invite time
        ("employee_onboarding_session", "DEPARTMENT_ID",  "INT NULL"),
        ("employee_onboarding_session", "DESIGNATION_ID", "INT NULL"),
        # ---- Manufacturing Phase 1: Reorder alerts ---------
        # Threshold below which the inventory row triggers a low-stock
        # notification. NULL/0 means "no alerting for this material".
        ("inventory", "MIN_STOCK", "INT NULL DEFAULT 0"),
        # ---- HR Module Phase A — Employee column expansion (2026-06-01) ----
        ("employee", "BLOOD_GROUP",                "VARCHAR(5)   NULL"),
        ("employee", "NATIONALITY",                "VARCHAR(50)  NULL"),
        ("employee", "EMERGENCY_CONTACT_NAME",     "VARCHAR(100) NULL"),
        ("employee", "EMERGENCY_CONTACT_PHONE",    "VARCHAR(20)  NULL"),
        ("employee", "EMERGENCY_CONTACT_RELATION", "VARCHAR(50)  NULL"),
        ("employee", "CONFIRMATION_DATE",          "DATE         NULL"),
        ("employee", "WORK_LOCATION",              "VARCHAR(200) NULL"),
        ("employee", "COLLEGE",                    "VARCHAR(200) NULL"),
        ("employee", "UNIVERSITY",                 "VARCHAR(200) NULL"),
        ("employee", "PERCENTAGE",                 "FLOAT        NULL"),
        ("employee", "PREVIOUS_COMPANY",           "VARCHAR(200) NULL"),
        ("employee", "PREVIOUS_SALARY",            "FLOAT        NULL"),
        ("employee", "BANK_ACCOUNT_NUMBER",        "VARCHAR(50)  NULL"),
        ("employee", "BANK_NAME",                  "VARCHAR(100) NULL"),
        ("employee", "IFSC_CODE",                  "VARCHAR(20)  NULL"),
        ("employee", "PAN_NUMBER",                 "VARCHAR(20)  NULL"),
        ("employee", "AADHAAR_NUMBER",             "VARCHAR(20)  NULL"),
        # ---- HR Module Phase C — Leave: Maternity + Carryover ----
        ("leave_balance", "MATERNITY_TOTAL",     "FLOAT NULL DEFAULT 0"),
        ("leave_balance", "MATERNITY_USED",      "FLOAT NULL DEFAULT 0"),
        ("leave_balance", "CASUAL_CARRYOVER",    "FLOAT NULL DEFAULT 0"),
        ("leave_balance", "SICK_CARRYOVER",      "FLOAT NULL DEFAULT 0"),
        ("leave_balance", "EARNED_CARRYOVER",    "FLOAT NULL DEFAULT 0"),
        ("leave_balance", "MATERNITY_CARRYOVER", "FLOAT NULL DEFAULT 0"),
        ("leave_balance", "POLICY_ID",           "INT NULL"),
        # ---- HR Module Phase D — Permission subtypes ----
        ("leave_request", "PERMISSION_SUBTYPE",  "VARCHAR(20) NULL"),
        # ---- HR Module Phase E — Payroll components + statutory ----
        ("payroll_slip", "HRA",                   "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "DA",                    "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "CONVEYANCE_ALLOWANCE",  "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "MEDICAL_ALLOWANCE",     "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "SPECIAL_ALLOWANCE",     "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "OTHER_ALLOWANCES",      "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "ANNUAL_BONUS",          "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "INCENTIVES",            "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "PF_EMPLOYEE",           "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "PF_EMPLOYER",           "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "ESI_EMPLOYEE",          "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "ESI_EMPLOYER",          "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "PROFESSIONAL_TAX",      "FLOAT NULL DEFAULT 0"),
        # Per-slip payment tracking — lets the UI mark each employee
        # Paid independently instead of finalising a whole run.
        ("payroll_slip", "STATUS",                "VARCHAR(20) NULL DEFAULT 'PENDING'"),
        ("payroll_slip", "PAID_AT",               "DATETIME NULL"),
        # Permission hours used by the employee in this pay period
        # (LeaveRequest rows where TYPE='PERMISSION', summed).
        ("payroll_slip", "PERMISSION_HOURS",      "FLOAT NULL DEFAULT 0"),
        # Star-rating bonus — feeds into NET_PAY (BONUS_PER_STAR × stars).
        ("payroll_slip", "PERFORMANCE_STARS",     "FLOAT NULL DEFAULT 0"),
        ("payroll_slip", "STAR_BONUS",            "FLOAT NULL DEFAULT 0"),
        # PerformanceScore — Leave + Permission dimensions (new scheme).
        ("performance_score", "LEAVE_DAYS_TAKEN",       "FLOAT NULL DEFAULT 0"),
        ("performance_score", "PERMISSION_HOURS_TAKEN", "FLOAT NULL DEFAULT 0"),
        ("performance_score", "LEAVE_STARS",            "FLOAT NULL DEFAULT 0"),
        ("performance_score", "PERMISSION_STARS",       "FLOAT NULL DEFAULT 0"),
        # ---- Geofenced attendance (Module: Geofence) ----
        ("attendance", "CHECKIN_LATITUDE",   "FLOAT NULL"),
        ("attendance", "CHECKIN_LONGITUDE",  "FLOAT NULL"),
        ("attendance", "CHECKIN_DISTANCE",   "FLOAT NULL"),
        ("attendance", "CHECKOUT_LATITUDE",  "FLOAT NULL"),
        ("attendance", "CHECKOUT_LONGITUDE", "FLOAT NULL"),
        ("attendance", "CHECKOUT_DISTANCE",  "FLOAT NULL"),
        ("attendance", "GEOFENCE_STATUS",    "VARCHAR(20) NULL"),
        ("attendance", "DEVICE_INFO",        "VARCHAR(255) NULL"),
        ("attendance", "BROWSER_INFO",       "VARCHAR(255) NULL"),
        ("attendance", "IP_ADDRESS",         "VARCHAR(60) NULL"),
    ]

    # Indexes / unique constraints that earlier model versions
    # created but the current schema no longer wants. Drop them so
    # the new behavior (e.g. multiple DailyAllocation rows per
    # employee per day) works without "Duplicate entry" errors.
    #
    # Each entry: (table, index_name). Idempotent — if the index
    # doesn't exist (already dropped) we swallow the error and
    # continue.
    stale_indexes = [
        ("daily_allocation", "uq_alloc_employee_date"),
    ]

    # Columns whose type changed in the model and need ALTER ... MODIFY
    # on existing tables. Idempotent — `MODIFY` is safe to re-run.
    # Each entry: (table, column, new_ddl). The DDL is whatever you'd
    # put in `ADD COLUMN`, e.g. "VARCHAR(2000) NULL".
    widened_columns = [
        ("project", "DESCRIPTION",  "VARCHAR(2000) NULL"),
        ("project", "PROJECT_NAME", "VARCHAR(200) NULL"),
    ]

    # New tables that older deployments may not have yet. create_all()
    # already handles these at boot, but we keep idempotent CREATE TABLE
    # IF NOT EXISTS statements here too so the explicit DDL stays
    # close to the rest of the auto-migration plan.
    create_tables = [
        (
            "supplier_payment",
            """
            CREATE TABLE IF NOT EXISTS `supplier_payment` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `PO_ID` INT NOT NULL,
                `AMOUNT` FLOAT NOT NULL DEFAULT 0,
                `PAYMENT_DATE` DATE NULL,
                `PAYMENT_MODE` VARCHAR(30) NULL,
                `REFERENCE_NO` VARCHAR(100) NULL,
                `STATUS` VARCHAR(20) NULL DEFAULT 'PENDING_APPROVAL',
                `NOTES` VARCHAR(500) NULL,
                `REJECTION_REASON` VARCHAR(500) NULL,
                `REQUESTED_BY_ID` VARCHAR(36) NULL,
                `APPROVED_BY_ID` VARCHAR(36) NULL,
                `APPROVED_AT` DATETIME NULL,
                `VENDOR_ID` INT NULL,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                KEY `ix_sp_po` (`PO_ID`),
                KEY `ix_sp_status` (`STATUS`),
                KEY `ix_sp_vendor` (`VENDOR_ID`)
            )
            """
        ),
        (
            "discount_request",
            """
            CREATE TABLE IF NOT EXISTS `discount_request` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `QUOTATION_ID` INT NOT NULL,
                `REQUESTED_DISCOUNT_PERCENT` FLOAT NOT NULL,
                `CUSTOMER_REASON` VARCHAR(500) NULL,
                `BOT_ACTION` VARCHAR(20) NULL,
                `STATUS` VARCHAR(20) NULL DEFAULT 'PENDING',
                `REJECTION_REASON` VARCHAR(500) NULL,
                `REQUESTED_BY_ID` VARCHAR(36) NULL,
                `APPROVED_BY_ID` VARCHAR(36) NULL,
                `APPROVED_AT` DATETIME NULL,
                `VENDOR_ID` INT NULL,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                KEY `ix_dr_quotation` (`QUOTATION_ID`),
                KEY `ix_dr_status` (`STATUS`),
                KEY `ix_dr_vendor` (`VENDOR_ID`)
            )
            """
        ),
        (
            "company_master",
            """
            CREATE TABLE IF NOT EXISTS `company_master` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `VENDOR_ID` INT NOT NULL,
                `LEGAL_NAME` VARCHAR(200) NOT NULL,
                `SHORT_NAME` VARCHAR(50) NULL,
                `TAGLINE` VARCHAR(200) NULL,
                `GST_NUMBER` VARCHAR(20) NULL,
                `PAN_NUMBER` VARCHAR(20) NULL,
                `CIN_NUMBER` VARCHAR(21) NULL,
                `ADDRESS_LINE_1` VARCHAR(255) NULL,
                `ADDRESS_LINE_2` VARCHAR(255) NULL,
                `CITY` VARCHAR(100) NULL,
                `STATE` VARCHAR(100) NULL,
                `PINCODE` VARCHAR(15) NULL,
                `COUNTRY` VARCHAR(60) NULL DEFAULT 'India',
                `EMAIL` VARCHAR(120) NULL,
                `PHONE` VARCHAR(40) NULL,
                `WEBSITE` VARCHAR(200) NULL,
                `BANK_NAME` VARCHAR(120) NULL,
                `BANK_ACCOUNT_NUMBER` VARCHAR(50) NULL,
                `BANK_IFSC` VARCHAR(20) NULL,
                `BANK_BRANCH` VARCHAR(120) NULL,
                `UPI_ID` VARCHAR(100) NULL,
                `LOGO_URL` VARCHAR(255) NULL,
                `NOTES` VARCHAR(1000) NULL,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                UNIQUE KEY `uq_company_master_vendor` (`VENDOR_ID`),
                CONSTRAINT `fk_company_master_vendor`
                    FOREIGN KEY (`VENDOR_ID`)
                    REFERENCES `vendor` (`ID`)
            )
            """
        ),
        (
            "salary_structure",
            """
            CREATE TABLE IF NOT EXISTS `salary_structure` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `EMPLOYEE_ID` VARCHAR(36) NOT NULL,
                `BASIC` FLOAT NULL DEFAULT 0,
                `HRA` FLOAT NULL DEFAULT 0,
                `DA` FLOAT NULL DEFAULT 0,
                `CONVEYANCE_ALLOWANCE` FLOAT NULL DEFAULT 0,
                `MEDICAL_ALLOWANCE` FLOAT NULL DEFAULT 0,
                `SPECIAL_ALLOWANCE` FLOAT NULL DEFAULT 0,
                `OTHER_ALLOWANCES` FLOAT NULL DEFAULT 0,
                `ANNUAL_BONUS` FLOAT NULL DEFAULT 0,
                `INCENTIVES` FLOAT NULL DEFAULT 0,
                `PT_STATE` VARCHAR(40) NULL,
                `PF_APPLICABLE` INT NULL DEFAULT 1,
                `ESI_APPLICABLE` INT NULL DEFAULT 1,
                `NOTES` VARCHAR(500) NULL,
                `EFFECTIVE_FROM` DATE NULL,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                UNIQUE KEY `uq_salary_structure_employee` (`EMPLOYEE_ID`),
                CONSTRAINT `fk_sal_struct_employee`
                    FOREIGN KEY (`EMPLOYEE_ID`)
                    REFERENCES `employee` (`ID`)
            )
            """
        ),
        (
            "leave_quota_policy",
            """
            CREATE TABLE IF NOT EXISTS `leave_quota_policy` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `POLICY_NAME` VARCHAR(100) NOT NULL,
                `SCOPE` VARCHAR(20) NOT NULL,
                `SCOPE_ID` INT NULL,
                `CASUAL_DAYS` FLOAT NULL DEFAULT 12,
                `SICK_DAYS` FLOAT NULL DEFAULT 12,
                `EARNED_DAYS` FLOAT NULL DEFAULT 15,
                `MATERNITY_DAYS` FLOAT NULL DEFAULT 180,
                `CARRYOVER_LIMIT_CASUAL` FLOAT NULL DEFAULT 0,
                `CARRYOVER_LIMIT_SICK` FLOAT NULL DEFAULT 0,
                `CARRYOVER_LIMIT_EARNED` FLOAT NULL DEFAULT 15,
                `CARRYOVER_LIMIT_MATERNITY` FLOAT NULL DEFAULT 0,
                `IS_ACTIVE` INT NULL DEFAULT 1,
                `NOTES` VARCHAR(500) NULL,
                `VENDOR_ID` INT NULL,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                KEY `ix_lqp_scope` (`SCOPE`),
                KEY `ix_lqp_scope_id` (`SCOPE_ID`)
            )
            """
        ),
        (
            "employee_document",
            """
            CREATE TABLE IF NOT EXISTS `employee_document` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `EMPLOYEE_ID` VARCHAR(36) NOT NULL,
                `DOC_TYPE` VARCHAR(30) NOT NULL,
                `TITLE` VARCHAR(200) NULL,
                `FILE_URL` VARCHAR(500) NOT NULL,
                `FILE_NAME` VARCHAR(255) NULL,
                `MIME` VARCHAR(100) NULL,
                `SIZE_BYTES` INT NULL,
                `STATUS` VARCHAR(20) NULL DEFAULT 'ACTIVE',
                `NOTES` VARCHAR(500) NULL,
                `UPLOADED_BY_ID` VARCHAR(36) NULL,
                `UPLOADED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                KEY `ix_emp_doc_employee` (`EMPLOYEE_ID`),
                KEY `ix_emp_doc_type` (`DOC_TYPE`),
                CONSTRAINT `fk_emp_doc_employee`
                    FOREIGN KEY (`EMPLOYEE_ID`)
                    REFERENCES `employee` (`ID`),
                CONSTRAINT `fk_emp_doc_uploaded_by`
                    FOREIGN KEY (`UPLOADED_BY_ID`)
                    REFERENCES `employee` (`ID`)
            )
            """
        ),
        (
            "employee_onboarding_session",
            """
            CREATE TABLE IF NOT EXISTS `employee_onboarding_session` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `TOKEN` VARCHAR(64) NOT NULL,
                `INVITED_EMAIL` VARCHAR(255) NULL,
                `INVITED_PHONE` VARCHAR(50) NULL,
                `INVITED_NAME` VARCHAR(150) NULL,
                `EMPLOYEE_CODE` VARCHAR(50) NULL,
                `STATUS` VARCHAR(30) NULL DEFAULT 'OPEN',
                `COLLECTED_DATA` TEXT NULL,
                `CHAT_HISTORY` TEXT NULL,
                `PHOTO_URL` VARCHAR(500) NULL,
                `CURRENT_FIELD` VARCHAR(80) NULL,
                `EMPLOYEE_ID` VARCHAR(36) NULL,
                `APPROVED_BY_ID` VARCHAR(36) NULL,
                `APPROVED_AT` DATETIME NULL,
                `REJECT_REASON` VARCHAR(500) NULL,
                `NOTES` VARCHAR(1000) NULL,
                `EXPIRES_AT` DATETIME NULL,
                `SUBMITTED_AT` DATETIME NULL,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                UNIQUE KEY `uq_emp_onboard_token` (`TOKEN`),
                KEY `ix_emp_onboard_token` (`TOKEN`),
                CONSTRAINT `fk_emp_onboard_employee`
                    FOREIGN KEY (`EMPLOYEE_ID`)
                    REFERENCES `employee` (`ID`),
                CONSTRAINT `fk_emp_onboard_approved_by`
                    FOREIGN KEY (`APPROVED_BY_ID`)
                    REFERENCES `employee` (`ID`)
            )
            """
        ),
        (
            "geofence_settings",
            """
            CREATE TABLE IF NOT EXISTS `geofence_settings` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `VENDOR_ID` INT NULL,
                `OFFICE_NAME` VARCHAR(150) NULL,
                `LATITUDE` FLOAT NOT NULL DEFAULT 0,
                `LONGITUDE` FLOAT NOT NULL DEFAULT 0,
                `RADIUS_METERS` INT NOT NULL DEFAULT 50,
                `IS_ACTIVE` INT NOT NULL DEFAULT 1,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                KEY `ix_geofence_vendor` (`VENDOR_ID`)
            )
            """
        ),
        (
            "employee_memos",
            """
            CREATE TABLE IF NOT EXISTS `employee_memos` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `MEMO_NUMBER` VARCHAR(30) NULL,
                `EMPLOYEE_ID` VARCHAR(36) NOT NULL,
                `MEMO_TYPE` VARCHAR(40) NOT NULL,
                `SUBJECT` VARCHAR(200) NOT NULL,
                `DESCRIPTION` VARCHAR(4000) NULL,
                `SEVERITY` VARCHAR(20) NULL DEFAULT 'LOW',
                `STATUS` VARCHAR(20) NULL DEFAULT 'ACTIVE',
                `ISSUED_BY` VARCHAR(100) NULL,
                `ISSUE_DATE` DATE NULL,
                `ATTACHMENT_URL` VARCHAR(500) NULL,
                `ATTACHMENT_NAME` VARCHAR(255) NULL,
                `ACKNOWLEDGED_BY_EMPLOYEE` INT NOT NULL DEFAULT 0,
                `ACKNOWLEDGED_DATE` DATETIME NULL,
                `REMARKS` VARCHAR(2000) NULL,
                `CREATED_BY_ID` VARCHAR(36) NULL,
                `UPDATED_BY_ID` VARCHAR(36) NULL,
                `CREATED_AT` DATETIME NULL,
                `UPDATED_AT` DATETIME NULL,
                `DELETED_AT` DATETIME NULL,
                `VENDOR_ID` INT NULL,
                PRIMARY KEY (`ID`),
                UNIQUE KEY `uq_memo_number` (`MEMO_NUMBER`),
                KEY `ix_memo_employee` (`EMPLOYEE_ID`),
                KEY `ix_memo_type` (`MEMO_TYPE`),
                KEY `ix_memo_severity` (`SEVERITY`),
                KEY `ix_memo_status` (`STATUS`),
                KEY `ix_memo_issue` (`ISSUE_DATE`),
                KEY `ix_memo_deleted` (`DELETED_AT`),
                CONSTRAINT `fk_memo_employee`
                    FOREIGN KEY (`EMPLOYEE_ID`)
                    REFERENCES `employee` (`ID`)
            )
            """
        ),
        (
            "attendance_security_logs",
            """
            CREATE TABLE IF NOT EXISTS `attendance_security_logs` (
                `ID` INT NOT NULL AUTO_INCREMENT,
                `EMPLOYEE_ID` VARCHAR(36) NULL,
                `LATITUDE` FLOAT NULL,
                `LONGITUDE` FLOAT NULL,
                `DISTANCE` FLOAT NULL,
                `REASON` VARCHAR(80) NULL,
                `DETAIL` VARCHAR(500) NULL,
                `DEVICE_INFO` VARCHAR(255) NULL,
                `IP_ADDRESS` VARCHAR(60) NULL,
                `VENDOR_ID` INT NULL,
                `CREATED_AT` DATETIME NULL,
                PRIMARY KEY (`ID`),
                KEY `ix_sec_log_emp` (`EMPLOYEE_ID`),
                KEY `ix_sec_log_reason` (`REASON`),
                KEY `ix_sec_log_created` (`CREATED_AT`)
            )
            """
        ),
    ]

    try:

        insp = inspect(engine)

        with engine.begin() as conn:

            # ---- 0. Create new tables that older DBs are missing ----
            for table_name, ddl in create_tables:

                try:

                    conn.execute(text(ddl))

                    log.info(
                        "auto-migrate: ensured table %s exists",
                        table_name
                    )

                except Exception as exc_inner:

                    log.warning(
                        "auto-migrate: could not create %s: %s",
                        table_name, exc_inner
                    )

            # Refresh inspector so subsequent steps see the new tables
            insp = inspect(engine)

            # ---- 1. Add missing columns ----
            for table, column, ddl in pending:

                if not insp.has_table(table):

                    continue

                existing_cols = {
                    c["name"].lower()
                    for c in insp.get_columns(table)
                }

                if column.lower() in existing_cols:

                    continue

                conn.execute(text(
                    f"ALTER TABLE `{table}` "
                    f"ADD COLUMN `{column}` {ddl}"
                ))

                log.info(
                    "auto-migrate: added %s.%s", table, column
                )

            # ---- 2. Drop stale indexes / unique constraints ----
            for table, index_name in stale_indexes:

                if not insp.has_table(table):

                    continue

                existing_indexes = {
                    idx["name"]
                    for idx in insp.get_indexes(table)
                    if idx.get("name")
                }

                if index_name not in existing_indexes:

                    continue

                try:

                    conn.execute(text(
                        f"ALTER TABLE `{table}` "
                        f"DROP INDEX `{index_name}`"
                    ))

                    log.info(
                        "auto-migrate: dropped stale index %s.%s",
                        table, index_name
                    )

                except Exception as exc_inner:

                    log.warning(
                        "auto-migrate: could not drop %s.%s: %s",
                        table, index_name, exc_inner
                    )

            # ---- 3. Widen existing columns whose type grew in the model ----
            for table, column, ddl in widened_columns:

                if not insp.has_table(table):

                    continue

                existing_cols = {
                    c["name"].lower()
                    for c in insp.get_columns(table)
                }

                if column.lower() not in existing_cols:

                    continue

                try:

                    conn.execute(text(
                        f"ALTER TABLE `{table}` "
                        f"MODIFY COLUMN `{column}` {ddl}"
                    ))

                    log.info(
                        "auto-migrate: widened %s.%s → %s",
                        table, column, ddl
                    )

                except Exception as exc_inner:

                    log.warning(
                        "auto-migrate: could not widen %s.%s: %s",
                        table, column, exc_inner
                    )

            # ---- 4. Backfill NULL VENDOR_ID on customers (Phase 1) ----
            # New tenant-scope column — existing rows need a default.
            if insp.has_table("customer"):

                cust_cols = {
                    c["name"].lower()
                    for c in insp.get_columns("customer")
                }

                if "vendor_id" in cust_cols:

                    try:

                        conn.execute(text(
                            "UPDATE `customer` SET `VENDOR_ID` = 1 "
                            "WHERE `VENDOR_ID` IS NULL"
                        ))

                    except Exception as exc_bf:

                        log.warning(
                            "auto-migrate: customer VENDOR_ID "
                            "backfill skipped: %s", exc_bf
                        )

            # ---- 5. Convert empty-string EMAIL / PHONE / FINGERPRINT_ID
            #         on employees to NULL.
            # MySQL's UNIQUE constraint allows multiple NULLs but treats
            # multiple "" as a duplicate. Blank values had been getting
            # stored as "" by older versions of the create form, which
            # caused IntegrityError on the second blank entry.
            if insp.has_table("employee"):

                for col in ("EMAIL", "PHONE", "FINGERPRINT_ID"):

                    try:

                        conn.execute(text(
                            f"UPDATE `employee` SET `{col}` = NULL "
                            f"WHERE `{col}` = ''"
                        ))

                    except Exception as exc_bf:

                        log.warning(
                            "auto-migrate: employee.%s blank-to-null "
                            "backfill skipped: %s", col, exc_bf
                        )

    except Exception as exc:

        log.warning("auto-migrate skipped: %s", exc)


_auto_migrate()


def _auto_seed_holidays():
    """If no holidays exist for the current year, seed the bundled
    Indian national list (NATIONAL + Tamil New Year). Idempotent —
    runs once on first boot per year per vendor."""

    from sqlalchemy.orm import sessionmaker
    from datetime import date
    from app.models.models import HolidayCalendar
    from app.routes.holiday import INDIA_NATIONAL_HOLIDAYS

    Session = sessionmaker(bind=engine)

    db = Session()

    try:

        current_year = date.today().year

        # Seed the current year + next year so payroll for early-Jan
        # ever runs without manual setup.
        for year in (current_year, current_year + 1):

            existing = (
                db.query(HolidayCalendar)
                  .filter(
                      HolidayCalendar.VENDOR_ID == 1,
                      HolidayCalendar.HOLIDAY_DATE >= date(year, 1, 1),
                      HolidayCalendar.HOLIDAY_DATE <= date(year, 12, 31),
                  )
                  .count()
            )

            if existing > 0:
                continue

            catalog = INDIA_NATIONAL_HOLIDAYS.get(year)

            if not catalog:
                continue

            for iso, name, htype in catalog:

                db.add(HolidayCalendar(
                    HOLIDAY_DATE=date.fromisoformat(iso),
                    NAME=name,
                    TYPE=htype,
                    IS_OPTIONAL=0,
                    VENDOR_ID=1,
                ))

        db.commit()

    except Exception as exc:

        db.rollback()

        import logging

        logging.getLogger("uvicorn").warning(
            "auto-seed-holidays skipped: %s", exc
        )

    finally:

        db.close()


_auto_seed_holidays()


# Canonical department + designation lists for a manufacturing company.
# Inserted ADDITIVELY — existing custom entries are kept, missing ones
# are added. Order doesn't matter; we de-dupe by (VENDOR_ID, NAME).
_MFG_DEPARTMENTS = [
    ("Software Development",          "SW"),
    ("Accounts & Finance",            "FIN"),
    ("Sales",                         "SAL"),
    ("Purchase / Procurement",        "PUR"),
    ("Design & Engineering",          "DSN"),
    ("Electrical",                    "ELE"),
    ("Welding",                       "WLD"),
    ("Fitting",                       "FIT"),
    ("Assembly",                      "ASM"),
    ("Production",                    "PRD"),
    ("Quality Control",               "QC"),
    ("Quality Assurance",             "QA"),
    ("Maintenance",                   "MNT"),
    ("Manufacturing",                 "MFG"),
    ("Operations",                    "OPS"),
    ("Stores / Inventory",            "INV"),
    ("Logistics",                     "LOG"),
    ("Supply Chain Management",       "SCM"),
    ("Research & Development",        "RND"),
    ("Human Resources",               "HR"),
    ("Administration",                "ADM"),
    ("Safety (EHS)",                  "EHS"),
    ("Planning",                      "PLN"),
    ("Project Management",            "PM"),
    ("Tool Room",                     "TR"),
    ("Machine Shop",                  "MS"),
    ("Fabrication",                   "FAB"),
    ("Inspection",                    "INSP"),
    ("Packaging",                     "PKG"),
    ("Dispatch",                      "DSP"),
    ("Customer Support / Service",    "CS"),
    ("Information Technology",        "IT"),
]

_MFG_DESIGNATIONS = [
    "Trainee", "Apprentice", "Operator", "Technician", "Fitter",
    "Welder", "Electrician", "Supervisor", "Senior Supervisor",
    "Engineer", "Senior Engineer", "Design Engineer", "Production Engineer",
    "Quality Engineer", "Maintenance Engineer", "Team Leader",
    "Shift In-Charge", "Assistant Manager", "Deputy Manager", "Manager",
    "Senior Manager", "General Manager", "Department Head", "Executive",
    "Senior Executive", "Accountant", "Purchase Executive",
    "Sales Executive", "HR Executive", "HR Manager", "IT Administrator",
    "Project Engineer", "Project Manager", "Plant Head", "Factory Manager",
    "Director",
]


def _auto_seed_org_catalog():
    """Top up Department + Designation tables with the canonical
    manufacturing-industry list. Existing entries are NEVER modified;
    only missing names get inserted. Safe to re-run on every boot."""

    from sqlalchemy.orm import sessionmaker
    from app.models.models import Department, Designation

    Session = sessionmaker(bind=engine)
    db = Session()

    try:

        # ---- Departments ------------------------------------------
        existing_dept_names = {
            (d.NAME or "").strip().lower()
            for d in db.query(Department).filter(Department.VENDOR_ID == 1).all()
        }

        dept_added = 0
        for name, code in _MFG_DEPARTMENTS:
            if name.strip().lower() in existing_dept_names:
                continue
            db.add(Department(NAME=name, CODE=code, VENDOR_ID=1))
            dept_added += 1

        if dept_added:
            db.commit()

        # ---- Designations -----------------------------------------
        # Designation is keyed by TITLE alone (no vendor scope on the
        # model — it's company-agnostic). Use a case-insensitive set.
        existing_des_titles = {
            (d.TITLE or "").strip().lower()
            for d in db.query(Designation).all()
        }

        des_added = 0
        for title in _MFG_DESIGNATIONS:
            if title.strip().lower() in existing_des_titles:
                continue
            db.add(Designation(TITLE=title))
            des_added += 1

        if des_added:
            db.commit()

        if dept_added or des_added:

            import logging
            logging.getLogger("uvicorn").info(
                "auto-seed-org-catalog: +%d departments, +%d designations",
                dept_added, des_added,
            )

    except Exception as exc:

        db.rollback()

        import logging
        logging.getLogger("uvicorn").warning(
            "auto-seed-org-catalog skipped: %s", exc
        )

    finally:

        db.close()


_auto_seed_org_catalog()


# Canonical Work Center catalog for a manufacturing shop. Inserted
# additively — existing custom work centers are kept. Vendor-scoped.
_MFG_WORK_CENTERS = [
    ("Laser Cutting",   "LC",    "FABRICATION", 5.0),
    ("Welding",         "WLD",   "WELDING",     3.0),
    ("Fitting",         "FIT",   "ASSEMBLY",    4.0),
    ("Painting",        "PAINT", "PAINTING",    2.0),
    ("Assembly",        "ASM",   "ASSEMBLY",    2.0),
    ("Testing",         "TEST",  "TESTING",     6.0),
    ("Quality Control", "QC",    "QC",          8.0),
    ("Packaging",       "PKG",   "PACKAGING",   10.0),
    ("Dispatch",        "DSP",   "OTHER",       12.0),
]


def _auto_seed_work_centers():
    """Top up the work_center table with the canonical manufacturing
    list. Existing entries are NEVER modified; only missing names
    get inserted. Safe to re-run on every boot."""

    from sqlalchemy.orm import sessionmaker
    from app.models.models import WorkCenter

    Session = sessionmaker(bind=engine)
    db = Session()

    try:

        existing_names = {
            (w.NAME or "").strip().lower()
            for w in db.query(WorkCenter).filter(WorkCenter.VENDOR_ID == 1).all()
        }

        added = 0
        for name, code, category, capacity in _MFG_WORK_CENTERS:
            if name.strip().lower() in existing_names:
                continue
            db.add(WorkCenter(
                NAME=name,
                CODE=code,
                CATEGORY=category,
                CAPACITY_PER_HOUR=capacity,
                IS_ACTIVE=1,
                VENDOR_ID=1,
            ))
            added += 1

        if added:
            db.commit()
            import logging
            logging.getLogger("uvicorn").info(
                "auto-seed-work-centers: +%d work centers", added
            )

    except Exception as exc:

        db.rollback()

        import logging
        logging.getLogger("uvicorn").warning(
            "auto-seed-work-centers skipped: %s", exc
        )

    finally:

        db.close()


_auto_seed_work_centers()


def _auto_seed_org():
    """If Department / Role / Designation are empty for vendor 1,
    seed the MANUFACTURING preset. Idempotent — only runs when the
    tables are actually empty so existing tenant data is never
    overwritten."""

    from sqlalchemy.orm import sessionmaker

    from app.models.models import Department, Role, Designation

    from app.routes.organization import do_seed_org

    SessionLocal = sessionmaker(bind=engine)

    db = SessionLocal()

    try:

        has_dept = db.query(Department).filter(
            Department.VENDOR_ID == 1
        ).first()

        has_role = db.query(Role).filter(
            Role.VENDOR_ID == 1
        ).first()

        has_desg = db.query(Designation).filter(
            Designation.VENDOR_ID == 1
        ).first()

        if has_dept and has_role and has_desg:

            return  # everything's there — nothing to do

        result = do_seed_org(db, "MANUFACTURING", 1)

        log.info(
            "auto-seed-org: added %s depts, %s designations, "
            "%s roles, %s permissions",
            result["departments_added"],
            result["designations_added"],
            result["roles_added"],
            result["permissions_added"]
        )

    except Exception as exc:

        log.warning("auto-seed-org skipped: %s", exc)

    finally:

        db.close()


_auto_seed_org()


def _auto_seed_quotation_settings():
    """Idempotently seed the quotation policy flags (auto-SO toggle
    + max-discount ceiling) so the new approve-time auto-SO hook has
    a defined value on first boot."""

    import logging

    from sqlalchemy.orm import sessionmaker

    from app.routes.quotation import seed_quotation_settings

    log = logging.getLogger("uvicorn")

    SessionLocal = sessionmaker(bind=engine)

    db = SessionLocal()

    try:

        seed_quotation_settings(db)

    except Exception as exc:

        log.warning("auto-seed-quotation-settings skipped: %s", exc)

    finally:

        db.close()


_auto_seed_quotation_settings()


def _auto_seed_sales_order_settings():
    """Idempotently seed the Sales Order automation flags
    (auto_start_production + auto_create_pos) so the new
    record_payment auto-trigger has defined defaults on first boot."""

    import logging

    from sqlalchemy.orm import sessionmaker

    from app.routes.sales_order import seed_sales_order_settings

    log = logging.getLogger("uvicorn")

    SessionLocal = sessionmaker(bind=engine)

    db = SessionLocal()

    try:

        seed_sales_order_settings(db)

    except Exception as exc:

        log.warning("auto-seed-sales-order-settings skipped: %s", exc)

    finally:

        db.close()


_auto_seed_sales_order_settings()


app.include_router(auth_router, tags=["Auth"])
app.include_router(organization_router, tags=["Organization"])
app.include_router(employee.router, tags=["Employees (IAM)"])
app.include_router(employee_task_router, tags=["Employee Workflow"])
app.include_router(task_approval_router, tags=["Task Approval"])
app.include_router(task_router, tags=["Project Tasks"])
app.include_router(project_router, tags=["Projects"])
app.include_router(project_template_router, tags=["Project Templates"])
app.include_router(users_router, tags=["Users"])
app.include_router(vendor_router, tags=["Vendors"])
app.include_router(inventory_router, tags=["Inventory"])
app.include_router(machine_router, tags=["Machines"])
app.include_router(attendance_router, tags=["Attendance"])
app.include_router(notification_router, tags=["Notifications"])
app.include_router(analytics_router, tags=["Analytics"])
app.include_router(reports_router, tags=["Reports"])
app.include_router(settings_router, tags=["Settings"])
app.include_router(chatbot_router, tags=["Chatbot"])
app.include_router(biometric_router)
app.include_router(bvc24_seed_router)
app.include_router(performance_router)
app.include_router(production_router)
app.include_router(quality_router)
app.include_router(supplier_router)
app.include_router(process_router)
app.include_router(leave_router)
app.include_router(connect_router)
app.include_router(payroll_router)
app.include_router(quotation_router, tags=["Quotations"])
app.include_router(purchase_order_router, tags=["Purchase Orders"])
app.include_router(procurement_seed_router, tags=["Procurement Seed"])
app.include_router(hr_assistant_router, tags=["HR Assistant"])
app.include_router(sales_order_router, tags=["Sales Orders"])
app.include_router(whatsapp_router, tags=["WhatsApp Alerts"])
app.include_router(onboarding_router, tags=["Customer Onboarding Portal"])
app.include_router(employee_onboarding_router, tags=["Employee Onboarding Portal"])
app.include_router(employee_documents_router, tags=["Employee Documents"])
app.include_router(admin_dashboard_router)
app.include_router(approvals_router)
# app.include_router(ai_command_router)  # removed Phase 2
app.include_router(dashboard_aggregators_router)
app.include_router(ai_router)
app.include_router(public_enquiry_router)
app.include_router(geofence_router)
app.include_router(employee_memos_router)
app.include_router(leave_chatbot_router)
app.include_router(employee_portal_router, tags=["Employee Portal"])
app.include_router(audit_router)
app.include_router(rbac_router)
app.include_router(holiday_router)
app.include_router(chatbot_ai_router)
app.include_router(work_center_router)
app.include_router(allowance_router, tags=["Allowances"])
app.include_router(leave_agent_router)
app.include_router(hr_chat_router)
app.include_router(recruitment_router)
app.include_router(my_payslips_router)


@app.get("/", tags=["Health"])
def home():

    return {
        "message": "erp Server is running"
    }


@app.get("/debug/env", tags=["Health"])
def debug_env():
    """
    Returns what os.getenv() actually sees for the critical
    environment variables. Passwords are masked. Use this to
    confirm your .env file is being loaded correctly.
    """

    def mask(val):
        if not val:
            return "(empty)"
        if len(val) <= 6:
            return "***"
        return val[:3] + "***" + val[-3:]

    return {
        "env_path": str(_ENV_PATH),
        "env_exists": _ENV_PATH.exists(),
        "SMTP_HOST": os.getenv("SMTP_HOST", "(empty)"),
        "SMTP_PORT": os.getenv("SMTP_PORT", "(empty)"),
        "SMTP_USER": os.getenv("SMTP_USER", "(empty)"),
        "SMTP_PASSWORD": mask(os.getenv("SMTP_PASSWORD")),
        "RESEND_API_KEY": mask(os.getenv("RESEND_API_KEY")),
        "SMTP_FROM": os.getenv("SMTP_FROM", "(empty)"),
        "SMTP_USE_TLS": os.getenv("SMTP_USE_TLS", "(empty)"),
        "APPROVER_NAME": os.getenv("APPROVER_NAME", "(empty)"),
        "APPROVER_EMAIL": os.getenv("APPROVER_EMAIL", "(empty)"),
        "APPROVER_PHONE": os.getenv("APPROVER_PHONE", "(empty)"),
        "ADMIN_EMAIL": os.getenv("ADMIN_EMAIL", "(empty)"),
        "FRONTEND_URL": os.getenv("FRONTEND_URL", "(empty)"),
        "BACKEND_URL": os.getenv("BACKEND_URL", "(empty)"),
        "SMS_PROVIDER": os.getenv("SMS_PROVIDER", "(empty)")
    }
