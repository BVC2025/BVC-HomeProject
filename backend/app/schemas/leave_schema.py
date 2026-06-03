from datetime import date
from typing import Optional

from pydantic import BaseModel


class LeaveApplyRequest(BaseModel):

    EMPLOYEE_ID: str
    LEAVE_TYPE: str = "CASUAL"
    # Day-based types: CASUAL / SICK / EARNED / UNPAID / LOP
    # Hourly type:     PERMISSION (use POST /leave/apply-permission)
    # The /leave/apply endpoint rejects LEAVE_TYPE='PERMISSION' so
    # callers route through the dedicated permission endpoint that
    # accepts DURATION_HOURS instead of a date range.
    START_DATE: date
    END_DATE: date
    REASON: Optional[str] = None
    # Reason is OPTIONAL on the wire — the route enforces it
    # conditionally: required only when DAYS > 2 (per BVC24 policy).
    DAYS: Optional[float] = None   # auto-computed from dates if omitted
    HALF_DAY: bool = False


class LeaveCancelRequest(BaseModel):

    EMPLOYEE_ID: str
    NOTES: Optional[str] = None


class LeaveRejectRequest(BaseModel):

    REJECTION_REASON: Optional[str] = None


class PermissionApplyRequest(BaseModel):
    """Body for POST /leave/apply-permission.

    Permission is a sub-day, hour-based time-off slot that piggy-backs
    on the LeaveRequest table (LEAVE_TYPE='PERMISSION'). It uses the
    same manager-approval email flow as regular leave but is tracked
    in HOURS rather than days, so it does not deduct from CASUAL /
    SICK / EARNED quotas.
    """

    EMPLOYEE_ID: str
    PERMISSION_DATE: date
    # The single calendar date on which the permission applies.
    # Stored as both START_DATE and END_DATE for consistency.
    DURATION_HOURS: float
    # How many hours the permission covers (e.g. 1.5, 2.0, 3.0).
    # Must be > 0 and <= 8 (a full working day).
    REASON: Optional[str] = None
    # Required by the route handler (same policy as leave) — manager
    # needs context to decide approve / reject from the email.

    PERMISSION_SUBTYPE: Optional[str] = "SHORT_PERMISSION"
    # Phase D: SHORT_PERMISSION (default) | HALF_DAY | LATE_COMING |
    # EARLY_EXIT. LATE_COMING + EARLY_EXIT are normally auto-created
    # by the login/logout handlers but are accepted here too so HR
    # can backfill manually.
