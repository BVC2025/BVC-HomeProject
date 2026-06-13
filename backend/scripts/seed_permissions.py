"""
seed_permissions.py  —  Idempotent permission catalogue seeder.

Adds any missing rows in the `permission` table and grants sensible
defaults to the existing roles. Safe to re-run any number of times —
existing rows are kept, only new ones are inserted.

Usage
-----
  python -m scripts.seed_permissions             # add missing + apply defaults
  python -m scripts.seed_permissions --dry-run   # report what would change

What this does
--------------
1. Ensures every code in CATALOGUE exists in the `permission` table
2. For each role in DEFAULT_GRANTS, ensures the listed permissions are
   granted (extra grants left alone — humans may have added them).
3. Reports counts at the end.

Adding a new permission later
-----------------------------
1. Append to CATALOGUE below.
2. Optionally extend DEFAULT_GRANTS so a role gets it by default.
3. Re-run this script.

Exit codes
----------
  0  success
  1  fatal
"""

import argparse
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from app.database.database import SessionLocal
from app.models.models import Role, Permission, RolePermission


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
    ("attendance.view.self",   "View own attendance",         "Attendance", "Employee sees their own records"),
    ("attendance.view.team",   "View team attendance",        "Attendance", "Department head sees own department"),
    ("attendance.view.all",    "View all attendance",         "Attendance", "Admin sees everyone"),
    ("attendance.mark.others", "Mark others' attendance",     "Attendance", "Admin marks absent / overrides"),
    ("attendance.delete",      "Delete attendance records",   "Attendance", "Remove an attendance row"),

    # ---- Geofence ----
    ("geofence.settings.update", "Update geofence config",    "Attendance", "Edit office lat/lng/radius"),
    ("geofence.logs.view",       "View geofence security log","Attendance", "Failed location attempts"),
    ("geofence.logs.delete",     "Delete geofence log rows",  "Attendance", "Clean up admin sweep"),
    ("geofence.dashboard.view",  "View geofence dashboard",   "Attendance", "Today's inside/outside KPI tile"),

    # ---- Onboarding ----
    ("onboarding.invite",          "Generate onboarding invites","Onboarding", "Create a new candidate invite link"),
    ("onboarding.sessions.view",   "View onboarding sessions",   "Onboarding", "Admin review queue"),
    ("onboarding.sessions.edit",   "Edit onboarding sessions",   "Onboarding", "Override collected data before approval"),
    ("onboarding.sessions.approve","Approve onboarding sessions","Onboarding", "Promote candidate to Employee"),
    ("onboarding.sessions.reject", "Reject onboarding sessions", "Onboarding", "Decline candidate, with reason"),
    ("onboarding.sessions.delete", "Delete onboarding sessions", "Onboarding", "Remove an invite entirely"),
    ("onboarding.sessions.resend", "Resend onboarding invites",  "Onboarding", "Generate fresh token, extend expiry"),

    # ---- Tasks (existing + new) ----
    ("task.view.self",  "View own tasks",          "Tasks",     "Employee dashboard"),
    ("task.view.team",  "View team tasks",         "Tasks",     "Manager sees own department"),
    ("task.view.all",   "View all tasks",          "Tasks",     "Org-wide task list"),
    ("task.assign",     "Assign tasks",            "Tasks",     "POST /task-assignment"),
    ("task.delete",     "Delete tasks",            "Tasks",     "DELETE /task-assignment/{id}"),
    ("task.update.status","Update task status",    "Tasks",     "Start / Complete / Hold"),
    ("task.qc.approve", "Approve at QC",           "Tasks",     "Move task QC → Completed"),
    ("task.qc.reject",  "Reject at QC",            "Tasks",     "Move task back to Rework"),

    # ---- Org / Project (existing) ----
    ("org.view",         "View departments / designations", "Organization", None),
    ("org.manage",       "Manage org structure",            "Organization", "Create/edit/delete departments and designations"),
    ("project.view",     "View projects",                   "Projects", None),
    ("project.create",   "Create projects",                 "Projects", None),
    ("project.update",   "Edit projects",                   "Projects", None),
    ("project.delete",   "Delete projects",                 "Projects", None),

    # ---- Inventory / Machine ----
    ("inventory.view",     "View inventory",       "Inventory", None),
    ("inventory.purchase", "Add stock",            "Inventory", "From supplier deliveries"),
    ("inventory.consume",  "Consume stock",        "Inventory", "Issue materials to a task"),
    ("machine.view",       "View machines",        "Production", None),
    ("machine.update.stage","Update machine stage","Production", None),

    # ---- Customer / Sales / Payment ----
    ("customer.view",       "View customers",       "Sales", None),
    ("customer.manage",     "Manage customers",     "Sales", "Create/edit/delete"),
    ("sales_order.view",    "View sales orders",    "Sales", None),
    ("sales_order.manage",  "Manage sales orders",  "Sales", "Create, edit, cancel, record payments"),
    ("quotation.manage",    "Manage quotations",    "Sales", "Create and approve"),
    ("payment.record",      "Record payments",      "Finance", None),

    # ---- Procurement ----
    ("supplier.manage",       "Manage suppliers",        "Procurement", None),
    ("purchase_order.view",   "View purchase orders",    "Procurement", None),
    ("purchase_order.manage", "Manage purchase orders",  "Procurement", "Create/approve/GRN"),

    # ---- Payroll / Accounts ----
    ("payroll.view",     "View payroll",     "Payroll", None),
    ("payroll.manage",   "Manage payroll",   "Payroll", "Run/finalize/mark paid"),
    ("accounts.view",    "View accounts",    "Finance", None),

    # ---- System / Admin ----
    ("setting.modify",        "Modify system settings", "System", None),
    ("role.manage",           "Manage roles & grants",  "System", "Read + write to permission catalogue"),
    ("audit.view",            "View audit log",         "System", "Read /audit-logs"),
    ("audit.export",          "Export audit log",       "System", "CSV download for compliance"),
    ("report.export",         "Export reports",         "Reports","PDF / Excel exports"),
    ("notification.broadcast","Broadcast notifications","System", "Send to all staff"),
]


