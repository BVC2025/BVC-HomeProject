"""
Shared permission CATALOGUE — the fixed list of permission codes the
RBAC system knows about (CODE, NAME, CATEGORY, DESCRIPTION).

This is reference/definitional data, not business data: it's the
application's own fixed vocabulary of "things a permission can be",
analogous to an enum. It is therefore safe (and required, per product
decision) to ensure it exists automatically on every backend startup —
`ensure_permission_catalogue()` only ever INSERTs a missing `permission`
row; it never touches `Role`, `RolePermission`, or any other table, so
it cannot auto-create a role or auto-grant a permission to anyone.

Used by:
  - backend/app/main.py's startup sequence (idempotent, every boot)
  - backend/scripts/seed_permissions.py (manual script — same function,
    plus that script separately offers an opt-in --apply-defaults flag
    for seeding default ROLE GRANTS, which this module deliberately
    knows nothing about)

Adding a new permission later: append to CATALOGUE below. It appears
in the RBAC UI (via GET /rbac/permissions) on the next backend restart
or the next manual run of seed_permissions.py — no grants change.
"""

from app.models.models import Permission


# =====================================================================
# CATALOGUE
# ---------------------------------------------------------------------
# (CODE, NAME, CATEGORY, DESCRIPTION)
# =====================================================================

