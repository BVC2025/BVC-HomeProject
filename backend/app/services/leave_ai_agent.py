"""
AI Leave Agent — Phase 4.

Read-only helper that gathers the data MD needs to decide on a leave
request, then asks Gemini for a short recommendation.

Design contract:
- AI NEVER approves or rejects. It returns a `verdict` string that
  is guidance only. `POST /leave/apply` always sets STATUS=
  PENDING_APPROVAL; MD remains the final decision maker.
- Read-only. Nothing here writes to the DB.
- Degrades gracefully. If Gemini isn't configured (missing / invalid
  GEMINI_API_KEY), the pre-check still returns balance + history +
  tasks — the `ai_recommendation` field is None with a reason string.

Callers: `POST /leave/pre-check` and the frontend ApplyLeave form.
"""

from __future__ import annotations

import json
import logging
from calendar import monthrange
from datetime import date, timedelta
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Attendance,
    Employee,
    LeaveBalance,
    LeaveRequest,
    TaskAssignment,
)


log = logging.getLogger("leave_ai_agent")


# =====================================================================
# Data-gather helpers
# =====================================================================

def _leave_balance_summary(db: Session, employee_id: str) -> Dict[str, float]:
    """Remaining CL/SL/EL for the current year. Zeros if no policy row."""
    year = date.today().year
    bal = (
        db.query(LeaveBalance)
          .filter(LeaveBalance.EMPLOYEE_ID == employee_id)
          .filter(LeaveBalance.YEAR == year)
          .first()
    )
    if not bal:
        return {
            "casual_total": 12.0, "casual_used": 0.0, "casual_remaining": 12.0,
            "sick_total": 12.0,   "sick_used": 0.0,   "sick_remaining": 12.0,
            "earned_total": 15.0, "earned_used": 0.0, "earned_remaining": 15.0,
        }
    return {
        "casual_total":     float(bal.CASUAL_TOTAL or 0),
        "casual_used":      float(bal.CASUAL_USED or 0),
        "casual_remaining": max(0.0, float(bal.CASUAL_TOTAL or 0) - float(bal.CASUAL_USED or 0)),
        "sick_total":       float(bal.SICK_TOTAL or 0),
        "sick_used":        float(bal.SICK_USED or 0),
        "sick_remaining":   max(0.0, float(bal.SICK_TOTAL or 0) - float(bal.SICK_USED or 0)),
        "earned_total":     float(bal.EARNED_TOTAL or 0),
        "earned_used":      float(bal.EARNED_USED or 0),
        "earned_remaining": max(0.0, float(bal.EARNED_TOTAL or 0) - float(bal.EARNED_USED or 0)),
    }


def _recent_leave_history(db: Session, employee_id: str, months_back: int = 3) -> List[dict]:
    """Last N months of approved/pending leave for this employee."""
    today = date.today()
    start = date(today.year, today.month, 1)
    for _ in range(months_back):
        prev_year, prev_month = (start.year, start.month - 1) if start.month > 1 else (start.year - 1, 12)
        start = date(prev_year, prev_month, 1)

    rows = (
        db.query(LeaveRequest)
          .filter(LeaveRequest.EMPLOYEE_ID == employee_id)
          .filter(LeaveRequest.START_DATE >= start)
          .filter(LeaveRequest.STATUS.in_(["APPROVED", "PENDING_APPROVAL"]))
          .order_by(LeaveRequest.START_DATE.desc())
          .all()
    )
    return [
        {
            "leave_type": r.LEAVE_TYPE,
            "start_date": r.START_DATE.isoformat() if r.START_DATE else None,
            "end_date":   r.END_DATE.isoformat()   if r.END_DATE   else None,
            "days":       float(r.DAYS or 0),
            "status":     r.STATUS,
            "reason":     (r.REASON or "")[:120],
        }
        for r in rows
    ]


def _monthly_cl_status(db: Session, employee_id: str, ref_date: date) -> dict:
    """Whether the employee has already booked a Casual Leave in the
    calendar month of `ref_date`. Used by the pre-check response so
    the frontend can block a second CL before it even hits the server.
    """
    first_of_month = date(ref_date.year, ref_date.month, 1)
    if ref_date.month == 12:
        first_of_next = date(ref_date.year + 1, 1, 1)
    else:
        first_of_next = date(ref_date.year, ref_date.month + 1, 1)

    existing = (
        db.query(LeaveRequest)
          .filter(LeaveRequest.EMPLOYEE_ID == employee_id)
          .filter(LeaveRequest.LEAVE_TYPE == "CASUAL")
          .filter(LeaveRequest.STATUS.in_(["PENDING_APPROVAL", "APPROVED"]))
          .filter(LeaveRequest.START_DATE >= first_of_month)
          .filter(LeaveRequest.START_DATE <  first_of_next)
          .order_by(LeaveRequest.START_DATE.asc())
          .first()
    )
    return {
        "month_label": first_of_month.strftime("%B %Y"),
        "cap_per_month": 1,
        "already_booked": existing is not None,
        "existing": (
            {
                "id":         existing.ID,
                "start_date": existing.START_DATE.isoformat(),
                "end_date":   existing.END_DATE.isoformat(),
                "days":       float(existing.DAYS or 0),
                "status":     existing.STATUS,
                "reason":     (existing.REASON or "")[:200],
            } if existing else None
        ),
    }


