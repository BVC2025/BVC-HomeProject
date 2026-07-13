"""
backfill_absent_days.py
-----------------------
For every active employee, walk from the 1st of the current month up
to today and make sure there's an attendance row for each working day
(Mon-Sat, excluding declared holidays).

Rules per (employee, date):

  1. Row already exists with STATUS in (PRESENT, LATE, HALF_DAY)   → skip
  2. Employee has an APPROVED leave request that covers this date  → skip
     (the leave is authoritative; we do NOT overwrite it as ABSENT)
  3. Otherwise → INSERT a row with STATUS='ABSENT', no CHECK_IN

Usage:
    cd backend
    .\\venv\\Scripts\\python.exe -m scripts.backfill_absent_days --dry-run
    .\\venv\\Scripts\\python.exe -m scripts.backfill_absent_days --apply
"""

import sys
from datetime import date, timedelta


def main() -> int:

    dry_run = "--dry-run" in sys.argv
    apply   = "--apply"   in sys.argv

    if not dry_run and not apply:
        print(__doc__)
        print("ERROR: pass --dry-run (preview) or --apply (write).",
              file=sys.stderr)
        return 2

    import os
    os.chdir(r"d:/PUVI-DOC/Vendor-based Manufacturing ERP/backend")
    from dotenv import load_dotenv; load_dotenv()

    from app.database.database import SessionLocal
    from app.models.models import (
        Employee, Attendance, LeaveRequest, HolidayCalendar,
    )

    db = SessionLocal()

    today = date.today()
    month_first = today.replace(day=1)

    # Working days in [month_first, today] excluding Sundays + declared holidays
    hols = {
        h.HOLIDAY_DATE for h in
        db.query(HolidayCalendar)
        .filter(
            HolidayCalendar.HOLIDAY_DATE >= month_first,
            HolidayCalendar.HOLIDAY_DATE <= today,
        ).all()
    }

    working_days = []
    d = month_first
    while d <= today:
        if d.weekday() != 6 and d not in hols:
            working_days.append(d)
        d += timedelta(days=1)

    print(f"Backfilling window: {month_first.isoformat()}  →  {today.isoformat()}")
    print(f"Working days in window: {len(working_days)}")
    print()

    active = (
        db.query(Employee)
        .filter(
            Employee.STATUS == "ACTIVE",
            Employee.EMPLOYEE_CODE.notin_(("ADMIN", "ADMIN2")),
        ).all()
    )
    print(f"Active employees to check: {len(active)}")
    print()

    plan = []   # (employee_code, name, date, action)

    for emp in active:

        # Pull all existing attendance rows for this employee in the window
        existing = {
            r.DATE: r for r in
            db.query(Attendance)
            .filter(
                Attendance.EMPLOYEE_ID == emp.ID,
                Attendance.DATE >= month_first,
                Attendance.DATE <= today,
            ).all()
        }

        # Pull approved leave requests that touch this window
        leave_days: set = set()
        approved = (
            db.query(LeaveRequest)
            .filter(
                LeaveRequest.EMPLOYEE_ID == emp.ID,
                LeaveRequest.STATUS == "APPROVED",
                LeaveRequest.LEAVE_TYPE != "PERMISSION",
                LeaveRequest.START_DATE <= today,
                LeaveRequest.END_DATE   >= month_first,
            ).all()
        )
        for lr in approved:
            span_start = max(lr.START_DATE, month_first)
            span_end   = min(lr.END_DATE,   today)
            cur = span_start
            while cur <= span_end:
                leave_days.add(cur)
                cur += timedelta(days=1)

        for wd in working_days:

            row = existing.get(wd)

            # 1. Already present / late / half-day → skip
            if row and (row.STATUS or "").upper() in ("PRESENT", "LATE", "HALF_DAY"):
                continue

            # 2. Approved leave covers this day → skip (leave is authoritative)
            if wd in leave_days:
                if not row:
                    # Optional: mark as LEAVE for UI clarity. Kept minimal
                    # for now — leave_request row already carries the truth.
                    pass
                continue

            # 3. Row already marked ABSENT → skip (idempotent)
            if row and (row.STATUS or "").upper() == "ABSENT":
                continue

            plan.append((emp.EMPLOYEE_CODE, emp.NAME, wd, "INSERT_ABSENT"))

    print(f"Rows to add: {len(plan)}")
    if plan:
        print()
        by_emp = {}
        for code, name, wd, _ in plan:
            by_emp.setdefault(code, []).append(wd)
        for code, days in sorted(by_emp.items()):
            days_str = ", ".join(str(d) for d in days[:5])
            more = f" (+{len(days) - 5} more)" if len(days) > 5 else ""
            print(f"  {code:<9} {days_str}{more}")

    if dry_run or not plan:
        if not plan:
            print("(Nothing to do — every day already has a row or is covered by leave.)")
        else:
            print()
            print("[dry-run] no writes made. Rerun with --apply to persist.")
        return 0

    # Apply
    from datetime import datetime as _dt
    print()
    print("Writing ABSENT rows...")

    inserted = 0
    for code, name, wd, _ in plan:
        emp = db.query(Employee).filter(Employee.EMPLOYEE_CODE == code).first()
        if not emp:
            continue

        # Extra safety — re-check just before insert
        already = (
            db.query(Attendance)
            .filter(
                Attendance.EMPLOYEE_ID == emp.ID,
                Attendance.DATE == wd,
            ).first()
        )
        if already:
            continue

        row = Attendance(
            EMPLOYEE_ID=emp.ID,
            DATE=wd,
            STATUS="ABSENT",
            LATE_MINUTES=0,
            WORKED_HOURS=0.0,
            OVERTIME_HOURS=0.0,
            VENDOR_ID=emp.VENDOR_ID or 1,
        )
        db.add(row)
        inserted += 1

    db.commit()
    print(f"Inserted {inserted} ABSENT row(s).")
    print()
    print("Refresh the Attendance page — missing days now show as ABSENT.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
