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
# Register new module models into Base.metadata BEFORE create_all()
import app.models.project_models     # noqa: F401 — registers project_category, project, project_pricing, task_template tables
import app.models.inventory_models   # noqa: F401 — registers inventory tables
import app.models.supplier_models    # noqa: F401 — registers supplier/procurement tables
import app.models.email_models       # noqa: F401 — registers vendor_email_config table
import app.models.lead_models        # noqa: F401 — registers lead_polling_config, lead, lead_polling_log tables
import app.models.project_quotation_models  # noqa: F401 — registers project_quotation_template table
import app.models.rag_models         # noqa: F401 — registers ai_modules, ai_documents, ai_chat_history, ai_training_job tables
import app.models.whatsapp_models    # noqa: F401 — registers vendor_whatsapp_config, whatsapp_conversation, whatsapp_message, whatsapp_webhook_event tables
import app.models.rbac_models        # noqa: F401 — registers iam_user, employee_permission_override, employee_permission_override_audit tables (root_user already registered via models.py)
import app.models.auth_models        # noqa: F401 — registers refresh_token, login_lockout tables
import app.models.employee_models    # noqa: F401 — registers employee, department, designation, employee_onboarding_session, employee_document, employee_memos, employee_allowance, employee_status_history tables
import app.models.leave_models       # noqa: F401 — registers leave_request, leave_balance, leave_quota_policy, ai_leave_conversation, leave_balance_adjustment tables
from app.services.permission_catalogue import ensure_permission_catalogue
from app.routes.users import router as users_router
from app.routes.auth import router as auth_router
from app.routes.vendor import router as vendor_router
from app.routes.project import router as project_router
from app.routes.task import router as task_router
from app.routes.inventory import router as inventory_router
from app.routes.analytics import router as analytics_router
from app.routes.attendance import router as attendance_router
from app.routes.notification import router as notification_router
from app.routes.announcement import router as announcement_router
from app.routes.org_chart import router as org_chart_router
from app.routes.reports import router as reports_router
from app.routes.settings import router as settings_router
from app.routes.employee_task import router as employee_task_router
from app.routes.project_template import router as project_template_router
from app.routes.project_quotation import router as project_quotation_router
from app.routes.organization import router as organization_router
from app.routes.task_approval import router as task_approval_router
from app.routes.biometric import router as biometric_router
from app.routes.iclock import router as iclock_router  # ADMS Push (ZKTeco/ESSL X2008)
from app.routes.bvc24_seed import router as bvc24_seed_router
from app.routes.performance import router as performance_router
from app.routes.supplier import router as supplier_router
from app.routes.leave import router as leave_router
from app.routes.connect import router as connect_router
from app.routes.payroll import router as payroll_router
from app.routes.purchase_order import router as purchase_order_router
from app.routes.procurement_seed import router as procurement_seed_router
from app.routes.whatsapp import router as whatsapp_router
from app.routes.employee_onboarding import router as employee_onboarding_router
from app.routes.employee_documents import router as employee_documents_router
from app.routes.admin_dashboard import router as admin_dashboard_router
from app.routes.approvals import router as approvals_router
from app.routes.dashboard_aggregators import router as dashboard_aggregators_router
from app.routes.public_enquiry import router as public_enquiry_router
from app.routes.geofence import router as geofence_router
from app.routes.employee_memos import router as employee_memos_router
from app.routes.employee_portal import router as employee_portal_router
from app.routes.audit import router as audit_router  # Phase 3 security
from app.routes.rbac import router as rbac_router    # Phase 2 RBAC
from app.routes.holiday import router as holiday_router    # Phase 2 Holiday Calendar
from app.routes.allowance import router as allowance_router  # Employee expense claims
from app.routes.recruitment import router as recruitment_router  # Phase 2 — AI Recruitment Assistant
from app.routes.employee_payslips import router as my_payslips_router  # Employee self-service payslips
from app.routes.onboarding_checklist import router as onboarding_checklist_router  # Post-joining onboarding
from app.routes.attendance_ai import router as attendance_ai_router  # Attendance Automation (Phase 1)
from app.routes.leave_decisions import router as leave_decisions_router  # Leave Automation (Phase 1)
from app.routes.monthly_reports import router as monthly_reports_router  # Auto monthly attendance + payroll reports
from app.routes.employee_status import router as employee_status_router  # Employee lifecycle status tracking
from app.routes.employee_insights import router as employee_insights_router  # AI workforce analytics
from app.routes.custom_fields import router as custom_fields_router  # Custom Fields System
from app.routes.helpdesk import router as helpdesk_router  # Help Desk (employee tickets + admin triage)
from app.routes.memo_automation import router as memo_automation_router  # Weekly warning/appreciation memo automation
from app.routes.rag import router as rag_router  # Common Enterprise RAG AI Platform
from app.routes.speech import router as speech_router  # Offline Piper TTS
# ── New Inventory & Supplier Procurement Module ──────────────────────
from app.routes.supplier_onboarding import router as supplier_onboarding_router
from app.routes.supplier_products import router as supplier_products_router
from app.routes.supplier_ranking import router as supplier_ranking_router
from app.routes.inventory_items import router as inventory_items_router
from app.routes.inventory_movements import router as inventory_movements_router
from app.routes.inventory_batches import router as inventory_batches_router
from app.routes.email_config import router as email_config_router
from app.routes.email_templates import router as email_templates_router
from app.routes.lead_management import router as lead_management_router
from app.routes.quotation_actions import router as quotation_actions_router
from app.routes.po_actions import router as po_actions_router
from app.routes.email_send_rule import router as email_send_rule_router
from app.routes.customer_master import router as customer_master_router
from app.routes.customer_payment import router as customer_payment_router
from app.routes.payment_milestone import router as payment_milestone_router
from app.routes.production_schedule import router as production_schedule_router
from app.routes.purchase_order_approval import router as purchase_order_approval_router
from app.routes.whatsapp_config import router as whatsapp_config_router
from app.routes.whatsapp_module_settings import router as whatsapp_module_settings_router
from app.routes.whatsapp_webhook import router as whatsapp_webhook_router
from app.routes.whatsapp_inbox import router as whatsapp_inbox_router

# ── HRMS AI Assistant (Gemini + RAG over docs/HRMS_KNOWLEDGE.md) ──
from app.hrms_ai.routes import router as hrms_ai_router

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
    # Capacitor / Ionic native shells. The Android/iOS WebView sends
    # the page's origin as one of these depending on capacitor.config
    # (androidScheme / iosScheme). All four cover current + legacy
    # configs so the APK doesn't hit CORS again if the scheme changes.
    "http://localhost",             # androidScheme: 'http'
    "https://localhost",            # androidScheme: 'https' (Capacitor default)
    "capacitor://localhost",        # iOS default scheme
    "ionic://localhost",            # older Ionic default
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


(_STATIC_DIR / "quotation").mkdir(parents=True, exist_ok=True)

(_STATIC_DIR / "ai-documents").mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


def _rename_legacy_project_table():
    """Archive legacy tables that have been superseded by new ORM models.

    - old 'project'           (customer-facing projects, INTEGER PK)  → 'project_legacy'
    - old 'sub_project_template' (old template model, INTEGER PK)     → 'sub_project_template_legacy'

    Both renames are idempotent: they are skipped when the source table is
    absent or when the target already exists.  Errors are caught per-table
    so one failure never blocks the other rename or startup.
    """
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    existing = set(insp.get_table_names())

    # ── 1. Rename old customer-project table ──────────────────────────────────
    if "project" in existing and "project_legacy" not in existing:
        try:
            cols = {c["name"] for c in insp.get_columns("project")}
            if "PROJECT_NAME" in cols:          # old customer-project signature
                with engine.connect() as conn:
                    conn.execute(text("RENAME TABLE `project` TO `project_legacy`"))
                    conn.commit()
                print("[startup] Renamed legacy 'project' → 'project_legacy'")
        except Exception as exc:
            print(f"[startup] project rename skipped: {exc}")

    # ── 2. Archive old sub_project_template table ─────────────────────────────
    if "sub_project_template" in existing and "sub_project_template_legacy" not in existing:
        try:
            with engine.connect() as conn:
                conn.execute(
                    text("RENAME TABLE `sub_project_template` TO `sub_project_template_legacy`")
                )
                conn.commit()
            print("[startup] Renamed legacy 'sub_project_template' → 'sub_project_template_legacy'")
        except Exception as exc:
            print(f"[startup] sub_project_template rename skipped: {exc}")


_rename_legacy_project_table()

def _drop_legacy_lead_tables():
    """One-time cleanup: the Lead Management module was renamed/restructured
    (IndiamartConfig/IndiamartLead -> LeadPollingConfig/Lead/LeadPollingLog,
    with a changed schema — CONFIG_ID removed from the lead table, columns
    renamed, unique constraints changed). The old tables held no production
    data (pre-launch scaffolding only), so they're dropped here rather than
    migrated in place; create_all() below then creates the new tables fresh.
    Guarded and idempotent — a no-op once the old tables are gone.
    """
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    try:
        with engine.begin() as conn:
            if "indiamart_lead" in existing:
                conn.execute(text("DROP TABLE IF EXISTS `indiamart_lead`"))
                print("[startup] Dropped legacy 'indiamart_lead' table")
            if "indiamart_config" in existing:
                conn.execute(text("DROP TABLE IF EXISTS `indiamart_config`"))
                print("[startup] Dropped legacy 'indiamart_config' table")
    except Exception as exc:
        print(f"[startup] legacy lead table cleanup skipped: {exc}")


_drop_legacy_lead_tables()

