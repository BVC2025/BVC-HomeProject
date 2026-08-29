import os
import json
import smtplib
import urllib.request
import urllib.error

from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


# ---------------------------------------------------------
# Resend HTTP API — primary email sender when configured.
# Uses HTTPS (port 443), so it works even on networks that
# block SMTP ports (587 / 465 / 25).
# ---------------------------------------------------------

def is_resend_configured():

    return bool(os.getenv("RESEND_API_KEY", "").strip())


def send_via_resend(subject, body_html, recipient, attachments=None):
    """
    Sends one HTML email via Resend's HTTP API. Optionally attaches
    one or more files (PDF, etc.). Returns (ok, message). Never
    raises.

    `attachments` is a list of dicts: [{filename, content, content_type}]
    where `content` is raw bytes. Resend expects base64-encoded content
    in the payload.

    Required env:
      RESEND_API_KEY - 're_...' API key from resend.com
      SMTP_FROM      - sender address (must be a verified
                       domain, OR use 'onboarding@resend.dev'
                       which Resend allows for free testing)

    Optional env:
      SMTP_FROM_NAME - friendly sender name
    """

    import base64

    api_key = os.getenv("RESEND_API_KEY", "").strip()

    if not api_key:

        return False, "RESEND_API_KEY not set"

    from_addr = (
        os.getenv("SMTP_FROM", "").strip()
        or "onboarding@resend.dev"
    )

    from_name = os.getenv(
        "SMTP_FROM_NAME",
        "Bharath Vending ERP"
    ).strip()

    from_field = f"{from_name} <{from_addr}>"

    if not recipient:

        return False, "No recipient email"

    payload = {
        "from": from_field,
        "to": [recipient],
        "subject": subject,
        "html": body_html
    }

    if attachments:

        # Resend wants base64-encoded bytes per attachment
        payload["attachments"] = [
            {
                "filename": a["filename"],
                "content": base64.b64encode(a["content"]).decode("ascii"),
                "content_type": a.get("content_type", "application/octet-stream")
            }
            for a in attachments
            if a.get("content")
        ]

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Cloudflare in front of api.resend.com blocks
            # the default 'Python-urllib/3.x' User-Agent
            # (Cloudflare error 1010). Send a normal one.
            "User-Agent": (
                "Mozilla/5.0 (compatible; BharathERP/1.0; "
                "+https://bharath-vending.local)"
            )
        },
        method="POST"
    )

    try:

        with urllib.request.urlopen(req, timeout=15) as resp:

            body = resp.read().decode("utf-8")

            if resp.status in (200, 201, 202):

                return True, f"Resend: sent to {recipient}"

            return False, f"Resend {resp.status}: {body[:300]}"

    except urllib.error.HTTPError as e:

        err = ""

        try:

            err = e.read().decode("utf-8")[:400]

        except Exception:

            pass

        return False, f"Resend HTTP {e.code}: {err or str(e)}"

    except Exception as e:

        return False, f"Resend error: {str(e)}"


def get_email_config():

    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "from_addr": (
            os.getenv("SMTP_FROM", "").strip()
            or os.getenv("SMTP_USER", "").strip()
        ),
        "from_name": os.getenv(
            "SMTP_FROM_NAME",
            "Bharath Vending ERP"
        ).strip(),
        "admin_email": os.getenv(
            "ADMIN_EMAIL", ""
        ).strip(),
        "use_tls": os.getenv(
            "SMTP_USE_TLS", "true"
        ).lower() == "true"
    }


def is_smtp_configured():

    cfg = get_email_config()

    return bool(
        cfg["host"]
        and cfg["user"]
        and cfg["password"]
        and cfg["from_addr"]
    )


