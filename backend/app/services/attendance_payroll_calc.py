"""
Attendance -> payroll calculator, driven off the Attendance rows the
biometric handler already writes. Read-only over the biometric side —
it never modifies the raw punches or the OT split the biometric
handler recorded. All new rules are applied on top of the raw data
here, in one place.

Rules encoded (as of this file's build):
  1. Working days for the month
       = calendar days − Sundays − Holiday rows (best-effort).
       Overrideable via `working_days_override` kwarg for HR who
       want a fixed 26.
  2. Present days     = attendance rows with STATUS in {PRESENT, LATE}.
  3. Late arrivals    = attendance rows with STATUS == LATE.
  4. Casual-leave used this month
       = approved / pending LeaveRequest days for the employee whose
       LEAVE_TYPE is CASUAL and whose START_DATE falls in the month.
  5. Absent days      = attendance rows with STATUS == ABSENT
                        (raw absence from the biometric side).
  6. Unpaid absent days
       = absent_days − CL_used_in_month     (CL is paid).
  7. Half-day penalty for lateness
       Every 3 late arrivals in the month costs 0.5 day of salary.
       penalty_days = (late_arrivals // 3) * 0.5
  8. Gross OT hours    = SUM(OVERTIME_HOURS) over the month
                         (raw value from biometric handler which
                         splits at 18:00).
  9. NEW: post-19:00 OT rule
       The 18:00 -> 19:00 hour is REGULAR work, not OT.
       For each day the raw OT_HOURS is trimmed by up to 1 hour
       (or by the exact 18:00→19:00 minutes if CHECK_OUT sits inside
       that window).
 10. NEW: OT hours offset by late-arrival minutes
       total_late_minutes across the month is subtracted from OT
       minutes before the OT pay is calculated. Only the surplus
       actually gets paid as OT.
 11. Per-day rate     = BASIC_SALARY / WORKING_DAYS.
 12. Absence deduction = per_day * (unpaid_absent_days + half_day_penalty).
 13. OT pay
       hourly_ot_rate = (BASIC_SALARY / WORKING_DAYS / 8) * 1.5
       net_ot_hours   = ROUND(net_ot_minutes / 60, 2)
       ot_pay         = net_ot_hours * hourly_ot_rate

Nothing here writes back to Attendance / BiometricEvent / PayrollSlip.
The caller (usually the import-summary endpoint) uses the returned
list to render a UI table.
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Attendance,
    Department,
    Designation,
    Employee,
    LeaveRequest,
)

try:
    from app.models.models import HolidayCalendar  # noqa: F401
    _HAS_HOLIDAY = True
except Exception:  # older schema — degrade gracefully
    HolidayCalendar = None  # type: ignore
    _HAS_HOLIDAY = False


# =====================================================================
# Tunable constants — the numbers the user cares about
# =====================================================================

# Regular shift boundaries. The biometric handler uses OFFICE_END=18:00
# when it splits raw punches. THIS file re-applies a *stricter* payroll
# rule: only time past OT_START_FOR_PAYROLL earns OT pay.
OFFICE_END               = time(18, 0)
OT_START_FOR_PAYROLL     = time(19, 0)   # <- 7 PM cutoff per HR ask

# Employee is LATE if CHECK_IN.time() > this
OFFICIAL_START           = time(9, 15)

# Every N late arrivals in a month costs one half-day of salary
LATE_ARRIVALS_PER_HALF_DAY_PENALTY = 3
HALF_DAY_PENALTY_UNIT               = 0.5

# Standard-issue payroll constants
OT_MULTIPLIER            = 1.5   # OT rate = 1.5 × normal hourly


# =====================================================================
# Helpers
# =====================================================================

def _month_bounds(year: int, month: int) -> tuple[date, date]:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def _working_days_default(
    db: Session,
    year: int,
    month: int,
    vendor_id: Optional[int],
) -> int:
    """Calendar days in the month minus Sundays minus holiday rows.
    Falls back to (days − Sundays) if HolidayCalendar isn't present."""

    start, end = _month_bounds(year, month)
    total = 0
    d = start
    while d <= end:
        if d.weekday() != 6:   # 6 = Sunday
            total += 1
        d += timedelta(days=1)

    if _HAS_HOLIDAY and vendor_id is not None:
        try:
            holiday_dates = {
                h.HOLIDAY_DATE
                for h in db.query(HolidayCalendar)
                             .filter(HolidayCalendar.VENDOR_ID == vendor_id)
                             .filter(HolidayCalendar.HOLIDAY_DATE >= start)
                             .filter(HolidayCalendar.HOLIDAY_DATE <= end)
                             .all()
                if getattr(h, "HOLIDAY_DATE", None) is not None
            }
            for h in holiday_dates:
                if h and h.weekday() != 6:  # don't double-count Sundays
                    total -= 1
        except Exception:
            # Older schema / column mismatch — accept the without-holiday count.
            pass

    return max(1, total)


