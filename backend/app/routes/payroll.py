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

    def _row(label, amount, bold=False):

        weight = "700" if bold else "400"

        return (
            f"<tr><td style='padding:5px 8px;font-weight:{weight};'>"
            f"{label}</td>"
            f"<td style='padding:5px 8px;text-align:right;"
            f"font-weight:{weight};font-family:monospace;'>"
            f"₹ {amount:,.2f}</td></tr>"
        )

    earnings_rows = "".join([
        _row("Basic",                slip.EARNED_BASIC or 0),
        _row("HRA",                  slip.HRA or 0),
        _row("DA",                   slip.DA or 0),
        _row("Conveyance",           slip.CONVEYANCE_ALLOWANCE or 0),
        _row("Medical",              slip.MEDICAL_ALLOWANCE or 0),
        _row("Special Allowance",    slip.SPECIAL_ALLOWANCE or 0),
        _row("Other Allowances",     slip.OTHER_ALLOWANCES or 0),
        _row("Bonus (monthly share)", slip.ANNUAL_BONUS or 0),
        _row("Incentives",           slip.INCENTIVES or 0),
        _row("Task Bonus",           slip.TASK_BONUS or 0),
        _row("Overtime Pay",         slip.OT_PAY or 0),
    ])

    deductions_rows = "".join([
        _row("PF (Employee)",        slip.PF_EMPLOYEE or 0),
        _row("ESI (Employee)",       slip.ESI_EMPLOYEE or 0),
        _row("Professional Tax",     slip.PROFESSIONAL_TAX or 0),
        _row("Late Penalty",         slip.LATE_PENALTY or 0),
        _row("Other Deductions",     slip.OTHER_DEDUCTIONS or 0),
    ])

    html = f"""
    <html>
      <head><meta charset="utf-8"/></head>
      <body style="font-family:Arial,sans-serif;color:#0f172a;
                   margin:0;padding:24px;">

        <div style="border-bottom:3px solid #C8102E;padding-bottom:12px;
                    margin-bottom:18px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:11px;letter-spacing:2px;color:#7f1d1d;
                          font-weight:800;">
                {(company.SHORT_NAME or company.LEGAL_NAME or 'COMPANY')} · PAYSLIP
              </div>
              <div style="font-size:18px;font-weight:900;color:#1A0508;margin-top:2px;">
                {company.LEGAL_NAME or ''}
              </div>
              <div style="font-size:10px;color:#64748b;margin-top:2px;">
                {company_address}
                {' · GST: ' + company.GST_NUMBER if company.GST_NUMBER else ''}
              </div>
            </div>
          </div>
          <div style="font-size:24px;font-weight:900;margin-top:14px;">
            {emp.NAME}
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">
            {emp.EMPLOYEE_CODE} · Pay Period: {month_label} ·
            Working Days: {slip.WORKING_DAYS}
          </div>
        </div>

        <table style="width:100%;font-size:12px;
                      border-collapse:collapse;margin-bottom:18px;">
          <tr>
            <td style="padding:4px 8px;color:#64748b;">Bank</td>
            <td style="padding:4px 8px;">
              {emp.BANK_NAME or '—'} ·
              {emp.BANK_ACCOUNT_NUMBER or '—'}
            </td>
            <td style="padding:4px 8px;color:#64748b;">IFSC</td>
            <td style="padding:4px 8px;">{emp.IFSC_CODE or '—'}</td>
          </tr>
          <tr>
            <td style="padding:4px 8px;color:#64748b;">PAN</td>
            <td style="padding:4px 8px;">{emp.PAN_NUMBER or '—'}</td>
            <td style="padding:4px 8px;color:#64748b;">UAN/Aadhaar</td>
            <td style="padding:4px 8px;">{emp.AADHAAR_NUMBER or '—'}</td>
          </tr>
        </table>

        <table style="width:100%;font-size:12px;
                      border-collapse:collapse;margin-bottom:18px;">
          <tr>
            <td style="padding:4px 8px;color:#64748b;">Days Present</td>
            <td style="padding:4px 8px;">{slip.DAYS_PRESENT}</td>
            <td style="padding:4px 8px;color:#64748b;">Paid Leave</td>
            <td style="padding:4px 8px;">{slip.PAID_LEAVE_DAYS}</td>
            <td style="padding:4px 8px;color:#64748b;">Unpaid Leave</td>
            <td style="padding:4px 8px;">{slip.UNPAID_LEAVE_DAYS}</td>
            <td style="padding:4px 8px;color:#64748b;">Absent</td>
            <td style="padding:4px 8px;">{slip.ABSENT_DAYS}</td>
          </tr>
        </table>

        <table style="width:100%;border-collapse:collapse;
                      border:1px solid #e2e8f0;margin-bottom:16px;">
          <tr>
            <td style="width:50%;vertical-align:top;
                       border-right:1px solid #e2e8f0;">
              <div style="background:#fef2f2;padding:8px 12px;
                          font-size:11px;font-weight:800;letterspacing:1px;
                          color:#7f1d1d;border-bottom:1px solid #fecaca;">
                EARNINGS
              </div>
              <table style="width:100%;font-size:12px;">
                {earnings_rows}
              </table>
            </td>
            <td style="width:50%;vertical-align:top;">
              <div style="background:#eff6ff;padding:8px 12px;
                          font-size:11px;font-weight:800;letterspacing:1px;
                          color:#1e3a8a;border-bottom:1px solid #bfdbfe;">
                DEDUCTIONS
              </div>
              <table style="width:100%;font-size:12px;">
                {deductions_rows}
              </table>
            </td>
          </tr>
        </table>

        <table style="width:100%;font-size:13px;border-collapse:collapse;
                      margin-bottom:18px;">
          {_row("Gross Pay",          slip.GROSS_PAY or 0, bold=True)}
          {_row("Total Deductions",   slip.TOTAL_DEDUCTIONS or 0, bold=True)}
        </table>

        <div style="background:linear-gradient(135deg,#C8102E,#8B0B1F);
                    color:white;padding:16px 22px;border-radius:8px;
                    text-align:right;">
          <div style="font-size:10px;letter-spacing:2px;font-weight:700;
                      opacity:0.9;">NET PAY</div>
          <div style="font-size:30px;font-weight:900;margin-top:2px;
                      font-family:monospace;">
            ₹ {(slip.NET_PAY or 0):,.2f}
          </div>
        </div>

        <div style="margin-top:24px;font-size:10px;color:#94a3b8;
                    text-align:center;">
          Computer-generated payslip — no signature required.
          Statutory deductions: PF (12% of basic ≤ ₹15k),
          ESI (0.75% when gross ≤ ₹21k), PT per state slab.
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