CATALOGUE = [
    # ---- Employee admin (existing + new) ----
    ("employee.view",          "View employee directory",     "Employees", "See list of employees and their basic profiles"),
    ("employee.create",        "Create employees",            "Employees", "Add new employee records"),
    ("employee.update",        "Edit employees",              "Employees", "Update employee profile fields"),
    ("employee.delete",        "Delete employees",            "Employees", "Cascading delete of an employee record"),
    ("employee.password-reset","Reset employee passwords",    "Employees", "Set a new password for any employee"),
    ("employee.wipe",          "Bulk wipe employees",         "Employees", "Nuclear: remove ALL employees (dev only)"),

    # ---- Documents ----
    ("document.upload",        "Upload employee documents",   "Employees", "Aadhaar, PAN, resume, offer letter, etc."),
    ("document.delete",        "Delete employee documents",   "Employees", "Remove a stored document file + row"),

    # ---- Memos ----
    ("memo.view.all",          "View all memos",              "Memos",     "See every memo across the org"),
    ("memo.create",            "Create memos",                "Memos",     "Issue warnings, appreciations, disciplinary notices"),
    ("memo.update",            "Edit memos",                  "Memos",     "Modify subject/description/severity of a memo"),
    ("memo.delete",            "Delete memos",                "Memos",     "Soft-delete a memo from the audit trail"),
    ("memo.export",            "Export memos to CSV",         "Memos",     "Download memo list as CSV"),

    # ---- Leave (existing leave.decide + leave.view.all + new) ----
    ("leave.view.all",         "View all leave requests",     "Leave",     "Admin dashboard of every leave"),
    ("leave.approve",          "Approve leave requests",      "Leave",     "PATCH /leave/{id}/approve"),
    ("leave.reject",           "Reject leave requests",       "Leave",     "PATCH /leave/{id}/reject"),
    ("leave.decide",           "Approve OR reject (legacy)",  "Leave",     "Combined approve+reject permission"),
    ("leave.policy.manage",    "Manage leave quota policies", "Leave",     "Create/edit/delete LeaveQuotaPolicy rows"),

    # ---- Attendance (existing + new mark) ----
    ("attendance.view.all",    "View all attendance",         "Attendance", "Admin sees everyone"),
    ("attendance.mark.others", "Mark others' attendance",     "Attendance", "Admin marks absent / overrides"),
    ("attendance.delete",      "Delete attendance records",   "Attendance", "Remove an attendance row"),

    # ---- Geofence ----
    ("geofence.settings.update", "Update geofence config",    "Attendance", "Edit office lat/lng/radius"),
    ("geofence.logs.delete",     "Delete geofence log rows",  "Attendance", "Clean up admin sweep"),
    ("geofence.dashboard.view",  "View geofence dashboard",   "Attendance", "Today's inside/outside KPI tile"),

    # ---- Holiday Calendar ----
    ("attendance.holiday.view",   "View holiday calendar",   "Attendance", "See the configured holiday list"),
    ("attendance.holiday.manage", "Manage holiday calendar", "Attendance", "Add/edit/delete holidays, seed a year's calendar"),

    # ---- Onboarding (candidate sessions) ----
    ("onboarding.invite",          "Generate onboarding invites","Onboarding", "Create a new candidate invite link"),
    ("onboarding.sessions.view",   "View onboarding sessions",   "Onboarding", "Admin review queue"),
    ("onboarding.sessions.edit",   "Edit onboarding sessions",   "Onboarding", "Override collected data before approval"),
    ("onboarding.sessions.approve","Approve onboarding sessions","Onboarding", "Promote candidate to Employee"),
    ("onboarding.sessions.reject", "Reject onboarding sessions", "Onboarding", "Decline candidate, with reason"),
    ("onboarding.sessions.delete", "Delete onboarding sessions", "Onboarding", "Remove an invite entirely"),
    ("onboarding.sessions.resend", "Resend onboarding invites",  "Onboarding", "Generate fresh token, extend expiry"),

    # ---- Onboarding Checklist (post-hire: assets/training/kit) ----
    ("onboarding.checklist.view",   "View onboarding checklist",   "Onboarding", "Per-employee post-hire checklist, assets, trainings, kit"),
    ("onboarding.checklist.manage", "Manage onboarding checklist", "Onboarding", "Allocate/return assets, assign/complete trainings, issue kit, manage masters"),

    # ---- Tasks (existing + new) ----
    ("task.view.all",   "View all tasks",          "Tasks",     "Org-wide task list"),
    ("task.assign",     "Assign tasks",            "Tasks",     "POST /task-assignment"),
    ("task.update.status","Update task status",    "Tasks",     "Start / Complete / Hold"),

    # ---- Org / Project (existing) ----
    ("org.view",         "View departments / designations", "Organization", None),
    ("org.manage",       "Manage org structure",            "Organization", "Create/edit/delete departments and designations"),
    ("project.view",     "View projects",                   "Projects", None),
    ("project.create",   "Create projects",                 "Projects", None),
    ("project.update",   "Edit projects",                   "Projects", None),
    ("project.delete",   "Delete projects",                 "Projects", None),

    # ---- Project Management sub-pages (page-level granularity, additive
    # alongside the shared project.* codes above — see PAGE_LABELS) ----
    ("project.categories.view",   "View project categories",   "Projects", None),
    ("project.categories.create", "Create project categories", "Projects", None),
    ("project.categories.update", "Edit project categories",   "Projects", None),
    ("project.categories.delete", "Delete project categories", "Projects", None),
    ("project.categories.export", "Export project categories", "Projects", "Download to Excel"),

    ("project.task_templates.view",   "View task templates",   "Projects", None),
    ("project.task_templates.create", "Create task templates", "Projects", None),
    ("project.task_templates.update", "Edit task templates",   "Projects", None),
    ("project.task_templates.delete", "Delete task templates", "Projects", None),
    ("project.task_templates.export", "Export task templates", "Projects", "Download to Excel"),
    ("project.task_templates.reorder","Reorder task templates","Projects", "Drag-and-drop sequence change"),

    ("project.pricing.view",   "View project pricing",   "Projects", None),
    ("project.pricing.create", "Create project pricing",  "Projects", None),
    ("project.pricing.update", "Edit project pricing",    "Projects", None),
    ("project.pricing.delete", "Delete project pricing",  "Projects", None),
    ("project.pricing.export", "Export project pricing",  "Projects", "Download to Excel"),

    ("project.quotations.view",   "View project quotations",   "Projects", "Per-project quotation document"),
    ("project.quotations.update", "Edit project quotations",   "Projects", "Sections, letterhead, signature"),
    ("project.quotations.export", "Export project quotations", "Projects", "Download PDF/DOCX"),

    # ---- Inventory / Machine ----
    ("inventory.view",     "View inventory",       "Inventory", None),
    ("inventory.purchase", "Add stock",            "Inventory", "From supplier deliveries"),
    ("inventory.consume",  "Consume stock",        "Inventory", "Issue materials to a task"),

    # ---- Inventory sub-pages (page-level granularity, additive
    # alongside the shared inventory.view/.purchase codes above) ----
    ("inventory.categories.view",   "View inventory categories",   "Inventory", None),
    ("inventory.categories.create", "Create inventory categories", "Inventory", None),
    ("inventory.categories.update", "Edit inventory categories",   "Inventory", None),
    ("inventory.categories.delete", "Delete inventory categories", "Inventory", None),
    ("inventory.categories.export", "Export inventory categories", "Inventory", "Download to Excel"),
    ("inventory.categories.import", "Bulk import inventory categories", "Inventory", "Bulk upload via Excel"),

    ("inventory.products.view",   "View product master",   "Inventory", None),
    ("inventory.products.create", "Create products",       "Inventory", None),
    ("inventory.products.update", "Edit products",         "Inventory", None),
    ("inventory.products.delete", "Delete products",       "Inventory", None),
    ("inventory.products.export", "Export product master", "Inventory", "Download to Excel"),
    ("inventory.products.import", "Bulk import products",  "Inventory", "Bulk upload via Excel"),

    ("inventory.items.view",   "View inventory items",   "Inventory", None),
    ("inventory.items.create", "Create inventory items", "Inventory", None),
    ("inventory.items.update", "Edit inventory items",    "Inventory", "Includes stock-in/adjust/transfer"),
    ("inventory.items.delete", "Delete inventory items",  "Inventory", None),
    ("inventory.items.export", "Export inventory items",  "Inventory", "Download to Excel"),
    ("inventory.items.import", "Bulk import inventory items", "Inventory", "Bulk upload via Excel"),

    ("inventory.batches.view",   "View inventory batches", "Inventory", None),
    ("inventory.batches.create", "Create inventory batches","Inventory", None),
    ("inventory.batches.update", "Edit inventory batches",  "Inventory", None),

    ("inventory.movements.view",   "View inventory movements", "Inventory", "Stock movement history"),
    ("inventory.movements.export", "Export inventory movements","Inventory", "Download to Excel"),

    ("machine.view",       "View machines",        "Production", None),
    ("machine.update.stage","Update machine stage","Production", None),

    # ---- Customer / Sales / Payment ----
    ("customer.view",       "View customers",       "Sales", None),
    ("customer.manage",     "Manage customers",     "Sales", "Create/edit/delete"),
    ("customer.master.view",   "View customer master",        "Sales", "Simplified customer master list (separate from the CRM Customers page)"),
    ("customer.master.create", "Create customer master rows", "Sales", None),
    ("customer.master.update", "Edit customer master rows",   "Sales", None),
    ("customer.master.delete", "Delete customer master rows", "Sales", None),
    ("customer.master.export", "Export customer master",      "Sales", "Download to Excel"),
    ("customer.master.import", "Bulk import customer master", "Sales", "Bulk upload via Excel"),
    ("sales_order.view",    "View sales orders",    "Sales", None),
    ("sales_order.manage",  "Manage sales orders",  "Sales", "Create, edit, cancel, record payments"),
    ("quotation.manage",    "Manage quotations",    "Sales", "Create and approve"),

    # ---- Procurement ----
    ("supplier.manage",       "Manage suppliers",        "Procurement", None),
    ("supplier.view",         "View suppliers",          "Procurement", "Read-only — supplier.manage already covers this too"),
    ("purchase_order.view",   "View purchase orders",    "Procurement", None),
    ("purchase_order.manage", "Manage purchase orders",  "Procurement", "Create/approve/GRN"),

    # ---- Procurement sub-pages (page-level granularity, additive
    # alongside the shared supplier.manage code above) ----
    ("supplier.invitations.view",   "View supplier invitations",   "Procurement", "Registration invite links"),
    ("supplier.invitations.manage", "Manage supplier invitations", "Procurement", "Invite/resend/expire/approve/reject"),
    ("supplier.products.view",      "View supplier product pricing",  "Procurement", "Per-supplier product price list"),
    ("supplier.products.manage",    "Manage supplier product pricing","Procurement", None),

    # ---- Payroll ----
    ("payroll.view",     "View payroll",     "Payroll", None),
    ("payroll.manage",   "Manage payroll",   "Payroll", "Run/finalize/mark paid"),

    # ---- System / Admin ----
    ("setting.modify",        "Modify system settings", "System", None),
    ("role.manage",           "Manage roles & grants",  "System", "Read + write to permission catalogue"),
    ("iam_user.manage",       "Manage IAM users",       "System", "Create/deactivate IAM user login accounts — Root-grantable only, see self-escalation guard"),
    ("permission.override.manage", "Manage permission overrides", "System", "Create/edit per-employee grant/deny exceptions — Root-grantable only, see self-escalation guard"),
    ("report.export",         "Export reports",         "Reports","PDF / Excel exports"),
    ("notification.broadcast","Broadcast notifications","System", "Send to all staff"),

    # ---- Announcements ----
    ("announcement.manage", "Create/edit/delete announcements", "Announcements", "POST/PATCH/DELETE /announcements — already enforced, was missing from the catalogue"),

    # ---- Lead Management ----
    ("lead.config.view",       "View lead source configuration",   "Lead Management", "Third-party polling API credentials/config"),
    ("lead.config.manage",     "Manage lead source configuration", "Lead Management", "Add/edit/delete/activate/sync a lead source"),
    ("lead.live.view",         "View live incoming leads",         "Lead Management", "Real-time preview of leads as they arrive"),
    ("lead.records.view",      "View lead records",                "Lead Management", "Manual lead list"),
    ("lead.records.create",    "Create lead records",              "Lead Management", None),
    ("lead.records.update",    "Edit lead records",                "Lead Management", None),
    ("lead.records.delete",    "Delete lead records",              "Lead Management", None),
    ("lead.records.export",    "Export lead records",              "Lead Management", "Download to Excel"),
    ("lead.records.import",    "Bulk import lead records",         "Lead Management", "Bulk upload via Excel"),
    ("lead.polling_log.view",  "View lead polling activity log",   "Lead Management", None),
    ("lead.records.all_lead_view",       "View all vendor lead records",           "Lead Management", "See every lead for the vendor, not just leads assigned to you"),
    ("lead.records.filter_source",       "Use lead source filter",                 "Lead Management", None),
    ("lead.records.filter_date",         "Use lead date filter",                   "Lead Management", None),
    ("lead.records.filter_department",   "Use lead department filter",             "Lead Management", "Requires lead.records.all_lead_view"),
    ("lead.records.filter_role",         "Use lead role filter",                   "Lead Management", "Requires lead.records.all_lead_view"),
    ("lead.records.filter_owner",        "Use lead owner filter",                  "Lead Management", "Requires lead.records.all_lead_view"),
    ("lead.records.owner_select_create", "Select lead owner when creating a lead", "Lead Management", None),
    ("lead.records.owner_select_update", "Select lead owner when editing a lead",  "Lead Management", None),
    ("lead.records.convert",             "Convert a lead to a customer",           "Lead Management", "Creates/links a Customer and a project assignment, then marks the lead CONVERTED"),

    # ---- Performance ----
    ("star_performance.view",   "View star performance",   "Performance", "Star ratings, bands, summaries"),
    ("star_performance.manage", "Manage star performance",  "Performance", "Record Promotion/Increment/Rewarded actions"),

    # ---- Shift Management ----
    ("shift.view",              "View shifts & schedules",      "Shift Management", None),
    ("shift.manage",            "Manage shifts & schedules",    "Shift Management", "Create/edit/delete shifts, assign/auto-fill/bulk-schedule"),
    ("shift.requests.approve",  "Approve shift-change requests","Shift Management", None),

    # ---- Approvals ----
    ("approval.view",   "View the Approval Center queue",         "Approvals", "Pending leave/purchase/payment/discount items"),
    ("approval.manage", "Approve/reject items in the Approval Center", "Approvals", None),

    # ---- Recruitment (ATS) — RBAC plan gap, no codes existed before ----
    ("recruitment.view",   "View recruitment/ATS", "Recruitment", "Jobs, candidates, applications, interviews, offers"),
    ("recruitment.manage", "Manage recruitment",   "Recruitment", "Create/edit jobs, screen candidates, schedule interviews, issue offers"),

    # ---- Manufacturing — production/quality/work-center CRUD (RBAC plan gap;
    # only machine.view/machine.update.stage existed before) ----
    ("production.view",   "View production/BOM/work orders", "Production", "Product models, BOM, work orders, process stages"),
    ("production.manage",  "Manage production/BOM/work orders", "Production", "Create/edit/delete product models, BOM, work orders"),
    ("quality.view",       "View quality/QC inspections", "Production", "Checklist items, inspections, NCRs"),
    ("quality.manage",     "Manage quality/QC inspections", "Production", "Create/edit checklist items, record inspections, manage NCRs"),
    ("work_center.view",   "View work centers",   "Production", None),
    ("work_center.manage", "Manage work centers",  "Production", "Create/edit/delete work centers"),

    # ---- Help Desk — RBAC plan gap, admin actions were role-allowlist only ----
    ("helpdesk.view.all",  "View all help desk tickets", "System", "Admin ticket queue"),
    ("helpdesk.manage",    "Manage help desk tickets",   "System", "Assign, close, view stats"),

    # ---- AI Platform (common Enterprise RAG platform) ----
    ("rag.module.manage",   "Manage AI modules",         "AI Platform", "Create/edit/deactivate AI_MODULES rows"),
    ("rag.document.upload", "Upload/manage KB documents","AI Platform", "Upload, replace, retrain, activate/deactivate documents"),
    ("rag.document.delete", "Delete KB documents",       "AI Platform", "Soft-delete a document + its vectors"),
    ("rag.query",           "Use AI chat/playground",    "AI Platform", "Ask questions via any AI module's chat endpoint"),
    ("rag.settings.manage", "Manage AI settings",        "AI Platform", "Edit per-module LLM model / global RAG settings"),
]


