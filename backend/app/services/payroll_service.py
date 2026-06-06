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
    SalaryStructure
)

from app.services.statutory_calc_service import compute_statutory_deductions


# Tunables — same defaults as elsewhere in the app
PAID_LEAVE_TYPES = {"CASUAL", "SICK", "EARNED", "PAID"}

UNPAID_LEAVE_TYPES = {"UNPAID", "LOP"}

DEFAULT_TASK_BONUS = 100.0   # ₹ per task COMPLETED in the month

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


def _working_days_in_month(year: int, month: int) -> int:
    """Mon-Sat counted, Sunday off. Adjust here if BVC24 changes
    weekly-off policy."""

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
    # The "earned" multiplier prorates every component by attendance —
    # so a half-month employee earns half of every allowance.
    structure = _structure

    earn_ratio = (paid_days / working_days) if working_days else 0.0

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

    ot_pay = 0.0  # OT rate not configured yet; reserved field

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

    late_penalty = round(days_late * late_penalty_per_day, 2)

    total_deductions = round(
        late_penalty + stat["employee_total"],
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

    for emp in employees:

        breakdown = calculate_employee_payroll(
            db, emp, year, month,
            working_days=working_days,
            task_bonus_per_task=task_bonus_per_task,
            late_penalty_per_day=late_penalty_per_day
        )

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