# Register the HRMS AI conversation model with the metadata BEFORE
# create_all runs — the model lives outside models.py so it needs to
# be imported for Base to know about it.
from app.hrms_ai.session_store import HrmsAiConversation  # noqa: F401,E402

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
        # ---- HRMS Phase 4 — AI Leave Agent + Task Gate ----
        # Snapshot of AI recommendation captured at submit time
        # (verdict + rationale). MD sees this alongside Approve/Reject.
        ("leave_request", "AI_RECOMMENDATION",   "TEXT NULL"),
        # JSON array of task commitments the employee promised at
        # apply time (task_id, promised_by, note).
        ("leave_request", "TASK_COMMITMENTS",    "TEXT NULL"),
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
        ("payroll_slip", "SUBMITTED_AT",          "DATETIME NULL"),
        ("payroll_slip", "PAID_AT",               "DATETIME NULL"),
        # HR-picked pay date shown on payslip preview + PDF.
        ("payroll_slip", "PAY_DATE",              "DATE NULL"),
        ("payroll_slip", "ABSENCE_DEDUCTION",     "FLOAT NULL DEFAULT 0"),
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
        # Explicit OT session timestamps (overtime is now tracked as a
        # separate check-in/check-out, never auto-derived from regular hours)
        ("attendance", "OT_CHECK_IN",        "DATETIME NULL"),
        ("attendance", "OT_CHECK_OUT",       "DATETIME NULL"),
        # ---- Project Management Module (2026-06) ----
        ("department", "UPDATED_AT",         "DATETIME NULL"),
        ("department", "HEAD_EMPLOYEE_ID",   "VARCHAR(36) NULL"),
        ("role",       "DEPARTMENT_ID",      "INT NULL"),
        ("role",       "CREATED_AT",         "DATETIME NULL"),
        ("role",       "UPDATED_AT",         "DATETIME NULL"),
        ("role",       "IS_SYSTEM",          "INT NULL DEFAULT 0"),
        # ---- Help Desk (2026-07): new columns added when the module
        # was rebuilt after the ram-development merge deleted it.
        ("helpdesk_ticket", "INTERNAL_NOTES", "TEXT NULL"),
        ("helpdesk_ticket", "CLOSED_AT",      "DATETIME NULL"),
        # ---- Memo automation (2026-07): system-generated warning /
        # appreciation memos + per-employee notification targeting.
        ("employee_memos", "IS_AUTOMATED",   "INT NULL DEFAULT 0"),
        ("employee_memos", "AUTOMATION_KEY", "VARCHAR(80) NULL"),
        ("notification",   "EMPLOYEE_ID",    "VARCHAR(36) NULL"),
        ("notification",   "REF_TYPE",       "VARCHAR(30) NULL"),
        ("notification",   "REF_ID",         "INT NULL"),
        # ---- RBAC Phase 1: Vendor/Account extension ----
        ("vendor", "ACCOUNT_ID",              "VARCHAR(12) NULL"),
        ("vendor", "PRIMARY_CONTACT_NAME",    "VARCHAR(100) NULL"),
        ("vendor", "PRIMARY_CONTACT_EMAIL",   "VARCHAR(150) NULL"),
        ("vendor", "PRIMARY_CONTACT_PHONE",   "VARCHAR(20) NULL"),
        ("vendor", "ACCOUNT_STATUS",          "VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'"),
        ("vendor", "ROOT_MFA_ENFORCED",       "INT NOT NULL DEFAULT 0"),
        ("vendor", "IAM_PASSWORD_MIN_LENGTH", "INT NOT NULL DEFAULT 8"),
        ("vendor", "CREATED_AT",              "DATETIME NULL"),
        ("vendor", "UPDATED_AT",              "DATETIME NULL"),
        # ---- RBAC Phase 1: Root User extension ----
        ("root_user", "LAST_LOGIN_AT",              "DATETIME NULL"),
        ("root_user", "PASSWORD_RESET_TOKEN",       "VARCHAR(100) NULL"),
        ("root_user", "PASSWORD_RESET_EXPIRES_AT",  "DATETIME NULL"),
        ("root_user", "MFA_ENABLED",                "INT NULL DEFAULT 0"),
        ("root_user", "TOKEN_VERSION",              "INT NOT NULL DEFAULT 1"),
        ("root_user", "CREATED_AT",                 "DATETIME NULL"),
        ("root_user", "UPDATED_AT",                 "DATETIME NULL"),
        # ---- RBAC Phase 3 (API auth/security): TOKEN_VERSION on Employee ----
        ("employee", "TOKEN_VERSION",                "INT NOT NULL DEFAULT 1"),
    ]

    # New unique indexes on tables that already exist in production.
    # Each entry: (table, index_name, column). Idempotent — skipped if
    # the index is already present. Unlike the tables in `pending`
    # above, a UNIQUE constraint can't be expressed via ADD COLUMN, so
    # it needs its own ALTER TABLE step (see step 6 below).
    new_unique_indexes = [
        ("vendor",    "uq_vendor_account_id",   "ACCOUNT_ID"),
        ("root_user", "uq_root_user_vendor_id", "VENDOR_ID"),
    ]

    # Columns to rename. Old names from legacy schema that the model has
    # since replaced. Each entry: (table, old_col, new_col, new_ddl).
    # Idempotent: if old_col is absent (already renamed) we skip.
    rename_columns = [
        ("department", "CODE",      "DEPARTMENT_CODE", "VARCHAR(20) NULL"),
        ("role",       "ROLE_NAME", "NAME",            "VARCHAR(100) NOT NULL DEFAULT ''"),
        # WhatsApp models generalized to a polymorphic (MODULE_CODE, SOURCE_RECORD_ID)
        # reference instead of a hardcoded FK to `lead` — see whatsapp_models.py.
        ("whatsapp_conversation", "LEAD_ID", "SOURCE_RECORD_ID", "VARCHAR(36) NULL"),
        ("whatsapp_message",      "LEAD_ID", "SOURCE_RECORD_ID", "VARCHAR(36) NULL"),
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
        # Extend FIELD_TYPE enum to include PHONE (idempotent MODIFY)
        (
            "custom_fields", "FIELD_TYPE",
            "ENUM('TEXT','NUMBER','DATE','DATETIME','CHECKBOX','RADIO','SELECT','TEXTAREA','EMAIL','PHONE') NOT NULL",
        ),
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

            # ---- 1b. Rename legacy columns ----
            for table, old_col, new_col, ddl in rename_columns:

                if not insp.has_table(table):

                    continue

                existing_cols = {
                    c["name"].lower()
                    for c in insp.get_columns(table)
                }

                if new_col.lower() in existing_cols:

                    continue  # already renamed

                if old_col.lower() not in existing_cols:

                    continue  # neither name present — nothing to rename

                try:

                    conn.execute(text(
                        f"ALTER TABLE `{table}` "
                        f"CHANGE `{old_col}` `{new_col}` {ddl}"
                    ))

                    log.info(
                        "auto-migrate: renamed %s.%s -> %s.%s",
                        table, old_col, table, new_col
                    )

                except Exception as exc_inner:

                    log.warning(
                        "auto-migrate: could not rename %s.%s -> %s: %s",
                        table, old_col, new_col, exc_inner
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

            # ---- 3b. Rename legacy columns whose Python attribute changed ----
            for table, old_col, new_col, new_ddl in rename_columns:

                if not insp.has_table(table):

                    continue

                existing_cols = {
                    c["name"].lower()
                    for c in insp.get_columns(table)
                }

                if old_col.lower() not in existing_cols:

                    continue  # already renamed or never existed

                try:

                    conn.execute(text(
                        f"ALTER TABLE `{table}` "
                        f"CHANGE COLUMN `{old_col}` `{new_col}` {new_ddl}"
                    ))

                    log.info(
                        "auto-migrate: renamed %s.%s → %s",
                        table, old_col, new_col
                    )

                except Exception as exc_inner:

                    log.warning(
                        "auto-migrate: could not rename %s.%s → %s: %s",
                        table, old_col, new_col, exc_inner
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

            # ---- 6. Add new unique indexes (RBAC Phase 1) ----
            for table, index_name, column in new_unique_indexes:

                if not insp.has_table(table):

                    continue

                existing_indexes = {
                    idx["name"]
                    for idx in insp.get_indexes(table)
                    if idx.get("name")
                }

                if index_name in existing_indexes:

                    continue

                try:

                    conn.execute(text(
                        f"ALTER TABLE `{table}` "
                        f"ADD UNIQUE INDEX `{index_name}` (`{column}`)"
                    ))

                    log.info(
                        "auto-migrate: added unique index %s on %s.%s",
                        index_name, table, column
                    )

                except Exception as exc_inner:

                    log.warning(
                        "auto-migrate: could not add unique index "
                        "%s on %s.%s: %s",
                        index_name, table, column, exc_inner
                    )

    except Exception as exc:

        log.warning("auto-migrate skipped: %s", exc)


_auto_migrate()


def _auto_seed_defaults():
    """Seed the single default Vendor → Department → Role → Employee
    chain on first boot.  Each step is guarded by a name/code lookup:
    if the record already exists it is reused so a partial seed can be
    completed without creating duplicates."""

    import logging
    import uuid
    from datetime import date, time as dtime
    from sqlalchemy.orm import sessionmaker
    from app.models.models import Vendor, Department, Role, Employee
    from app.services.auth_service import hash_password

    log = logging.getLogger("uvicorn")
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # ── 1. Vendor ─────────────────────────────────────────────────
        vendor = (
            db.query(Vendor)
              .filter(Vendor.VENDOR_NAME == "Bharath Vending Corporation")
              .first()
        )
        if vendor is None:
            vendor = Vendor(VENDOR_NAME="Bharath Vending Corporation")
            db.add(vendor)
            db.flush()
            log.info("auto-seed-defaults: vendor created (ID=%s)", vendor.ID)

        # ── 2. Department ─────────────────────────────────────────────
        dept = (
            db.query(Department)
              .filter(
                  Department.VENDOR_ID == vendor.ID,
                  Department.DEPARTMENT_CODE == "HRD",
              )
              .first()
        )
        if dept is None:
            dept = Department(
                VENDOR_ID=vendor.ID,
                DEPARTMENT_CODE="HRD",
                NAME="HR",
                DESCRIPTION=(
                    "Human Resources department responsible for employee "
                    "recruitment, onboarding, payroll, and compliance."
                ),
            )
            db.add(dept)
            db.flush()
            log.info("auto-seed-defaults: department created (ID=%s)", dept.ID)

        # ── 3. Role ───────────────────────────────────────────────────
        role = (
            db.query(Role)
              .filter(
                  Role.VENDOR_ID == vendor.ID,
                  Role.NAME == "SUPER_ADMIN",
              )
              .first()
        )
        if role is None:
            role = Role(
                VENDOR_ID=vendor.ID,
                DEPARTMENT_ID=dept.ID,
                NAME="SUPER_ADMIN",
                DESCRIPTION=(
                    "Super Administrator role with full access to all modules, "
                    "settings, and system configuration."
                ),
                IS_SYSTEM=1,
            )
            db.add(role)
            db.flush()
            log.info("auto-seed-defaults: role created (ID=%s)", role.ID)

        # ── 4. Employee ───────────────────────────────────────────────
        emp = (
            db.query(Employee)
              .filter(
                  Employee.VENDOR_ID == vendor.ID,
                  Employee.EMPLOYEE_CODE == "SA001",
              )
              .first()
        )
        if emp is None:
            emp = Employee(
                ID=str(uuid.uuid4()),
                EMPLOYEE_CODE="SA001",
                NAME="SUPERADMIN",
                PASSWORD=hash_password("SuperAdmin@123"),
                DEPARTMENT_ID=dept.ID,
                ROLE_ID=role.ID,
                VENDOR_ID=vendor.ID,
                JOINING_DATE=date.today(),
                SALARY=0.0,
                SHIFT_START=dtime(10, 0),
                SHIFT_END=dtime(18, 0),
                STATUS="ACTIVE",
                PROFILE_SUBMITTED=0,
            )
            db.add(emp)
            log.info("auto-seed-defaults: employee created (CODE=SA001)")

        # ── 5. Permission catalogue ─────────────────────────────────────
        # Reference/definitional data only — the fixed list of permission
        # CODEs the RBAC system knows about. This never creates a Role or
        # a RolePermission grant, so it doesn't conflict with the product
        # requirement that only SUPER_ADMIN is auto-seeded and that no
        # role is ever auto-granted permissions. Without this, the RBAC
        # UI's permission grid has nothing to show until someone manually
        # runs scripts/seed_permissions.py.
        catalogue_result = ensure_permission_catalogue(db)
        if catalogue_result["added"] or catalogue_result["updated_meta"]:
            log.info(
                "auto-seed-defaults: permission catalogue +%d (metadata backfilled on %d)",
                catalogue_result["added"], catalogue_result["updated_meta"],
            )

        db.commit()

    except Exception as exc:
        db.rollback()
        log.warning("auto-seed-defaults skipped: %s", exc)

    finally:
        db.close()


_auto_seed_defaults()


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


def _seed_essl_fingerprint_ids():
    """
    Stamp the ESSL X2008 device PIN onto each employee's FINGERPRINT_ID
    so /iclock/cdata can resolve incoming punches → Employee rows.

    Idempotent: only writes if the employee's FINGERPRINT_ID is empty
    AND no other employee already claims that PIN. Safe to keep running
    on every boot — becomes a no-op once seeded.

    PIN list from the device menu (User Mgt → All Users):
      PIN 2  → BVC002 (Nasira)
      PIN 4  → BVC004 (Ram kumar)
      PIN 5  → BVC005 (Harshith)
      PIN 8  → BVC008 (Puviyarasi)
      PIN 9  → BVC009 (Lakshminarayanan)
      PIN 16 → BVC016 (Manoj kumar)
      PIN 21 → BVC021 (Bharath)
      PIN 23 → BVC023 (Hemnath)
    """
    from sqlalchemy.orm import sessionmaker
    from app.models.models import Employee

    mapping = {
        "BVC002": "2",
        "BVC004": "4",
        "BVC005": "5",
        "BVC008": "8",
        "BVC009": "9",
        "BVC016": "16",
        "BVC021": "21",
        "BVC023": "23",
    }

    Session = sessionmaker(bind=engine)

    db = Session()

    try:

        for code, pin in mapping.items():

            emp = (
                db.query(Employee)
                  .filter(Employee.EMPLOYEE_CODE == code)
                  .first()
            )

            if not emp:
                print(f"[startup] essl-seed: employee {code} not found — skipped")
                continue

            if emp.FINGERPRINT_ID and emp.FINGERPRINT_ID.strip() != "":
                # Already set — respect existing value (may be a
                # different device model / re-enrolment).
                continue

            # Guard against the unique index on FINGERPRINT_ID: refuse
            # to write a PIN that another employee already owns.
            clash = (
                db.query(Employee)
                  .filter(Employee.FINGERPRINT_ID == pin)
                  .first()
            )

            if clash:
                print(
                    f"[startup] essl-seed: PIN {pin} already owned by "
                    f"{clash.EMPLOYEE_CODE} — skipping {code}"
                )
                continue

            emp.FINGERPRINT_ID = pin
            print(f"[startup] essl-seed: {code} ← PIN {pin}")

        db.commit()

    except Exception as exc:
        db.rollback()
        print(f"[startup] essl-seed: failed — {exc}")

    finally:
        db.close()


_seed_essl_fingerprint_ids()


# =====================================================================
# Weekly memo-automation scheduler
# ---------------------------------------------------------------------
# Fires once every Monday at 06:00 local server time. Idempotent — each
# memo is keyed on ISO week + employee + type via AUTOMATION_KEY, so a
# duplicate wake-up (server restart mid-morning, manual admin trigger
# earlier, etc.) never issues the same memo twice.
# =====================================================================
def _start_memo_automation_scheduler():

    import logging
    import threading
    import time as _time
    from datetime import datetime, timedelta
    from sqlalchemy.orm import sessionmaker

    log = logging.getLogger("uvicorn")

    RUN_HOUR   = 6      # 06:00
    RUN_WEEKDAY = 0     # Monday
    POLL_SECONDS = 60 * 30   # check every 30 minutes

    SessionLocal = sessionmaker(bind=engine)

    def _last_run_at(db):
        """Return the datetime of the previous automation run, or None."""
        from app.models.models import Setting
        row = db.query(Setting).filter(
            Setting.KEY == "memo_automation.last_run"
        ).first()
        if not row or not row.VALUE:
            return None
        try:
            import json
            payload = json.loads(row.VALUE)
            return datetime.fromisoformat(payload.get("ran_at"))
        except Exception:
            return None

    def _tick():
        while True:
            try:
                now = datetime.now()
                # Only fire on Monday, at or after 06:00
                if now.weekday() == RUN_WEEKDAY and now.hour >= RUN_HOUR:
                    db = SessionLocal()
                    try:
                        last = _last_run_at(db)
                        # If we already ran within the last 48h, skip —
                        # this covers manual runs and server restarts.
                        if not last or (now - last) > timedelta(hours=48):
                            log.info(
                                "memo-automation: weekly scheduler firing at %s",
                                now.isoformat(timespec="seconds"),
                            )
                            from app.services.memo_automation import run_weekly_automation
                            from app.routes.memo_automation import _store_last_run
                            summary = run_weekly_automation(db)
                            _store_last_run(db, summary)
                            log.info(
                                "memo-automation: created %d warnings, %d appreciations "
                                "(skipped %d already-issued)",
                                summary.warnings_created,
                                summary.appreciations_created,
                                summary.skipped_existing,
                            )
                    finally:
                        db.close()
            except Exception as exc:
                log.warning("memo-automation scheduler tick failed: %s", exc)
            _time.sleep(POLL_SECONDS)

    t = threading.Thread(
        target=_tick,
        name="memo-automation-scheduler",
        daemon=True,
    )
    t.start()
    log.info("memo-automation scheduler started (weekly, Monday 06:00)")


_start_memo_automation_scheduler()


# =====================================================================
# Monthly memo-automation scheduler
# ---------------------------------------------------------------------
# Fires on the 1st of each month at 06:00, evaluates the PREVIOUS month
# for every ACTIVE employee, and issues AI-personalised WARNING /
# APPRECIATION memos. Idempotent per (year, month, type, employee)
# via AUTOMATION_KEY. HR can also trigger runs on demand from the UI —
# both paths call the same run_monthly_evaluation() function.
# =====================================================================
def _start_monthly_memo_scheduler():

    import logging
    import threading
    import time as _time
    from datetime import datetime, timedelta
    from sqlalchemy.orm import sessionmaker

    log = logging.getLogger("uvicorn")

    RUN_HOUR = 6           # 06:00
    RUN_DAY_OF_MONTH = 1   # the 1st
    POLL_SECONDS = 60 * 30

    SessionLocal = sessionmaker(bind=engine)

    def _last_monthly_run_at(db):
        from app.models.models import Setting
        row = db.query(Setting).filter(
            Setting.KEY == "memo_automation.last_monthly_run"
        ).first()
        if not row or not row.VALUE:
            return None
        try:
            import json
            payload = json.loads(row.VALUE)
            return datetime.fromisoformat(payload.get("ran_at"))
        except Exception:
            return None

    def _previous_month(today: datetime) -> tuple[int, int]:
        """Return (year, month) of the calendar month BEFORE today's."""
        y, m = today.year, today.month
        if m == 1:
            return y - 1, 12
        return y, m - 1

    def _tick():
        while True:
            try:
                now = datetime.now()
                if now.day == RUN_DAY_OF_MONTH and now.hour >= RUN_HOUR:
                    db = SessionLocal()
                    try:
                        last = _last_monthly_run_at(db)
                        # Skip if we already ran within the last 20 days
                        # (covers manual runs + restarts within the month).
                        if not last or (now - last) > timedelta(days=20):
                            year, month = _previous_month(now)
                            log.info(
                                "monthly-memo-automation: firing for %04d-%02d at %s",
                                year, month, now.isoformat(timespec="seconds"),
                            )
                            from app.services.monthly_memo_automation import (
                                run_monthly_evaluation,
                            )
                            result = run_monthly_evaluation(db, year, month)

                            # Persist last-run marker
                            import json
                            from app.models.models import Setting
                            payload = json.dumps({
                                **result.as_dict(),
                                "ran_at": now.isoformat(),
                            })
                            row = db.query(Setting).filter(
                                Setting.KEY == "memo_automation.last_monthly_run"
                            ).first()
                            if row:
                                row.VALUE = payload
                                row.UPDATED_AT = now
                            else:
                                db.add(Setting(
                                    KEY="memo_automation.last_monthly_run",
                                    VALUE=payload,
                                    UPDATED_AT=now,
                                ))
                            db.commit()

                            log.info(
                                "monthly-memo-automation: %d warnings, %d appreciations "
                                "(skipped %d already-issued, %d errors)",
                                result.warnings_created,
                                result.appreciations_created,
                                result.skipped_already_issued,
                                len(result.errors),
                            )
                    finally:
                        db.close()
            except Exception as exc:
                log.warning("monthly-memo-automation tick failed: %s", exc)
            _time.sleep(POLL_SECONDS)

    t = threading.Thread(
        target=_tick,
        name="monthly-memo-automation-scheduler",
        daemon=True,
    )
    t.start()
    log.info("monthly-memo-automation scheduler started (1st of month, 06:00)")


_start_monthly_memo_scheduler()


def _migrate_rename_lead_whatsapp_module_code():
    """One-time, idempotent rename: MODULE_CODE 'lead_whatsapp' -> 'lead_module'
    (plus the matching AIModule.VECTOR_COLLECTION_NAME) across every table
    that stores it — ai_modules, whatsapp_module_setting, whatsapp_conversation.
    Renamed per admin request to a generic "<name>_module" naming convention
    that scales to future ERP modules (sales_module, inventory_module, ...)
    rather than a WhatsApp-specific code. Each UPDATE only touches rows still
    carrying the old value, so re-running this after the rename has already
    happened is a safe no-op. Must run BEFORE _auto_seed_ai_modules() /
    _auto_seed_whatsapp_configs() below, so their "does this row already
    exist" checks find the renamed row instead of creating a duplicate."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        with engine.begin() as conn:
            if insp.has_table("ai_modules"):
                conn.execute(text(
                    "UPDATE ai_modules SET MODULE_CODE = 'lead_module', "
                    "VECTOR_COLLECTION_NAME = 'lead_module_rag_collection' "
                    "WHERE MODULE_CODE = 'lead_whatsapp'"
                ))
            if insp.has_table("whatsapp_module_setting"):
                conn.execute(text(
                    "UPDATE whatsapp_module_setting SET MODULE_CODE = 'lead_module' "
                    "WHERE MODULE_CODE = 'lead_whatsapp'"
                ))
            if insp.has_table("whatsapp_conversation"):
                conn.execute(text(
                    "UPDATE whatsapp_conversation SET MODULE_CODE = 'lead_module' "
                    "WHERE MODULE_CODE = 'lead_whatsapp'"
                ))
    except Exception as exc:
        log.warning("migrate-rename-lead-whatsapp-module-code skipped: %s", exc)


_migrate_rename_lead_whatsapp_module_code()


def _auto_seed_ai_modules():
    """Seeds the first AI_MODULES row (Lead AI Assistant) so the RAG
    platform has something to onboard against on a fresh install. Follows
    the same idempotent shape as the other _auto_seed_* functions above:
    own session, try/except/log.warning, safe to re-run any number of
    times."""

    import logging
    from sqlalchemy.orm import sessionmaker
    from app.models.rag_models import AIModule
    from app.rag_modules.core.llm_client import DEFAULT_MODEL as RAG_DEFAULT_LLM_MODEL

    log = logging.getLogger("uvicorn")
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        existing = db.query(AIModule).filter(AIModule.MODULE_CODE == "lead").first()

        if existing is None:
            db.add(AIModule(
                MODULE_NAME="Lead AI Assistant",
                MODULE_CODE="lead",
                DESCRIPTION=(
                    "Answers questions about the lead management process "
                    "from uploaded SOPs/FAQs."
                ),
                VECTOR_COLLECTION_NAME="lead_rag_collection",
                EMBEDDING_MODEL="BAAI/bge-small-en-v1.5",
                LLM_MODEL=RAG_DEFAULT_LLM_MODEL,
                IS_ACTIVE=True,
            ))
            db.commit()
            log.info("auto-seed-ai-modules: 'lead' module created")

        existing_wa = db.query(AIModule).filter(AIModule.MODULE_CODE == "lead_module").first()

        if existing_wa is None:
            db.add(AIModule(
                MODULE_NAME="Lead WhatsApp Sales Assistant",
                MODULE_CODE="lead_module",
                DESCRIPTION=(
                    "Customer-facing WhatsApp sales assistant — a separate "
                    "knowledge base/collection from the internal 'lead' "
                    "module so internal SOP documents are never exposed to "
                    "customers. Admins upload customer-facing brochures/"
                    "company info here through the existing Knowledge Base UI."
                ),
                VECTOR_COLLECTION_NAME="lead_module_rag_collection",
                EMBEDDING_MODEL="BAAI/bge-small-en-v1.5",
                LLM_MODEL=RAG_DEFAULT_LLM_MODEL,
                IS_ACTIVE=True,
            ))
            db.commit()
            log.info("auto-seed-ai-modules: 'lead_module' module created")

    except Exception as exc:
        db.rollback()
        log.warning("auto-seed-ai-modules skipped: %s", exc)

    finally:
        db.close()


_auto_seed_ai_modules()


def _auto_seed_whatsapp_configs():
    """Seeds one SAMPLE VendorWhatsAppConfig row (the shared Meta connection)
    plus a matching WhatsAppModuleSetting row (module_code="lead_module" —
    Lead Management's own welcome-template/AI-toggle behavior) per vendor
    that doesn't already have them, so the WhatsApp Configuration page isn't
    empty on a fresh install and shows a realistic example of what a
    filled-in row looks like. Deliberately created with IS_ACTIVE=False and
    WEBHOOK_ENABLED=False — these are placeholder credentials, not real
    Meta ones, so nothing here may ever attempt to actually send/receive
    until an admin edits the row with real values and activates it.

    Skips entirely (with a warning) if WA_ENCRYPTION_KEY isn't configured —
    the two secret columns can't be persisted without it, and this function
    must never crash app startup. Idempotent per vendor: a vendor that
    already has ANY config row (including a real admin-created one) is
    left untouched, so this never clobbers real data on restart."""

    import logging
    from sqlalchemy.orm import sessionmaker
    from app.models.models import Vendor
    from app.models.whatsapp_models import VendorWhatsAppConfig, WhatsAppModuleSetting
    from app.utils.crypto_utils import encrypt_secret, fingerprint, is_encryption_configured

    log = logging.getLogger("uvicorn")

    if not is_encryption_configured():
        log.warning(
            "auto-seed-whatsapp-configs skipped: WA_ENCRYPTION_KEY not configured "
            "in backend/.env — set it to enable sample WhatsApp configuration rows."
        )
        return

    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        vendors = db.query(Vendor).all()

        for vendor in vendors:
            existing = db.query(VendorWhatsAppConfig).filter(
                VendorWhatsAppConfig.VENDOR_ID == vendor.ID
            ).first()

            if existing is None:
                sample_access_token = f"EAAGSampleAccessTokenForVendor{vendor.ID}ChangeMeBeforeUse0000"
                sample_app_secret = f"sample_app_secret_vendor_{vendor.ID}_change_me"

                db.add(VendorWhatsAppConfig(
                    VENDOR_ID=vendor.ID,
                    ACCOUNT_LABEL=f"{vendor.VENDOR_NAME} — Sample WhatsApp Account",
                    BUSINESS_DISPLAY_NAME=vendor.VENDOR_NAME,
                    BUSINESS_PHONE_NUMBER=f"+91 90000 {vendor.ID:05d}",
                    PHONE_NUMBER_ID=f"10{vendor.ID:014d}",
                    WABA_ID=f"20{vendor.ID:014d}",
                    APP_ID=f"30{vendor.ID:014d}",
                    APP_SECRET=encrypt_secret(sample_app_secret),
                    ACCESS_TOKEN=encrypt_secret(sample_access_token),
                    ACCESS_TOKEN_FINGERPRINT=fingerprint(sample_access_token),
                    VERIFY_TOKEN=f"bvc24_wa_verify_vendor_{vendor.ID}_change_me",
                    API_BASE_URL="https://graph.facebook.com",
                    GRAPH_API_VERSION="v25.0",
                    WEBHOOK_CALLBACK_URL="https://api.bvc24.com/whatsapp-webhook",
                    WEBHOOK_ENABLED=False,
                    DEFAULT_COUNTRY_CODE="91",
                    DEFAULT_LANGUAGE="en",
                    MAX_SEND_PER_SECOND=8,
                    DAILY_SEND_CAP=900,
                    HEALTH_STATUS="UNKNOWN",
                    IS_ACTIVE=False,
                ))
                db.commit()
                log.info("auto-seed-whatsapp-configs: sample config row created for vendor %s (%s)", vendor.ID, vendor.VENDOR_NAME)

            existing_setting = db.query(WhatsAppModuleSetting).filter(
                WhatsAppModuleSetting.VENDOR_ID == vendor.ID,
                WhatsAppModuleSetting.MODULE_CODE == "lead_module",
            ).first()

            if existing_setting is None:
                db.add(WhatsAppModuleSetting(
                    VENDOR_ID=vendor.ID,
                    MODULE_CODE="lead_module",
                    IS_ENABLED=True,
                    AUTO_TRIGGER_ENABLED=True,
                    WELCOME_TEMPLATE_NAME="lead_welcome",
                    WELCOME_TEMPLATE_LANG="en_US",
                    WELCOME_TEMPLATE_PARAMS="CONTACT_NAME",
                    REENGAGE_TEMPLATE_NAME="lead_followup",
                    REENGAGE_TEMPLATE_LANG="en_US",
                    AI_REPLY_ENABLED=True,
                    SUPPORTED_LANGUAGES="en,ta",
                ))
                db.commit()
                log.info("auto-seed-whatsapp-configs: sample lead_module module setting created for vendor %s", vendor.ID)

    except Exception as exc:
        db.rollback()
        log.warning("auto-seed-whatsapp-configs skipped: %s", exc)

    finally:
        db.close()


_auto_seed_whatsapp_configs()


def _migrate_whatsapp_module_settings():
    """One-time, idempotent migration: copies the 7 Lead-flow-specific
    columns that used to live on VendorWhatsAppConfig (WELCOME_TEMPLATE_*,
    REENGAGE_TEMPLATE_*, SEND_WELCOME_ENABLED, AI_REPLY_ENABLED) into a new
    per-vendor WhatsAppModuleSetting row (MODULE_CODE="lead_module"), then
    drops those columns from vendor_whatsapp_config now that they live in
    the generic per-module table (see whatsapp_models.py's class docstrings
    for why). Reads the legacy columns via raw SQL rather than the ORM
    model — the ORM no longer declares them, so a normal query would raise
    AttributeError even though the physical columns may still exist on an
    un-migrated deployment. Safe to re-run: does nothing once the legacy
    columns are gone (a brand-new install never has them at all, since
    create_all() creates the table from today's model directly)."""

    import logging
    from sqlalchemy import text, inspect
    from sqlalchemy.orm import sessionmaker
    from app.models.whatsapp_models import WhatsAppModuleSetting

    log = logging.getLogger("uvicorn")
    Session = sessionmaker(bind=engine)
    db = Session()

    _LEGACY_FIELDS = [
        "WELCOME_TEMPLATE_NAME", "WELCOME_TEMPLATE_LANG", "WELCOME_TEMPLATE_PARAMS",
        "REENGAGE_TEMPLATE_NAME", "REENGAGE_TEMPLATE_LANG",
        "SEND_WELCOME_ENABLED", "AI_REPLY_ENABLED",
    ]

    try:
        insp = inspect(engine)
        if not insp.has_table("vendor_whatsapp_config"):
            return

        existing_cols = {c["name"] for c in insp.get_columns("vendor_whatsapp_config")}
        legacy_present = [f for f in _LEGACY_FIELDS if f in existing_cols]

        if legacy_present:
            with engine.connect() as conn:
                rows = conn.execute(text(
                    "SELECT ID, VENDOR_ID, WELCOME_TEMPLATE_NAME, WELCOME_TEMPLATE_LANG, "
                    "WELCOME_TEMPLATE_PARAMS, REENGAGE_TEMPLATE_NAME, REENGAGE_TEMPLATE_LANG, "
                    "SEND_WELCOME_ENABLED, AI_REPLY_ENABLED FROM vendor_whatsapp_config"
                )).mappings().all()

            for row in rows:
                already = db.query(WhatsAppModuleSetting).filter(
                    WhatsAppModuleSetting.VENDOR_ID == row["VENDOR_ID"],
                    WhatsAppModuleSetting.MODULE_CODE == "lead_module",
                ).first()
                if already:
                    continue

                db.add(WhatsAppModuleSetting(
                    VENDOR_ID=row["VENDOR_ID"],
                    MODULE_CODE="lead_module",
                    IS_ENABLED=True,
                    AUTO_TRIGGER_ENABLED=bool(row["SEND_WELCOME_ENABLED"]) if row["SEND_WELCOME_ENABLED"] is not None else True,
                    WELCOME_TEMPLATE_NAME=row["WELCOME_TEMPLATE_NAME"],
                    WELCOME_TEMPLATE_LANG=row["WELCOME_TEMPLATE_LANG"] or "en_US",
                    WELCOME_TEMPLATE_PARAMS=row["WELCOME_TEMPLATE_PARAMS"],
                    REENGAGE_TEMPLATE_NAME=row["REENGAGE_TEMPLATE_NAME"],
                    REENGAGE_TEMPLATE_LANG=row["REENGAGE_TEMPLATE_LANG"] or "en_US",
                    AI_REPLY_ENABLED=bool(row["AI_REPLY_ENABLED"]) if row["AI_REPLY_ENABLED"] is not None else True,
                    SUPPORTED_LANGUAGES="en",
                ))
                log.info("migrate-whatsapp-module-settings: backfilled vendor %s", row["VENDOR_ID"])

            db.commit()

            # Now that the data lives in whatsapp_module_setting, drop the
            # legacy columns. Idempotent: re-checks column existence right
            # before each DROP, and one column failing to drop doesn't stop
            # the others.
            insp2 = inspect(engine)
            still_present = {c["name"] for c in insp2.get_columns("vendor_whatsapp_config")}
            with engine.begin() as conn:
                for col in _LEGACY_FIELDS:
                    if col not in still_present:
                        continue
                    try:
                        conn.execute(text(f"ALTER TABLE `vendor_whatsapp_config` DROP COLUMN `{col}`"))
                        log.info("migrate-whatsapp-module-settings: dropped vendor_whatsapp_config.%s", col)
                    except Exception as exc_inner:
                        log.warning("migrate-whatsapp-module-settings: could not drop %s: %s", col, exc_inner)

    except Exception as exc:
        db.rollback()
        log.warning("migrate-whatsapp-module-settings skipped: %s", exc)

    finally:
        db.close()


_migrate_whatsapp_module_settings()


def _migrate_add_conversation_preferred_language():
    """One-time, idempotent: adds WhatsAppConversation.PREFERRED_LANGUAGE if
    the physical column doesn't exist yet. A brand-new install already gets
    it from create_all() since the ORM model declares it — this only matters
    for an existing whatsapp_conversation table. Safe to re-run: checks
    column existence first, same pattern as _migrate_whatsapp_module_settings
    above."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("whatsapp_conversation"):
            return

        existing_cols = {c["name"] for c in insp.get_columns("whatsapp_conversation")}
        if "PREFERRED_LANGUAGE" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `whatsapp_conversation` ADD COLUMN `PREFERRED_LANGUAGE` VARCHAR(10) NULL"
                ))
            log.info("migrate-add-conversation-preferred-language: added whatsapp_conversation.PREFERRED_LANGUAGE")

    except Exception as exc:
        log.warning("migrate-add-conversation-preferred-language skipped: %s", exc)


_migrate_add_conversation_preferred_language()


def _migrate_drop_override_reason():
    """One-time, idempotent: drops employee_permission_override.REASON,
    which used to be a mandatory justification field for RBAC Grant/Deny
    overrides. That requirement was removed — Grant/Deny is now a plain
    confirm action with no reason collected — so an already-provisioned
    database still carrying the old NOT NULL column would otherwise
    reject every override write the moment the app stops sending it. A
    brand-new install never has this column at all, since create_all()
    builds the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("employee_permission_override"):
            return

        existing_cols = {c["name"] for c in insp.get_columns("employee_permission_override")}
        if "REASON" in existing_cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `employee_permission_override` DROP COLUMN `REASON`"
                ))
            log.info("migrate-drop-override-reason: dropped employee_permission_override.REASON")

    except Exception as exc:
        log.warning("migrate-drop-override-reason skipped: %s", exc)


_migrate_drop_override_reason()


def _migrate_add_role_code():
    """One-time, idempotent: adds role.CODE if the physical column is
    missing (existing deployments — a brand-new install already gets it
    from create_all() since the ORM model declares it), then backfills
    every existing NULL row with a short code derived from NAME via
    models.derive_role_code(), disambiguated per-vendor on collision
    (SM, SM2, SM3, ...). Used to build auto-generated Employee IDs
    (DEPT-ROLE-NNN) — see routes/employee.py."""

    import logging
    from sqlalchemy import text, inspect
    from sqlalchemy.orm import sessionmaker
    from app.models.models import Role, derive_role_code

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("role"):
            return

        existing_cols = {c["name"] for c in insp.get_columns("role")}
        if "CODE" not in existing_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE `role` ADD COLUMN `CODE` VARCHAR(10) NULL"))
            log.info("migrate-add-role-code: added role.CODE")

        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            rows = db.query(Role).order_by(Role.VENDOR_ID, Role.ID).all()
            used_by_vendor = {}
            for r in rows:
                used_by_vendor.setdefault(r.VENDOR_ID, set())
                if r.CODE:
                    used_by_vendor[r.VENDOR_ID].add(r.CODE.upper())

            changed = False
            for r in rows:
                if r.CODE:
                    continue
                base = derive_role_code(r.NAME) or "GEN"
                used = used_by_vendor[r.VENDOR_ID]
                candidate = base
                suffix = 2
                while candidate in used:
                    candidate = f"{base}{suffix}"
                    suffix += 1
                r.CODE = candidate
                used.add(candidate)
                changed = True

            if changed:
                db.commit()
                log.info("migrate-add-role-code: backfilled CODE for roles missing one")
        finally:
            db.close()

    except Exception as exc:
        log.warning("migrate-add-role-code skipped: %s", exc)


_migrate_add_role_code()


def _migrate_drop_customer_requirement_and_contact():
    """One-time, idempotent: CustomerRequirement + CustomerContact were
    removed entirely (Customer Master rewrite). Drops
    quotation_line.REQUIREMENT_ID (FK + column) first — MySQL refuses
    DROP TABLE customer_requirement while another table still has a
    live FK into it — then drops both legacy tables outright. A
    brand-new install never creates these tables (the ORM classes no
    longer exist), so this is a no-op there."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)

        if insp.has_table("quotation_line"):
            cols = {c["name"] for c in insp.get_columns("quotation_line")}
            if "REQUIREMENT_ID" in cols:
                with engine.begin() as conn:
                    fk_rows = conn.execute(text(
                        "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotation_line' "
                        "AND COLUMN_NAME = 'REQUIREMENT_ID' AND REFERENCED_TABLE_NAME IS NOT NULL"
                    )).fetchall()
                    for (fk_name,) in fk_rows:
                        try:
                            conn.execute(text(f"ALTER TABLE `quotation_line` DROP FOREIGN KEY `{fk_name}`"))
                        except Exception as exc_inner:
                            log.warning("migrate-drop-requirement: could not drop FK %s: %s", fk_name, exc_inner)
                    try:
                        conn.execute(text("ALTER TABLE `quotation_line` DROP COLUMN `REQUIREMENT_ID`"))
                        log.info("migrate-drop-requirement: dropped quotation_line.REQUIREMENT_ID")
                    except Exception as exc_inner:
                        log.warning("migrate-drop-requirement: could not drop REQUIREMENT_ID: %s", exc_inner)

        with engine.begin() as conn:
            if insp.has_table("customer_requirement"):
                conn.execute(text("DROP TABLE IF EXISTS `customer_requirement`"))
                log.info("migrate-drop-requirement: dropped customer_requirement table")
            if insp.has_table("customer_contact"):
                conn.execute(text("DROP TABLE IF EXISTS `customer_contact`"))
                log.info("migrate-drop-requirement: dropped customer_contact table")

    except Exception as exc:
        log.warning("migrate-drop-requirement-and-contact skipped: %s", exc)


_migrate_drop_customer_requirement_and_contact()


def _migrate_drop_customer_onboarding_portal():
    """One-time, idempotent: the Customer Self-Onboarding Portal
    (CustomerOnboardingSession / CustomerPortalUser / CustomerChatMessage)
    was removed entirely — the ORM classes no longer exist in
    customer_models.py. Drops the two child tables first
    (customer_chat_message, customer_portal_user both carry a
    SESSION_ID FK into customer_onboarding_session; MySQL refuses to
    drop the parent while either FK is live), then the session table
    itself. A brand-new install never creates these tables, so this
    is a no-op there."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)

        with engine.begin() as conn:
            if insp.has_table("customer_chat_message"):
                conn.execute(text("DROP TABLE IF EXISTS `customer_chat_message`"))
                log.info("migrate-drop-onboarding-portal: dropped customer_chat_message table")
            if insp.has_table("customer_portal_user"):
                conn.execute(text("DROP TABLE IF EXISTS `customer_portal_user`"))
                log.info("migrate-drop-onboarding-portal: dropped customer_portal_user table")
            if insp.has_table("customer_onboarding_session"):
                conn.execute(text("DROP TABLE IF EXISTS `customer_onboarding_session`"))
                log.info("migrate-drop-onboarding-portal: dropped customer_onboarding_session table")

    except Exception as exc:
        log.warning("migrate-drop-onboarding-portal skipped: %s", exc)


_migrate_drop_customer_onboarding_portal()


def _migrate_drop_legacy_project_and_fks():
    """One-time, idempotent: CustomerProject (table project_legacy) was
    removed entirely. Six live tables carried a bare FK column into
    project_legacy.ID with no relationship() on either side
    (Task.PROJECT_ID, TaskAssignment.PROJECT_ID, WorkOrder.PROJECT_ID,
    DailyAllocation.PROJECT_ID, PurchaseOrder.LINKED_PROJECT_ID,
    SalesOrderLine.SPAWNED_PROJECT_ID). Each FK constraint must be
    dropped by name (MySQL has no DROP COLUMN ... CASCADE), then the
    column itself, before project_legacy can be dropped. A brand-new
    install never creates project_legacy or these FK columns (the ORM
    definitions no longer exist), so this is a no-op there.

    Order-independent with respect to _migrate_customer_pk_to_uuid():
    that function early-exits the instant customer.ID is already
    VARCHAR(36) (true in every environment this has run in, including
    fresh installs, since Customer.ID is declared as String(36) from
    the start) — it never reaches the code referencing its DEPENDENTS
    list."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    FK_DROPS = [
        ("task", "PROJECT_ID"),
        ("task_assignment", "PROJECT_ID"),
        ("work_order", "PROJECT_ID"),
        ("daily_allocation", "PROJECT_ID"),
        ("purchase_order", "LINKED_PROJECT_ID"),
        ("sales_order_line", "SPAWNED_PROJECT_ID"),
    ]

    try:
        insp = inspect(engine)

        for table_name, col_name in FK_DROPS:
            if not insp.has_table(table_name):
                continue
            cols = {c["name"] for c in insp.get_columns(table_name)}
            if col_name not in cols:
                continue
            with engine.begin() as conn:
                fk_rows = conn.execute(text(
                    "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                    "AND COLUMN_NAME = :c AND REFERENCED_TABLE_NAME IS NOT NULL"
                ), {"t": table_name, "c": col_name}).fetchall()
                for (fk_name,) in fk_rows:
                    try:
                        conn.execute(text(f"ALTER TABLE `{table_name}` DROP FOREIGN KEY `{fk_name}`"))
                    except Exception as exc_inner:
                        log.warning("migrate-drop-legacy-project: could not drop FK %s.%s: %s", table_name, fk_name, exc_inner)
                try:
                    conn.execute(text(f"ALTER TABLE `{table_name}` DROP COLUMN `{col_name}`"))
                    log.info("migrate-drop-legacy-project: dropped %s.%s", table_name, col_name)
                except Exception as exc_inner:
                    log.warning("migrate-drop-legacy-project: could not drop %s.%s: %s", table_name, col_name, exc_inner)

        with engine.begin() as conn:
            if insp.has_table("project_legacy"):
                conn.execute(text("DROP TABLE IF EXISTS `project_legacy`"))
                log.info("migrate-drop-legacy-project: dropped project_legacy table")

    except Exception as exc:
        log.warning("migrate-drop-legacy-project skipped: %s", exc)


_migrate_drop_legacy_project_and_fks()


def _migrate_drop_crm_and_manufacturing():
    """One-time, idempotent: the CRM & Sales section (Quotation family,
    SalesOrder family, DiscountRequest) and the Manufacturing section
    (WorkCenter, Machine/MachineLog, ProductModel, BOMItem, WorkOrder,
    ProcessStage, WorkOrderStageProgress, QC*, NCR) were removed
    entirely, including their historical data. A brand-new install
    never creates these tables, so this is a no-op there.

    Exactly one column outside this set points into it:
    purchase_order_line.BOM_ITEM_ID -> bom_item.ID (nullable, unused by
    any live UI). Its FK + column are dropped first. Every other FK
    among the 20 dropped tables is internal to the set — this function
    drops each table's own outgoing FK constraints before dropping any
    table, so the DROP TABLE calls below can run in any order."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    DROP_TABLES = [
        "ncr",
        "qc_inspection_result",
        "qc_inspection",
        "qc_checklist_item",
        "wo_stage_progress",
        "machine_log",
        "machine",
        "sales_order_activity",
        "sales_order_line",
        "sales_order",
        "discount_request",
        "quotation_negotiation",
        "quotation_activity",
        "quotation_line",
        "quotation",
        "work_order",
        "bom_item",
        "process_stage",
        "product_model",
        "work_center",
    ]

    try:
        insp = inspect(engine)

        if insp.has_table("purchase_order_line"):
            cols = {c["name"] for c in insp.get_columns("purchase_order_line")}
            if "BOM_ITEM_ID" in cols:
                with engine.begin() as conn:
                    fk_rows = conn.execute(text(
                        "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_order_line' "
                        "AND COLUMN_NAME = 'BOM_ITEM_ID' AND REFERENCED_TABLE_NAME IS NOT NULL"
                    )).fetchall()
                    for (fk_name,) in fk_rows:
                        try:
                            conn.execute(text(f"ALTER TABLE `purchase_order_line` DROP FOREIGN KEY `{fk_name}`"))
                        except Exception as exc_inner:
                            log.warning("migrate-drop-crm-mfg: could not drop FK purchase_order_line.%s: %s", fk_name, exc_inner)
                    try:
                        conn.execute(text("ALTER TABLE `purchase_order_line` DROP COLUMN `BOM_ITEM_ID`"))
                        log.info("migrate-drop-crm-mfg: dropped purchase_order_line.BOM_ITEM_ID")
                    except Exception as exc_inner:
                        log.warning("migrate-drop-crm-mfg: could not drop purchase_order_line.BOM_ITEM_ID: %s", exc_inner)

        for table_name in DROP_TABLES:
            if not insp.has_table(table_name):
                continue
            with engine.begin() as conn:
                fk_rows = conn.execute(text(
                    "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                    "AND REFERENCED_TABLE_NAME IS NOT NULL"
                ), {"t": table_name}).fetchall()
                for (fk_name,) in fk_rows:
                    try:
                        conn.execute(text(f"ALTER TABLE `{table_name}` DROP FOREIGN KEY `{fk_name}`"))
                    except Exception as exc_inner:
                        log.warning("migrate-drop-crm-mfg: could not drop FK %s.%s: %s", table_name, fk_name, exc_inner)

        for table_name in DROP_TABLES:
            if not insp.has_table(table_name):
                continue
            with engine.begin() as conn:
                try:
                    conn.execute(text(f"DROP TABLE IF EXISTS `{table_name}`"))
                    log.info("migrate-drop-crm-mfg: dropped table %s", table_name)
                except Exception as exc_inner:
                    log.warning("migrate-drop-crm-mfg: could not drop table %s: %s", table_name, exc_inner)

    except Exception as exc:
        log.warning("migrate-drop-crm-mfg skipped: %s", exc)


_migrate_drop_crm_and_manufacturing()


def _migrate_customer_master_columns():
    """One-time, idempotent: rewrites `customer`'s columns to the
    slimmed Customer Master shape — CUSTOMER_NAME->NAME, PHONE->
    PHONE_NUMBER, widens GST_NUMBER, adds COMPANY_NAME, backfills
    blanks so the new NOT NULL constraints don't reject existing
    rows, then drops every column no longer in the model. Guarded by
    column presence/nullability so a healthy post-migration database
    (or a brand-new install, which never has the old names since
    create_all() builds the table from today's model directly) is a
    complete no-op."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    _LEGACY_COLUMNS_TO_DROP = [
        "CUSTOMER_CODE", "CONTACT_PERSON", "DESIGNATION", "ALTERNATE_PHONE",
        "WEBSITE", "CITY", "STATE", "PINCODE", "COUNTRY", "PAN_NUMBER",
        "INDUSTRY", "SOURCE", "STATUS", "NOTES", "CUSTOMER_TYPE",
        "BUSINESS_TYPE", "NUMBER_OF_BRANCHES", "EXPECTED_MONTHLY_ORDERS",
        "EXISTING_MACHINE_USAGE", "CURRENT_VENDOR_NAME", "WHATSAPP_NUMBER",
        "BILLING_ADDRESS", "SHIPPING_ADDRESS", "GOOGLE_MAP_LOCATION",
        "LEAD_SOURCE", "LEAD_STATUS", "LEAD_PRIORITY", "LEAD_CREATED_DATE",
        "ASSIGNED_SALES_ID", "FOLLOW_UP_DATE", "NEXT_MEETING_DATE",
        "REQUIREMENT_NOTES",
    ]

    try:
        insp = inspect(engine)
        if not insp.has_table("customer"):
            return

        cols_info = {c["name"]: c for c in insp.get_columns("customer")}
        cols = set(cols_info)

        with engine.begin() as conn:

            if "COMPANY_NAME" not in cols:
                conn.execute(text("ALTER TABLE `customer` ADD COLUMN `COMPANY_NAME` VARCHAR(100) NULL"))
                log.info("migrate-customer-master: added customer.COMPANY_NAME")

            # Backfill NULLs before tightening to NOT NULL (old
            # CUSTOMER_NAME/PHONE/EMAIL/ADDRESS were all nullable).
            if "CUSTOMER_NAME" in cols:
                conn.execute(text("UPDATE `customer` SET `CUSTOMER_NAME` = '' WHERE `CUSTOMER_NAME` IS NULL"))
                conn.execute(text(
                    "ALTER TABLE `customer` CHANGE COLUMN `CUSTOMER_NAME` `NAME` VARCHAR(100) NOT NULL"
                ))
                log.info("migrate-customer-master: renamed CUSTOMER_NAME -> NAME")

            if "PHONE" in cols:
                conn.execute(text("UPDATE `customer` SET `PHONE` = '' WHERE `PHONE` IS NULL"))
                conn.execute(text(
                    "ALTER TABLE `customer` CHANGE COLUMN `PHONE` `PHONE_NUMBER` VARCHAR(20) NOT NULL"
                ))
                log.info("migrate-customer-master: renamed PHONE -> PHONE_NUMBER")

            if cols_info.get("EMAIL", {}).get("nullable"):
                conn.execute(text("UPDATE `customer` SET `EMAIL` = '' WHERE `EMAIL` IS NULL"))
                conn.execute(text("ALTER TABLE `customer` MODIFY COLUMN `EMAIL` VARCHAR(100) NOT NULL"))

            if cols_info.get("ADDRESS", {}).get("nullable"):
                conn.execute(text("UPDATE `customer` SET `ADDRESS` = '' WHERE `ADDRESS` IS NULL"))
                conn.execute(text("ALTER TABLE `customer` MODIFY COLUMN `ADDRESS` VARCHAR(255) NOT NULL"))

            if "GST_NUMBER" in cols and "50" not in str(cols_info["GST_NUMBER"]["type"]):
                conn.execute(text("ALTER TABLE `customer` MODIFY COLUMN `GST_NUMBER` VARCHAR(50) NULL"))

            for col in _LEGACY_COLUMNS_TO_DROP:
                if col not in cols:
                    continue
                try:
                    conn.execute(text(f"ALTER TABLE `customer` DROP COLUMN `{col}`"))
                    log.info("migrate-customer-master: dropped customer.%s", col)
                except Exception as exc_inner:
                    log.warning("migrate-customer-master: could not drop %s: %s", col, exc_inner)

    except Exception as exc:
        log.warning("migrate-customer-master-columns skipped: %s", exc)


_migrate_customer_master_columns()


def _migrate_customer_pk_to_uuid():
    """One-time, idempotent: swaps customer.ID from autoincrement INT
    to a String(36) UUID PK, remapping every dependent FK
    (quotation / sales_order . CUSTOMER_ID) to match, via a scratch
    old-ID -> new-UUID mapping table. Also retypes customer.VENDOR_ID's
    FK to add ON DELETE CASCADE while we already have its FK dropped
    for the ID swap (MySQL can't alter a FK's ON DELETE action in
    place).

    MUST run after _migrate_drop_customer_requirement_and_contact()
    (removes two more FK-holders against customer.ID that would
    otherwise block the type change) and
    _migrate_customer_master_columns(). Never raises."""

    import logging
    import uuid as _uuid
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")
    DEPENDENTS = ["quotation", "sales_order"]

    try:
        insp = inspect(engine)
        if not insp.has_table("customer"):
            return

        id_col = next((c for c in insp.get_columns("customer") if c["name"] == "ID"), None)
        if id_col is None:
            return
        if "CHAR" in str(id_col["type"]).upper():   # already VARCHAR(36) -> already migrated
            return

        log.info("migrate-customer-pk-uuid: starting Integer -> UUID PK cutover")

        with engine.begin() as conn:

            # 1. Build the old-ID -> new-UUID mapping
            conn.execute(text("DROP TABLE IF EXISTS `_customer_id_uuid_map`"))
            conn.execute(text(
                "CREATE TABLE `_customer_id_uuid_map` "
                "(`OLD_ID` INT NOT NULL PRIMARY KEY, `NEW_ID` VARCHAR(36) NOT NULL)"
            ))
            old_ids = [r[0] for r in conn.execute(text("SELECT ID FROM `customer`")).fetchall()]
            for old_id in old_ids:
                conn.execute(
                    text("INSERT INTO `_customer_id_uuid_map` (OLD_ID, NEW_ID) VALUES (:o, :n)"),
                    {"o": old_id, "n": str(_uuid.uuid4())}
                )

            # 2. Add + populate the new UUID column on customer + dependents
            conn.execute(text("ALTER TABLE `customer` ADD COLUMN `ID_NEW` VARCHAR(36) NULL"))
            conn.execute(text(
                "UPDATE `customer` c JOIN `_customer_id_uuid_map` m ON c.ID = m.OLD_ID "
                "SET c.ID_NEW = m.NEW_ID"
            ))
            for table in DEPENDENTS:
                if not insp.has_table(table):
                    continue
                dep_cols = {c["name"] for c in insp.get_columns(table)}
                if "CUSTOMER_ID" not in dep_cols:
                    continue
                conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `CUSTOMER_ID_NEW` VARCHAR(36) NULL"))
                conn.execute(text(
                    f"UPDATE `{table}` t JOIN `_customer_id_uuid_map` m ON t.CUSTOMER_ID = m.OLD_ID "
                    f"SET t.CUSTOMER_ID_NEW = m.NEW_ID"
                ))

            # 3. Drop every FK that references customer.ID (discovered
            #    dynamically — MySQL refuses to retype a column that's
            #    the target of a live FK), plus VENDOR_ID's FK (so we
            #    can re-add it with ON DELETE CASCADE below).
            fk_rows = conn.execute(text(
                "SELECT TABLE_NAME, CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                "WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'customer' "
                "AND REFERENCED_COLUMN_NAME = 'ID'"
            )).fetchall()
            for table_name, fk_name in fk_rows:
                try:
                    conn.execute(text(f"ALTER TABLE `{table_name}` DROP FOREIGN KEY `{fk_name}`"))
                except Exception as exc_inner:
                    log.warning("migrate-customer-pk-uuid: drop FK %s.%s failed: %s", table_name, fk_name, exc_inner)

            vendor_fk_rows = conn.execute(text(
                "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer' "
                "AND COLUMN_NAME = 'VENDOR_ID' AND REFERENCED_TABLE_NAME = 'vendor'"
            )).fetchall()
            for (fk_name,) in vendor_fk_rows:
                try:
                    conn.execute(text(f"ALTER TABLE `customer` DROP FOREIGN KEY `{fk_name}`"))
                except Exception as exc_inner:
                    log.warning("migrate-customer-pk-uuid: drop VENDOR_ID FK failed: %s", exc_inner)

            # 4. Drop old INT columns, promote the *_NEW columns
            for table in DEPENDENTS:
                if not insp.has_table(table):
                    continue
                dep_cols = {c["name"] for c in insp.get_columns(table)}
                if "CUSTOMER_ID" not in dep_cols:
                    continue
                conn.execute(text(f"ALTER TABLE `{table}` DROP COLUMN `CUSTOMER_ID`"))
                conn.execute(text(
                    f"ALTER TABLE `{table}` CHANGE COLUMN `CUSTOMER_ID_NEW` `CUSTOMER_ID` VARCHAR(36) NULL"
                ))
                log.info("migrate-customer-pk-uuid: %s.CUSTOMER_ID is now VARCHAR(36)", table)

            # customer.ID: an AUTO_INCREMENT column must be dropped and
            # re-keyed in the same ALTER TABLE statement.
            conn.execute(text("ALTER TABLE `customer` MODIFY COLUMN `ID` INT NOT NULL, DROP PRIMARY KEY"))
            conn.execute(text("ALTER TABLE `customer` DROP COLUMN `ID`"))
            conn.execute(text(
                "ALTER TABLE `customer` CHANGE COLUMN `ID_NEW` `ID` VARCHAR(36) NOT NULL, ADD PRIMARY KEY (`ID`)"
            ))

            # 5. Re-add the dependent FKs (both sides now VARCHAR(36))
            #    + VENDOR_ID's FK with ON DELETE CASCADE
            for table in DEPENDENTS:
                if not insp.has_table(table):
                    continue
                dep_cols = {c["name"] for c in insp.get_columns(table)}
                if "CUSTOMER_ID" not in dep_cols:
                    continue
                try:
                    conn.execute(text(
                        f"ALTER TABLE `{table}` ADD CONSTRAINT `fk_{table}_customer` "
                        f"FOREIGN KEY (`CUSTOMER_ID`) REFERENCES `customer` (`ID`)"
                    ))
                except Exception as exc_inner:
                    log.warning("migrate-customer-pk-uuid: re-add FK on %s failed: %s", table, exc_inner)

            conn.execute(text("UPDATE `customer` SET `VENDOR_ID` = 1 WHERE `VENDOR_ID` IS NULL"))
            conn.execute(text("ALTER TABLE `customer` MODIFY COLUMN `VENDOR_ID` INT NOT NULL"))
            try:
                conn.execute(text(
                    "ALTER TABLE `customer` ADD CONSTRAINT `fk_customer_vendor` "
                    "FOREIGN KEY (`VENDOR_ID`) REFERENCES `vendor` (`ID`) ON DELETE CASCADE"
                ))
            except Exception as exc_inner:
                log.warning("migrate-customer-pk-uuid: re-add VENDOR_ID FK failed: %s", exc_inner)

            conn.execute(text("DROP TABLE IF EXISTS `_customer_id_uuid_map`"))

        log.info("migrate-customer-pk-uuid: cutover complete")

    except Exception as exc:
        log.warning("migrate-customer-pk-uuid skipped: %s", exc)


_migrate_customer_pk_to_uuid()


def _migrate_customer_address_columns():
    """One-time, idempotent: adds CITY/STATE/PINCODE/COUNTRY_ISO to
    `customer` (mirrors Lead's own shapes: 120/120/15/5). These are
    NEW columns for the Lead-to-Customer-conversion feature — distinct
    from the legacy CITY/STATE/PINCODE/COUNTRY columns that
    _migrate_customer_master_columns() already drops as part of the
    Customer Master rewrite.

    MUST run after _migrate_customer_master_columns() — that function's
    _LEGACY_COLUMNS_TO_DROP list includes CITY/STATE/PINCODE by the
    same literal names. If this ran first on a not-yet-migrated
    database, the freshly-added columns would be immediately dropped
    again as "legacy". A brand-new install never hits either path —
    create_all() builds `customer` from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer"):
            return

        cols = {c["name"] for c in insp.get_columns("customer")}

        with engine.begin() as conn:
            if "CITY" not in cols:
                conn.execute(text("ALTER TABLE `customer` ADD COLUMN `CITY` VARCHAR(120) NULL"))
                log.info("migrate-customer-address: added customer.CITY")
            if "STATE" not in cols:
                conn.execute(text("ALTER TABLE `customer` ADD COLUMN `STATE` VARCHAR(120) NULL"))
                log.info("migrate-customer-address: added customer.STATE")
            if "PINCODE" not in cols:
                conn.execute(text("ALTER TABLE `customer` ADD COLUMN `PINCODE` VARCHAR(15) NULL"))
                log.info("migrate-customer-address: added customer.PINCODE")
            if "COUNTRY_ISO" not in cols:
                conn.execute(text("ALTER TABLE `customer` ADD COLUMN `COUNTRY_ISO` VARCHAR(5) NULL"))
                log.info("migrate-customer-address: added customer.COUNTRY_ISO")

    except Exception as exc:
        log.warning("migrate-customer-address-columns skipped: %s", exc)


_migrate_customer_address_columns()


def _migrate_lead_conversion_columns():
    """One-time, idempotent: adds PROJECT_ID / CUSTOMER_ID /
    CUSTOMER_ASSIGNMENT_TYPE / GST_NUMBER to `lead` for the
    Lead-to-Customer-conversion feature. All four are nullable, so
    existing lead rows need no backfill. A brand-new install never
    hits this — create_all() builds `lead` from today's model
    directly, already including these columns.

    MUST run after `project` and `customer` tables exist (both FK
    targets) — safe here since this runs at the very end of the
    migration sequence in main.py, well after those tables are
    created/migrated."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("lead"):
            return

        cols = {c["name"] for c in insp.get_columns("lead")}

        with engine.begin() as conn:
            if "PROJECT_ID" not in cols:
                conn.execute(text(
                    "ALTER TABLE `lead` ADD COLUMN `PROJECT_ID` VARCHAR(36) NULL, "
                    "ADD CONSTRAINT `fk_lead_project` FOREIGN KEY (`PROJECT_ID`) "
                    "REFERENCES `project` (`ID`) ON DELETE SET NULL"
                ))
                log.info("migrate-lead-conversion: added lead.PROJECT_ID (+FK)")

            if "CUSTOMER_ID" not in cols:
                conn.execute(text(
                    "ALTER TABLE `lead` ADD COLUMN `CUSTOMER_ID` VARCHAR(36) NULL, "
                    "ADD CONSTRAINT `fk_lead_customer` FOREIGN KEY (`CUSTOMER_ID`) "
                    "REFERENCES `customer` (`ID`) ON DELETE SET NULL"
                ))
                log.info("migrate-lead-conversion: added lead.CUSTOMER_ID (+FK)")

            if "CUSTOMER_ASSIGNMENT_TYPE" not in cols:
                conn.execute(text(
                    "ALTER TABLE `lead` ADD COLUMN `CUSTOMER_ASSIGNMENT_TYPE` "
                    "ENUM('NEW','EXISTING') NULL"
                ))
                log.info("migrate-lead-conversion: added lead.CUSTOMER_ASSIGNMENT_TYPE")

            if "GST_NUMBER" not in cols:
                conn.execute(text("ALTER TABLE `lead` ADD COLUMN `GST_NUMBER` VARCHAR(50) NULL"))
                log.info("migrate-lead-conversion: added lead.GST_NUMBER")

    except Exception as exc:
        log.warning("migrate-lead-conversion-columns skipped: %s", exc)


_migrate_lead_conversion_columns()


def _migrate_cpa_revert_inline_quotation_columns():
    """One-time, idempotent corrective migration: an earlier iteration of
    the Lead-conversion quotation workflow briefly added quotation columns
    (QUOTATION_TYPE/QUOTATION_STATUS/QUOTED_PRICE/REVISION_REASON/
    ACTION_TOKEN/SENT_AT/RESPONDED_AT) directly onto `customer_project_assignment`
    and widened its LEAD_ID unique index to (LEAD_ID, QUOTATION_TYPE). The
    design moved to a dedicated child table instead (CustomerProjectQuotation,
    independently queryable/debuggable — see customer_models.py), so this
    reverts both changes if a DB still has them: drops the 7 columns and
    restores the original bare-unique index on LEAD_ID. No-ops cleanly on
    any DB that never had them (including a brand-new install)."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_assignment"):
            return

        cols = {c["name"] for c in insp.get_columns("customer_project_assignment")}
        stray_cols = [c for c in (
            "QUOTATION_TYPE", "QUOTATION_STATUS", "QUOTED_PRICE",
            "REVISION_REASON", "ACTION_TOKEN", "SENT_AT", "RESPONDED_AT",
        ) if c in cols]

        idx_names = {ix["name"] for ix in insp.get_indexes("customer_project_assignment")}

        if not stray_cols and "uq_cpa_lead_quotation_type" not in idx_names:
            return  # already clean (or never had the stray design)

        with engine.begin() as conn:
            if "uq_cpa_lead_quotation_type" in idx_names:
                conn.execute(text(
                    "ALTER TABLE `customer_project_assignment` "
                    "DROP INDEX `uq_cpa_lead_quotation_type`, "
                    "ADD UNIQUE KEY `ix_customer_project_assignment_LEAD_ID` (`LEAD_ID`)"
                ))
                log.info("migrate-cpa-revert: restored bare-unique index on LEAD_ID")

            for col in stray_cols:
                conn.execute(text(f"ALTER TABLE `customer_project_assignment` DROP COLUMN `{col}`"))
            if stray_cols:
                log.info("migrate-cpa-revert: dropped stray columns %s", stray_cols)

    except Exception as exc:
        log.warning("migrate-cpa-revert-inline-quotation-columns skipped: %s", exc)


_migrate_cpa_revert_inline_quotation_columns()


def _migrate_lead_status_enum_widen():
    """One-time, idempotent: widens `lead`.LEAD_STATUS's native MySQL ENUM
    to add the 6 quotation-workflow statuses (QUOTE_APPROVAL_PENDING,
    QUOTE_APPROVED, QUOTE_REJECTED, REVISED_QUOTE_APPROVAL_PENDING,
    REVISED_QUOTE_APPROVED, REVISED_QUOTE_REJECTED) alongside the original
    4 (NEW/VIEWED/CONVERTED/IGNORED). Purely additive — MODIFY COLUMN with
    a superset of the existing values never invalidates existing rows. A
    brand-new install never hits this — create_all() builds `lead` from
    today's model directly, already including all 10 values."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("lead"):
            return

        with engine.connect() as conn:
            column_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'LEAD_STATUS'"
            )).scalar()

        if column_type and "QUOTE_APPROVAL_PENDING" not in column_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `lead` MODIFY COLUMN `LEAD_STATUS` "
                    "ENUM('NEW','VIEWED','CONVERTED','IGNORED',"
                    "'QUOTE_APPROVAL_PENDING','QUOTE_APPROVED','QUOTE_REJECTED',"
                    "'REVISED_QUOTE_APPROVAL_PENDING','REVISED_QUOTE_APPROVED','REVISED_QUOTE_REJECTED') "
                    "NOT NULL DEFAULT 'NEW'"
                ))
            log.info("migrate-lead-status-enum: widened lead.LEAD_STATUS with 6 quotation statuses")

    except Exception as exc:
        log.warning("migrate-lead-status-enum-widen skipped: %s", exc)


_migrate_lead_status_enum_widen()


def _migrate_cpq_po_request_column():
    """One-time, idempotent: adds PO_REQUEST_SENT_AT to
    customer_project_quotation — the duplicate-send guard for the
    Purchase Order Request email (automatic-on-approval and manual send
    paths). Nullable, no backfill needed. A brand-new install never hits
    this — create_all() builds the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_quotation"):
            return

        cols = {c["name"] for c in insp.get_columns("customer_project_quotation")}

        if "PO_REQUEST_SENT_AT" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_quotation` ADD COLUMN `PO_REQUEST_SENT_AT` DATETIME NULL"
                ))
            log.info("migrate-cpq-po-request: added customer_project_quotation.PO_REQUEST_SENT_AT")

    except Exception as exc:
        log.warning("migrate-cpq-po-request-column skipped: %s", exc)


_migrate_cpq_po_request_column()


def _migrate_lead_status_enum_add_po_statuses():
    """One-time, idempotent: widens `lead`.LEAD_STATUS's native MySQL ENUM
    to add PO_REQUESTED / PO_RECEIVED (the Purchase Order upload sub-flow)
    alongside the existing 10 values. Purely additive — MODIFY COLUMN with
    a superset of the existing values never invalidates existing rows. A
    brand-new install never hits this — create_all() builds `lead` from
    today's model directly, already including all 12 values."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("lead"):
            return

        with engine.connect() as conn:
            column_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'LEAD_STATUS'"
            )).scalar()

        if column_type and "PO_REQUESTED" not in column_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `lead` MODIFY COLUMN `LEAD_STATUS` "
                    "ENUM('NEW','VIEWED','CONVERTED','IGNORED',"
                    "'QUOTE_APPROVAL_PENDING','QUOTE_APPROVED','QUOTE_REJECTED',"
                    "'REVISED_QUOTE_APPROVAL_PENDING','REVISED_QUOTE_APPROVED','REVISED_QUOTE_REJECTED',"
                    "'PO_REQUESTED','PO_RECEIVED') "
                    "NOT NULL DEFAULT 'NEW'"
                ))
            log.info("migrate-lead-status-enum: widened lead.LEAD_STATUS with PO_REQUESTED/PO_RECEIVED")

    except Exception as exc:
        log.warning("migrate-lead-status-enum-add-po-statuses skipped: %s", exc)


_migrate_lead_status_enum_add_po_statuses()


def _migrate_email_send_rule_event_enum_add_po_uploaded():
    """One-time, idempotent: widens `email_send_rule`.EVENT_TYPE's native
    MySQL ENUM to add PO_UPLOADED alongside the existing QUOTATION_DECISION
    value. Purely additive. A brand-new install never hits this —
    create_all() builds the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("email_send_rule"):
            return

        with engine.connect() as conn:
            column_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_send_rule' AND COLUMN_NAME = 'EVENT_TYPE'"
            )).scalar()

        if column_type and "PO_UPLOADED" not in column_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `email_send_rule` MODIFY COLUMN `EVENT_TYPE` "
                    "ENUM('QUOTATION_DECISION','PO_UPLOADED') NOT NULL"
                ))
            log.info("migrate-email-send-rule-event-enum: widened EVENT_TYPE with PO_UPLOADED")

    except Exception as exc:
        log.warning("migrate-email-send-rule-event-enum-add-po-uploaded skipped: %s", exc)


_migrate_email_send_rule_event_enum_add_po_uploaded()


def _migrate_email_send_rule_event_enum_add_po_requested():
    """One-time, idempotent: widens `email_send_rule`.EVENT_TYPE's native
    MySQL ENUM to add PO_REQUESTED alongside the existing QUOTATION_DECISION/
    PO_UPLOADED values. Purely additive. A brand-new install never hits
    this — create_all() builds the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("email_send_rule"):
            return

        with engine.connect() as conn:
            column_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_send_rule' AND COLUMN_NAME = 'EVENT_TYPE'"
            )).scalar()

        if column_type and "PO_REQUESTED" not in column_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `email_send_rule` MODIFY COLUMN `EVENT_TYPE` "
                    "ENUM('QUOTATION_DECISION','PO_UPLOADED','PO_REQUESTED') NOT NULL"
                ))
            log.info("migrate-email-send-rule-event-enum: widened EVENT_TYPE with PO_REQUESTED")

    except Exception as exc:
        log.warning("migrate-email-send-rule-event-enum-add-po-requested skipped: %s", exc)


_migrate_email_send_rule_event_enum_add_po_requested()


def _migrate_cpq_rejection_reason_column():
    """One-time, idempotent: adds REJECTION_REASON to
    customer_project_quotation — required by the API only when a quotation
    is rejected (never on approval). Nullable, no backfill needed. A
    brand-new install never hits this — create_all() builds the table from
    today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_quotation"):
            return

        cols = {c["name"] for c in insp.get_columns("customer_project_quotation")}

        if "REJECTION_REASON" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_quotation` ADD COLUMN `REJECTION_REASON` TEXT NULL"
                ))
            log.info("migrate-cpq-rejection-reason: added customer_project_quotation.REJECTION_REASON")

    except Exception as exc:
        log.warning("migrate-cpq-rejection-reason-column skipped: %s", exc)