# =====================================================================
# DEFAULT GRANTS
# ---------------------------------------------------------------------
# Per-role permission lists. Re-running the script will INSERT missing
# grants but never DELETE existing ones — so manual overrides via the
# admin UI are safe.
# =====================================================================

# A wildcard role-grant: every permission. Used for SUPER_ADMIN.
ALL = ["*"]

# Self-service set every employee should get
SELF = [
    "attendance.view.self",
    "task.view.self",
]

DEFAULT_GRANTS = {

    # All-powerful — gets every permission in the catalogue
    "SUPER_ADMIN": ALL,

    # Legacy admin — gets every permission except role.manage
    "ADMIN": ALL,

    # MD — operational visibility + financial sign-off
    "MANAGING_DIRECTOR": ALL,

    # Legacy HR
    "HR": SELF + [
        "employee.view", "employee.create", "employee.update", "employee.delete",
        "employee.password-reset", "document.upload", "document.delete",
        "memo.view.all", "memo.create", "memo.update", "memo.delete", "memo.export",
        "leave.view.all", "leave.approve", "leave.reject", "leave.decide", "leave.policy.manage",
        "attendance.view.all", "attendance.view.team", "attendance.mark.others", "attendance.delete",
        "geofence.settings.update", "geofence.logs.view", "geofence.dashboard.view",
        "onboarding.invite", "onboarding.sessions.view", "onboarding.sessions.edit",
        "onboarding.sessions.approve", "onboarding.sessions.reject", "onboarding.sessions.delete",
        "onboarding.sessions.resend",
        "payroll.view", "payroll.manage",
        "audit.view", "audit.export", "report.export",
        "org.view", "org.manage",
    ],

    # BVC24 HR_MANAGER — same as legacy HR
    "HR_MANAGER": SELF + [
        "employee.view", "employee.create", "employee.update", "employee.delete",
        "employee.password-reset", "document.upload", "document.delete",
        "memo.view.all", "memo.create", "memo.update", "memo.delete", "memo.export",
        "leave.view.all", "leave.approve", "leave.reject", "leave.decide", "leave.policy.manage",
        "attendance.view.all", "attendance.view.team", "attendance.mark.others", "attendance.delete",
        "geofence.settings.update", "geofence.logs.view", "geofence.dashboard.view",
        "onboarding.invite", "onboarding.sessions.view", "onboarding.sessions.edit",
        "onboarding.sessions.approve", "onboarding.sessions.reject", "onboarding.sessions.delete",
        "onboarding.sessions.resend",
        "payroll.view", "payroll.manage",
        "audit.view", "report.export",
        "org.view",
    ],

    # Manager (legacy + new) — approval + own-team view
    "MANAGER": SELF + [
        "employee.view", "task.view.team", "task.view.all", "task.assign",
        "task.qc.approve", "task.qc.reject",
        "leave.view.all", "leave.approve", "leave.reject", "leave.decide",
        "attendance.view.team", "memo.view.all",
        "org.view",
    ],
    "PRODUCTION_HEAD": SELF + [
        "employee.view", "task.view.team", "task.view.all", "task.assign",
        "task.qc.approve", "task.qc.reject", "machine.view", "machine.update.stage",
        "leave.approve", "leave.reject", "leave.decide",
        "attendance.view.team", "org.view",
    ],

    "PRODUCTION_MANAGER": SELF + [
        "employee.view", "task.view.team", "task.view.all", "task.assign",
        "task.qc.approve", "task.qc.reject", "machine.view", "machine.update.stage",
        "leave.approve", "leave.reject", "leave.decide",
        "attendance.view.team", "org.view", "inventory.view", "inventory.consume",
    ],

    "SALES_MANAGER": SELF + [
        "employee.view", "customer.view", "customer.manage",
        "sales_order.view", "sales_order.manage", "quotation.manage",
        "leave.approve", "leave.reject", "attendance.view.team", "org.view",
    ],

    "PURCHASE_MANAGER": SELF + [
        "employee.view", "supplier.manage",
        "purchase_order.view", "purchase_order.manage",
        "leave.approve", "leave.reject", "attendance.view.team", "org.view",
    ],

    "INVENTORY_MANAGER": SELF + [
        "employee.view", "inventory.view", "inventory.purchase", "inventory.consume",
        "leave.approve", "leave.reject", "attendance.view.team", "org.view",
    ],

    "ACCOUNTS_MANAGER": SELF + [
        "employee.view", "accounts.view", "payment.record",
        "payroll.view",
        "leave.approve", "leave.reject", "attendance.view.team", "org.view",
        "report.export",
    ],

    # Shop-floor and QC inspectors
    "QC": SELF + [
        "task.view.team", "task.qc.approve", "task.qc.reject",
        "attendance.view.self",
    ],

    # Plain employees — self-service only
    "EMPLOYEE": SELF,
    "WORKER":   SELF,

    # Software Developer (legacy first role, used for dev users)
    "Software Developer": ALL,
}


