"""
Payroll calculation engine for BVC24.

Given a (vendor, year, month), produces one PayrollSlip per active
employee with the breakdown:

  EARNED_BASIC  = per_day_rate × (days_present + 0.5 × days_half + paid_leave_days)
  TASK_BONUS    = tasks_completed × per_task_bonus
  OT_PAY        = ot_hours × ot_hourly_rate            (placeholder, default 0)
  GROSS_PAY     = EARNED_BASIC + TASK_BONUS + OT_PAY

  LATE_PENALTY  = days_late × late_penalty_per_day
  TOTAL_DEDUCTIONS = LATE_PENALTY + OTHER_DEDUCTIONS

  NET_PAY = GROSS_PAY - TOTAL_DEDUCTIONS

All input numbers come from existing tables (Attendance, LeaveRequest,
TaskAssignment) — no manual entry needed. The slip stores every
intermediate value so a finalized run is reproducible months later
even if the employee's base salary changes.
"""

import calendar
from datetime import date, datetime
from typing import Dict, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import (
    Employee,
    Attendance,
    LeaveRequest,
    TaskAssignment,
    Role,
    PayrollRun,
    PayrollSlip,
    PerformanceScore,
    SalaryStructure
)

from app.services.statutory_calc_service import compute_statutory_deductions
from app.services import star_performance_service


# Tunables — same defaults as elsewhere in the app
PAID_LEAVE_TYPES = {"CASUAL", "SICK", "EARNED", "PAID"}

UNPAID_LEAVE_TYPES = {"UNPAID", "LOP"}

DEFAULT_TASK_BONUS = 100.0   # ₹ per task COMPLETED in the month

# Star-rating-driven monthly bonus. star_bonus = stars × this.
# At ₹500/star a 5★ employee earns +₹2,500/month on top of base.
BONUS_PER_STAR = 500.0

# BVC policy: late check-in is *tracked* but NOT deducted. Zero out
# the historical ₹50/day penalty. HR can still override per-run via
# late_penalty_per_day argument if a specific incident warrants it.
DEFAULT_LATE_PENALTY = 0.0

# BVC policy: 9-hour working day. Used to convert monthly salary
# into an hourly rate → permission excess and OT are then valued
# at that hourly rate.
HOURS_PER_WORKING_DAY = 9

# BVC policy: 4 free permission hours per month. Anything above
# gets deducted from salary at the hourly rate.
FREE_PERMISSION_HOURS_PER_MONTH = 4.0

# OT multiplier — 1.0 = straight-time (BVC current policy); bump to
# 1.5 for time-and-a-half if the company shifts to that model.
OT_RATE_MULTIPLIER = 1.0

# Same admin-role names used by the task allocator — admins don't
# get task-based bonus etc, but payroll still runs for them since
# they're paid employees.
ADMIN_ROLE_NAMES = {
    "super_admin", "admin", "system_administrator", "manager"
}


def _month_range(year: int, month: int) -> Tuple[date, date]:
    """Returns (first_day, last_day) for the given month."""

    first = date(year, month, 1)

    last_dom = calendar.monthrange(year, month)[1]

    last = date(year, month, last_dom)

    return first, last


def _working_days_in_month(
    year: int,
    month: int,
    db=None,
    vendor_id: int = 1,
) -> int:
    """Working days for the given pay period.

    When a DB session is provided, the count is derived from the
    HolidayCalendar table (Sundays + declared holidays excluded). This
    is the production path called from `generate_payroll_run`.

    The legacy signature `(year, month)` (no db) is retained for unit
    tests and external callers; it falls back to "Sundays only off"
    and never consults the holiday table."""

    if db is not None:

        # Import here to avoid a circular dep at module load: the
        # working_days_service queries the HolidayCalendar model which
        # lives alongside other models payroll_service imports.
        from app.services.working_days_service import working_days_in_month

        return working_days_in_month(db, year, month, vendor_id=vendor_id)

    # Fallback — Sundays only (matches the pre-Phase-2 behavior).
    first, last = _month_range(year, month)

    days = 0

    cursor = first

    while cursor <= last:

        if cursor.weekday() != 6:  # 6 = Sunday

            days += 1

        cursor = date.fromordinal(cursor.toordinal() + 1)

    return days