_migrate_cpq_rejection_reason_column()


def _migrate_project_assignment_mode_column():
    """One-time, idempotent: adds ASSIGNMENT_MODE to `project` (PARALLEL/
    SEQUENTIAL, default PARALLEL) — a distinct, Project-level concept (the
    similarly-named CustomerProjectAssignment column has since been removed
    entirely — see _migrate_drop_cpa_assignment_mode() below), reusing the
    same enum name/values (see project_models.py's ASSIGNMENT_MODE_ENUM
    comment). The business logic driven by this field lands in a later
    phase; for now it is only stored. A brand-new install never hits this —
    create_all() builds the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("project"):
            return

        cols = {c["name"] for c in insp.get_columns("project")}

        if "ASSIGNMENT_MODE" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `project` ADD COLUMN `ASSIGNMENT_MODE` "
                    "ENUM('PARALLEL','SEQUENTIAL') NOT NULL DEFAULT 'PARALLEL'"
                ))
            log.info("migrate-project-assignment-mode: added project.ASSIGNMENT_MODE")

    except Exception as exc:
        log.warning("migrate-project-assignment-mode-column skipped: %s", exc)


_migrate_project_assignment_mode_column()


def _migrate_drop_cpa_assignment_mode():
    """One-time, idempotent: drops the no-longer-used ASSIGNMENT_MODE
    column from `customer_project_assignment` — confirmed (full-repo grep)
    to have zero route/service/serializer/frontend references; QUANTITY
    (see _migrate_add_cpa_quantity() below) replaces it under the new
    per-assignment quantity business logic. A brand-new install never hits
    this — create_all() builds the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_assignment"):
            return

        cols = {c["name"] for c in insp.get_columns("customer_project_assignment")}

        if "ASSIGNMENT_MODE" in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_assignment` DROP COLUMN `ASSIGNMENT_MODE`"
                ))
            log.info("migrate-drop-cpa-assignment-mode: dropped customer_project_assignment.ASSIGNMENT_MODE")

    except Exception as exc:
        log.warning("migrate-drop-cpa-assignment-mode skipped: %s", exc)


_migrate_drop_cpa_assignment_mode()


def _migrate_add_cpa_quantity():
    """One-time, idempotent: adds QUANTITY to `customer_project_assignment`
    (default 1 — today's implicit single-unit behavior, preserved for every
    existing row). Captured going forward at PO-upload time (see
    routes/po_actions.py) and multiplied into the accepted quotation price
    everywhere "total project value" is computed (see
    customer_payment_service.compute_payment_summary). A brand-new install
    never hits this — create_all() builds the table from today's model
    directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_assignment"):
            return

        cols = {c["name"] for c in insp.get_columns("customer_project_assignment")}

        if "QUANTITY" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_assignment` ADD COLUMN `QUANTITY` INT NOT NULL DEFAULT 1"
                ))
            log.info("migrate-add-cpa-quantity: added customer_project_assignment.QUANTITY")

    except Exception as exc:
        log.warning("migrate-add-cpa-quantity skipped: %s", exc)


