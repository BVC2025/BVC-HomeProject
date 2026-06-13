"""
mark_absent.py  —  Daily attendance reconciliation.

Run at end of day (e.g. 23:55) to mark every ACTIVE employee with
NO Attendance row for today as ABSENT. Without this, missing-day
rows silently stay missing and "Absent Today" counters under-report.

Usage
-----
  python -m scripts.mark_absent              # mark today
  python -m scripts.mark_absent --date 2026-06-10  # backfill one day
  python -m scripts.mark_absent --dry-run    # report what would happen

Safe to re-run: each (employee, date) pair has a unique constraint
on the table, so existing rows are skipped, not overwritten.

Exit codes
----------
  0  success (rows inserted or none needed)
  1  fatal error
"""

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

# Make the backend package importable when invoked as `python scripts/mark_absent.py`
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv
load_dotenv(_ROOT / ".env")

from sqlalchemy.exc import IntegrityError

from app.database.database import SessionLocal
from app.models.models import Employee, Attendance


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Mark no-show employees ABSENT for a given date.")
    p.add_argument("--date", help="ISO date (YYYY-MM-DD). Defaults to today.")
    p.add_argument("--dry-run", action="store_true", help="Report what would change but don't write.")
    return p.parse_args()


def mark_absent(target_date: date, dry_run: bool = False) -> dict:

    db = SessionLocal()
    try:
        # Active employees only (skip SUSPENDED / RESIGNED / TERMINATED)
        active = db.query(Employee).filter(Employee.STATUS == "ACTIVE").all()

        # Employees who already have ANY row for this date (CHECK_IN, ABSENT, anything)
        existing_emp_ids = {
            r[0]
            for r in db.query(Attendance.EMPLOYEE_ID)
                        .filter(Attendance.DATE == target_date)
                        .all()
        }

        to_mark = [e for e in active if e.ID not in existing_emp_ids]

        if dry_run:
            return {
                "date":          target_date.isoformat(),
                "active_count":  len(active),
                "already_have_row": len(active) - len(to_mark),
                "would_mark":    len(to_mark),
                "would_mark_codes": [e.EMPLOYEE_CODE for e in to_mark],
                "dry_run":       True,
            }

        inserted = 0
        skipped  = 0
        errors   = 0

        for emp in to_mark:

            row = Attendance(
                EMPLOYEE_ID = emp.ID,
                DATE        = target_date,
                STATUS      = "ABSENT",
            )

            try:
                db.add(row)
                db.flush()
                inserted += 1
            except IntegrityError:
                # Race condition: someone created the row between our
                # query and our insert. Safe to skip.
                db.rollback()
                skipped += 1
            except Exception as e:
                db.rollback()
                errors += 1
                print(f"[mark_absent] ERROR for {emp.EMPLOYEE_CODE}: {type(e).__name__}: {e}")

        db.commit()

        return {
            "date":          target_date.isoformat(),
            "active_count":  len(active),
            "already_have_row": len(active) - len(to_mark),
            "inserted":      inserted,
            "skipped_race":  skipped,
            "errors":        errors,
            "dry_run":       False,
        }
    finally:
        db.close()


def main() -> int:
    args = _parse_args()

    if args.date:
        try:
            target = date.fromisoformat(args.date)
        except ValueError:
            print(f"[mark_absent] Invalid --date '{args.date}'. Use YYYY-MM-DD.")
            return 1
    else:
        target = date.today()

    started = datetime.utcnow()
    print(f"[mark_absent] {started.isoformat()}  date={target.isoformat()}  dry_run={args.dry_run}")

    try:
        result = mark_absent(target, dry_run=args.dry_run)
    except Exception as e:
        print(f"[mark_absent] FATAL: {type(e).__name__}: {e}")
        return 1

    finished = datetime.utcnow()
    elapsed_ms = int((finished - started).total_seconds() * 1000)

    print(f"[mark_absent] done in {elapsed_ms}ms — {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
