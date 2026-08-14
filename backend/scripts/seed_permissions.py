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
from app.services.permission_catalogue import ensure_permission_catalogue

# Every model module must be imported before the first query triggers
# SQLAlchemy's mapper configuration — otherwise cross-module string
# relationship() references (e.g. SupplierProduct -> InventoryCategory)
# fail to resolve. Mirrors the import block in app/main.py.
import app.models.project_models     # noqa: F401
import app.models.inventory_models   # noqa: F401
import app.models.supplier_models    # noqa: F401
import app.models.email_models       # noqa: F401
import app.models.lead_models        # noqa: F401
import app.models.project_quotation_models  # noqa: F401
import app.models.rag_models         # noqa: F401
import app.models.whatsapp_models    # noqa: F401
import app.models.rbac_models        # noqa: F401
import app.models.auth_models        # noqa: F401


# CATALOGUE now lives in app/services/permission_catalogue.py (shared
# with main.py's startup sequence, which seeds it on every boot).


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

    # MD — read-only oversight across every module (NOT full access —
    # this role's own DB description says "read-only oversight"; it
    # was previously miscoded as the ALL wildcard, which contradicted
    # that and gave it the same unrestricted access as SUPER_ADMIN/ADMIN).
    "MANAGING_DIRECTOR": SELF + [
        "employee.view",
        "memo.view.all",
        "leave.view.all",
        "attendance.view.all", "attendance.view.team",
        "geofence.logs.view", "geofence.dashboard.view",
        "onboarding.sessions.view",
        "task.view.all", "task.view.team",
        "org.view",
        "project.view",
        "inventory.view",
        "machine.view",
        "customer.view",
        "sales_order.view",
        "purchase_order.view",
        "payroll.view",
        "accounts.view",
        "audit.view",
        "report.export",
        "rag.query",
        "recruitment.view",
        "production.view", "quality.view", "work_center.view",
        "helpdesk.view.all",
    ],

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
        "recruitment.view", "recruitment.manage",
        "helpdesk.view.all", "helpdesk.manage",
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
        "recruitment.view", "recruitment.manage",
        "helpdesk.view.all", "helpdesk.manage",
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
        "production.view", "production.manage", "quality.view", "work_center.view",
    ],

    "PRODUCTION_MANAGER": SELF + [
        "employee.view", "task.view.team", "task.view.all", "task.assign",
        "task.qc.approve", "task.qc.reject", "machine.view", "machine.update.stage",
        "leave.approve", "leave.reject", "leave.decide",
        "attendance.view.team", "org.view", "inventory.view", "inventory.consume",
        "production.view", "production.manage", "quality.view", "work_center.view",
    ],

    "SALES_MANAGER": SELF + [
        "employee.view", "customer.view", "customer.manage",
        "sales_order.view", "sales_order.manage", "quotation.manage",
        "leave.approve", "leave.reject", "attendance.view.team", "org.view",
        "rag.query",
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
        "quality.view", "quality.manage",
    ],

    # Plain employees — self-service only
    "EMPLOYEE": SELF,
    "WORKER":   SELF,

    # Software Developer (legacy first role, used for dev users)
    "Software Developer": ALL,
}


# =====================================================================


def _apply_grants(db, code_to_id: dict) -> tuple[int, int]:
    """Insert any missing role grants. Returns (grants_added, roles_touched)."""

    roles_by_name = {r.NAME: r for r in db.query(Role).all()}

    # Standard roles (DEFAULT_GRANTS) are expected to exist in every real
    # deployment, but a fresh/dev DB may not have them yet. Auto-create
    # any that are missing instead of silently skipping their grants —
    # otherwise the permission catalogue looks "empty" for roles that
    # were never given a Role row in the first place. IS_SYSTEM=1 so
    # delete_role() (organization.py) refuses to let these be deleted,
    # matching how the other seeded standard roles already behave.
    default_vendor_id = next(
        (r.VENDOR_ID for r in roles_by_name.values() if r.VENDOR_ID is not None),
        1,
    )
    created_roles = 0
    for role_name in DEFAULT_GRANTS:
        if role_name in roles_by_name:
            continue
        role = Role(
            NAME=role_name,
            DESCRIPTION=f"Standard role: {role_name}",
            IS_SYSTEM=1,
            VENDOR_ID=default_vendor_id,
        )
        db.add(role)
        db.flush()
        roles_by_name[role_name] = role
        created_roles += 1
    if created_roles:
        print(f"  roles: created {created_roles} missing standard role(s)")

    existing_grants = {
        (rp.ROLE_ID, rp.PERMISSION_ID)
        for rp in db.query(RolePermission).all()
    }

    all_perm_ids = set(code_to_id.values())

    added = 0
    touched_roles = 0

    for role_name, codes in DEFAULT_GRANTS.items():
        role = roles_by_name.get(role_name)

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
    p = argparse.ArgumentParser(description="Seed the permission catalogue (codes only, by default).")
    p.add_argument("--dry-run", action="store_true",
                   help="Show what would change without committing.")
    p.add_argument("--apply-defaults", action="store_true",
                   help="Also create the ~16 standard roles (if missing) and apply "
                        "DEFAULT_GRANTS to them. Off by default — the product "
                        "requirement is that every role (except SUPER_ADMIN) starts "
                        "with zero grants; an admin enables permissions manually "
                        "per role from the RBAC UI.")
    args = p.parse_args()

    db = SessionLocal()
    try:
        print(f"[seed_permissions] starting (dry_run={args.dry_run}, apply_defaults={args.apply_defaults})")

        catalogue_result = ensure_permission_catalogue(db)
        code_to_id = catalogue_result["code_to_id"]
        print(
            f"  catalogue: added {catalogue_result['added']}, "
            f"backfilled metadata on {catalogue_result['updated_meta']}, "
            f"total now {len(code_to_id)}"
        )

        if args.apply_defaults:
            grants_added, touched_roles = _apply_grants(db, code_to_id)
        else:
            grants_added, touched_roles = 0, 0
            print("  grants: skipped (pass --apply-defaults to also seed default role grants)")

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
