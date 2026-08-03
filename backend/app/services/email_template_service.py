"""Email template service — file-based defaults with DB-backed customisation.

Template HTML lives in:
  backend/app/email_templates/supplier/<type>.html

Each template type is completely independent — its own HTML file, subject line,
placeholder set, and initial editor design. The DB row stores admin edits; the
HTML file is the factory default used when no DB row exists yet.

To add a new template type:
  1. Create the HTML file under backend/app/email_templates/supplier/.
  2. Add an entry to TEMPLATE_CATALOG.
  3. Add an entry to _TEMPLATE_INITIAL_DESIGN (for the email editor).
  4. Restart the server — GET /email-templates auto-seeds the new row.
"""

import json
import logging
import os
import uuid

from sqlalchemy.orm import Session

from app.models.email_models import EmailTemplate

logger = logging.getLogger(__name__)

# ── Template file directory ───────────────────────────────────────────────────

_TEMPLATES_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "email_templates", "supplier")
)


def _load_html(filename: str, fallback: str) -> str:
    """Load template HTML from file; use inline fallback string if file is missing."""
    path = os.path.join(_TEMPLATES_DIR, filename)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        logger.warning(
            "[email_template_service] Template file not found: %s — using inline fallback",
            path,
        )
        return fallback


# ── Inline fallback strings ───────────────────────────────────────────────────
# Used ONLY when the corresponding HTML file cannot be read (e.g. missing
# from deployment). These are never modified — they mirror the file content
# exactly and serve as a safety net only.

_INVITATION_FALLBACK = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Supplier Invitation</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f8fafc;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;width:100%;">
        <tr>
          <td style="background:#DC2626;padding:36px 48px;text-align:center;">
            {{logo_html}}
            <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;
                       letter-spacing:-0.5px;">{{company_name}}</h1>
            <p style="color:rgba(255,255,255,0.80);margin:10px 0 0;
                      font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">
              Supplier Management Portal
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:44px 48px;">
            <h2 style="color:#1e293b;font-size:22px;margin:0 0 20px;font-weight:700;">
              You&rsquo;re Invited to Join as a Supplier
            </h2>
            <p style="color:#475569;line-height:1.75;margin:0 0 16px;font-size:15px;">
              Dear <strong>{{invited_company}}</strong>,
            </p>
            <p style="color:#475569;line-height:1.75;margin:0 0 28px;font-size:15px;">
              We are pleased to invite you to register as an approved supplier on our
              procurement platform. Please click the button below to complete your supplier
              profile and begin the onboarding process.
            </p>
            <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 28px;">
              <tr>
                <td style="background:#DC2626;border-radius:7px;">
                  <a href="{{registration_link}}"
                     style="display:inline-block;padding:15px 36px;color:#ffffff;
                            text-decoration:none;font-weight:700;font-size:15px;">
                    Complete Registration &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <p style="color:#64748b;font-size:13px;line-height:1.7;margin:0 0 10px;">
              This invitation expires on <strong>{{expires_at}}</strong>.
            </p>
            <p style="color:#64748b;font-size:13px;line-height:1.7;margin:0;">
              Contact us at
              <a href="mailto:{{support_email}}"
                 style="color:#DC2626;text-decoration:none;">{{support_email}}</a>.
            </p>
          </td>
        </tr>
        <tr><td style="padding:0 48px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;">
        </td></tr>
        <tr>
          <td style="padding:28px 48px;background:#f8fafc;">
            <p style="color:#94a3b8;font-size:12px;line-height:2;margin:0;text-align:center;">
              <strong style="color:#64748b;">{{company_name}}</strong><br>
              {{company_address}}<br>
              Phone:&nbsp;{{contact_number}}&nbsp;|&nbsp;
              <a href="{{website}}" style="color:#DC2626;text-decoration:none;">{{website}}</a><br>
              <a href="mailto:{{support_email}}"
                 style="color:#DC2626;text-decoration:none;">{{support_email}}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

