"""
Sends a "task proposal awaiting your approval" notification
to the configured authority (admin). Today: email. Tomorrow:
plug in SMS / WhatsApp by setting the relevant env vars.

The same function is called from /create-project, the backfill
endpoint, and the manual /task-assignment route when AUTO_ASSIGN
is on. It also generates and stores the approval token.
"""

import os
import uuid
import json
import urllib.request
import urllib.error

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.models import (
    Department,
    Employee
)

from app.services.email_service import (
    send_alert_email,
    is_smtp_configured
)


def _env_authority():
    """Fallback authority from .env."""

    return {
        "phone": os.getenv("APPROVER_PHONE", "").strip(),
        "email": (
            os.getenv("APPROVER_EMAIL", "").strip()
            or os.getenv("ADMIN_EMAIL", "").strip()
        ),
        "name": os.getenv("APPROVER_NAME", "Admin").strip(),
        "source": "env"
    }


def get_authority_contact(db: Session = None, department_id=None):
    """
    Returns the contact info for whoever should approve.

    Lookup order:
      1. Department.HEAD_EMPLOYEE_ID -> Employee
         (the "supervisor" of that department)
      2. .env APPROVER_EMAIL / APPROVER_PHONE
         (the fallback when no department head is set)
    """

    if db is not None and department_id is not None:

        dept = db.query(Department).filter(
            Department.ID == department_id
        ).first()

        if dept and dept.HEAD_EMPLOYEE_ID:

            head = db.query(Employee).filter(
                Employee.ID == dept.HEAD_EMPLOYEE_ID
            ).first()

            if head and (head.EMAIL or head.PHONE):

                return {
                    "phone": (head.PHONE or "").strip(),
                    "email": (head.EMAIL or "").strip(),
                    "name": head.NAME or "Department Head",
                    "source": f"dept_head:{dept.NAME}"
                }

    return _env_authority()


def generate_approval_token() -> str:

    return uuid.uuid4().hex + uuid.uuid4().hex[:8]
    # 40-char unguessable token


def build_approval_email_html(
    authority_name,
    employee_name,
    employee_code,
    department_name,
    task_name,
    task_details,
    project_name,
    prior_workload,
    due_date,
    approve_url,
    reject_url,
    expires_at
):

    due_text = (
        due_date.isoformat()
        if hasattr(due_date, "isoformat") else (due_date or "n/a")
    )

    expires_text = (
        expires_at.strftime("%d %b %Y, %I:%M %p")
        if expires_at else "24 hours"
    )

    project_row = (
        f"""
        <tr>
          <td style="padding:6px 0; color:#64748b; font-size:13px;">Project</td>
          <td style="padding:6px 0; font-weight:600;">{project_name}</td>
        </tr>
        """
        if project_name else ""
    )

    dept_row = (
        f"""
        <tr>
          <td style="padding:6px 0; color:#64748b; font-size:13px;">Department</td>
          <td style="padding:6px 0; font-weight:600;">{department_name}</td>
        </tr>
        """
        if department_name else ""
    )

    return f"""
    <!doctype html>
    <html>
      <body style="font-family: Segoe UI, Arial, sans-serif; background:#f1f5f9; padding:24px; color:#0f172a;">
        <div style="max-width:560px; margin:auto; background:white; border-radius:14px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <div style="background:#7c3aed; color:white; padding:16px 22px;">
            <strong style="font-size:13px; letter-spacing:1px;">
              TASK ASSIGNMENT — AWAITING APPROVAL
            </strong>
          </div>

          <div style="padding:24px 22px;">
            <p style="margin:0 0 14px 0; font-size:15px;">
              Hi <b>{authority_name}</b>,
            </p>

            <p style="margin:0 0 16px 0; font-size:14px; color:#475569; line-height:1.6;">
              The system has proposed the following task
              assignment. It will <b>not</b> be created until you
              approve it below. The proposal expires on
              <b>{expires_text}</b>.
            </p>

            <h2 style="margin:0 0 6px 0; font-size:17px; color:#0f172a;">
              {task_name}
            </h2>

            <p style="margin:0 0 16px 0; color:#475569; font-size:13px; line-height:1.6;">
              {task_details or "—"}
            </p>

            <table style="width:100%; border-top:1px solid #e5e7eb; padding-top:10px;">
              <tr>
                <td style="padding:6px 0; color:#64748b; font-size:13px;">Proposed assignee</td>
                <td style="padding:6px 0; font-weight:600;">
                  {employee_name} ({employee_code})
                </td>
              </tr>
              {dept_row}
              {project_row}
              <tr>
                <td style="padding:6px 0; color:#64748b; font-size:13px;">Current workload</td>
                <td style="padding:6px 0;">{prior_workload} active task(s)</td>
              </tr>
              <tr>
                <td style="padding:6px 0; color:#64748b; font-size:13px;">Due date</td>
                <td style="padding:6px 0; color:#dc2626; font-weight:600;">{due_text}</td>
              </tr>
            </table>

            <div style="margin-top:26px; text-align:center;">
              <a href="{approve_url}"
                style="display:inline-block; padding:12px 24px; margin:4px; background:#16a34a; color:white; text-decoration:none; border-radius:8px; font-weight:600; font-size:14px;">
                ✓ Approve
              </a>
              <a href="{reject_url}"
                style="display:inline-block; padding:12px 24px; margin:4px; background:#dc2626; color:white; text-decoration:none; border-radius:8px; font-weight:600; font-size:14px;">
                ✕ Reject
              </a>
            </div>

            <hr style="border:none; border-top:1px solid #e5e7eb; margin:22px 0;">
            <p style="margin:0; font-size:11px; color:#94a3b8; line-height:1.5;">
              If neither link is clicked within 24 hours, the
              proposal automatically expires and no task is
              created. — Bharath Vending Corporation ERP
            </p>
          </div>
        </div>
      </body>
    </html>
    """


