"""Voice leave assistant — chat + submit endpoints.

Two endpoints:

  POST /leave-ai-chat/message
      Body: { employee_id, message, language?, history? }
      → { reply, action, draft? }

  POST /leave-ai-chat/submit
      Body: { employee_id, draft }
      → { submitted: true, leave_request_id, md_email_sent }

The chat endpoint never mutates DB state. The submit endpoint creates a
LeaveRequest row (PENDING_APPROVAL) and emails the MD.

Deliberately open (no auth guard) because the employee portal at
/apply-leave already works with a URL-anchored employee_id — this
assistant is scoped to that same UX. If auth is later added to the
portal, gate both endpoints with the same dep.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Employee, LeaveRequest, Notification
from app.services.leave_ai_chat_service import (
    build_system_prompt,
    gather_employee_context,
    openrouter_chat,
)
from app.services.email_service import send_via_resend, send_via_vendor_smtp
from app.models.email_models import VendorEmailConfig


router = APIRouter()
logger = logging.getLogger("uvicorn.error")


def _resolve_employee(db: Session, ident: str) -> Optional[Employee]:
    """Accept either the UUID `Employee.ID` or the display
    `Employee.EMPLOYEE_CODE` (e.g. 'BVC008'). The frontend passes
    whichever value it has cached in localStorage — usually the code
    for portal logins, sometimes the UUID for admin-driven links."""

    if not ident:
        return None

    emp = db.query(Employee).filter(Employee.ID == ident).first()
    if emp:
        return emp

    return (
        db.query(Employee)
        .filter(Employee.EMPLOYEE_CODE == ident)
        .first()
    )


# ---------------------------------------------------------------------------
# Request / response models.
# ---------------------------------------------------------------------------

class ChatTurn(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str


class ChatMessageIn(BaseModel):
    employee_id: str
    message: str
    language: Optional[str] = "auto"        # 'auto' | 'en' | 'ta' | 'thanglish'
    history: List[ChatTurn] = Field(default_factory=list)


class LeaveDraft(BaseModel):
    leave_type: str                          # CASUAL | LOP  (BVC24 has no EL/SL/Maternity)
    start_date: str                          # YYYY-MM-DD
    end_date: str
    half_day: bool = False
    reason: str
    days: Optional[float] = None
    task_commitments: List[Dict[str, Any]] = Field(default_factory=list)


class SubmitIn(BaseModel):
    employee_id: str
    draft: LeaveDraft


# ---------------------------------------------------------------------------
# Chat endpoint.
# ---------------------------------------------------------------------------

@router.post("/message")
def chat_message(payload: ChatMessageIn, db: Session = Depends(get_db)) -> Dict[str, Any]:

    emp = _resolve_employee(db, payload.employee_id)

    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    ctx = gather_employee_context(db, emp.ID)
    system_prompt = build_system_prompt(ctx, language_hint=payload.language or "auto")

    messages: List[Dict[str, str]] = []

    # Cap history at last 20 turns so we don't send an ever-growing
    # transcript to the model.
    for turn in payload.history[-20:]:
        role = turn.role if turn.role in ("user", "assistant") else "user"
        messages.append({"role": role, "content": turn.content})

    user_text = payload.message.strip()
    messages.append({"role": "user", "content": user_text})

    result = openrouter_chat(system_prompt, messages)

    # Persist BOTH turns so the admin history module can replay the
    # exact conversation. Best-effort — a DB write failure must not
    # break the chat.
    try:
        from app.models.leave_chat_models import LeaveChatMessage
        db.add(LeaveChatMessage(
            EMPLOYEE_ID=emp.ID,
            ROLE="user",
            CONTENT=user_text,
            LANGUAGE=(payload.language or "auto"),
            VENDOR_ID=emp.VENDOR_ID,
        ))
        db.add(LeaveChatMessage(
            EMPLOYEE_ID=emp.ID,
            ROLE="assistant",
            CONTENT=(result.get("reply") or "")[:8001],
            LANGUAGE=(payload.language or "auto"),
            ACTION=result.get("action") or "ANSWER_ONLY",
            VENDOR_ID=emp.VENDOR_ID,
        ))
        db.commit()
    except Exception:
        db.rollback()

    return result


# ---------------------------------------------------------------------------
# Admin history endpoints
# ---------------------------------------------------------------------------

@router.get("/history/employees")
def history_employees(db: Session = Depends(get_db)) -> List[Dict[str, Any]]:
    """List of employees who have ever chatted with the assistant,
    with per-employee message count + last activity timestamp. Used
    to render the employee sidebar on the admin Chat History page."""

    from sqlalchemy import func
    from app.models.leave_chat_models import LeaveChatMessage

    rows = (
        db.query(
            LeaveChatMessage.EMPLOYEE_ID,
            func.count(LeaveChatMessage.ID).label("message_count"),
            func.max(LeaveChatMessage.CREATED_AT).label("last_activity"),
        )
        .group_by(LeaveChatMessage.EMPLOYEE_ID)
        .all()
    )

    if not rows:
        return []

    emp_ids = [r.EMPLOYEE_ID for r in rows]
    employees = (
        db.query(Employee).filter(Employee.ID.in_(emp_ids)).all()
    )
    by_id = {e.ID: e for e in employees}

    out: List[Dict[str, Any]] = []
    for r in rows:
        emp = by_id.get(r.EMPLOYEE_ID)
        if not emp:
            continue
        out.append({
            "employee_id":   emp.ID,
            "employee_code": emp.EMPLOYEE_CODE,
            "employee_name": emp.NAME or "",
            "message_count": int(r.message_count or 0),
            "last_activity": r.last_activity.isoformat() if r.last_activity else None,
        })

    # Most recently active first.
    out.sort(key=lambda x: x["last_activity"] or "", reverse=True)
    return out


@router.get("/history/{employee_id}")
def history_for_employee(
    employee_id: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Full chat transcript for one employee. Returns messages in
    chronological order (oldest first) so the admin can read the
    conversation the way it happened."""

    from app.models.leave_chat_models import LeaveChatMessage

    emp = _resolve_employee(db, employee_id)

    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    rows = (
        db.query(LeaveChatMessage)
        .filter(LeaveChatMessage.EMPLOYEE_ID == emp.ID)
        .order_by(LeaveChatMessage.CREATED_AT.asc())
        .all()
    )

    return {
        "employee": {
            "id":   emp.ID,
            "code": emp.EMPLOYEE_CODE,
            "name": emp.NAME or "",
        },
        "message_count": len(rows),
        "messages": [
            {
                "id":         m.ID,
                "role":       m.ROLE,
                "content":    m.CONTENT,
                "language":   m.LANGUAGE,
                "action":     m.ACTION,
                "created_at": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
            }
            for m in rows
        ],
    }


