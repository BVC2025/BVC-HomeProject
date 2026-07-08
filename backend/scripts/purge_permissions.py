"""
purge_permissions.py  —  One-shot cleanup for stale permission rows.

Removes rows from the `leave_request` table where LEAVE_TYPE = 'PERMISSION'.
Useful after the auto-record feature (that created a permission row on
every late login) was removed — this wipes the accumulated backlog so
the balance ring returns to 0.0 / 4.0h.

Modes
-----
  --auto        Only auto-recorded rows (REASON starts with 'Auto-recorded:').
                This is what you almost always want.
  --all         Every permission row, manual + auto (irreversible!).
  --employee X  Restrict to one employee (EMP_CODE or UUID). Combines
                with --auto or --all.
  --dry-run     Print what would be deleted without touching the DB.

Usage
-----
  cd backend

  # Wipe all AUTO-recorded permissions for everyone (recommended)
  .\\venv\\Scripts\\python.exe -m scripts.purge_permissions --auto

  # Preview first — no writes
  .\\venv\\Scripts\\python.exe -m scripts.purge_permissions --auto --dry-run

  # Wipe every permission (manual submissions too) — irreversible
  .\\venv\\Scripts\\python.exe -m scripts.purge_permissions --all

  # Wipe only auto rows for one employee
  .\\venv\\Scripts\\python.exe -m scripts.purge_permissions --auto --employee EMP105
"""

import sys

from app.database.database import SessionLocal
from app.models.models import Employee, LeaveRequest


def parse_args(argv):

    args = {
        "auto":     False,
        "all":      False,
        "employee": None,
        "dry_run":  False,
    }

    i = 1
    while i < len(argv):
        tok = argv[i].strip()
        if tok == "--auto":
            args["auto"] = True
        elif tok == "--all":
            args["all"] = True
        elif tok == "--dry-run":
            args["dry_run"] = True
        elif tok == "--employee" and i + 1 < len(argv):
            args["employee"] = argv[i + 1].strip()
            i += 1
        else:
            print(f"ERROR: unknown argument {tok!r}", file=sys.stderr)
            return None
        i += 1

    if not args["auto"] and not args["all"]:
        print(
            "ERROR: must pass either --auto (safe) or --all (irreversible).",
            file=sys.stderr,
        )
        return None

    if args["auto"] and args["all"]:
        print(
            "ERROR: --auto and --all are mutually exclusive.",
            file=sys.stderr,
        )
        return None

    return args


def main() -> int:

    args = parse_args(sys.argv)
    if args is None:
        print(__doc__)
        return 2

    db = SessionLocal()

    try:

        q = db.query(LeaveRequest).filter(
            LeaveRequest.LEAVE_TYPE == "PERMISSION"
        )

        # Restrict to auto-recorded rows unless --all was passed.
        # The auto-record used to prefix REASON with "Auto-recorded:".
        if args["auto"]:
            q = q.filter(LeaveRequest.REASON.like("Auto-recorded:%"))

        # Restrict to one employee if requested.
        if args["employee"]:
            key = args["employee"]
            emp = (
                db.query(Employee)
                .filter(
                    (Employee.ID == key) |
                    (Employee.EMPLOYEE_CODE == key.upper())
                )
                .first()
            )
            if not emp:
                print(f"ERROR: employee {key!r} not found", file=sys.stderr)
                return 1
            q = q.filter(LeaveRequest.EMPLOYEE_ID == emp.ID)

        rows = q.all()

        if not rows:
            print("No permission rows match — nothing to delete.")
            return 0

        print(f"Found {len(rows)} permission row(s):")
        for r in rows:
            emp_short = (r.EMPLOYEE_ID or "?")[:8]
            hours = float(r.DURATION_HOURS or 0)
            reason_snip = (r.REASON or "").replace("\n", " ")[:60]
            print(
                f"  id={r.ID:>5}  emp={emp_short}...  date={r.START_DATE}  "
                f"{hours:>4.1f}h  status={r.STATUS}  reason={reason_snip!r}"
            )

        if args["dry_run"]:
            print(f"\n[dry-run] Would have deleted {len(rows)} row(s). Nothing written.")
            return 0

        for r in rows:
            db.delete(r)

        db.commit()

        print(f"\nDeleted {len(rows)} permission row(s).")
        print("Refresh the Permission page — the balance ring should now show 4.0h remaining.")

        return 0

    except Exception as e:

        db.rollback()
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    finally:

        db.close()


if __name__ == "__main__":
    sys.exit(main())
