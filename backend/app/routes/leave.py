"""
Leave Management routes.

Lifecycle:
  POST /leave/apply             -> employee submits, email goes to APPROVER_EMAIL
  GET  /leave/decide/{token}    -> approver clicks email button (action=approve|reject)
  GET  /leave/pending           -> admin dashboard list
  GET  /leave/all               -> admin all requests with filters
  GET  /leave/my-requests       -> employee's own history
  PATCH /leave/{id}/cancel      -> employee cancels their own PENDING / APPROVED
  GET  /leave/balance/{emp_id}  -> remaining quota for the year
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database.database import get_db

from sqlalchemy import extract

from app.models.models import (
    Employee,
    LeaveRequest,
    LeaveBalance,
    LeaveQuotaPolicy,
    Vendor
)

from pydantic import BaseModel, Field

from app.schemas.leave_schema import (
    LeaveApplyRequest,
    LeaveCancelRequest,
    LeaveRejectRequest,
    PermissionApplyRequest
)

def _resolve_employee(db: Session, identifier: str):
    """Accept either Employee.ID (UUID) or Employee.EMPLOYEE_CODE
    (e.g. 'EMP101'). Returns the Employee row or None.

    The login flow stores the EMPLOYEE_CODE in localStorage, while
    older leave endpoints expected the UUID. This helper bridges
    both so the same /leave/* URLs work regardless of which
    identifier the frontend sends."""

    if not identifier:

        return None

    emp = db.query(Employee).filter(Employee.ID == identifier).first()

    if emp:

        return emp

    return db.query(Employee).filter(
        Employee.EMPLOYEE_CODE == str(identifier).strip().upper()
    ).first()


from app.services.leave_service import (
    VALID_LEAVE_TYPES,
    QUOTA_BACKED_TYPES,
    compute_days,
    generate_token,
    get_or_create_balance,
    remaining_for_type,
    deduct_balance,
    refund_balance,
    send_approval_email,
    send_decision_email,
    serialize_balance
)


router = APIRouter(prefix="/leave", tags=["Leave Management"])


# ---- BVC24 LEAVE POLICY -----------------------------------------
# Every leave (including half-day / one-day requests) requires
# manager approval. A reason is REQUIRED on every request. The
# approval email goes to the manager (APPROVER_EMAIL) with
# Approve / Reject options. On approval → employee gets email +
# in-app notification, balance is deducted automatically. On
# rejection → employee receives a rejection notification.
#
# Threshold = 0 → `days > 0` is always true → every leave is
# routed to manager review.
MAX_DAYS_NO_REASON_OR_APPROVAL = 0


def _resolve_vendor_id(db: Session, requested: Optional[int]) -> int:

    if requested:

        v = db.query(Vendor).filter(Vendor.ID == requested).first()

        if v:

            return v.ID

    bvc = db.query(Vendor).filter(
        Vendor.VENDOR_NAME == "Bharath Vending Corporation"
    ).first()

    if bvc:

        return bvc.ID

    any_v = db.query(Vendor).first()

    return any_v.ID if any_v else (requested or 1)


def _serialize_leave(
    leave: LeaveRequest,
    employee: Optional[Employee] = None
) -> dict:

    return {
        "ID": leave.ID,
        "EMPLOYEE_ID": leave.EMPLOYEE_ID,
        "EMPLOYEE_NAME": employee.NAME if employee else None,
        "EMPLOYEE_CODE": employee.EMPLOYEE_CODE if employee else None,
        "LEAVE_TYPE": leave.LEAVE_TYPE,
        "START_DATE": (
            leave.START_DATE.isoformat() if leave.START_DATE else None
        ),
        "END_DATE": (
            leave.END_DATE.isoformat() if leave.END_DATE else None
        ),
        "DAYS": leave.DAYS,
        "DURATION_HOURS": getattr(leave, "DURATION_HOURS", None),
        "PERMISSION_SUBTYPE": getattr(leave, "PERMISSION_SUBTYPE", None),
        "REASON": leave.REASON,
        "STATUS": leave.STATUS,
        "APPROVAL_REQUESTED_AT": (
            leave.APPROVAL_REQUESTED_AT.isoformat()
            if leave.APPROVAL_REQUESTED_AT else None
        ),
        "APPROVAL_RESOLVED_AT": (
            leave.APPROVAL_RESOLVED_AT.isoformat()
            if leave.APPROVAL_RESOLVED_AT else None
        ),
        "APPROVED_BY_EMAIL": leave.APPROVED_BY_EMAIL,
        "REJECTION_REASON": leave.REJECTION_REASON,
        "CREATED_AT": (
            leave.CREATED_AT.isoformat() if leave.CREATED_AT else None
        )
    }


# ----------------------------------------------------------------
# APPLY
# ----------------------------------------------------------------

@router.post("/apply")
def apply_leave(
    data: LeaveApplyRequest,
    db: Session = Depends(get_db)
):

    if data.LEAVE_TYPE == "PERMISSION":

        raise HTTPException(
            status_code=400,
            detail=(
                "Use POST /leave/apply-permission to file an hourly "
                "permission — /leave/apply is for day-based leaves only."
            )
        )

    if data.LEAVE_TYPE not in VALID_LEAVE_TYPES:

        raise HTTPException(
            status_code=400,
            detail=(
                f"LEAVE_TYPE must be one of {sorted(VALID_LEAVE_TYPES)}"
            )
        )

    employee = _resolve_employee(db, data.EMPLOYEE_ID)

    if not employee:

        raise HTTPException(status_code=404, detail="Employee not found")

    # Normalize for downstream code that expects the UUID
    data.EMPLOYEE_ID = employee.ID

    # MATERNITY leave is gender-gated. Only employees whose GENDER is
    # FEMALE may apply. The /leave-policy/quotas endpoint can be used
    # by admin to vary the day count per designation/department but the
    # gender gate is non-configurable.
    if data.LEAVE_TYPE == "MATERNITY":

        if (employee.GENDER or "").upper().strip() != "FEMALE":

            raise HTTPException(
                status_code=400,
                detail=(
                    "MATERNITY leave is only available to employees "
                    "with GENDER=FEMALE on file."
                )
            )

    if data.START_DATE > data.END_DATE:

        raise HTTPException(
            status_code=400,
            detail="START_DATE must be on or before END_DATE"
        )

    if data.HALF_DAY and data.START_DATE != data.END_DATE:

        raise HTTPException(
            status_code=400,
            detail="HALF_DAY can only be applied for a single date"
        )

    days = data.DAYS or compute_days(
        data.START_DATE, data.END_DATE, data.HALF_DAY
    )

    # Quota check (UNPAID/LOP bypass)
    if data.LEAVE_TYPE in QUOTA_BACKED_TYPES:

        bal = get_or_create_balance(db, employee.ID)

        remaining = remaining_for_type(bal, data.LEAVE_TYPE)

        if days > remaining:

            raise HTTPException(
                status_code=409,
                detail=(
                    f"Insufficient {data.LEAVE_TYPE} leave balance. "
                    f"You have {remaining} day(s) remaining; "
                    f"this request needs {days}."
                )
            )

    # Check for overlapping pending/approved leave
    overlap = db.query(LeaveRequest).filter(
        LeaveRequest.EMPLOYEE_ID == employee.ID,
        LeaveRequest.STATUS.in_(["PENDING_APPROVAL", "APPROVED"]),
        LeaveRequest.START_DATE <= data.END_DATE,
        LeaveRequest.END_DATE >= data.START_DATE
    ).first()

    if overlap:

        raise HTTPException(
            status_code=409,
            detail=(
                f"Overlaps with an existing {overlap.STATUS} leave "
                f"({overlap.START_DATE} → {overlap.END_DATE})"
            )
        )

    # ---- BVC24 leave policy gating ----
    # Every leave (any positive duration) needs manager approval
    # AND a reason. Threshold is 0, so `days > 0` always true.
    needs_manager_approval = days > MAX_DAYS_NO_REASON_OR_APPROVAL

    reason_text = (data.REASON or "").strip()

    if needs_manager_approval and not reason_text:

        raise HTTPException(
            status_code=400,
            detail=(
                "A reason is required — every leave goes to your "
                "manager for review before approval."
            )
        )

    leave = LeaveRequest(
        EMPLOYEE_ID=employee.ID,
        LEAVE_TYPE=data.LEAVE_TYPE,
        START_DATE=data.START_DATE,
        END_DATE=data.END_DATE,
        DAYS=days,
        REASON=reason_text or None,
        STATUS=(
            "PENDING_APPROVAL" if needs_manager_approval
            else "APPROVED"
        ),
        APPROVAL_TOKEN=(
            generate_token() if needs_manager_approval else None
        ),
        APPROVAL_REQUESTED_AT=datetime.utcnow(),
        APPROVAL_RESOLVED_AT=(
            None if needs_manager_approval else datetime.utcnow()
        ),
        APPROVED_BY_EMAIL=(
            None if needs_manager_approval
            else f"auto-approved ({days:g} day(s), no review needed)"
        ),
        VENDOR_ID=employee.VENDOR_ID
    )

    db.add(leave)

    db.commit()

    db.refresh(leave)

    email_ok = False

    email_msg = "Not sent — auto-approved (short leave)"

    if needs_manager_approval:

        # Long leave -> manager review
        email_ok, email_msg = send_approval_email(db, leave, employee)

    else:

        # Auto-approved -> deduct balance + notify employee
        if data.LEAVE_TYPE in QUOTA_BACKED_TYPES:

            deduct_balance(
                db, employee.ID, data.LEAVE_TYPE, days
            )

        if employee.EMAIL:

            send_decision_email(leave, employee, "APPROVED")

        # Also log a global in-app notification (so the bell in
        # the topbar shows the activity for the employee)
        try:

            from app.models.models import Notification

            db.add(Notification(
                TITLE="Leave auto-approved",
                MESSAGE=(
                    f"{employee.NAME}'s {data.LEAVE_TYPE} leave "
                    f"({data.START_DATE.isoformat()}"
                    f"{' → ' + data.END_DATE.isoformat() if data.END_DATE != data.START_DATE else ''}) "
                    f"— {days:g} day(s) — was auto-approved."
                ),
                TYPE="INFO",
                IS_READ=0,
                VENDOR_ID=employee.VENDOR_ID
            ))

            db.commit()

        except Exception:

            db.rollback()

    return {
        "message": (
            f"Leave submitted for manager approval ({days:g} day(s)). "
            f"The manager has been emailed with your reason."
        ),
        "leave": _serialize_leave(leave, employee),
        "auto_approved": not needs_manager_approval,
        "days_requested": days,
        "no_approval_limit_days": MAX_DAYS_NO_REASON_OR_APPROVAL,
        "reason_required": needs_manager_approval,
        "email_sent_to_manager": email_ok,
        "email_status": (
            email_msg if not email_ok else "delivered to manager"
        )
    }


# ----------------------------------------------------------------
# DECIDE (from email link — public, token-protected)
# ----------------------------------------------------------------

def _decision_html(title: str, message: str, color: str = "#10b981") -> str:

    return f"""
    <!DOCTYPE html>
    <html><head><title>{title}</title></head>
    <body style="font-family:Segoe UI,sans-serif;background:#f1f5f9;
         min-height:100vh;display:flex;align-items:center;
         justify-content:center;margin:0;">
      <div style="background:white;padding:36px 44px;border-radius:14px;
           box-shadow:0 12px 40px rgba(15,23,42,0.18);max-width:480px;
           text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;color:{color};">
          {('&#10003;' if color == '#10b981' else '&#10007;')}
        </div>
        <div style="font-size:22px;font-weight:700;color:#0f172a;">
          {title}
        </div>
        <div style="font-size:14px;color:#475569;margin-top:10px;
             line-height:1.6;">{message}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:20px;">
          You can close this tab.
        </div>
      </div>
    </body></html>
    """


@router.get("/decide/{token}", response_class=HTMLResponse)
def decide_leave(
    token: str,
    action: str = Query(..., regex="^(approve|reject)$"),
    reason: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Click target for the email Approve / Reject buttons.

    Returns a styled HTML confirmation page (not JSON), so it
    renders nicely when an approver clicks the link from email.
    """

    leave = db.query(LeaveRequest).filter(
        LeaveRequest.APPROVAL_TOKEN == token
    ).first()

    if not leave:

        return HTMLResponse(
            _decision_html(
                "Link expired or invalid",
                "This approval link is no longer valid. "
                "It may have already been used.",
                color="#ef4444"
            ),
            status_code=404
        )

    if leave.STATUS != "PENDING_APPROVAL":

        return HTMLResponse(
            _decision_html(
                "Already decided",
                f"This leave request is already <strong>{leave.STATUS}</strong>.",
                color="#94a3b8"
            ),
            status_code=200
        )

    employee = db.query(Employee).filter(
        Employee.ID == leave.EMPLOYEE_ID
    ).first()

    import os

    approver_email = (
        os.getenv("APPROVER_EMAIL", "").strip()
        or os.getenv("ADMIN_EMAIL", "").strip()
        or "(unknown approver)"
    )

    if action == "approve":

        leave.STATUS = "APPROVED"

        leave.APPROVAL_RESOLVED_AT = datetime.utcnow()

        leave.APPROVED_BY_EMAIL = approver_email

        # invalidate token after use
        leave.APPROVAL_TOKEN = None

        # Deduct from balance
        deduct_balance(
            db, leave.EMPLOYEE_ID, leave.LEAVE_TYPE, leave.DAYS
        )

        db.commit()

        if employee:

            send_decision_email(leave, employee, "APPROVED")

        # In-app notification (visible to all admins via the bell)
        try:

            from app.models.models import Notification

            db.add(Notification(
                TITLE="Leave approved",
                MESSAGE=(
                    f"Manager approved {employee.NAME if employee else 'employee'}'s "
                    f"{leave.LEAVE_TYPE} leave from {leave.START_DATE} "
                    f"to {leave.END_DATE} ({leave.DAYS:g} day(s))."
                ),
                TYPE="INFO",
                IS_READ=0,
                VENDOR_ID=leave.VENDOR_ID
            ))

            db.commit()

        except Exception:

            db.rollback()

        return HTMLResponse(
            _decision_html(
                "Leave Approved",
                f"{employee.NAME if employee else 'Employee'}'s "
                f"{leave.LEAVE_TYPE} leave from "
                f"{leave.START_DATE} to {leave.END_DATE} "
                f"({leave.DAYS:g} day(s)) is now <strong>APPROVED</strong>. "
                f"The employee has been notified by email + in-app.",
                color="#10b981"
            )
        )

    else:   # reject

        leave.STATUS = "REJECTED"

        leave.APPROVAL_RESOLVED_AT = datetime.utcnow()

        leave.APPROVED_BY_EMAIL = approver_email

        leave.REJECTION_REASON = reason or "Rejected by approver"

        leave.APPROVAL_TOKEN = None

        db.commit()

        if employee:

            send_decision_email(leave, employee, "REJECTED")

        return HTMLResponse(
            _decision_html(
                "Leave Rejected",
                f"{employee.NAME if employee else 'Employee'}'s "
                f"leave request has been <strong>rejected</strong>. "
                f"The employee has been notified by email.",
                color="#ef4444"
            )
        )


# ----------------------------------------------------------------
# DECISION via dashboard (admin-side, alternative to email link)
# ----------------------------------------------------------------

@router.patch("/{leave_id}/approve")
def approve_via_dashboard(
    leave_id: int,
    db: Session = Depends(get_db)
):

    leave = db.query(LeaveRequest).filter(
        LeaveRequest.ID == leave_id
    ).first()

    if not leave:

        raise HTTPException(status_code=404, detail="Leave not found")

    if leave.STATUS != "PENDING_APPROVAL":

        raise HTTPException(
            status_code=409,
            detail=f"Cannot approve — current status is {leave.STATUS}"
        )

    employee = db.query(Employee).filter(
        Employee.ID == leave.EMPLOYEE_ID
    ).first()

    import os

    leave.STATUS = "APPROVED"

    leave.APPROVAL_RESOLVED_AT = datetime.utcnow()

    leave.APPROVED_BY_EMAIL = (
        os.getenv("APPROVER_EMAIL", "").strip()
        or "dashboard"
    )

    leave.APPROVAL_TOKEN = None

    deduct_balance(
        db, leave.EMPLOYEE_ID, leave.LEAVE_TYPE, leave.DAYS
    )

    db.commit()

    db.refresh(leave)

    if employee:

        send_decision_email(leave, employee, "APPROVED")

    # In-app notification
    try:

        from app.models.models import Notification

        db.add(Notification(
            TITLE="Leave approved",
            MESSAGE=(
                f"Manager approved {employee.NAME if employee else 'employee'}'s "
                f"{leave.LEAVE_TYPE} leave from {leave.START_DATE} "
                f"to {leave.END_DATE} ({leave.DAYS:g} day(s))."
            ),
            TYPE="INFO",
            IS_READ=0,
            VENDOR_ID=leave.VENDOR_ID
        ))

        db.commit()

    except Exception:

        db.rollback()

    return {
        "message": "Leave approved",
        "leave": _serialize_leave(leave, employee)
    }


@router.patch("/{leave_id}/reject")
def reject_via_dashboard(
    leave_id: int,
    data: LeaveRejectRequest,
    db: Session = Depends(get_db)
):

    leave = db.query(LeaveRequest).filter(
        LeaveRequest.ID == leave_id
    ).first()

    if not leave:

        raise HTTPException(status_code=404, detail="Leave not found")

    if leave.STATUS != "PENDING_APPROVAL":

        raise HTTPException(
            status_code=409,
            detail=f"Cannot reject — current status is {leave.STATUS}"
        )

    employee = db.query(Employee).filter(
        Employee.ID == leave.EMPLOYEE_ID
    ).first()

    import os

    leave.STATUS = "REJECTED"

    leave.APPROVAL_RESOLVED_AT = datetime.utcnow()

    leave.APPROVED_BY_EMAIL = (
        os.getenv("APPROVER_EMAIL", "").strip()
        or "dashboard"
    )

    leave.REJECTION_REASON = (
        data.REJECTION_REASON or "Rejected from dashboard"
    )

    leave.APPROVAL_TOKEN = None

    db.commit()

    db.refresh(leave)

    if employee:

        send_decision_email(leave, employee, "REJECTED")

    return {
        "message": "Leave rejected",
        "leave": _serialize_leave(leave, employee)
    }


# ----------------------------------------------------------------
# LISTS
# ----------------------------------------------------------------

@router.get("/pending")
def list_pending(
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    rows = (
        db.query(LeaveRequest, Employee)
        .outerjoin(
            Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID
        )
        .filter(
            LeaveRequest.VENDOR_ID == vendor_id,
            LeaveRequest.STATUS == "PENDING_APPROVAL"
        )
        .order_by(LeaveRequest.CREATED_AT.desc())
        .all()
    )

    return [_serialize_leave(lv, emp) for lv, emp in rows]


@router.get("/all")
def list_all(
    vendor_id: int = 1,
    status: Optional[str] = None,
    leave_type: Optional[str] = None,
    employee_id: Optional[str] = None,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    q = (
        db.query(LeaveRequest, Employee)
        .outerjoin(
            Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID
        )
        .filter(LeaveRequest.VENDOR_ID == vendor_id)
    )

    if status:

        q = q.filter(LeaveRequest.STATUS == status)

    if leave_type:

        q = q.filter(LeaveRequest.LEAVE_TYPE == leave_type)

    if employee_id:

        q = q.filter(LeaveRequest.EMPLOYEE_ID == employee_id)

    rows = q.order_by(LeaveRequest.CREATED_AT.desc()).all()

    return [_serialize_leave(lv, emp) for lv, emp in rows]


@router.get("/my-requests")
def list_my_requests(
    employee_id: str,
    db: Session = Depends(get_db)
):
    # Accept either UUID or EMPLOYEE_CODE
    emp = _resolve_employee(db, employee_id)

    if not emp:

        return []

    rows = (
        db.query(LeaveRequest, Employee)
        .outerjoin(
            Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID
        )
        .filter(LeaveRequest.EMPLOYEE_ID == emp.ID)
        .order_by(LeaveRequest.CREATED_AT.desc())
        .all()
    )

    return [_serialize_leave(lv, e) for lv, e in rows]


# ----------------------------------------------------------------
# CANCEL (employee-initiated)
# ----------------------------------------------------------------

@router.patch("/{leave_id}/cancel")
def cancel_leave(
    leave_id: int,
    data: LeaveCancelRequest,
    db: Session = Depends(get_db)
):

    leave = db.query(LeaveRequest).filter(
        LeaveRequest.ID == leave_id
    ).first()

    if not leave:

        raise HTTPException(status_code=404, detail="Leave not found")

    # Accept either UUID or EMPLOYEE_CODE for ownership check
    canceller = _resolve_employee(db, data.EMPLOYEE_ID)

    if not canceller or leave.EMPLOYEE_ID != canceller.ID:

        raise HTTPException(
            status_code=403,
            detail="You can only cancel your own leave requests"
        )

    data.EMPLOYEE_ID = canceller.ID

    if leave.STATUS not in ("PENDING_APPROVAL", "APPROVED"):

        raise HTTPException(
            status_code=409,
            detail=f"Cannot cancel a {leave.STATUS} leave"
        )

    was_approved = leave.STATUS == "APPROVED"

    leave.STATUS = "CANCELLED"

    leave.APPROVAL_TOKEN = None

    leave.UPDATED_AT = datetime.utcnow()

    if data.NOTES:

        leave.REJECTION_REASON = f"Cancelled by employee: {data.NOTES}"

    # If it was already approved, refund the balance
    if was_approved:

        refund_balance(
            db, leave.EMPLOYEE_ID, leave.LEAVE_TYPE, leave.DAYS
        )

    db.commit()

    return {
        "message": "Leave cancelled",
        "leave_id": leave.ID,
        "refunded": was_approved
    }


# ----------------------------------------------------------------
# BALANCE
# ----------------------------------------------------------------

@router.get("/balance/{employee_id}")
def get_balance(
    employee_id: str,
    year: Optional[int] = None,
    db: Session = Depends(get_db)
):

    emp = _resolve_employee(db, employee_id)

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    # Use the resolved UUID for the rest of the lookup chain
    employee_id = emp.ID

    bal = get_or_create_balance(db, employee_id, year)

    return {
        "employee": {
            "ID": emp.ID,
            "NAME": emp.NAME,
            "EMPLOYEE_CODE": emp.EMPLOYEE_CODE
        },
        "balance": serialize_balance(bal)
    }


# ----------------------------------------------------------------
# Admin dashboard tile
# ----------------------------------------------------------------

@router.get("/dashboard")
def leave_dashboard(
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    base = db.query(LeaveRequest).filter(
        LeaveRequest.VENDOR_ID == vendor_id
    )

    pending = base.filter(
        LeaveRequest.STATUS == "PENDING_APPROVAL"
    ).count()

    approved = base.filter(LeaveRequest.STATUS == "APPROVED").count()

    rejected = base.filter(LeaveRequest.STATUS == "REJECTED").count()

    cancelled = base.filter(LeaveRequest.STATUS == "CANCELLED").count()

    # Employees currently on approved leave today
    today = date.today()

    on_leave_today = (
        base.filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.START_DATE <= today,
            LeaveRequest.END_DATE >= today
        )
        .count()
    )

    return {
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "cancelled": cancelled,
        "on_leave_today": on_leave_today
    }


# ----------------------------------------------------------------
# PERMISSION (hourly time-off) — unified Employee Dashboard
# ----------------------------------------------------------------
# Permissions live in the same `leave_request` table with
# LEAVE_TYPE='PERMISSION'. They reuse the manager-approval email
# pipeline but are accounted in HOURS (DURATION_HOURS) instead of
# days, so they do NOT touch LeaveBalance.

@router.post("/apply-permission")
def apply_permission(
    data: PermissionApplyRequest,
    db: Session = Depends(get_db)
):
    """Submit an hourly permission request.

    Body: { EMPLOYEE_ID, PERMISSION_DATE, DURATION_HOURS, REASON }

    Creates a LeaveRequest row with:
      LEAVE_TYPE     = 'PERMISSION'
      START_DATE     = END_DATE = PERMISSION_DATE
      DAYS           = 0          (so quota math ignores it)
      DURATION_HOURS = hours      (the actual measure)
      STATUS         = 'PENDING_APPROVAL'

    Fires the same approver email as POST /leave/apply.
    """

    employee = _resolve_employee(db, data.EMPLOYEE_ID)

    if not employee:

        raise HTTPException(status_code=404, detail="Employee not found")

    # Validate duration
    try:

        hours = float(data.DURATION_HOURS)

    except (TypeError, ValueError):

        raise HTTPException(
            status_code=400,
            detail="DURATION_HOURS must be a number"
        )

    if hours <= 0:

        raise HTTPException(
            status_code=400,
            detail="DURATION_HOURS must be greater than 0"
        )

    if hours > 8:

        raise HTTPException(
            status_code=400,
            detail=(
                "DURATION_HOURS cannot exceed 8 — "
                "for longer absences apply a half-day or full-day leave."
            )
        )

    # Validate subtype (Phase D)
    subtype = (data.PERMISSION_SUBTYPE or "SHORT_PERMISSION").upper().strip()

    allowed_subtypes = {
        "SHORT_PERMISSION", "HALF_DAY", "LATE_COMING", "EARLY_EXIT"
    }

    if subtype not in allowed_subtypes:

        raise HTTPException(
            status_code=400,
            detail=(
                f"PERMISSION_SUBTYPE must be one of "
                f"{sorted(allowed_subtypes)}"
            )
        )

    reason_text = (data.REASON or "").strip()

    if not reason_text:

        raise HTTPException(
            status_code=400,
            detail=(
                "A reason is required — every permission goes to "
                "your manager for review before approval."
            )
        )

    # Prevent overlapping pending/approved permission for the same day
    overlap = db.query(LeaveRequest).filter(
        LeaveRequest.EMPLOYEE_ID == employee.ID,
        LeaveRequest.LEAVE_TYPE == "PERMISSION",
        LeaveRequest.STATUS.in_(["PENDING_APPROVAL", "APPROVED"]),
        LeaveRequest.START_DATE == data.PERMISSION_DATE
    ).first()

    if overlap:

        raise HTTPException(
            status_code=409,
            detail=(
                f"You already have a {overlap.STATUS} permission "
                f"({overlap.DURATION_HOURS or 0:g}h) for "
                f"{data.PERMISSION_DATE.isoformat()}."
            )
        )

    leave = LeaveRequest(
        EMPLOYEE_ID=employee.ID,
        LEAVE_TYPE="PERMISSION",
        PERMISSION_SUBTYPE=subtype,
        START_DATE=data.PERMISSION_DATE,
        END_DATE=data.PERMISSION_DATE,
        DAYS=0,
        DURATION_HOURS=hours,
        REASON=reason_text,
        STATUS="PENDING_APPROVAL",
        APPROVAL_TOKEN=generate_token(),
        APPROVAL_REQUESTED_AT=datetime.utcnow(),
        APPROVAL_RESOLVED_AT=None,
        APPROVED_BY_EMAIL=None,
        VENDOR_ID=employee.VENDOR_ID
    )

    db.add(leave)

    db.commit()

    db.refresh(leave)

    # Reuse the regular leave approval email — the body simply shows
    # 0 day(s) since DAYS=0 for permissions. The frontend / manager
    # can read DURATION_HOURS off the dashboard for the precise span.
    email_ok, email_msg = send_approval_email(db, leave, employee)

    return {
        "message": (
            f"Permission submitted for manager approval "
            f"({hours:g} hour(s) on "
            f"{data.PERMISSION_DATE.isoformat()})."
        ),
        "leave": _serialize_leave(leave, employee),
        "auto_approved": False,
        "hours_requested": hours,
        "reason_required": True,
        "email_sent_to_manager": email_ok,
        "email_status": (
            email_msg if not email_ok else "delivered to manager"
        )
    }


@router.get("/my-permissions")
def list_my_permissions(
    employee_id: str,
    db: Session = Depends(get_db)
):
    """Return the calling employee's permission history only.

    Same shape as GET /leave/my-requests, but filtered to
    LEAVE_TYPE='PERMISSION'.
    """

    emp = _resolve_employee(db, employee_id)

    if not emp:

        return []

    rows = (
        db.query(LeaveRequest, Employee)
        .outerjoin(
            Employee, LeaveRequest.EMPLOYEE_ID == Employee.ID
        )
        .filter(
            LeaveRequest.EMPLOYEE_ID == emp.ID,
            LeaveRequest.LEAVE_TYPE == "PERMISSION"
        )
        .order_by(LeaveRequest.CREATED_AT.desc())
        .all()
    )

    return [_serialize_leave(lv, e) for lv, e in rows]


@router.get("/dashboard-summary/{employee_id}")
def employee_dashboard_summary(
    employee_id: str,
    db: Session = Depends(get_db)
):
    """Aggregate counts for the Employee Dashboard summary cards.

    Returns:
      APPROVED_THIS_MONTH    — leaves the employee got approved this month
      PENDING_TOTAL          — all pending (leave + permission)
      REJECTED_THIS_MONTH    — leaves rejected this calendar month
      TOTAL_LEAVES_USED_YEAR — sum(DAYS) of APPROVED day-based leaves
                                this calendar year (PERMISSION excluded)
      APPROVED_PERMISSIONS_THIS_MONTH — bonus card for permission tile
    """

    emp = _resolve_employee(db, employee_id)

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    today = date.today()

    month_now = today.month

    year_now = today.year

    base = db.query(LeaveRequest).filter(
        LeaveRequest.EMPLOYEE_ID == emp.ID
    )

    approved_this_month = (
        base.filter(
            LeaveRequest.STATUS == "APPROVED",
            extract("year",  LeaveRequest.CREATED_AT) == year_now,
            extract("month", LeaveRequest.CREATED_AT) == month_now
        )
        .count()
    )

    pending_total = base.filter(
        LeaveRequest.STATUS == "PENDING_APPROVAL"
    ).count()

    rejected_this_month = (
        base.filter(
            LeaveRequest.STATUS == "REJECTED",
            extract("year",  LeaveRequest.CREATED_AT) == year_now,
            extract("month", LeaveRequest.CREATED_AT) == month_now
        )
        .count()
    )

    # Sum of approved day-based leave (PERMISSION rows have DAYS=0
    # but we exclude them explicitly to keep intent clear).
    year_rows = (
        base.filter(
            LeaveRequest.STATUS == "APPROVED",
            LeaveRequest.LEAVE_TYPE != "PERMISSION",
            extract("year", LeaveRequest.START_DATE) == year_now
        )
        .all()
    )

    total_leaves_used_year = round(
        sum((r.DAYS or 0) for r in year_rows), 2
    )

    approved_permissions_this_month = (
        base.filter(
            LeaveRequest.LEAVE_TYPE == "PERMISSION",
            LeaveRequest.STATUS == "APPROVED",
            extract("year",  LeaveRequest.START_DATE) == year_now,
            extract("month", LeaveRequest.START_DATE) == month_now
        )
        .count()
    )

    return {
        "EMPLOYEE_ID": emp.ID,
        "EMPLOYEE_CODE": emp.EMPLOYEE_CODE,
        "EMPLOYEE_NAME": emp.NAME,
        "APPROVED_THIS_MONTH": approved_this_month,
        "PENDING_TOTAL": pending_total,
        "REJECTED_THIS_MONTH": rejected_this_month,
        "TOTAL_LEAVES_USED_YEAR": total_leaves_used_year,
        "APPROVED_PERMISSIONS_THIS_MONTH": (
            approved_permissions_this_month
        )
    }


# =====================================================================
# HR Module — Phase C: Leave Quota Policy admin endpoints
# =====================================================================
# Lets admin override the default 12/12/15 quotas per
# COMPANY / DEPARTMENT / DESIGNATION. The first matching active
# policy wins at LeaveBalance creation time.

class LeaveQuotaPolicyCreate(BaseModel):

    POLICY_NAME: str = Field(..., min_length=1, max_length=100)
    SCOPE: str = Field(..., pattern="^(COMPANY|DEPARTMENT|DESIGNATION)$")
    SCOPE_ID: int | None = None
    CASUAL_DAYS:     float = 12.0
    SICK_DAYS:       float = 12.0
    EARNED_DAYS:     float = 15.0
    MATERNITY_DAYS:  float = 180.0
    CARRYOVER_LIMIT_CASUAL:    float = 0.0
    CARRYOVER_LIMIT_SICK:      float = 0.0
    CARRYOVER_LIMIT_EARNED:    float = 15.0
    CARRYOVER_LIMIT_MATERNITY: float = 0.0
    IS_ACTIVE: int = 1
    NOTES: str | None = None


class LeaveQuotaPolicyUpdate(BaseModel):

    POLICY_NAME: str | None = None
    SCOPE: str | None = Field(default=None, pattern="^(COMPANY|DEPARTMENT|DESIGNATION)$")
    SCOPE_ID: int | None = None
    CASUAL_DAYS: float | None = None
    SICK_DAYS: float | None = None
    EARNED_DAYS: float | None = None
    MATERNITY_DAYS: float | None = None
    CARRYOVER_LIMIT_CASUAL:    float | None = None
    CARRYOVER_LIMIT_SICK:      float | None = None
    CARRYOVER_LIMIT_EARNED:    float | None = None
    CARRYOVER_LIMIT_MATERNITY: float | None = None
    IS_ACTIVE: int | None = None
    NOTES: str | None = None


def _serialize_policy(p: LeaveQuotaPolicy) -> dict:

    return {
        "ID":             p.ID,
        "POLICY_NAME":    p.POLICY_NAME,
        "SCOPE":          p.SCOPE,
        "SCOPE_ID":       p.SCOPE_ID,
        "CASUAL_DAYS":    p.CASUAL_DAYS,
        "SICK_DAYS":      p.SICK_DAYS,
        "EARNED_DAYS":    p.EARNED_DAYS,
        "MATERNITY_DAYS": p.MATERNITY_DAYS,
        "CARRYOVER_LIMIT_CASUAL":    p.CARRYOVER_LIMIT_CASUAL,
        "CARRYOVER_LIMIT_SICK":      p.CARRYOVER_LIMIT_SICK,
        "CARRYOVER_LIMIT_EARNED":    p.CARRYOVER_LIMIT_EARNED,
        "CARRYOVER_LIMIT_MATERNITY": p.CARRYOVER_LIMIT_MATERNITY,
        "IS_ACTIVE":      bool(p.IS_ACTIVE),
        "NOTES":          p.NOTES,
        "VENDOR_ID":      p.VENDOR_ID,
        "CREATED_AT":     p.CREATED_AT.isoformat() if p.CREATED_AT else None,
        "UPDATED_AT":     p.UPDATED_AT.isoformat() if p.UPDATED_AT else None,
    }


@router.get("/quota-policies")
def list_quota_policies(
    scope: str | None = Query(None),
    is_active: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """List every quota policy. Optional ?scope=DEPARTMENT and
    ?is_active=1 filters."""

    q = db.query(LeaveQuotaPolicy)

    if scope:

        q = q.filter(LeaveQuotaPolicy.SCOPE == scope.upper().strip())

    if is_active is not None:

        q = q.filter(LeaveQuotaPolicy.IS_ACTIVE == is_active)

    rows = q.order_by(LeaveQuotaPolicy.SCOPE, LeaveQuotaPolicy.SCOPE_ID).all()

    return [_serialize_policy(p) for p in rows]


@router.post("/quota-policies")
def create_quota_policy(
    body: LeaveQuotaPolicyCreate,
    db: Session = Depends(get_db),
):
    """Create a new quota policy. SCOPE_ID is required when SCOPE is
    DEPARTMENT or DESIGNATION; ignored for COMPANY."""

    if body.SCOPE in ("DEPARTMENT", "DESIGNATION") and not body.SCOPE_ID:

        raise HTTPException(
            status_code=400,
            detail=(
                f"SCOPE_ID is required when SCOPE={body.SCOPE}. "
                "Pass the department.ID or designation.ID."
            )
        )

    # Refuse duplicate (SCOPE, SCOPE_ID) pairs among active policies —
    # we want resolution to be unambiguous.
    existing = db.query(LeaveQuotaPolicy).filter(
        LeaveQuotaPolicy.SCOPE == body.SCOPE,
        LeaveQuotaPolicy.SCOPE_ID == body.SCOPE_ID,
        LeaveQuotaPolicy.IS_ACTIVE == 1
    ).first()

    if existing:

        raise HTTPException(
            status_code=400,
            detail=(
                f"An active policy for {body.SCOPE}/{body.SCOPE_ID} "
                f"already exists (ID={existing.ID}). Deactivate it "
                "first or PATCH that row instead."
            )
        )

    policy = LeaveQuotaPolicy(**body.model_dump())

    db.add(policy)

    db.commit()

    db.refresh(policy)

    return {
        "message": f"Quota policy '{policy.POLICY_NAME}' created.",
        "policy": _serialize_policy(policy),
    }


@router.patch("/quota-policies/{policy_id}")
def update_quota_policy(
    policy_id: int,
    body: LeaveQuotaPolicyUpdate,
    db: Session = Depends(get_db),
):

    p = db.query(LeaveQuotaPolicy).filter(
        LeaveQuotaPolicy.ID == policy_id
    ).first()

    if not p:

        raise HTTPException(status_code=404, detail="Policy not found")

    for k, v in body.model_dump(exclude_unset=True).items():

        setattr(p, k, v)

    db.commit()

    db.refresh(p)

    return {
        "message": f"Quota policy '{p.POLICY_NAME}' updated.",
        "policy": _serialize_policy(p),
    }


@router.delete("/quota-policies/{policy_id}")
def delete_quota_policy(
    policy_id: int,
    db: Session = Depends(get_db),
):
    """Hard-delete a policy. LeaveBalance rows that referenced it via
    POLICY_ID retain their already-provisioned quotas — only future
    balance creations are affected by the deletion."""

    p = db.query(LeaveQuotaPolicy).filter(
        LeaveQuotaPolicy.ID == policy_id
    ).first()

    if not p:

        raise HTTPException(status_code=404, detail="Policy not found")

    name = p.POLICY_NAME

    db.delete(p)

    db.commit()

    return {"message": f"Quota policy '{name}' deleted."}


@router.get("/quota-policies/resolve/{employee_id}")
def resolve_policy_for_employee(
    employee_id: str,
    db: Session = Depends(get_db),
):
    """Debug helper — shows WHICH policy would apply to a given
    employee, plus the resolved effective quotas after the FEMALE
    gate is applied."""

    from app.services.leave_service import (
        find_applicable_policy,
        _quotas_from_policy,
        _employee_is_female
    )

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    policy = find_applicable_policy(db, emp)

    quotas = _quotas_from_policy(policy)

    is_female = _employee_is_female(emp)

    if not is_female:

        quotas["MATERNITY_TOTAL"] = 0.0

        quotas["CARRYOVER_LIMIT_MATERNITY"] = 0.0

    return {
        "employee_id": emp.ID,
        "employee_code": emp.EMPLOYEE_CODE,
        "gender": emp.GENDER,
        "is_female": is_female,
        "designation_id": emp.DESIGNATION_ID,
        "department_id": emp.DEPARTMENT_ID,
        "matched_policy": _serialize_policy(policy) if policy else None,
        "effective_quotas": quotas,
    }
