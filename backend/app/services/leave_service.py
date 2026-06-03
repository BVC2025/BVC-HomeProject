"""
Leave Management service layer.

  - Computes / refreshes per-employee annual leave balances
  - Validates leave applications against quota
  - Generates approval tokens + dispatches approval emails
"""

import os
import secrets
from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    LeaveRequest,
    LeaveBalance,
    LeaveQuotaPolicy,
    Department
)

from app.services.email_service import send_alert_email


# ---- Quota defaults --------------------------------------------------

# Final fallback when no LeaveQuotaPolicy row applies.
DEFAULT_QUOTAS = {
    "CASUAL_TOTAL":      12.0,
    "SICK_TOTAL":        12.0,
    "EARNED_TOTAL":      15.0,
    "MATERNITY_TOTAL":  180.0,
    "CARRYOVER_LIMIT_CASUAL":      0.0,
    "CARRYOVER_LIMIT_SICK":        0.0,
    "CARRYOVER_LIMIT_EARNED":     15.0,
    "CARRYOVER_LIMIT_MATERNITY":   0.0,
}

# Leave types that draw from balance. UNPAID / LOP don't.
QUOTA_BACKED_TYPES = {"CASUAL", "SICK", "EARNED", "MATERNITY"}

VALID_LEAVE_TYPES = {"CASUAL", "SICK", "EARNED", "MATERNITY", "UNPAID", "LOP"}


# ---- Policy lookup --------------------------------------------------

def find_applicable_policy(
    db: Session,
    employee: Employee
) -> Optional[LeaveQuotaPolicy]:
    """Resolution order: DESIGNATION → DEPARTMENT → COMPANY (first
    match wins). Returns None if no active policy exists at all."""

    if employee.DESIGNATION_ID:

        p = db.query(LeaveQuotaPolicy).filter(
            LeaveQuotaPolicy.SCOPE == "DESIGNATION",
            LeaveQuotaPolicy.SCOPE_ID == employee.DESIGNATION_ID,
            LeaveQuotaPolicy.IS_ACTIVE == 1
        ).first()

        if p:

            return p

    if employee.DEPARTMENT_ID:

        p = db.query(LeaveQuotaPolicy).filter(
            LeaveQuotaPolicy.SCOPE == "DEPARTMENT",
            LeaveQuotaPolicy.SCOPE_ID == employee.DEPARTMENT_ID,
            LeaveQuotaPolicy.IS_ACTIVE == 1
        ).first()

        if p:

            return p

    return db.query(LeaveQuotaPolicy).filter(
        LeaveQuotaPolicy.SCOPE == "COMPANY",
        LeaveQuotaPolicy.IS_ACTIVE == 1
    ).first()


def _quotas_from_policy(
    policy: Optional[LeaveQuotaPolicy]
) -> dict:
    """Returns a quota dict in the same shape as DEFAULT_QUOTAS,
    falling back to DEFAULT_QUOTAS for any field the policy is missing."""

    if not policy:

        return dict(DEFAULT_QUOTAS)

    return {
        "CASUAL_TOTAL":              policy.CASUAL_DAYS    or DEFAULT_QUOTAS["CASUAL_TOTAL"],
        "SICK_TOTAL":                policy.SICK_DAYS      or DEFAULT_QUOTAS["SICK_TOTAL"],
        "EARNED_TOTAL":              policy.EARNED_DAYS    or DEFAULT_QUOTAS["EARNED_TOTAL"],
        "MATERNITY_TOTAL":           policy.MATERNITY_DAYS or DEFAULT_QUOTAS["MATERNITY_TOTAL"],
        "CARRYOVER_LIMIT_CASUAL":    policy.CARRYOVER_LIMIT_CASUAL    or 0.0,
        "CARRYOVER_LIMIT_SICK":      policy.CARRYOVER_LIMIT_SICK      or 0.0,
        "CARRYOVER_LIMIT_EARNED":    policy.CARRYOVER_LIMIT_EARNED    or 0.0,
        "CARRYOVER_LIMIT_MATERNITY": policy.CARRYOVER_LIMIT_MATERNITY or 0.0,
    }


