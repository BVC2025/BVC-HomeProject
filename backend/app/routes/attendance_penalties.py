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
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.auth_bearer import get_effective_vendor_id, require
from app.database.database import get_db
from app.models.models import AttendancePenaltyRule, Employee
from app.models.leave_models import LeaveRequest
from app.services.attendance_penalty_service import (
    DEFAULT_LATE_THRESHOLD_PER_MONTH,
    DEFAULT_LOP_DAYS_PER_TRIGGER,
    DEFAULT_PERMISSION_FREE_HOURS_PER_MONTH,
    get_or_create_penalty_rules,
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


# ---------------------------------------------------------------------
# Admin: view + edit the auto-LOP rule thresholds
# ---------------------------------------------------------------------
# Currently the scanner reads:
#   - LATE_THRESHOLD_PER_MONTH       — Nth late-mark that triggers LOP
#   - PERMISSION_FREE_HOURS_PER_MONTH — free permission hours cap
#   - LOP_DAYS_PER_TRIGGER           — how much salary to dock (0.5 = half-day)
#   - ENABLED                         — kill switch for the whole scanner
# All 4 live per-vendor in `attendance_penalty_rule`. GET reads (with
# defaults auto-seeded); PATCH updates only the fields you send.
# Admin permission (approval.manage) gates both — matches who else
# handles approval decisions.

class PenaltyRuleOut(BaseModel):
    vendor_id:                        int
    late_threshold_per_month:         int
    permission_free_hours_per_month:  float
    lop_days_per_trigger:             float
    enabled:                          bool
    defaults: Dict[str, Any] = Field(default_factory=dict)


class PenaltyRuleUpdate(BaseModel):
    late_threshold_per_month:         Optional[int] = Field(None, ge=0, le=30,
        description="How many LATE marks in a calendar month before the LOP row is created. 0 = disable this rule.")
    permission_free_hours_per_month:  Optional[float] = Field(None, ge=0, le=100,
        description="Free permission hours per month before LOP kicks in.")
    lop_days_per_trigger:             Optional[float] = Field(None, ge=0.25, le=2.0,
        description="Salary deduction per trigger — 0.5 = half day, 1.0 = full day.")
    enabled:                          Optional[bool] = Field(None,
        description="Master switch. false = pause auto-LOP entirely without losing the tuned thresholds.")


def _serialise_rule(rule: AttendancePenaltyRule) -> PenaltyRuleOut:
    return PenaltyRuleOut(
        vendor_id                       = rule.VENDOR_ID,
        late_threshold_per_month        = int(rule.LATE_THRESHOLD_PER_MONTH),
        permission_free_hours_per_month = float(rule.PERMISSION_FREE_HOURS_PER_MONTH),
        lop_days_per_trigger            = float(rule.LOP_DAYS_PER_TRIGGER),
        enabled                         = bool(rule.ENABLED),
        defaults = {
            "late_threshold_per_month":        DEFAULT_LATE_THRESHOLD_PER_MONTH,
            "permission_free_hours_per_month": DEFAULT_PERMISSION_FREE_HOURS_PER_MONTH,
            "lop_days_per_trigger":            DEFAULT_LOP_DAYS_PER_TRIGGER,
        },
    )


@router.get(
    "/rules",
    response_model=PenaltyRuleOut,
    dependencies=[Depends(require("approval.manage"))],
)
def get_penalty_rules(
    db:  Session = Depends(get_db),
    vid: int = Depends(get_effective_vendor_id),
) -> PenaltyRuleOut:
    """Fetch the current auto-LOP rules for this vendor. Auto-seeds a
    row with historical defaults on first call so the UI always has
    something to display."""
    return _serialise_rule(get_or_create_penalty_rules(db, vid))


@router.patch(
    "/rules",
    response_model=PenaltyRuleOut,
    dependencies=[Depends(require("approval.manage"))],
)
def update_penalty_rules(
    payload: PenaltyRuleUpdate,
    db:  Session = Depends(get_db),
    vid: int = Depends(get_effective_vendor_id),
) -> PenaltyRuleOut:
    """Update one or more rule thresholds. Only the fields you send
    are changed; omitted fields keep their current value. Changes are
    picked up on the very next scanner tick (23:00 IST daily, or a
    manual /attendance-penalties/scan POST)."""
    rule = get_or_create_penalty_rules(db, vid)

    changed = payload.model_dump(exclude_unset=True)
    if not changed:
        raise HTTPException(400, "No fields provided.")

    field_map = {
        "late_threshold_per_month":        "LATE_THRESHOLD_PER_MONTH",
        "permission_free_hours_per_month": "PERMISSION_FREE_HOURS_PER_MONTH",
        "lop_days_per_trigger":            "LOP_DAYS_PER_TRIGGER",
        "enabled":                         "ENABLED",
    }
    for k, v in changed.items():
        col = field_map.get(k)
        if not col:
            continue
        if k == "enabled":
            setattr(rule, col, 1 if v else 0)
        else:
            setattr(rule, col, v)

    db.commit()
    db.refresh(rule)
    return _serialise_rule(rule)


@router.post(
    "/rules/reset",
    response_model=PenaltyRuleOut,
    dependencies=[Depends(require("approval.manage"))],
)
def reset_penalty_rules_to_default(
    db:  Session = Depends(get_db),
    vid: int = Depends(get_effective_vendor_id),
) -> PenaltyRuleOut:
    """Reset all 4 rule fields to the historical hard-coded defaults
    (3 lates → half-day LOP, 2 free permission hours). Useful after
    an admin experiments with values and wants to roll back cleanly."""
    rule = get_or_create_penalty_rules(db, vid)
    rule.LATE_THRESHOLD_PER_MONTH        = DEFAULT_LATE_THRESHOLD_PER_MONTH
    rule.PERMISSION_FREE_HOURS_PER_MONTH = DEFAULT_PERMISSION_FREE_HOURS_PER_MONTH
    rule.LOP_DAYS_PER_TRIGGER            = DEFAULT_LOP_DAYS_PER_TRIGGER
    rule.ENABLED                         = 1
    db.commit()
    db.refresh(rule)
    return _serialise_rule(rule)