def _minutes_between(a: datetime, b: datetime) -> float:
    return max(0.0, (b - a).total_seconds() / 60.0)


def _late_minutes(check_in: Optional[datetime]) -> float:
    """Positive minutes past OFFICIAL_START. 0 if the row's check-in
    is at or before OFFICIAL_START, or if it's missing."""

    if not check_in:
        return 0.0
    official = datetime.combine(check_in.date(), OFFICIAL_START)
    if check_in <= official:
        return 0.0
    return _minutes_between(official, check_in)


def _ot_trim_for_18_to_19(
    check_out: Optional[datetime],
    raw_ot_hours: float,
) -> float:
    """The biometric handler counts everything after 18:00 as OT. The
    HR rule says 18:00–19:00 is REGULAR — subtract that hour from the
    raw OT before payroll.

    Concretely: if CHECK_OUT < 19:00, ALL of that day's raw OT was
    inside the 18:00-19:00 window → strip it entirely. If CHECK_OUT
    >= 19:00, strip a full hour."""

    if not raw_ot_hours or raw_ot_hours <= 0:
        return 0.0
    if not check_out:
        return float(raw_ot_hours)

    ot_start_dt = datetime.combine(check_out.date(), OT_START_FOR_PAYROLL)

    if check_out < ot_start_dt:
        return 0.0                          # entire "OT" was in 18-19 window
    minutes_past_19 = _minutes_between(ot_start_dt, check_out)
    # Cap at raw — never invent OT that wasn't in the raw row.
    return round(min(raw_ot_hours, minutes_past_19 / 60.0), 4)


# =====================================================================
# The main entry point
# =====================================================================

