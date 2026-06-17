"""
seed_salaries.py  —  One-shot data fix.

Assign a default monthly SALARY (₹15,000–₹20,000) to every ACTIVE
employee that currently has no salary set. Existing salaries are
left untouched so this is safe to re-run.

Usage
-----
  cd backend
  .\\venv\\Scripts\\python.exe -m scripts.seed_salaries
"""

import sys

from app.database.database import SessionLocal
from app.models.models import Employee


# Tunables — adjust the band if the company policy changes.
MIN_SALARY = 15000.0
MAX_SALARY = 20000.0
DEFAULT_SALARY = 18000.0   # midpoint, used for all non-admin staff
ADMIN_SALARY   = 20000.0   # admins/system_administrator get the ceiling


def _is_admin_role(role_name: str) -> bool:

    return (role_name or "").strip().lower() in {
        "admin", "super_admin", "system_administrator"
    }


def main() -> int:

    db = SessionLocal()

    try:

        employees = db.query(Employee).filter(
            Employee.STATUS == "ACTIVE"
        ).all()

        # Build a role-id → role-name cache so admins get a different default
        role_cache = {}

        try:

            from app.models.models import Role

            for r in db.query(Role).all():

                role_cache[r.ID] = r.ROLE_NAME or ""

        except Exception:

            pass

        updated = 0

        skipped = 0

        rows = []

        for emp in employees:

            current = float(emp.SALARY or 0.0)

            if current > 0:

                skipped += 1

                rows.append((emp.EMPLOYEE_CODE, emp.NAME, current, "kept"))

                continue

            role_name = role_cache.get(emp.ROLE_ID, "")

            new_salary = ADMIN_SALARY if _is_admin_role(role_name) else DEFAULT_SALARY

            emp.SALARY = new_salary

            updated += 1

            rows.append((emp.EMPLOYEE_CODE, emp.NAME, new_salary, "seeded"))

        db.commit()

        print()
        print(f"{'CODE':<10} {'NAME':<28} {'SALARY':>12}   STATUS")
        print("-" * 64)

        for code, name, salary, status in rows:

            display_name = (name or "")[:27]

            print(f"{code or '—':<10} {display_name:<28} ₹{salary:>10,.0f}   {status}")

        print("-" * 64)
        print(f"Updated: {updated}     Already set (skipped): {skipped}")
        print()
        print(
            f"Done. Range used: ₹{int(MIN_SALARY):,}–₹{int(MAX_SALARY):,}. "
            "Re-run /payroll to refresh salaries with the new values."
        )

        return 0

    except Exception as e:

        db.rollback()

        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)

        return 1

    finally:

        db.close()


if __name__ == "__main__":

    sys.exit(main())