@router.delete("/history/{employee_id}")
def delete_history_for_employee(
    employee_id: str,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Admin can clear an employee's chat history (e.g. GDPR request
    or accidental sensitive data). Requires the row to exist."""

    from app.models.leave_chat_models import LeaveChatMessage

    emp = _resolve_employee(db, employee_id)

    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    n = (
        db.query(LeaveChatMessage)
        .filter(LeaveChatMessage.EMPLOYEE_ID == emp.ID)
        .delete(synchronize_session=False)
    )
    db.commit()

    return {"deleted": n, "employee_id": emp.ID}


# ---------------------------------------------------------------------------
# Submit endpoint — called ONLY after the employee has verbally confirmed.
# ---------------------------------------------------------------------------

# BVC24 ERP has ONLY two leave types: CASUAL (paid, 1/month cap) and LOP
# (Loss of Pay — anything beyond the CL cap or annual quota).
VALID_LEAVE_TYPES = {"CASUAL", "LOP"}


@router.post("/submit")
def submit_from_ai(payload: SubmitIn, db: Session = Depends(get_db)) -> Dict[str, Any]:

    emp = _resolve_employee(db, payload.employee_id)

    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    draft = payload.draft

    leave_type = (draft.leave_type or "").upper().strip()

    if leave_type not in VALID_LEAVE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported leave_type '{draft.leave_type}'.",
        )

    try:
        start = date.fromisoformat(draft.start_date)
        end = date.fromisoformat(draft.end_date)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="start_date and end_date must be YYYY-MM-DD.",
        )

    if start > end:
        raise HTTPException(
            status_code=400,
            detail="start_date must be on or before end_date.",
        )

    if draft.half_day and start != end:
        raise HTTPException(
            status_code=400,
            detail="Half-day leave must have start_date == end_date.",
        )

    days = draft.days
    if days is None:
        days = (end - start).days + 1
        if draft.half_day:
            days = 0.5

    # NOTE: the leave_request table has no HALF_DAY column.
    # Half-day leave is expressed by DAYS=0.5 (matches the existing
    # /leave/apply behaviour and the balance-quota accounting).
    if draft.half_day:
        days = 0.5

    # Generate a unique approval token so the MD can approve/reject
    # directly from the email — same mechanism the existing
    # /leave/decide/{token} route uses.
    approval_token = secrets.token_urlsafe(32)

    lr = LeaveRequest(
        EMPLOYEE_ID=emp.ID,
        LEAVE_TYPE=leave_type,
        START_DATE=start,
        END_DATE=end,
        DAYS=days,
        REASON=(draft.reason or "").strip()[:500],
        STATUS="PENDING_APPROVAL",
        VENDOR_ID=emp.VENDOR_ID,
        APPROVAL_TOKEN=approval_token,
        APPROVAL_REQUESTED_AT=datetime.now(),
        CREATED_AT=datetime.now(),
    )

    # TASK_COMMITMENTS is a Text column — serialise the list.
    if draft.task_commitments:
        try:
            import json as _json
            lr.TASK_COMMITMENTS = _json.dumps(draft.task_commitments)
        except Exception:
            pass

    db.add(lr)
    db.commit()
    db.refresh(lr)

    # ------------------------------------------------------------------
    # Notify admins in-app so the bell + toast fire on the admin dashboard.
    # ------------------------------------------------------------------
    try:
        db.add(Notification(
            EMPLOYEE_ID=None,
            TITLE="New leave request (via AI assistant)",
            MESSAGE=(
                f"{emp.NAME} ({emp.EMPLOYEE_CODE}) submitted a {leave_type} "
                f"leave request via the voice assistant: "
                f"{start.isoformat()} → {end.isoformat()}"
                f"{' (half day)' if draft.half_day else ''}. "
                f"Reason: {(draft.reason or '').strip()[:200]}"
            ),
            TYPE="LEAVE_REQUEST",
            IS_READ=0,
            VENDOR_ID=emp.VENDOR_ID,
            CREATED_AT=datetime.now(),
        ))
        db.commit()
    except Exception:
        db.rollback()

    # ------------------------------------------------------------------
    # Email the MD.
    # ------------------------------------------------------------------
    md_email_sent = False
    try:
        md_email = os.getenv("APPROVER_EMAIL", "support@bvc24.com").strip()
        html_body = _render_md_email_html(emp, draft, days, approval_token)
        subject = (
            f"[Leave Request via AI] {emp.NAME} ({emp.EMPLOYEE_CODE}) — "
            f"{leave_type} × {days}d"
        )

        active_cfgs = db.query(VendorEmailConfig).filter(
            VendorEmailConfig.VENDOR_ID == emp.VENDOR_ID,
            VendorEmailConfig.IS_ACTIVE == True,
        ).all()

        for cfg in active_cfgs:
            ok, _err, _detail = send_via_vendor_smtp(cfg, md_email, subject, html_body)
            if ok:
                md_email_sent = True
                break

        if not md_email_sent:
            try:
                send_via_resend(subject=subject, body_html=html_body, recipient=md_email)
                md_email_sent = True
            except Exception:
                md_email_sent = False
    except Exception as e:
        logger.warning("[leave-ai-submit] MD email failed: %s: %s", type(e).__name__, e)

    logger.info(
        "[leave-ai-submit] %s (%s) → %s x %s days [md_email_sent=%s]",
        emp.EMPLOYEE_CODE, emp.NAME, leave_type, days, md_email_sent,
    )

    return {
        "submitted":        True,
        "leave_request_id": lr.ID,
        "leave_type":       leave_type,
        "start_date":       start.isoformat(),
        "end_date":         end.isoformat(),
        "days":             days,
        "md_email_sent":    md_email_sent,
    }


def _backend_base_url() -> str:
    """Backend origin the approve/reject links point at. Preference:
    BACKEND_URL env → derive from FRONTEND_URL by swapping the port →
    hard-coded LAN default."""

    override = (os.getenv("BACKEND_URL") or "").strip().rstrip("/")
    if override:
        return override

    frontend = (os.getenv("FRONTEND_URL") or "").strip().rstrip("/")
    if frontend:
        # e.g. http://192.168.1.10:4173 → http://192.168.1.10:8001
        if ":4173" in frontend:
            return frontend.replace(":4173", ":8001")
        if ":3000" in frontend:
            return frontend.replace(":3000", ":8001")
        # If FRONTEND_URL has no port, append backend default port.
        if "://" in frontend and frontend.count(":") == 1:
            return frontend + ":8001"

    return "http://192.168.1.10:8001"


def _render_md_email_html(
    emp: Employee,
    draft: LeaveDraft,
    days: float,
    approval_token: str,
) -> str:

    task_rows = ""
    if draft.task_commitments:
        rows = "".join(
            f"<tr><td style='padding:4px 8px;border:1px solid #e5e7eb'>{tc.get('title','—')}</td>"
            f"<td style='padding:4px 8px;border:1px solid #e5e7eb'>{tc.get('promised_completion_date','—')}</td></tr>"
            for tc in draft.task_commitments
        )
        task_rows = f"""
        <h4 style="margin:16px 0 8px 0;">Task commitments</h4>
        <table style="border-collapse:collapse;width:100%;font-size:13px;">
          <thead><tr>
            <th style="text-align:left;padding:4px 8px;border:1px solid #e5e7eb;background:#f9fafb;">Task</th>
            <th style="text-align:left;padding:4px 8px;border:1px solid #e5e7eb;background:#f9fafb;">Promised by</th>
          </tr></thead>
          <tbody>{rows}</tbody>
        </table>
        """

    base = _backend_base_url()
    approve_url = f"{base}/leave/decide/{approval_token}?action=approve"
    reject_url  = f"{base}/leave/decide/{approval_token}?action=reject"

    return f"""<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
  <div style="border-left:4px solid #dc2626;padding:12px 16px;background:#fef2f2;border-radius:6px;margin-bottom:16px;">
    <strong>Submitted via BVC24 Voice Leave Assistant</strong>
  </div>

  <h2 style="margin:0 0 8px 0;color:#dc2626;">Leave request</h2>
  <p style="margin:0 0 16px 0;color:#6b7280;">
    From <strong>{emp.NAME}</strong> ({emp.EMPLOYEE_CODE})
  </p>

  <table style="border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Type</td><td>{draft.leave_type}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Start</td><td>{draft.start_date}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">End</td><td>{draft.end_date}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Days</td><td>{days}{' (half-day)' if draft.half_day else ''}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top;">Reason</td><td>{(draft.reason or '').strip()}</td></tr>
  </table>

  {task_rows}

  <div style="margin:28px 0 12px 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;text-align:center;">
    <p style="margin:0 0 14px 0;font-size:14px;color:#374151;">
      Approve or reject this request in one click:
    </p>
    <table role="presentation" style="margin:0 auto;border-collapse:separate;border-spacing:8px;">
      <tr>
        <td>
          <a href="{approve_url}"
             style="display:inline-block;padding:12px 28px;background:#16a34a;color:#ffffff;
                    text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;
                    box-shadow:0 2px 4px rgba(22,163,74,0.3);">
            ✓ Approve Leave
          </a>
        </td>
        <td>
          <a href="{reject_url}"
             style="display:inline-block;padding:12px 28px;background:#dc2626;color:#ffffff;
                    text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;
                    box-shadow:0 2px 4px rgba(220,38,38,0.3);">
            ✗ Reject Leave
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:14px 0 0 0;font-size:11px;color:#9ca3af;">
      Clicking either button decides the request instantly — the employee is
      notified and the ERP admin dashboard updates.
    </p>
  </div>

  <p style="margin-top:24px;font-size:12px;color:#9ca3af;">
    You can also review this in the ERP under <strong>Admin → Approval Center</strong>
    or <strong>Admin → Leave Management</strong>.
  </p>
</body></html>
"""
