"""
Auto-file generated payslip PDFs into the employee's document folder.

Called by generate_payroll_run() right after a PayrollSlip is written.
Renders the corporate payslip PDF (same one the /my-payslips/{id}/pdf
endpoint returns on demand), drops it on disk under
`backend/static/employee-docs/<emp_id>/` and creates or refreshes an
EmployeeDocument row with DOC_TYPE=PAYSLIP.

Idempotent: regenerating the same month replaces the previously-filed
copy so the doc folder never accumulates stale versions.

Errors are logged and swallowed — auto-filing must never abort a
payroll run.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Department,
    Designation,
    Employee,
    EmployeeDocument,
    PayrollRun,
    PayrollSlip,
)


log = logging.getLogger("payslip_filer")


def _payslip_number(slip: PayrollSlip, run: PayrollRun) -> str:
    return f"PS-{run.PAY_YEAR}-{run.PAY_MONTH:02d}-{slip.ID:04d}"


def _mask_account(num: Optional[str]) -> Optional[str]:
    if not num:
        return None
    s = str(num)
    if len(s) <= 4:
        return s
    return "•" * (len(s) - 4) + s[-4:]


def _resolve_company_dict(db: Session) -> dict:
    """Best-effort company header for the payslip. Falls back to the
    BVC defaults if the CompanyMaster row isn't set up."""
    try:
        from app.models.models import CompanyMaster
        c = db.query(CompanyMaster).order_by(CompanyMaster.ID.asc()).first()
        if c:
            return {
                "NAME":    getattr(c, "COMPANY_NAME", None) or "Bharath Vending Corporation",
                "ADDRESS": getattr(c, "ADDRESS", None),
                "GSTIN":   getattr(c, "GSTIN", None),
                "PAN":     getattr(c, "PAN", None),
                "PHONE":   getattr(c, "PHONE", None),
                "EMAIL":   getattr(c, "EMAIL", None),
                "WEBSITE": getattr(c, "WEBSITE", None),
                "LOGO_URL": getattr(c, "LOGO_URL", None),
            }
    except Exception:
        pass
    return {"NAME": "Bharath Vending Corporation"}