def build_sms_body(
    employee_name,
    employee_code,
    task_name,
    approve_url,
    reject_url
):

    # SMS bodies are short — keep tight
    return (
        f"BVC ERP: Task '{task_name[:30]}' "
        f"proposed for {employee_name} ({employee_code}). "
        f"Approve: {approve_url} "
        f"Reject: {reject_url} "
        f"Expires in 24h."
    )


def send_sms_via_provider(phone: str, body: str, approve_url: str = "", reject_url: str = ""):
    """
    Dispatch the approval message to whatever provider is set
    in SMS_PROVIDER. Supports:
      - whatsapp : Meta WhatsApp Cloud API (free first 1000/month)
      - twilio   : Twilio SMS (paid trial)
      - msg91    : MSG91 Indian SMS gateway (paid)
    Returns (ok, message).
    """

    provider = os.getenv("SMS_PROVIDER", "").lower().strip()

    if not provider:

        return False, "No SMS_PROVIDER configured (set to 'whatsapp', 'twilio', or 'msg91')"

    if provider == "whatsapp":

        return _send_via_whatsapp(phone, body, approve_url, reject_url)

    if provider == "twilio":

        return _send_via_twilio(phone, body)

    if provider == "msg91":

        return _send_via_msg91(phone, body)

    return False, f"Unknown SMS_PROVIDER '{provider}'"


def _send_via_whatsapp(phone, body, approve_url="", reject_url=""):
    """
    Sends via Meta WhatsApp Cloud API.

    Required env:
      WHATSAPP_TOKEN     - Access token from Meta App dashboard
      WHATSAPP_PHONE_ID  - Phone number ID (NOT the number itself)

    Optional env:
      WHATSAPP_TEMPLATE_NAME     - Template name; defaults to 'hello_world'
      WHATSAPP_TEMPLATE_LANG     - Language code, default 'en_US'
      WHATSAPP_USE_FREEFORM      - 'true' to send plain text (only
                                   works in a 24-hour session window
                                   after the user messages your bot)
    """

    token = os.getenv("WHATSAPP_TOKEN", "").strip()

    phone_id = os.getenv("WHATSAPP_PHONE_ID", "").strip()

    if not token or not phone_id:

        return False, (
            "WhatsApp credentials missing — set "
            "WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in .env"
        )

    # WhatsApp expects the number WITHOUT the '+' prefix
    to_number = phone.lstrip("+").strip()

    if not to_number.isdigit():

        return False, (
            f"Invalid WhatsApp recipient '{phone}'. "
            f"Use E.164 format like +917603909647"
        )

    url = f"https://graph.facebook.com/v18.0/{phone_id}/messages"

    use_freeform = (
        os.getenv("WHATSAPP_USE_FREEFORM", "").lower() == "true"
    )

    if use_freeform:

        # Free-form text — only works in a 24h conversation
        # window after the user messaged your bot
        payload = {
            "messaging_product": "whatsapp",
            "to": to_number,
            "type": "text",
            "text": {"body": body[:4096]}
        }

    else:

        template_name = (
            os.getenv("WHATSAPP_TEMPLATE_NAME", "hello_world").strip()
        )

        lang = os.getenv("WHATSAPP_TEMPLATE_LANG", "en_US").strip()

        payload = {
            "messaging_product": "whatsapp",
            "to": to_number,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": lang}
            }
        }

        # If the user created a custom template called
        # 'task_approval' with body parameters {{1}}..{{4}}, we
        # fill them. Otherwise the template runs with no
        # parameters (which is fine for 'hello_world').
        if template_name != "hello_world":

            payload["template"]["components"] = [
                {
                    "type": "body",
                    "parameters": [
                        {"type": "text", "text": body[:200]},
                        {"type": "text", "text": approve_url or "—"},
                        {"type": "text", "text": reject_url or "—"}
                    ]
                }
            ]

    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        },
        method="POST"
    )

    try:

        with urllib.request.urlopen(req, timeout=15) as resp:

            body_text = resp.read().decode("utf-8")

            if resp.status == 200:

                return True, f"WhatsApp sent to {phone}"

            return False, f"WhatsApp returned {resp.status}: {body_text[:300]}"

    except urllib.error.HTTPError as e:

        err_body = ""

        try:

            err_body = e.read().decode("utf-8")[:400]

        except Exception:

            pass

        return False, f"WhatsApp HTTP {e.code}: {err_body or str(e)}"

    except Exception as e:

        return False, f"WhatsApp error: {str(e)}"


