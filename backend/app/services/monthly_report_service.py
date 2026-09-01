"""
MonthlyReportService — automated monthly attendance + payroll summary.

For each employee, given (year, month), computes:
  - Working days (total - Sundays - company holidays)
  - Present / Absent / Half-day counts
  - Late + early-exit counts
  - Leave breakdown by type (CL / SICK / EARNED / UNPAID)
  - Excess leaves (when used > available)
  - Worked + overtime hours
  - Attendance %, working-hour compliance %
  - Daily wage, absence deduction, OT payable, net payable
  - Narrative insights (rule-based, no LLM call needed)

All data sources are EXISTING tables:
  - employee, attendance, leave_request, leave_balance, holiday_calendar

Output is persisted to monthly_attendance_report (one row per
(employee, year, month)) so HR can review without re-computation, and
the same row drives the PDF.
"""

from __future__ import annotations
from datetime import date, datetime, timedelta, time as time_t
from calendar import monthrange
from typing import Optional, List, Dict, Any
from dataclasses import dataclass
import json

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.models import (
    Employee, Attendance, LeaveRequest, LeaveBalance,
    HolidayCalendar, MonthlyAttendanceReport,
)


# =====================================================================
# Tunables
# =====================================================================

class ReportPolicy:
    STANDARD_DAILY_HOURS    = 8.0
    OVERTIME_CUTOFF_HOUR    = 18      # OT starts after 6 PM
    LATE_DEDUCTION_PER_DAY  = 0.0     # disabled by default (most ERPs don't deduct on lateness)
    OT_RATE_MULTIPLIER      = 1.0     # straight-time OT pay; bump to 1.5 for time-and-a-half
    HALF_DAY_THRESHOLD_HOURS = 4.0    # < 4h = half-day
    UNPAID_TYPES = {"UNPAID", "LOP"}
    PAID_TYPES   = {"CASUAL", "SICK", "EARNED", "MATERNITY"}


# =====================================================================
# Helpers
# =====================================================================


def month_range(year: int, month: int) -> tuple[date, date]:
    first = date(year, month, 1)
    last  = date(year, month, monthrange(year, month)[1])
    return first, last


def count_sundays(start: date, end: date) -> int:
    n, d = 0, start
    while d <= end:
        if d.weekday() == 6:   # Sunday
            n += 1
        d += timedelta(days=1)
    return n


# =====================================================================
# Service
# =====================================================================