_migrate_add_cpa_quantity()


def _migrate_cpp_payment_date_to_datetime():
    """One-time, idempotent: widens customer_project_payment.PAYMENT_DATE
    from DATE to DATETIME so the actual time of payment is captured, not
    just the day — MySQL preserves every existing value at midnight on its
    original date, which is what those rows already implicitly represented.
    Fixes a real display bug: formatDateTime() on the frontend always
    renders an hours:minutes component, and a date-only value was being
    parsed as UTC-midnight then converted to local time, producing a
    fabricated time of day. A brand-new install never hits this —
    create_all() builds the table from today's model (already DATETIME)
    directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_payment"):
            return

        with engine.connect() as conn:
            column_type = conn.execute(text(
                "SELECT DATA_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_project_payment' "
                "AND COLUMN_NAME = 'PAYMENT_DATE'"
            )).scalar()

        if column_type and column_type.lower() == "date":
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_payment` MODIFY COLUMN `PAYMENT_DATE` DATETIME NOT NULL"
                ))
            log.info("migrate-cpp-payment-date-to-datetime: widened customer_project_payment.PAYMENT_DATE to DATETIME")

    except Exception as exc:
        log.warning("migrate-cpp-payment-date-to-datetime skipped: %s", exc)


_migrate_cpp_payment_date_to_datetime()


def _migrate_add_task_template_task_scope():
    """One-time, idempotent: adds TASK_SCOPE to `task_template` (PROJECT/
    UNIT, default PROJECT — today's implicit single-instance-per-project
    behavior, preserved for every existing row). Metadata only for now —
    see project_models.py's TaskTemplate/TASK_SCOPE_ENUM comments. A
    brand-new install never hits this — create_all() builds the table
    from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("task_template"):
            return

        cols = {c["name"] for c in insp.get_columns("task_template")}

        if "TASK_SCOPE" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `task_template` ADD COLUMN `TASK_SCOPE` "
                    "ENUM('PROJECT','UNIT') NOT NULL DEFAULT 'PROJECT'"
                ))
            log.info("migrate-add-task-template-task-scope: added task_template.TASK_SCOPE")

    except Exception as exc:
        log.warning("migrate-add-task-template-task-scope skipped: %s", exc)