def send_alert_email(
    subject,
    body_html,
    recipient=None,
    attachments=None
):
    """Send a transactional email to `recipient`.

    `attachments` is an optional list of dicts:
        [{filename, content (bytes), content_type}]
    Used by the quotation flow to attach the rendered PDF.
    """

    cfg = get_email_config()

    target = recipient or cfg["admin_email"]

    if not target:

        return False, "No recipient email (ADMIN_EMAIL not set)"

    # ---- Testing-mode override -----------------------------------
    # Resend's free tier blocks sending to anyone other than the
    # signed-up email until a custom domain is verified. To unblock
    # testing without changing every customer/supplier email by hand,
    # set EMAIL_TESTING_OVERRIDE_TO=<your-verified-email> in .env.
    # When set:
    #   - All outgoing mail is redirected to that address
    #   - A small banner is prepended to the body so you can see
    #     who the email was originally meant for
    # Unset (or empty) → normal behavior.
    override_to = os.getenv("EMAIL_TESTING_OVERRIDE_TO", "").strip()

    if override_to and target.lower() != override_to.lower():

        original_target = target

        target = override_to

        banner = (
            '<div style="background:#fef3c7; border:1px solid #fcd34d; '
            'color:#854d0e; padding:10px 14px; margin-bottom:12px; '
            'border-radius:8px; font-family:Arial,sans-serif; font-size:12px;">'
            '🧪 <b>Testing mode</b> — this email was originally addressed to '
            f'<b>{original_target}</b>. '
            'Redirected here by EMAIL_TESTING_OVERRIDE_TO. '
            'Remove that env var in production.'
            '</div>'
        )

        # Inject banner just inside <body> if present, else prepend
        if "<body" in body_html.lower():

            # Find the closing > of the <body ...> tag and insert after it
            import re

            body_html = re.sub(
                r"(<body[^>]*>)",
                r"\1" + banner,
                body_html,
                count=1,
                flags=re.IGNORECASE
            )

        else:

            body_html = banner + body_html

    # ---- Transport selection -------------------------------------
    # EMAIL_PROVIDER lets you pick explicitly:
    #   'auto'   (default) — Resend first if configured, else SMTP
    #   'smtp'             — always Gmail / SMTP (no recipient limits)
    #   'resend'           — always Resend (subject to sandbox limits)
    provider = (os.getenv("EMAIL_PROVIDER") or "auto").strip().lower()

    use_resend = (
        (provider == "resend")
        or (provider == "auto" and is_resend_configured())
    )

    if use_resend and is_resend_configured():

        return send_via_resend(
            subject, body_html, target, attachments=attachments
        )

    # ---- SMTP path ----
    if not is_smtp_configured():

        return False, (
            "No email provider configured. Either set "
            "RESEND_API_KEY or "
            "SMTP_HOST / SMTP_USER / SMTP_PASSWORD / SMTP_FROM in .env"
        )

    # When attachments are present we need "mixed" at the outer
    # boundary; HTML body stays as an "alternative" sub-part.
    if attachments:

        from email.mime.base import MIMEBase

        from email import encoders

        msg = MIMEMultipart("mixed")

        alt = MIMEMultipart("alternative")

        alt.attach(MIMEText(body_html, "html"))

        msg.attach(alt)

        for a in attachments:

            if not a.get("content"):

                continue

            part = MIMEBase(
                *(a.get("content_type") or "application/octet-stream").split("/", 1)
            )

            part.set_payload(a["content"])

            encoders.encode_base64(part)

            part.add_header(
                "Content-Disposition",
                f'attachment; filename="{a["filename"]}"'
            )

            msg.attach(part)

    else:

        msg = MIMEMultipart("alternative")

        msg.attach(MIMEText(body_html, "html"))

    msg["From"] = (
        f"{cfg['from_name']} <{cfg['from_addr']}>"
    )

    msg["To"] = target

    msg["Subject"] = subject

    use_ssl = (
        cfg["port"] == 465
        or os.getenv("SMTP_USE_SSL", "").lower() == "true"
    )

    try:

        if use_ssl:

            # Port 465 = SSL from the start (no STARTTLS handshake).
            # Many networks that block 587 still allow 465.
            with smtplib.SMTP_SSL(
                cfg["host"],
                cfg["port"],
                timeout=15
            ) as server:

                server.login(cfg["user"], cfg["password"])

                server.sendmail(
                    cfg["from_addr"],
                    [target],
                    msg.as_string()
                )

        else:

            with smtplib.SMTP(
                cfg["host"],
                cfg["port"],
                timeout=15
            ) as server:

                if cfg["use_tls"]:

                    server.starttls()

                server.login(cfg["user"], cfg["password"])

                server.sendmail(
                    cfg["from_addr"],
                    [target],
                    msg.as_string()
                )

        return True, f"Sent to {target}"

    except Exception as e:

        return False, str(e)


