"""
LeaveDecisionService — auto-approval engine layered on top of LeaveRequest.

Aligned to the existing LeaveRequest / LeaveBalance schema:
  - LeaveRequest.LEAVE_TYPE is a STRING column (CASUAL / SICK / EARNED /
    UNPAID / LOP / PERMISSION), not a FK.
  - LeaveBalance carries per-type quotas as columns
    (CASUAL_TOTAL/USED, SICK_TOTAL/USED, EARNED_TOTAL/USED, MATERNITY_*,
    plus *_CARRYOVER).
  - LeaveRequest.STATUS values: PENDING_APPROVAL / APPROVED / REJECTED /
    CANCELLED / EXPIRED. We use APPROVED and stamp APPROVED_BY_EMAIL =
    'AI Auto-Approval' to mark machine decisions.

Inputs evaluated:
  - Balance availability (per leave type)
  - Holiday clash
  - Team availability
  - Monthly CL quota (1 CL/month rule)
  - Pending tasks (warning-only)

The LLM is NOT used here. Decisions are deterministic and audit-friendly.
The Gemini LeaveAgent still handles the NL parsing front-end.
"""

from __future__ import annotations
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field

from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models.models import (
    Employee, LeaveRequest, LeaveBalance, HolidayCalendar,
    Notification, TaskAssignment,
)


# =====================================================================
# Tunables
# =====================================================================

class DecisionPolicy:
    AUTO_APPROVE_MAX_DAYS = 1.0
    AUTO_APPROVE_MIN_BALANCE_BUFFER = 0
    SAME_DEPT_MAX_ON_LEAVE_PCT = 30
    SAME_DEPT_MIN_TEAM_SIZE = 3
    CL_MONTHLY_QUOTA = 1.0
    PENDING_TASK_WARN = 3


# Map LEAVE_TYPE string → balance column prefix.
BAL_COLS = {
    "CASUAL":    ("CASUAL_TOTAL",    "CASUAL_USED",    "CASUAL_CARRYOVER"),
    "SICK":      ("SICK_TOTAL",      "SICK_USED",      "SICK_CARRYOVER"),
    "EARNED":    ("EARNED_TOTAL",    "EARNED_USED",    "EARNED_CARRYOVER"),
    "MATERNITY": ("MATERNITY_TOTAL", "MATERNITY_USED", "MATERNITY_CARRYOVER"),
}
# UNPAID / LOP / PERMISSION don't draw from balance.
UNLIMITED_TYPES = {"UNPAID", "LOP", "PERMISSION"}


# =====================================================================
# Output shape
# =====================================================================


@dataclass
class LeaveSignals:
    balance_ok: bool = True
    balance_available: float = 0.0
    balance_after: float = 0.0
    holiday_clash: bool = False
    holiday_dates: List[str] = field(default_factory=list)
    team_size: int = 0
    team_on_leave_same_day: int = 0
    team_on_leave_pct: float = 0.0
    cl_used_this_month: float = 0.0
    cl_monthly_quota: float = DecisionPolicy.CL_MONTHLY_QUOTA
    cl_excess: bool = False
    pending_tasks: int = 0
    days: float = 0.0
    leave_type_code: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class LeaveDecision:
    verdict: str
    confidence: float
    reason_summary: str
    blockers: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    signals: LeaveSignals = field(default_factory=LeaveSignals)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "verdict": self.verdict,
            "confidence": self.confidence,
            "reason_summary": self.reason_summary,
            "blockers": self.blockers,
            "warnings": self.warnings,
            "signals": self.signals.to_dict(),
        }


# =====================================================================
# Service
# =====================================================================