_migrate_add_task_template_task_scope()


def _migrate_add_task_template_execution_and_dependency():
    """One-time, idempotent: adds EXECUTION_GROUP_ID (nullable, indexed —
    NULL means "not grouped, runs independently", preserving today's
    behavior for every existing row) and DEPENDENCY_RULE (ALL/ANY, default
    ALL — moot until a task_template_dependency row exists) to
    `task_template`. The task_template_dependency table itself is a
    brand-new table, created by create_all() from the model directly — no
    hand-written DDL needed for it here."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("task_template"):
            return

        cols = {c["name"] for c in insp.get_columns("task_template")}

        if "EXECUTION_GROUP_ID" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `task_template` ADD COLUMN `EXECUTION_GROUP_ID` VARCHAR(36) NULL"
                ))
                conn.execute(text(
                    "ALTER TABLE `task_template` ADD INDEX `ix_task_template_execution_group_id` (`EXECUTION_GROUP_ID`)"
                ))
            log.info("migrate-add-task-template-execution-group: added task_template.EXECUTION_GROUP_ID")

        cols = {c["name"] for c in insp.get_columns("task_template")}
        if "DEPENDENCY_RULE" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `task_template` ADD COLUMN `DEPENDENCY_RULE` "
                    "ENUM('ALL','ANY') NOT NULL DEFAULT 'ALL'"
                ))
            log.info("migrate-add-task-template-dependency-rule: added task_template.DEPENDENCY_RULE")

    except Exception as exc:
        log.warning("migrate-add-task-template-execution-and-dependency skipped: %s", exc)


_migrate_add_task_template_execution_and_dependency()


def _migrate_add_task_template_task_group_id():
    """One-time, idempotent: adds TASK_GROUP_ID to `task_template`
    (nullable FK to task_group.ID, ON DELETE SET NULL) — the real-FK
    replacement for the old loose-string EXECUTION_GROUP_ID (dropped by
    _migrate_drop_task_template_execution_and_dependency_columns() below,
    only after _migrate_backfill_task_groups_from_execution_groups() has
    had a chance to preserve any existing grouping/dependency data). A
    brand-new install has no existing task_template rows to worry about;
    create_all() already built `task_group`/`task_group_dependency` from
    today's model before any _migrate_*() function runs."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("task_template") or not insp.has_table("task_group"):
            return

        cols = {c["name"] for c in insp.get_columns("task_template")}
        if "TASK_GROUP_ID" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `task_template` ADD COLUMN `TASK_GROUP_ID` VARCHAR(36) NULL, "
                    "ADD CONSTRAINT `fk_task_template_task_group` FOREIGN KEY (`TASK_GROUP_ID`) "
                    "REFERENCES `task_group` (`ID`) ON DELETE SET NULL"
                ))
            log.info("migrate-add-task-template-task-group-id: added task_template.TASK_GROUP_ID")

    except Exception as exc:
        log.warning("migrate-add-task-template-task-group-id skipped: %s", exc)


_migrate_add_task_template_task_group_id()


