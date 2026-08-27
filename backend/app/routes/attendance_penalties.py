"""Admin API for auto-generated attendance penalties.

Endpoints:

  GET  /attendance-penalties            — list all auto-generated LOP rows,
                                          filter by status / kind
  POST /attendance-penalties/scan       — run the scanner on demand
  POST /attendance-penalties/{id}/approve — mark APPROVED (payroll will deduct)
  POST /attendance-penalties/{id}/waive   — mark CANCELLED (waived)

Waived rows are NOT deleted; they stay for audit. Idempotency is
enforced by the service — once a row exists for a `[AUTO-LATE-YYYY-MM-emp]`
key (in any status), the scanner will not create another for that key.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Employee
from app.models.leave_models import LeaveRequest
from app.services.attendance_penalty_service import (
    is_auto_penalty,
    penalty_kind,
    run_scan,
)


router = APIRouter()


def _serialise(row: LeaveRequest, emp: Optional[Employee]) -> Dict[str, Any]:
    reason = row.REASON or ""
    key = ""
    body = reason
    if reason.startswith("[") and "]" in reason:
        end = reason.index("]")
        key = reason[1:end]
        body = reason[end + 1:].strip()

    return {
        "id":              row.ID,
        "employee_id":     row.EMPLOYEE_ID,
        "employee_code":   emp.EMPLOYEE_CODE if emp else "",
        "employee_name":   emp.NAME if emp else "",
        "kind":            penalty_kind(row),
        "penalty_key":     key,
        "reason":          body,
        "start_date":      row.START_DATE.isoformat() if row.START_DATE else None,
        "end_date":        row.END_DATE.isoformat() if row.END_DATE else None,
        "days":            float(row.DAYS or 0),
        "status":          row.STATUS,
        "created_at":      row.CREATED_AT.isoformat() if row.CREATED_AT else None,
        "resolved_at":     (
            row.APPROVAL_RESOLVED_AT.isoformat()
            if row.APPROVAL_RESOLVED_AT else None
        ),
    }


@router.get("")
def list_penalties(
    status: Optional[str] = Query(
        None,
        description="Filter by STATUS (PENDING_APPROVAL / APPROVED / CANCELLED). Omit for all.",
    ),
    kind: Optional[str] = Query(
        None,
        description="Filter by kind (LATE / PERMISSION). Omit for both.",
    ),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):

    q = db.query(LeaveRequest).filter(LeaveRequest.LEAVE_TYPE == "LOP")

    if kind == "LATE":
        q = q.filter(LeaveRequest.REASON.like("[AUTO-LATE-%"))
    elif kind == "PERMISSION":
        q = q.filter(LeaveRequest.REASON.like("[AUTO-PERM-%"))
    else:
        # Only auto-generated ones (either prefix).
        from sqlalchemy import or_
        q = q.filter(
            or_(
                LeaveRequest.REASON.like("[AUTO-LATE-%"),
                LeaveRequest.REASON.like("[AUTO-PERM-%"),
            )
        )

    if status:
        q = q.filter(LeaveRequest.STATUS == status)

    q = q.order_by(LeaveRequest.CREATED_AT.desc()).limit(limit)

    rows = q.all()

    emp_ids = [r.EMPLOYEE_ID for r in rows if r.EMPLOYEE_ID]
    emps = (
        db.query(Employee).filter(Employee.ID.in_(emp_ids)).all()
        if emp_ids else []
    )
    emp_by_id = {e.ID: e for e in emps}

    return [_serialise(r, emp_by_id.get(r.EMPLOYEE_ID)) for r in rows]


@router.get("/pending-count")
def pending_count(db: Session = Depends(get_db)) -> Dict[str, int]:
    """Small helper for the admin dashboard badge."""

    from sqlalchemy import or_
    count = (
        db.query(LeaveRequest.ID)
        .filter(
            LeaveRequest.LEAVE_TYPE == "LOP",
            LeaveRequest.STATUS == "PENDING_APPROVAL",
            or_(
                LeaveRequest.REASON.like("[AUTO-LATE-%"),
                LeaveRequest.REASON.like("[AUTO-PERM-%"),
            ),
        )
        .count()
    )
    return {"pending": count}


@router.post("/scan")
def scan_now(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """Run the scanner immediately. Idempotent — safe to call multiple
    times."""

    summary = run_scan(db)
    return summary.as_dict()


@router.post("/{penalty_id}/approve")
def approve_penalty(penalty_id: str, db: Session = Depends(get_db)):

    row = db.query(LeaveRequest).filter(LeaveRequest.ID == penalty_id).first()

    if not row or not is_auto_penalty(row):
        raise HTTPException(
            status_code=404,
            detail="Auto-penalty not found (or this row isn't an auto-generated LOP).",
        )

    if row.STATUS != "PENDING_APPROVAL":
        raise HTTPException(
            status_code=400,
            detail=f"This penalty is already {row.STATUS}. Nothing to approve.",
        )

    row.STATUS = "APPROVED"
    row.APPROVAL_RESOLVED_AT = datetime.now()
    db.commit()

    return {"ok": True, "status": row.STATUS}


@router.post("/{penalty_id}/waive")
def waive_penalty(penalty_id: str, db: Session = Depends(get_db)):

    row = db.query(LeaveRequest).filter(LeaveRequest.ID == penalty_id).first()

    if not row or not is_auto_penalty(row):
        raise HTTPException(
            status_code=404,
            detail="Auto-penalty not found (or this row isn't an auto-generated LOP).",
        )

    if row.STATUS not in ("PENDING_APPROVAL", "APPROVED"):
        raise HTTPException(
            status_code=400,
            detail=f"This penalty is already {row.STATUS}. Nothing to waive.",
        )

    row.STATUS = "CANCELLED"
    row.APPROVAL_RESOLVED_AT = datetime.now()
    db.commit()

    return {"ok": True, "status": row.STATUS}
