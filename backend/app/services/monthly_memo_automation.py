"""
Monthly memo automation — evaluates every ACTIVE employee for a given
month and issues WARNING or APPRECIATION memos based on the same rules
the HR summary view shows.

Rules (locked in with the user):
  WARNING  (any one triggers):
      • late_arrivals   >= 5
      • unpaid_absences >= 1
      • missed_checkouts >= 5

  APPRECIATION  (all must be true):
      • late_arrivals   == 0
      • unpaid_absences == 0
      • days_present    >= 1     (so no-work months don't get praise)

AI text
  When GEMINI_API_KEY is available, the memo subject + body are
  personalised by Gemini using the employee's own numbers. The prompt
  produces text that reads like a human wrote it (not "you had 5
  late-arrivals" but "over the past month you've been consistently
  arriving after 9:15, most notably on…"). If Gemini is down or the
  key is missing, we fall back to a solid template so memos ALWAYS
  land — automation never silently skips.

Idempotency
  Every memo carries AUTOMATION_KEY =
      AUTO-MONTH-<YYYY-MM>-<WARNING|APPRECIATION>-<employee_id>
  Re-running for the same month is a no-op.

Delivery
  Each memo insert is paired with a Notification row targeted at the
  employee, so the dashboard bell + optional voice alert fire without
  any extra plumbing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.models import (
    Employee,
    EmployeeMemo,
    Notification,
)
from app.services.monthly_attendance import (
    compute_monthly_summary,
    LATE_WARNING_THRESHOLD,
    UNPAID_ABSENCE_WARNING_THRESHOLD,
    MISSED_CHECKOUT_WARNING_THRESHOLD,
)


@dataclass
class MonthlyRunSummary:
    month: str
    evaluated: int = 0
    warnings_created: int = 0
    appreciations_created: int = 0
    skipped_already_issued: int = 0
    errors: List[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "month": self.month,
            "evaluated": self.evaluated,
            "warnings_created": self.warnings_created,
            "appreciations_created": self.appreciations_created,
            "skipped_already_issued": self.skipped_already_issued,
            "errors": self.errors,
        }


# ---------------------------------------------------------------------
# Memo numbering + idempotency keys
# ---------------------------------------------------------------------

def _next_memo_number(db: Session) -> str:
    """MEMO-YYYY-NNNN.  Matches the numbering the weekly automation
    already uses so both live in one continuous sequence."""
    year = datetime.utcnow().year
    prefix = f"MEMO-{year}-"
    count = (
        db.query(EmployeeMemo)
          .filter(EmployeeMemo.MEMO_NUMBER.like(f"{prefix}%"))
          .count()
    )
    return f"{prefix}{(count + 1):04d}"


def _monthly_key(year: int, month: int, memo_type: str, employee_id: str) -> str:
    return f"AUTO-MONTH-{year}-{month:02d}-{memo_type}-{employee_id}"


# ---------------------------------------------------------------------
# AI text generation — Gemini with graceful fallback
# ---------------------------------------------------------------------

_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "").strip()


def _fallback_warning_text(summary: dict) -> tuple[str, str, str]:
    """Solid template used when Gemini is unavailable or fails."""
    name = summary["name"]
    month_label = summary["month_label"]
    reasons = summary["memo_flags"]["warning_reasons"]
    reason_text = "; ".join(reasons) if reasons else "attendance policy exceeded"

    subject = f"Warning — attendance concerns for {month_label}"

    description = (
        f"Dear {name},\n\n"
        f"For {month_label}, our records show the following concerns "
        f"on your attendance:\n\n"
        + "\n".join(f"  • {r}" for r in reasons)
        + "\n\n"
        f"Detailed numbers for the month:\n"
        f"  • Days present         : {summary['days_present']} of {summary['working_days']} working days\n"
        f"  • Late arrivals        : {summary['late_arrivals']} (total {summary['total_late_minutes']} minutes late)\n"
        f"  • Unpaid absences      : {summary['unpaid_absences']}\n"
        f"  • Missed check-outs    : {summary['missed_checkouts']}\n\n"
        f"Please treat this memo as a formal warning. Sustained "
        f"attendance below our standard is grounds for further action. "
        f"If there are extenuating circumstances, raise a help desk "
        f"ticket or speak with your reporting manager.\n\n"
        f"— Bharath Vending Corporation, HR"
    )

    # Escalate severity when patterns are severe
    severity = "MEDIUM"
    if summary["unpaid_absences"] >= 3 or summary["late_arrivals"] >= 10:
        severity = "HIGH"

    return subject, description, severity


def _fallback_appreciation_text(summary: dict) -> tuple[str, str, str]:
    name = summary["name"]
    month_label = summary["month_label"]

    subject = f"Appreciation — flawless attendance in {month_label}"

    description = (
        f"Dear {name},\n\n"
        f"{month_label} closed with a spotless attendance record for you:\n\n"
        f"  • Days present         : {summary['days_present']} of {summary['working_days']} working days\n"
        f"  • Late arrivals        : 0\n"
        f"  • Unpaid absences      : 0\n"
        f"  • Overtime contributed : {summary['total_ot_hours']} hours\n\n"
        f"Consistency like this is what lets the team ship on time. "
        f"Thank you — please keep it going.\n\n"
        f"— Bharath Vending Corporation, HR"
    )

    return subject, description, "LOW"


def _gemini_generate(prompt: str, model_name: str = "gemini-2.5-flash") -> Optional[str]:
    """Return Gemini's response text, or None if anything at all fails.
    Keep this function bulletproof — memo automation must never crash
    because the AI is down."""
    if not _GEMINI_KEY:
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=_GEMINI_KEY)
        model = genai.GenerativeModel(model_name=model_name)
        resp = model.generate_content(prompt)
        text = (getattr(resp, "text", None) or "").strip()
        return text or None
    except Exception:
        return None


def _ai_warning_text(summary: dict) -> tuple[str, str, str]:
    """Warning memo authored by Gemini, personalised. Falls back to
    the template when Gemini is unavailable OR returns unusable text.
    """
    fallback = _fallback_warning_text(summary)

    prompt = f"""You are the HR manager at Bharath Vending Corporation (BVC24),