def _migrate_add_task_group_depends_on_task_template_id():
    """One-time, idempotent: adds DEPENDS_ON_TASK_TEMPLATE_ID to
    `task_group` (nullable FK to task_template.ID, ON DELETE SET NULL) —
    the single member-task trigger used only when DEPENDENCY_RULE == 'ONE'.
    No backfill needed: task_group currently has 0 rows in every
    environment this feature has shipped to."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("task_group") or not insp.has_table("task_template"):
            return

        cols = {c["name"] for c in insp.get_columns("task_group")}
        if "DEPENDS_ON_TASK_TEMPLATE_ID" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `task_group` ADD COLUMN `DEPENDS_ON_TASK_TEMPLATE_ID` VARCHAR(36) NULL, "
                    "ADD CONSTRAINT `fk_task_group_depends_on_task_template` FOREIGN KEY (`DEPENDS_ON_TASK_TEMPLATE_ID`) "
                    "REFERENCES `task_template` (`ID`) ON DELETE SET NULL"
                ))
            log.info("migrate-add-task-group-depends-on-task-template-id: added task_group.DEPENDS_ON_TASK_TEMPLATE_ID")

    except Exception as exc:
        log.warning("migrate-add-task-group-depends-on-task-template-id skipped: %s", exc)


_migrate_add_task_group_depends_on_task_template_id()


def _migrate_backfill_task_groups_from_execution_groups():
    """One-time, idempotent, best-effort: preserves any existing
    EXECUTION_GROUP_ID cohorts by converting them into new TaskGroup rows,
    before the old column is dropped below. Reads the legacy column via
    raw SQL because the TaskTemplate ORM model no longer declares it
    (matches the exact precedent/reasoning already used for the old
    DEPARTMENT_ID/ROLE_ID backfill above).

    Every distinct (PROJECT_ID, EXECUTION_GROUP_ID) cohort of tasks becomes
    one new TaskGroup (DEPENDENCY_RULE defaults to 'ALL' — the old
    DEPENDENCY_RULE column was a per-task field with different semantics
    than today's group-level rule, so it is not carried forward), with
    those tasks' TASK_GROUP_ID set to it.

    Old per-task `task_template_dependency` edges are NOT migrated here:
    that table modeled an arbitrary "depends on any task" edge, which the
    current TaskGroup.DEPENDS_ON_TASK_TEMPLATE_ID design deliberately
    restricts to "one of this same group's own members" — there is no
    general mapping from the old edge shape to the new one. The physical
    `task_template_dependency` table is left untouched (see the model's
    own NOTE comment) for manual review if any environment ever has real
    rows in it (confirmed 0 rows in every environment this has shipped to).

    Guarded by EXECUTION_GROUP_ID column existence, so re-running this
    (e.g. on every boot) after the column is dropped is an instant no-op.
    A brand-new install has no rows to migrate."""

    import logging
    from sqlalchemy import text, inspect
    from sqlalchemy.orm import sessionmaker
    from app.models.project_models import TaskGroup, TaskTemplate

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("task_template") or not insp.has_table("task_group"):
            return

        cols = {c["name"] for c in insp.get_columns("task_template")}
        if "EXECUTION_GROUP_ID" not in cols:
            return  # already dropped in a prior run — nothing left to read

        with engine.connect() as conn:
            grouped_rows = conn.execute(text(
                "SELECT ID, PROJECT_ID, VENDOR_ID, EXECUTION_GROUP_ID "
                "FROM `task_template` WHERE EXECUTION_GROUP_ID IS NOT NULL"
            )).fetchall()

        if not grouped_rows:
            return

        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            migrated_groups = 0

            # One TaskGroup per (PROJECT_ID, EXECUTION_GROUP_ID) cohort.
            cohorts: dict = {}
            for task_id, project_id, vendor_id, exec_group_id in grouped_rows:
                cohorts.setdefault((project_id, exec_group_id, vendor_id), []).append(task_id)

            for (project_id, _exec_group_id, vendor_id), member_ids in cohorts.items():
                group = TaskGroup(
                    PROJECT_ID=project_id,
                    VENDOR_ID=vendor_id,
                    NAME=None,
                    DEPENDENCY_RULE="ALL",
                    SEQUENCE_NUMBER=0,
                )
                db.add(group)
                db.flush()
                migrated_groups += 1
                for task_id in member_ids:
                    db.query(TaskTemplate).filter(TaskTemplate.ID == task_id).update(
                        {"TASK_GROUP_ID": group.ID}, synchronize_session=False
                    )

            if migrated_groups:
                db.commit()
                log.info("migrate-backfill-task-groups: created %d task group(s)", migrated_groups)
        finally:
            db.close()

    except Exception as exc:
        log.warning("migrate-backfill-task-groups-from-execution-groups skipped: %s", exc)


_migrate_backfill_task_groups_from_execution_groups()


def _migrate_drop_task_template_execution_and_dependency_columns():
    """One-time, idempotent: drops the now-superseded EXECUTION_GROUP_ID
    and DEPENDENCY_RULE columns from `task_template` — every value was
    copied forward into TaskGroup/TaskGroupDependency by
    _migrate_backfill_task_groups_from_execution_groups() above (which
    always runs first, in the same startup, immediately before this
    function is even defined). Neither column has a real FK constraint to
    unwind first (EXECUTION_GROUP_ID only had a plain secondary index,
    auto-dropped by MySQL along with the column). A brand-new install
    never creates these columns (the ORM model no longer declares them),
    so this is a no-op there."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("task_template"):
            return

        cols = {c["name"] for c in insp.get_columns("task_template")}

        for col_name in ("EXECUTION_GROUP_ID", "DEPENDENCY_RULE"):
            if col_name not in cols:
                continue
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE `task_template` DROP COLUMN `{col_name}`"))
            log.info("migrate-drop-task-template-execution-and-dependency: dropped task_template.%s", col_name)

    except Exception as exc:
        log.warning("migrate-drop-task-template-execution-and-dependency-columns skipped: %s", exc)


_migrate_drop_task_template_execution_and_dependency_columns()


def _migrate_add_company_master_working_schedule():
    """One-time, idempotent: adds WORK_START_TIME/WORK_END_TIME (nullable —
    NULL means no schedule configured yet), WORK_HOURS (server-computed
    only, defaults to 0.00), and WORKING_TIMEZONE (defaults to
    Asia/Kolkata) to `company_master`. The company_working_break table
    itself is brand-new — create_all() builds it from the model directly.
    Every existing company gets no schedule configured; the scheduler and
    project_template.py's _to_days() both explicitly fall back to the
    existing hardcoded 8-hour assumption whenever WORK_HOURS is 0, so no
    existing vendor's ESTIMATED_TOTAL_DAYS changes until they opt in."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("company_master"):
            return

        cols = {c["name"] for c in insp.get_columns("company_master")}

        if "WORK_START_TIME" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `company_master` ADD COLUMN `WORK_START_TIME` TIME NULL"
                ))
            log.info("migrate-add-company-master-working-schedule: added company_master.WORK_START_TIME")

        cols = {c["name"] for c in insp.get_columns("company_master")}
        if "WORK_END_TIME" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `company_master` ADD COLUMN `WORK_END_TIME` TIME NULL"
                ))
            log.info("migrate-add-company-master-working-schedule: added company_master.WORK_END_TIME")

        cols = {c["name"] for c in insp.get_columns("company_master")}
        if "WORK_HOURS" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `company_master` ADD COLUMN `WORK_HOURS` DECIMAL(5,2) NOT NULL DEFAULT 0.00"
                ))
            log.info("migrate-add-company-master-working-schedule: added company_master.WORK_HOURS")

        cols = {c["name"] for c in insp.get_columns("company_master")}
        if "WORKING_TIMEZONE" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `company_master` ADD COLUMN `WORKING_TIMEZONE` VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata'"
                ))
            log.info("migrate-add-company-master-working-schedule: added company_master.WORKING_TIMEZONE")

    except Exception as exc:
        log.warning("migrate-add-company-master-working-schedule skipped: %s", exc)


_migrate_add_company_master_working_schedule()


def _migrate_backfill_task_template_requirements():
    """One-time, idempotent: copies every existing task_template row's
    DEPARTMENT_ID/ROLE_ID into a new TaskTemplateRequirement row before
    those columns are dropped (see _migrate_drop_task_template_department_
    role() below) — no existing manpower assignment is lost. Only rows
    where at least one of DEPARTMENT_ID/ROLE_ID is set are migrated (a
    template with neither had no defined manpower need, so no placeholder
    requirement is invented for it). EXPERIENCE_LEVEL is set to
    INTERMEDIATE as a neutral default since the old schema never captured
    experience level. Guarded by TASK_TEMPLATE_ID existence so re-running
    this (e.g. on every boot) never creates duplicates. Reads the old
    columns via raw SQL because the TaskTemplate ORM model no longer
    declares them (they may already be gone by the time this runs again).
    A brand-new install has no task_template rows with these columns at
    all, so this is a no-op there."""

    import logging
    from sqlalchemy import text, inspect
    from sqlalchemy.orm import sessionmaker
    from app.models.project_models import TaskTemplateRequirement

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("task_template") or not insp.has_table("task_template_requirement"):
            return

        cols = {c["name"] for c in insp.get_columns("task_template")}
        if "DEPARTMENT_ID" not in cols and "ROLE_ID" not in cols:
            return  # already dropped in a prior run — nothing left to read

        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT ID, DEPARTMENT_ID, ROLE_ID FROM `task_template` "
                "WHERE DEPARTMENT_ID IS NOT NULL OR ROLE_ID IS NOT NULL"
            )).fetchall()

        if not rows:
            return

        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            migrated = 0
            for task_id, dept_id, role_id in rows:
                exists = db.query(TaskTemplateRequirement.ID).filter(
                    TaskTemplateRequirement.TASK_TEMPLATE_ID == task_id
                ).first()
                if exists:
                    continue
                db.add(TaskTemplateRequirement(
                    TASK_TEMPLATE_ID=task_id,
                    DEPARTMENT_ID=dept_id,
                    ROLE_ID=role_id,
                    EXPERIENCE_LEVEL="INTERMEDIATE",
                    REQUIRED_COUNT=1,
                ))
                migrated += 1
            if migrated:
                db.commit()
                log.info("migrate-backfill-task-template-requirements: migrated %d task template(s)", migrated)
        finally:
            db.close()

    except Exception as exc:
        log.warning("migrate-backfill-task-template-requirements skipped: %s", exc)


_migrate_backfill_task_template_requirements()


def _migrate_drop_task_template_department_role():
    """One-time, idempotent: drops the now-unused DEPARTMENT_ID/ROLE_ID
    columns from `task_template` — every value was copied forward into
    TaskTemplateRequirement by _migrate_backfill_task_template_requirements()
    above (which always runs first, in the same startup, immediately before
    this function is even defined). MySQL requires dropping a column's FK
    constraint before the column itself, hence the dynamic
    information_schema lookup (same idiom as
    _migrate_drop_legacy_project_and_fks()). A brand-new install never
    creates these columns (the ORM model no longer declares them), so this
    is a no-op there."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    FK_DROPS = [
        ("task_template", "DEPARTMENT_ID"),
        ("task_template", "ROLE_ID"),
    ]

    try:
        insp = inspect(engine)

        for table_name, col_name in FK_DROPS:
            if not insp.has_table(table_name):
                continue
            cols = {c["name"] for c in insp.get_columns(table_name)}
            if col_name not in cols:
                continue
            with engine.begin() as conn:
                fk_rows = conn.execute(text(
                    "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE "
                    "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                    "AND COLUMN_NAME = :c AND REFERENCED_TABLE_NAME IS NOT NULL"
                ), {"t": table_name, "c": col_name}).fetchall()
                for (fk_name,) in fk_rows:
                    try:
                        conn.execute(text(f"ALTER TABLE `{table_name}` DROP FOREIGN KEY `{fk_name}`"))
                    except Exception as exc_inner:
                        log.warning("migrate-drop-task-template-dept-role: could not drop FK %s.%s: %s", table_name, fk_name, exc_inner)
                try:
                    conn.execute(text(f"ALTER TABLE `{table_name}` DROP COLUMN `{col_name}`"))
                    log.info("migrate-drop-task-template-dept-role: dropped %s.%s", table_name, col_name)
                except Exception as exc_inner:
                    log.warning("migrate-drop-task-template-dept-role: could not drop %s.%s: %s", table_name, col_name, exc_inner)

    except Exception as exc:
        log.warning("migrate-drop-task-template-dept-role skipped: %s", exc)


_migrate_drop_task_template_department_role()


def _migrate_add_cpa_hold_status_and_completion():
    """One-time, idempotent: widens customer_project_assignment.STATUS's
    native MySQL ENUM to add HOLD (set/cleared automatically by
    payment_milestone_service.evaluate_milestones_for_assignment(), never
    by hand), and adds PROJECT_COMPLETION_PERCENTAGE (staff-maintained —
    see that column's model comment for why no automatic task-based
    rollup exists yet). A brand-new install never hits either branch —
    create_all() builds the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_assignment"):
            return

        with engine.connect() as conn:
            column_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customer_project_assignment' AND COLUMN_NAME = 'STATUS'"
            )).scalar()

        if column_type and "HOLD" not in column_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_assignment` MODIFY COLUMN `STATUS` "
                    "ENUM('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED','HOLD') NOT NULL"
                ))
            log.info("migrate-add-cpa-hold-status: widened customer_project_assignment.STATUS with HOLD")

        cols = {c["name"] for c in insp.get_columns("customer_project_assignment")}
        if "PROJECT_COMPLETION_PERCENTAGE" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_assignment` ADD COLUMN "
                    "`PROJECT_COMPLETION_PERCENTAGE` DECIMAL(5,2) NOT NULL DEFAULT 0"
                ))
            log.info("migrate-add-cpa-hold-status: added customer_project_assignment.PROJECT_COMPLETION_PERCENTAGE")

    except Exception as exc:
        log.warning("migrate-add-cpa-hold-status-and-completion skipped: %s", exc)


_migrate_add_cpa_hold_status_and_completion()


def _migrate_add_cpp_milestone_id():
    """One-time, idempotent: adds MILESTONE_ID to `customer_project_payment`
    (nullable FK to payment_milestone.ID, ON DELETE SET NULL) — best-effort
    attribution of which Payment Milestone a payment satisfied (see
    payment_milestone_service._attribute_latest_payment()). No backfill:
    existing payments predate this feature and correctly have no milestone
    attribution. A brand-new install never hits this — create_all() builds
    the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_payment") or not insp.has_table("payment_milestone"):
            return

        cols = {c["name"] for c in insp.get_columns("customer_project_payment")}
        if "MILESTONE_ID" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `customer_project_payment` ADD COLUMN `MILESTONE_ID` VARCHAR(36) NULL, "
                    "ADD CONSTRAINT `fk_cpp_milestone` FOREIGN KEY (`MILESTONE_ID`) "
                    "REFERENCES `payment_milestone` (`ID`) ON DELETE SET NULL"
                ))
            log.info("migrate-add-cpp-milestone-id: added customer_project_payment.MILESTONE_ID")

    except Exception as exc:
        log.warning("migrate-add-cpp-milestone-id skipped: %s", exc)


_migrate_add_cpp_milestone_id()


def _migrate_seed_payment_milestones_from_legacy():
    """One-time, best-effort: safely migrates any existing per-Project
    milestone configuration (the old project_payment_milestone table,
    ProjectPaymentMilestone model — now removed from the ORM, see
    project_models.py's note) into the new vendor-level `payment_milestone`
    table, WITHOUT ever merging or discarding conflicting production data.

    For each vendor: if every one of its projects that had milestones used
    the EXACT SAME configuration (same set of name/order/required-percentage
    tuples), that one shared configuration is migrated — PROJECT_COMPLETION_
    TRIGGER_PERCENTAGE (a concept the old schema never captured) defaults to
    0 on every migrated row and is logged clearly as needing admin review.
    If a vendor's projects had DIFFERING configurations, nothing is migrated
    for that vendor at all — a warning lists the conflicting projects so an
    admin can review the untouched old data and configure the new table by
    hand. Idempotent: any vendor that already has payment_milestone rows
    (a prior run, or manual configuration) is left completely alone.

    The old `project_payment_milestone` table and its data are deliberately
    NEVER dropped or modified by this migration — see project_models.py's
    note on ProjectPaymentMilestone's removal."""

    import logging
    from sqlalchemy import text, inspect
    from sqlalchemy.orm import sessionmaker
    from app.models.project_milestone_models import PaymentMilestone

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("project_payment_milestone") or not insp.has_table("payment_milestone"):
            return

        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT p.VENDOR_ID, ppm.PROJECT_ID, p.NAME AS PROJECT_NAME, "
                "ppm.MILESTONE_NAME, ppm.MILESTONE_ORDER, ppm.REQUIRED_PAYMENT_PERCENTAGE "
                "FROM `project_payment_milestone` ppm "
                "JOIN `project` p ON p.ID = ppm.PROJECT_ID"
            )).fetchall()

        if not rows:
            return

        # Group by vendor -> project -> sorted signature tuple
        by_vendor: dict = {}
        for vendor_id, project_id, project_name, m_name, m_order, m_pct in rows:
            by_vendor.setdefault(vendor_id, {}).setdefault(
                project_id, {"name": project_name, "items": []}
            )["items"].append((m_name, m_order, f"{float(m_pct):.2f}"))

        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            migrated_vendors = 0
            for vendor_id, projects in by_vendor.items():
                already_configured = db.query(PaymentMilestone.ID).filter(
                    PaymentMilestone.VENDOR_ID == vendor_id
                ).first()
                if already_configured:
                    continue  # never overwrite a prior run or manual configuration

                signatures = {
                    tuple(sorted(proj["items"])): proj["name"] for proj in projects.values()
                }
                if len(signatures) > 1:
                    conflict_list = ", ".join(f'"{name}"' for name in
                                               {p["name"] for p in projects.values()})
                    log.warning(
                        "migrate-seed-payment-milestones: vendor %s has %d differing legacy milestone "
                        "configurations across projects (%s) — nothing migrated automatically; the old "
                        "project_payment_milestone data is preserved untouched for manual review.",
                        vendor_id, len(signatures), conflict_list,
                    )
                    continue

                # Exactly one distinct configuration — safe to migrate.
                one_signature = next(iter(signatures))
                for m_name, m_order, m_pct in one_signature:
                    db.add(PaymentMilestone(
                        VENDOR_ID=vendor_id,
                        MILESTONE_NAME=m_name,
                        MILESTONE_ORDER=m_order,
                        PROJECT_COMPLETION_TRIGGER_PERCENTAGE=0,
                        REQUIRED_PAYMENT_PERCENTAGE=m_pct,
                    ))
                migrated_vendors += 1
                log.info(
                    "migrate-seed-payment-milestones: migrated %d milestone(s) for vendor %s from legacy "
                    "per-project configuration — PROJECT_COMPLETION_TRIGGER_PERCENTAGE defaulted to 0 on "
                    "every row and needs admin review (the old schema never captured this value).",
                    len(one_signature), vendor_id,
                )

            if migrated_vendors:
                db.commit()
        finally:
            db.close()

    except Exception as exc:
        log.warning("migrate-seed-payment-milestones-from-legacy skipped: %s", exc)


_migrate_seed_payment_milestones_from_legacy()


def _migrate_add_customer_project_task_scheduling_columns():
    """One-time, idempotent: adds the scheduling-related nullable columns
    used by the automatic production scheduling / task assignment engine
    (app/services/production_scheduling_service.py,
    task_generation_service.py, production_reminder_scheduler.py) to the
    `customer_project_task` table — PROJECT_UNIT_NUMBER, ASSIGNED_DATE,
    PLANNED_START_DATE, ACTUAL_START_DATE, DAY_BEFORE_REMINDER_SENT_AT,
    START_DATE_REMINDER_SENT_AT. Purely additive/nullable — no backfill
    needed, existing rows simply have these as NULL. A brand-new install
    never hits this — create_all() builds the table from today's model
    directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    NEW_COLUMNS = [
        ("PROJECT_UNIT_NUMBER", "INT NULL"),
        ("ASSIGNED_DATE", "DATETIME NULL"),
        ("PLANNED_START_DATE", "DATETIME NULL"),
        ("ACTUAL_START_DATE", "DATETIME NULL"),
        ("DAY_BEFORE_REMINDER_SENT_AT", "DATETIME NULL"),
        ("START_DATE_REMINDER_SENT_AT", "DATETIME NULL"),
    ]

    try:
        insp = inspect(engine)
        if not insp.has_table("customer_project_task"):
            return

        for col_name, col_ddl in NEW_COLUMNS:
            cols = {c["name"] for c in insp.get_columns("customer_project_task")}
            if col_name not in cols:
                with engine.begin() as conn:
                    conn.execute(text(
                        f"ALTER TABLE `customer_project_task` ADD COLUMN `{col_name}` {col_ddl}"
                    ))
                log.info("migrate-add-customer-project-task-scheduling-columns: added customer_project_task.%s", col_name)

    except Exception as exc:
        log.warning("migrate-add-customer-project-task-scheduling-columns skipped: %s", exc)


_migrate_add_customer_project_task_scheduling_columns()


def _migrate_email_send_rule_event_enum_add_production_schedule_approval():
    """One-time, idempotent: widens `email_send_rule`.EVENT_TYPE's native
    MySQL ENUM to add PRODUCTION_SCHEDULE_APPROVAL_NEEDED alongside the
    existing QUOTATION_DECISION/PO_UPLOADED/PO_REQUESTED values. Purely
    additive. A brand-new install never hits this — create_all() builds
    the table from today's model directly."""

    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("email_send_rule"):
            return

        with engine.connect() as conn:
            column_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_send_rule' AND COLUMN_NAME = 'EVENT_TYPE'"
            )).scalar()

        if column_type and "PRODUCTION_SCHEDULE_APPROVAL_NEEDED" not in column_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `email_send_rule` MODIFY COLUMN `EVENT_TYPE` "
                    "ENUM('QUOTATION_DECISION','PO_UPLOADED','PO_REQUESTED','PRODUCTION_SCHEDULE_APPROVAL_NEEDED') NOT NULL"
                ))
            log.info("migrate-email-send-rule-event-enum: widened EVENT_TYPE with PRODUCTION_SCHEDULE_APPROVAL_NEEDED")

    except Exception as exc:
        log.warning("migrate-email-send-rule-event-enum-add-production-schedule-approval skipped: %s", exc)


_migrate_email_send_rule_event_enum_add_production_schedule_approval()


# =========================================================================
# Inventory consolidation migration sequence.
#
# Two inventory systems used to exist side by side: a legacy `Inventory`
# model (MATERIAL_NAME/QUANTITY/UNIT_PRICE/MIN_STOCK, keyed by PRODUCT_ID+
# VENDOR_ID) that real GRN receiving actually wrote to, and a newer
# InventoryCategory -> ProductMaster -> InventoryItem -> InventoryStock/
# Batch/Movement system that was never wired to real procurement at all.
# This sequence consolidates everything onto the newer system, now keyed
# directly by PRODUCT_ID (InventoryItem's location dimension is dropped).
#
# Runs in strict order every boot, each step idempotent and independently
# guarded by schema introspection — see each function's own docstring.
# =========================================================================

