"""
Payroll endpoints.

  POST   /payroll/generate                 -> create or refresh a run
  GET    /payroll/runs                     -> list runs for vendor
  GET    /payroll/runs/{id}                -> detail with all slips
  GET    /payroll/runs/{id}/slip/{emp_id}  -> single employee slip
  PATCH  /payroll/runs/{id}/finalize       -> lock a DRAFT run
  PATCH  /payroll/runs/{id}/mark-paid      -> flag a FINALIZED run as PAID
  DELETE /payroll/runs/{id}                -> remove a DRAFT run
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Employee,
    PayrollRun,
    PayrollSlip,
    SalaryStructure,
    Vendor
)

from app.services.statutory_calc_service import compute_statutory_deductions

from app.services.payroll_service import (
    generate_payroll_run,
    DEFAULT_TASK_BONUS,
    DEFAULT_LATE_PENALTY
)


router = APIRouter(prefix="/payroll", tags=["Payroll"])


# ----------------------------------------------------------------
# Schemas
# ----------------------------------------------------------------

class GeneratePayrollRequest(BaseModel):

    VENDOR_ID: int = 1
    YEAR: int
    MONTH: int  # 1..12
    WORKING_DAYS: Optional[int] = None
    TASK_BONUS_PER_TASK: float = DEFAULT_TASK_BONUS
    LATE_PENALTY_PER_DAY: float = DEFAULT_LATE_PENALTY
    GENERATED_BY: Optional[str] = None
    OVERWRITE: bool = False
    # HR-chosen monthly increment per employee — keyed by employee UUID.
    # Stored on the slip's INCENTIVES column and added to NET_PAY.
    INCREMENTS_BY_EMPLOYEE: Optional[dict] = None


def _resolve_vendor_id(db: Session, requested: Optional[int]) -> int:
    """Forgiving vendor resolution — matches the pattern used in
    production.py. Frontend hardcodes vendor_id=1 but the real BVC
    row may have a different ID."""

    if requested:

        has_data = (
            db.query(Employee)
            .filter(Employee.VENDOR_ID == requested)
            .first()
            is not None
        )

        if has_data:

            return requested

    bvc = db.query(Vendor).filter(
        Vendor.VENDOR_NAME == "Bharath Vending Corporation"
    ).first()

    if bvc:

        return bvc.ID

    any_v = db.query(Vendor).first()

    return any_v.ID if any_v else (requested or 1)


# ----------------------------------------------------------------
# Serializers
# ----------------------------------------------------------------

def _serialize_run(run: PayrollRun) -> dict:

    return {
        "ID": run.ID,
        "VENDOR_ID": run.VENDOR_ID,
        "PAY_YEAR": run.PAY_YEAR,
        "PAY_MONTH": run.PAY_MONTH,
        "PERIOD_LABEL": f"{run.PAY_YEAR}-{run.PAY_MONTH:02d}",
        "WORKING_DAYS": run.WORKING_DAYS,
        "STATUS": run.STATUS,
        "TOTAL_GROSS": run.TOTAL_GROSS,
        "TOTAL_DEDUCTIONS": run.TOTAL_DEDUCTIONS,
        "TOTAL_NET": run.TOTAL_NET,
        "EMPLOYEE_COUNT": run.EMPLOYEE_COUNT,
        "NOTES": run.NOTES,
        "GENERATED_BY": run.GENERATED_BY,
        "CREATED_AT": run.CREATED_AT.isoformat() if run.CREATED_AT else None,
        "FINALIZED_AT": (
            run.FINALIZED_AT.isoformat() if run.FINALIZED_AT else None
        )
    }


def _serialize_slip(slip: PayrollSlip, employee: Optional[Employee] = None) -> dict:

    return {
        "ID": slip.ID,
        "PAYROLL_RUN_ID": slip.PAYROLL_RUN_ID,
        "EMPLOYEE_ID": slip.EMPLOYEE_ID,
        "EMPLOYEE_NAME": employee.NAME if employee else None,
        "EMPLOYEE_CODE": employee.EMPLOYEE_CODE if employee else None,
        "BASE_SALARY": slip.BASE_SALARY,
        "WORKING_DAYS": slip.WORKING_DAYS,
        "PER_DAY_RATE": slip.PER_DAY_RATE,
        "DAYS_PRESENT": slip.DAYS_PRESENT,
        "DAYS_LATE": slip.DAYS_LATE,
        "DAYS_HALF": slip.DAYS_HALF,
        "PAID_LEAVE_DAYS": slip.PAID_LEAVE_DAYS,
        "UNPAID_LEAVE_DAYS": slip.UNPAID_LEAVE_DAYS,
        "ABSENT_DAYS": slip.ABSENT_DAYS,
        "TASKS_COMPLETED": slip.TASKS_COMPLETED,
        "TASK_BONUS_PER_TASK": slip.TASK_BONUS_PER_TASK,
        "EARNED_BASIC": slip.EARNED_BASIC,
        # Phase E: component earnings
        "HRA": slip.HRA,
        "DA": slip.DA,
        "CONVEYANCE_ALLOWANCE": slip.CONVEYANCE_ALLOWANCE,
        "MEDICAL_ALLOWANCE": slip.MEDICAL_ALLOWANCE,
        "SPECIAL_ALLOWANCE": slip.SPECIAL_ALLOWANCE,
        "OTHER_ALLOWANCES": slip.OTHER_ALLOWANCES,
        "ANNUAL_BONUS": slip.ANNUAL_BONUS,
        "INCENTIVES": slip.INCENTIVES,
        "TASK_BONUS": slip.TASK_BONUS,
        "OT_HOURS": slip.OT_HOURS,
        "OT_PAY": slip.OT_PAY,
        "LATE_PENALTY": slip.LATE_PENALTY,
        # Phase E: statutory deductions
        "PF_EMPLOYEE": slip.PF_EMPLOYEE,
        "PF_EMPLOYER": slip.PF_EMPLOYER,
        "ESI_EMPLOYEE": slip.ESI_EMPLOYEE,
        "ESI_EMPLOYER": slip.ESI_EMPLOYER,
        "PROFESSIONAL_TAX": slip.PROFESSIONAL_TAX,
        "OTHER_DEDUCTIONS": slip.OTHER_DEDUCTIONS,
        "GROSS_PAY": slip.GROSS_PAY,
        "TOTAL_DEDUCTIONS": slip.TOTAL_DEDUCTIONS,
        "NET_PAY": slip.NET_PAY,
        "NOTES": slip.NOTES,
        "STATUS": slip.STATUS or "PENDING",
        "PAID_AT": slip.PAID_AT.isoformat() if slip.PAID_AT else None,
        "PERMISSION_HOURS": slip.PERMISSION_HOURS or 0.0,
        "PERFORMANCE_STARS": slip.PERFORMANCE_STARS or 0.0,
        "STAR_BONUS": slip.STAR_BONUS or 0.0
    }


# ----------------------------------------------------------------
# Endpoints
# ----------------------------------------------------------------

@router.post("/generate-for-employee")
def generate_for_employee(
    body: dict,
    db: Session = Depends(get_db),
):
    """HR generates ONE payslip for ONE employee for a given month/year.

    Body shape (all fields optional except the four required ones):
      {
        "EMPLOYEE_ID":  "uuid or EMP code"  (required),
        "YEAR":         2026                (required),
        "MONTH":        6                   (required, 1-12),
        "WORKING_DAYS": 26,                 (defaults to Employee policy / 26)

        // Attendance snapshot — pre-fill from HR's review, no auto-calc
        "DAYS_PRESENT":      24,
        "DAYS_LATE":         1,
        "PAID_LEAVE_DAYS":   1,
        "UNPAID_LEAVE_DAYS": 0,
        "ABSENT_DAYS":       0,
        "OT_HOURS":          0,

        // Earnings (rupees per month)
        "BASIC":              18000,
        "HRA":                7200,
        "DA":                 0,
        "CONVEYANCE":         1600,
        "MEDICAL_ALLOWANCE":  1250,
        "SPECIAL_ALLOWANCE":  0,
        "OTHER_ALLOWANCES":   0,
        "BONUS":              0,
        "INCENTIVES":         0,
        "TASK_BONUS":         0,
        "OT_PAY":             0,

        // Deductions (rupees)
        "PF_EMPLOYEE":      1800,
        "ESI_EMPLOYEE":      0,
        "PROFESSIONAL_TAX":  200,
        "LATE_PENALTY":      0,
        "OTHER_DEDUCTIONS":  0
      }

    Behaviour:
      - Reuses or creates the PayrollRun for (vendor, year, month)
      - Inserts new PayrollSlip OR updates the existing one for this employee
      - Computes GROSS_PAY = sum of earnings
      - Computes TOTAL_DEDUCTIONS = sum of deductions
      - Computes NET_PAY = GROSS - DEDUCTIONS
      - Pushes a Notification to the employee
      - Returns the slip ID + summary
    """
    from app.utils.employee_resolver import require_employee
    from app.models.models import Notification

    emp_id_raw = body.get("EMPLOYEE_ID")
    year       = body.get("YEAR")
    month      = body.get("MONTH")

    if not emp_id_raw:
        raise HTTPException(status_code=400, detail="EMPLOYEE_ID is required")
    if not year or not month:
        raise HTTPException(status_code=400, detail="YEAR and MONTH are required")
    try:
        year  = int(year)
        month = int(month)
    except Exception:
        raise HTTPException(status_code=400, detail="YEAR and MONTH must be integers")
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="MONTH must be 1-12")

    emp = require_employee(db, emp_id_raw)
    vendor_id = getattr(emp, "VENDOR_ID", 1) or 1

    # Find or create the PayrollRun for this period.
    run = (
        db.query(PayrollRun)
        .filter(PayrollRun.VENDOR_ID == vendor_id)
        .filter(PayrollRun.PAY_YEAR == year)
        .filter(PayrollRun.PAY_MONTH == month)
        .first()
    )
    if not run:
        run = PayrollRun(
            VENDOR_ID=vendor_id,
            PAY_YEAR=year,
            PAY_MONTH=month,
            WORKING_DAYS=int(body.get("WORKING_DAYS") or 26),
            STATUS="DRAFT",
        )
        db.add(run); db.flush()

    if run.STATUS != "DRAFT":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Payroll run for {year}-{month:02d} is already "
                f"{run.STATUS} — unlock or delete it before regenerating."
            ),
        )

    # Find or create the slip for this (run, employee) pair.
    slip = (
        db.query(PayrollSlip)
        .filter(PayrollSlip.PAYROLL_RUN_ID == run.ID)
        .filter(PayrollSlip.EMPLOYEE_ID == emp.ID)
        .first()
    )
    if not slip:
        slip = PayrollSlip(
            PAYROLL_RUN_ID=run.ID,
            EMPLOYEE_ID=emp.ID,
            BASE_SALARY=float(getattr(emp, "SALARY", 0) or 0),
            WORKING_DAYS=run.WORKING_DAYS,
        )
        db.add(slip); db.flush()

    # ---- Fill from body, with sensible defaults ----
    def f(key, default=0.0):
        v = body.get(key)
        if v in (None, ""): return float(default)
        try: return float(v)
        except Exception: return float(default)
    def i(key, default=0):
        v = body.get(key)
        if v in (None, ""): return int(default)
        try: return int(v)
        except Exception: return int(default)

    slip.WORKING_DAYS       = i("WORKING_DAYS", run.WORKING_DAYS or 26)
    slip.DAYS_PRESENT       = i("DAYS_PRESENT", 0)
    slip.DAYS_LATE          = i("DAYS_LATE", 0)
    slip.PAID_LEAVE_DAYS    = f("PAID_LEAVE_DAYS", 0)
    slip.UNPAID_LEAVE_DAYS  = f("UNPAID_LEAVE_DAYS", 0)
    slip.ABSENT_DAYS        = f("ABSENT_DAYS", 0)
    slip.OT_HOURS           = f("OT_HOURS", 0)

    # ---- Earnings ----
    slip.EARNED_BASIC         = f("BASIC", 0)
    slip.HRA                  = f("HRA", 0)
    slip.DA                   = f("DA", 0)
    slip.CONVEYANCE_ALLOWANCE = f("CONVEYANCE", 0)
    slip.MEDICAL_ALLOWANCE    = f("MEDICAL_ALLOWANCE", 0)
    slip.SPECIAL_ALLOWANCE    = f("SPECIAL_ALLOWANCE", 0)
    slip.OTHER_ALLOWANCES     = f("OTHER_ALLOWANCES", 0)
    slip.ANNUAL_BONUS         = f("BONUS", 0)
    slip.INCENTIVES           = f("INCENTIVES", 0)
    slip.TASK_BONUS           = f("TASK_BONUS", 0)
    slip.OT_PAY               = f("OT_PAY", 0)

    gross = (
        slip.EARNED_BASIC + slip.HRA + slip.DA
        + slip.CONVEYANCE_ALLOWANCE + slip.MEDICAL_ALLOWANCE
        + slip.SPECIAL_ALLOWANCE + slip.OTHER_ALLOWANCES
        + slip.ANNUAL_BONUS + slip.INCENTIVES
        + slip.TASK_BONUS + slip.OT_PAY
    )

    # ---- Deductions ----
    slip.PF_EMPLOYEE      = f("PF_EMPLOYEE", 0)
    slip.ESI_EMPLOYEE     = f("ESI_EMPLOYEE", 0)
    slip.PROFESSIONAL_TAX = f("PROFESSIONAL_TAX", 0)
    slip.LATE_PENALTY     = f("LATE_PENALTY", 0)
    slip.OTHER_DEDUCTIONS = f("OTHER_DEDUCTIONS", 0)

    deductions = (
        slip.PF_EMPLOYEE + slip.ESI_EMPLOYEE + slip.PROFESSIONAL_TAX
        + slip.LATE_PENALTY + slip.OTHER_DEDUCTIONS
    )

    slip.GROSS_PAY        = round(gross, 2)
    slip.TOTAL_DEDUCTIONS = round(deductions, 2)
    slip.NET_PAY          = round(gross - deductions, 2)
    slip.PER_DAY_RATE = (
        slip.EARNED_BASIC / slip.WORKING_DAYS
        if slip.WORKING_DAYS else 0.0
    )

    db.commit(); db.refresh(slip)

    # ---- Notify the employee ----
    try:
        month_names = [
            "January","February","March","April","May","June",
            "July","August","September","October","November","December",
        ]
        m_name = month_names[month - 1]
        db.add(Notification(
            TYPE="INFO",
            TITLE=f"New payslip — {m_name} {year}",
            MESSAGE=(
                f"{emp.NAME}'s {m_name} {year} payslip has been generated. "
                f"Net pay: INR {slip.NET_PAY:,.2f}. "
                f"View it in Employee Portal -> Payslips."
            ),
            CREATED_AT=datetime.utcnow(),
            IS_READ=0,
            VENDOR_ID=vendor_id,
        ))
        db.commit()
    except Exception:
        # Notification table schema may differ; never block payslip create.
        db.rollback()

    return {
        "message": f"Payslip generated for {emp.NAME} ({year}-{month:02d})",
        "slip_id": slip.ID,
        "run_id":  run.ID,
        "gross":   slip.GROSS_PAY,
        "deductions": slip.TOTAL_DEDUCTIONS,
        "net":     slip.NET_PAY,
        "employee_code": emp.EMPLOYEE_CODE,
        "employee_name": emp.NAME,
    }


@router.post("/generate")
def generate_payroll(
    data: GeneratePayrollRequest,
    db: Session = Depends(get_db)
):
    """Build (or refresh) a PayrollRun + per-employee slips for the
    given month. Idempotent for DRAFT runs (re-runs replace slips).
    Pass OVERWRITE=true to force-replace a FINALIZED/PAID run."""

    vendor_id = _resolve_vendor_id(db, data.VENDOR_ID)

    try:

        run = generate_payroll_run(
            db,
            vendor_id=vendor_id,
            year=data.YEAR,
            month=data.MONTH,
            working_days=data.WORKING_DAYS,
            task_bonus_per_task=data.TASK_BONUS_PER_TASK,
            late_penalty_per_day=data.LATE_PENALTY_PER_DAY,
            generated_by=data.GENERATED_BY,
            overwrite=data.OVERWRITE
        )

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    # Phase F — HR-chosen monthly increments. Apply them on top of the
    # auto-computed slips. Stored in the INCENTIVES column so existing
    # reports / payslip PDFs pick them up automatically.
    if data.INCREMENTS_BY_EMPLOYEE:
        slips = db.query(PayrollSlip).filter(
            PayrollSlip.PAYROLL_RUN_ID == run.ID
        ).all()
        for slip in slips:
            inc = data.INCREMENTS_BY_EMPLOYEE.get(slip.EMPLOYEE_ID)
            if inc is None:
                continue
            try:
                amt = float(inc)
            except (TypeError, ValueError):
                continue
            if amt <= 0:
                # Explicitly clear any previous increment
                slip.INCENTIVES = 0.0
            else:
                slip.INCENTIVES = amt
            # Recompute NET_PAY = GROSS_PAY - TOTAL_DEDUCTIONS, with
            # INCENTIVES factored into GROSS_PAY. We keep the math
            # simple here: NET_PAY = (existing GROSS_PAY - existing
            # INCENTIVES that was in GROSS_PAY) + new INCENTIVES
            # - existing TOTAL_DEDUCTIONS. Since INCENTIVES from
            # auto-compute is 0 by default (generator doesn't add it),
            # this simplifies to: NET_PAY = NET_PAY_old + new_increment.
            slip.NET_PAY = float(slip.NET_PAY or 0.0) + amt
            slip.GROSS_PAY = float(slip.GROSS_PAY or 0.0) + amt
        # Refresh the run totals so the dashboard KPIs reflect the
        # increments.
        run.TOTAL_GROSS = sum(float(s.GROSS_PAY or 0) for s in slips)
        run.TOTAL_NET   = sum(float(s.NET_PAY   or 0) for s in slips)
        db.commit()
        db.refresh(run)

    return {
        "message": (
            f"Payroll generated for {data.YEAR}-{data.MONTH:02d}: "
            f"{run.EMPLOYEE_COUNT} employees, ₹{run.TOTAL_NET:,.2f} net."
        ),
        "run": _serialize_run(run)
    }


@router.get("/runs")
def list_runs(
    vendor_id: int = 1,
    year: Optional[int] = None,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    q = db.query(PayrollRun).filter(PayrollRun.VENDOR_ID == vendor_id)

    if year:

        q = q.filter(PayrollRun.PAY_YEAR == year)

    rows = q.order_by(
        PayrollRun.PAY_YEAR.desc(),
        PayrollRun.PAY_MONTH.desc()
    ).all()

    return [_serialize_run(r) for r in rows]


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)):

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()

    if not run:

        raise HTTPException(status_code=404, detail="Payroll run not found")

    rows = (
        db.query(PayrollSlip, Employee)
        .outerjoin(Employee, PayrollSlip.EMPLOYEE_ID == Employee.ID)
        .filter(PayrollSlip.PAYROLL_RUN_ID == run_id)
        .all()
    )

    rows.sort(key=lambda r: (r[1].NAME if r[1] else ""))

    return {
        "run": _serialize_run(run),
        "slips": [_serialize_slip(slip, emp) for slip, emp in rows]
    }


@router.get("/runs/{run_id}/slip/{employee_id}")
def get_slip(
    run_id: int,
    employee_id: str,
    db: Session = Depends(get_db)
):

    slip = db.query(PayrollSlip).filter(
        PayrollSlip.PAYROLL_RUN_ID == run_id,
        PayrollSlip.EMPLOYEE_ID == employee_id
    ).first()

    if not slip:

        raise HTTPException(status_code=404, detail="Slip not found")

    employee = db.query(Employee).filter(
        Employee.ID == employee_id
    ).first()

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()

    return {
        "run": _serialize_run(run),
        "slip": _serialize_slip(slip, employee)
    }


# =========================
# REPORTS — summary + CSV export
# =========================

@router.get("/runs/{run_id}/summary")
def run_summary(run_id: int, db: Session = Depends(get_db)):
    """Aggregated summary for a payroll run — used by the Reports tab.

    Returns:
      - run header
      - by_department: [{department, employee_count, total_gross, total_deductions, total_net}]
      - by_designation: [{designation, employee_count, total_net}]
      - by_status: [{status, count, total_net}]
      - totals: {employee_count, total_gross, total_deductions, total_net}
    """
    from app.models.models import Department, Designation

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()
    if not run:
        raise HTTPException(404, "Payroll run not found")

    rows = (
        db.query(PayrollSlip, Employee, Department, Designation)
        .outerjoin(Employee,    PayrollSlip.EMPLOYEE_ID == Employee.ID)
        .outerjoin(Department,  Employee.DEPARTMENT_ID  == Department.ID)
        .outerjoin(Designation, Employee.DESIGNATION_ID == Designation.ID)
        .filter(PayrollSlip.PAYROLL_RUN_ID == run_id)
        .all()
    )

    by_dept = {}
    by_desig = {}
    by_status = {}
    tot_gross = tot_ded = tot_net = 0.0

    for slip, emp, dept, desig in rows:
        gross = float(slip.GROSS_PAY or 0)
        ded   = float(slip.TOTAL_DEDUCTIONS or 0)
        net   = float(slip.NET_PAY or 0)

        tot_gross += gross
        tot_ded   += ded
        tot_net   += net

        dept_name = (dept.NAME if dept else "—")
        d = by_dept.setdefault(dept_name, {
            "department": dept_name,
            "employee_count": 0,
            "total_gross": 0.0,
            "total_deductions": 0.0,
            "total_net": 0.0,
        })
        d["employee_count"] += 1
        d["total_gross"]    += gross
        d["total_deductions"] += ded
        d["total_net"]      += net

        desig_name = (desig.TITLE if desig else "—")
        x = by_desig.setdefault(desig_name, {
            "designation": desig_name,
            "employee_count": 0,
            "total_net": 0.0,
        })
        x["employee_count"] += 1
        x["total_net"]      += net

        st = (slip.STATUS or "PENDING").upper()
        s = by_status.setdefault(st, {
            "status": st,
            "count": 0,
            "total_net": 0.0,
        })
        s["count"]     += 1
        s["total_net"] += net

    def _round_block(d, keys):
        for k in keys:
            if k in d:
                d[k] = round(d[k], 2)
        return d

    by_dept_list = [
        _round_block(d, ["total_gross", "total_deductions", "total_net"])
        for d in sorted(by_dept.values(), key=lambda x: -x["total_net"])
    ]
    by_desig_list = [
        _round_block(d, ["total_net"])
        for d in sorted(by_desig.values(), key=lambda x: -x["total_net"])
    ]
    by_status_list = [
        _round_block(d, ["total_net"])
        for d in sorted(by_status.values(), key=lambda x: x["status"])
    ]

    return {
        "run":           _serialize_run(run),
        "by_department": by_dept_list,
        "by_designation": by_desig_list,
        "by_status":     by_status_list,
        "totals": {
            "employee_count":   len(rows),
            "total_gross":      round(tot_gross, 2),
            "total_deductions": round(tot_ded, 2),
            "total_net":        round(tot_net, 2),
        }
    }


@router.get("/runs/{run_id}/export.csv")
def run_export_csv(run_id: int, db: Session = Depends(get_db)):
    """CSV export of every slip in a run. Used by HR + accounting."""
    from fastapi.responses import StreamingResponse
    import csv
    import io
    from app.models.models import Department, Designation

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()
    if not run:
        raise HTTPException(404, "Payroll run not found")

    rows = (
        db.query(PayrollSlip, Employee, Department, Designation)
        .outerjoin(Employee,    PayrollSlip.EMPLOYEE_ID == Employee.ID)
        .outerjoin(Department,  Employee.DEPARTMENT_ID  == Department.ID)
        .outerjoin(Designation, Employee.DESIGNATION_ID == Designation.ID)
        .filter(PayrollSlip.PAYROLL_RUN_ID == run_id)
        .all()
    )
    rows.sort(key=lambda r: (r[1].NAME if r[1] else ""))

    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow([
        "Employee Code", "Employee Name", "Department", "Designation",
        "Base Salary", "Working Days", "Days Present",
        "Paid Leave", "Unpaid Leave", "Absent Days", "Permission Hours",
        "Earned Basic", "HRA", "DA", "Conveyance", "Medical", "Special",
        "Other Allowances", "Annual Bonus", "Incentives",
        "Task Bonus", "Star Bonus", "OT Hours", "OT Pay",
        "PF (Employee)", "ESI (Employee)", "Prof Tax",
        "Other Deductions", "Late Penalty",
        "Gross Pay", "Total Deductions", "Net Pay",
        "Status", "Paid At",
    ])

    for slip, emp, dept, desig in rows:
        writer.writerow([
            (emp.EMPLOYEE_CODE if emp else ""),
            (emp.NAME          if emp else ""),
            (dept.NAME         if dept else ""),
            (desig.TITLE       if desig else ""),
            slip.BASE_SALARY or 0,
            slip.WORKING_DAYS or 0,
            slip.DAYS_PRESENT or 0,
            slip.PAID_LEAVE_DAYS or 0,
            slip.UNPAID_LEAVE_DAYS or 0,
            slip.ABSENT_DAYS or 0,
            slip.PERMISSION_HOURS or 0,
            slip.EARNED_BASIC or 0,
            slip.HRA or 0,
            slip.DA or 0,
            slip.CONVEYANCE_ALLOWANCE or 0,
            slip.MEDICAL_ALLOWANCE or 0,
            slip.SPECIAL_ALLOWANCE or 0,
            slip.OTHER_ALLOWANCES or 0,
            slip.ANNUAL_BONUS or 0,
            slip.INCENTIVES or 0,
            slip.TASK_BONUS or 0,
            slip.STAR_BONUS or 0,
            slip.OT_HOURS or 0,
            slip.OT_PAY or 0,
            slip.PF_EMPLOYEE or 0,
            slip.ESI_EMPLOYEE or 0,
            slip.PROFESSIONAL_TAX or 0,
            slip.OTHER_DEDUCTIONS or 0,
            slip.LATE_PENALTY or 0,
            slip.GROSS_PAY or 0,
            slip.TOTAL_DEDUCTIONS or 0,
            slip.NET_PAY or 0,
            slip.STATUS or "PENDING",
            slip.PAID_AT.isoformat() if slip.PAID_AT else "",
        ])

    buf.seek(0)
    period = f"{run.PAY_YEAR}-{run.PAY_MONTH:02d}"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="payroll-{period}.csv"'
        }
    )


@router.patch("/runs/{run_id}/finalize")
def finalize_run(run_id: int, db: Session = Depends(get_db)):
    """Lock a DRAFT run — slips can no longer be edited and the run
    can be safely referenced from accounting."""

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()

    if not run:

        raise HTTPException(status_code=404, detail="Payroll run not found")

    if run.STATUS != "DRAFT":

        raise HTTPException(
            status_code=409,
            detail=f"Run is {run.STATUS}, only DRAFT can be finalized."
        )

    run.STATUS = "FINALIZED"

    run.FINALIZED_AT = datetime.utcnow()

    db.commit()

    return {
        "message": f"Run {run.PAY_YEAR}-{run.PAY_MONTH:02d} finalized.",
        "run": _serialize_run(run)
    }


@router.patch("/slips/{slip_id}/mark-paid")
def mark_slip_paid(slip_id: int, db: Session = Depends(get_db)):
    """Mark one employee's slip as PAID. Used by the simplified
    employee-list payroll UI where each row has its own Mark Paid
    button instead of a run-level workflow."""

    slip = db.query(PayrollSlip).filter(PayrollSlip.ID == slip_id).first()

    if not slip:

        raise HTTPException(status_code=404, detail="Payroll slip not found")

    slip.STATUS = "PAID"

    slip.PAID_AT = datetime.utcnow()

    db.commit()

    employee = db.query(Employee).filter(
        Employee.ID == slip.EMPLOYEE_ID
    ).first()

    return {
        "message": "Slip marked PAID.",
        "slip": _serialize_slip(slip, employee)
    }


@router.patch("/runs/{run_id}/mark-paid")
def mark_paid(run_id: int, db: Session = Depends(get_db)):

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()

    if not run:

        raise HTTPException(status_code=404, detail="Payroll run not found")

    if run.STATUS not in ("FINALIZED", "PAID"):

        raise HTTPException(
            status_code=409,
            detail="Only FINALIZED runs can be marked PAID."
        )

    run.STATUS = "PAID"

    db.commit()

    return {
        "message": "Run marked PAID.",
        "run": _serialize_run(run)
    }


@router.delete("/runs/{run_id}")
def delete_run(run_id: int, db: Session = Depends(get_db)):

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()

    if not run:

        raise HTTPException(status_code=404, detail="Payroll run not found")

    if run.STATUS != "DRAFT":

        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete a {run.STATUS} run. Only DRAFT runs can be removed."
        )

    db.query(PayrollSlip).filter(
        PayrollSlip.PAYROLL_RUN_ID == run_id
    ).delete(synchronize_session=False)

    db.delete(run)

    db.commit()

    return {"message": f"Run {run.PAY_YEAR}-{run.PAY_MONTH:02d} deleted."}


# ====================================================================
# Phase E — Salary Structure CRUD
# ====================================================================

class SalaryStructureBody(BaseModel):
    """Used for both POST and PATCH (PATCH ignores unset fields)."""

    BASIC: float = 0.0
    HRA: float = 0.0
    DA: float = 0.0
    CONVEYANCE_ALLOWANCE: float = 0.0
    MEDICAL_ALLOWANCE: float = 0.0
    SPECIAL_ALLOWANCE: float = 0.0
    OTHER_ALLOWANCES: float = 0.0
    ANNUAL_BONUS: float = 0.0
    INCENTIVES: float = 0.0
    PT_STATE: Optional[str] = "TAMIL_NADU"
    PF_APPLICABLE: int = 1
    ESI_APPLICABLE: int = 1
    NOTES: Optional[str] = None
    EFFECTIVE_FROM: Optional[str] = None  # ISO date


def _serialize_structure(s: SalaryStructure) -> dict:

    gross = round(
        (s.BASIC or 0) + (s.HRA or 0) + (s.DA or 0) +
        (s.CONVEYANCE_ALLOWANCE or 0) + (s.MEDICAL_ALLOWANCE or 0) +
        (s.SPECIAL_ALLOWANCE or 0) + (s.OTHER_ALLOWANCES or 0) +
        (s.ANNUAL_BONUS or 0) + (s.INCENTIVES or 0),
        2
    )

    return {
        "ID": s.ID,
        "EMPLOYEE_ID": s.EMPLOYEE_ID,
        "BASIC": s.BASIC,
        "HRA": s.HRA,
        "DA": s.DA,
        "CONVEYANCE_ALLOWANCE": s.CONVEYANCE_ALLOWANCE,
        "MEDICAL_ALLOWANCE": s.MEDICAL_ALLOWANCE,
        "SPECIAL_ALLOWANCE": s.SPECIAL_ALLOWANCE,
        "OTHER_ALLOWANCES": s.OTHER_ALLOWANCES,
        "ANNUAL_BONUS": s.ANNUAL_BONUS,
        "INCENTIVES": s.INCENTIVES,
        "GROSS_MONTHLY": gross,
        "PT_STATE": s.PT_STATE,
        "PF_APPLICABLE": bool(s.PF_APPLICABLE),
        "ESI_APPLICABLE": bool(s.ESI_APPLICABLE),
        "NOTES": s.NOTES,
        "EFFECTIVE_FROM": (
            s.EFFECTIVE_FROM.isoformat() if s.EFFECTIVE_FROM else None
        ),
        "CREATED_AT": (
            s.CREATED_AT.isoformat() if s.CREATED_AT else None
        ),
        "UPDATED_AT": (
            s.UPDATED_AT.isoformat() if s.UPDATED_AT else None
        )
    }


@router.get("/salary-structures")
def list_salary_structures(db: Session = Depends(get_db)):
    """List every salary structure (one per employee)."""

    rows = db.query(SalaryStructure).all()

    return [_serialize_structure(r) for r in rows]


@router.get("/salary-structures/{employee_id}")
def get_salary_structure(
    employee_id: str,
    db: Session = Depends(get_db)
):
    """Returns the employee's structure, or 404 if not configured.

    Also returns a `preview` of what statutory deductions would look
    like at the full monthly gross (handy for HR before saving)."""

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    s = db.query(SalaryStructure).filter(
        SalaryStructure.EMPLOYEE_ID == employee_id
    ).first()

    if not s:

        raise HTTPException(
            status_code=404,
            detail="No salary structure configured for this employee."
        )

    data = _serialize_structure(s)

    preview = compute_statutory_deductions(
        basic=s.BASIC or 0.0,
        da=s.DA or 0.0,
        gross=data["GROSS_MONTHLY"],
        pt_state=s.PT_STATE,
        pf_applicable=bool(s.PF_APPLICABLE),
        esi_applicable=bool(s.ESI_APPLICABLE)
    )

    data["statutory_preview"] = preview

    return data


@router.put("/salary-structures/{employee_id}")
def upsert_salary_structure(
    employee_id: str,
    body: SalaryStructureBody,
    db: Session = Depends(get_db)
):
    """Create or update the salary structure for an employee."""

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    s = db.query(SalaryStructure).filter(
        SalaryStructure.EMPLOYEE_ID == employee_id
    ).first()

    eff_from = None

    if body.EFFECTIVE_FROM:

        try:

            eff_from = datetime.fromisoformat(body.EFFECTIVE_FROM).date()

        except ValueError:

            raise HTTPException(
                status_code=400,
                detail="EFFECTIVE_FROM must be a date (YYYY-MM-DD)"
            )

    fields = {
        "BASIC": body.BASIC,
        "HRA": body.HRA,
        "DA": body.DA,
        "CONVEYANCE_ALLOWANCE": body.CONVEYANCE_ALLOWANCE,
        "MEDICAL_ALLOWANCE": body.MEDICAL_ALLOWANCE,
        "SPECIAL_ALLOWANCE": body.SPECIAL_ALLOWANCE,
        "OTHER_ALLOWANCES": body.OTHER_ALLOWANCES,
        "ANNUAL_BONUS": body.ANNUAL_BONUS,
        "INCENTIVES": body.INCENTIVES,
        "PT_STATE": (body.PT_STATE or "TAMIL_NADU"),
        "PF_APPLICABLE": int(body.PF_APPLICABLE or 0),
        "ESI_APPLICABLE": int(body.ESI_APPLICABLE or 0),
        "NOTES": body.NOTES,
        "EFFECTIVE_FROM": eff_from,
    }

    if s:

        for k, v in fields.items():

            setattr(s, k, v)

        action = "updated"

    else:

        s = SalaryStructure(EMPLOYEE_ID=employee_id, **fields)

        db.add(s)

        action = "created"

    db.commit()

    db.refresh(s)

    return {
        "message": f"Salary structure {action} for {emp.NAME}.",
        "structure": _serialize_structure(s)
    }


@router.delete("/salary-structures/{employee_id}")
def delete_salary_structure(
    employee_id: str,
    db: Session = Depends(get_db)
):

    s = db.query(SalaryStructure).filter(
        SalaryStructure.EMPLOYEE_ID == employee_id
    ).first()

    if not s:

        raise HTTPException(status_code=404, detail="No structure to delete")

    db.delete(s)

    db.commit()

    return {"message": f"Salary structure for {employee_id} deleted."}


# ====================================================================
# Phase E — Payslip PDF
# ====================================================================

@router.get("/runs/{run_id}/slip/{employee_id}/pdf")
def payslip_pdf(
    run_id: int,
    employee_id: str,
    db: Session = Depends(get_db)
):
    """Generate a single-page payslip PDF for download/print."""

    from io import BytesIO

    from fastapi.responses import StreamingResponse

    from xhtml2pdf import pisa

    run = db.query(PayrollRun).filter(PayrollRun.ID == run_id).first()

    if not run:

        raise HTTPException(status_code=404, detail="Payroll run not found")

    slip = db.query(PayrollSlip).filter(
        PayrollSlip.PAYROLL_RUN_ID == run_id,
        PayrollSlip.EMPLOYEE_ID == employee_id
    ).first()

    if not slip:

        raise HTTPException(
            status_code=404,
            detail="No payslip for that employee in this run."
        )

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    month_label = datetime(run.PAY_YEAR, run.PAY_MONTH, 1).strftime("%B %Y")

    # Phase 3 Admin Module — pull company branding from CompanyMaster
    from app.services.company_settings_service import (
        get_company_settings, format_full_address
    )

    company = get_company_settings(db, run.VENDOR_ID or 1)

    company_address = format_full_address(company)

    # ---- Logo (embed as base64 data URI so xhtml2pdf can render it) ----
    import base64
    from pathlib import Path
    logo_data_uri = None
    if company.LOGO_URL:
        rel = company.LOGO_URL.split("/static/", 1)[-1]
        disk = Path(__file__).resolve().parent.parent.parent / "static" / rel
        if disk.exists():
            try:
                ext = disk.suffix.lower().lstrip(".") or "png"
                mime = (
                    "image/jpeg" if ext in ("jpg", "jpeg")
                    else "image/png" if ext == "png"
                    else "image/webp" if ext == "webp"
                    else "image/svg+xml" if ext == "svg"
                    else f"image/{ext}"
                )
                with disk.open("rb") as fh:
                    b64 = base64.b64encode(fh.read()).decode("ascii")
                logo_data_uri = f"data:{mime};base64,{b64}"
            except Exception:
                logo_data_uri = None

    # ---- Compute per-rule numbers (same formula as the Payroll page) ----
    # The displayed Total Salary is ALWAYS base − deduction + increment so
    # the payslip never disagrees with the page; we do not read slip.NET_PAY
    # here because legacy slips may have stored a value computed under a
    # different ruleset.
    working_days = int(slip.WORKING_DAYS or 26)
    base_salary  = float(slip.BASE_SALARY or 0.0)
    per_day      = (base_salary / working_days) if working_days else 0.0

    days_present = int(slip.DAYS_PRESENT or 0)
    absent_days  = float(slip.ABSENT_DAYS or 0.0)
    cl_used      = float(slip.PAID_LEAVE_DAYS or 0.0)
    perm_hours   = float(slip.PERMISSION_HOURS or 0.0)
    late_count   = int(slip.DAYS_LATE or 0)

    cl_paid       = min(cl_used, 1.0)
    cl_unpaid     = max(0.0, cl_used - 1.0)
    perm_paid     = min(perm_hours, 4.0)
    perm_unpaid_h = max(0.0, perm_hours - 4.0)
    perm_unpaid_d = perm_unpaid_h / 8.0

    unpaid_total_days = absent_days + cl_unpaid + perm_unpaid_d + float(slip.UNPAID_LEAVE_DAYS or 0.0)
    deduction     = round(unpaid_total_days * per_day, 2)
    increment     = float(slip.INCENTIVES or 0.0)
    total_salary  = max(0.0, base_salary - deduction + increment)

    def _row2(label, val_html, muted=False, strong=False):
        color = "#64748b" if muted else "#0f172a"
        weight = "700" if strong else "400"
        return (
            f"<tr>"
            f"<td style='padding:6px 10px;color:#475569;font-size:12px;'>{label}</td>"
            f"<td style='padding:6px 10px;color:{color};font-size:12px;"
            f"font-weight:{weight};text-align:right;font-family:monospace;'>{val_html}</td>"
            f"</tr>"
        )

    # ---- Build the HTML pieces conditionally (no flexbox — xhtml2pdf uses tables) ----
    logo_cell_html = (
        f'<img src="{logo_data_uri}" style="height:64px;max-width:160px;" />'
        if logo_data_uri else
        f'<div style="display:inline-block;background:#C8102E;color:#fff;'
        f'width:64px;height:64px;text-align:center;line-height:64px;'
        f'border-radius:8px;font-size:22px;font-weight:900;">'
        f'{(company.SHORT_NAME or "BVC")[:3].upper()}</div>'
    )

    warning_html = ""
    if cl_unpaid > 0 or perm_unpaid_h > 0:
        which = []
        if cl_unpaid > 0:    which.append("CL")
        if perm_unpaid_h > 0: which.append("permission")
        warning_html = (
            '<table style="width:100%;border-collapse:collapse;margin-top:14px;">'
            '<tr><td style="background:#fef3c7;border:1px solid #fde68a;'
            'border-left:4px solid #f59e0b;padding:10px 14px;font-size:11px;'
            'color:#78350f;border-radius:4px;">'
            f'<b>Note:</b> Monthly cap exceeded on {" and ".join(which)}. '
            'The excess was treated as unpaid leave and deducted from this payslip.'
            '</td></tr></table>'
        )

    company_meta_bits = []
    if company.GST_NUMBER: company_meta_bits.append(f"GST: {company.GST_NUMBER}")
    if company.PAN_NUMBER: company_meta_bits.append(f"PAN: {company.PAN_NUMBER}")
    if company.PHONE:      company_meta_bits.append(company.PHONE)
    if company.EMAIL:      company_meta_bits.append(company.EMAIL)
    company_meta = " · ".join(company_meta_bits)

    html = f"""
    <html>
      <head>
        <meta charset="utf-8"/>
        <style>
          body  {{ font-family: Helvetica, Arial, sans-serif; color:#0f172a;
                   margin:0; padding:0; }}
          .page {{ padding: 36px 44px; }}
          .h-title  {{ font-size:28px; font-weight:900; letter-spacing:-0.5px;
                       color:#0f172a; }}
          .h-sub    {{ font-size:13px; color:#475569; font-weight:600; }}
          .lbl-xs   {{ font-size:11px; font-weight:800; letter-spacing:1.8px;
                       color:#64748b; text-transform:uppercase; }}
          .section-title {{ font-size:13px; font-weight:900; letter-spacing:1.6px;
                            color:#0f172a; text-transform:uppercase;
                            padding:14px 18px; background:#f8fafc;
                            border-bottom:2px solid #e2e8f0; }}
          .panel {{ border:1px solid #e2e8f0; border-radius:8px;
                    margin-bottom:18px; overflow:hidden;
                    background:white; }}
          .info-tbl td   {{ padding:9px 18px; font-size:13px; vertical-align:top;
                            font-weight:600; }}
          .info-tbl td.lbl {{ color:#64748b; font-weight:600; }}
          .summary-tbl td {{ padding:12px 18px; font-size:13px;
                             border-bottom:1px solid #f1f5f9;
                             font-weight:600; }}
          .summary-tbl tr:last-child td {{ border-bottom:none; }}
          .summary-tbl td.lbl {{ color:#334155; }}
          .val-right     {{ text-align:right; font-family: Helvetica, Arial, sans-serif;
                            font-weight:800; color:#0f172a; font-size:14px; }}
          .total-table   {{ width:100%; border-collapse:collapse;
                            margin-top:10px; margin-bottom:10px; }}
          .total-table td  {{ padding:24px 28px; }}
          .total-band      {{ background:#C8102E; color:white;
                              border-radius:8px; }}
          .total-label     {{ font-size:12px; letter-spacing:2.4px;
                              font-weight:900; }}
          .total-help      {{ font-size:11px; opacity:0.9; margin-top:4px;
                              font-weight:600; }}
          .total-amt       {{ font-size:36px; font-weight:900;
                              text-align:right; letter-spacing:-0.6px; }}
          .sign-row td     {{ padding-top:64px; vertical-align:bottom;
                              font-size:12px; color:#475569; font-weight:700;
                              border-top:1.5px solid #94a3b8; width:35%; }}
          .footnote        {{ margin-top:28px; padding-top:16px;
                              border-top:1px dashed #cbd5e1;
                              font-size:11px; color:#64748b; font-weight:500;
                              text-align:center; line-height:1.7; }}
          .footnote b      {{ color:#0f172a; }}
          .pill-warn       {{ display:inline-block; padding:2px 9px;
                              border-radius:4px; font-size:10px;
                              font-weight:800; letter-spacing:0.6px;
                              background:#fef3c7; color:#92400e;
                              margin-left:8px; text-transform:uppercase; }}
          .muted-note      {{ color:#94a3b8; font-weight:500; font-size:11px; }}
        </style>
      </head>
      <body>
        <div class="page">

          <!-- ============ HEADER (logo + company) ============ -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
            <tr>
              <td style="width:96px;vertical-align:middle;">{logo_cell_html}</td>
              <td style="vertical-align:middle;padding-left:18px;">
                <div style="font-size:22px;font-weight:900;letter-spacing:-0.5px;
                            color:#0f172a;">{company.LEGAL_NAME or 'Company'}</div>
                <div style="font-size:12px;color:#475569;margin-top:4px;font-weight:600;">
                  {company_address}
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:3px;font-weight:500;">
                  {company_meta}
                </div>
              </td>
              <td style="vertical-align:middle;text-align:right;width:200px;">
                <div class="lbl-xs" style="color:#C8102E;">Payslip</div>
                <div style="font-size:18px;font-weight:900;color:#0f172a;
                            margin-top:4px;letter-spacing:-0.3px;">{month_label}</div>
                <div style="font-size:11px;color:#64748b;margin-top:3px;font-weight:600;">
                  Generated: {datetime.now().strftime('%d %b %Y')}
                </div>
              </td>
            </tr>
          </table>

          <!-- Red rule line -->
          <div style="height:4px;background:#C8102E;margin:14px 0 24px;"></div>

          <!-- ============ EMPLOYEE + BANK INFO ============ -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">
            <tr>
              <td style="width:50%;vertical-align:top;padding-right:10px;">
                <div class="lbl-xs" style="margin-bottom:8px;">Employee</div>
                <div class="panel">
                  <table class="info-tbl" style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td class="lbl" style="width:38%;">Name</td>
                      <td style="font-weight:800;">{emp.NAME or '—'}</td>
                    </tr>
                    <tr>
                      <td class="lbl">Code</td>
                      <td>{emp.EMPLOYEE_CODE or '—'}</td>
                    </tr>
                    <tr>
                      <td class="lbl">Department</td>
                      <td>{(emp.DEPARTMENT.NAME if hasattr(emp, 'DEPARTMENT') and emp.DEPARTMENT else '—')}</td>
                    </tr>
                    <tr>
                      <td class="lbl">Designation</td>
                      <td>{(emp.DESIGNATION.TITLE if hasattr(emp, 'DESIGNATION') and emp.DESIGNATION else '—')}</td>
                    </tr>
                    <tr>
                      <td class="lbl">Joining date</td>
                      <td>{emp.JOINING_DATE.strftime('%d %b %Y') if emp.JOINING_DATE else '—'}</td>
                    </tr>
                  </table>
                </div>
              </td>
              <td style="width:50%;vertical-align:top;padding-left:10px;">
                <div class="lbl-xs" style="margin-bottom:8px;">Bank &amp; Tax</div>
                <div class="panel">
                  <table class="info-tbl" style="width:100%;border-collapse:collapse;">
                    <tr>
                      <td class="lbl" style="width:38%;">Bank</td>
                      <td>{emp.BANK_NAME or '—'}</td>
                    </tr>
                    <tr>
                      <td class="lbl">A/C No.</td>
                      <td style="font-family:monospace;">{emp.BANK_ACCOUNT_NUMBER or '—'}</td>
                    </tr>
                    <tr>
                      <td class="lbl">IFSC</td>
                      <td style="font-family:monospace;">{emp.IFSC_CODE or '—'}</td>
                    </tr>
                    <tr>
                      <td class="lbl">PAN</td>
                      <td style="font-family:monospace;">{emp.PAN_NUMBER or '—'}</td>
                    </tr>
                    <tr>
                      <td class="lbl">Aadhaar</td>
                      <td style="font-family:monospace;">{emp.AADHAAR_NUMBER or '—'}</td>
                    </tr>
                  </table>
                </div>
              </td>
            </tr>
          </table>

          <!-- ============ ATTENDANCE SUMMARY ============ -->
          <div class="panel">
            <div class="section-title">Attendance Summary</div>
            <table class="summary-tbl" style="width:100%;border-collapse:collapse;">
              <tr>
                <td class="lbl" style="width:60%;">Working days <span class="muted-note">(monthly standard)</span></td>
                <td class="val-right">{working_days}</td>
              </tr>
              <tr>
                <td class="lbl">Present days</td>
                <td class="val-right" style="color:#15803d;">{days_present}</td>
              </tr>
              <tr>
                <td class="lbl">Absent days</td>
                <td class="val-right" style="color:{'#b91c1c' if absent_days > 0 else '#0f172a'};">{absent_days:g}</td>
              </tr>
              <tr>
                <td class="lbl">Casual Leave used &nbsp;<span class="muted-note">(paid up to 1)</span>
                  {'<span class="pill-warn">Over cap</span>' if cl_unpaid > 0 else ''}</td>
                <td class="val-right">{cl_used:g} <span class="muted-note">/ {cl_paid:g} paid</span></td>
              </tr>
              <tr>
                <td class="lbl">Permission used &nbsp;<span class="muted-note">(paid up to 4 h)</span>
                  {'<span class="pill-warn">Over cap</span>' if perm_unpaid_h > 0 else ''}</td>
                <td class="val-right">{perm_hours:g} h <span class="muted-note">/ {perm_paid:g} h paid</span></td>
              </tr>
              <tr>
                <td class="lbl">Late check-ins &nbsp;<span class="muted-note">(after 09:15)</span></td>
                <td class="val-right">{late_count}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td class="lbl" style="font-weight:800;color:#0f172a;">Total unpaid days</td>
                <td class="val-right" style="font-weight:900;font-size:15px;">{unpaid_total_days:.2f}</td>
              </tr>
            </table>
          </div>

          <!-- ============ SALARY CALCULATION ============ -->
          <div class="panel">
            <div class="section-title">Salary Calculation</div>
            <table class="summary-tbl" style="width:100%;border-collapse:collapse;">
              <tr>
                <td class="lbl" style="width:60%;">Base salary &nbsp;<span class="muted-note">(monthly)</span></td>
                <td class="val-right">₹ {base_salary:,.2f}</td>
              </tr>
              <tr>
                <td class="lbl">Per-day rate &nbsp;<span class="muted-note">(base ÷ {working_days})</span></td>
                <td class="val-right" style="color:#475569;">₹ {per_day:,.2f}</td>
              </tr>
              <tr>
                <td class="lbl">Less: Deduction &nbsp;<span class="muted-note">(unpaid days × per-day)</span></td>
                <td class="val-right" style="color:#b91c1c;">− ₹ {deduction:,.2f}</td>
              </tr>
              <tr>
                <td class="lbl">Add: Increment &nbsp;<span class="muted-note">(HR approved)</span></td>
                <td class="val-right" style="color:#15803d;">+ ₹ {increment:,.2f}</td>
              </tr>
            </table>
          </div>

          <!-- ============ TOTAL SALARY BAND ============ -->
          <table class="total-table">
            <tr>
              <td class="total-band">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td>
                      <div class="total-label">Total Salary</div>
                      <div class="total-help">Base − Deduction + Increment</div>
                    </td>
                    <td class="total-amt">₹ {total_salary:,.2f}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          {warning_html}

          <!-- ============ SIGNATURE STRIPS ============ -->
          <table style="width:100%;border-collapse:collapse;margin-top:70px;">
            <tr class="sign-row">
              <td>Authorised Signatory</td>
              <td style="width:30%;border:none;"></td>
              <td>Employee Signature</td>
            </tr>
          </table>

          <!-- ============ FOOTER ============ -->
          <div class="footnote">
            This is a computer-generated payslip — no signature is required for online records.<br/>
            <b>Salary policy:</b> 26 working days per month &nbsp;·&nbsp; 1 CL paid &nbsp;·&nbsp; 4 hours permission paid &nbsp;·&nbsp; Late after 09:15.
          </div>

        </div>
      </body>
    </html>
    """

    buf = BytesIO()

    result = pisa.CreatePDF(html, dest=buf)

    if result.err:

        raise HTTPException(
            status_code=500,
            detail=f"PDF generation failed: {result.err}"
        )

    buf.seek(0)

    fname = (
        f"payslip_{emp.EMPLOYEE_CODE}_"
        f"{run.PAY_YEAR}_{run.PAY_MONTH:02d}.pdf"
    )

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{fname}"'
        }
    )