a small vending-machine company in India. Write a formal but humane
warning memo to an employee based on their monthly attendance record.

Rules:
- Address the employee by first name only (they're a colleague, not
  a stranger).
- Be direct about the numbers but not accusatory.
- End with an offer of support (help-desk ticket / manager
  conversation) if there are extenuating circumstances.
- Keep total length between 120 and 180 words.
- Sign off as "— BVC24 HR Team".
- Return TWO lines separated by "|||"  :
     LINE 1 = a subject line (max 90 characters)
     LINE 2 = the full memo body (plain text, no markdown, no
              greeting like "Sure!" — just the memo).

Employee record for {summary['month_label']}:
  Name              : {summary['name']}
  Employee code     : {summary['employee_code']}
  Working days      : {summary['working_days']}
  Days present      : {summary['days_present']}
  Late arrivals     : {summary['late_arrivals']}  (total {summary['total_late_minutes']} minutes late)
  Unpaid absences   : {summary['unpaid_absences']}
  Missed check-outs : {summary['missed_checkouts']}
  Reasons flagged   : {"; ".join(summary['memo_flags']['warning_reasons'])}
"""

    text = _gemini_generate(prompt)

    if not text or "|||" not in text:
        return fallback

    subject, _, body = text.partition("|||")
    subject = subject.strip().strip('"')[:200]
    body = body.strip()

    # Sanity: if Gemini returned junk (too short, refusal wording), fall
    # back so we never send a useless memo.
    if len(body) < 80 or len(subject) < 6:
        return fallback

    severity = "MEDIUM"
    if summary["unpaid_absences"] >= 3 or summary["late_arrivals"] >= 10:
        severity = "HIGH"

    return subject, body, severity


def _ai_appreciation_text(summary: dict) -> tuple[str, str, str]:
    fallback = _fallback_appreciation_text(summary)

    prompt = f"""You are the HR manager at Bharath Vending Corporation (BVC24).
Write a short, warm appreciation memo to an employee who had a
flawless attendance month.

Rules:
- Address the employee by first name only.
- Mention the specific numbers (days present, OT hours contributed).
- Keep it genuine, not formulaic — 80 to 140 words.
- Sign off as "— BVC24 HR Team".
- Return TWO lines separated by "|||":
     LINE 1 = a subject line (max 90 characters)
     LINE 2 = the full memo body (plain text, no markdown).

Employee record for {summary['month_label']}:
  Name              : {summary['name']}
  Employee code     : {summary['employee_code']}
  Working days      : {summary['working_days']}
  Days present      : {summary['days_present']}
  Late arrivals     : 0
  Unpaid absences   : 0
  Overtime hours    : {summary['total_ot_hours']}