def build_task_assignment_html(
    employee_name,
    task_name,
    task_details,
    project_name,
    due_date,
    is_auto=False,
    frontend_url=None
):
    """
    Returns an HTML email body announcing a new task to
    the assigned employee.
    """

    safe_details = task_details or "No additional details."

    project_block = (
        f"""
        <tr>
          <td style="padding:8px 0; color:#64748b; font-size:13px;">
            Project
          </td>
          <td style="padding:8px 0; font-weight:600; color:#0f172a;">
            {project_name}
          </td>
        </tr>
        """
        if project_name else ""
    )

    due_text = (
        due_date.isoformat()
        if hasattr(due_date, "isoformat") else (due_date or "n/a")
    )

    auto_badge = (
        '<span style="background:#dbeafe; color:#1e40af; '
        'padding:2px 8px; border-radius:999px; font-size:11px; '
        'font-weight:700; margin-left:8px;">AUTO-ASSIGNED</span>'
        if is_auto else ""
    )

    fe = (
        frontend_url
        or os.getenv("FRONTEND_URL", "").strip()
        or "http://localhost:5173"
    )

    return f"""
    <!doctype html>
    <html>
      <body style="font-family: Segoe UI, Arial, sans-serif; background:#f1f5f9; padding:24px; color:#0f172a;">
        <div style="max-width:560px; margin:auto; background:white; border-radius:14px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <div style="background:#2563eb; color:white; padding:16px 22px;">
            <strong style="font-size:14px; letter-spacing:1px;">
              NEW TASK ASSIGNED{auto_badge}
            </strong>
          </div>
          <div style="padding:24px 22px;">
            <p style="margin:0 0 14px 0; font-size:15px; color:#0f172a;">
              Hi <b>{employee_name}</b>,
            </p>
            <p style="margin:0 0 18px 0; font-size:14px; color:#475569; line-height:1.6;">
              A new task has been assigned to you by Bharath
              Vending Corporation ERP. Please review the
              details below and log in to begin work.
            </p>

            <h2 style="margin:0 0 12px 0; font-size:18px; color:#0f172a;">
              {task_name}
            </h2>

            <p style="margin:0 0 18px 0; color:#475569; font-size:14px; line-height:1.6;">
              {safe_details}
            </p>

            <table style="width:100%; border-top:1px solid #e5e7eb; padding-top:14px; margin-top:14px;">
              {project_block}
              <tr>
                <td style="padding:8px 0; color:#64748b; font-size:13px;">Due date</td>
                <td style="padding:8px 0; font-weight:600; color:#dc2626;">{due_text}</td>
              </tr>
            </table>

            <div style="margin-top:24px; text-align:center;">
              <a
                href="{fe}/login"
                style="display:inline-block; padding:12px 26px; background:#2563eb; color:white; text-decoration:none; border-radius:8px; font-weight:600; font-size:14px;"
              >
                Open Bharath ERP
              </a>
            </div>

            <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;">
            <p style="margin:0; font-size:12px; color:#94a3b8;">
              You can mark the task as <b>Start</b> →
              <b>Complete</b> from your dashboard. If you
              cannot work on this task, please contact your
              manager.
              <br><br>
              — Bharath Vending Corporation ERP
            </p>
          </div>
        </div>
      </body>
    </html>
    """