def _employee_is_female(emp: Optional[Employee]) -> bool:

    if not emp or not emp.GENDER:

        return False

    return emp.GENDER.upper().strip() == "FEMALE"


def _approver_email() -> str:
    """Same fallback the existing task-approval flow uses."""

    return (
        os.getenv("APPROVER_EMAIL", "").strip()
        or os.getenv("ADMIN_EMAIL", "").strip()
    )


def _approver_name() -> str:

    return os.getenv("APPROVER_NAME", "Approver").strip() or "Approver"


def _backend_url() -> str:

    return (
        os.getenv("BACKEND_URL", "").rstrip("/")
        or "http://localhost:8001"
    )


def _frontend_url() -> str:

    return (
        os.getenv("FRONTEND_URL", "").rstrip("/")
        or "http://localhost:5173"
    )


# ---- Balance helpers -------------------------------------------------

def get_or_create_balance(
    db: Session,
    employee_id: str,
    year: Optional[int] = None
) -> LeaveBalance:
    """Returns the current year's LeaveBalance row, creating it on
    first access. The new row is provisioned from the resolved
    LeaveQuotaPolicy (designation > department > company > defaults)
    and auto-carryover is computed from the prior year's row (if any),
    capped by the policy's CARRYOVER_LIMIT_* values."""

    if year is None:

        year = date.today().year

    bal = db.query(LeaveBalance).filter(
        LeaveBalance.EMPLOYEE_ID == employee_id,
        LeaveBalance.YEAR == year
    ).first()

    if bal:

        return bal

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    policy = find_applicable_policy(db, emp) if emp else None

    quotas = _quotas_from_policy(policy)

    # MATERNITY only applies to FEMALE employees
    if not _employee_is_female(emp):

        quotas["MATERNITY_TOTAL"] = 0.0

        quotas["CARRYOVER_LIMIT_MATERNITY"] = 0.0

    # ---- Compute carryover from prior year ----
    prior = db.query(LeaveBalance).filter(
        LeaveBalance.EMPLOYEE_ID == employee_id,
        LeaveBalance.YEAR == year - 1
    ).first()

    def _carry(prior_total, prior_used, prior_carry, limit):
        """Days carried = min(remaining_in_prior_year, limit)."""

        if not limit or limit <= 0:

            return 0.0

        remaining = max(
            0.0,
            (prior_total or 0.0) + (prior_carry or 0.0) - (prior_used or 0.0)
        )

        return round(min(remaining, limit), 1)

    casual_carry    = _carry(
        prior and prior.CASUAL_TOTAL,
        prior and prior.CASUAL_USED,
        prior and prior.CASUAL_CARRYOVER,
        quotas["CARRYOVER_LIMIT_CASUAL"]
    ) if prior else 0.0

    sick_carry      = _carry(
        prior and prior.SICK_TOTAL,
        prior and prior.SICK_USED,
        prior and prior.SICK_CARRYOVER,
        quotas["CARRYOVER_LIMIT_SICK"]
    ) if prior else 0.0

    earned_carry    = _carry(
        prior and prior.EARNED_TOTAL,
        prior and prior.EARNED_USED,
        prior and prior.EARNED_CARRYOVER,
        quotas["CARRYOVER_LIMIT_EARNED"]
    ) if prior else 0.0

    maternity_carry = _carry(
        prior and prior.MATERNITY_TOTAL,
        prior and prior.MATERNITY_USED,
        prior and prior.MATERNITY_CARRYOVER,
        quotas["CARRYOVER_LIMIT_MATERNITY"]
    ) if prior else 0.0

    bal = LeaveBalance(
        EMPLOYEE_ID=employee_id,
        YEAR=year,
        CASUAL_TOTAL=quotas["CASUAL_TOTAL"],
        CASUAL_USED=0.0,
        SICK_TOTAL=quotas["SICK_TOTAL"],
        SICK_USED=0.0,
        EARNED_TOTAL=quotas["EARNED_TOTAL"],
        EARNED_USED=0.0,
        MATERNITY_TOTAL=quotas["MATERNITY_TOTAL"],
        MATERNITY_USED=0.0,
        CASUAL_CARRYOVER=casual_carry,
        SICK_CARRYOVER=sick_carry,
        EARNED_CARRYOVER=earned_carry,
        MATERNITY_CARRYOVER=maternity_carry,
        POLICY_ID=(policy.ID if policy else None)
    )

    db.add(bal)

    db.commit()

    db.refresh(bal)

    return bal