def _days_overlap(
    start_a: date, end_a: date,
    start_b: date, end_b: date
) -> int:
    """How many days of [a] fall within [b]?"""

    s = max(start_a, start_b)

    e = min(end_a, end_b)

    if e < s:

        return 0

    return (e - s).days + 1


def _is_admin(employee: Employee, role_cache: Dict[int, str]) -> bool:

    name = role_cache.get(employee.ROLE_ID, "")

    return name.lower() in ADMIN_ROLE_NAMES if name else False


def _sum_permission_hours(db: Session, employee_id: str,
                          first: date, last: date) -> float:
    """Sum of DURATION_HOURS for approved / pending permission requests
    inside the pay period. Both approved and pending count so an
    unapproved permission still counts toward the 4-hour monthly quota."""

    q = db.query(
        func.coalesce(func.sum(LeaveRequest.DURATION_HOURS), 0.0)
    ).filter(
        LeaveRequest.EMPLOYEE_ID == employee_id,
        LeaveRequest.LEAVE_TYPE == "PERMISSION",
        LeaveRequest.STATUS.in_(("APPROVED", "PENDING_APPROVAL")),
        LeaveRequest.START_DATE >= first,
        LeaveRequest.START_DATE <= last,
    )
    return float(q.scalar() or 0.0)


