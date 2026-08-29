"""Internal (staff-facing) notification email sent whenever a customer
approves or rejects a Final or Revised Quotation. Recipients are resolved
via the Email Send Rule system (email_send_rule_service.resolve_recipients).
Content is authored through the same EmailTemplate/TEMPLATE_CATALOG system
every other template uses.

Transport: SENT VIA EMAIL CONFIG (VendorEmailConfig / send_via_vendor_smtp,
falling back to send_via_resend) — a deliberate, explicitly-requested
exception to this codebase's otherwise-consistent "internal notifications
use send_alert_email" precedent (still true for leave approval-request,
task-assignment approval-needed, leave decision — those are unchanged).
This notification and the Purchase Order Uploaded/Reuploaded notification
(po_notification_service.py) are moved onto Email Config specifically so
they're admin-configurable from the Email Config page — the same pipeline
Supplier Management and this module's own customer-facing quotation/PO-
request emails already use — rather than requiring a `.env` edit and
server restart."""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Employee, VendorEmailConfig
from app.services.email_send_rule_service import resolve_recipients
from app.services.email_template_service import get_template_for_send, render_template
from app.services.email_service import send_via_vendor_smtp, send_via_resend
from app.services.email_logo_service import build_email_logo, apply_cid_logo, extract_cid_logo
from app.services.company_settings_service import get_company_settings
from app.services.lead_quotation_service import company_branding_variables, quotation_type_label

log = logging.getLogger(__name__)

_DECISION_LABELS = {"APPROVED": "Approved", "REJECTED": "Rejected"}


def _send_recipient_via_email_config(
    db: Session, vendor_id: int, recipient_email: str, subject: str, html: str,
    logo_bytes: bytes = None, logo_content_type: str = "image/png",
) -> tuple:
    """One recipient, via the Email Config pipeline: loop the vendor's
    active VendorEmailConfig rows through send_via_vendor_smtp, falling
    back to send_via_resend — the exact pattern already used at every
    other Email Config call site (e.g. lead_quotation_service.py's
    send_quotation_email). Returns (ok, message)."""
    active_cfgs = db.query(VendorEmailConfig).filter(
        VendorEmailConfig.VENDOR_ID == vendor_id, VendorEmailConfig.IS_ACTIVE == True,  # noqa: E712
    ).all()
    for cfg in active_cfgs:
        ok, err, _detail = send_via_vendor_smtp(
            cfg, recipient_email, subject, html,
            logo_bytes=logo_bytes, logo_content_type=logo_content_type,
        )
        if ok:
            return True, "Sent"
        log.warning("_send_recipient_via_email_config: vendor SMTP config %s failed: %s", cfg.ID, err)

    ok, err = send_via_resend(subject=subject, body_html=html, recipient=recipient_email)
    if ok:
        return True, "Sent via Resend fallback"
    return False, err or "Failed to send — no working email configuration."


def send_quotation_decision_notifications(
    db: Session,
    *,
    vendor_id: int,
    quotation,
    customer,
    project,
    lead: Optional[object],
    decision: str,
) -> list:
    """Best-effort — resolves recipients, sends one independent email per
    recipient (a bad address must never block the others), returns
    [(recipient_email, sent, message), ...] for logging/diagnostics.
    Silently returns [] if the QUOTATION_DECISION rule has no recipients
    configured (a valid, expected state)."""
    recipients = resolve_recipients(db, vendor_id, "QUOTATION_DECISION", lead=lead)
    if not recipients:
        return []

    body_html, subject = get_template_for_send(db, vendor_id, "QUOTATION_DECISION_NOTIFICATION")
    if not body_html:
        log.warning("send_quotation_decision_notifications: no QUOTATION_DECISION_NOTIFICATION template configured")
        return [(e.EMAIL, False, "No email template configured") for e in recipients]

    decision_label = _DECISION_LABELS.get(decision, decision)
    lead_owner_name = ""
    if lead is not None and lead.ASSIGNED_TO_ID:
        owner = db.query(Employee).filter(Employee.ID == lead.ASSIGNED_TO_ID).first()
        lead_owner_name = owner.NAME if owner else ""

    branding = company_branding_variables(db, vendor_id)
    shared_variables = {
        **branding,
        "our_company_name": branding["company_name"],
        "customer_name": customer.NAME or "",
        # Overrides branding's "company_name" (our own company) with the
        # CUSTOMER's company — this template talks about the customer, not
        # us; our_company_name (above) is reserved for the footer.
        "company_name": customer.COMPANY_NAME or "",
        "contact_name": (lead.CONTACT_NAME if lead else None) or customer.NAME or "",
        "contact_email": (lead.CONTACT_EMAIL if lead else None) or customer.EMAIL or "",
        "contact_phone": (lead.CONTACT_MOBILE if lead else None) or customer.PHONE_NUMBER or "",
        "lead_owner_name": lead_owner_name,
        "project_name": project.NAME or "",
        "quotation_type_label": quotation_type_label(quotation.QUOTATION_TYPE),
        "quotation_number": "",  # resolved by caller if needed; optional per spec ("if available")
        "quoted_price": f"{float(quotation.QUOTED_PRICE):,.2f}",
        "decision_label": decision_label,
        "decision_at": quotation.RESPONDED_AT.strftime("%d %b %Y, %I:%M %p") if quotation.RESPONDED_AT else "",
    }

    company = get_company_settings(db, vendor_id)
    logo_bytes, logo_content_type, _logo_html = build_email_logo(company)

    results = []
    for emp in recipients:
        variables = {**shared_variables, "recipient_name": emp.NAME or ""}
        rendered_subject, rendered_html = render_template(body_html, subject, variables)
        rendered_html = apply_cid_logo(rendered_html, logo_bytes, company)
        recipient_logo_bytes, recipient_logo_content_type = logo_bytes, logo_content_type
        if not recipient_logo_bytes:
            rendered_html, recipient_logo_bytes, recipient_logo_content_type = extract_cid_logo(rendered_html)
        try:
            ok, message = _send_recipient_via_email_config(
                db, vendor_id, emp.EMAIL, rendered_subject, rendered_html,
                logo_bytes=recipient_logo_bytes, logo_content_type=recipient_logo_content_type,
            )
        except Exception as e:
            ok, message = False, f"{type(e).__name__}: {e}"
            log.exception("send_quotation_decision_notifications: failed sending to %s", emp.EMAIL)
        if not ok:
            log.warning("send_quotation_decision_notifications: failed sending to %s: %s", emp.EMAIL, message)
        results.append((emp.EMAIL, ok, message))
    return results