def _bucket(total, used, carry):
    """Helper — returns {total, carryover, used, remaining}."""

    t = float(total or 0.0)

    c = float(carry or 0.0)

    u = float(used or 0.0)

    return {
        "total":     t,
        "carryover": c,
        "used":      u,
        "remaining": round(max(0.0, t + c - u), 1)
    }


def serialize_balance(bal: LeaveBalance) -> dict:

    return {
        "EMPLOYEE_ID": bal.EMPLOYEE_ID,
        "YEAR": bal.YEAR,
        "POLICY_ID": bal.POLICY_ID,
        "CASUAL":    _bucket(bal.CASUAL_TOTAL,    bal.CASUAL_USED,    bal.CASUAL_CARRYOVER),
        "SICK":      _bucket(bal.SICK_TOTAL,      bal.SICK_USED,      bal.SICK_CARRYOVER),
        "EARNED":    _bucket(bal.EARNED_TOTAL,    bal.EARNED_USED,    bal.EARNED_CARRYOVER),
        "MATERNITY": _bucket(bal.MATERNITY_TOTAL, bal.MATERNITY_USED, bal.MATERNITY_CARRYOVER),
    }


def remaining_for_type(bal: LeaveBalance, leave_type: str) -> float:

    if leave_type == "CASUAL":

        return (bal.CASUAL_TOTAL or 0) + (bal.CASUAL_CARRYOVER or 0) - (bal.CASUAL_USED or 0)

    if leave_type == "SICK":

        return (bal.SICK_TOTAL or 0) + (bal.SICK_CARRYOVER or 0) - (bal.SICK_USED or 0)

    if leave_type == "EARNED":

        return (bal.EARNED_TOTAL or 0) + (bal.EARNED_CARRYOVER or 0) - (bal.EARNED_USED or 0)

    if leave_type == "MATERNITY":

        return (bal.MATERNITY_TOTAL or 0) + (bal.MATERNITY_CARRYOVER or 0) - (bal.MATERNITY_USED or 0)

    return float("inf")   # UNPAID / LOP


def deduct_balance(
    db: Session,
    employee_id: str,
    leave_type: str,
    days: float,
    year: Optional[int] = None
):

    if leave_type not in QUOTA_BACKED_TYPES:

        return

    bal = get_or_create_balance(db, employee_id, year)

    if leave_type == "CASUAL":

        bal.CASUAL_USED = round(bal.CASUAL_USED + days, 2)

    elif leave_type == "SICK":

        bal.SICK_USED = round(bal.SICK_USED + days, 2)

    elif leave_type == "EARNED":

        bal.EARNED_USED = round(bal.EARNED_USED + days, 2)

    elif leave_type == "MATERNITY":

        bal.MATERNITY_USED = round(bal.MATERNITY_USED + days, 2)

    db.commit()


def refund_balance(
    db: Session,
    employee_id: str,
    leave_type: str,
    days: float,
    year: Optional[int] = None
):
    """Used when an APPROVED leave is later cancelled."""

    if leave_type not in QUOTA_BACKED_TYPES:

        return

    bal = get_or_create_balance(db, employee_id, year)

    if leave_type == "CASUAL":

        bal.CASUAL_USED = max(0.0, bal.CASUAL_USED - days)

    elif leave_type == "SICK":

        bal.SICK_USED = max(0.0, bal.SICK_USED - days)

    elif leave_type == "EARNED":

        bal.EARNED_USED = max(0.0, bal.EARNED_USED - days)

    elif leave_type == "MATERNITY":

        bal.MATERNITY_USED = max(0.0, bal.MATERNITY_USED - days)

    db.commit()