def send_task_assignment_email(
    employee,
    task_name,
    task_details,
    project_name,
    due_date,
    is_auto=False
):
    """
    Sends the "new task assigned" email to one employee.
    Returns (ok: bool, msg: str). Never raises — task creation
    must not fail because email failed.
    """

    if not employee or not employee.EMAIL:

        return False, "Employee has no email on file"

    # Accept either Resend (HTTP) or classic SMTP. Without
    # at least one of these, no email can leave the box.
    if not (is_resend_configured() or is_smtp_configured()):

        return False, (
            "No email provider configured. Set "
            "RESEND_API_KEY (recommended) or SMTP_HOST/"
            "USER/PASSWORD/FROM in .env"
        )

    subject = f"[BVC] New task assigned: {task_name}"

    body_html = build_task_assignment_html(
        employee_name=employee.NAME,
        task_name=task_name,
        task_details=task_details,
        project_name=project_name,
        due_date=due_date,
        is_auto=is_auto
    )

    try:

        return send_alert_email(
            subject=subject,
            body_html=body_html,
            recipient=employee.EMAIL
        )

    except Exception as e:

        return False, str(e)


def build_alert_html(title, message, alert_type):

    colors = {
        "ERROR": "#dc2626",
        "WARNING": "#d97706",
        "SUCCESS": "#16a34a",
        "INFO": "#2563eb"
    }

    color = colors.get(alert_type, "#2563eb")

    return f"""
    <!doctype html>
    <html>
      <body style="font-family: Segoe UI, Arial, sans-serif; background:#f1f5f9; padding:24px; color:#0f172a;">
        <div style="max-width:560px; margin:auto; background:white; border-radius:14px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
          <div style="background:{color}; color:white; padding:16px 22px;">
            <strong style="font-size:14px; letter-spacing:1px;">{alert_type} ALERT</strong>
          </div>
          <div style="padding:24px 22px;">
            <h2 style="margin:0 0 12px 0; font-size:20px; color:#0f172a;">{title}</h2>
            <p style="margin:0; color:#475569; line-height:1.6; font-size:14px;">
              {message}
            </p>
            <hr style="border:none; border-top:1px solid #e5e7eb; margin:22px 0;">
            <p style="margin:0; font-size:12px; color:#94a3b8;">
              This alert was generated by <b>Bharath Vending Corporation ERP</b>.
              <br>Open the dashboard to review and acknowledge it.
            </p>
          </div>
        </div>
      </body>
    </html>
    """