def calculate_employee_payroll(
    db: Session,
    employee: Employee,
    year: int,
    month: int,
    working_days: int,
    task_bonus_per_task: float = DEFAULT_TASK_BONUS,
    late_penalty_per_day: float = DEFAULT_LATE_PENALTY
) -> dict:
    """Pure calculation — does NOT touch the DB except for read
    queries. Returns the breakdown dict that PayrollSlip stores."""

    first, last = _month_range(year, month)

    # Pull salary structure up-front. If it exists, BASE_SALARY reflects
    # the configured monthly gross (Basic + all allowances) so HR sees a
    # meaningful number in the Payroll table. If no structure is configured
    # we fall back to the legacy Employee.SALARY lump-sum field.
    _structure = db.query(SalaryStructure).filter(
        SalaryStructure.EMPLOYEE_ID == employee.ID
    ).first()

    if _structure:

        base_salary = float(
            (_structure.BASIC or 0.0) +
            (_structure.HRA or 0.0) +
            (_structure.DA or 0.0) +
            (_structure.CONVEYANCE_ALLOWANCE or 0.0) +
            (_structure.MEDICAL_ALLOWANCE or 0.0) +
            (_structure.SPECIAL_ALLOWANCE or 0.0) +
            (_structure.OTHER_ALLOWANCES or 0.0) +
            (_structure.ANNUAL_BONUS or 0.0) +
            (_structure.INCENTIVES or 0.0)
        )

    else:

        base_salary = float(employee.SALARY or 0.0)

    per_day = (base_salary / working_days) if working_days > 0 else 0.0

    # ---- 1. Attendance counts ----
    att_rows = db.query(Attendance).filter(
        Attendance.EMPLOYEE_ID == employee.ID,
        Attendance.DATE >= first,
        Attendance.DATE <= last
    ).all()

    days_present = 0

    days_late = 0

    days_half = 0.0

    ot_hours = 0.0

    for row in att_rows:

        st = (row.STATUS or "").upper()

        if st == "HALF_DAY":

            days_half += 1

        elif st in ("PRESENT", "LATE"):

            days_present += 1

            if st == "LATE":

                days_late += 1

        ot_hours += float(row.OVERTIME_HOURS or 0.0)

    # ---- 2. Leave splits ----
    leaves = db.query(LeaveRequest).filter(
        LeaveRequest.EMPLOYEE_ID == employee.ID,
        LeaveRequest.STATUS == "APPROVED",
        LeaveRequest.START_DATE <= last,
        LeaveRequest.END_DATE >= first
    ).all()

    paid_leave = 0.0

    unpaid_leave = 0.0

    for lv in leaves:

        # Number of leave days that fall inside this month
        overlap_days = _days_overlap(
            lv.START_DATE, lv.END_DATE, first, last
        )

        # If the request had a fractional DAYS (half-day), respect
        # that — but only when start == end (half-days are single-date)
        if lv.START_DATE == lv.END_DATE and lv.DAYS and lv.DAYS < 1:

            overlap_days = lv.DAYS

        ltype = (lv.LEAVE_TYPE or "").upper()

        if ltype in PAID_LEAVE_TYPES:

            paid_leave += overlap_days

        elif ltype in UNPAID_LEAVE_TYPES:

            unpaid_leave += overlap_days

        else:

            # Unknown leave type — treat as paid by default
            paid_leave += overlap_days

    # ---- 3. Absent days ----
    # working_days - (present + half×0.5 + paid + unpaid) → assumed absent
    accounted = (
        days_present
        + days_half * 0.5
        + paid_leave
        + unpaid_leave
    )

    absent_days = max(0.0, working_days - accounted)

    # ---- 4. Tasks completed ----
    completed_statuses = ("COMPLETED", "DONE")

    tasks_completed = db.query(func.count(TaskAssignment.TASK_ID)).filter(
        TaskAssignment.EMPLOYEE_ID == employee.ID,
        TaskAssignment.TASK_STATUS.in_(completed_statuses),
        TaskAssignment.UPDATED_AT >= datetime(first.year, first.month, first.day),
        TaskAssignment.UPDATED_AT < datetime(last.year, last.month, last.day, 23, 59, 59)
    ).scalar() or 0

    # ---- 5. Money — Phase E: component breakdown + statutory ----
    paid_days = days_present + days_half * 0.5 + paid_leave

    # Reuse the salary structure fetched at the top of this function.
    structure = _structure

    # BVC policy: gross earnings show the FULL monthly components
    # (Basic + HRA + DA + …). Attendance-based reduction is expressed
    # as an explicit ABSENCE_DEDUCTION line item in the deductions
    # column so HR sees the exact amount removed for absent days.
    # (The old proration-based method was double-counting when
    # combined with the new ABSENCE_DEDUCTION.)
    earn_ratio = 1.0

    if structure:

        struct_basic   = float(structure.BASIC or 0.0)
        struct_hra     = float(structure.HRA or 0.0)
        struct_da      = float(structure.DA or 0.0)
        struct_conv    = float(structure.CONVEYANCE_ALLOWANCE or 0.0)
        struct_med     = float(structure.MEDICAL_ALLOWANCE or 0.0)
        struct_special = float(structure.SPECIAL_ALLOWANCE or 0.0)
        struct_other   = float(structure.OTHER_ALLOWANCES or 0.0)
        struct_bonus   = float(structure.ANNUAL_BONUS or 0.0)
        struct_incent  = float(structure.INCENTIVES or 0.0)
        pt_state       = structure.PT_STATE
        pf_applicable  = bool(structure.PF_APPLICABLE)
        esi_applicable = bool(structure.ESI_APPLICABLE)

    else:

        # Backward-compat path: treat Employee.SALARY as 100% BASIC.
        struct_basic   = base_salary
        struct_hra     = 0.0
        struct_da      = 0.0
        struct_conv    = 0.0
        struct_med     = 0.0
        struct_special = 0.0
        struct_other   = 0.0
        struct_bonus   = 0.0
        struct_incent  = 0.0
        pt_state       = "TAMIL_NADU"
        pf_applicable  = True
        esi_applicable = True

    # Prorated earnings for the month
    earned_basic   = round(struct_basic   * earn_ratio, 2)
    earned_hra     = round(struct_hra     * earn_ratio, 2)
    earned_da      = round(struct_da      * earn_ratio, 2)
    earned_conv    = round(struct_conv    * earn_ratio, 2)
    earned_med     = round(struct_med     * earn_ratio, 2)
    earned_special = round(struct_special * earn_ratio, 2)
    earned_other   = round(struct_other   * earn_ratio, 2)
    earned_bonus   = round(struct_bonus   * earn_ratio, 2)
    earned_incent  = round(struct_incent  * earn_ratio, 2)

    task_bonus = round(tasks_completed * task_bonus_per_task, 2)

    # ---- 6. BVC company rules — Phase F ----
    # (a) Hourly rate — base_salary / (working_days × 9-hour day)
    hourly_rate = (
        base_salary / (working_days * HOURS_PER_WORKING_DAY)
        if working_days > 0 else 0.0
    )

    # (b) Permission — 4h free per month; anything above is deducted
    # at the hourly rate. permission_hours is looked up by the caller
    # (generate_payroll_run) and passed via a mutable dict on `employee`;
    # here we compute against a value fetched below.
    permission_hours = _sum_permission_hours(db, employee.ID, first, last)
    permission_excess_hours = max(0.0, permission_hours - FREE_PERMISSION_HOURS_PER_MONTH)
    permission_deduction    = round(permission_excess_hours * hourly_rate, 2)

    # (c) Absence — full-day rate per day (unauthorised absent only,
    # not paid leaves).
    absence_deduction = round(absent_days * per_day, 2)

    # (d) OT — separate additional pay = ot_hours × hourly_rate × multiplier
    ot_pay = round(ot_hours * hourly_rate * OT_RATE_MULTIPLIER, 2)

    gross_pay = round(
        earned_basic + earned_hra + earned_da +
        earned_conv  + earned_med + earned_special +
        earned_other + earned_bonus + earned_incent +
        task_bonus   + ot_pay,
        2
    )

    # Statutory deductions (PF on basic+DA, ESI on full gross, PT slab)
    stat = compute_statutory_deductions(
        basic=earned_basic,
        da=earned_da,
        gross=gross_pay,
        pt_state=pt_state,
        pf_applicable=pf_applicable,
        esi_applicable=esi_applicable
    )

    # Late is TRACKED but not deducted by default. HR can pass a
    # non-zero late_penalty_per_day per run to override.
    late_penalty = round(days_late * late_penalty_per_day, 2)

    total_deductions = round(
        late_penalty
        + permission_deduction
        + absence_deduction
        + stat["employee_total"],
        2
    )

    net_pay = round(gross_pay - total_deductions, 2)

    return {
        "base_salary": round(base_salary, 2),
        "working_days": working_days,
        "per_day_rate": round(per_day, 2),
        "hourly_rate": round(hourly_rate, 2),
        "days_present": days_present,
        "days_late": days_late,
        "days_half": days_half,
        "paid_leave_days": round(paid_leave, 2),
        "unpaid_leave_days": round(unpaid_leave, 2),
        "absent_days": round(absent_days, 2),
        "absence_deduction": absence_deduction,
        "permission_hours": round(permission_hours, 2),
        "permission_excess_hours": round(permission_excess_hours, 2),
        "permission_deduction": permission_deduction,
        "tasks_completed": tasks_completed,
        "task_bonus_per_task": task_bonus_per_task,
        "earned_basic": earned_basic,
        "hra": earned_hra,
        "da": earned_da,
        "conveyance_allowance": earned_conv,
        "medical_allowance": earned_med,
        "special_allowance": earned_special,
        "other_allowances": earned_other,
        "annual_bonus": earned_bonus,
        "incentives": earned_incent,
        "task_bonus": task_bonus,
        "ot_hours": round(ot_hours, 2),
        "ot_pay": ot_pay,
        "late_penalty": late_penalty,
        "pf_employee": stat["pf_employee"],
        "pf_employer": stat["pf_employer"],
        "esi_employee": stat["esi_employee"],
        "esi_employer": stat["esi_employer"],
        "professional_tax": stat["professional_tax"],
        "other_deductions": 0.0,
        "gross_pay": gross_pay,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
        "has_structure": structure is not None
    }