"""

    text = _gemini_generate(prompt)

    if not text or "|||" not in text:
        return fallback

    subject, _, body = text.partition("|||")
    subject = subject.strip().strip('"')[:200]
    body = body.strip()

    if len(body) < 60 or len(subject) < 6:
        return fallback

    return subject, body, "LOW"


# ---------------------------------------------------------------------
# Memo + notification writer
# ---------------------------------------------------------------------

def _create_memo_and_notify(
    db: Session,
    emp: Employee,
    memo_type: str,      # "WARNING" or "APPRECIATION"
    subject: str,
    description: str,
    severity: str,
    year: int,
    month: int,
    issue_date: date,
) -> Optional[EmployeeMemo]:

    key = _monthly_key(year, month, memo_type, emp.ID)

    exists = (
        db.query(EmployeeMemo)
          .filter(EmployeeMemo.AUTOMATION_KEY == key)
          .first()
    )
    if exists:
        return None

    memo = EmployeeMemo(
        MEMO_NUMBER=_next_memo_number(db),
        EMPLOYEE_ID=emp.ID,
        MEMO_TYPE=memo_type,
        SUBJECT=subject,
        DESCRIPTION=description,
        SEVERITY=severity,
        STATUS="ACTIVE",
        ISSUED_BY="System (AI Monthly Automation)",
        ISSUE_DATE=issue_date,
        VENDOR_ID=emp.VENDOR_ID or 1,
        IS_AUTOMATED=1,
        AUTOMATION_KEY=key,
    )
    db.add(memo)
    db.flush()

    notif_title = (
        "New appreciation memo"
        if memo_type == "APPRECIATION"
        else "New warning memo"
    )
    notif_type = "SUCCESS" if memo_type == "APPRECIATION" else "WARNING"

    db.add(Notification(
        TITLE=notif_title,
        MESSAGE=subject,
        TYPE=notif_type,
        EMPLOYEE_ID=emp.ID,
        REF_TYPE="MEMO",
        REF_ID=memo.ID,
        VENDOR_ID=emp.VENDOR_ID or 1,
    ))

    return memo


# ---------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------

def run_monthly_evaluation(
    db: Session,
    year: int,
    month: int,
) -> MonthlyRunSummary:
    """Iterate all ACTIVE employees for the given calendar month,
    write memos where thresholds are met, skip idempotently."""

    result = MonthlyRunSummary(month=f"{year}-{month:02d}")

    # Use last day of month as the memo's ISSUE_DATE so the record
    # is anchored to the period it evaluates, not the day the cron
    # happens to run.
    from calendar import monthrange
    issue_date = date(year, month, monthrange(year, month)[1])

    employees = (
        db.query(Employee)
          .filter(Employee.STATUS == "ACTIVE")
          .all()
    )

    for emp in employees:

        try:
            summary = compute_monthly_summary(db, emp, year, month, include_days=False)
            result.evaluated += 1

            flags = summary["memo_flags"]

            if flags["will_get_warning"]:
                subject, body, severity = _ai_warning_text(summary)
                memo = _create_memo_and_notify(
                    db, emp, "WARNING", subject, body, severity,
                    year, month, issue_date,
                )
                if memo:
                    result.warnings_created += 1
                else:
                    result.skipped_already_issued += 1

            elif flags["will_get_appreciation"]:
                subject, body, severity = _ai_appreciation_text(summary)
                memo = _create_memo_and_notify(
                    db, emp, "APPRECIATION", subject, body, severity,
                    year, month, issue_date,
                )
                if memo:
                    result.appreciations_created += 1
                else:
                    result.skipped_already_issued += 1

            # Commit after each employee so one failure doesn't
            # block the rest.
            db.commit()

        except Exception as e:
            db.rollback()
            result.errors.append(
                f"{emp.EMPLOYEE_CODE or emp.ID}: {type(e).__name__}: {e}"
            )

    return result


# Thresholds re-exported for callers that want to display them in the UI
# (e.g. the HR summary tab's legend).
__all__ = [
    "run_monthly_evaluation",
    "MonthlyRunSummary",
    "LATE_WARNING_THRESHOLD",
    "UNPAID_ABSENCE_WARNING_THRESHOLD",
    "MISSED_CHECKOUT_WARNING_THRESHOLD",
]