_APPROVAL_FALLBACK = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Supplier Approved</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f8fafc;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;width:100%;">
        <tr>
          <td style="background:#16a34a;padding:36px 48px;text-align:center;">
            {{logo_html}}
            <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">
              {{company_name}}
            </h1>
            <p style="color:rgba(255,255,255,0.80);margin:10px 0 0;font-size:13px;
                      letter-spacing:0.5px;text-transform:uppercase;">
              Supplier Management Portal
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:44px 48px;">
            <h2 style="color:#1e293b;font-size:22px;margin:0 0 20px;font-weight:700;">
              Congratulations &mdash; You&rsquo;ve Been Approved!
            </h2>
            <p style="color:#475569;line-height:1.75;margin:0 0 16px;font-size:15px;">
              Dear <strong>{{supplier_name}}</strong>,
            </p>
            <p style="color:#475569;line-height:1.75;margin:0 0 16px;font-size:15px;">
              We are delighted to inform you that <strong>{{supplier_company_name}}</strong>
              has been approved as a verified supplier on our procurement platform.
            </p>
            <p style="color:#475569;line-height:1.75;margin:0 0 28px;font-size:15px;">
              Your registration was reviewed and approved on <strong>{{approved_at}}</strong>.
              You are now part of our trusted supplier network and our team will be in touch
              shortly with next steps.
            </p>
            <p style="color:#64748b;font-size:13px;line-height:1.7;margin:0;">
              If you have any questions, please contact us at
              <a href="mailto:{{support_email}}"
                 style="color:#16a34a;text-decoration:none;">{{support_email}}</a>.
            </p>
          </td>
        </tr>
        <tr><td style="padding:0 48px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;">
        </td></tr>
        <tr>
          <td style="padding:28px 48px;background:#f8fafc;">
            <p style="color:#94a3b8;font-size:12px;line-height:2;margin:0;text-align:center;">
              <strong style="color:#64748b;">{{company_name}}</strong><br>
              {{company_address}}<br>
              Phone:&nbsp;{{contact_number}}&nbsp;|&nbsp;
              <a href="{{website}}" style="color:#16a34a;text-decoration:none;">{{website}}</a><br>
              <a href="mailto:{{support_email}}"
                 style="color:#16a34a;text-decoration:none;">{{support_email}}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

