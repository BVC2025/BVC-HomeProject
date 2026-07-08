"""
Employee allowance / expense-claim routes.

Flow:
  1. Employee POSTs /allowances  -> STATUS = PENDING
                                  email sent to MD (APPROVER_EMAIL)
  2. MD opens admin Allowances page -> sees pending queue
  3. MD PATCHes /allowances/{id}/decide with APPROVE or REJECT
"""

from datetime import date, datetime
from pathlib import Path
from typing import Optional
import os
import shutil
import uuid

from fastapi import (
    APIRouter, Depends, HTTPException, UploadFile, File,
)
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import EmployeeAllowance, Employee
from app.services.email_service import (
    build_alert_html,
    send_alert_email,
    is_smtp_configured,
)
from app.utils.employee_resolver import (
    resolve_employee_uuid,
    require_employee,
)


router = APIRouter()


# =========================
# Categories
# =========================

ALLOWED_CATEGORIES = {
    "TRAVEL",
    "FOOD",
    "ACCOMMODATION",
    "OFFICE_SUPPLIES",
    "FUEL",
    "COMMUNICATION",
    "CLIENT_MEETING",
    "TRAINING",
    "OTHER",
}


# =========================
# Schemas
# =========================

class AllowanceCreate(BaseModel):
    EMPLOYEE_ID: str
    CATEGORY: str
    AMOUNT: float = Field(..., gt=0)
    EXPENSE_DATE: date
    DESCRIPTION: Optional[str] = None


class AllowanceDecision(BaseModel):
    ACTION: str  # APPROVE | REJECT
    REVIEW_NOTES: Optional[str] = None
    REVIEWED_BY_ID: Optional[str] = None


# =========================
# Helpers
# =========================

def _serialize(row: EmployeeAllowance, employee_name: Optional[str] = None):
    return {
        "ID": row.ID,
        "EMPLOYEE_ID": row.EMPLOYEE_ID,
        "EMPLOYEE_NAME": employee_name,
        "CATEGORY": row.CATEGORY,
        "AMOUNT": row.AMOUNT,
        "EXPENSE_DATE": row.EXPENSE_DATE.isoformat() if row.EXPENSE_DATE else None,
        "DESCRIPTION": row.DESCRIPTION,
        "RECEIPT_URL": row.RECEIPT_URL,
        "STATUS": row.STATUS,
        "SUBMITTED_AT": row.SUBMITTED_AT.isoformat() if row.SUBMITTED_AT else None,
        "REVIEWED_BY_ID": row.REVIEWED_BY_ID,
        "REVIEWED_AT": row.REVIEWED_AT.isoformat() if row.REVIEWED_AT else None,
        "REVIEW_NOTES": row.REVIEW_NOTES,
    }


def _notify_md(db: Session, row: EmployeeAllowance):
    """Fire-and-forget email to MD. Failures are logged, never raised."""

    md_email = os.getenv("APPROVER_EMAIL") or os.getenv("ADMIN_EMAIL")
    if not md_email or not is_smtp_configured():
        return

    emp = db.query(Employee).filter(Employee.ID == row.EMPLOYEE_ID).first()
    emp_name = emp.NAME if emp else row.EMPLOYEE_ID
    emp_code = emp.EMPLOYEE_CODE if emp else "-"

    title = f"Expense claim submitted - INR {row.AMOUNT:,.2f}"
    msg = (
        f"<p><b>{emp_name}</b> ({emp_code}) submitted a new expense claim.</p>"
        f"<ul>"
        f"<li><b>Category:</b> {row.CATEGORY}</li>"
        f"<li><b>Amount:</b> INR {row.AMOUNT:,.2f}</li>"
        f"<li><b>Expense date:</b> {row.EXPENSE_DATE}</li>"
        f"<li><b>Description:</b> {row.DESCRIPTION or '-'}</li>"
        f"</ul>"
        f"<p>Open the Allowances page in the admin dashboard to review and approve.</p>"
    )

    try:
        send_alert_email(
            to_email=md_email,
            subject=title,
            html=build_alert_html(title, msg, "INFO"),
        )
    except Exception as e:
        print(f"[allowance] MD notify failed: {e}")


# =========================
# Routes
# =========================

