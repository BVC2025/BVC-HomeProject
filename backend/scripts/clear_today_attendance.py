"""
clear_today_attendance.py  —  One-shot cleanup.

Wipes today's Attendance rows for one (or all) ACTIVE employees so
that the geofenced Check In button reappears in their portal.

Why this exists
---------------
Earlier the /employee-login endpoint auto-created an Attendance row
with CHECK_IN=now (the login time), bypassing the geofence gate. That
behaviour has been removed, but rows already written by the previous
code remain — this script removes them.

Usage
-----
  cd backend
  # Clear one employee (by EMPLOYEE_CODE or UUID):
  .\\venv\\Scripts\\python.exe -m scripts.clear_today_attendance EMP101

  # Clear everyone (irreversible — use carefully):
  .\\venv\\Scripts\\python.exe -m scripts.clear_today_attendance --all
"""

import sys
from datetime import date

from app.database.database import SessionLocal
from app.models.models import Attendance, Employee


def main() -> int:

    if len(sys.argv) < 2:
        print("usage: python -m scripts.clear_today_attendance <EMP_CODE | UUID | --all>")
        return 2

    arg = sys.argv[1].strip()

    db = SessionLocal()

    try:

        today = date.today()

        q = db.query(Attendance).filter(Attendance.DATE == today)

        if arg == "--all":

            rows = q.all()

        else:

            emp = (
                db.query(Employee)
                .filter((Employee.ID == arg) | (Employee.EMPLOYEE_CODE == arg.upper()))
                .first()
            )

            if not emp:
                print(f"ERROR: employee {arg!r} not found")
                return 1

            rows = q.filter(Attendance.EMPLOYEE_ID == emp.ID).all()

        if not rows:
            print(f"No attendance rows to clear for {today.isoformat()}.")
            return 0

        for r in rows:
            ci = r.CHECK_IN.strftime("%H:%M") if r.CHECK_IN else "-"
            co = r.CHECK_OUT.strftime("%H:%M") if r.CHECK_OUT else "-"
            print(f"  Removing: emp={r.EMPLOYEE_ID[:8]}...  status={r.STATUS}  in={ci}  out={co}")
            db.delete(r)

        db.commit()

        print(f"Cleared {len(rows)} row(s) for {today.isoformat()}.")
        print("Refresh the employee portal — the Check In button should be enabled again.")

        return 0

    except Exception as e:

        db.rollback()
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    finally:

        db.close()


if __name__ == "__main__":
    sys.exit(main())
