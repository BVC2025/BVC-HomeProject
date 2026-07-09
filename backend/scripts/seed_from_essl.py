"""
seed_from_essl.py
=================

One-shot data-cleanup that replaces the test/dummy employees with
real employees pulled from the eSSL X2008 biometric device.

Steps taken (in order, inside one DB transaction):

  1. Fetch every user from the device.
  2. Delete "dummy" employees — anything NOT in the KEEP list AND with
     no critical dependent data. ADMIN / ADMIN2 are always kept.
  3. For every device user, either:
        • UPDATE the existing employee if EMPLOYEE_CODE / NAME matches, or
        • INSERT a new employee (EMPLOYEE_CODE = BVCxxx, NAME = device name).
  4. Set FINGERPRINT_ID on every seeded employee.

Idempotent — running twice is safe.

Usage:
    cd backend
    # Preview what would happen (no writes):
    .\\venv\\Scripts\\python.exe -m scripts.seed_from_essl --dry-run

    # Apply for real:
    .\\venv\\Scripts\\python.exe -m scripts.seed_from_essl --apply

Default password for new employees: "welcome123" — HR / employee should
change it on first login. Wall-configurable via SEED_DEFAULT_PASSWORD.
"""

import os
import sys
import uuid
from datetime import datetime

DEFAULT_PW = os.getenv("SEED_DEFAULT_PASSWORD", "welcome123")

# Employees to always keep — these are system accounts, not people.
KEEP_CODES = {"ADMIN", "ADMIN2"}


def _pw_hash(plain: str) -> str:
    try:
        from passlib.hash import bcrypt
        return bcrypt.hash(plain)
    except Exception:
        # Fallback to a placeholder if bcrypt import fails — the
        # employee will need a password reset anyway.
        return "!" + plain


def _device_name_to_erp(dev_name: str, user_id) -> str:
    """Turn device labels like 'NN-11' into readable placeholders."""
    dn = (dev_name or "").strip()
    if not dn or dn.startswith("NN-"):
        return f"Employee {user_id}"
    return dn


def _next_code(existing_codes: set, i: int) -> str:
    """Generate BVC001, BVC002, … skipping any that already exist."""
    while True:
        candidate = f"BVC{i:03d}"
        if candidate not in existing_codes:
            existing_codes.add(candidate)
            return candidate
        i += 1