_REJECTION_FALLBACK = """\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Supplier Registration Update</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f8fafc;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;width:100%;">
        <tr>
          <td style="background:#DC2626;padding:36px 48px;text-align:center;">
            {{logo_html}}
            <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">
              {{company_name}}
            </h1>
            <p style="color:rgba(255,255,255,0.80);margin:10px 0 0;font-size:13px;
                      letter-spacing:0.5px;text-transform:uppercase;">
              Supplier Management Portal
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:44px 48px;">
            <h2 style="color:#1e293b;font-size:22px;margin:0 0 20px;font-weight:700;">
              Supplier Registration Update
            </h2>
            <p style="color:#475569;line-height:1.75;margin:0 0 16px;font-size:15px;">
              Dear <strong>{{supplier_name}}</strong>,
            </p>
            <p style="color:#475569;line-height:1.75;margin:0 0 16px;font-size:15px;">
              Thank you for your interest in becoming a supplier for <strong>{{company_name}}</strong>.
              After careful review of your application submitted by
              <strong>{{supplier_company_name}}</strong>, we regret to inform you that
              we are unable to proceed at this time.
            </p>
            <table cellpadding="0" cellspacing="0" role="presentation"
                   style="margin:0 0 24px;width:100%;">
              <tr>
                <td style="background:#fef2f2;border-left:4px solid #DC2626;
                            border-radius:4px;padding:16px 20px;">
                  <p style="color:#7f1d1d;font-size:14px;margin:0;line-height:1.7;">
                    <strong>Reason:</strong> {{rejection_reason}}
                  </p>
                </td>
              </tr>
            </table>
            <p style="color:#475569;line-height:1.75;margin:0 0 16px;font-size:15px;">
              This decision was made on <strong>{{rejected_at}}</strong>.
              If you believe this was made in error or would like to discuss further,
              please reach out to our team.
            </p>
            <p style="color:#64748b;font-size:13px;line-height:1.7;margin:0;">
              Contact us at
              <a href="mailto:{{support_email}}"
                 style="color:#DC2626;text-decoration:none;">{{support_email}}</a>.
            </p>
          </td>
        </tr>
        <tr><td style="padding:0 48px;">
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;">
        </td></tr>
        <tr>
          <td style="padding:28px 48px;background:#f8fafc;">
            <p style="color:#94a3b8;font-size:12px;line-height:2;margin:0;text-align:center;">
              <strong style="color:#64748b;">{{company_name}}</strong><br>
              {{company_address}}<br>
              Phone:&nbsp;{{contact_number}}&nbsp;|&nbsp;
              <a href="{{website}}" style="color:#DC2626;text-decoration:none;">{{website}}</a><br>
              <a href="mailto:{{support_email}}"
                 style="color:#DC2626;text-decoration:none;">{{support_email}}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


# ── Load templates from HTML files (fallbacks used only if files are missing) ─

_SUPPLIER_INVITATION_HTML = _load_html("supplier_invitation.html", _INVITATION_FALLBACK)
_SUPPLIER_APPROVAL_HTML   = _load_html("supplier_approval.html",   _APPROVAL_FALLBACK)
_SUPPLIER_REJECTION_HTML  = _load_html("supplier_rejection.html",  _REJECTION_FALLBACK)


# ── Template catalog ──────────────────────────────────────────────────────────
# Each entry is completely independent: its own HTML file, subject line, and
# placeholder set. Approval and Rejection do not inherit anything from Invitation.

TEMPLATE_CATALOG: dict = {
    "SUPPLIER_INVITATION": {
        "display_name": "Supplier Invitation",
        "subject":      "You're Invited to Join as a Supplier — {{company_name}}",
        "html":         _SUPPLIER_INVITATION_HTML,
    },
    "SUPPLIER_APPROVAL": {
        "display_name": "Supplier Approval",
        "subject":      "Welcome! You've been approved as a Supplier — {{company_name}}",
        "html":         _SUPPLIER_APPROVAL_HTML,
    },
    "SUPPLIER_REJECTION": {
        "display_name": "Supplier Rejection",
        "subject":      "Supplier Registration Update — {{supplier_company_name}}",
        "html":         _SUPPLIER_REJECTION_HTML,
    },
}


# ── Per-type initial DESIGN_JSON ──────────────────────────────────────────────
# Stored when a DB row is first created.  The email editor (EmailTemplatePage)
# parses DESIGN_JSON version-1 objects to populate its editing fields.  Seeding
# the correct contentHtml for each type prevents the editor from falling back to
# DEFAULT_DESIGN (which is invitation-specific) when it first loads an approval
# or rejection template.

_TEMPLATE_INITIAL_DESIGN: dict = {
    "SUPPLIER_INVITATION": {
        "version":     1,
        "logoDataUrl": "",
        "headerTitle": "Supplier Management Portal",
        "contentHtml": (
            "<p>Dear <strong>{{invited_company}}</strong>,</p>"
            "<p>We are pleased to invite you to register as an approved supplier on our "
            "procurement platform. Please click the button below to complete your supplier "
            "profile and begin the onboarding process.</p>"
            "<p>If you have any questions at any stage of the registration process, do not "
            "hesitate to reach out to our team &mdash; we are happy to assist.</p>"
        ),
        "customNotes": "",
    },
    "SUPPLIER_APPROVAL": {
        "version":     1,
        "logoDataUrl": "",
        "headerTitle": "Supplier Management Portal",
        "contentHtml": (
            "<p>Dear <strong>{{supplier_name}}</strong>,</p>"
            "<p>We are delighted to inform you that <strong>{{supplier_company_name}}</strong> "
            "has been approved as a verified supplier on our procurement platform.</p>"
            "<p>Your registration was reviewed and approved on <strong>{{approved_at}}</strong>. "
            "You are now part of our trusted supplier network and our team will be in touch "
            "shortly with next steps.</p>"
            "<p>If you have any questions, please contact us at "
            "<a href=\"mailto:{{support_email}}\">{{support_email}}</a>.</p>"
        ),
        "customNotes": "",
    },
    "SUPPLIER_REJECTION": {
        "version":     1,
        "logoDataUrl": "",
        "headerTitle": "Supplier Management Portal",
        "contentHtml": (
            "<p>Dear <strong>{{supplier_name}}</strong>,</p>"
            "<p>Thank you for your interest in becoming a supplier for "
            "<strong>{{company_name}}</strong>. After careful review of your application "
            "submitted by <strong>{{supplier_company_name}}</strong>, we regret to inform you "
            "that we are unable to proceed at this time.</p>"
            "<p><strong>Reason:</strong> {{rejection_reason}}</p>"
            "<p>This decision was made on <strong>{{rejected_at}}</strong>. "
            "If you believe this was made in error or would like to discuss further, "
            "please reach out to our team.</p>"
        ),
        "customNotes": "",
    },
}


# ── Invitation-only placeholder detection (kept for backward compatibility) ───
_INVITATION_ONLY_VARS = {"invited_company", "expires_at", "registration_link"}

# Structural markers that must NOT appear in approval / rejection templates.
# Used by get_template_for_send to detect BODY_HTML that was overwritten by the
# email editor before the template-type-aware fix was applied.
_INVITATION_STRUCTURAL = frozenset({
    "{{registration_link}}",
    "{{expires_at}}",
    "Complete Registration",
})


def _has_invitation_structure(html: str) -> bool:
    """Return True when html contains invitation-only structural elements."""
    return any(marker in html for marker in _INVITATION_STRUCTURAL)


# ── Public API ────────────────────────────────────────────────────────────────

def get_or_create_template(
    db: Session,
    vendor_id: int,
    template_type: str,
) -> "EmailTemplate | None":
    """Return the DB template row, seeding it from TEMPLATE_CATALOG if absent.

    When creating a new row the template-specific initial DESIGN_JSON is stored
    so the email editor loads the correct body content for each template type
    instead of falling back to the invitation-specific DEFAULT_DESIGN.

    Returns None when template_type is not in the catalog.
    """
    tmpl = db.query(EmailTemplate).filter(
        EmailTemplate.VENDOR_ID == vendor_id,
        EmailTemplate.TEMPLATE_TYPE == template_type,
    ).first()
    if tmpl:
        return tmpl

    catalog = TEMPLATE_CATALOG.get(template_type)
    if not catalog:
        return None

    initial_design = _TEMPLATE_INITIAL_DESIGN.get(template_type)

    tmpl = EmailTemplate(
        ID=str(uuid.uuid4()),
        VENDOR_ID=vendor_id,
        TEMPLATE_TYPE=template_type,
        DISPLAY_NAME=catalog["display_name"],
        SUBJECT=catalog["subject"],
        BODY_HTML=catalog["html"],
        DESIGN_JSON=json.dumps(initial_design) if initial_design else None,
    )
    db.add(tmpl)
    db.commit()
    db.refresh(tmpl)
    return tmpl


def get_template_for_send(
    db: Session,
    vendor_id: int,
    template_type: str,
) -> "tuple[str, str]":
    """Return (body_html, subject) for use in email sending — strictly read-only.

    This function NEVER creates, modifies, or deletes any database row.
    It is the correct function to call from all email-send code paths.

    Priority:
      1. DB row exists → return its BODY_HTML and SUBJECT as-is.
      2. No DB row     → return catalog default HTML and subject from the file.
      3. Not in catalog → return ("", "").
    """
    tmpl = db.query(EmailTemplate).filter(
        EmailTemplate.VENDOR_ID == vendor_id,
        EmailTemplate.TEMPLATE_TYPE == template_type,
    ).first()

    if tmpl:
        body_html = tmpl.BODY_HTML or ""
        # Guard: if an approval/rejection DB row was overwritten by the editor
        # (which previously generated invitation structure for all types), fall
        # back to the clean file-based default for this send only — never write.
        if template_type != "SUPPLIER_INVITATION" and _has_invitation_structure(body_html):
            catalog = TEMPLATE_CATALOG.get(template_type)
            if catalog:
                logger.warning(
                    "[email_template_service] %s BODY_HTML contains invitation structure; "
                    "using file-based default for this send (DB row not modified).",
                    template_type,
                )
                return catalog["html"], (tmpl.SUBJECT or catalog["subject"])
        return body_html, (tmpl.SUBJECT or "")

    catalog = TEMPLATE_CATALOG.get(template_type)
    if catalog:
        return catalog["html"], catalog["subject"]

    return "", ""


def get_or_create_template_validated(
    db: Session,
    vendor_id: int,
    template_type: str,
) -> "EmailTemplate | None":
    """Deprecated — use get_template_for_send() for all email-send code paths.

    Kept for backward compatibility. This function is no longer called by any
    send path; calling it from a send path violates Requirement 4 (send must be
    read-only).  New code must not call this function.

    Original behaviour is preserved: reads or creates the template row, then
    resets BODY_HTML if invitation-only placeholders are detected in an
    approval/rejection template.
    """
    tmpl = get_or_create_template(db, vendor_id, template_type)
    if tmpl is None:
        return None

    if template_type == "SUPPLIER_INVITATION":
        return tmpl

    body = tmpl.BODY_HTML or ""
    if any(f"{{{{{v}}}}}" in body for v in _INVITATION_ONLY_VARS):
        catalog = TEMPLATE_CATALOG.get(template_type)
        if catalog:
            tmpl.BODY_HTML = catalog["html"]
            tmpl.DESIGN_JSON = json.dumps(_TEMPLATE_INITIAL_DESIGN.get(template_type)) \
                if _TEMPLATE_INITIAL_DESIGN.get(template_type) else None
            try:
                db.commit()
            except Exception:
                db.rollback()

    return tmpl


def seed_all_templates(db: Session, vendor_id: int) -> list:
    """Ensure every catalog entry exists in the DB for this vendor.

    Called by GET /email-templates so new catalog entries auto-appear
    in the editor dropdown without a migration.
    """
    results = []
    for ttype in TEMPLATE_CATALOG:
        results.append(get_or_create_template(db, vendor_id, ttype))
    return [t for t in results if t is not None]


def render_template(html: str, subject: str, variables: dict) -> tuple:
    """Substitute {{key}} placeholders in subject and HTML body.

    Returns (rendered_subject, rendered_html).  The original template is never
    modified — this function operates only on the strings passed to it.
    """
    for key, value in variables.items():
        placeholder = f"{{{{{key}}}}}"
        safe_value  = str(value) if value is not None else ""
        html    = html.replace(placeholder, safe_value)
        subject = subject.replace(placeholder, safe_value)
    return subject, html
