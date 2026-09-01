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

DEFAULT_LATE_PENALTY = 50.0  # ₹ per late check-in

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


def calculate_employee_payroll(
    db: Session,
    employee: Employee,
    year: int,
    month: int,
    working_days: int,
    task_bonus_per_task: float = DEFAULT_TASK_BONUS,
    late_penalty_per_day: float = DEFAULT_LATE_PENALTY,
    calc_row: dict = None,
) -> dict:
    """Pure calculation — does NOT touch the DB except for read
    queries. Returns the breakdown dict that PayrollSlip stores.

    When `calc_row` is provided (a single row from
    attendance_payroll_calc.compute_monthly_calculation), the
    biometric attendance counters and OT / late-penalty numbers are
    pulled from it instead of being recomputed here. This keeps the
    Monthly-calc UI and the generated PayrollSlip on the same rules
    (OT@19:00, late-3x half-day penalty, absent→CL/LOP auto-classify).
    """

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

    # ---- 1. Attendance + leave counters ----
    # PREFERRED path: pull the numbers from the shared Monthly-calc
    # so the PayrollSlip lines up 1:1 with what the "Monthly
    # calculation" table on Biometric Import shows. Legacy path
    # (STATUS-string counting) kept as a fallback for older code
    # paths that call calculate_employee_payroll without a calc_row.
    if calc_row is not None:

        days_present = int(calc_row.get("present_days", 0) or 0)
        days_late    = int(calc_row.get("late_arrivals", 0) or 0)
        # half-day penalty from the 3× late rule (0.5 per block of 3).
        # Store in days_half so downstream prorating & PayrollSlip.DAYS_HALF
        # reflect the effective deduction.
        days_half    = float(calc_row.get("half_day_penalty", 0.0) or 0.0)

        # OT hours already trimmed for the 18:00-19:00 window and
        # offset by total late minutes — this is the payroll-side
        # net OT (what actually gets paid).
        ot_hours     = float(calc_row.get("net_ot_hours", 0.0) or 0.0)

        # Paid leave = auto-classified CL (formal + monthly-cap auto)
        # + any CL/SL/EL Attendance rows the leave sync wrote.
        paid_leave   = float(calc_row.get("cl_used", 0.0) or 0.0) \
                     + float(calc_row.get("paid_leave_days", 0.0) or 0.0)

        # Absent-and-unaccounted (raw absent minus CL applied).
        absent_days  = float(calc_row.get("unpaid_absent", 0.0) or 0.0)

        # LOP = formal LOP leave rows + unpaid absent days (both are
        # money-lost days, so the payslip's "LOP Days" field must
        # show the combined figure — otherwise a plain no-show
        # absent shows 0 LOP even though salary was deducted for it.
        unpaid_leave = (
            float(calc_row.get("lop_days", 0.0) or 0.0)
            + absent_days
        )

    else:
        # ----- legacy fallback (kept for backward compat) -----
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

        leaves = db.query(LeaveRequest).filter(
            LeaveRequest.EMPLOYEE_ID == employee.ID,
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE <= last,
            LeaveRequest.END_DATE >= first
        ).all()

        paid_leave = 0.0
        unpaid_leave = 0.0
        for lv in leaves:
            overlap_days = _days_overlap(lv.START_DATE, lv.END_DATE, first, last)
            if lv.START_DATE == lv.END_DATE and lv.DAYS and lv.DAYS < 1:
                overlap_days = lv.DAYS
            ltype = (lv.LEAVE_TYPE or "").upper()
            if ltype in PAID_LEAVE_TYPES:
                paid_leave += overlap_days
            elif ltype in UNPAID_LEAVE_TYPES:
                unpaid_leave += overlap_days
            else:
                paid_leave += overlap_days

        accounted = days_present + days_half * 0.5 + paid_leave + unpaid_leave
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

    # BVC24 policy (admin request, 2026-08-29): the Basic salary the
    # admin enters on the Employee master must appear on the payslip
    # verbatim — no attendance-based proration. Attendance-driven
    # adjustments still apply through LATE_PENALTY (unchanged) and the
    # explicit LOP-day deductions handled elsewhere. This also fixes
    # the earlier bug where paid_days > working_days produced ratios
    # like 1.02 and inflated Basic above the entered amount
    # (e.g. ₹20,000 → ₹20,416.70 on Puviyarasi's slip).
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

    # OT pay + late penalty + LOP (unpaid-absent) deduction: prefer
    # Monthly-calc's values when available (they apply the HR-agreed
    # rules — OT@19:00 with late-minute offset, half-day penalty every
    # 3 late arrivals, and CL auto-consumption for casual absences).
    #
    # LOP semantics: `absent_deduction_only` = per_day_rate ×
    # unpaid_absent_days. It's the money value of absent days that
    # CL couldn't cover. Since Basic no longer prorates (previous
    # fix), this deduction is what actually enforces LOP on the slip
    # — routed through OTHER_DEDUCTIONS so it shows up as its own
    # line on the payslip PDF.
    if calc_row is not None:
        ot_pay              = float(calc_row.get("ot_pay", 0.0) or 0.0)
        late_penalty        = float(calc_row.get("late_penalty", 0.0) or 0.0)
        lop_deduction       = float(calc_row.get("absent_deduction_only", 0.0) or 0.0)
    else:
        ot_pay              = 0.0  # legacy path had no OT payout
        late_penalty        = round(days_late * late_penalty_per_day, 2)
        lop_deduction       = 0.0

    gross_pay = round(
        earned_basic + earned_hra + earned_da +
        earned_conv  + earned_med + earned_special +
        earned_other + earned_bonus + earned_incent +
        task_bonus   + ot_pay,
        2
    )

    # BVC24 policy (admin request, 2026-08-29): the Payroll Record must
    # match the Biometric Monthly Calculation preview exactly. The
    # biometric calc doesn't apply PF / ESI / PT — it only deducts
    # LATE_PENALTY + LOP (unpaid absents). So when a calc_row is
    # available, we zero out statutory deductions so the two views
    # agree. Statutory can be re-enabled once the admin finalises the
    # payroll policy.
    if calc_row is not None:
        stat = {
            "pf_employee": 0.0, "pf_employer": 0.0,
            "esi_employee": 0.0, "esi_employer": 0.0,
            "professional_tax": 0.0,
            "employee_total": 0.0,
        }
    else:
        stat = compute_statutory_deductions(
            basic=earned_basic,
            da=earned_da,
            gross=gross_pay,
            pt_state=pt_state,
            pf_applicable=pf_applicable,
            esi_applicable=esi_applicable
        )

    total_deductions = round(
        late_penalty + lop_deduction + stat["employee_total"],
        2
    )

    net_pay = round(gross_pay - total_deductions, 2)

    return {
        "base_salary": round(base_salary, 2),
        "working_days": working_days,
        "per_day_rate": round(per_day, 2),
        "days_present": days_present,
        "days_late": days_late,
        "days_half": days_half,
        "paid_leave_days": round(paid_leave, 2),
        "unpaid_leave_days": round(unpaid_leave, 2),
        "absent_days": round(absent_days, 2),
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
        # LOP goes into ABSENCE_DEDUCTION (not OTHER_DEDUCTIONS) so
        # the payslip preview renders it under its dedicated
        # "Absent Day Deduction" line — see employee_payslips.py:189.
        # OTHER_DEDUCTIONS stays reserved for manual admin overrides
        # entered in the PayslipGenerator UI.
        "absence_deduction": round(lop_deduction, 2),
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

        # BVC24 policy (admin request, 2026-08-29): use the SAME
        # working-days definition as the Biometric Monthly Calculation
        # preview — calendar days minus Sundays only. Holidays are
        # already excluded from ABSENT counts elsewhere (see
        # attendance_payroll_calc.py) so subtracting them here as well
        # would double-count and inflate the per-day rate. Without
        # this, per_day = 20000 / 24 = ₹833.33 in payroll but
        # 20000 / 26 = ₹769.23 in the biometric preview — the exact
        # mismatch on Puviyarasi's slip.
        working_days = _working_days_in_month(year, month)

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
        r.ID: (r.NAME or "")
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

    # Run the shared Monthly-calc once for the whole vendor and
    # index by employee_id — every per-employee payroll below reads
    # its attendance counters + OT + late penalty from this map
    # instead of recomputing (so PayrollSlip == Monthly-calc UI).
    calc_by_emp: dict = {}
    try:
        from app.services.attendance_payroll_calc import (
            compute_monthly_calculation,
        )
        calc_rows = compute_monthly_calculation(
            db,
            year=year,
            month=month,
            vendor_id=vendor_id,
            working_days_override=working_days,
        )
        for cr in calc_rows:
            calc_by_emp[cr["employee_id"]] = cr
    except Exception:
        # If the calc fails for any reason, per-employee fallback
        # to the legacy STATUS-string counters kicks in below.
        calc_by_emp = {}

    for emp in employees:

        breakdown = calculate_employee_payroll(
            db, emp, year, month,
            working_days=working_days,
            task_bonus_per_task=task_bonus_per_task,
            late_penalty_per_day=late_penalty_per_day,
            calc_row=calc_by_emp.get(emp.ID),
        )

        # BVC24 policy (admin request, 2026-08-29): if this employee
        # has no salary saved on the Employee master AND no Salary
        # Structure, skip them entirely — don't create a payslip. The
        # admin will set their salary later and re-run the month.
        if float(breakdown.get("earned_basic") or 0.0) <= 0:
            continue

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

        # BVC24 policy (admin request, 2026-08-29): Star Bonus is
        # temporarily disabled on payslips — the admin will re-enable
        # it once the star-rating rules are finalised. `stars` is still
        # captured for reporting, but the money value is zeroed here.
        star_bonus = 0.0
        _ = stars  # keep the local for the SlipCreate below

        # Star bonus omitted intentionally — gross + net stay as
        # calculate_employee_payroll returned them.

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
            PERMISSION_HOURS=permission_hours,
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
            ABSENCE_DEDUCTION=breakdown.get("absence_deduction", 0.0),
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

    # ---------------------------------------------------------------
    # Phase 3 — auto-file every fresh payslip PDF into the
    # employee's document folder so the ESS portal sees it
    # immediately and admins have a permanent archive.
    # Best-effort: any per-slip failure is logged and skipped.
    # ---------------------------------------------------------------
    try:
        from app.services.payslip_document_filer import (
            file_payslip_as_document,
        )
        slips_for_run = db.query(PayrollSlip).filter(
            PayrollSlip.PAYROLL_RUN_ID == run.ID
        ).all()
        emp_by_id = {e.ID: e for e in employees}
        for slip in slips_for_run:
            emp = emp_by_id.get(slip.EMPLOYEE_ID)
            if emp is not None:
                file_payslip_as_document(db, slip, run, emp)
    except Exception:
        # Never let PDF filing break the payroll run itself.
        pass

    return run
