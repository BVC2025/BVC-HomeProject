"""
Employee self-service payslip endpoints.

  GET  /my-payslips?employee_id=X            -> list rows for the table
  GET  /my-payslips/{slip_id}/pdf            -> branded letterhead PDF
  GET  /my-payslips/summary?employee_id=X    -> tiles (total slips, YTD net, etc.)

All endpoints accept either a UUID or an EMPLOYEE_CODE — uses the
existing employee_resolver so links shared as `/my-payslips?employee_id=EMP101`
also work.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any
import io
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import (
    PayrollSlip, PayrollRun, Employee, Department, Designation,
    Notification,
)
from app.utils.employee_resolver import require_employee
from app.services.payslip_pdf_service import render_payslip_pdf


router = APIRouter(prefix="/my-payslips", tags=["Employee Payslips"])


# ============================================================
# LIST
# ============================================================

@router.get("")
def list_my_payslips(
    employee_id: str,
    db: Session = Depends(get_db),
):
    emp = require_employee(db, employee_id)

    rows = (
        db.query(PayrollSlip, PayrollRun)
        .join(PayrollRun, PayrollSlip.PAYROLL_RUN_ID == PayrollRun.ID)
        .filter(PayrollSlip.EMPLOYEE_ID == emp.ID)
        .order_by(PayrollRun.PAY_YEAR.desc(), PayrollRun.PAY_MONTH.desc())
        .all()
    )

    return [
        {
            "ID":               s.ID,
            "PAYSLIP_NUMBER":   _payslip_number(s, run),
            "MONTH":            run.PAY_MONTH,
            "YEAR":             run.PAY_YEAR,
            "MONTH_NAME":       _month_name(run.PAY_MONTH),
            "RUN_STATUS":       run.STATUS,
            "GROSS_PAY":        float(s.GROSS_PAY or 0),
            "TOTAL_DEDUCTIONS": float(s.TOTAL_DEDUCTIONS or 0),
            "NET_PAY":          float(s.NET_PAY or 0),
            "WORKING_DAYS":     s.WORKING_DAYS,
            "DAYS_PRESENT":     s.DAYS_PRESENT,
            "DAYS_LATE":        s.DAYS_LATE,
            "PAID_LEAVE_DAYS":  float(s.PAID_LEAVE_DAYS or 0),
            "UNPAID_LEAVE_DAYS": float(s.UNPAID_LEAVE_DAYS or 0),
            "ABSENT_DAYS":      float(s.ABSENT_DAYS or 0),
        }
        for s, run in rows
    ]


# ============================================================
# SUMMARY (for the 4 tiles at the top of the Payslips tab)
# ============================================================

@router.get("/summary")
def payslip_summary(
    employee_id: str,
    db: Session = Depends(get_db),
):
    emp = require_employee(db, employee_id)
    rows = (
        db.query(PayrollSlip, PayrollRun)
        .join(PayrollRun, PayrollSlip.PAYROLL_RUN_ID == PayrollRun.ID)
        .filter(PayrollSlip.EMPLOYEE_ID == emp.ID)
        .all()
    )
    this_year = datetime.utcnow().year
    ytd_net = sum(
        float(s.NET_PAY or 0)
        for s, run in rows if run.PAY_YEAR == this_year
    )
    last_net = 0.0
    last_label = "—"
    if rows:
        latest = sorted(rows, key=lambda x: (x[1].PAY_YEAR, x[1].PAY_MONTH), reverse=True)[0]
        last_net   = float(latest[0].NET_PAY or 0)
        last_label = f"{_month_name(latest[1].PAY_MONTH)} {latest[1].PAY_YEAR}"
    return {
        "total":      len(rows),
        "ytd_net":    ytd_net,
        "last_net":   last_net,
        "last_label": last_label,
        "ytd_year":   this_year,
    }


# ============================================================
# PDF
# ============================================================

@router.get("/{slip_id}/pdf")
def get_payslip_pdf(
    slip_id: int,
    db: Session = Depends(get_db),
):
    pair = (
        db.query(PayrollSlip, PayrollRun)
        .join(PayrollRun, PayrollSlip.PAYROLL_RUN_ID == PayrollRun.ID)
        .filter(PayrollSlip.ID == slip_id)
        .first()
    )
    if not pair:
        raise HTTPException(status_code=404, detail="Payslip not found")
    slip, run = pair

    emp = db.query(Employee).filter(Employee.ID == slip.EMPLOYEE_ID).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found for this slip")

    # Resolve department + designation names
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
        "Basic Salary":        float(slip.EARNED_BASIC or 0),
        "HRA":                 float(slip.HRA or 0),
        "DA":                  float(slip.DA or 0),
        "Conveyance":          float(slip.CONVEYANCE_ALLOWANCE or 0),
        "Medical Allowance":   float(slip.MEDICAL_ALLOWANCE or 0),
        "Special Allowance":   float(slip.SPECIAL_ALLOWANCE or 0),
        "Other Allowances":    float(slip.OTHER_ALLOWANCES or 0),
        "Bonus":               float(slip.ANNUAL_BONUS or 0),
        "Incentives":          float(slip.INCENTIVES or 0),
        "Task Bonus":          float(slip.TASK_BONUS or 0),
        "Overtime":            float(slip.OT_PAY or 0),
    }

    deductions = {
        "Provident Fund (PF)":  float(slip.PF_EMPLOYEE or 0),
        "ESI":                  float(slip.ESI_EMPLOYEE or 0),
        "Professional Tax":     float(slip.PROFESSIONAL_TAX or 0),
        "Late Penalty":         float(slip.LATE_PENALTY or 0),
        "Other Deductions":     float(slip.OTHER_DEDUCTIONS or 0),
    }

    company = _company_full(db)

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
            "WORKING_DAYS":  slip.WORKING_DAYS,
            "PRESENT":       slip.DAYS_PRESENT,
            "LATE":          slip.DAYS_LATE,
            "LEAVE":         float(slip.PAID_LEAVE_DAYS or 0),
            "LOP":           float(slip.UNPAID_LEAVE_DAYS or 0),
            "ABSENT":        float(slip.ABSENT_DAYS or 0),
            "OT_HOURS":      float(slip.OT_HOURS or 0),
        },
        earnings=earnings,
        deductions=deductions,
        gross=float(slip.GROSS_PAY or 0),
        total_deductions=float(slip.TOTAL_DEDUCTIONS or 0),
        net=float(slip.NET_PAY or 0),
        company=company,
    )

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f'inline; filename="payslip-{_payslip_number(slip, run)}.pdf"',
            "Cache-Control": "no-store",
        },
    )


# ============================================================
# Helpers
# ============================================================

_MONTHS = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def _month_name(m: int) -> str:
    return _MONTHS[m] if isinstance(m, int) and 1 <= m <= 12 else "?"


def _payslip_number(slip: PayrollSlip, run: PayrollRun) -> str:
    """Stable readable id: PS-YYYY-MM-<slip_id>."""
    return f"PS-{run.PAY_YEAR}-{run.PAY_MONTH:02d}-{slip.ID:04d}"


def _mask_account(num: Optional[str]) -> Optional[str]:
    if not num:
        return None
    s = str(num)
    if len(s) <= 4:
        return s
    return "X" * (len(s) - 4) + s[-4:]


def _company_full(db: Session) -> Dict[str, Any]:
    """Same payload shape used by the offer-letter renderer."""
    fallback = {
        "name": "Bharath Vending Corporation",
        "legal_name": "Bharath Vending Corporation",
        "address_line_1": None, "address_line_2": None,
        "city": None, "state": None, "pincode": None,
        "gst_number": None, "pan_number": None,
        "phone": None, "email": None, "website": None,
        "logo_path": None,
    }
    try:
        from app.models.models import CompanyMaster
        c = db.query(CompanyMaster).first()
        if not c:
            return fallback
        logo_path = None
        if c.LOGO_URL:
            rel = c.LOGO_URL.split("/static/", 1)[-1]
            disk = (
                Path(__file__).resolve().parent.parent.parent
                / "static" / rel
            )
            if disk.exists():
                logo_path = str(disk)
        return {
            "name":            c.SHORT_NAME or c.LEGAL_NAME or fallback["legal_name"],
            "legal_name":      c.LEGAL_NAME or fallback["legal_name"],
            "address_line_1":  getattr(c, "ADDRESS_LINE_1", None),
            "address_line_2":  getattr(c, "ADDRESS_LINE_2", None),
            "city":            getattr(c, "CITY", None),
            "state":           getattr(c, "STATE", None),
            "pincode":         getattr(c, "PINCODE", None),
            "gst_number":      getattr(c, "GST_NUMBER", None),
            "pan_number":      getattr(c, "PAN_NUMBER", None),
            "phone":           getattr(c, "PHONE", None),
            "email":           getattr(c, "EMAIL", None),
            "website":         getattr(c, "WEBSITE", None),
            "logo_path":       logo_path,
        }
    except Exception:
        return fallback