def _attendance_pattern(db: Session, employee_id: str, days_back: int = 90) -> dict:
    """Late-arrival + absence counts over the past N days."""
    since = date.today() - timedelta(days=days_back)
    rows = (
        db.query(Attendance)
          .filter(Attendance.EMPLOYEE_ID == employee_id)
          .filter(Attendance.DATE >= since)
          .all()
    )
    late_count = 0
    absent_count = 0
    present_count = 0
    for r in rows:
        st = (r.STATUS or "").upper()
        if st == "LATE":
            late_count += 1
            present_count += 1
        elif st in ("PRESENT", "EARLY_EXIT", "HALF_DAY"):
            present_count += 1
        elif st == "ABSENT":
            absent_count += 1
    return {
        "window_days":   days_back,
        "present_days":  present_count,
        "late_days":     late_count,
        "absent_days":   absent_count,
    }


def _pending_tasks(
    db: Session,
    employee_id: str,
    start_date: date,
    end_date: date,
) -> List[dict]:
    """Tasks the employee still has open that touch the leave range.

    Returns tasks where TASK_STATUS is not COMPLETED/DONE AND either:
      - DUE_DATE falls inside the leave range (blocking), OR
      - DUE_DATE is null but the task is still open (advisory)

    Each row is flagged with urgency:
      HIGH   — due inside the leave window
      MEDIUM — due within 7 days after the leave ends
      LOW    — no due date, still open
    """
    open_statuses_exclude = {"COMPLETED", "DONE", "CANCELLED"}
    tasks = (
        db.query(TaskAssignment)
          .filter(TaskAssignment.EMPLOYEE_ID == employee_id)
          .filter(~TaskAssignment.TASK_STATUS.in_(open_statuses_exclude))
          .all()
    )
    out: List[dict] = []
    grace_end = end_date + timedelta(days=7)
    for t in tasks:
        due = t.DUE_DATE
        if due is None:
            urgency = "LOW"
        elif start_date <= due <= end_date:
            urgency = "HIGH"
        elif end_date < due <= grace_end:
            urgency = "MEDIUM"
        elif due < start_date:
            # Already overdue at start of leave — highest urgency.
            urgency = "HIGH"
        else:
            # Due comfortably after grace_end. Don't include — not
            # blocking for this leave.
            continue
        out.append({
            "task_id":     t.TASK_ID,
            "task_name":   t.TASK_NAME or f"Task {t.TASK_ID}",
            "task_status": t.TASK_STATUS,
            "assigned_date": t.ASSIGNED_DATE.isoformat() if t.ASSIGNED_DATE else None,
            "due_date":    due.isoformat() if due else None,
            "urgency":     urgency,
        })
    # HIGH first, then MEDIUM, then LOW
    order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    out.sort(key=lambda r: (order.get(r["urgency"], 3), r["due_date"] or ""))
    return out


# =====================================================================
# Gemini prompt
# =====================================================================

_PROMPT = """You are the HR Leave Assistant for Bharath Vending Corporation.

An employee has requested leave. Your job is to give a short
recommendation to the Managing Director in ONE JSON object. You do
NOT approve or reject — the MD is the final decision maker.

Return STRICT JSON:
{
  "verdict": "APPROVE" | "APPROVE_WITH_CAUTION" | "NEEDS_MD_REVIEW",
  "headline": "<one sentence, max 140 chars>",
  "reasons": ["<short bullet>", "..."]
}

Guidelines:
- APPROVE: balance is comfortable, no HIGH-urgency pending tasks,
  no unusual attendance pattern (< 3 late days in 90d, no abuse).
- APPROVE_WITH_CAUTION: minor concerns (1-2 late days, MEDIUM-urgency
  tasks, or leave right after another leave). Mention the concern
  in reasons.
- NEEDS_MD_REVIEW: real red flags — HIGH-urgency task overlaps the
  leave range, balance already 0, or heavy late/absent history.
- Do NOT invent facts. Refer only to the DATA below.
- Do NOT use markdown or code fences. Return the JSON object only.

DATA (JSON):
{payload}
"""


