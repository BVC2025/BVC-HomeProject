"""
seed_role_logins.py

Seed the ERP with 8 role-based logins (SUPER_ADMIN, ADMIN, SALES_MANAGER,
SALES_EXECUTIVE, SUPPORT_AGENT, MARKETING_USER, FINANCE, VIEWER) — each
mapped to a curated permission bundle and a demo employee row you can
log in as immediately.

Usage (from backend dir, with venv active):
    python scripts/seed_role_logins.py
    python scripts/seed_role_logins.py --wipe-and-reseed
    python scripts/seed_role_logins.py --list

Idempotent: re-running skips rows that already exist. Passes are ONLY set
on first creation. To reset a demo password afterward, use
`reset_admin_password.py --code <CODE> --password <new>`.

Login credentials printed at the end. Employee code = the role-name
(SUPERADMIN, SALESMGR, SALESEXEC, SUPPORT, MARKETING, FINANCE, VIEWER).
Default password for every demo user: bvc24@123
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from typing import Dict, List, Set

# Make `app.*` imports work when run as a script
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Load .env before anything queries the DB / auth helpers touch os.getenv
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env", override=True)

from app.database.database import SessionLocal

# IMPORTANT: import EVERY model module before ORM queries so SQLAlchemy
# can resolve cross-module relationship() strings (e.g. ProjectProductRequirement
# → ProductMaster). Without this, the first .query() call blows up with
# "InvalidRequestError: ... failed to locate a name ('ProductMaster')".
# This mirrors what main.py does at startup.
import app.models.models              # noqa: F401
import app.models.project_models      # noqa: F401
import app.models.inventory_models    # noqa: F401
import app.models.supplier_models     # noqa: F401
import app.models.email_models        # noqa: F401
import app.models.lead_models         # noqa: F401
import app.models.project_quotation_models  # noqa: F401
import app.models.rag_models          # noqa: F401
import app.models.whatsapp_models     # noqa: F401
import app.models.rbac_models         # noqa: F401
import app.models.auth_models         # noqa: F401
import app.models.employee_models     # noqa: F401
import app.models.leave_models        # noqa: F401
import app.models.calendar_models     # noqa: F401
try:
    import app.models.recruitment_chat_models  # noqa: F401
except ImportError:
    pass  # optional — only present after Deepthi chat-history feature
try:
    import app.models.customer_models  # noqa: F401
except ImportError:
    pass
try:
    import app.models.project_milestone_models  # noqa: F401
except ImportError:
    pass
try:
    import app.models.email_send_rule_models  # noqa: F401
except ImportError:
    pass

from app.models.models import Employee, Role, Permission, RolePermission, Vendor
from app.services.auth_service import hash_password
from app.services.permission_catalogue import ensure_permission_catalogue


DEFAULT_PASSWORD = "bvc24@123"
DEFAULT_VENDOR_ID = 1


# ---------------------------------------------------------------------
# Role → permission-code bundles.
#
# Each role gets a curated subset of the 192 permissions in the
# catalogue. Wildcards ("*") aren't supported by the model; we list
# concrete codes. SUPER_ADMIN gets everything via a special path.
# ---------------------------------------------------------------------

ROLE_BUNDLES: Dict[str, Dict[str, object]] = {

    "SUPER_ADMIN": {
        "description": "Full system access — users, roles, permissions, all data.",
        "employee_code": "SUPERADMIN",
        "employee_name": "Super Administrator",
        "email":         "superadmin@bvc24.local",
        # Special: gets EVERY permission in the catalogue (assigned below).
        "permissions":   "ALL",
    },

    "ADMIN": {
        "description": "CRM configuration, users, reports, org data.",
        "employee_code": "ADMIN",
        "employee_name": "System Administrator",
        "email":         "admin@bvc24.local",
        "permissions": [
            # Users / RBAC / org structure
            "iam_user.manage", "employee.view", "employee.create", "employee.update",
            "branch.view", "branch.manage",
            # Dashboard + admin
            "admin.dashboard.view", "audit.view",
            # CRM configuration
            "customer.view", "customer.manage",
            "customer.master.view", "customer.master.create", "customer.master.update",
            "customer.master.import", "customer.master.export",
            "lead.records.view", "lead.records.create", "lead.records.update",
            "lead.records.import", "lead.records.export", "lead.records.all_lead_view",
            "lead.config.view", "lead.config.manage",
            "lead.config.whatsapp_automation.view", "lead.config.whatsapp_automation.manage",
            "lead.config.auto_po_request.view",     "lead.config.auto_po_request.manage",
            "lead.live.view", "lead.polling_log.view",
            # Calendar (team view)
            "calendar.view", "calendar.manage", "calendar.team_view",
            # Communications
            "announcement.manage", "memo.view.all", "memo.create", "memo.update", "memo.export",
            # Approvals
            "approval.view", "approval.manage",
            # Reports
            "report.export",
            # Recruitment
            "recruitment.view", "recruitment.manage",
        ],
    },

    "SALES_MANAGER": {
        "description": "Team leads, opportunities, sales reports, customer data.",
        "employee_code": "SALESMGR",
        "employee_name": "Sales Manager",
        "email":         "salesmgr@bvc24.local",
        "permissions": [
            # Full customer + lead access
            "customer.view", "customer.manage",
            "customer.master.view", "customer.master.create", "customer.master.update", "customer.master.export",
            "customer.payments.view", "customer.payments.create", "customer.payments.update",
            "customer.task_timeline.view",
            "lead.records.view", "lead.records.create", "lead.records.update",
            "lead.records.export", "lead.records.convert", "lead.records.all_lead_view",
            "lead.records.filter_owner", "lead.records.filter_department",
            "lead.records.owner_select_create", "lead.records.owner_select_update",
            "lead.live.view",
            # Calendar w/ team view
            "calendar.view", "calendar.manage", "calendar.team_view",
            # Approvals (own team's items)
            "approval.view",
            # Reports
            "report.export",
            # Employees (view only — to see reports)
            "employee.view",
        ],
    },

    "SALES_EXECUTIVE": {
        "description": "Assigned leads / customers / opportunities only.",
        "employee_code": "SALESEXEC",
        "employee_name": "Sales Executive",
        "email":         "salesexec@bvc24.local",
        "permissions": [
            # Own leads + customers (no all_lead_view = filtered to assignee)
            "customer.view",
            "customer.master.view", "customer.master.update",
            "customer.payments.view",
            "customer.task_timeline.view",
            "lead.records.view", "lead.records.create", "lead.records.update",
            "lead.records.convert",
            # Calendar (own only, no team_view)
            "calendar.view", "calendar.manage",
        ],
    },

    "SUPPORT_AGENT": {
        "description": "Assigned customer / service tickets.",
        "employee_code": "SUPPORT",
        "employee_name": "Support Agent",
        "email":         "support-agent@bvc24.local",
        "permissions": [
            "helpdesk.view.all", "helpdesk.manage",
            "customer.view",
            "customer.master.view",
            "customer.task_timeline.view",
            # Calendar (own)
            "calendar.view", "calendar.manage",
        ],
    },

    "MARKETING_USER": {
        "description": "Campaigns, leads, marketing-related data.",
        "employee_code": "MARKETING",
        "employee_name": "Marketing User",
        "email":         "marketing@bvc24.local",
        "permissions": [
            # Leads (full pipeline visibility)
            "lead.records.view", "lead.records.create", "lead.records.update",
            "lead.records.export", "lead.records.import", "lead.records.all_lead_view",
            "lead.live.view", "lead.polling_log.view",
            # Announcements + memos (campaign messaging)
            "announcement.manage",
            "memo.view.all", "memo.create", "memo.update",
            # Customers (view for segmentation)
            "customer.view", "customer.master.view",
            # Calendar (own)
            "calendar.view", "calendar.manage",
        ],
    },

    "FINANCE": {
        "description": "Billing, invoices, payments.",
        "employee_code": "FINANCE",
        "employee_name": "Finance Officer",
        "email":         "finance@bvc24.local",
        "permissions": [
            # Payments (full — this is finance's home)
            "customer.payments.view", "customer.payments.create", "customer.payments.update",
            "customer.payments.delete", "customer.payments.manual_add", "customer.payments.view_proof",
            # Customer master (view/update — reconciliation)
            "customer.view", "customer.master.view", "customer.master.update", "customer.master.export",
            # Payroll
            "payroll.view", "payroll.manage",
            # Approvals (payment approvals)
            "approval.view", "approval.manage",
            # Reports
            "report.export",
            # Calendar
            "calendar.view", "calendar.manage",
        ],
    },

    "VIEWER": {
        "description": "Read-only — view data, no create/edit/delete.",
        "employee_code": "VIEWER",
        "employee_name": "Read-only Viewer",
        "email":         "viewer@bvc24.local",
        "permissions": [
            # View-only across major modules
            "customer.view", "customer.master.view", "customer.payments.view",
            "customer.task_timeline.view",
            "lead.records.view", "lead.live.view",
            "employee.view",
            "inventory.view", "inventory.items.view", "inventory.categories.view",
            "inventory.products.view", "inventory.batches.view", "inventory.movements.view",
            "calendar.view",
            "memo.view.all",
            "approval.view",
            "admin.dashboard.view",
            "recruitment.view",
            "helpdesk.view.all",
        ],
    },
}


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _ensure_vendor(db) -> None:
    """Make sure the demo vendor row exists so FK inserts don't fail."""
    if db.query(Vendor).filter(Vendor.ID == DEFAULT_VENDOR_ID).first():
        return
    v = Vendor(
        ID              = DEFAULT_VENDOR_ID,
        VENDOR_NAME     = "BVC24",
        ACCOUNT_STATUS  = "ACTIVE",
        ROOT_MFA_ENFORCED = 0,
        IAM_PASSWORD_MIN_LENGTH = 8,
    )
    db.add(v)
    db.commit()
    print(f"  Created vendor row (ID={DEFAULT_VENDOR_ID}, name=BVC24)")