# ---- Phase D: auto-create Permission rows from attendance signals ----

PERMISSION_SUBTYPES = {
    "SHORT_PERMISSION", "HALF_DAY", "LATE_COMING", "EARLY_EXIT"
}


def _has_existing_permission(
    db: Session,
    employee_id: str,
    on_date: date,
    subtype: str
) -> bool:
    """Idempotency guard — refuse to auto-create a second LATE_COMING
    (or EARLY_EXIT) if one already exists for the same day."""

    existing = db.query(LeaveRequest).filter(
        LeaveRequest.EMPLOYEE_ID == employee_id,
        LeaveRequest.LEAVE_TYPE == "PERMISSION",
        LeaveRequest.PERMISSION_SUBTYPE == subtype,
        LeaveRequest.START_DATE == on_date,
        LeaveRequest.STATUS.in_([
            "PENDING_APPROVAL", "APPROVED", "REJECTED"
        ])
    ).first()

    return existing is not None


def auto_create_permission(
    db: Session,
    employee_id: str,
    on_date: date,
    subtype: str,
    duration_hours: float,
    reason: str,
    vendor_id: int = 1
) -> Optional[LeaveRequest]:
    """Create a PENDING_APPROVAL PERMISSION row driven by an
    attendance event (LATE_COMING / EARLY_EXIT). Returns None if a
    row already exists for the same (employee, date, subtype)."""

    subtype = (subtype or "").upper().strip()

    if subtype not in PERMISSION_SUBTYPES:

        return None

    if duration_hours <= 0:

        return None

    if _has_existing_permission(db, employee_id, on_date, subtype):

        return None

    row = LeaveRequest(
        EMPLOYEE_ID=employee_id,
        LEAVE_TYPE="PERMISSION",
        PERMISSION_SUBTYPE=subtype,
        START_DATE=on_date,
        END_DATE=on_date,
        DAYS=0,
        DURATION_HOURS=round(duration_hours, 2),
        REASON=reason or f"Auto-recorded {subtype.replace('_', ' ').title()}",
        STATUS="PENDING_APPROVAL",
        APPROVAL_TOKEN=generate_token(),
        APPROVAL_REQUESTED_AT=datetime.utcnow(),
        VENDOR_ID=vendor_id,
    )

    db.add(row)

    db.commit()

    db.refresh(row)

    return row


# ---- Application + approval -----------------------------------------

def compute_days(start: date, end: date, half_day: bool = False) -> float:

    if half_day:

        return 0.5

    delta = (end - start).days + 1

    return float(max(delta, 1))


def generate_token() -> str:

    return secrets.token_urlsafe(32)


