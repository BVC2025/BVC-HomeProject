"""
Employee Memo Management — HR audit-trail module.

Endpoints
---------
  POST   /memos                          Create memo (multipart for attachment)
  GET    /memos                          List with filters + search + pagination
  GET    /memos/stats                    Dashboard / page-header counters
  GET    /memos/{id}                     Single memo detail
  PATCH  /memos/{id}                     Update (subject / description / status / etc.)
  DELETE /memos/{id}                     Soft delete (sets DELETED_AT)
  POST   /memos/{id}/close               Close the memo (STATUS=CLOSED)
  POST   /memos/{id}/cancel              Cancel the memo (STATUS=CANCELLED)
  POST   /memos/{id}/acknowledge         Employee acknowledges receipt
  GET    /memos/employee/{employee_id}   All memos for one employee
  GET    /memos/export                   CSV download of filtered set

Soft delete only — no row is ever physically removed. The DELETED_AT
column is a timestamp; non-NULL = hidden from default lists.
"""

import csv
import io
import os
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, File, Form, UploadFile, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, func, and_
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import EmployeeMemo, Employee
from app.auth.auth_bearer import (
    get_current_admin,
    get_current_user,
    assert_self_or_admin,
    require,
)


router = APIRouter(prefix="/memos", tags=["Employee Memos"])


# =====================================================================
# Storage path for attachments
# =====================================================================

MEMO_UPLOAD_DIR = Path(__file__).resolve().parents[2] / "static" / "memos"

MEMO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# =====================================================================
# Constants
# =====================================================================

MEMO_TYPES = {
    "WARNING", "APPRECIATION", "DISCIPLINARY", "INFORMATION",
    "CUSTOMER_COMPLAINT", "PERFORMANCE_RECOGNITION", "SHOW_CAUSE_NOTICE"
}

SEVERITIES = {"LOW", "MEDIUM", "HIGH", "CRITICAL"}

STATUSES = {"ACTIVE", "CLOSED", "CANCELLED"}


# =====================================================================
# Helpers
# =====================================================================

def _next_memo_number(db: Session) -> str:
    """MEMO-2026-0001 style. Year-prefixed per-year counter."""

    year = datetime.now().year

    prefix = f"MEMO-{year}-"

    last = (
        db.query(EmployeeMemo)
        .filter(EmployeeMemo.MEMO_NUMBER.like(f"{prefix}%"))
        .order_by(EmployeeMemo.ID.desc())
        .first()
    )

    n = 1

    if last and last.MEMO_NUMBER:

        try:

            n = int(last.MEMO_NUMBER.split("-")[-1]) + 1

        except Exception:

            n = (last.ID or 0) + 1

    return f"{prefix}{n:04d}"


def _serialize_memo(m: EmployeeMemo, emp: Employee | None = None) -> dict:

    return {
        "ID": m.ID,
        "MEMO_NUMBER": m.MEMO_NUMBER,
        "EMPLOYEE_ID": m.EMPLOYEE_ID,
        "EMPLOYEE_NAME": emp.NAME if emp else None,
        "EMPLOYEE_CODE": emp.EMPLOYEE_CODE if emp else None,
        "MEMO_TYPE": m.MEMO_TYPE,
        "SUBJECT": m.SUBJECT,
        "DESCRIPTION": m.DESCRIPTION,
        "SEVERITY": m.SEVERITY,
        "STATUS": m.STATUS,
        "ISSUED_BY": m.ISSUED_BY,
        "ISSUE_DATE": m.ISSUE_DATE.isoformat() if m.ISSUE_DATE else None,
        "ATTACHMENT_URL": m.ATTACHMENT_URL,
        "ATTACHMENT_NAME": m.ATTACHMENT_NAME,
        "ACKNOWLEDGED_BY_EMPLOYEE": bool(m.ACKNOWLEDGED_BY_EMPLOYEE),
        "ACKNOWLEDGED_DATE": (
            m.ACKNOWLEDGED_DATE.isoformat() if m.ACKNOWLEDGED_DATE else None
        ),
        "REMARKS": m.REMARKS,
        "CREATED_BY_ID": m.CREATED_BY_ID,
        "UPDATED_BY_ID": m.UPDATED_BY_ID,
        "CREATED_AT": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
        "UPDATED_AT": m.UPDATED_AT.isoformat() if m.UPDATED_AT else None,
        "VENDOR_ID": m.VENDOR_ID
    }


