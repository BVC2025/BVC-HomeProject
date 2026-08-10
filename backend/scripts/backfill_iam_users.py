"""
backfill_iam_users.py  —  Part 1, Phase 4.

Creates one IAMUser per existing Employee that has login credentials
(a non-null PASSWORD) and doesn't already have an IAMUser linked to
it. Idempotent — safe to re-run.

CRITICAL: the bcrypt password hash is copied VERBATIM from
Employee.PASSWORD, never re-hashed. Employee.PASSWORD is already a
bcrypt hash (or, for a handful of legacy seed rows, plaintext — see
verify_password's fallback); either way, copying the stored string
as-is preserves the exact same login behavior for /iam-login as the
employee already has for /login. Re-hashing an already-hashed value
would silently and permanently lock that person out.

Usage
-----
  python -m scripts.backfill_iam_users             # create missing rows
  python -m scripts.backfill_iam_users --dry-run    # report what would be created

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
from app.models.models import Employee
from app.models.rbac_models import IAMUser


def main() -> int:
    p = argparse.ArgumentParser(description="Create one IAMUser per Employee with login credentials.")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    db = SessionLocal()
    try:
        employees = db.query(Employee).filter(Employee.PASSWORD.isnot(None)).all()
        already_linked = {r.EMPLOYEE_ID for r in db.query(IAMUser).filter(IAMUser.EMPLOYEE_ID.isnot(None)).all()}

        created = []
        skipped_duplicate_username = []

        for emp in employees:

            if emp.ID in already_linked:
                continue

            if not emp.EMPLOYEE_CODE:
                # No login handle to reuse as USERNAME — nothing sane
                # to backfill for this row.
                continue

            existing_username = db.query(IAMUser).filter(IAMUser.USERNAME == emp.EMPLOYEE_CODE).first()
            if existing_username:
                skipped_duplicate_username.append(emp.EMPLOYEE_CODE)
                continue

            if args.dry_run:
                created.append(emp.EMPLOYEE_CODE)
                continue

            db.add(IAMUser(
                USERNAME=emp.EMPLOYEE_CODE,
                PASSWORD=emp.PASSWORD,          # verbatim copy — see module docstring
                VENDOR_ID=emp.VENDOR_ID,
                STATUS=emp.STATUS or "ACTIVE",
                EMPLOYEE_ID=emp.ID,
            ))
            created.append(emp.EMPLOYEE_CODE)

        if not args.dry_run and created:
            db.commit()

        print(f"{'created' if not args.dry_run else 'would create'}: {len(created)} IAM user(s)")
        if created:
            print("  " + ", ".join(created))

        if skipped_duplicate_username:
            print(f"skipped (USERNAME collision, needs manual review): {len(skipped_duplicate_username)}")
            print("  " + ", ".join(skipped_duplicate_username))

        return 0

    except Exception as e:
        db.rollback()
        print(f"FATAL: {type(e).__name__}: {e}")
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
