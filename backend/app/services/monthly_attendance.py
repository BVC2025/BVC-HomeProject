"""
Monthly attendance summary — one source of truth used by:
  - HR admin: sidebar → Attendance → Monthly Summary
  - Employee self-service: My Attendance → month picker
  - Cron: 1st of each month, generates memos + snapshots

The public entry point is `compute_monthly_summary()` which takes an
employee + year/month and returns the full dict the two API endpoints
(and the monthly memo evaluator) all consume.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from calendar import monthrange
from typing import Optional, List, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.models.models import (
    Employee,
    Attendance,
    LeaveRequest,
    LeaveBalance,
    EmployeeMemo,
    HolidayCalendar,
)


# Business rules — matched to what the user confirmed:
#   - 5 or more late arrivals in the month → warning-memo eligible
#   - 1 or more unpaid absences → warning-memo eligible
#   - 5 or more missed check-outs → warning-memo eligible
#   - 0 late AND 0 unpaid absences → appreciation-memo eligible
# Change these once and everything downstream (HR view, memo cron,
# employee portal) uses the new numbers.
WORK_START = time(9, 15)
LATE_WARNING_THRESHOLD = 5
UNPAID_ABSENCE_WARNING_THRESHOLD = 1
MISSED_CHECKOUT_WARNING_THRESHOLD = 5


# ---------------------------------------------------------------------
# Working-day helpers
# ---------------------------------------------------------------------

def month_bounds(year: int, month: int) -> tuple[date, date]:
    """Return (first_day, last_day) inclusive for the given month."""
    first = date(year, month, 1)
    last_day_num = monthrange(year, month)[1]
    last = date(year, month, last_day_num)
    return first, last


def working_days_in_month(
    db: Session, year: int, month: int, vendor_id: int = 1
) -> int:
    """Count Mon–Sat days in the month, minus configured holidays.

    Sunday is treated as the weekly off. If your company works
    six days a week (typical for BVC-style manufacturing), Sundays
    are excluded from the denominator so employees aren't penalised.
    Adjust HOLIDAY_WEEKDAYS below if you shift to a 5-day week.
    """
    HOLIDAY_WEEKDAYS = {6}   # Sunday only (weekday()==6)

    first, last = month_bounds(year, month)

    # Pull HolidayCalendar rows once for the month
    holidays = {
        h.HOLIDAY_DATE
        for h in db.query(HolidayCalendar)
                    .filter(
                        HolidayCalendar.HOLIDAY_DATE >= first,
                        HolidayCalendar.HOLIDAY_DATE <= last,
                    )
                    .all()
    }

    count = 0
    d = first
    while d <= last:
        is_weekly_off = d.weekday() in HOLIDAY_WEEKDAYS
        is_public_holiday = d in holidays
        if not is_weekly_off and not is_public_holiday:
            count += 1
        d += timedelta(days=1)

    return count


def _days_in_range(first: date, last: date):
    d = first
    while d <= last:
        yield d
        d += timedelta(days=1)


# ---------------------------------------------------------------------
# Core: compute the summary for ONE employee for ONE month
# ---------------------------------------------------------------------

def compute_monthly_summary(
    db: Session,
    emp: Employee,
    year: int,
    month: int,
    include_days: bool = False,
) -> Dict[str, Any]:
    """Return a dict summarising an employee's attendance for the month.

    Fields:
      employee_id, employee_code, name
      month (YYYY-MM), year, month_num, month_label
      working_days
      days_present, days_late, days_absent, days_half_day
      days_on_leave (approved leave that overlapped the month)
      unpaid_absences (no check-in AND no approved leave)
      late_arrivals (count where CHECK_IN > 09:15)
      total_late_minutes
      missed_checkouts (CHECK_IN set, CHECK_OUT null on that day)
      total_worked_hours, total_ot_hours
      leave_balance {casual, sick, earned}  (annual, not per-month)
      memos_this_month [{id, type, subject, created_at}]
      memo_flags {will_get_warning, will_get_appreciation, reasons: [...]}
      attendance_score, punctuality_score, overtime_score, star_score

    Set include_days=True to also get `days: [{date, check_in, check_out,
    status, worked_hours, is_late, late_minutes, leave_type}]`.
    """
    first, last = month_bounds(year, month)

    # ---- Attendance rows in the month --------------------------------
    att_rows = (
        db.query(Attendance)
          .filter(
              Attendance.EMPLOYEE_ID == emp.ID,
              Attendance.DATE >= first,
              Attendance.DATE <= last,
          )
          .order_by(Attendance.DATE)
          .all()
    )
    att_by_date = {row.DATE: row for row in att_rows}

    # ---- Approved leaves that overlap the month ----------------------
    approved_leaves = (
        db.query(LeaveRequest)
          .filter(
              LeaveRequest.EMPLOYEE_ID == emp.ID,
              LeaveRequest.STATUS == "APPROVED",
              LeaveRequest.START_DATE <= last,
              LeaveRequest.END_DATE >= first,
          )
          .all()
    )

    # Expand each approved leave into a per-day map {date: leave_type}
    leave_by_date: Dict[date, str] = {}
    for lv in approved_leaves:
        d = max(lv.START_DATE, first)
        e = min(lv.END_DATE, last)
        while d <= e:
            leave_by_date[d] = lv.LEAVE_TYPE or "LEAVE"
            d += timedelta(days=1)

    # ---- Iterate all working days in the month -----------------------
    working_days = working_days_in_month(db, year, month)

    HOLIDAY_WEEKDAYS = {6}    # keep in sync with working_days_in_month
    holidays = {
        h.HOLIDAY_DATE
        for h in db.query(HolidayCalendar)
                    .filter(
                        HolidayCalendar.HOLIDAY_DATE >= first,
                        HolidayCalendar.HOLIDAY_DATE <= last,
                    )
                    .all()
    }

    days_present = 0
    days_late = 0
    days_absent = 0
    days_half_day = 0
    days_on_leave = 0
    unpaid_absences = 0
    late_arrivals = 0
    total_late_minutes = 0
    missed_checkouts = 0
    total_worked_hours = 0.0
    total_ot_hours = 0.0

    day_details: List[Dict[str, Any]] = []

    for d in _days_in_range(first, last):

        is_weekly_off = d.weekday() in HOLIDAY_WEEKDAYS
        is_public_holiday = d in holidays
        is_working_day = not is_weekly_off and not is_public_holiday

        att = att_by_date.get(d)
        leave_type = leave_by_date.get(d)

        late_minutes_today = 0
        is_late_today = False

        if att and att.CHECK_IN:
            # Present
            days_present += 1

            total_worked_hours += float(att.WORKED_HOURS or 0)
            total_ot_hours += float(att.OVERTIME_HOURS or 0)

            # Late detection uses the CHECK_IN wall clock time
            cutoff = datetime.combine(d, WORK_START)
            if att.CHECK_IN > cutoff:
                is_late_today = True
                late_arrivals += 1
                late_minutes_today = int(
                    (att.CHECK_IN - cutoff).total_seconds() // 60
                )
                total_late_minutes += late_minutes_today

            if att.STATUS == "LATE":
                days_late += 1
            elif att.STATUS == "HALF_DAY":
                days_half_day += 1

            if not att.CHECK_OUT:
                missed_checkouts += 1

        elif leave_type:
            days_on_leave += 1

        else:
            # No attendance row + no approved leave. Only counts as an
            # absence on actual working days.
            if is_working_day:
                days_absent += 1
                unpaid_absences += 1

        if include_days:
            day_details.append({
                "date": d.isoformat(),
                "weekday": d.strftime("%a"),
                "is_working_day": is_working_day,
                "is_weekly_off": is_weekly_off,
                "is_public_holiday": is_public_holiday,
                "check_in": att.CHECK_IN.isoformat() if att and att.CHECK_IN else None,
                "check_out": att.CHECK_OUT.isoformat() if att and att.CHECK_OUT else None,
                "status": (
                    att.STATUS if att else
                    ("LEAVE" if leave_type else
                     ("OFF" if not is_working_day else "ABSENT"))
                ),
                "leave_type": leave_type,
                "worked_hours": round(float(att.WORKED_HOURS or 0), 2) if att else 0,
                "ot_hours": round(float(att.OVERTIME_HOURS or 0), 2) if att else 0,
                "is_late": is_late_today,
                "late_minutes": late_minutes_today,
                "missed_checkout": bool(att and att.CHECK_IN and not att.CHECK_OUT),
            })

    # ---- Leave balance (annual, not per-month) -----------------------
    bal = (
        db.query(LeaveBalance)
          .filter(
              LeaveBalance.EMPLOYEE_ID == emp.ID,
              LeaveBalance.YEAR == year,
          )
          .first()
    )
    if bal:
        leave_balance = {
            "casual": {
                "total": float(bal.CASUAL_TOTAL or 0),
                "used":  float(bal.CASUAL_USED or 0),
                "available": max(0, float(bal.CASUAL_TOTAL or 0) - float(bal.CASUAL_USED or 0)),
            },
            "sick": {
                "total": float(bal.SICK_TOTAL or 0),
                "used":  float(bal.SICK_USED or 0),
                "available": max(0, float(bal.SICK_TOTAL or 0) - float(bal.SICK_USED or 0)),
            },
            "earned": {
                "total": float(bal.EARNED_TOTAL or 0),
                "used":  float(bal.EARNED_USED or 0),
                "available": max(0, float(bal.EARNED_TOTAL or 0) - float(bal.EARNED_USED or 0)),
            },
        }
    else:
        leave_balance = {
            "casual": {"total": 12, "used": 0, "available": 12},
            "sick":   {"total": 12, "used": 0, "available": 12},
            "earned": {"total": 15, "used": 0, "available": 15},
        }

    # ---- Memos this month --------------------------------------------
    memos = (
        db.query(EmployeeMemo)
          .filter(
              EmployeeMemo.EMPLOYEE_ID == emp.ID,
              EmployeeMemo.CREATED_AT >= datetime.combine(first, time.min),
              EmployeeMemo.CREATED_AT < datetime.combine(last + timedelta(days=1), time.min),
          )
          .order_by(EmployeeMemo.CREATED_AT.desc())
          .all()
    )
    memos_list = [
        {
            "id": m.ID,
            "type": m.MEMO_TYPE,
            "subject": m.SUBJECT,
            "message": (m.DESCRIPTION or "")[:400],
            "severity": m.SEVERITY,
            "created_at": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
        }
        for m in memos
    ]

    # ---- Memo eligibility (what THIS month would trigger) ------------
    warning_reasons: List[str] = []
    if late_arrivals >= LATE_WARNING_THRESHOLD:
        warning_reasons.append(
            f"{late_arrivals} late arrivals (threshold {LATE_WARNING_THRESHOLD})"
        )
    if unpaid_absences >= UNPAID_ABSENCE_WARNING_THRESHOLD:
        warning_reasons.append(
            f"{unpaid_absences} unpaid absence(s) — no approved leave"
        )
    if missed_checkouts >= MISSED_CHECKOUT_WARNING_THRESHOLD:
        warning_reasons.append(
            f"{missed_checkouts} missed check-outs"
        )

    will_get_appreciation = (
        late_arrivals == 0
        and unpaid_absences == 0
        and days_present > 0
    )

    # ---- Attendance-based star performance (out of 80) ---------------
    if working_days > 0:
        att_score = min(40, (days_present / working_days) * 40)
    else:
        att_score = 0
    punc_score = max(0, 20 - late_arrivals * 5)
    ot_score = min(20, total_ot_hours * 2)
    star_partial = round(att_score + punc_score + ot_score, 1)

    return {
        "employee_id": emp.ID,
        "employee_code": emp.EMPLOYEE_CODE,
        "name": emp.NAME,
        "month": f"{year}-{month:02d}",
        "year": year,
        "month_num": month,
        "month_label": first.strftime("%B %Y"),

        "working_days": working_days,
        "days_present": days_present,
        "days_late": days_late,
        "days_absent": days_absent,
        "days_half_day": days_half_day,
        "days_on_leave": days_on_leave,
        "unpaid_absences": unpaid_absences,

        "late_arrivals": late_arrivals,
        "total_late_minutes": total_late_minutes,
        "missed_checkouts": missed_checkouts,

        "total_worked_hours": round(total_worked_hours, 2),
        "total_ot_hours": round(total_ot_hours, 2),

        "leave_balance": leave_balance,

        "memos_this_month": memos_list,
        "memo_flags": {
            "will_get_warning": bool(warning_reasons),
            "warning_reasons": warning_reasons,
            "will_get_appreciation": will_get_appreciation,
            "thresholds": {
                "late": LATE_WARNING_THRESHOLD,
                "unpaid_absence": UNPAID_ABSENCE_WARNING_THRESHOLD,
                "missed_checkout": MISSED_CHECKOUT_WARNING_THRESHOLD,
            },
        },

        "star_score_attendance": star_partial,
        "star_score_breakdown": {
            "attendance": round(att_score, 1),
            "punctuality": round(punc_score, 1),
            "overtime": round(ot_score, 1),
            "max_of_attendance_component": 80,
        },

        "days": day_details if include_days else None,
    }