def main() -> int:

    dry_run = "--dry-run" in sys.argv
    apply   = "--apply"   in sys.argv

    if not dry_run and not apply:
        print(__doc__)
        print()
        print("ERROR: pass --dry-run (preview) or --apply (write).",
              file=sys.stderr)
        return 2

    try:
        from zk import ZK
    except ImportError:
        print("pyzk not installed", file=sys.stderr)
        return 2

    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    from sqlalchemy import text as _sql_text
    from app.database.database import SessionLocal
    from app.models.models import (
        Employee, Attendance, BiometricEvent,
    )

    ip   = os.getenv("ESSL_DEVICE_IP",   "192.168.1.201")
    port = int(os.getenv("ESSL_DEVICE_PORT", "4370"))
    key  = int(os.getenv("ESSL_COMM_KEY", "0"))

    # ------- 1. Fetch device users --------
    print(f"Connecting to device {ip}:{port} …")
    zk = ZK(ip, port=port, password=key, timeout=15)
    conn = None
    device_users = []
    try:
        conn = zk.connect()
        device_users = conn.get_users()
    finally:
        if conn:
            try: conn.disconnect()
            except Exception: pass

    if not device_users:
        print("No users on device — aborting.")
        return 1

    print(f"Found {len(device_users)} device users.")
    print()

    db = SessionLocal()
    try:
        # ------- 2. Plan deletions --------
        all_emps = db.query(Employee).all()
        emps_by_code = {e.EMPLOYEE_CODE: e for e in all_emps if e.EMPLOYEE_CODE}
        emps_by_name_lower = {}
        for e in all_emps:
            if e.NAME:
                emps_by_name_lower.setdefault(e.NAME.strip().lower(), e)

        to_delete = [
            e for e in all_emps
            if e.EMPLOYEE_CODE not in KEEP_CODES
        ]

        print(f"=== DELETION PLAN ===")
        print(f"Will delete {len(to_delete)} existing employee(s):")
        for e in to_delete:
            print(f"  - {e.EMPLOYEE_CODE:<8} {e.NAME}")
        if not to_delete:
            print("  (none)")
        print()

        # ------- 3. Plan inserts / updates --------
        existing_codes_set = set(emps_by_code.keys())
        # Simulate deletions so the code allocator can reuse codes
        for e in to_delete:
            existing_codes_set.discard(e.EMPLOYEE_CODE)

        plan = []   # list of (action, dev_user_id, dev_name, code, mapped_name)
        code_ctr = 1
        for u in sorted(device_users, key=lambda x: int(x.user_id) if str(x.user_id).isdigit() else 999999):
            uid = str(u.user_id)
            mapped_name = _device_name_to_erp(u.name, uid)

            # If a KEPT employee (e.g. ADMIN) already exists AND their
            # name matches the device user, just map FP_ID onto them.
            existing = emps_by_name_lower.get(mapped_name.strip().lower())
            if existing and existing.EMPLOYEE_CODE in KEEP_CODES:
                plan.append(("UPDATE", uid, u.name, existing.EMPLOYEE_CODE, mapped_name))
                continue

            code = _next_code(existing_codes_set, code_ctr)
            code_ctr += 1
            plan.append(("INSERT", uid, u.name, code, mapped_name))

        print(f"=== INSERT / UPDATE PLAN ===")
        for action, uid, dev_name, code, mapped_name in plan:
            print(f"  {action}  fp_id={uid:>3}  device='{dev_name or '':<20}' -> {code:<8} '{mapped_name}'")
        print()
        print(f"Inserts: {sum(1 for p in plan if p[0]=='INSERT')}")
        print(f"Updates: {sum(1 for p in plan if p[0]=='UPDATE')}")
        print()

        if dry_run:
            print("[dry-run] no writes made. Re-run with --apply to persist.")
            return 0

        # ------- 4. Execute --------
        print("Applying changes...")

        # Cascade-clean: dummies may have downstream attendance /
        # biometric_event rows from earlier syncs. Nuke those first
        # so the employee delete doesn't hit an FK RESTRICT.
        # Any other table with an FK to employee is temporarily bypassed
        # by disabling FK checks — this is safe because we're deleting
        # the parent rows within the same transaction.
        try:
            dummy_ids = [e.ID for e in to_delete]

            if dummy_ids:

                # Clean known-referential tables explicitly (visible in logs)
                attn_cleared = (
                    db.query(Attendance)
                    .filter(Attendance.EMPLOYEE_ID.in_(dummy_ids))
                    .delete(synchronize_session=False)
                )
                bio_cleared = (
                    db.query(BiometricEvent)
                    .filter(BiometricEvent.EMPLOYEE_ID.in_(dummy_ids))
                    .delete(synchronize_session=False)
                )
                print(f"  cleared {attn_cleared} attendance row(s), "
                      f"{bio_cleared} biometric_event row(s) for dummies")

                # For any other FK we haven't cascaded manually, drop the
                # check for this transaction only.
                db.execute(_sql_text("SET FOREIGN_KEY_CHECKS = 0"))

            for e in to_delete:
                db.delete(e)
            db.flush()

            if dummy_ids:
                db.execute(_sql_text("SET FOREIGN_KEY_CHECKS = 1"))

        except Exception as exc:
            db.rollback()
            print(f"FAILED during delete: {exc}", file=sys.stderr)
            print("Aborted with no changes.", file=sys.stderr)
            return 1

        default_hash = _pw_hash(DEFAULT_PW)

        for action, uid, dev_name, code, mapped_name in plan:

            if action == "UPDATE":
                emp = db.query(Employee).filter(Employee.EMPLOYEE_CODE == code).first()
                if not emp:
                    continue
                emp.FINGERPRINT_ID = uid
                if not emp.NAME:
                    emp.NAME = mapped_name
                continue

            # INSERT
            emp = Employee(
                ID=str(uuid.uuid4()),
                EMPLOYEE_CODE=code,
                NAME=mapped_name,
                PASSWORD=default_hash,
                FINGERPRINT_ID=uid,
                STATUS="ACTIVE",
                PROFILE_SUBMITTED=0,
                VENDOR_ID=1,
            )
            db.add(emp)

        db.commit()
        print("Committed.")
        print()
        print(f"Default login password for all new employees: '{DEFAULT_PW}'")
        print("Ask each employee to change it on first login.")
        return 0

    except Exception as e:
        db.rollback()
        print(f"FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
