"""
Monthly Attendance & Payroll Reports — API surface.

  POST /monthly-reports/generate              (vendor-wide for a month)
  POST /monthly-reports/{emp_id}/generate     (single employee)
  GET  /monthly-reports?year=&month=          (list)
  GET  /monthly-reports/{emp_id}              (one row)
  GET  /monthly-reports/{emp_id}/pdf          (download PDF)
"""

from pathlib import Path
from datetime import date
from typing import Optional, List
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin, get_current_user
from app.models.models import Employee, MonthlyAttendanceReport, Vendor
from app.services.monthly_report_service import MonthlyReportService
from app.services.monthly_report_pdf import render_monthly_report_pdf


router = APIRouter(prefix="/monthly-reports", tags=["monthly-reports"])


REPORT_PDF_ROOT = Path("static/monthly_reports").resolve()


# =====================================================================
# Schemas
# =====================================================================


class GenerateIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


class ReportOut(BaseModel):
    id: int
    employee_id: str
    employee_code: Optional[str] = None
    employee_name: str
    year: int
    month: int
    total_days: int
    sundays: int
    holidays: int
    working_days: int
    present_days: float
    absent_days: float
    half_days: float
    late_count: int
    early_exit_count: int
    cl_used: float
    sick_used: float
    earned_used: float
    paid_leaves: float
    unpaid_leaves: float
    excess_leaves: float
    worked_hours: float
    overtime_hours: float
    expected_hours: float
    attendance_pct: float
    hour_compliance_pct: float
    monthly_salary: float
    daily_wage: float
    absence_deduction: float
    late_deduction: float
    ot_payable: float
    net_payable: float
    insights: List[str]
    status: str
    pdf_path: Optional[str] = None
    # Freshness flags — added for the auto-refresh layer.
    is_partial: bool = False    # True for current / future months
    is_locked:  bool = False    # True once month is over and AI auto-finalised
    as_of_date: Optional[str] = None
    updated_at: Optional[str] = None
    created_at: Optional[str] = None


class ListMeta(BaseModel):
    year: int
    month: int
    is_future: bool
    is_current: bool
    is_past: bool
    is_partial: bool
    as_of_date: str
    refreshed: bool
    auto_locked: bool
    skip_reason: Optional[str] = None


class ReportListResponse(BaseModel):
    meta: ListMeta
    reports: List[ReportOut]


class BulkResultOut(BaseModel):
    year: int
    month: int
    employees_processed: int


# =====================================================================
# Routes
# =====================================================================


@router.post("/generate", response_model=BulkResultOut)
def generate_for_vendor(payload: GenerateIn,
                        db: Session = Depends(get_db),
                        user: dict = Depends(get_current_admin)):
    svc = MonthlyReportService(db, user.get("vendor_id", 1))
    rows = svc.generate_for_vendor(payload.year, payload.month,
                                   actor_employee_id=user.get("employee_id"))
    return BulkResultOut(year=payload.year, month=payload.month,
                         employees_processed=len(rows))


@router.post("/{emp_id}/generate", response_model=ReportOut)
def generate_for_employee(emp_id: str, payload: GenerateIn,
                          db: Session = Depends(get_db),
                          user: dict = Depends(get_current_admin)):
    emp = (db.query(Employee)
           .filter((Employee.ID == emp_id) | (Employee.EMPLOYEE_CODE == emp_id))
           .first())
    if not emp:
        raise HTTPException(404, "Employee not found")
    svc = MonthlyReportService(db, emp.VENDOR_ID)
    row = svc.generate_for_employee(emp, payload.year, payload.month,
                                    actor_employee_id=user.get("employee_id"))
    db.commit()
    return ReportOut(**svc._serialise(row, emp))


@router.get("", response_model=ReportListResponse)
def list_reports(year: int, month: int,
                 force: bool = False,
                 db: Session = Depends(get_db),
                 user: dict = Depends(get_current_user)):
    """Returns reports for the month + a meta block describing freshness.

    AUTO-REFRESH semantics (no manual button needed):
      - Future month   → no-op
      - Past month     → recompute once, lock the rows as FINAL
      - Current month  → recompute if last run > 5 minutes ago

    Pass ?force=true to bypass cooldown and lock (admin only).
    """
    svc = MonthlyReportService(db, user.get("vendor_id", 1))
    meta = svc.auto_refresh_for_month(year, month, force=force)
    return ReportListResponse(
        meta=ListMeta(**meta),
        reports=[ReportOut(**r) for r in svc.list_reports(year, month)],
    )


@router.get("/{emp_id}", response_model=ReportOut)
def get_report(emp_id: str, year: int, month: int,
               db: Session = Depends(get_db),
               user: dict = Depends(get_current_user)):
    emp = (db.query(Employee)
           .filter((Employee.ID == emp_id) | (Employee.EMPLOYEE_CODE == emp_id))
           .first())
    if not emp:
        raise HTTPException(404, "Employee not found")
    svc = MonthlyReportService(db, emp.VENDOR_ID)
    data = svc.get_report(emp.ID, year, month)
    if not data:
        raise HTTPException(404, "Report not generated yet for this period")
    return ReportOut(**data)


@router.get("/{emp_id}/pdf")
def report_pdf(emp_id: str, year: int, month: int,
               db: Session = Depends(get_db),
               user: dict = Depends(get_current_user)):
    emp = (db.query(Employee)
           .filter((Employee.ID == emp_id) | (Employee.EMPLOYEE_CODE == emp_id))
           .first())
    if not emp:
        raise HTTPException(404, "Employee not found")

    svc = MonthlyReportService(db, emp.VENDOR_ID)
    data = svc.get_report(emp.ID, year, month)
    if not data:
        # Auto-generate if missing — convenience for "click PDF" with no prior gen.
        row = svc.generate_for_employee(emp, year, month,
                                        actor_employee_id=user.get("employee_id"))
        db.commit()
        data = svc._serialise(row, emp)

    # Resolve company name (best-effort)
    company_name = "BVC24"
    v = db.get(Vendor, emp.VENDOR_ID)
    if v and v.VENDOR_NAME:
        company_name = v.VENDOR_NAME

    out_dir = REPORT_PDF_ROOT / str(emp.VENDOR_ID) / str(year) / f"{month:02d}"
    path = render_monthly_report_pdf(
        data, employee_full_name=emp.NAME or "",
        employee_code=emp.EMPLOYEE_CODE or "",
        company_name=company_name, out_dir=out_dir,
    )

    # Persist relative path on the row so the UI can show "already generated"
    row = (db.query(MonthlyAttendanceReport)
           .filter(MonthlyAttendanceReport.EMPLOYEE_ID == emp.ID,
                   MonthlyAttendanceReport.YEAR == year,
                   MonthlyAttendanceReport.MONTH == month).first())
    if row:
        rel = str(path).split("static", 1)[-1]
        row.PDF_PATH = "static" + rel.replace("\\", "/")
        db.commit()

    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename=path.name,
    )