# =====================================================================
# FILTER_DEPENDENCIES
# ---------------------------------------------------------------------
# {dependent_code: prerequisite_code}. A dependent code should never be
# effectively granted (to a role or an individual employee) unless its
# prerequisite is also effectively granted at that same level. Enforced
# in backend/app/routes/rbac.py (grant/replace/override write paths,
# with cascade-revoke symmetry) and mirrored client-side (informational
# only) in frontend/src/pages/RbacPermissions.jsx via the `REQUIRES`
# field on each serialized permission (see rbac.py's
# _serialize_permission). Source/date filters are deliberately absent —
# they only narrow within whatever scope the caller can already see.
# =====================================================================

FILTER_DEPENDENCIES = {
    "lead.records.filter_department": "lead.records.all_lead_view",
    "lead.records.filter_role":       "lead.records.all_lead_view",
    "lead.records.filter_owner":      "lead.records.all_lead_view",
}


# =====================================================================
# PAGE_LABELS
# ---------------------------------------------------------------------
# Purely a display hint for the RBAC UI's "Module -> Page -> Action"
# grouping — NOT a database column, nothing to migrate. A code with no
# entry here just renders flat under its CATEGORY, exactly as before.
# Only added where the actual frontend page is unambiguous; codes
# shared across several pages (e.g. project.* is reused by the Project
# Categories/Task Templates/Pricing/Quotation pages, not just the main
# Projects list) are labeled with the one shared page rather than
# inventing separate ones that don't structurally exist yet.
# =====================================================================

