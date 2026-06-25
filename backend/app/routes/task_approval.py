"""
Authority-side endpoints for approving / rejecting proposed
task assignments. Designed to be opened from the email's
Approve / Reject buttons. Returns a friendly HTML page so the
recipient sees a confirmation instead of raw JSON.
"""

import os

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

from app.database.database import get_db

from app.models.models import (
    TaskAssignment,
    Employee,
    CustomerProject,
    Notification
)

from app.services.email_service import send_task_assignment_email


router = APIRouter()


APPROVAL_TTL_HOURS = 24


def _render_page(title, body, color="#2563eb"):
    """A minimal styled HTML response."""

    return HTMLResponse(f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{title} · Bharath ERP</title>
  <style>
    body {{
      font-family: Segoe UI, Arial, sans-serif;
      background: #f1f5f9;
      margin: 0;
      padding: 40px 20px;
      color: #0f172a;
    }}
    .card {{
      max-width: 480px;
      margin: 60px auto;
      background: white;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }}
    .header {{
      background: {color};
      color: white;
      padding: 18px 22px;
      font-weight: 700;
      letter-spacing: 0.5px;
      font-size: 14px;
    }}
    .body {{
      padding: 28px 24px;
      line-height: 1.6;
      font-size: 15px;
    }}
    .body h2 {{
      margin: 0 0 14px 0;
      font-size: 22px;
    }}
    .body p {{
      margin: 0 0 12px 0;
      color: #475569;
    }}
    .meta {{
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
      margin-top: 18px;
      font-size: 13px;
    }}
    .meta strong {{ color: #0f172a; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">{title}</div>
    <div class="body">{body}</div>
  </div>
</body>
</html>""")


def _find_pending_proposal(db: Session, token: str):
    """
    Returns (task, error_html or None). If token is invalid,
    expired, or already resolved, returns an error page.
    """

    if not token:

        return None, _render_page(
            "Invalid Link",
            "<h2>Missing token</h2>"
            "<p>The approval link is malformed. Please check "
            "the link in your email.</p>",
            color="#dc2626"
        )

    task = db.query(TaskAssignment).filter(
        TaskAssignment.APPROVAL_TOKEN == token
    ).first()

    if not task:

        return None, _render_page(
            "Invalid Link",
            "<h2>Token not found</h2>"
            "<p>This approval link doesn't match any pending "
            "proposal. It may have been removed.</p>",
            color="#dc2626"
        )

    # Already resolved?
    if task.APPROVAL_STATUS == "APPROVED":

        return None, _render_page(
            "Already Approved",
            "<h2>This task is already approved</h2>"
            "<p>Nothing to do — the task is in the employee's "
            "dashboard.</p>",
            color="#16a34a"
        )

    if task.APPROVAL_STATUS == "REJECTED":

        return None, _render_page(
            "Already Rejected",
            "<h2>This task was already rejected</h2>"
            "<p>No action will be taken.</p>",
            color="#64748b"
        )

    # Expired?
    if task.APPROVAL_STATUS == "EXPIRED" or (
        task.APPROVAL_REQUESTED_AT
        and datetime.utcnow() - task.APPROVAL_REQUESTED_AT
            > timedelta(hours=APPROVAL_TTL_HOURS)
    ):

        # Mark expired if it slipped through
        if task.APPROVAL_STATUS != "EXPIRED":

            task.APPROVAL_STATUS = "EXPIRED"

            task.APPROVAL_RESOLVED_AT = datetime.utcnow()

            db.commit()

        return None, _render_page(
            "Link Expired",
            "<h2>This approval link has expired</h2>"
            f"<p>The 24-hour window passed without action. "
            f"Re-run auto-assignment to propose this task again.</p>",
            color="#d97706"
        )

    if task.APPROVAL_STATUS != "PENDING_APPROVAL":

        return None, _render_page(
            "Unexpected State",
            f"<h2>Task is in an unexpected state</h2>"
            f"<p>Status: {task.APPROVAL_STATUS}. Contact admin.</p>",
            color="#dc2626"
        )

    return task, None


def _gather_details(db: Session, task: TaskAssignment):

    emp = db.query(Employee).filter(
        Employee.ID == task.EMPLOYEE_ID
    ).first()

    proj = None

    if task.PROJECT_ID:

        proj = db.query(CustomerProject).filter(
            CustomerProject.ID == task.PROJECT_ID
        ).first()

    return emp, proj


@router.get("/approve-task", response_class=HTMLResponse)
def approve_task(
    token: str = Query(""),
    db: Session = Depends(get_db)
):

    task, err = _find_pending_proposal(db, token)

    if err:

        return err

    task.APPROVAL_STATUS = "APPROVED"

    task.APPROVAL_RESOLVED_AT = datetime.utcnow()

    task.UPDATED_AT = datetime.utcnow()

    db.commit()

    emp, proj = _gather_details(db, task)

    project_name = proj.PROJECT_NAME if proj else "—"

    # In-app notification (visible to anyone with the bell)
    db.add(Notification(
        TITLE="Task approved",
        MESSAGE=(
            f"Task '{task.TASK_NAME}' approved for "
            f"{emp.NAME if emp else 'employee'} "
            f"({emp.EMPLOYEE_CODE if emp else '—'}) "
            f"on project '{project_name}'."
        ),
        TYPE="SUCCESS",
        IS_READ=0,
        CREATED_AT=datetime.utcnow(),
        VENDOR_ID=1
    ))

    db.commit()

    # ---- NOTIFY THE EMPLOYEE ----
    # Email goes to the assigned employee (if they have an
    # email on file); always succeeds gracefully even when
    # SMTP isn't configured.
    employee_email_ok = False

    employee_email_msg = "no email on file"

    if emp:

        employee_email_ok, employee_email_msg = (
            send_task_assignment_email(
                employee=emp,
                task_name=task.TASK_NAME,
                task_details=task.TASK_DETAILS,
                project_name=project_name,
                due_date=task.DUE_DATE,
                is_auto=True
            )
        )

    # Frontend login URL (same one the employee will use)
    frontend_url = (
        os.getenv("FRONTEND_URL", "").strip()
        or "http://localhost:5173"
    )

    login_url = f"{frontend_url}/login"

    employee_label = emp.NAME if emp else "the employee"

    employee_code = emp.EMPLOYEE_CODE if emp else "—"

    email_status = (
        f"📧 Email sent to {emp.EMAIL}"
        if (emp and employee_email_ok)
        else f"⚠️ Email not sent: {employee_email_msg}"
    ) if emp else ""

    body = f"""
        <h2>Approved</h2>
        <p>The task has been confirmed. The employee's
        dashboard now shows it as pending — they can click
        <b>Start</b> to begin work.</p>

        <div class="meta">
          <strong>Task:</strong> {task.TASK_NAME}<br>
          <strong>Assigned to:</strong>
          {employee_label} ({employee_code})<br>
          <strong>Project:</strong> {project_name}<br>
          <strong>Due:</strong>
          {task.DUE_DATE.isoformat() if task.DUE_DATE else 'n/a'}<br>
          <strong>{email_status}</strong>
        </div>

        <div style="text-align:center; margin-top:24px;">
          <a href="{login_url}"
             style="display:inline-block; padding:14px 26px;
                    background:#2563eb; color:white;
                    text-decoration:none; border-radius:8px;
                    font-weight:600; font-size:15px;">
            🔐 Open Employee Login →
          </a>
        </div>

        <p style="margin-top:18px; text-align:center;
                  font-size:12px; color:#94a3b8;">
          Auto-redirecting to the login page in 8 seconds…
        </p>

        <meta http-equiv="refresh"
              content="8;url={login_url}">
    """

    return _render_page(
        "Task Approved ✓",
        body,
        color="#16a34a"
    )


@router.get("/reject-task", response_class=HTMLResponse)
def reject_task(
    token: str = Query(""),
    db: Session = Depends(get_db)
):

    task, err = _find_pending_proposal(db, token)

    if err:

        return err

    task.APPROVAL_STATUS = "REJECTED"

    task.APPROVAL_RESOLVED_AT = datetime.utcnow()

    task.UPDATED_AT = datetime.utcnow()

    db.commit()

    emp, proj = _gather_details(db, task)

    project_name = proj.PROJECT_NAME if proj else "—"

    db.add(Notification(
        TITLE="Task rejected",
        MESSAGE=(
            f"Proposed task '{task.TASK_NAME}' for "
            f"{emp.NAME if emp else 'employee'} "
            f"({emp.EMPLOYEE_CODE if emp else '—'}) "
            f"was rejected."
        ),
        TYPE="WARNING",
        IS_READ=0,
        CREATED_AT=datetime.utcnow(),
        VENDOR_ID=1
    ))

    db.commit()

    return _render_page(
        "Task Rejected ✕",
        f"""
        <h2>Rejected</h2>
        <p>The proposed task has been rejected. It will not
        appear on the employee's dashboard.</p>

        <div class="meta">
          <strong>Task:</strong> {task.TASK_NAME}<br>
          <strong>Proposed for:</strong>
          {emp.NAME if emp else '—'}
          ({emp.EMPLOYEE_CODE if emp else '—'})<br>
          <strong>Project:</strong> {project_name}
        </div>

        <p style="margin-top:18px; font-size:13px; color:#64748b;">
          You can close this window. To assign this work
          differently, run auto-assignment again or pick an
          employee manually from the Projects page.
        </p>
        """,
        color="#dc2626"
    )


# =========================
# CLEANUP — mark expired
# =========================

@router.post("/task-proposals/cleanup-expired")
def cleanup_expired(
    db: Session = Depends(get_db)
):
    """
    Marks any PENDING_APPROVAL task older than 24h as EXPIRED.
    Call this on a schedule (cron job or manual button).
    """

    cutoff = datetime.utcnow() - timedelta(hours=APPROVAL_TTL_HOURS)

    rows = db.query(TaskAssignment).filter(
        TaskAssignment.APPROVAL_STATUS == "PENDING_APPROVAL",
        TaskAssignment.APPROVAL_REQUESTED_AT < cutoff
    ).all()

    for r in rows:

        r.APPROVAL_STATUS = "EXPIRED"

        r.APPROVAL_RESOLVED_AT = datetime.utcnow()

    db.commit()

    return {
        "message": f"Marked {len(rows)} proposal(s) as expired.",
        "expired_count": len(rows)
    }


# =========================
# LIST PENDING PROPOSALS (admin view)
# =========================

@router.get("/task-proposals/pending")
def list_pending(
    db: Session = Depends(get_db)
):
    """
    Returns all proposals currently awaiting approval.
    Useful for the admin to see what's outstanding.
    """

    rows = db.query(
        TaskAssignment,
        Employee.NAME,
        Employee.EMPLOYEE_CODE,
        CustomerProject.PROJECT_NAME
    ).outerjoin(
        Employee,
        TaskAssignment.EMPLOYEE_ID == Employee.ID
    ).outerjoin(
        CustomerProject,
        TaskAssignment.PROJECT_ID == CustomerProject.ID
    ).filter(
        TaskAssignment.APPROVAL_STATUS == "PENDING_APPROVAL"
    ).order_by(
        TaskAssignment.APPROVAL_REQUESTED_AT.desc()
    ).all()

    return [
        {
            "TASK_ID": ta.TASK_ID,
            "TASK_NAME": ta.TASK_NAME,
            "EMPLOYEE_NAME": emp_name,
            "EMPLOYEE_CODE": emp_code,
            "PROJECT_NAME": proj_name,
            "DUE_DATE": (
                ta.DUE_DATE.isoformat() if ta.DUE_DATE else None
            ),
            "REQUESTED_AT": (
                ta.APPROVAL_REQUESTED_AT.isoformat()
                if ta.APPROVAL_REQUESTED_AT else None
            ),
            "APPROVAL_TOKEN": ta.APPROVAL_TOKEN
        }
        for ta, emp_name, emp_code, proj_name in rows
    ]