def _drop_fk_on_column_if_exists(insp, table: str, column: str) -> None:
    """MySQL refuses to DROP COLUMN on a column that still backs a
    foreign key constraint — the constraint must be dropped first. FK
    names are MySQL-auto-generated (e.g. inventory_stock_ibfk_2) and can
    vary by environment/creation order, so this looks the actual
    constraint up by its constrained column rather than hardcoding a
    name."""
    from sqlalchemy import text
    for fk in insp.get_foreign_keys(table):
        if fk.get("constrained_columns") == [column] and fk.get("name"):
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE `{table}` DROP FOREIGN KEY `{fk['name']}`"))


def _migrate_inventory_add_product_id_columns():
    """Step 1 (additive, zero risk): adds a nullable PRODUCT_ID column to
    inventory_stock/inventory_movement/inventory_batch (backfilled in the
    next step, made NOT NULL + FK'd once backfilled), plus the new
    columns the simplified schema needs: MIN_QTY/MAX_QTY on
    inventory_stock (replacing InventoryItem.REORDER_LEVEL/MAX_STOCK),
    and RECEIVED_DATE/DC_FILE_URL/INVOICE_FILE_URL/CREATED_BY on
    inventory_batch. Every operation is independently guarded so one
    failure never blocks the others."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")
    insp = inspect(engine)

    additions = [
        ("inventory_stock", "PRODUCT_ID", "VARCHAR(36) NULL"),
        ("inventory_stock", "MIN_QTY", "FLOAT NULL DEFAULT 0"),
        ("inventory_stock", "MAX_QTY", "FLOAT NULL"),
        ("inventory_movement", "PRODUCT_ID", "VARCHAR(36) NULL"),
        ("inventory_batch", "PRODUCT_ID", "VARCHAR(36) NULL"),
        ("inventory_batch", "RECEIVED_DATE", "DATE NULL"),
        ("inventory_batch", "DC_FILE_URL", "VARCHAR(500) NULL"),
        ("inventory_batch", "INVOICE_FILE_URL", "VARCHAR(500) NULL"),
        ("inventory_batch", "CREATED_BY", "VARCHAR(36) NULL"),
    ]

    for table, column, ddl in additions:
        try:
            if not insp.has_table(table):
                continue
            cols = {c["name"] for c in insp.get_columns(table)}
            if column in cols:
                continue
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {ddl}"))
            log.info("migrate-inventory-add-product-id-columns: added %s.%s", table, column)
        except Exception as exc:
            log.warning("migrate-inventory-add-product-id-columns: %s.%s skipped: %s", table, column, exc)


_migrate_inventory_add_product_id_columns()


def _migrate_backfill_inventory_product_id():
    """Step 2: populates the new PRODUCT_ID column on inventory_movement/
    inventory_batch/inventory_stock from the (still-present)
    inventory_item table's own PRODUCT_ID, via a raw-SQL UPDATE...JOIN —
    the ORM no longer declares InventoryItem, so this reads the physical
    table directly, same precedent as _migrate_backfill_task_groups_
    from_execution_groups()'s EXECUTION_GROUP_ID read.

    inventory_movement/inventory_batch are 1:1 (each row keeps its own
    identity, just gains a PRODUCT_ID). inventory_stock is potentially
    N:1 (the old model allowed multiple InventoryItem locations per
    product) — after the join-update, any (VENDOR_ID, PRODUCT_ID)
    duplicates are collapsed: the row with the highest CURRENT_QTY
    survives, its CURRENT_QTY becomes the SUM across the group (no stock
    is lost), the other rows are deleted. Guarded by inventory_item still
    existing AND unbackfilled rows remaining, so this is a no-op on every
    boot after the first successful run."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("inventory_item"):
            return

        for table in ("inventory_movement", "inventory_batch"):
            if not insp.has_table(table):
                continue
            cols = {c["name"] for c in insp.get_columns(table)}
            if "PRODUCT_ID" not in cols or "INVENTORY_ITEM_ID" not in cols:
                continue  # already finalized (INVENTORY_ITEM_ID dropped) — nothing left to backfill
            with engine.begin() as conn:
                result = conn.execute(text(
                    f"UPDATE `{table}` t JOIN `inventory_item` i ON t.INVENTORY_ITEM_ID = i.ID "
                    f"SET t.PRODUCT_ID = i.PRODUCT_ID WHERE t.PRODUCT_ID IS NULL"
                ))
            if result.rowcount:
                log.info("migrate-backfill-inventory-product-id: backfilled %d row(s) in %s", result.rowcount, table)

        stock_cols = {c["name"] for c in insp.get_columns("inventory_stock")} if insp.has_table("inventory_stock") else set()
        if insp.has_table("inventory_stock") and "PRODUCT_ID" in stock_cols and "INVENTORY_ITEM_ID" in stock_cols:
            with engine.begin() as conn:
                result = conn.execute(text(
                    "UPDATE `inventory_stock` t JOIN `inventory_item` i ON t.INVENTORY_ITEM_ID = i.ID "
                    "SET t.PRODUCT_ID = i.PRODUCT_ID WHERE t.PRODUCT_ID IS NULL"
                ))
            if result.rowcount:
                log.info("migrate-backfill-inventory-product-id: backfilled %d row(s) in inventory_stock", result.rowcount)

            # Collapse any (VENDOR_ID, PRODUCT_ID) duplicates created by
            # multiple InventoryItem locations for the same product.
            with engine.connect() as conn:
                dupes = conn.execute(text(
                    "SELECT VENDOR_ID, PRODUCT_ID, COUNT(*) AS cnt FROM `inventory_stock` "
                    "WHERE PRODUCT_ID IS NOT NULL GROUP BY VENDOR_ID, PRODUCT_ID HAVING COUNT(*) > 1"
                )).fetchall()

            if dupes:
                log.info("migrate-backfill-inventory-product-id: found %d duplicate (vendor,product) stock group(s) to collapse", len(dupes))
                for vendor_id, product_id, _cnt in dupes:
                    with engine.connect() as conn:
                        rows = conn.execute(text(
                            "SELECT ID, CURRENT_QTY FROM `inventory_stock` "
                            "WHERE VENDOR_ID = :v AND PRODUCT_ID = :p ORDER BY CURRENT_QTY DESC"
                        ), {"v": vendor_id, "p": product_id}).fetchall()
                    if not rows:
                        continue
                    survivor_id = rows[0][0]
                    total_qty = sum(float(r[1] or 0) for r in rows)
                    loser_ids = [r[0] for r in rows[1:]]
                    with engine.begin() as conn:
                        conn.execute(text(
                            "UPDATE `inventory_stock` SET CURRENT_QTY = :q WHERE ID = :id"
                        ), {"q": total_qty, "id": survivor_id})
                        if loser_ids:
                            conn.execute(
                                text("DELETE FROM `inventory_stock` WHERE ID IN :ids").bindparams(
                                    __import__("sqlalchemy").bindparam("ids", expanding=True)
                                ),
                                {"ids": loser_ids},
                            )
                    log.info(
                        "migrate-backfill-inventory-product-id: collapsed %d duplicate stock row(s) for vendor=%s product=%s into %s (total qty=%s)",
                        len(loser_ids), vendor_id, product_id, survivor_id, total_qty,
                    )

    except Exception as exc:
        log.warning("migrate-backfill-inventory-product-id skipped: %s", exc)


_migrate_backfill_inventory_product_id()


def _migrate_backfill_inventory_stock_from_legacy():
    """Step 3: merges the legacy `inventory` model's rows (real GRN
    receiving wrote here until this migration) into the new PRODUCT_ID-
    keyed `inventory_stock`. For each legacy row (resolving PRODUCT_ID by
    name-match against ProductMaster.PRODUCT_NAME when the legacy row's
    own PRODUCT_ID is NULL, same fallback create_material() already
    used): if no inventory_stock row exists yet for that (VENDOR_ID,
    PRODUCT_ID), insert one (CURRENT_QTY/MIN_QTY from the legacy row,
    MAX_QTY left NULL — the legacy model never had a ceiling concept, so
    inventing one risks a false OVERSTOCK alert). If one already exists
    (independently seeded by the newer, previously-disconnected system),
    merge via max() on both CURRENT_QTY and MIN_QTY — never sum, since
    this migration re-runs every boot and sum would double-count on
    every restart while max() converges and stays stable. Every legacy
    row is left in place afterward (this only ever inserts/updates
    inventory_stock — it does not delete or modify the legacy `inventory`
    table), so this is safe to re-run indefinitely."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("inventory") or not insp.has_table("inventory_stock"):
            return
        if "PRODUCT_ID" not in {c["name"] for c in insp.get_columns("inventory_stock")}:
            return

        with engine.connect() as conn:
            legacy_rows = conn.execute(text(
                "SELECT l.ID, l.VENDOR_ID, l.PRODUCT_ID, l.MATERIAL_NAME, l.QUANTITY, l.MIN_STOCK, p.ID AS resolved_product_id "
                "FROM `inventory` l "
                "LEFT JOIN `product_master` p "
                "  ON p.VENDOR_ID = l.VENDOR_ID AND p.PRODUCT_NAME = l.MATERIAL_NAME"
            )).fetchall()

        if not legacy_rows:
            return

        inserted = merged = skipped = 0

        for row in legacy_rows:
            _id, vendor_id, product_id, material_name, quantity, min_stock, resolved_product_id = row
            product_id = product_id or resolved_product_id
            if not product_id or vendor_id is None:
                skipped += 1
                log.info(
                    "migrate-backfill-inventory-stock-from-legacy: could not resolve product for "
                    "legacy inventory.ID=%s (MATERIAL_NAME=%r) — skipped", _id, material_name,
                )
                continue

            quantity = float(quantity or 0)
            min_stock = float(min_stock or 0)

            with engine.connect() as conn:
                existing = conn.execute(text(
                    "SELECT ID, CURRENT_QTY, MIN_QTY FROM `inventory_stock` WHERE VENDOR_ID = :v AND PRODUCT_ID = :p"
                ), {"v": vendor_id, "p": product_id}).fetchone()

            if existing:
                stock_id, cur_qty, cur_min = existing
                new_qty = max(float(cur_qty or 0), quantity)
                new_min = max(float(cur_min or 0), min_stock)
                with engine.begin() as conn:
                    conn.execute(text(
                        "UPDATE `inventory_stock` SET CURRENT_QTY = :q, MIN_QTY = :m WHERE ID = :id"
                    ), {"q": new_qty, "m": new_min, "id": stock_id})
                merged += 1
            else:
                from app.services.inventory_automation_service import _compute_status
                status = _compute_status(quantity, min_stock, None)
                with engine.begin() as conn:
                    conn.execute(text(
                        "INSERT INTO `inventory_stock` (ID, VENDOR_ID, PRODUCT_ID, MIN_QTY, MAX_QTY, CURRENT_QTY, STATUS, UPDATED_AT) "
                        "VALUES (:id, :v, :p, :minq, NULL, :curq, :status, NOW())"
                    ), {
                        "id": __import__("uuid").uuid4().hex,
                        "v": vendor_id, "p": product_id, "minq": min_stock, "curq": quantity, "status": status,
                    })
                inserted += 1

        log.info(
            "migrate-backfill-inventory-stock-from-legacy: %d inserted, %d merged, %d skipped (of %d legacy rows)",
            inserted, merged, skipped, len(legacy_rows),
        )

    except Exception as exc:
        log.warning("migrate-backfill-inventory-stock-from-legacy skipped: %s", exc)


_migrate_backfill_inventory_stock_from_legacy()


def _migrate_inventory_stock_finalize_schema():
    """Step 4: drops the now-superseded INVENTORY_ITEM_ID column/
    constraint from inventory_stock, makes PRODUCT_ID mandatory, and adds
    the new (VENDOR_ID, PRODUCT_ID) unique constraint + FK. Each
    operation is independently guarded/try-wrapped so a leftover
    duplicate (if the collapse in step 2 somehow missed one) only blocks
    that one ALTER — logged for manual review — not the whole sequence."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")
    insp = inspect(engine)

    if not insp.has_table("inventory_stock"):
        return

    try:
        constraints = {c["name"] for c in insp.get_unique_constraints("inventory_stock")}
        if "uq_inv_stock_item" in constraints:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE `inventory_stock` DROP INDEX `uq_inv_stock_item`"))
            log.info("migrate-inventory-stock-finalize-schema: dropped uq_inv_stock_item")
    except Exception as exc:
        log.warning("migrate-inventory-stock-finalize-schema: drop uq_inv_stock_item skipped: %s", exc)

    for col in ("INVENTORY_ITEM_ID", "RESERVED_QTY", "AVAILABLE_QTY", "UNIT_COST", "LAST_MOVEMENT_AT"):
        try:
            cols = {c["name"] for c in insp.get_columns("inventory_stock")}
            if col not in cols:
                continue
            _drop_fk_on_column_if_exists(insp, "inventory_stock", col)
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE `inventory_stock` DROP COLUMN `{col}`"))
            log.info("migrate-inventory-stock-finalize-schema: dropped inventory_stock.%s", col)
        except Exception as exc:
            log.warning("migrate-inventory-stock-finalize-schema: drop %s skipped: %s", col, exc)

    try:
        cols = {c["name"] for c in insp.get_columns("inventory_stock")}
        if "PRODUCT_ID" in cols:
            with engine.connect() as conn:
                remaining_null = conn.execute(text(
                    "SELECT COUNT(*) FROM `inventory_stock` WHERE PRODUCT_ID IS NULL"
                )).scalar()
            if remaining_null:
                log.warning(
                    "migrate-inventory-stock-finalize-schema: %d row(s) still have NULL PRODUCT_ID "
                    "(unresolvable legacy data) — leaving PRODUCT_ID nullable until resolved manually",
                    remaining_null,
                )
            else:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE `inventory_stock` MODIFY COLUMN `PRODUCT_ID` VARCHAR(36) NOT NULL"))
                log.info("migrate-inventory-stock-finalize-schema: PRODUCT_ID is now NOT NULL")
    except Exception as exc:
        log.warning("migrate-inventory-stock-finalize-schema: modify PRODUCT_ID NOT NULL skipped: %s", exc)

    try:
        constraints = {c["name"] for c in insp.get_unique_constraints("inventory_stock")}
        if "uq_inv_stock_vendor_product" not in constraints:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `inventory_stock` ADD CONSTRAINT `uq_inv_stock_vendor_product` "
                    "UNIQUE (`VENDOR_ID`, `PRODUCT_ID`)"
                ))
            log.info("migrate-inventory-stock-finalize-schema: added uq_inv_stock_vendor_product")
    except Exception as exc:
        log.warning("migrate-inventory-stock-finalize-schema: add unique constraint skipped: %s", exc)

    try:
        fks = {fk["name"] for fk in insp.get_foreign_keys("inventory_stock") if fk["name"]}
        has_product_fk = any(fk.get("constrained_columns") == ["PRODUCT_ID"] for fk in insp.get_foreign_keys("inventory_stock"))
        if not has_product_fk:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `inventory_stock` ADD CONSTRAINT `fk_inv_stock_product` "
                    "FOREIGN KEY (`PRODUCT_ID`) REFERENCES `product_master`(`ID`)"
                ))
            log.info("migrate-inventory-stock-finalize-schema: added PRODUCT_ID foreign key")
    except Exception as exc:
        log.warning("migrate-inventory-stock-finalize-schema: add FK skipped: %s", exc)


_migrate_inventory_stock_finalize_schema()


