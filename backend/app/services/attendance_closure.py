"""
Attendance closure for month-end.

At month-end the ERP needs a complete Attendance table — one row per
(employee, working day) — so the payroll generator can compute
salaries without silently dropping days.

Biometric punches only create rows for days people came in. Approved
leaves (Phase 1) create rows for CL/SL/EL/LOP. Everything else — days
the employee was neither present nor on leave — needs to be filled
in as STATUS=ABSENT before payroll runs.

close_attendance_month() does exactly that: iterates every working
day of a month and inserts ABSENT rows where nothing exists.

Working-day rule: Mon–Sat count as working. Sundays are off. Public
holidays aren't modelled yet — add via HOLIDAYS table later.
"""

from calendar import monthrange
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Attendance, Employee


def _iter_working_days(year: int, month: int):
    """Yield each Mon–Sat date in the given month."""
    _, last_day = monthrange(year, month)
    d = date(year, month, 1)
    end = date(year, month, last_day)
    while d <= end:
        # weekday(): Monday=0 ... Sunday=6
        if d.weekday() != 6:
            yield d
        d += timedelta(days=1)


def close_attendance_month(
    db: Session,
    *,
    year: int,
    month: int,
    vendor_id: Optional[int] = None,
    up_to_today_only: bool = True,
) -> dict:
    """Fill ABSENT rows for every working day that has neither a punch
    nor a leave row.

    Args:
        year, month: period to close (1..12)
        vendor_id: restrict to one vendor if given
        up_to_today_only: if True (default), skip future dates — useful
            when running mid-month for preview. Set False to close a
            completed month fully.

    Returns:
        {
          "year": ..., "month": ...,
          "employees_touched": N,
          "absent_rows_created": M,
          "working_days_in_period": D,
        }
    """
    # Load active employees (scope by vendor if requested)
    q = db.query(Employee).filter(Employee.STATUS == "ACTIVE")
    if vendor_id is not None:
        q = q.filter(Employee.VENDOR_ID == vendor_id)
    employees = q.all()

    today = date.today()
    working_days = [
        d for d in _iter_working_days(year, month)
        if (not up_to_today_only) or d <= today
    ]

    created = 0
    touched_emp_ids: set[str] = set()

    for emp in employees:
        # Preload the employee's existing dates for the month so we
        # only insert missing ones — one query per employee is cheaper
        # than per-day lookups on large teams.
        existing_dates = {
            r[0] for r in
            db.query(Attendance.DATE)
              .filter(Attendance.EMPLOYEE_ID == emp.ID)
              .filter(Attendance.DATE >= date(year, month, 1))
              .filter(Attendance.DATE <= working_days[-1] if working_days else date(year, month, 1))
              .all()
        }

        for d in working_days:
            if d in existing_dates:
                continue
            row = Attendance(
                EMPLOYEE_ID=emp.ID,
                DATE=d,
                STATUS="ABSENT",
                VENDOR_ID=getattr(emp, "VENDOR_ID", 1) or 1,
                REMARKS="auto:month-close",
            )
            db.add(row)
            created += 1
            touched_emp_ids.add(emp.ID)

        # Flush per employee so uniqueness violations from a race
        # don't blow up the whole batch.
        try:
            db.commit()
        except Exception:
            db.rollback()

    return {
        "year": year,
        "month": month,
        "vendor_id": vendor_id,
        "employees_touched": len(touched_emp_ids),
        "absent_rows_created": created,
        "working_days_in_period": len(working_days),
    }