def send_approval_email(
    db: Session,
    leave: LeaveRequest,
    employee: Employee
) -> tuple[bool, str]:
    """Dispatch the approve / reject email to the configured authority."""

    recipient = _approver_email()

    if not recipient:

        return False, "APPROVER_EMAIL not configured in .env"

    backend = _backend_url()

    frontend = _frontend_url()

    approve_link = (
        f"{backend}/leave/decide/{leave.APPROVAL_TOKEN}?action=approve"
    )

    reject_link = (
        f"{backend}/leave/decide/{leave.APPROVAL_TOKEN}?action=reject"
    )

    review_link = (
        f"{frontend}/leave-management"
    )

    days_label = (
        "0.5 day (half-day)" if leave.DAYS == 0.5
        else f"{leave.DAYS:g} day(s)"
    )

    body_html = f"""
    <html>
      <body style="font-family:Segoe UI,sans-serif;color:#0f172a;
                   max-width:560px;margin:0 auto;padding:24px;">

        <div style="background:#1e40af;color:white;padding:18px 22px;
                    border-radius:10px 10px 0 0;">
          <div style="font-size:11px;letter-spacing:1.4px;
                      opacity:0.7;text-transform:uppercase;">
            BVC24 ERP · Leave Approval
          </div>
          <div style="font-size:20px;font-weight:700;margin-top:4px;">
            Leave request from {employee.NAME}
          </div>
        </div>

        <div style="background:white;padding:22px;border:1px solid #e2e8f0;
                    border-top:none;border-radius:0 0 10px 10px;">

          <table style="width:100%;font-size:14px;line-height:1.7;">
            <tr><td style="color:#64748b;width:35%;">Employee</td>
                <td><strong>{employee.NAME}</strong>
                  ({employee.EMPLOYEE_CODE})</td></tr>
            <tr><td style="color:#64748b;">Leave Type</td>
                <td><strong>{leave.LEAVE_TYPE}</strong></td></tr>
            <tr><td style="color:#64748b;">Start Date</td>
                <td>{leave.START_DATE.isoformat()}</td></tr>
            <tr><td style="color:#64748b;">End Date</td>
                <td>{leave.END_DATE.isoformat()}</td></tr>
            <tr><td style="color:#64748b;">Days</td>
                <td><strong>{days_label}</strong></td></tr>
            <tr><td style="color:#64748b;vertical-align:top;">Reason</td>
                <td>{leave.REASON or '(no reason given)'}</td></tr>
          </table>

          <div style="margin-top:22px;display:flex;gap:10px;
                      justify-content:center;">

            <a href="{approve_link}"
               style="background:#10b981;color:white;padding:12px 24px;
                      border-radius:8px;text-decoration:none;
                      font-weight:700;font-size:14px;">
              ✓ Approve
            </a>

            <a href="{reject_link}"
               style="background:#ef4444;color:white;padding:12px 24px;
                      border-radius:8px;text-decoration:none;
                      font-weight:700;font-size:14px;">
              ✗ Reject
            </a>
          </div>

          <div style="margin-top:18px;font-size:12px;color:#94a3b8;
                      text-align:center;">
            Or open the
            <a href="{review_link}" style="color:#1e40af;">
              Leave Management dashboard
            </a> to review all pending requests.
          </div>
        </div>

      </body>
    </html>
    """

    return send_alert_email(
        subject=(
            f"[BVC24] Leave request — {employee.NAME} "
            f"({leave.LEAVE_TYPE}, {days_label})"
        ),
        body_html=body_html,
        recipient=recipient
    )


def send_decision_email(
    leave: LeaveRequest,
    employee: Employee,
    decision: str
) -> tuple[bool, str]:
    """Notify the employee of the approval decision."""

    if not employee.EMAIL:

        return False, "Employee has no email on file"

    color = "#10b981" if decision == "APPROVED" else "#ef4444"

    headline = (
        "Leave Approved" if decision == "APPROVED"
        else "Leave Rejected"
    )

    body_html = f"""
    <html><body style="font-family:Segoe UI,sans-serif;color:#0f172a;
         max-width:520px;margin:0 auto;padding:20px;">

      <div style="background:{color};color:white;padding:16px 20px;
                  border-radius:10px 10px 0 0;">
        <div style="font-size:11px;letter-spacing:1.4px;
                    opacity:0.7;text-transform:uppercase;">
          BVC24 ERP · Leave Decision
        </div>
        <div style="font-size:20px;font-weight:700;margin-top:4px;">
          {headline}
        </div>
      </div>

      <div style="background:white;padding:20px;border:1px solid #e2e8f0;
                  border-top:none;border-radius:0 0 10px 10px;">

        <p>Hi {employee.NAME},</p>

        <p>Your <strong>{leave.LEAVE_TYPE}</strong> leave request from
        <strong>{leave.START_DATE.isoformat()}</strong> to
        <strong>{leave.END_DATE.isoformat()}</strong>
        ({leave.DAYS:g} day(s)) has been <strong>{decision}</strong>.</p>

        {f'<p><strong>Reason:</strong> {leave.REJECTION_REASON}</p>'
            if decision == 'REJECTED' and leave.REJECTION_REASON
            else ''}

        <p style="color:#64748b;font-size:13px;margin-top:24px;">
          — BVC24 ERP
        </p>
      </div>
    </body></html>
    """

    return send_alert_email(
        subject=f"[BVC24] {headline} — {leave.START_DATE.isoformat()}",
        body_html=body_html,
        recipient=employee.EMAIL
    )