PAGE_LABELS = {
    "attendance.holiday.view":   "Holiday Calendar",
    "attendance.holiday.manage": "Holiday Calendar",

    "onboarding.checklist.view":   "Onboarding Checklist",
    "onboarding.checklist.manage": "Onboarding Checklist",

    "lead.config.view":      "Configuration",
    "lead.config.manage":    "Configuration",
    "lead.live.view":        "Live Lead Viewer",
    "lead.records.view":     "Lead Records",
    "lead.records.create":   "Lead Records",
    "lead.records.update":   "Lead Records",
    "lead.records.delete":   "Lead Records",
    "lead.records.export":   "Lead Records",
    "lead.records.import":   "Lead Records",
    "lead.records.all_lead_view":       "Lead Records",
    "lead.records.filter_source":       "Lead Records",
    "lead.records.filter_date":         "Lead Records",
    "lead.records.filter_department":   "Lead Records",
    "lead.records.filter_role":         "Lead Records",
    "lead.records.filter_owner":        "Lead Records",
    "lead.records.owner_select_create": "Lead Records",
    "lead.records.owner_select_update": "Lead Records",
    "lead.records.convert":             "Lead Records",

    "customer.master.view":   "Customer Master",
    "customer.master.create": "Customer Master",
    "customer.master.update": "Customer Master",
    "customer.master.delete": "Customer Master",
    "customer.master.export": "Customer Master",
    "customer.master.import": "Customer Master",
    "lead.polling_log.view": "Polling Activity",

    "project.view":   "Project List",
    "project.create": "Project List",
    "project.update": "Project List",
    "project.delete": "Project List",

    "project.categories.view":   "Project Categories",
    "project.categories.create": "Project Categories",
    "project.categories.update": "Project Categories",
    "project.categories.delete": "Project Categories",
    "project.categories.export": "Project Categories",

    "project.task_templates.view":    "Task Templates",
    "project.task_templates.create":  "Task Templates",
    "project.task_templates.update":  "Task Templates",
    "project.task_templates.delete":  "Task Templates",
    "project.task_templates.export":  "Task Templates",
    "project.task_templates.reorder": "Task Templates",

    "project.pricing.view":   "Project Pricing",
    "project.pricing.create": "Project Pricing",
    "project.pricing.update": "Project Pricing",
    "project.pricing.delete": "Project Pricing",
    "project.pricing.export": "Project Pricing",

    "project.quotations.view":   "Project Quotations",
    "project.quotations.update": "Project Quotations",
    "project.quotations.export": "Project Quotations",

    "inventory.view":     "Inventory Overview",
    "inventory.purchase": "Inventory Overview",

    "inventory.categories.view":   "Inventory Categories",
    "inventory.categories.create": "Inventory Categories",
    "inventory.categories.update": "Inventory Categories",
    "inventory.categories.delete": "Inventory Categories",
    "inventory.categories.export": "Inventory Categories",
    "inventory.categories.import": "Inventory Categories",

    "inventory.products.view":   "Product Master",
    "inventory.products.create": "Product Master",
    "inventory.products.update": "Product Master",
    "inventory.products.delete": "Product Master",
    "inventory.products.export": "Product Master",
    "inventory.products.import": "Product Master",

    "inventory.items.view":   "Inventory Items",
    "inventory.items.create": "Inventory Items",
    "inventory.items.update": "Inventory Items",
    "inventory.items.delete": "Inventory Items",
    "inventory.items.export": "Inventory Items",
    "inventory.items.import": "Inventory Items",

    "inventory.batches.view":   "Inventory Batches",
    "inventory.batches.create": "Inventory Batches",
    "inventory.batches.update": "Inventory Batches",

    "inventory.movements.view":   "Inventory Movements",
    "inventory.movements.export": "Inventory Movements",

    "supplier.manage": "Suppliers",
    "supplier.view":   "Suppliers",

    "supplier.invitations.view":   "Supplier Invitations",
    "supplier.invitations.manage": "Supplier Invitations",

    "supplier.products.view":   "Supplier Product Pricing",
    "supplier.products.manage": "Supplier Product Pricing",
}


def ensure_permission_catalogue(db) -> dict:
    """Insert any missing permission rows from CATALOGUE. Never touches
    Role or RolePermission — additive-only on the `permission` table.
    Returns {"code_to_id": {...}, "added": int, "updated_meta": int}."""

    existing = {p.CODE: p for p in db.query(Permission).all()}
    added = 0
    updated_meta = 0

    for code, name, category, desc in CATALOGUE:
        if code in existing:
            # Backfill missing metadata if an older row was minimal.
            p = existing[code]
            if (not p.NAME) and name:
                p.NAME = name
                updated_meta += 1
            if (not p.CATEGORY) and category:
                p.CATEGORY = category
                updated_meta += 1
            if (not p.DESCRIPTION) and desc:
                p.DESCRIPTION = desc
                updated_meta += 1
            continue

        p = Permission(CODE=code, NAME=name, CATEGORY=category, DESCRIPTION=desc)
        db.add(p)
        added += 1

    db.flush()
    code_to_id = {p.CODE: p.ID for p in db.query(Permission).all()}

    return {"code_to_id": code_to_id, "added": added, "updated_meta": updated_meta}