def _ai_recommend(payload: dict) -> Optional[dict]:
    """Call Gemini and parse the JSON verdict. Returns None on any
    failure — caller falls back to a neutral 'NEEDS_MD_REVIEW'."""
    try:
        from app.hrms_ai.gemini_client import chat, is_configured
    except Exception as exc:
        log.warning("leave_ai_agent: cannot import gemini_client — %s", exc)
        return None
    if not is_configured():
        return None
    try:
        prompt = _PROMPT.replace("{payload}", json.dumps(payload, default=str))
        raw = chat(
            messages=[{"role": "user", "parts": [prompt]}],
            temperature=0.2,
        )
    except Exception as exc:
        log.warning("leave_ai_agent: gemini call failed — %s", exc)
        return None
    if not raw:
        return None
    # Strip stray fences the model sometimes adds despite instructions
    txt = raw.strip()
    if txt.startswith("```"):
        txt = txt.split("```", 2)[-1].strip()
        if txt.lower().startswith("json"):
            txt = txt[4:].strip()
    try:
        obj = json.loads(txt)
    except Exception:
        log.warning("leave_ai_agent: could not parse Gemini JSON — %s", raw[:200])
        return None
    if not isinstance(obj, dict) or "verdict" not in obj:
        return None
    return {
        "verdict":  str(obj.get("verdict") or "NEEDS_MD_REVIEW").upper(),
        "headline": str(obj.get("headline") or "")[:200],
        "reasons":  [str(r)[:200] for r in (obj.get("reasons") or [])][:6],
    }


# =====================================================================
# Public entry point
# =====================================================================

def run_pre_check(
    db: Session,
    employee: Employee,
    *,
    leave_type: str,
    start_date: date,
    end_date: date,
    days: float,
    reason: Optional[str] = None,
) -> dict:
    """Gather the full leave-decision context + AI recommendation.

    This function is READ-ONLY — never writes to the DB. Caller
    (POST /leave/pre-check) returns the dict verbatim.
    """
    balance    = _leave_balance_summary(db, employee.ID)
    history    = _recent_leave_history(db, employee.ID)
    attendance = _attendance_pattern(db, employee.ID)
    tasks      = _pending_tasks(db, employee.ID, start_date, end_date)
    monthly_cl = _monthly_cl_status(db, employee.ID, start_date)

    # HR policy blockers surfaced BEFORE the AI recommendation so the
    # frontend can render them prominently and gate the Submit button.
    blocking_conflicts: List[dict] = []
    if (leave_type or "").upper() == "CASUAL" and monthly_cl["already_booked"]:
        ex = monthly_cl["existing"]
        blocking_conflicts.append({
            "kind":  "MONTHLY_CL_CAP",
            "message": (
                f"You've already booked your Casual Leave for "
                f"{monthly_cl['month_label']} "
                f"({ex['start_date']} → {ex['end_date']}, {ex['status']}). "
                f"Only 1 CL is allowed per calendar month."
            ),
            "existing": ex,
        })

    # Structured facts fed to the LLM.
    payload_for_ai = {
        "employee": {
            "name":            employee.NAME,
            "employee_code":   employee.EMPLOYEE_CODE,
            "designation_id":  employee.DESIGNATION_ID,
            "department_id":   employee.DEPARTMENT_ID,
        },
        "request": {
            "leave_type":  leave_type,
            "start_date":  start_date.isoformat(),
            "end_date":    end_date.isoformat(),
            "days":        float(days),
            "reason":      (reason or "")[:300],
        },
        "leave_balance":       balance,
        "recent_leave_history": history,
        "attendance_pattern":   attendance,
        "pending_tasks":        tasks,
    }

    ai = _ai_recommend(payload_for_ai)
    if ai is None:
        ai_recommendation = {
            "verdict":  "NEEDS_MD_REVIEW",
            "headline": "AI unavailable — MD to review manually.",
            "reasons":  [],
            "generated_by": "fallback",
        }
    else:
        ai["generated_by"] = "gemini"
        ai_recommendation = ai

    return {
        "employee_id":         employee.ID,
        "leave_type":          leave_type,
        "start_date":          start_date.isoformat(),
        "end_date":            end_date.isoformat(),
        "days":                float(days),
        "leave_balance":       balance,
        "recent_leave_history": history,
        "attendance_pattern":   attendance,
        "pending_tasks":        tasks,
        "monthly_cl_status":    monthly_cl,
        "blocking_conflicts":   blocking_conflicts,
        "requires_task_commitments": any(t["urgency"] in ("HIGH", "MEDIUM") for t in tasks),
        "ai_recommendation":    ai_recommendation,
    }