@router.get("/allowances")
def list_allowances(
    employee_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List allowances. Pass employee_id to scope to one person
    (employee portal). Without it, returns everything (admin queue)."""

    q = db.query(EmployeeAllowance, Employee).outerjoin(
        Employee, Employee.ID == EmployeeAllowance.EMPLOYEE_ID
    )

    if employee_id:
        # Accept either UUID or EMPLOYEE_CODE (e.g. "EMP105")
        uuid = resolve_employee_uuid(db, employee_id)
        q = q.filter(EmployeeAllowance.EMPLOYEE_ID == uuid)
    if status:
        q = q.filter(EmployeeAllowance.STATUS == status.upper())

    q = q.order_by(EmployeeAllowance.SUBMITTED_AT.desc())

    return [
        _serialize(row, emp.NAME if emp else None)
        for row, emp in q.all()
    ]


@router.post("/allowances")
def create_allowance(
    body: AllowanceCreate,
    db: Session = Depends(get_db),
):
    """Employee submits a new expense claim."""

    if body.CATEGORY not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid category. Allowed: {sorted(ALLOWED_CATEGORIES)}"
        )

    # Accept either UUID or EMPLOYEE_CODE — the employee portal stores
    # the CODE in localStorage and sends that, but admin flows pass UUID.
    emp = require_employee(db, body.EMPLOYEE_ID)

    row = EmployeeAllowance(
        EMPLOYEE_ID=emp.ID,
        CATEGORY=body.CATEGORY,
        AMOUNT=body.AMOUNT,
        EXPENSE_DATE=body.EXPENSE_DATE,
        DESCRIPTION=(body.DESCRIPTION or "").strip() or None,
        STATUS="PENDING",
        SUBMITTED_AT=datetime.utcnow(),
        VENDOR_ID=getattr(emp, "VENDOR_ID", None),
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    _notify_md(db, row)

    return {
        "message": "Allowance submitted for approval.",
        "allowance": _serialize(row, emp.NAME),
    }


@router.patch("/allowances/{allowance_id}/decide")
def decide_allowance(
    allowance_id: int,
    body: AllowanceDecision,
    db: Session = Depends(get_db),
):
    """MD approves or rejects an allowance."""

    action = (body.ACTION or "").upper()
    if action not in {"APPROVE", "REJECT"}:
        raise HTTPException(
            status_code=400,
            detail="ACTION must be 'APPROVE' or 'REJECT'"
        )

    row = db.query(EmployeeAllowance).filter(
        EmployeeAllowance.ID == allowance_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Allowance not found")

    if row.STATUS != "PENDING":
        raise HTTPException(
            status_code=409,
            detail=f"Allowance is already {row.STATUS}"
        )

    row.STATUS = "APPROVED" if action == "APPROVE" else "REJECTED"
    row.REVIEWED_AT = datetime.utcnow()
    row.REVIEWED_BY_ID = body.REVIEWED_BY_ID
    row.REVIEW_NOTES = (body.REVIEW_NOTES or "").strip() or None

    db.commit()
    db.refresh(row)

    emp = db.query(Employee).filter(Employee.ID == row.EMPLOYEE_ID).first()

    return {
        "message": f"Allowance {row.STATUS.lower()}.",
        "allowance": _serialize(row, emp.NAME if emp else None),
    }


# =========================
# Receipt upload
# =========================

_ALLOWED_EXTS = {".png", ".jpg", ".jpeg", ".pdf", ".webp"}

_RECEIPT_DIR = (
    Path(__file__).resolve().parent.parent.parent / "static" / "allowances"
)


@router.post("/allowances/{allowance_id}/upload-receipt")
def upload_receipt(
    allowance_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    row = db.query(EmployeeAllowance).filter(
        EmployeeAllowance.ID == allowance_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Allowance not found")

    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(_ALLOWED_EXTS)}"
        )

    sub_dir = _RECEIPT_DIR / str(allowance_id)
    sub_dir.mkdir(parents=True, exist_ok=True)

    fname = f"{uuid.uuid4().hex[:10]}{ext}"
    dest = sub_dir / fname
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    row.RECEIPT_URL = f"/static/allowances/{allowance_id}/{fname}"
    db.commit()
    db.refresh(row)

    return {
        "message": "Receipt uploaded.",
        "receipt_url": row.RECEIPT_URL,
    }


@router.get("/allowances/summary")
def allowances_summary(
    employee_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Counts + totals for the dashboard tiles."""

    q = db.query(EmployeeAllowance)
    if employee_id:
        uuid = resolve_employee_uuid(db, employee_id)
        q = q.filter(EmployeeAllowance.EMPLOYEE_ID == uuid)

    rows = q.all()

    return {
        "total":     len(rows),
        "pending":   sum(1 for r in rows if r.STATUS == "PENDING"),
        "approved":  sum(1 for r in rows if r.STATUS == "APPROVED"),
        "rejected":  sum(1 for r in rows if r.STATUS == "REJECTED"),
        "approved_amount": sum(
            (r.AMOUNT or 0) for r in rows if r.STATUS == "APPROVED"
        ),
        "pending_amount":  sum(
            (r.AMOUNT or 0) for r in rows if r.STATUS == "PENDING"
        ),
    }