def _get_or_create_role(db, role_name: str, description: str) -> Role:
    role = (
        db.query(Role)
          .filter(Role.NAME == role_name, Role.VENDOR_ID == DEFAULT_VENDOR_ID)
          .first()
    )
    if role:
        return role
    role = Role(
        VENDOR_ID   = DEFAULT_VENDOR_ID,
        NAME        = role_name,
        DESCRIPTION = description,
        IS_SYSTEM   = 1,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    print(f"  Created role {role_name} (id={role.ID})")
    return role


def _assign_permissions(db, role: Role, codes: List[str] | str, all_codes: Set[str]) -> int:
    """Attach permissions to a role. Idempotent — skips already-linked pairs.
    Returns the number of NEW rows added."""
    target_codes = all_codes if codes == "ALL" else set(codes)

    # Preload permission id lookup for the codes we care about
    perms = db.query(Permission).filter(Permission.CODE.in_(target_codes)).all()
    if len(perms) < len(target_codes):
        found = {p.CODE for p in perms}
        missing = sorted(target_codes - found)
        if missing:
            print(f"    ! {role.NAME}: {len(missing)} codes NOT in catalogue (skipping): {missing[:5]}{'...' if len(missing) > 5 else ''}")

    existing_pairs = {
        (rp.ROLE_ID, rp.PERMISSION_ID)
        for rp in db.query(RolePermission).filter(RolePermission.ROLE_ID == role.ID).all()
    }

    added = 0
    for p in perms:
        pair = (role.ID, p.ID)
        if pair in existing_pairs:
            continue
        db.add(RolePermission(ROLE_ID=role.ID, PERMISSION_ID=p.ID))
        added += 1

    if added:
        db.commit()
    return added


def _get_or_create_employee(db, role: Role, cfg: dict) -> Employee:
    emp = (
        db.query(Employee)
          .filter(Employee.EMPLOYEE_CODE == cfg["employee_code"])
          .first()
    )
    if emp:
        # Idempotent — link role in case it wasn't linked yet, but leave
        # the password alone (avoids accidentally locking existing users out).
        if emp.ROLE_ID != role.ID:
            emp.ROLE_ID = role.ID
            db.commit()
            print(f"  Re-linked existing employee {emp.EMPLOYEE_CODE} to role {role.NAME}")
        else:
            print(f"  Employee {emp.EMPLOYEE_CODE} already exists (unchanged)")
        return emp

    emp = Employee(
        ID             = str(uuid.uuid4()),
        EMPLOYEE_CODE  = cfg["employee_code"],
        NAME           = cfg["employee_name"],
        EMAIL          = cfg["email"],
        PASSWORD       = hash_password(DEFAULT_PASSWORD),
        ROLE_ID        = role.ID,
        STATUS         = "ACTIVE",
        VENDOR_ID      = DEFAULT_VENDOR_ID,
        PROFILE_SUBMITTED = 1,
    )
    db.add(emp)
    db.commit()
    print(f"  Created employee {emp.EMPLOYEE_CODE} (password={DEFAULT_PASSWORD})")
    return emp


# ---------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------

def cmd_seed(wipe: bool) -> None:
    db = SessionLocal()
    try:
        # Ensure the permission catalogue is up to date before we try to
        # link permissions to roles.
        print("Ensuring permission catalogue is populated...")
        ensure_permission_catalogue(db)

        # Full set of codes — used for SUPER_ADMIN's "ALL" bundle.
        all_codes: Set[str] = {p.CODE for p in db.query(Permission).all()}
        print(f"  Total permissions in catalogue: {len(all_codes)}")

        _ensure_vendor(db)

        if wipe:
            print("\n-- WIPE mode: dropping RolePermission links for the 8 roles...")
            for role_name in ROLE_BUNDLES:
                role = db.query(Role).filter(
                    Role.NAME == role_name, Role.VENDOR_ID == DEFAULT_VENDOR_ID,
                ).first()
                if role:
                    n = db.query(RolePermission).filter(RolePermission.ROLE_ID == role.ID).delete()
                    if n:
                        print(f"    cleared {n} permission links from {role_name}")
            db.commit()

        print("\n-- Seeding roles + demo users --")
        for role_name, cfg in ROLE_BUNDLES.items():
            print(f"\n▸ {role_name} — {cfg['description']}")
            role = _get_or_create_role(db, role_name, cfg["description"])
            added = _assign_permissions(db, role, cfg["permissions"], all_codes)
            if added:
                print(f"  Added {added} permission link(s)")
            _get_or_create_employee(db, role, cfg)

        print("\n" + "=" * 72)
        print("LOGIN CREDENTIALS — use these on the /login page")
        print("=" * 72)
        print(f"{'ROLE':<18}{'EMPLOYEE_CODE':<16}{'PASSWORD':<14}EMAIL")
        print("-" * 72)
        for role_name, cfg in ROLE_BUNDLES.items():
            print(f"{role_name:<18}{cfg['employee_code']:<16}{DEFAULT_PASSWORD:<14}{cfg['email']}")
        print("=" * 72)
        print("\nAll passwords set to the default on FIRST creation only.")
        print("To reset a password later:")
        print("  python scripts/reset_admin_password.py --code <CODE> --password <new>")
    finally:
        db.close()


def cmd_list() -> None:
    db = SessionLocal()
    try:
        print(f"{'ROLE':<18}{'EMPLOYEE_CODE':<16}{'STATUS':<10}{'PERMS':<8}EMAIL")
        print("-" * 78)
        for role_name in ROLE_BUNDLES:
            role = db.query(Role).filter(
                Role.NAME == role_name, Role.VENDOR_ID == DEFAULT_VENDOR_ID,
            ).first()
            if not role:
                print(f"{role_name:<18}{'(no role row yet)':<16}")
                continue
            n_perms = db.query(RolePermission).filter(RolePermission.ROLE_ID == role.ID).count()
            emps = db.query(Employee).filter(Employee.ROLE_ID == role.ID).all()
            if not emps:
                print(f"{role_name:<18}{'(no employees)':<16}{'-':<10}{n_perms:<8}")
                continue
            for e in emps:
                print(f"{role_name:<18}{(e.EMPLOYEE_CODE or '-'):<16}{(e.STATUS or '-'):<10}{n_perms:<8}{e.EMAIL or '-'}")
    finally:
        db.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wipe-and-reseed", action="store_true",
                    help="Drop existing role→permission links for these 8 roles and re-seed")
    ap.add_argument("--list", action="store_true",
                    help="List current role/employee/permission counts and exit")
    args = ap.parse_args()

    if args.list:
        cmd_list()
        return
    cmd_seed(wipe=args.wipe_and_reseed)


if __name__ == "__main__":
    main()