def compute_monthly_calculation(
    db: Session,
    *,
    year: int,
    month: int,
    vendor_id: Optional[int] = None,
    employee_ids: Optional[List[str]] = None,
    working_days_override: Optional[int] = None,
) -> List[dict]:
    """Return one dict per employee containing every number HR needs
    to see for the imported month. See module docstring for the
    complete rule list."""

    start, end = _month_bounds(year, month)

    working_days = (
        working_days_override
        if working_days_override and working_days_override > 0
        else _working_days_default(db, year, month, vendor_id)
    )

    # ---- Load employees (scoped, if requested) ---------------------
    eq = db.query(Employee)
    if vendor_id is not None:
        eq = eq.filter(Employee.VENDOR_ID == vendor_id)
    if employee_ids:
        eq = eq.filter(Employee.ID.in_(employee_ids))
    else:
        eq = eq.filter(Employee.STATUS == "ACTIVE")
    employees = eq.order_by(Employee.EMPLOYEE_CODE.asc()).all()

    if not employees:
        return []

    emp_ids = [e.ID for e in employees]

    # Dept + designation name lookup (small N, one query each)
    dept_map: dict = {}
    desig_map: dict = {}
    dept_ids  = {e.DEPARTMENT_ID  for e in employees if e.DEPARTMENT_ID}
    desig_ids = {e.DESIGNATION_ID for e in employees if e.DESIGNATION_ID}
    if dept_ids:
        for d in db.query(Department).filter(Department.ID.in_(dept_ids)).all():
            dept_map[d.ID] = getattr(d, "NAME", None) or getattr(d, "DEPARTMENT_NAME", None)
    if desig_ids:
        for de in db.query(Designation).filter(Designation.ID.in_(desig_ids)).all():
            desig_map[de.ID] = getattr(de, "NAME", None) or getattr(de, "DESIGNATION_NAME", None)

    # ---- Load attendance rows for the month, one bulk query --------
    att_rows = (
        db.query(Attendance)
          .filter(Attendance.EMPLOYEE_ID.in_(emp_ids))
          .filter(Attendance.DATE >= start)
          .filter(Attendance.DATE <= end)
          .all()
    )
    att_by_emp: dict = {}
    for r in att_rows:
        att_by_emp.setdefault(r.EMPLOYEE_ID, []).append(r)

    # ---- Load casual-leave usage for the month (approved + pending) -
    cl_rows = (
        db.query(LeaveRequest)
          .filter(LeaveRequest.EMPLOYEE_ID.in_(emp_ids))
          .filter(LeaveRequest.LEAVE_TYPE == "CASUAL")
          .filter(LeaveRequest.START_DATE <= end)
          .filter(LeaveRequest.END_DATE   >= start)
          .filter(LeaveRequest.STATUS.in_(["APPROVED", "PENDING"]))
          .all()
    )
    cl_days_by_emp: dict = {}
    for lr in cl_rows:
        # Days that overlap this month — clip to month bounds.
        overlap_start = max(lr.START_DATE, start)
        overlap_end   = min(lr.END_DATE,   end)
        days = (overlap_end - overlap_start).days + 1
        if lr.DAYS is not None and lr.DAYS < 1.0:
            days = float(lr.DAYS)
        cl_days_by_emp[lr.EMPLOYEE_ID] = cl_days_by_emp.get(lr.EMPLOYEE_ID, 0.0) + max(0.0, days)

    # ---- Per-employee summary --------------------------------------
    summaries: List[dict] = []
    for emp in employees:
        rows = att_by_emp.get(emp.ID, [])

        present_days = sum(
            1 for r in rows if (r.STATUS or "").upper() in ("PRESENT", "LATE")
        )
        absent_days = sum(
            1 for r in rows if (r.STATUS or "").upper() == "ABSENT"
        )
        late_arrivals = sum(
            1 for r in rows if (r.STATUS or "").upper() == "LATE"
        )
        cl_used = round(cl_days_by_emp.get(emp.ID, 0.0), 1)

        # Unpaid absence = raw absent minus paid CL used
        unpaid_absent = max(0.0, absent_days - cl_used)

        # Half-day penalty from lateness
        half_day_penalty = (
            (late_arrivals // LATE_ARRIVALS_PER_HALF_DAY_PENALTY)
            * HALF_DAY_PENALTY_UNIT
        )

        # OT hours — trim 18-19 window on each day, then offset late minutes
        gross_ot_minutes = 0.0
        for r in rows:
            trimmed = _ot_trim_for_18_to_19(r.CHECK_OUT, r.OVERTIME_HOURS or 0.0)
            gross_ot_minutes += trimmed * 60.0

        total_late_minutes = sum(_late_minutes(r.CHECK_IN) for r in rows)
        net_ot_minutes = max(0.0, gross_ot_minutes - total_late_minutes)
        net_ot_hours = round(net_ot_minutes / 60.0, 2)

        # Payroll math
        basic_salary = float(emp.SALARY or 0.0)
        per_day_rate = basic_salary / working_days if working_days else 0.0
        absence_deduction = round(
            per_day_rate * (unpaid_absent + half_day_penalty), 2
        )
        hourly_rate = (per_day_rate / 8.0) if per_day_rate else 0.0
        ot_pay = round(net_ot_hours * hourly_rate * OT_MULTIPLIER, 2)
        net_pay = round(basic_salary - absence_deduction + ot_pay, 2)

        summaries.append({
            "employee_id":   emp.ID,
            "employee_code": emp.EMPLOYEE_CODE,
            "name":          emp.NAME,
            "designation":   desig_map.get(emp.DESIGNATION_ID),
            "department":    dept_map.get(emp.DEPARTMENT_ID),
            "basic_salary":  basic_salary,
            "working_days":  working_days,

            "present_days":  present_days,
            "absent_days":   absent_days,
            "cl_used":       cl_used,
            "unpaid_absent": round(unpaid_absent, 2),

            "late_arrivals":     late_arrivals,
            "half_day_penalty":  half_day_penalty,
            "late_minutes":      round(total_late_minutes, 1),

            "gross_ot_hours":    round(gross_ot_minutes / 60.0, 2),
            "net_ot_hours":      net_ot_hours,

            "per_day_rate":      round(per_day_rate, 2),
            "absence_deduction": absence_deduction,
            "ot_pay":            ot_pay,
            "net_pay":           net_pay,
        })

    return summaries