def generate_payroll_run(
    db: Session,
    vendor_id: int,
    year: int,
    month: int,
    working_days: int = None,
    task_bonus_per_task: float = DEFAULT_TASK_BONUS,
    late_penalty_per_day: float = DEFAULT_LATE_PENALTY,
    generated_by: str = None,
    overwrite: bool = False
) -> PayrollRun:
    """Create (or refresh) the PayrollRun + its PayrollSlips for
    every active employee of the vendor. Idempotent — re-running
    the same period either errors out (if FINALIZED) or wipes the
    old DRAFT slips and recomputes (when overwrite=True)."""

    if not (1 <= month <= 12):

        raise ValueError(f"month must be 1..12, got {month}")

    if working_days is None:

        # Phase 2: read from HolidayCalendar (Sundays + declared
        # holidays excluded). Falls back to Sundays-only if the table
        # is empty for that month.
        working_days = _working_days_in_month(
            year, month,
            db=db,
            vendor_id=vendor_id,
        )

    existing = db.query(PayrollRun).filter(
        PayrollRun.VENDOR_ID == vendor_id,
        PayrollRun.PAY_YEAR == year,
        PayrollRun.PAY_MONTH == month
    ).first()

    if existing and existing.STATUS != "DRAFT" and not overwrite:

        raise ValueError(
            f"A {existing.STATUS} run already exists for "
            f"{year}-{month:02d}. Use overwrite=true to replace."
        )

    if existing:

        db.query(PayrollSlip).filter(
            PayrollSlip.PAYROLL_RUN_ID == existing.ID
        ).delete(synchronize_session=False)

        run = existing

        run.STATUS = "DRAFT"

        run.WORKING_DAYS = working_days

        run.FINALIZED_AT = None

    else:

        run = PayrollRun(
            VENDOR_ID=vendor_id,
            PAY_YEAR=year,
            PAY_MONTH=month,
            WORKING_DAYS=working_days,
            STATUS="DRAFT",
            GENERATED_BY=generated_by
        )

        db.add(run)

    db.flush()

    # Build a role-id → role-name cache so we know who's admin
    role_cache = {
        r.ID: (r.ROLE_NAME or "")
        for r in db.query(Role).all()
    }

    employees = db.query(Employee).filter(
        Employee.VENDOR_ID == vendor_id,
        Employee.STATUS == "ACTIVE"
    ).all()

    total_gross = 0.0

    total_deductions = 0.0

    total_net = 0.0

    # Pay-period bounds used for the permission-hours rollup below.
    first_of_month = date(year, month, 1)

    last_day = calendar.monthrange(year, month)[1]

    last_of_month = date(year, month, last_day)

    for emp in employees:

        breakdown = calculate_employee_payroll(
            db, emp, year, month,
            working_days=working_days,
            task_bonus_per_task=task_bonus_per_task,
            late_penalty_per_day=late_penalty_per_day
        )

        # Permission hours for this employee in the pay period.
        # PERMISSION rows store duration in LeaveRequest.DURATION_HOURS.
        permission_hours = db.query(
            func.coalesce(func.sum(LeaveRequest.DURATION_HOURS), 0.0)
        ).filter(
            LeaveRequest.EMPLOYEE_ID == emp.ID,
            LeaveRequest.LEAVE_TYPE == "PERMISSION",
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE >= first_of_month,
            LeaveRequest.START_DATE <= last_of_month
        ).scalar() or 0.0

        # Ensure a fresh PerformanceScore for this employee × month,
        # then use its OVERALL_STARS to compute the bonus added on top.
        try:

            perf = star_performance_service.compute_performance_for_employee(
                db, emp, year, month
            )

            stars = float(perf.OVERALL_STARS or 0.0)

        except Exception:

            stars = 0.0

        star_bonus = round(stars * BONUS_PER_STAR, 2)

        # Fold the star bonus into gross + net so the salary the
        # employee receives matches their performance rating.
        breakdown["gross_pay"]      = round(breakdown["gross_pay"] + star_bonus, 2)

        breakdown["net_pay"]        = round(breakdown["net_pay"] + star_bonus, 2)

        slip = PayrollSlip(
            PAYROLL_RUN_ID=run.ID,
            EMPLOYEE_ID=emp.ID,
            BASE_SALARY=breakdown["base_salary"],
            WORKING_DAYS=working_days,
            PER_DAY_RATE=breakdown["per_day_rate"],
            DAYS_PRESENT=breakdown["days_present"],
            DAYS_LATE=breakdown["days_late"],
            DAYS_HALF=breakdown["days_half"],
            PAID_LEAVE_DAYS=breakdown["paid_leave_days"],
            UNPAID_LEAVE_DAYS=breakdown["unpaid_leave_days"],
            ABSENT_DAYS=breakdown["absent_days"],
            ABSENCE_DEDUCTION=breakdown["absence_deduction"],
            PERMISSION_HOURS=permission_hours,
            HOURLY_RATE=breakdown["hourly_rate"],
            PERMISSION_EXCESS_HOURS=breakdown["permission_excess_hours"],
            PERMISSION_DEDUCTION=breakdown["permission_deduction"],
            PERFORMANCE_STARS=stars,
            STAR_BONUS=star_bonus,
            STATUS="PENDING",
            TASKS_COMPLETED=breakdown["tasks_completed"],
            TASK_BONUS_PER_TASK=breakdown["task_bonus_per_task"],
            EARNED_BASIC=breakdown["earned_basic"],
            HRA=breakdown["hra"],
            DA=breakdown["da"],
            CONVEYANCE_ALLOWANCE=breakdown["conveyance_allowance"],
            MEDICAL_ALLOWANCE=breakdown["medical_allowance"],
            SPECIAL_ALLOWANCE=breakdown["special_allowance"],
            OTHER_ALLOWANCES=breakdown["other_allowances"],
            ANNUAL_BONUS=breakdown["annual_bonus"],
            INCENTIVES=breakdown["incentives"],
            TASK_BONUS=breakdown["task_bonus"],
            OT_HOURS=breakdown["ot_hours"],
            OT_PAY=breakdown["ot_pay"],
            LATE_PENALTY=breakdown["late_penalty"],
            PF_EMPLOYEE=breakdown["pf_employee"],
            PF_EMPLOYER=breakdown["pf_employer"],
            ESI_EMPLOYEE=breakdown["esi_employee"],
            ESI_EMPLOYER=breakdown["esi_employer"],
            PROFESSIONAL_TAX=breakdown["professional_tax"],
            OTHER_DEDUCTIONS=breakdown["other_deductions"],
            GROSS_PAY=breakdown["gross_pay"],
            TOTAL_DEDUCTIONS=breakdown["total_deductions"],
            NET_PAY=breakdown["net_pay"]
        )

        db.add(slip)

        total_gross += breakdown["gross_pay"]

        total_deductions += breakdown["total_deductions"]

        total_net += breakdown["net_pay"]

    run.EMPLOYEE_COUNT = len(employees)

    run.TOTAL_GROSS = round(total_gross, 2)

    run.TOTAL_DEDUCTIONS = round(total_deductions, 2)

    run.TOTAL_NET = round(total_net, 2)

    db.commit()

    db.refresh(run)

    return run