class LeaveDecisionService:

    AUTO_APPROVAL_ACTOR = "AI Auto-Approval"

    def __init__(self, db: Session):
        self.db = db

    def evaluate(self, req: LeaveRequest) -> LeaveDecision:
        emp = self.db.get(Employee, req.EMPLOYEE_ID)
        if not emp:
            return LeaveDecision(
                verdict="NEEDS_HUMAN", confidence=0.0,
                reason_summary="Employee not found",
                blockers=["Employee record missing"],
            )
        sig = self._gather_signals(emp, req)
        decision = self._decide(sig)
        decision.signals = sig
        return decision

    def apply(self, req: LeaveRequest, decision: LeaveDecision,
              actor_employee_id: Optional[str] = None) -> None:
        """Stamps the decision onto the request + emits notifications.
        Caller is responsible for db.commit()."""
        if decision.verdict == "AUTO_APPROVE":
            req.STATUS = "APPROVED"
            req.APPROVAL_RESOLVED_AT = datetime.utcnow()
            req.APPROVED_BY_EMAIL = self.AUTO_APPROVAL_ACTOR
            self._adjust_balance_for_approval(req)
            self._notify(req.VENDOR_ID,
                         title="Leave auto-approved",
                         message=decision.reason_summary)

        elif decision.verdict == "RECOMMEND_REJECT":
            # Don't auto-reject — let a human do it. Just attach the
            # reason via Notification so it's visible.
            self._notify(req.VENDOR_ID,
                         title="Leave request flagged for review",
                         message=decision.reason_summary)

        else:
            self._notify(req.VENDOR_ID,
                         title="Leave request awaiting decision",
                         message=decision.reason_summary)

    # ---- signal gathering -------------------------------------------

    def _gather_signals(self, emp: Employee, req: LeaveRequest) -> LeaveSignals:
        sig = LeaveSignals()
        sig.days = float(req.DAYS or 0)
        sig.leave_type_code = (req.LEAVE_TYPE or "CASUAL").upper()

        # 1. Balance
        if sig.leave_type_code in UNLIMITED_TYPES:
            sig.balance_ok = True
            sig.balance_available = float("inf")
            sig.balance_after = float("inf")
        else:
            bal = (self.db.query(LeaveBalance)
                   .filter(LeaveBalance.EMPLOYEE_ID == emp.ID,
                           LeaveBalance.YEAR == date.today().year).first())
            cols = BAL_COLS.get(sig.leave_type_code)
            if bal and cols:
                total = float(getattr(bal, cols[0]) or 0)
                used  = float(getattr(bal, cols[1]) or 0)
                carry = float(getattr(bal, cols[2]) or 0)
                avail = total + carry - used
                sig.balance_available = avail
                sig.balance_after = avail - sig.days
                sig.balance_ok = sig.balance_after >= DecisionPolicy.AUTO_APPROVE_MIN_BALANCE_BUFFER
            else:
                sig.balance_ok = False
                sig.balance_available = 0.0

        # 2. Holiday clash
        clashes = (self.db.query(HolidayCalendar)
                   .filter(HolidayCalendar.VENDOR_ID == emp.VENDOR_ID,
                           HolidayCalendar.HOLIDAY_DATE.between(req.START_DATE, req.END_DATE))
                   .all())
        sig.holiday_clash = len(clashes) > 0
        sig.holiday_dates = [h.HOLIDAY_DATE.isoformat() for h in clashes]

        # 3. Team availability
        if emp.DEPARTMENT_ID:
            team = (self.db.query(Employee)
                    .filter(Employee.VENDOR_ID == emp.VENDOR_ID,
                            Employee.DEPARTMENT_ID == emp.DEPARTMENT_ID,
                            Employee.STATUS == "ACTIVE").all())
            sig.team_size = len(team)
            team_ids = [t.ID for t in team if t.ID != emp.ID]
            if team_ids:
                on_leave = (self.db.query(LeaveRequest)
                            .filter(LeaveRequest.EMPLOYEE_ID.in_(team_ids),
                                    LeaveRequest.STATUS == "APPROVED",
                                    LeaveRequest.START_DATE <= req.END_DATE,
                                    LeaveRequest.END_DATE   >= req.START_DATE)
                            .count())
                sig.team_on_leave_same_day = on_leave
                if sig.team_size > 0:
                    sig.team_on_leave_pct = round(on_leave * 100.0 / sig.team_size, 1)

        # 4. Monthly CL quota
        if sig.leave_type_code == "CASUAL":
            month_start = req.START_DATE.replace(day=1)
            next_month  = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
            used = (self.db.query(sa_func.coalesce(sa_func.sum(LeaveRequest.DAYS), 0))
                    .filter(LeaveRequest.EMPLOYEE_ID == emp.ID,
                            LeaveRequest.LEAVE_TYPE == "CASUAL",
                            LeaveRequest.STATUS == "APPROVED",
                            LeaveRequest.START_DATE >= month_start,
                            LeaveRequest.START_DATE <  next_month).scalar() or 0)
            sig.cl_used_this_month = float(used)
            sig.cl_excess = (sig.cl_used_this_month + sig.days) > DecisionPolicy.CL_MONTHLY_QUOTA

        # 5. Pending tasks (best-effort)
        try:
            pending = (self.db.query(TaskAssignment)
                       .filter(TaskAssignment.EMPLOYEE_ID == emp.ID,
                               TaskAssignment.TASK_STATUS.in_(["PENDING", "IN_PROGRESS"]))
                       .count())
            sig.pending_tasks = pending
        except Exception:
            sig.pending_tasks = 0

        return sig

    # ---- decision engine --------------------------------------------

    def _decide(self, sig: LeaveSignals) -> LeaveDecision:
        blockers: List[str] = []
        warnings: List[str] = []

        if not sig.balance_ok:
            blockers.append(
                f"Insufficient balance (available {sig.balance_available:.1f}, "
                f"requested {sig.days})"
            )
        if sig.holiday_clash:
            blockers.append(
                f"Requested dates overlap company holiday(s): "
                f"{', '.join(sig.holiday_dates)}"
            )

        if (sig.team_size >= DecisionPolicy.SAME_DEPT_MIN_TEAM_SIZE
                and sig.team_on_leave_pct > DecisionPolicy.SAME_DEPT_MAX_ON_LEAVE_PCT):
            warnings.append(
                f"Team coverage thin: {sig.team_on_leave_same_day}/{sig.team_size} "
                f"({sig.team_on_leave_pct}%) of department already on leave"
            )
        if sig.cl_excess:
            warnings.append(
                f"Exceeds monthly CL quota ({sig.cl_used_this_month:.1f}/"
                f"{DecisionPolicy.CL_MONTHLY_QUOTA} already used this month)"
            )
        if sig.pending_tasks >= DecisionPolicy.PENDING_TASK_WARN:
            warnings.append(
                f"Employee has {sig.pending_tasks} pending tasks — confirm "
                "handover plan before approving"
            )

        if blockers:
            return LeaveDecision(
                verdict="RECOMMEND_REJECT", confidence=0.90,
                reason_summary="Blocked by policy: " + "; ".join(blockers),
                blockers=blockers, warnings=warnings,
            )

        eligible_for_auto = (
            sig.days <= DecisionPolicy.AUTO_APPROVE_MAX_DAYS
            and sig.balance_ok
            and not warnings
        )
        if eligible_for_auto:
            return LeaveDecision(
                verdict="AUTO_APPROVE", confidence=0.95,
                reason_summary=(
                    f"Auto-approved — {sig.days} day(s), balance OK "
                    f"({sig.balance_available:.1f} remaining), team coverage fine, "
                    "no policy breach."
                ),
            )

        if warnings:
            return LeaveDecision(
                verdict="NEEDS_HUMAN", confidence=0.70,
                reason_summary="Manual review needed — " + "; ".join(warnings),
                warnings=warnings,
            )

        return LeaveDecision(
            verdict="RECOMMEND_APPROVE", confidence=0.85,
            reason_summary=f"Recommended approve — {sig.days} day(s), no blockers.",
        )

    # ---- helpers ----------------------------------------------------

    def _adjust_balance_for_approval(self, req: LeaveRequest) -> None:
        leave_type = (req.LEAVE_TYPE or "CASUAL").upper()
        if leave_type in UNLIMITED_TYPES:
            return
        cols = BAL_COLS.get(leave_type)
        if not cols:
            return
        bal = (self.db.query(LeaveBalance)
               .filter(LeaveBalance.EMPLOYEE_ID == req.EMPLOYEE_ID,
                       LeaveBalance.YEAR == date.today().year).first())
        if not bal:
            return
        used_col = cols[1]
        setattr(bal, used_col, float(getattr(bal, used_col) or 0) + float(req.DAYS or 0))

    def _notify(self, vendor_id: int, title: str, message: str) -> None:
        self.db.add(Notification(
            TITLE=title,
            MESSAGE=(message or "")[:255],
            TYPE="LEAVE",
            VENDOR_ID=vendor_id,
        ))