def _migrate_inventory_movement_finalize_schema():
    """Step 5a: same finalize pattern as inventory_stock, for
    inventory_movement — drop INVENTORY_ITEM_ID + its old index, add the
    new PRODUCT_ID-based composite index, make PRODUCT_ID mandatory + FK.
    inventory_movement is an append-only ledger — every existing row's ID
    is preserved throughout (only columns change, never rows)."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")
    insp = inspect(engine)

    if not insp.has_table("inventory_movement"):
        return

    try:
        indexes = {i["name"] for i in insp.get_indexes("inventory_movement")}
        if "ix_inv_mov_item_date" in indexes:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE `inventory_movement` DROP INDEX `ix_inv_mov_item_date`"))
            log.info("migrate-inventory-movement-finalize-schema: dropped ix_inv_mov_item_date")
    except Exception as exc:
        log.warning("migrate-inventory-movement-finalize-schema: drop old index skipped: %s", exc)

    try:
        cols = {c["name"] for c in insp.get_columns("inventory_movement")}
        if "INVENTORY_ITEM_ID" in cols:
            _drop_fk_on_column_if_exists(insp, "inventory_movement", "INVENTORY_ITEM_ID")
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE `inventory_movement` DROP COLUMN `INVENTORY_ITEM_ID`"))
            log.info("migrate-inventory-movement-finalize-schema: dropped INVENTORY_ITEM_ID")
    except Exception as exc:
        log.warning("migrate-inventory-movement-finalize-schema: drop INVENTORY_ITEM_ID skipped: %s", exc)

    try:
        cols = {c["name"] for c in insp.get_columns("inventory_movement")}
        if "PRODUCT_ID" in cols:
            with engine.connect() as conn:
                remaining_null = conn.execute(text(
                    "SELECT COUNT(*) FROM `inventory_movement` WHERE PRODUCT_ID IS NULL"
                )).scalar()
            if not remaining_null:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE `inventory_movement` MODIFY COLUMN `PRODUCT_ID` VARCHAR(36) NOT NULL"))
                log.info("migrate-inventory-movement-finalize-schema: PRODUCT_ID is now NOT NULL")
            else:
                log.warning(
                    "migrate-inventory-movement-finalize-schema: %d row(s) still have NULL PRODUCT_ID — leaving nullable",
                    remaining_null,
                )
    except Exception as exc:
        log.warning("migrate-inventory-movement-finalize-schema: modify PRODUCT_ID NOT NULL skipped: %s", exc)

    try:
        indexes = {i["name"] for i in insp.get_indexes("inventory_movement")}
        if "ix_inv_mov_product_date" not in indexes:
            with engine.begin() as conn:
                conn.execute(text(
                    "CREATE INDEX `ix_inv_mov_product_date` ON `inventory_movement` (`VENDOR_ID`, `PRODUCT_ID`, `CREATED_AT`)"
                ))
            log.info("migrate-inventory-movement-finalize-schema: added ix_inv_mov_product_date")
    except Exception as exc:
        log.warning("migrate-inventory-movement-finalize-schema: add new index skipped: %s", exc)

    try:
        has_product_fk = any(fk.get("constrained_columns") == ["PRODUCT_ID"] for fk in insp.get_foreign_keys("inventory_movement"))
        if not has_product_fk:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `inventory_movement` ADD CONSTRAINT `fk_inv_movement_product` "
                    "FOREIGN KEY (`PRODUCT_ID`) REFERENCES `product_master`(`ID`)"
                ))
            log.info("migrate-inventory-movement-finalize-schema: added PRODUCT_ID foreign key")
    except Exception as exc:
        log.warning("migrate-inventory-movement-finalize-schema: add FK skipped: %s", exc)


_migrate_inventory_movement_finalize_schema()


def _migrate_inventory_batch_finalize_schema():
    """Step 5b: same finalize pattern for inventory_batch — drop
    INVENTORY_ITEM_ID + its old unique constraint/index, add the new
    (VENDOR_ID, PRODUCT_ID, BATCH_NUMBER) unique constraint + PRODUCT_ID
    FK. EXPIRY_DATE/MANUFACTURING_DATE/LOT_NUMBER/PO_ID/GRN_ID are kept
    (not part of this table's superseded-column list) — dropping them
    would break the live "expiring soon" feature and PO/GRN traceability
    for no benefit."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")
    insp = inspect(engine)

    if not insp.has_table("inventory_batch"):
        return

    try:
        constraints = {c["name"] for c in insp.get_unique_constraints("inventory_batch")}
        if "uq_inv_batch_vendor_item_batch" in constraints:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE `inventory_batch` DROP INDEX `uq_inv_batch_vendor_item_batch`"))
            log.info("migrate-inventory-batch-finalize-schema: dropped uq_inv_batch_vendor_item_batch")
    except Exception as exc:
        log.warning("migrate-inventory-batch-finalize-schema: drop old unique constraint skipped: %s", exc)

    try:
        cols = {c["name"] for c in insp.get_columns("inventory_batch")}
        if "INVENTORY_ITEM_ID" in cols:
            _drop_fk_on_column_if_exists(insp, "inventory_batch", "INVENTORY_ITEM_ID")
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE `inventory_batch` DROP COLUMN `INVENTORY_ITEM_ID`"))
            log.info("migrate-inventory-batch-finalize-schema: dropped INVENTORY_ITEM_ID")
    except Exception as exc:
        log.warning("migrate-inventory-batch-finalize-schema: drop INVENTORY_ITEM_ID skipped: %s", exc)

    try:
        cols = {c["name"] for c in insp.get_columns("inventory_batch")}
        if "PRODUCT_ID" in cols:
            with engine.connect() as conn:
                remaining_null = conn.execute(text(
                    "SELECT COUNT(*) FROM `inventory_batch` WHERE PRODUCT_ID IS NULL"
                )).scalar()
            if not remaining_null:
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE `inventory_batch` MODIFY COLUMN `PRODUCT_ID` VARCHAR(36) NOT NULL"))
                log.info("migrate-inventory-batch-finalize-schema: PRODUCT_ID is now NOT NULL")
            else:
                log.warning(
                    "migrate-inventory-batch-finalize-schema: %d row(s) still have NULL PRODUCT_ID — leaving nullable",
                    remaining_null,
                )
    except Exception as exc:
        log.warning("migrate-inventory-batch-finalize-schema: modify PRODUCT_ID NOT NULL skipped: %s", exc)

    try:
        constraints = {c["name"] for c in insp.get_unique_constraints("inventory_batch")}
        if "uq_inv_batch_vendor_product_batch" not in constraints:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `inventory_batch` ADD CONSTRAINT `uq_inv_batch_vendor_product_batch` "
                    "UNIQUE (`VENDOR_ID`, `PRODUCT_ID`, `BATCH_NUMBER`)"
                ))
            log.info("migrate-inventory-batch-finalize-schema: added uq_inv_batch_vendor_product_batch")
    except Exception as exc:
        log.warning("migrate-inventory-batch-finalize-schema: add unique constraint skipped: %s", exc)

    try:
        has_product_fk = any(fk.get("constrained_columns") == ["PRODUCT_ID"] for fk in insp.get_foreign_keys("inventory_batch"))
        if not has_product_fk:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `inventory_batch` ADD CONSTRAINT `fk_inv_batch_product` "
                    "FOREIGN KEY (`PRODUCT_ID`) REFERENCES `product_master`(`ID`)"
                ))
            log.info("migrate-inventory-batch-finalize-schema: added PRODUCT_ID foreign key")
    except Exception as exc:
        log.warning("migrate-inventory-batch-finalize-schema: add FK skipped: %s", exc)


_migrate_inventory_batch_finalize_schema()


def _migrate_add_purchase_order_batch_id():
    """Adds the nullable BATCH_ID FK to purchase_order (links a supplier
    PO to the PurchaseOrderApprovalBatch that proposed it, when it was
    auto-generated by the low-stock reorder workflow rather than created
    manually). purchase_order_approval_batch itself is a brand-new table
    — create_all() builds it, no migration needed."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("purchase_order"):
            return
        cols = {c["name"] for c in insp.get_columns("purchase_order")}
        if "BATCH_ID" in cols:
            return
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE `purchase_order` ADD COLUMN `BATCH_ID` VARCHAR(36) NULL"
            ))
        log.info("migrate-add-purchase-order-batch-id: added purchase_order.BATCH_ID")
    except Exception as exc:
        log.warning("migrate-add-purchase-order-batch-id skipped: %s", exc)


_migrate_add_purchase_order_batch_id()


def _migrate_email_send_rule_event_enum_add_purchase_order_approval():
    """Idempotent: widens email_send_rule.EVENT_TYPE to include
    PURCHASE_ORDER_APPROVAL_NEEDED (exact mirror of the
    ..._add_production_schedule_approval() migration above)."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("email_send_rule"):
            return

        with engine.connect() as conn:
            col_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_send_rule' AND COLUMN_NAME = 'EVENT_TYPE'"
            )).scalar()

        if col_type and "PURCHASE_ORDER_APPROVAL_NEEDED" not in col_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `email_send_rule` MODIFY COLUMN `EVENT_TYPE` "
                    "ENUM('QUOTATION_DECISION','PO_UPLOADED','PO_REQUESTED','PRODUCTION_SCHEDULE_APPROVAL_NEEDED','PURCHASE_ORDER_APPROVAL_NEEDED') NOT NULL"
                ))
            log.info("migrate-email-send-rule-event-enum: widened EVENT_TYPE with PURCHASE_ORDER_APPROVAL_NEEDED")

    except Exception as exc:
        log.warning("migrate-email-send-rule-event-enum-add-purchase-order-approval skipped: %s", exc)


_migrate_email_send_rule_event_enum_add_purchase_order_approval()


def _migrate_lead_status_enum_add_production_statuses():
    """Idempotent: widens lead.LEAD_STATUS to include PRODUCTION_SCHEDULED
    and PRODUCTION_STARTED (same ALTER-MODIFY-ENUM pattern as every other
    enum widening this codebase already does — e.g. _migrate_email_send_
    rule_event_enum_add_production_schedule_approval() above)."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("lead"):
            return

        with engine.connect() as conn:
            col_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'LEAD_STATUS'"
            )).scalar()

        if col_type and "PRODUCTION_SCHEDULED" not in col_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `lead` MODIFY COLUMN `LEAD_STATUS` "
                    "ENUM('NEW','VIEWED','CONVERTED','IGNORED','QUOTE_APPROVAL_PENDING','QUOTE_APPROVED','QUOTE_REJECTED',"
                    "'REVISED_QUOTE_APPROVAL_PENDING','REVISED_QUOTE_APPROVED','REVISED_QUOTE_REJECTED',"
                    "'PO_REQUESTED','PO_RECEIVED','PRODUCTION_SCHEDULED','PRODUCTION_STARTED') NOT NULL DEFAULT 'NEW'"
                ))
            log.info("migrate-lead-status-enum: widened LEAD_STATUS with PRODUCTION_SCHEDULED/PRODUCTION_STARTED")

    except Exception as exc:
        log.warning("migrate-lead-status-enum-add-production-statuses skipped: %s", exc)


_migrate_lead_status_enum_add_production_statuses()


def _migrate_lead_status_enum_add_schedule_requested():
    """Idempotent: widens lead.LEAD_STATUS to include
    PRODUCTION_SCHEDULE_REQUESTED (same ALTER-MODIFY-ENUM pattern as
    _migrate_lead_status_enum_add_production_statuses() above) — the new
    intermediate status between PO_RECEIVED and PRODUCTION_SCHEDULED
    representing a proposed schedule awaiting staff approval."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("lead"):
            return

        with engine.connect() as conn:
            col_type = conn.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = 'LEAD_STATUS'"
            )).scalar()

        if col_type and "PRODUCTION_SCHEDULE_REQUESTED" not in col_type:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `lead` MODIFY COLUMN `LEAD_STATUS` "
                    "ENUM('NEW','VIEWED','CONVERTED','IGNORED','QUOTE_APPROVAL_PENDING','QUOTE_APPROVED','QUOTE_REJECTED',"
                    "'REVISED_QUOTE_APPROVAL_PENDING','REVISED_QUOTE_APPROVED','REVISED_QUOTE_REJECTED',"
                    "'PO_REQUESTED','PO_RECEIVED','PRODUCTION_SCHEDULE_REQUESTED','PRODUCTION_SCHEDULED','PRODUCTION_STARTED') NOT NULL DEFAULT 'NEW'"
                ))
            log.info("migrate-lead-status-enum: widened LEAD_STATUS with PRODUCTION_SCHEDULE_REQUESTED")

    except Exception as exc:
        log.warning("migrate-lead-status-enum-add-schedule-requested skipped: %s", exc)


_migrate_lead_status_enum_add_schedule_requested()


def _migrate_backfill_production_schedule_requested_status():
    """One-time data backfill: before this change, the AUTOMATIC
    (payment-milestone-triggered) scheduling path never updated
    Lead.LEAD_STATUS after proposing a schedule — evaluate_and_propose_
    schedule() now does (see production_scheduling_service.py), but any
    lead that already had a schedule silently proposed for it under the
    old behavior is still stuck showing PO_RECEIVED. Moves those leads to
    PRODUCTION_SCHEDULE_REQUESTED to match what would have happened had
    this logic existed when the schedule was first proposed. Idempotent —
    a second run matches zero rows since the first run already moved them
    off PO_RECEIVED. Must run after the enum-widening migration above."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not (insp.has_table("lead") and insp.has_table("customer_project_assignment") and insp.has_table("production_schedule")):
            return

        with engine.begin() as conn:
            result = conn.execute(text(
                "UPDATE `lead` l "
                "JOIN `customer_project_assignment` a ON a.`LEAD_ID` = l.`ID` "
                "JOIN `production_schedule` ps ON ps.`ASSIGNMENT_ID` = a.`ID` "
                "SET l.`LEAD_STATUS` = 'PRODUCTION_SCHEDULE_REQUESTED' "
                "WHERE l.`LEAD_STATUS` = 'PO_RECEIVED' AND ps.`STATUS` = 'PROPOSED'"
            ))
            if result.rowcount:
                log.info("migrate-backfill-production-schedule-requested: moved %d lead(s) to PRODUCTION_SCHEDULE_REQUESTED", result.rowcount)

    except Exception as exc:
        log.warning("migrate-backfill-production-schedule-requested-status skipped: %s", exc)


_migrate_backfill_production_schedule_requested_status()


def _migrate_drop_inventory_batch_lot_number():
    """LOT_NUMBER is retired — Batch Number is now the single, auto-
    generated identifier for a batch (see inventory_batches.py's
    _generate_batch_number()). Not part of any unique constraint or FK,
    so a plain drop is safe and preserves every existing batch row's
    other data untouched."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("inventory_batch"):
            return
        cols = {c["name"] for c in insp.get_columns("inventory_batch")}
        if "LOT_NUMBER" in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE `inventory_batch` DROP COLUMN `LOT_NUMBER`"))
            log.info("migrate-drop-inventory-batch-lot-number: dropped LOT_NUMBER")
    except Exception as exc:
        log.warning("migrate-drop-inventory-batch-lot-number skipped: %s", exc)


_migrate_drop_inventory_batch_lot_number()


def _migrate_add_inventory_batch_no_expiry():
    """Adds IS_NO_EXPIRY (nullable-safe boolean, default False) to
    inventory_batch — lets a batch explicitly declare 'this product never
    expires' instead of leaving EXPIRY_DATE blank, which is ambiguous
    with 'not entered yet'. Existing rows all default to False —
    unchanged meaning (blank EXPIRY_DATE still just means 'not
    recorded', exactly as before this migration)."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("inventory_batch"):
            return
        cols = {c["name"] for c in insp.get_columns("inventory_batch")}
        if "IS_NO_EXPIRY" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `inventory_batch` ADD COLUMN `IS_NO_EXPIRY` TINYINT(1) NOT NULL DEFAULT 0"
                ))
            log.info("migrate-add-inventory-batch-no-expiry: added IS_NO_EXPIRY")
    except Exception as exc:
        log.warning("migrate-add-inventory-batch-no-expiry skipped: %s", exc)


_migrate_add_inventory_batch_no_expiry()


def _migrate_add_project_quotation_share_token():
    """Adds SHARE_TOKEN (nullable, unique) to project_quotation_template —
    lets the WhatsApp Sales Assistant share a working, unauthenticated PDF
    link (see routes/project_quotation.py's new public GET /quotation-pdf/
    {token}) instead of the internal RBAC-protected export endpoint, which
    a customer's browser can never authenticate against."""
    import logging
    from sqlalchemy import text, inspect

    log = logging.getLogger("uvicorn")

    try:
        insp = inspect(engine)
        if not insp.has_table("project_quotation_template"):
            return
        cols = {c["name"] for c in insp.get_columns("project_quotation_template")}
        if "SHARE_TOKEN" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE `project_quotation_template` ADD COLUMN `SHARE_TOKEN` VARCHAR(64) NULL UNIQUE"
                ))
            log.info("migrate-add-project-quotation-share-token: added SHARE_TOKEN")
    except Exception as exc:
        log.warning("migrate-add-project-quotation-share-token skipped: %s", exc)


_migrate_add_project_quotation_share_token()


from app.services.speech_service import speech_service  # noqa: E402
speech_service.initialize()  # non-blocking — Piper models load on a background thread

from app.scheduler import start_scheduler, stop_scheduler  # noqa: E402 — started after seeding, before routers
start_scheduler()

from app.whatsapp_scheduler import start_whatsapp_scheduler, stop_whatsapp_scheduler  # noqa: E402 — separate scheduler instance, see module docstring
start_whatsapp_scheduler()

from app.production_reminder_scheduler import start_production_reminder_scheduler, stop_production_reminder_scheduler  # noqa: E402 — separate scheduler instance, see module docstring
start_production_reminder_scheduler()


@app.on_event("shutdown")
def _stop_background_schedulers():
    """Stop all BackgroundScheduler instances before the process's thread
    pools are torn down — without this, their interval jobs keep firing
    during interpreter shutdown and spam 'cannot schedule new futures
    after shutdown', which is what makes Ctrl+C take a while to land."""
    stop_scheduler()
    stop_whatsapp_scheduler()
    stop_production_reminder_scheduler()



app.include_router(auth_router, tags=["Auth"])
app.include_router(organization_router, tags=["Organization"])
app.include_router(employee.router, tags=["Employees (IAM)"])
app.include_router(employee_task_router, tags=["Employee Workflow"])
app.include_router(task_approval_router, tags=["Task Approval"])
app.include_router(task_router, tags=["Project Tasks"])
app.include_router(project_template_router, tags=["Project Templates"])
app.include_router(project_quotation_router, tags=["Project Quotation Templates"])
# project_router registered AFTER project_template_router so the unified
# GET /projects handler (project_template.py) wins the route collision —
# project.py still owns its other unique paths (customer CRUD, etc.).
app.include_router(project_router, tags=["Projects"])
app.include_router(users_router, tags=["Users"])
app.include_router(vendor_router, tags=["Vendors"])
app.include_router(inventory_router, tags=["Inventory"])
app.include_router(attendance_router, tags=["Attendance"])
app.include_router(notification_router, tags=["Notifications"])
app.include_router(announcement_router)
app.include_router(org_chart_router)
app.include_router(analytics_router, tags=["Analytics"])
app.include_router(reports_router, tags=["Reports"])
app.include_router(settings_router, tags=["Settings"])
app.include_router(biometric_router)
app.include_router(iclock_router)  # ADMS Push (biometric device -> ERP)
app.include_router(bvc24_seed_router)
app.include_router(performance_router)
app.include_router(supplier_router)
app.include_router(leave_router)
app.include_router(connect_router)
app.include_router(payroll_router)
app.include_router(purchase_order_router, tags=["Purchase Orders"])
app.include_router(procurement_seed_router, tags=["Procurement Seed"])
app.include_router(whatsapp_router, tags=["WhatsApp Alerts"])
app.include_router(employee_onboarding_router, tags=["Employee Onboarding Portal"])
app.include_router(employee_documents_router, tags=["Employee Documents"])
app.include_router(admin_dashboard_router)
app.include_router(approvals_router)
app.include_router(dashboard_aggregators_router)
app.include_router(public_enquiry_router)
app.include_router(geofence_router)
app.include_router(employee_memos_router)
app.include_router(employee_portal_router, tags=["Employee Portal"])
app.include_router(audit_router)
app.include_router(rbac_router)
app.include_router(holiday_router)
app.include_router(allowance_router, tags=["Allowances"])
app.include_router(recruitment_router)
app.include_router(my_payslips_router)
app.include_router(onboarding_checklist_router)
app.include_router(attendance_ai_router)
app.include_router(leave_decisions_router)
app.include_router(monthly_reports_router)
app.include_router(employee_status_router)
app.include_router(employee_insights_router)
app.include_router(custom_fields_router, tags=["Custom Fields"])
app.include_router(helpdesk_router)
app.include_router(memo_automation_router)

# ── HRMS AI Assistant (Gemini + RAG) ──
app.include_router(hrms_ai_router)

app.include_router(email_config_router, tags=["Email Configuration"])
app.include_router(email_templates_router, tags=["Email Templates"])
app.include_router(lead_management_router, tags=["Lead Management"])
app.include_router(quotation_actions_router, tags=["Quotation Actions"])
app.include_router(po_actions_router, tags=["Purchase Order Actions"])
app.include_router(email_send_rule_router, tags=["Email Send Rule"])
app.include_router(customer_master_router, tags=["Customer Master"])
app.include_router(customer_payment_router, tags=["Customer Payments"])
app.include_router(payment_milestone_router, tags=["Payment Milestones"])
app.include_router(production_schedule_router, tags=["Production Scheduling"])
app.include_router(purchase_order_approval_router, tags=["Purchase Order Approval"])
app.include_router(whatsapp_config_router, tags=["WhatsApp Configuration"])
app.include_router(whatsapp_module_settings_router, tags=["WhatsApp Module Settings"])
app.include_router(whatsapp_webhook_router, tags=["WhatsApp Webhook"])
app.include_router(whatsapp_inbox_router, tags=["WhatsApp Inbox"])
app.include_router(rag_router, tags=["AI Platform"])
app.include_router(speech_router, tags=["Speech (TTS)"])

# ── Inventory & Supplier Procurement Module ───────────────────────────────
app.include_router(supplier_onboarding_router, prefix="/api")
app.include_router(supplier_products_router, prefix="/api")
app.include_router(supplier_ranking_router, prefix="/api")
app.include_router(inventory_items_router, prefix="/api")
app.include_router(inventory_movements_router, prefix="/api")
app.include_router(inventory_batches_router, prefix="/api")


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