class MonthlyReportService:

    def __init__(self, db: Session, vendor_id: int):
        self.db = db
        self.vendor_id = vendor_id

    # ---- public API --------------------------------------------------

    def generate_for_employee(self, emp: Employee, year: int, month: int,
                              actor_employee_id: Optional[str] = None,
                              force: bool = False) -> Optional[MonthlyAttendanceReport]:
        """Idempotent — upserts the row for (emp, year, month).

        `force=True` recomputes even LOCKED rows (used when HR clicks
        Force re-sync or Regenerate to fix a bad number).

        BVC24 policy: employees whose salary is not fixed (neither via
        Salary Structure nor Employee.SALARY) do NOT appear in Monthly
        Reports. Any stale row for such an employee is deleted here so
        the list stays consistent with Payroll Records (which already
        skips them — see payroll_service.generate_payroll_run).
        """
        from app.services.attendance_payroll_calc import (
            get_effective_monthly_salary,
        )
        if get_effective_monthly_salary(self.db, emp) <= 0:
            (self.db.query(MonthlyAttendanceReport)
                    .filter(MonthlyAttendanceReport.EMPLOYEE_ID == emp.ID,
                            MonthlyAttendanceReport.YEAR == year,
                            MonthlyAttendanceReport.MONTH == month)
                    .delete(synchronize_session=False))
            return None

        first, last = month_range(year, month)
        signals = self._gather_signals(emp, first, last)
        report = self._upsert(emp, year, month, signals, actor_employee_id, force=force)
        return report

    def generate_for_vendor(self, year: int, month: int,
                            actor_employee_id: Optional[str] = None,
                            force: bool = False
                            ) -> List[MonthlyAttendanceReport]:
        """Run for every active employee in the vendor whose salary has
        been fixed on the master. Employees without a salary are
        skipped and any stale report rows for them are deleted (see
        generate_for_employee).

        Includes employees whose VENDOR_ID is NULL (legacy rows created
        before multi-tenant scoping) so a single-tenant deployment
        doesn't silently return 0 reports because the DB is missing a
        VENDOR_ID stamp.
        """
        from sqlalchemy import or_
        emps = (self.db.query(Employee)
                .filter(
                    or_(
                        Employee.VENDOR_ID == self.vendor_id,
                        Employee.VENDOR_ID.is_(None),
                    ),
                    Employee.STATUS == "ACTIVE",
                ).all())
        results = []
        for e in emps:
            row = self.generate_for_employee(
                e, year, month, actor_employee_id, force=force
            )
            if row is not None:
                results.append(row)
        self.db.commit()
        return results

    # =================================================================
    # AUTO-REFRESH — fully automatic; safe to call on every page load.
    # =================================================================

    REFRESH_COOLDOWN_MINUTES = 5     # for current month, skip if computed within this window

    def auto_refresh_for_month(self, year: int, month: int,
                               force: bool = False) -> Dict[str, Any]:
        """Idempotent intelligent refresh:

          - Future month   → skip (no data to compute)
          - Past month     → recompute + LOCK once (final figures, never recomputed again)
          - Current month  → recompute if last run > COOLDOWN minutes ago (or force=True)

        Designed to be called from GET /monthly-reports on every request.
        Returns a metadata dict that the UI uses to render badges and
        "last updated" timestamps.
        """
        today = date.today()
        first, last = month_range(year, month)

        is_future  = first > today
        is_current = first <= today <= last
        is_past    = last < today

        meta = {
            "year": year, "month": month,
            "is_future": is_future,
            "is_current": is_current,
            "is_past": is_past,
            "is_partial": is_future or is_current,
            "as_of_date": today.isoformat() if is_current else last.isoformat(),
            "refreshed": False,
            "auto_locked": False,
            "skip_reason": None,
        }

        if is_future:
            meta["skip_reason"] = "future_month"
            return meta

        # How many active employees? Needed to know what "all locked" means.
        # Also accept NULL VENDOR_ID (legacy rows in single-tenant deployments).
        from sqlalchemy import or_
        _vendor_match_emp = or_(
            Employee.VENDOR_ID == self.vendor_id,
            Employee.VENDOR_ID.is_(None),
        )
        _vendor_match_rep = or_(
            MonthlyAttendanceReport.VENDOR_ID == self.vendor_id,
            MonthlyAttendanceReport.VENDOR_ID.is_(None),
        )

        active_count = (self.db.query(Employee)
                        .filter(_vendor_match_emp,
                                Employee.STATUS == "ACTIVE").count())

        if is_past and not force:
            locked_count = (self.db.query(MonthlyAttendanceReport)
                            .filter(_vendor_match_rep,
                                    MonthlyAttendanceReport.YEAR == year,
                                    MonthlyAttendanceReport.MONTH == month,
                                    MonthlyAttendanceReport.STATUS == "LOCKED")
                            .count())
            if locked_count >= active_count and active_count > 0:
                meta["skip_reason"] = "already_finalised"
                return meta
            # Otherwise fall through → regenerate and auto-lock below

        if is_current and not force:
            latest_update = (self.db.query(func.max(MonthlyAttendanceReport.UPDATED_AT))
                             .filter(_vendor_match_rep,
                                     MonthlyAttendanceReport.YEAR == year,
                                     MonthlyAttendanceReport.MONTH == month).scalar())
            if latest_update:
                age_secs = (datetime.utcnow() - latest_update).total_seconds()
                if age_secs < self.REFRESH_COOLDOWN_MINUTES * 60:
                    meta["skip_reason"] = f"recently_refreshed_{int(age_secs)}s_ago"
                    return meta

        # Do the regeneration — pass force through so LOCKED past-month
        # rows can be rebuilt too when HR explicitly requests it.
        rows = self.generate_for_vendor(year, month, force=force)
        meta["refreshed"] = True

        # Auto-lock once the month is over — final, signed-off, no
        # accidental recomputation in future. force=True bypasses this.
        if is_past:
            for r in rows:
                # Don't downgrade if a human already flipped to LOCKED/SHARED
                if r.STATUS not in ("LOCKED", "SHARED"):
                    r.STATUS = "LOCKED"
            self.db.commit()
            meta["auto_locked"] = True

        return meta

    def list_reports(self, year: int, month: int) -> List[Dict[str, Any]]:
        # Accept both vendor_id match AND NULL (single-tenant safety).
        # Only surface employees whose salary was resolved > 0 when the
        # report row was last generated. The stored MONTHLY_SALARY was
        # produced by get_effective_monthly_salary, so this filter
        # matches whatever the source of truth was (SalaryStructure
        # gross or Employee.SALARY fallback).
        from sqlalchemy import or_
        rows = (self.db.query(MonthlyAttendanceReport, Employee)
                .join(Employee, MonthlyAttendanceReport.EMPLOYEE_ID == Employee.ID)
                .filter(
                    or_(
                        MonthlyAttendanceReport.VENDOR_ID == self.vendor_id,
                        MonthlyAttendanceReport.VENDOR_ID.is_(None),
                    ),
                    MonthlyAttendanceReport.YEAR  == year,
                    MonthlyAttendanceReport.MONTH == month,
                    MonthlyAttendanceReport.MONTHLY_SALARY > 0,
                )
                .order_by(Employee.NAME.asc()).all())
        return [self._serialise(r, e) for r, e in rows]

    def get_report(self, employee_id: str, year: int, month: int
                   ) -> Optional[Dict[str, Any]]:
        row = (self.db.query(MonthlyAttendanceReport, Employee)
               .join(Employee, MonthlyAttendanceReport.EMPLOYEE_ID == Employee.ID)
               .filter(MonthlyAttendanceReport.EMPLOYEE_ID == employee_id,
                       MonthlyAttendanceReport.YEAR == year,
                       MonthlyAttendanceReport.MONTH == month).first())
        return self._serialise(*row) if row else None

    # ---- aggregation -------------------------------------------------

    def _gather_signals(self, emp: Employee, first: date, last: date
                        ) -> Dict[str, Any]:
        total_days = (last - first).days + 1
        sundays = count_sundays(first, last)

        # Company holidays sourced from the Announcement table
        # (TYPE='HOLIDAY', IS_ACTIVE=1) — same single source of truth
        # the biometric + payroll flow uses. HolidayCalendar is legacy
        # and no longer consulted.
        try:
            from app.models.models import Announcement
            hols = (self.db.query(Announcement)
                    .filter(Announcement.TYPE == "HOLIDAY",
                            Announcement.IS_ACTIVE == 1,
                            Announcement.EVENT_DATE.between(first, last))
                    .all())
            holiday_dates = {a.EVENT_DATE for a in hols if a.EVENT_DATE}
        except Exception:
            holiday_dates = set()

        # BVC24 policy: working days = calendar - Sundays ONLY.
        # Holidays are paid days that count toward the denominator
        # (per_day = basic / 26 for August 2026, matching the payslip).
        # Holidays are excluded from the ABSENT count below so a
        # no-punch on a holiday doesn't dock pay.
        extra_holidays = sum(1 for d in holiday_dates if d.weekday() != 6)
        working_days = max(0, total_days - sundays)

        # Attendance rows in the window
        att = (self.db.query(Attendance)
               .filter(Attendance.EMPLOYEE_ID == emp.ID,
                       Attendance.DATE.between(first, last)).all())

        present, absent, half, late, early = 0.0, 0.0, 0.0, 0, 0
        worked_hours, ot_hours = 0.0, 0.0

        for r in att:
            s = (r.STATUS or "").upper()
            wh = float(r.WORKED_HOURS or 0)
            oh = float(getattr(r, "OVERTIME_HOURS", 0) or 0)
            worked_hours += wh
            ot_hours     += oh

            # Skip the ABSENT / no-punch bookkeeping when the DATE is
            # a company holiday — those days are paid by policy and
            # must not count as absent, present, or half-day.
            if r.DATE in holiday_dates and r.CHECK_IN is None:
                continue

            if s == "PRESENT":
                # Treat < HALF_DAY_THRESHOLD as half-day even if marked PRESENT
                if wh and wh < ReportPolicy.HALF_DAY_THRESHOLD_HOURS:
                    half += 0.5
                    present += 0.5
                else:
                    present += 1
            elif s == "LATE":
                present += 1
                late += 1
            elif s == "HALF_DAY":
                present += 0.5
                half += 0.5
            elif s == "ABSENT":
                absent += 1
            elif s == "EARLY_EXIT":
                present += 1
                early += 1

        # Leave taken in the window (only APPROVED counts).
        # `cl` / `sick` / `earned` / `paid_total` come from LeaveRequest
        # rows — same source the payroll flow uses for CL matching.
        # `unpaid_total` (LOP) is deliberately sourced from the
        # Attendance table (STATUS='LOP' / 'HALF_LOP') instead, so it
        # matches exactly what payroll_service reads. Using LeaveRequest
        # for LOP double-counted days that had already been booked as a
        # regular ABSENT on the Attendance row.
        leaves = (self.db.query(LeaveRequest)
                  .filter(LeaveRequest.EMPLOYEE_ID == emp.ID,
                          LeaveRequest.STATUS == "APPROVED",
                          LeaveRequest.START_DATE <= last,
                          LeaveRequest.END_DATE   >= first).all())
        cl, sick, earned, paid_total = 0.0, 0.0, 0.0, 0.0
        for lv in leaves:
            # Clip the leave to the month window (in case it spans months)
            s = max(lv.START_DATE, first)
            e = min(lv.END_DATE,   last)
            if e < s:
                continue
            days_in_month = (e - s).days + 1
            # Cap by the leave's recorded DAYS if smaller (half-day leaves)
            days = min(days_in_month, float(lv.DAYS or days_in_month))
            t = (lv.LEAVE_TYPE or "").upper()
            if t == "CASUAL":    cl += days
            elif t == "SICK":    sick += days
            elif t == "EARNED":  earned += days
            if t in ReportPolicy.PAID_TYPES:
                paid_total += days

        # LOP from Attendance (same source payroll uses).
        unpaid_total = 0.0
        for r in att:
            s = (r.STATUS or "").upper()
            if r.CHECK_IN is not None:
                continue
            if s == "LOP":
                unpaid_total += 1.0
            elif s == "HALF_LOP":
                unpaid_total += 0.5

        # Excess leaves — sum of paid leaves taken beyond yearly balance.
        # We look at the year's LeaveBalance and assume the *_USED columns
        # already reflect everything up to today; anything beyond is excess.
        excess = self._compute_excess(emp, cl, sick, earned, first.year)

        # Expected vs actual hours
        expected_hours = working_days * ReportPolicy.STANDARD_DAILY_HOURS
        hour_compliance = min(100.0, round(
            (worked_hours / expected_hours) * 100, 1)) if expected_hours else 0.0

        # Attendance % — treat paid leaves as "credited" days
        credited = present + paid_total
        attendance_pct = round((credited / working_days) * 100, 1) if working_days else 0.0

        # Salary — pulled through the shared resolver so this report
        # agrees with the Employee Profile, Biometric calc, and Payroll
        # slip. When HR fixes salary via the CTC builder the structure
        # is authoritative; the legacy Employee.SALARY column is a
        # fallback for employees who never went through the builder.
        from app.services.attendance_payroll_calc import (
            get_effective_monthly_salary,
        )
        salary = get_effective_monthly_salary(self.db, emp)
        daily_wage = round(salary / working_days, 2) if working_days else 0.0

        # Pull annual CL cap and derive the monthly cap.
        annual_cl = 12.0
        try:
            from app.models.models import LeaveBalance
            bal = (self.db.query(LeaveBalance)
                     .filter(LeaveBalance.EMPLOYEE_ID == emp.ID,
                             LeaveBalance.YEAR == first.year)
                     .first())
            if bal and bal.CASUAL_TOTAL:
                annual_cl = float(bal.CASUAL_TOTAL)
        except Exception:
            pass
        monthly_cl_cap = float(int(annual_cl // 12)) if annual_cl >= 12 else annual_cl / 12.0
        # `cl` (formal CL requests) already counted from LeaveRequest above.
        # Cap formal CL at the monthly limit first, then top up with
        # auto-consumed absents until we hit the cap.
        formal_cl_capped = min(cl, monthly_cl_cap)
        cl_remaining_this_month = max(0.0, monthly_cl_cap - formal_cl_capped)
        auto_cl = min(float(absent), cl_remaining_this_month)
        cl_used_effective = round(min(monthly_cl_cap, formal_cl_capped + auto_cl), 1)

        # Unpaid absent = raw absent + formal LOP minus CL applied.
        # `excess` (leaves beyond yearly quota) is a display-only signal
        # for HR — it must NOT re-enter the deduction math, otherwise
        # a CL day that already offset an absent gets counted a second
        # time. Payroll uses this exact same formula.
        unpaid_days = max(0.0,
                          absent + unpaid_total - cl_used_effective)
        absence_ded = round(daily_wage * unpaid_days, 2)

        # Late deduction — 3-late = 0.5 day rule, mirrors payroll_service.py
        half_day_penalty = (late // 3) * 0.5
        late_ded = round(daily_wage * half_day_penalty, 2)

        # OT pay: hourly rate × OT hours × multiplier
        hourly = (daily_wage / ReportPolicy.STANDARD_DAILY_HOURS) if daily_wage else 0.0
        ot_payable = round(hourly * ot_hours * ReportPolicy.OT_RATE_MULTIPLIER, 2)
        net = round(salary - absence_ded - late_ded + ot_payable, 2)

        insights = self._build_insights(
            present, absent, late, attendance_pct, excess, ot_hours,
            unpaid_days, cl
        )

        return {
            "total_days": total_days, "sundays": sundays,
            "holidays": extra_holidays, "working_days": working_days,
            "present_days": present, "absent_days": absent,
            "half_days": half, "late_count": late, "early_exit_count": early,
            # cl_used shows the EFFECTIVE CL consumed this month
            # (formal + auto-applied against absents), same figure the
            # payslip uses so the two views stay reconciled.
            "cl_used": cl_used_effective, "sick_used": sick, "earned_used": earned,
            "paid_leaves": paid_total, "unpaid_leaves": unpaid_total,
            "excess_leaves": excess,
            "worked_hours": round(worked_hours, 1),
            "overtime_hours": round(ot_hours, 1),
            "expected_hours": expected_hours,
            "attendance_pct": attendance_pct,
            "hour_compliance_pct": hour_compliance,
            "monthly_salary": salary, "daily_wage": daily_wage,
            "absence_deduction": absence_ded, "late_deduction": late_ded,
            "ot_payable": ot_payable, "net_payable": net,
            "insights": insights,
        }

    def _compute_excess(self, emp: Employee, cl: float, sick: float,
                        earned: float, year: int) -> float:
        bal = (self.db.query(LeaveBalance)
               .filter(LeaveBalance.EMPLOYEE_ID == emp.ID,
                       LeaveBalance.YEAR == year).first())
        if not bal:
            # No balance row → treat all paid-type leaves as excess
            return cl + sick + earned

        excess = 0.0
        # For each type, available = TOTAL + CARRYOVER. USED includes ALL
        # of the year's usage (we can't pinpoint just this month's slice).
        # The "excess" model below is conservative: treat the year's USED
        # over TOTAL+CARRYOVER as the cumulative excess.
        for type_key, used_now in (("CASUAL", cl), ("SICK", sick), ("EARNED", earned)):
            total = float(getattr(bal, f"{type_key}_TOTAL", 0) or 0)
            carry = float(getattr(bal, f"{type_key}_CARRYOVER", 0) or 0)
            used  = float(getattr(bal, f"{type_key}_USED", 0) or 0)
            available = total + carry
            if used > available:
                excess += (used - available)
        # Cap excess by what was actually taken this month (avoid double-deduct)
        return min(excess, cl + sick + earned)

    def _build_insights(self, present, absent, late, attendance_pct,
                        excess, ot_hours, unpaid_days, cl_used) -> List[str]:
        out: List[str] = []
        if attendance_pct >= 95:
            out.append("Excellent attendance — consider for recognition.")
        elif attendance_pct < 75:
            out.append(
                f"Attendance below 75% ({attendance_pct}%) — schedule a "
                "conversation before payroll cutoff."
            )
        if late >= 5:
            out.append(
                f"Frequent late arrivals ({late} times) — recommend a "
                "punctuality warning."
            )
        if excess > 0:
            out.append(
                f"Took {excess} day(s) beyond yearly leave entitlement — "
                "treated as unpaid in this report."
            )
        if cl_used > 1:
            out.append(
                f"Used {cl_used} CL in one month vs. company policy of 1/month — "
                "flag at next 1-on-1."
            )
        if ot_hours >= 15:
            out.append(
                f"High OT this month ({ot_hours}h) — check for burnout signals "
                "and rebalance workload."
            )
        if not out:
            out.append("No attendance concerns flagged.")
        return out

    # ---- upsert ------------------------------------------------------

    def _upsert(self, emp: Employee, year: int, month: int,
                s: Dict[str, Any],
                actor_id: Optional[str],
                force: bool = False) -> MonthlyAttendanceReport:
        existing = (self.db.query(MonthlyAttendanceReport)
                    .filter(MonthlyAttendanceReport.EMPLOYEE_ID == emp.ID,
                            MonthlyAttendanceReport.YEAR == year,
                            MonthlyAttendanceReport.MONTH == month).first())
        if existing and existing.STATUS == "LOCKED" and not force:
            # Don't overwrite locked rows (already paid, sent etc.) —
            # unless the caller explicitly asked (Force re-sync).
            return existing
        # Stamp with a real vendor_id — never NULL — so subsequent
        # list_reports queries pick this row up regardless of whether
        # they filter with OR-NULL or strict equality. Falls back to
        # the service's vendor_id (default 1) when the employee row
        # itself is missing the stamp.
        row = existing or MonthlyAttendanceReport(
            EMPLOYEE_ID=emp.ID, YEAR=year, MONTH=month,
            VENDOR_ID=(emp.VENDOR_ID or self.vendor_id or 1),
        )
        row.TOTAL_DAYS        = s["total_days"]
        row.SUNDAYS           = s["sundays"]
        row.HOLIDAYS          = s["holidays"]
        row.WORKING_DAYS      = s["working_days"]
        row.PRESENT_DAYS      = s["present_days"]
        row.ABSENT_DAYS       = s["absent_days"]
        row.HALF_DAYS         = s["half_days"]
        row.LATE_COUNT        = s["late_count"]
        row.EARLY_EXIT_COUNT  = s["early_exit_count"]
        row.CL_USED           = s["cl_used"]
        row.SICK_USED         = s["sick_used"]
        row.EARNED_USED       = s["earned_used"]
        row.PAID_LEAVES       = s["paid_leaves"]
        row.UNPAID_LEAVES     = s["unpaid_leaves"]
        row.EXCESS_LEAVES     = s["excess_leaves"]
        row.WORKED_HOURS      = s["worked_hours"]
        row.OVERTIME_HOURS    = s["overtime_hours"]
        row.EXPECTED_HOURS    = s["expected_hours"]
        row.ATTENDANCE_PCT    = s["attendance_pct"]
        row.HOUR_COMPLIANCE_PCT = s["hour_compliance_pct"]
        row.MONTHLY_SALARY    = s["monthly_salary"]
        row.DAILY_WAGE        = s["daily_wage"]
        row.ABSENCE_DEDUCTION = s["absence_deduction"]
        row.LATE_DEDUCTION    = s["late_deduction"]
        row.OT_PAYABLE        = s["ot_payable"]
        row.NET_PAYABLE       = s["net_payable"]
        row.INSIGHTS_JSON     = json.dumps(s["insights"])
        row.STATUS            = "GENERATED"
        row.GENERATED_BY_ID   = actor_id

        if not existing:
            self.db.add(row)
        self.db.flush()
        return row

    # ---- serialisation ----------------------------------------------

    def _serialise(self, r: MonthlyAttendanceReport, emp: Employee) -> Dict[str, Any]:
        try:
            insights = json.loads(r.INSIGHTS_JSON or "[]")
        except (TypeError, ValueError):
            insights = []
        # Compute freshness flags from the report's month
        today = date.today()
        first, last = month_range(r.YEAR, r.MONTH)
        is_future  = first > today
        is_current = first <= today <= last
        return {
            "id": r.ID,
            "employee_id": emp.ID,
            "employee_code": emp.EMPLOYEE_CODE,
            "employee_name": emp.NAME,
            "year": r.YEAR, "month": r.MONTH,
            "total_days": r.TOTAL_DAYS, "sundays": r.SUNDAYS,
            "holidays": r.HOLIDAYS, "working_days": r.WORKING_DAYS,
            "present_days": float(r.PRESENT_DAYS or 0),
            "absent_days":  float(r.ABSENT_DAYS or 0),
            "half_days":    float(r.HALF_DAYS or 0),
            "late_count":   r.LATE_COUNT,
            "early_exit_count": r.EARLY_EXIT_COUNT,
            "cl_used":     float(r.CL_USED or 0),
            "sick_used":   float(r.SICK_USED or 0),
            "earned_used": float(r.EARNED_USED or 0),
            "paid_leaves":   float(r.PAID_LEAVES or 0),
            "unpaid_leaves": float(r.UNPAID_LEAVES or 0),
            "excess_leaves": float(r.EXCESS_LEAVES or 0),
            "worked_hours":   float(r.WORKED_HOURS or 0),
            "overtime_hours": float(r.OVERTIME_HOURS or 0),
            "expected_hours": float(r.EXPECTED_HOURS or 0),
            "attendance_pct":      float(r.ATTENDANCE_PCT or 0),
            "hour_compliance_pct": float(r.HOUR_COMPLIANCE_PCT or 0),
            "monthly_salary":     float(r.MONTHLY_SALARY or 0),
            "daily_wage":         float(r.DAILY_WAGE or 0),
            "absence_deduction":  float(r.ABSENCE_DEDUCTION or 0),
            "late_deduction":     float(r.LATE_DEDUCTION or 0),
            "ot_payable":         float(r.OT_PAYABLE or 0),
            "net_payable":        float(r.NET_PAYABLE or 0),
            "insights": insights,
            "status": r.STATUS,
            "pdf_path": r.PDF_PATH,
            "created_at": r.CREATED_AT.isoformat() if r.CREATED_AT else None,
            "updated_at": r.UPDATED_AT.isoformat() if r.UPDATED_AT else None,
            # Freshness — computed live from the report's month vs. today
            "is_partial": is_future or is_current,
            "is_locked":  (r.STATUS or "").upper() in ("LOCKED", "SHARED"),
            "as_of_date": today.isoformat() if is_current else last.isoformat(),
        }