def file_payslip_as_document(
    db: Session,
    slip: PayrollSlip,
    run: PayrollRun,
    emp: Employee,
) -> Optional[EmployeeDocument]:
    """Render + persist the payslip PDF onto the employee's document
    folder. Returns the (possibly refreshed) EmployeeDocument row, or
    None if rendering failed.
    """

    try:
        from app.services.payslip_pdf_service import render_payslip_pdf
    except Exception as exc:
        log.warning("payslip_filer: cannot import renderer — %s", exc)
        return None

    # ---- Prepare dicts (same shape /my-payslips/{id}/pdf uses) ----
    dept_name = None
    if getattr(emp, "DEPARTMENT_ID", None):
        d = db.query(Department).filter(Department.ID == emp.DEPARTMENT_ID).first()
        if d:
            dept_name = getattr(d, "DEPARTMENT_NAME", None) or getattr(d, "NAME", None)

    desig_name = None
    if getattr(emp, "DESIGNATION_ID", None):
        de = db.query(Designation).filter(Designation.ID == emp.DESIGNATION_ID).first()
        if de:
            desig_name = getattr(de, "DESIGNATION_NAME", None) or getattr(de, "NAME", None)

    earnings = {
        "Basic Salary":      float(slip.EARNED_BASIC or 0),
        "HRA":               float(slip.HRA or 0),
        "DA":                float(slip.DA or 0),
        "Conveyance":        float(slip.CONVEYANCE_ALLOWANCE or 0),
        "Medical Allowance": float(slip.MEDICAL_ALLOWANCE or 0),
        "Special Allowance": float(slip.SPECIAL_ALLOWANCE or 0),
        "Other Allowances":  float(slip.OTHER_ALLOWANCES or 0),
        "Bonus":             float(slip.ANNUAL_BONUS or 0),
        "Incentives":        float(slip.INCENTIVES or 0),
        "Task Bonus":        float(slip.TASK_BONUS or 0),
        "Overtime":          float(slip.OT_PAY or 0),
    }
    deductions = {
        "Provident Fund (PF)": float(slip.PF_EMPLOYEE or 0),
        "ESI":                 float(slip.ESI_EMPLOYEE or 0),
        "Professional Tax":    float(slip.PROFESSIONAL_TAX or 0),
        "Late Penalty":        float(slip.LATE_PENALTY or 0),
        "Absence Deduction":   float(slip.ABSENCE_DEDUCTION or 0),
        "Other Deductions":    float(slip.OTHER_DEDUCTIONS or 0),
    }

    try:
        pdf_bytes = render_payslip_pdf(
            payslip_number=_payslip_number(slip, run),
            pay_year=run.PAY_YEAR,
            pay_month=run.PAY_MONTH,
            generated_at=getattr(slip, "CREATED_AT", None) or datetime.utcnow(),
            employee={
                "NAME":          emp.NAME,
                "CODE":          emp.EMPLOYEE_CODE,
                "DEPARTMENT":    dept_name,
                "DESIGNATION":   desig_name,
                "JOINING_DATE":  emp.JOINING_DATE,
                "BANK_ACCOUNT":  _mask_account(getattr(emp, "BANK_ACCOUNT_NUMBER", None)),
                "PAN":           getattr(emp, "PAN_NUMBER", None),
            },
            attendance={
                "WORKING_DAYS": slip.WORKING_DAYS,
                "PRESENT":      slip.DAYS_PRESENT,
                "LATE":         slip.DAYS_LATE,
                "LEAVE":        float(slip.PAID_LEAVE_DAYS or 0),
                "LOP":          float(slip.UNPAID_LEAVE_DAYS or 0),
                "ABSENT":       float(slip.ABSENT_DAYS or 0),
                "OT_HOURS":     float(slip.OT_HOURS or 0),
            },
            earnings=earnings,
            deductions=deductions,
            gross=float(slip.GROSS_PAY or 0),
            total_deductions=float(slip.TOTAL_DEDUCTIONS or 0),
            net=float(slip.NET_PAY or 0),
            company=_resolve_company_dict(db),
        )
    except Exception as exc:
        log.warning("payslip_filer: render failed for slip %s — %s", slip.ID, exc)
        return None

    # ---- Write to disk ----
    _here = Path(__file__).resolve().parent          # backend/app/services
    backend_root = _here.parent.parent               # backend/
    folder = backend_root / "static" / "employee-docs" / str(emp.ID)
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        log.warning("payslip_filer: mkdir failed at %s — %s", folder, exc)
        return None

    filename  = f"payslip-{run.PAY_YEAR}-{run.PAY_MONTH:02d}.pdf"
    disk_path = folder / filename
    try:
        disk_path.write_bytes(pdf_bytes)
    except Exception as exc:
        log.warning("payslip_filer: write failed at %s — %s", disk_path, exc)
        return None

    public_url = f"/static/employee-docs/{emp.ID}/{filename}"
    title = f"Payslip {run.PAY_YEAR}-{run.PAY_MONTH:02d}"

    # ---- Replace any previously-filed copy for the same month ----
    try:
        db.query(EmployeeDocument).filter(
            EmployeeDocument.EMPLOYEE_ID == emp.ID,
            EmployeeDocument.DOC_TYPE == "PAYSLIP",
            EmployeeDocument.TITLE == title,
        ).delete(synchronize_session=False)

        doc = EmployeeDocument(
            EMPLOYEE_ID=emp.ID,
            DOC_TYPE="PAYSLIP",
            TITLE=title,
            FILE_URL=public_url,
            FILE_NAME=filename,
            MIME="application/pdf",
            SIZE_BYTES=len(pdf_bytes),
            STATUS="ACTIVE",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)
        return doc
    except Exception as exc:
        log.warning("payslip_filer: doc row commit failed — %s", exc)
        db.rollback()
        return None