def _save_attachment(file: UploadFile) -> tuple[str | None, str | None]:
    """Save uploaded file under /static/memos/<uuid>.<ext>.
    Returns (public_url, original_filename) or (None, None) if no file."""

    if not file or not file.filename:

        return None, None

    ext = os.path.splitext(file.filename)[1].lower()[:10]

    fname = f"{uuid.uuid4().hex}{ext}"

    target = MEMO_UPLOAD_DIR / fname

    with open(target, "wb") as f:

        f.write(file.file.read())

    return f"/static/memos/{fname}", file.filename[:255]


def _parse_iso_date(s: Optional[str]) -> Optional[date]:

    if not s:

        return None

    try:

        return datetime.fromisoformat(s).date()

    except Exception:

        return None


# =====================================================================
# CREATE
# =====================================================================

@router.post("", dependencies=[Depends(require("memo.create"))])
async def create_memo(
    EMPLOYEE_ID:  str           = Form(...),
    MEMO_TYPE:    str           = Form(...),
    SUBJECT:      str           = Form(...),
    DESCRIPTION:  Optional[str] = Form(None),
    SEVERITY:     str           = Form("LOW"),
    STATUS:       str           = Form("ACTIVE"),
    ISSUED_BY:    Optional[str] = Form(None),
    ISSUE_DATE:   Optional[str] = Form(None),       # ISO yyyy-mm-dd
    REMARKS:      Optional[str] = Form(None),
    CREATED_BY_ID:Optional[str] = Form(None),
    VENDOR_ID:    int           = Form(1),
    attachment:   Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Create a new memo. Accepts multipart for optional file upload."""

    if MEMO_TYPE not in MEMO_TYPES:

        raise HTTPException(400, f"Invalid MEMO_TYPE. Must be one of {sorted(MEMO_TYPES)}")

    if SEVERITY not in SEVERITIES:

        raise HTTPException(400, f"Invalid SEVERITY. Must be one of {sorted(SEVERITIES)}")

    if STATUS not in STATUSES:

        raise HTTPException(400, f"Invalid STATUS. Must be one of {sorted(STATUSES)}")

    emp = db.query(Employee).filter(Employee.ID == EMPLOYEE_ID).first()

    if not emp:

        raise HTTPException(404, "Employee not found")

    att_url, att_name = _save_attachment(attachment) if attachment else (None, None)

    memo = EmployeeMemo(
        MEMO_NUMBER=_next_memo_number(db),
        EMPLOYEE_ID=EMPLOYEE_ID,
        MEMO_TYPE=MEMO_TYPE,
        SUBJECT=SUBJECT.strip()[:200],
        DESCRIPTION=(DESCRIPTION or "").strip()[:4000] or None,
        SEVERITY=SEVERITY,
        STATUS=STATUS,
        ISSUED_BY=(ISSUED_BY or "").strip()[:100] or None,
        ISSUE_DATE=_parse_iso_date(ISSUE_DATE) or date.today(),
        ATTACHMENT_URL=att_url,
        ATTACHMENT_NAME=att_name,
        REMARKS=(REMARKS or "").strip()[:2000] or None,
        CREATED_BY_ID=CREATED_BY_ID,
        VENDOR_ID=VENDOR_ID
    )

    db.add(memo)

    db.commit()

    db.refresh(memo)

    # Optional: write a notification row (best-effort, never blocks)
    try:

        from app.models.models import Notification

        n = Notification(
            EMPLOYEE_ID=EMPLOYEE_ID,
            TITLE=f"New {MEMO_TYPE.replace('_',' ').title()} memo",
            BODY=f"{memo.MEMO_NUMBER} — {SUBJECT[:80]}",
            VENDOR_ID=VENDOR_ID
        )

        db.add(n)

        db.commit()

    except Exception:

        pass    # notifications table may not exist or differ — non-fatal

    return {
        "message": f"Memo {memo.MEMO_NUMBER} created for {emp.NAME}",
        "memo": _serialize_memo(memo, emp)
    }


# =====================================================================
# LIST + FILTERS
# =====================================================================

@router.get("", dependencies=[Depends(require("memo.view.all"))])
def list_memos(
    employee_id: Optional[str] = Query(None),
    memo_type:   Optional[str] = Query(None),
    severity:    Optional[str] = Query(None),
    status:      Optional[str] = Query(None),
    date_from:   Optional[str] = Query(None),
    date_to:     Optional[str] = Query(None),
    search:      Optional[str] = Query(None),
    limit:       int           = Query(100, ge=1, le=500),
    offset:      int           = Query(0,   ge=0),
    include_deleted: bool      = Query(False),
    db: Session = Depends(get_db),
):
    """List memos with optional filters. Joins Employee for name/code."""

    q = (
        db.query(EmployeeMemo, Employee)
        .outerjoin(Employee, EmployeeMemo.EMPLOYEE_ID == Employee.ID)
    )

    if not include_deleted:

        q = q.filter(EmployeeMemo.DELETED_AT.is_(None))

    if employee_id:  q = q.filter(EmployeeMemo.EMPLOYEE_ID == employee_id)
    if memo_type:    q = q.filter(EmployeeMemo.MEMO_TYPE == memo_type.upper())
    if severity:     q = q.filter(EmployeeMemo.SEVERITY  == severity.upper())
    if status:       q = q.filter(EmployeeMemo.STATUS    == status.upper())

    df = _parse_iso_date(date_from)
    dt = _parse_iso_date(date_to)
    if df: q = q.filter(EmployeeMemo.ISSUE_DATE >= df)
    if dt: q = q.filter(EmployeeMemo.ISSUE_DATE <= dt)

    if search:

        s = f"%{search.strip()}%"

        q = q.filter(or_(
            EmployeeMemo.MEMO_NUMBER.ilike(s),
            EmployeeMemo.SUBJECT.ilike(s),
            Employee.NAME.ilike(s)
        ))

    total = q.with_entities(func.count(EmployeeMemo.ID)).scalar() or 0

    rows = (
        q.order_by(EmployeeMemo.ID.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": int(total),
        "limit": limit,
        "offset": offset,
        "rows": [_serialize_memo(m, e) for m, e in rows]
    }


# =====================================================================
# STATS — dashboard widget + page header
# =====================================================================

@router.get("/stats")
def memo_stats(
    employee_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Counters for the dashboard widget + employee tab header.

    If employee_id is given, scoped to that employee. Otherwise global.
    Non-admins are forced into the per-employee view (their own).
    """

    # Non-admins can only see their own stats. Coerce employee_id to
    # their identity if missing, or 403 if they tried to query
    # someone else's.
    if payload.get("role") not in ({"ADMIN", "SUPER_ADMIN", "HR", "MANAGER",
                                    "PRODUCTION_HEAD", "MANAGING_DIRECTOR",
                                    "HR_MANAGER", "SALES_MANAGER",
                                    "PURCHASE_MANAGER", "PRODUCTION_MANAGER",
                                    "INVENTORY_MANAGER", "ACCOUNTS_MANAGER"}):
        if employee_id is None:
            employee_id = payload.get("employee_id")
        else:
            assert_self_or_admin(employee_id, payload)

    q = db.query(EmployeeMemo).filter(EmployeeMemo.DELETED_AT.is_(None))

    if employee_id:

        q = q.filter(EmployeeMemo.EMPLOYEE_ID == employee_id)

    rows = q.all()

    today = date.today()

    first_of_month = date(today.year, today.month, 1)

    total           = len(rows)

    active          = sum(1 for r in rows if r.STATUS == "ACTIVE")

    closed          = sum(1 for r in rows if r.STATUS == "CLOSED")

    warnings        = sum(1 for r in rows if r.MEMO_TYPE == "WARNING")

    appreciations   = sum(1 for r in rows if r.MEMO_TYPE in (
        "APPRECIATION", "PERFORMANCE_RECOGNITION"
    ))

    appreciations_this_month = sum(
        1 for r in rows
        if r.MEMO_TYPE in ("APPRECIATION", "PERFORMANCE_RECOGNITION")
        and r.ISSUE_DATE and r.ISSUE_DATE >= first_of_month
    )

    disciplinary_open = sum(
        1 for r in rows
        if r.MEMO_TYPE in ("DISCIPLINARY", "SHOW_CAUSE_NOTICE")
        and r.STATUS == "ACTIVE"
    )

    pending_ack = sum(1 for r in rows if not r.ACKNOWLEDGED_BY_EMPLOYEE)

    last_memo_date = max(
        (r.ISSUE_DATE for r in rows if r.ISSUE_DATE),
        default=None
    )

    return {
        "total":                   total,
        "active":                  active,
        "closed":                  closed,
        "warnings":                warnings,
        "appreciations":           appreciations,
        "appreciations_this_month":appreciations_this_month,
        "disciplinary_open":       disciplinary_open,
        "pending_acknowledgement": pending_ack,
        "last_memo_date":          last_memo_date.isoformat() if last_memo_date else None,
        "active_warnings":         sum(1 for r in rows
                                        if r.MEMO_TYPE == "WARNING" and r.STATUS == "ACTIVE")
    }


# =====================================================================
# Per-employee shortcut
# =====================================================================

@router.get("/employee/{employee_id}")
def memos_for_employee(
    employee_id: str,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """All memos for one employee, ordered newest first.

    Accepts either the UUID (Employee.ID) OR the human-readable
    EMPLOYEE_CODE (e.g. "EMP101"). The employee portal uses the code,
    while the admin app uses the UUID — same endpoint handles both.
    """

    assert_self_or_admin(employee_id, payload)

    emp = (
        db.query(Employee)
        .filter(
            or_(
                Employee.ID == employee_id,
                Employee.EMPLOYEE_CODE == employee_id
            )
        )
        .first()
    )

    if not emp:

        raise HTTPException(404, "Employee not found")

    rows = (
        db.query(EmployeeMemo)
        .filter(
            EmployeeMemo.EMPLOYEE_ID == emp.ID,
            EmployeeMemo.DELETED_AT.is_(None)
        )
        .order_by(EmployeeMemo.ID.desc())
        .all()
    )

    return [_serialize_memo(m, emp) for m in rows]


# =====================================================================
# DETAIL
# =====================================================================

@router.get("/{memo_id}")
def get_memo(
    memo_id: int,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    m = db.query(EmployeeMemo).filter(EmployeeMemo.ID == memo_id).first()

    if not m:

        raise HTTPException(404, "Memo not found")

    # Ownership check: a non-admin can only view their own memos
    assert_self_or_admin(m.EMPLOYEE_ID, payload)

    emp = db.query(Employee).filter(Employee.ID == m.EMPLOYEE_ID).first()

    return _serialize_memo(m, emp)


# =====================================================================
# UPDATE
# =====================================================================

class MemoUpdate(BaseModel):

    SUBJECT:     Optional[str] = None
    DESCRIPTION: Optional[str] = None
    SEVERITY:    Optional[str] = None
    STATUS:      Optional[str] = None
    ISSUED_BY:   Optional[str] = None
    ISSUE_DATE:  Optional[str] = None
    REMARKS:     Optional[str] = None
    UPDATED_BY_ID: Optional[str] = None


@router.patch("/{memo_id}", dependencies=[Depends(require("memo.update"))])
def update_memo(memo_id: int, body: MemoUpdate, db: Session = Depends(get_db)):

    m = db.query(EmployeeMemo).filter(EmployeeMemo.ID == memo_id).first()

    if not m:

        raise HTTPException(404, "Memo not found")

    if m.DELETED_AT is not None:

        raise HTTPException(400, "Cannot edit a deleted memo")

    payload = body.dict(exclude_unset=True)

    if "SEVERITY" in payload and payload["SEVERITY"] not in SEVERITIES:

        raise HTTPException(400, "Invalid SEVERITY")

    if "STATUS" in payload and payload["STATUS"] not in STATUSES:

        raise HTTPException(400, "Invalid STATUS")

    if "ISSUE_DATE" in payload:

        payload["ISSUE_DATE"] = _parse_iso_date(payload["ISSUE_DATE"])

    for k, v in payload.items():

        if isinstance(v, str):

            v = v.strip()

            if k in ("SUBJECT",):     v = v[:200]
            elif k == "DESCRIPTION":  v = v[:4000]
            elif k == "ISSUED_BY":    v = v[:100]
            elif k == "REMARKS":      v = v[:2000]

        setattr(m, k, v)

    db.commit()

    db.refresh(m)

    return {"message": "Memo updated", "memo": _serialize_memo(m)}


# =====================================================================
# CLOSE / CANCEL / SOFT-DELETE
# =====================================================================

@router.post("/{memo_id}/close", dependencies=[Depends(require("memo.update"))])
def close_memo(memo_id: int, db: Session = Depends(get_db)):

    m = db.query(EmployeeMemo).filter(EmployeeMemo.ID == memo_id).first()

    if not m:                  raise HTTPException(404, "Memo not found")
    if m.DELETED_AT is not None: raise HTTPException(400, "Memo deleted")

    m.STATUS = "CLOSED"

    db.commit()

    return {"message": f"Memo {m.MEMO_NUMBER} closed"}


@router.post("/{memo_id}/cancel", dependencies=[Depends(require("memo.update"))])
def cancel_memo(memo_id: int, db: Session = Depends(get_db)):

    m = db.query(EmployeeMemo).filter(EmployeeMemo.ID == memo_id).first()

    if not m:                  raise HTTPException(404, "Memo not found")
    if m.DELETED_AT is not None: raise HTTPException(400, "Memo deleted")

    m.STATUS = "CANCELLED"

    db.commit()

    return {"message": f"Memo {m.MEMO_NUMBER} cancelled"}


@router.delete("/{memo_id}", dependencies=[Depends(require("memo.delete"))])
def delete_memo(memo_id: int, db: Session = Depends(get_db)):
    """Soft-delete only — sets DELETED_AT, row stays for audit."""

    m = db.query(EmployeeMemo).filter(EmployeeMemo.ID == memo_id).first()

    if not m:

        raise HTTPException(404, "Memo not found")

    m.DELETED_AT = datetime.utcnow()

    db.commit()

    return {"message": f"Memo {m.MEMO_NUMBER} soft-deleted"}


# =====================================================================
# EMPLOYEE ACKNOWLEDGEMENT
# =====================================================================

class AcknowledgeBody(BaseModel):

    REMARKS: Optional[str] = None


@router.post("/{memo_id}/acknowledge")
def acknowledge_memo(
    memo_id: int,
    body: Optional[AcknowledgeBody] = None,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """Mark a memo as acknowledged by the employee. Idempotent."""

    m = db.query(EmployeeMemo).filter(EmployeeMemo.ID == memo_id).first()

    if not m:                  raise HTTPException(404, "Memo not found")
    if m.DELETED_AT is not None: raise HTTPException(400, "Memo deleted")

    # Only the recipient (or admin) can acknowledge their own memo
    assert_self_or_admin(m.EMPLOYEE_ID, payload)

    if m.ACKNOWLEDGED_BY_EMPLOYEE:

        return {
            "message": "Already acknowledged",
            "acknowledged_date": m.ACKNOWLEDGED_DATE.isoformat() if m.ACKNOWLEDGED_DATE else None
        }

    m.ACKNOWLEDGED_BY_EMPLOYEE = 1

    m.ACKNOWLEDGED_DATE = datetime.utcnow()

    if body and body.REMARKS:

        m.REMARKS = (m.REMARKS + "\n\n" if m.REMARKS else "") + f"[Ack]: {body.REMARKS[:1500]}"

    db.commit()

    return {
        "message": f"Memo {m.MEMO_NUMBER} acknowledged",
        "acknowledged_date": m.ACKNOWLEDGED_DATE.isoformat()
    }


# =====================================================================
# EXPORT — CSV (Excel-compatible)
# =====================================================================

@router.get("/export/csv", dependencies=[Depends(require("memo.export"))])
def export_csv(
    employee_id: Optional[str] = Query(None),
    memo_type:   Optional[str] = Query(None),
    severity:    Optional[str] = Query(None),
    status:      Optional[str] = Query(None),
    date_from:   Optional[str] = Query(None),
    date_to:     Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Same filters as /memos — returns a CSV file the browser downloads."""

    q = (
        db.query(EmployeeMemo, Employee)
        .outerjoin(Employee, EmployeeMemo.EMPLOYEE_ID == Employee.ID)
        .filter(EmployeeMemo.DELETED_AT.is_(None))
    )

    if employee_id:  q = q.filter(EmployeeMemo.EMPLOYEE_ID == employee_id)
    if memo_type:    q = q.filter(EmployeeMemo.MEMO_TYPE == memo_type.upper())
    if severity:     q = q.filter(EmployeeMemo.SEVERITY  == severity.upper())
    if status:       q = q.filter(EmployeeMemo.STATUS    == status.upper())

    df = _parse_iso_date(date_from)
    dt = _parse_iso_date(date_to)
    if df: q = q.filter(EmployeeMemo.ISSUE_DATE >= df)
    if dt: q = q.filter(EmployeeMemo.ISSUE_DATE <= dt)

    rows = q.order_by(EmployeeMemo.ID.desc()).all()

    buf = io.StringIO()

    w = csv.writer(buf)

    w.writerow([
        "Memo Number", "Issue Date", "Employee Code", "Employee Name",
        "Type", "Severity", "Status", "Subject", "Issued By",
        "Acknowledged", "Acknowledged Date", "Created At"
    ])

    for m, emp in rows:

        w.writerow([
            m.MEMO_NUMBER or "",
            m.ISSUE_DATE.isoformat() if m.ISSUE_DATE else "",
            emp.EMPLOYEE_CODE if emp else "",
            emp.NAME if emp else "",
            m.MEMO_TYPE or "",
            m.SEVERITY or "",
            m.STATUS or "",
            (m.SUBJECT or "")[:200],
            m.ISSUED_BY or "",
            "Yes" if m.ACKNOWLEDGED_BY_EMPLOYEE else "No",
            m.ACKNOWLEDGED_DATE.isoformat() if m.ACKNOWLEDGED_DATE else "",
            m.CREATED_AT.isoformat() if m.CREATED_AT else ""
        ])

    buf.seek(0)

    fname = f"memos-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'}
    )
