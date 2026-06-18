"""
backfill_emp_dept_from_session.py  —  One-shot data fix.

For every Employee approved through onboarding BEFORE the
invite-time DEPARTMENT_ID / DESIGNATION_ID started flowing through
to the Employee record (fixed in admin_approve_session today), copy
the values from their EmployeeOnboardingSession onto the Employee
row — if the session had values set AND the Employee currently
has NULL.

Idempotent: never overwrites existing department/designation, only
fills the gaps. Safe to re-run.

Usage:
  cd backend
  .\\venv\\Scripts\\python.exe -m scripts.backfill_emp_dept_from_session
"""

import sys

from app.database.database import SessionLocal
from app.models.models import Employee, EmployeeOnboardingSession


def main() -> int:

    db = SessionLocal()

    try:

        # All sessions that were approved AND have department or
        # designation info recorded at invite time
        sessions = (
            db.query(EmployeeOnboardingSession)
              .filter(
                  EmployeeOnboardingSession.STATUS == "APPROVED",
                  EmployeeOnboardingSession.EMPLOYEE_ID.isnot(None),
              )
              .all()
        )

        updated = 0
        skipped = 0
        unchanged = 0

        for s in sessions:

            if not s.DEPARTMENT_ID and not s.DESIGNATION_ID:
                # Nothing on this session to copy — invite was generated
                # before the dropdowns existed. Skip silently.
                skipped += 1
                continue

            emp = db.query(Employee).filter(Employee.ID == s.EMPLOYEE_ID).first()

            if not emp:
                continue

            changed = False

            if s.DEPARTMENT_ID and not emp.DEPARTMENT_ID:
                emp.DEPARTMENT_ID = s.DEPARTMENT_ID
                changed = True

            if s.DESIGNATION_ID and not emp.DESIGNATION_ID:
                emp.DESIGNATION_ID = s.DESIGNATION_ID
                changed = True

            if changed:
                updated += 1
                print(
                    f"  Updated emp={emp.EMPLOYEE_CODE or '-':<8} "
                    f"{emp.NAME or '-':<25} "
                    f"dept={s.DEPARTMENT_ID} desg={s.DESIGNATION_ID}"
                )
            else:
                unchanged += 1

        db.commit()

        print()
        print(f"Updated:    {updated}")
        print(f"Unchanged:  {unchanged}  (already had dept/desg set)")
        print(f"Skipped:    {skipped}    (session has no dept/desg)")
        print()
        print("Re-open the affected employee profile to verify.")

        return 0

    except Exception as e:

        db.rollback()
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    finally:

        db.close()


if __name__ == "__main__":
    sys.exit(main())