def _html_to_plain(html: str) -> str:
    """Convert HTML email body to a plain-text fallback for spam filter compliance."""
    import re
    import html as _html_mod
    text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(
        r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
        r'\2 (\1)', text, flags=re.DOTALL | re.IGNORECASE
    )
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</?(?:p|div|tr|li|h[1-6])[^>]*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    text = _html_mod.unescape(text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def send_via_vendor_smtp(
    config,
    recipient: str,
    subject: str,
    html_body: str,
    logo_bytes: bytes = None,
    logo_content_type: str = "image/png",
    attachments: list = None,
) -> tuple:
    """Send an email using credentials from a VendorEmailConfig ORM row.

    Returns (success: bool, message: str, detail: dict). Never raises.

    detail keys:
      smtp_connected        — True if TCP connection to SMTP host succeeded
      authentication_success — True if SMTP AUTH succeeded
      message_id            — RFC 5322 Message-ID header value
      effective_from        — Actual FROM address used (may differ from FROM_EMAIL on Gmail)

    When logo_bytes is provided the email is structured as
    multipart/related (multipart/alternative + CID image) so the logo
    is embedded inline and visible in all major email clients without
    requiring a publicly accessible URL.

    `attachments` (optional) is a list of dicts: [{filename, content, content_type}]
    where `content` is raw bytes — mirrors send_alert_email()'s own
    attachment handling. When present, the whole message (logo/no-logo)
    is wrapped in an outer multipart/mixed, matching that function's
    "mixed at the outer boundary, alternative underneath" structure.

    Gmail SMTP note: Gmail forces the From header to match the
    authenticated SMTP account (SMTP_USERNAME). When smtp.gmail.com is
    detected, SMTP_USERNAME is used as the effective FROM address to
    keep the MIME header, SMTP envelope, and what the recipient sees all
    consistent.
    """
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from email.mime.image import MIMEImage
    from email.utils import formatdate, make_msgid

    detail: dict = {
        "smtp_connected": False,
        "authentication_success": False,
        "message_id": None,
        "effective_from": None,
    }

    try:
        # Gmail SMTP always overrides From to match the authenticated account.
        # Align the MIME header and envelope with what Gmail will actually send.
        is_gmail = "gmail.com" in (config.SMTP_HOST or "").lower()
        effective_from = config.SMTP_USERNAME if is_gmail else config.FROM_EMAIL
        detail["effective_from"] = effective_from

        domain = effective_from.split("@")[-1] if "@" in effective_from else "mail.local"
        message_id = make_msgid(domain=domain)
        detail["message_id"] = message_id

        plain_text = _html_to_plain(html_body)

        if logo_bytes:
            # multipart/related wraps multipart/alternative + inline CID image
            outer = MIMEMultipart("related")
            alt = MIMEMultipart("alternative")
            alt.attach(MIMEText(plain_text, "plain", "utf-8"))
            alt.attach(MIMEText(html_body, "html", "utf-8"))
            outer.attach(alt)
            subtype = logo_content_type.split("/")[-1]
            img_part = MIMEImage(logo_bytes, _subtype=subtype)
            img_part.add_header("Content-ID", "<company_logo>")
            img_part.add_header("Content-Disposition", "inline", filename="logo.png")
            outer.attach(img_part)
            msg = outer
        else:
            # Plain multipart/alternative: text first, HTML second (RFC 2046 preference order)
            msg = MIMEMultipart("alternative")
            msg.attach(MIMEText(plain_text, "plain", "utf-8"))
            msg.attach(MIMEText(html_body, "html", "utf-8"))

        if attachments:
            from email.mime.base import MIMEBase
            from email import encoders

            mixed = MIMEMultipart("mixed")
            mixed.attach(msg)
            for a in attachments:
                if not a.get("content"):
                    continue
                part = MIMEBase(*(a.get("content_type") or "application/octet-stream").split("/", 1))
                part.set_payload(a["content"])
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", f'attachment; filename="{a["filename"]}"')
                mixed.attach(part)
            msg = mixed

        msg["Subject"] = subject
        msg["From"] = f"{config.FROM_NAME} <{effective_from}>"
        msg["To"] = recipient
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = message_id
        if config.BCC_EMAIL:
            msg["Bcc"] = config.BCC_EMAIL

        all_recipients = [recipient] + ([config.BCC_EMAIL] if config.BCC_EMAIL else [])
        use_ssl = int(config.SMTP_PORT) == 465

        if use_ssl:
            with smtplib.SMTP_SSL(config.SMTP_HOST, int(config.SMTP_PORT), timeout=15) as server:
                detail["smtp_connected"] = True
                server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
                detail["authentication_success"] = True
                server.sendmail(effective_from, all_recipients, msg.as_string())
        else:
            with smtplib.SMTP(config.SMTP_HOST, int(config.SMTP_PORT), timeout=15) as server:
                server.ehlo()
                server.starttls()
                detail["smtp_connected"] = True
                server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
                detail["authentication_success"] = True
                server.sendmail(effective_from, all_recipients, msg.as_string())

        return True, "sent", detail

    except smtplib.SMTPAuthenticationError as exc:
        detail["smtp_connected"] = True
        return False, f"SMTP authentication failed: {exc}", detail
    except (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, ConnectionRefusedError) as exc:
        return False, f"SMTP connection failed: {exc}", detail
    except Exception as exc:
        return False, str(exc), detail