# =====================================================================


def _ensure_catalogue(db) -> dict:
    """Insert any missing permissions. Returns code → ID map."""

    existing = {p.CODE: p for p in db.query(Permission).all()}
    added = 0
    updated_meta = 0

    for code, name, category, desc in CATALOGUE:
        if code in existing:
            # Backfill missing metadata if older row was minimal
            p = existing[code]
            if (not p.NAME)        and name:        p.NAME = name; updated_meta += 1
            if (not p.CATEGORY)    and category:    p.CATEGORY = category; updated_meta += 1
            if (not p.DESCRIPTION) and desc:        p.DESCRIPTION = desc; updated_meta += 1
            continue

        p = Permission(CODE=code, NAME=name, CATEGORY=category, DESCRIPTION=desc)
        db.add(p)
        added += 1

    db.flush()
    code_to_id = {p.CODE: p.ID for p in db.query(Permission).all()}

    print(f"  catalogue: added {added}, backfilled metadata on {updated_meta}, total now {len(code_to_id)}")
    return code_to_id


def _apply_grants(db, code_to_id: dict) -> tuple[int, int]:
    """Insert any missing role grants. Returns (grants_added, roles_touched)."""

    roles_by_name = {r.ROLE_NAME: r for r in db.query(Role).all()}

    existing_grants = {
        (rp.ROLE_ID, rp.PERMISSION_ID)
        for rp in db.query(RolePermission).all()
    }

    all_perm_ids = set(code_to_id.values())

    added = 0
    touched_roles = 0

    for role_name, codes in DEFAULT_GRANTS.items():
        role = roles_by_name.get(role_name)
        if not role:
            print(f"  skip: role {role_name!r} not in DB")
            continue

        # Expand "*" to mean every permission
        if codes == ALL:
            target_ids = all_perm_ids
        else:
            target_ids = {code_to_id[c] for c in codes if c in code_to_id}

        before = sum(1 for pid in target_ids if (role.ID, pid) not in existing_grants)
        if before > 0:
            touched_roles += 1

        for pid in target_ids:
            if (role.ID, pid) not in existing_grants:
                db.add(RolePermission(ROLE_ID=role.ID, PERMISSION_ID=pid))
                existing_grants.add((role.ID, pid))
                added += 1

    db.flush()
    return added, touched_roles


def main() -> int:
    p = argparse.ArgumentParser(description="Seed permission catalogue + default role grants.")
    p.add_argument("--dry-run", action="store_true",
                   help="Show what would change without committing.")
    args = p.parse_args()

    db = SessionLocal()
    try:
        print(f"[seed_permissions] starting (dry_run={args.dry_run})")

        code_to_id = _ensure_catalogue(db)
        grants_added, touched_roles = _apply_grants(db, code_to_id)

        if args.dry_run:
            db.rollback()
            print(f"  dry-run: would add {grants_added} grants across {touched_roles} role(s)")
        else:
            db.commit()
            print(f"  committed: added {grants_added} grants across {touched_roles} role(s)")

        # Final counts
        total_perms = db.query(Permission).count()
        total_grants = db.query(RolePermission).count()
        print(f"  final: {total_perms} permissions, {total_grants} grants")
        return 0
    except Exception as e:
        db.rollback()
        print(f"  FATAL: {type(e).__name__}: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