def _send_via_twilio(phone, body):
    """Stub — implement when Twilio credentials are available."""

    return False, "Twilio integration not implemented yet"


def _send_via_msg91(phone, body):
    """Stub — implement when MSG91 credentials are available."""

    return False, "MSG91 integration not implemented yet"


def send_approval_request(
    employee,
    department_name,
    task_name,
    task_details,
    project_name,
    prior_workload,
    due_date,
    approval_token,
    db: Session = None,
    department_id=None
):
    """
    Sends the approval-request notification to the authority.

    Returns a dict:
      {
        "email_sent": bool,
        "email_message": str,
        "sms_sent": bool,
        "sms_message": str,
        "approve_url": str,
        "reject_url": str,
        "expires_at": datetime
      }
    """

    from datetime import timedelta

    authority = get_authority_contact(db=db, department_id=department_id)

    base_url = (
        os.getenv("BACKEND_URL", "").strip()
        or "http://127.0.0.1:8001"
    )

    approve_url = f"{base_url}/approve-task?token={approval_token}"

    reject_url = f"{base_url}/reject-task?token={approval_token}"

    expires_at = datetime.utcnow() + timedelta(hours=24)

    result = {
        "approve_url": approve_url,
        "reject_url": reject_url,
        "expires_at": expires_at,
        "authority_name": authority["name"],
        "authority_email": authority["email"],
        "authority_phone": authority["phone"],
        "authority_source": authority.get("source", "env"),
        "email_sent": False,
        "email_message": "",
        "sms_sent": False,
        "sms_message": ""
    }

    # ---- Email path ----
    if is_smtp_configured() and authority["email"]:

        html = build_approval_email_html(
            authority_name=authority["name"],
            employee_name=employee.NAME,
            employee_code=employee.EMPLOYEE_CODE,
            department_name=department_name,
            task_name=task_name,
            task_details=task_details,
            project_name=project_name,
            prior_workload=prior_workload,
            due_date=due_date,
            approve_url=approve_url,
            reject_url=reject_url,
            expires_at=expires_at
        )

        ok, msg = send_alert_email(
            subject=(
                f"[BVC] Approval needed: "
                f"task for {employee.EMPLOYEE_CODE}"
            ),
            body_html=html,
            recipient=authority["email"]
        )

        result["email_sent"] = ok

        result["email_message"] = msg

    else:

        result["email_message"] = (
            "Email skipped: "
            + ("no APPROVER_EMAIL set" if not authority["email"]
               else "SMTP not configured")
        )

    # ---- SMS path (stub for now) ----
    if authority["phone"]:

        sms_body = build_sms_body(
            employee_name=employee.NAME,
            employee_code=employee.EMPLOYEE_CODE,
            task_name=task_name,
            approve_url=approve_url,
            reject_url=reject_url
        )

        ok, msg = send_sms_via_provider(
            authority["phone"],
            sms_body,
            approve_url=approve_url,
            reject_url=reject_url
        )

        result["sms_sent"] = ok

        result["sms_message"] = msg

    else:

        result["sms_message"] = "No APPROVER_PHONE set in .env"

    return result
