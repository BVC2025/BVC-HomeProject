"""Internal (staff-facing) notification emails for the Purchase Order
sub-flow — one for when a Purchase Order Request is sent/re-sent to the
customer (send_po_requested_notification, event PO_REQUESTED), and one for
when the customer's Purchase Order is uploaded or reuploaded
(send_po_upload_notification, event PO_UPLOADED) — either by the customer
themselves (public upload link) or by staff on the customer's behalf
(Lead Management's "Re-upload"/"Receive Purchase Order" actions). Both are
structured identically to
quotation_notification_service.send_quotation_decision_notifications():
same recipient-resolution (email_send_rule_service.resolve_recipients),
same EmailTemplate/TEMPLATE_CATALOG content system, same Email Config
transport (send_via_vendor_smtp, falling back to send_via_resend)."""

import logging
import os
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import CustomerProjectPayment, Employee, VendorEmailConfig
from app.services.customer_payment_service import compute_payment_summary, get_accepted_quotation
from app.services.email_send_rule_service import resolve_recipients
from app.services.email_template_service import get_template_for_send, render_template
from app.services.email_service import send_via_vendor_smtp, send_via_resend
from app.services.email_logo_service import build_email_logo, apply_cid_logo, extract_cid_logo
from app.services.company_settings_service import get_company_settings
from app.services.lead_quotation_service import company_branding_variables, quotation_type_label

log = logging.getLogger(__name__)


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _send_recipient_via_email_config(
    db: Session, vendor_id: int, recipient_email: str, subject: str, html: str, attachments=None,
    logo_bytes: bytes = None, logo_content_type: str = "image/png",
) -> tuple:
    """One recipient, via the Email Config pipeline — identical pattern to
    quotation_notification_service.py's own copy (each notification file
    owns its copy rather than sharing one, matching this codebase's
    existing convention of duplicating this block at every call site)."""
    active_cfgs = db.query(VendorEmailConfig).filter(
        VendorEmailConfig.VENDOR_ID == vendor_id, VendorEmailConfig.IS_ACTIVE == True,  # noqa: E712
    ).all()
    for cfg in active_cfgs:
        ok, err, _detail = send_via_vendor_smtp(
            cfg, recipient_email, subject, html, attachments=attachments,
            logo_bytes=logo_bytes, logo_content_type=logo_content_type,
        )
        if ok:
            return True, "Sent"
        log.warning("_send_recipient_via_email_config: vendor SMTP config %s failed: %s", cfg.ID, err)

    ok, err = send_via_resend(subject=subject, body_html=html, recipient=recipient_email, attachments=attachments)
    if ok:
        return True, "Sent via Resend fallback"
    return False, err or "Failed to send — no working email configuration."


def send_po_upload_notification(
    db: Session,
    *,
    vendor_id: int,
    po_row,
    assignment,
    customer,
    project,
    lead: Optional[object],
    quotation_type: Optional[str] = None,
    action_label: str,
    uploaded_by_label: str,
) -> list:
    """Best-effort — resolves recipients, sends one independent email per
    recipient (with the PO PDF attached), returns
    [(recipient_email, sent, message), ...] for logging/diagnostics.
    Silently returns [] if the PO_UPLOADED rule has no recipients
    configured (a valid, expected state)."""
    recipients = resolve_recipients(db, vendor_id, "PO_UPLOADED", lead=lead)
    if not recipients:
        return []

    body_html, subject = get_template_for_send(db, vendor_id, "PURCHASE_ORDER_UPLOADED_NOTIFICATION")
    if not body_html:
        log.warning("send_po_upload_notification: no PURCHASE_ORDER_UPLOADED_NOTIFICATION template configured")
        return [(e.EMAIL, False, "No email template configured") for e in recipients]

    lead_owner_name = ""
    if lead is not None and lead.ASSIGNED_TO_ID:
        owner = db.query(Employee).filter(Employee.ID == lead.ASSIGNED_TO_ID).first()
        lead_owner_name = owner.NAME if owner else ""

    from app.services.po_service import read_po_file_bytes  # local import — avoids a service/service import cycle at module load time
    pdf_bytes = read_po_file_bytes(po_row.FILE_URL)
    attachments = None
    if pdf_bytes:
        attachments = [{
            "filename": po_row.FILE_NAME or "Purchase-Order.pdf",
            "content": pdf_bytes,
            "content_type": "application/pdf",
        }]

    # Payment context — always the CURRENT totals (never a value passed in
    # from the caller), so this is accurate whether or not a payment was
    # part of this specific upload. "Payment Amount"/"Payment Percentage"
    # reflect the latest recorded payment, if any.
    accepted_quotation = get_accepted_quotation(db, assignment)
    payment_summary = compute_payment_summary(db, assignment, accepted_quotation=accepted_quotation)
    latest_payment = (
        db.query(CustomerProjectPayment)
        .filter(CustomerProjectPayment.CUSTOMER_PROJECT_ASSIGNMENT_ID == assignment.ID)
        .order_by(CustomerProjectPayment.CREATED_AT.desc())
        .first()
    )
    view_payment_url = f"{_frontend_url()}/customer-payments?customer_id={customer.ID}&lead_id={lead.ID if lead else ''}"

    branding = company_branding_variables(db, vendor_id)
    shared_variables = {
        **branding,
        "our_company_name": branding["company_name"],
        "customer_name": customer.NAME or "",
        "company_name": customer.COMPANY_NAME or "",
        "lead_owner_name": lead_owner_name,
        "project_name": project.NAME or "",
        "quotation_type_label": quotation_type_label(quotation_type) if quotation_type else "",
        "action_label": action_label,
        "action_label_lower": action_label.lower(),
        "uploaded_by_label": uploaded_by_label,
        "comments": po_row.COMMENTS or "No comments provided.",
        "file_name": po_row.FILE_NAME or "",
        "payment_amount": f"{float(latest_payment.PAYMENT_AMOUNT):,.2f}" if latest_payment else "Not yet recorded",
        "payment_percentage": f"{float(latest_payment.PAYMENT_PERCENTAGE):,.2f}%" if latest_payment else "—",
        # total_paid/remaining_balance are already quantity-aware for free —
        # compute_payment_summary() multiplies the accepted quotation price
        # by the assignment's QUANTITY before computing these. quantity/
        # price_per_unit are exposed too (not currently referenced by any
        # template placeholder) so a future template can surface them.
        "quantity": str(payment_summary["quantity"]),
        "price_per_unit": f"{float(payment_summary['price_per_unit']):,.2f}",
        "total_paid": f"{float(payment_summary['total_paid']):,.2f}",
        "remaining_balance": f"{float(payment_summary['remaining_balance']):,.2f}",
        "view_payment_url": view_payment_url,
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
                db, vendor_id, emp.EMAIL, rendered_subject, rendered_html, attachments=attachments,
                logo_bytes=recipient_logo_bytes, logo_content_type=recipient_logo_content_type,
            )
        except Exception as e:
            ok, message = False, f"{type(e).__name__}: {e}"
            log.exception("send_po_upload_notification: failed sending to %s", emp.EMAIL)
        if not ok:
            log.warning("send_po_upload_notification: failed sending to %s: %s", emp.EMAIL, message)
        results.append((emp.EMAIL, ok, message))
    return results


def send_po_requested_notification(
    db: Session,
    *,
    vendor_id: int,
    quotation,
    assignment,
    customer,
    project,
    lead: Optional[object],
    request_mode_label: str,
) -> list:
    """Best-effort — fired whenever a Purchase Order Request email is sent
    to the customer (automatically on quotation approval, or manually —
    including a "Send PO Request Again" resend). Resolves recipients via
    the PO_REQUESTED Email Send Rule event, sends one independent email per
    recipient, returns [(recipient_email, sent, message), ...] for
    diagnostics. Silently returns [] if the rule has no recipients
    configured (a valid, expected state)."""
    recipients = resolve_recipients(db, vendor_id, "PO_REQUESTED", lead=lead)
    if not recipients:
        return []

    body_html, subject = get_template_for_send(db, vendor_id, "PURCHASE_ORDER_REQUESTED_NOTIFICATION")
    if not body_html:
        log.warning("send_po_requested_notification: no PURCHASE_ORDER_REQUESTED_NOTIFICATION template configured")
        return [(e.EMAIL, False, "No email template configured") for e in recipients]

    lead_owner_name = ""
    if lead is not None and lead.ASSIGNED_TO_ID:
        owner = db.query(Employee).filter(Employee.ID == lead.ASSIGNED_TO_ID).first()
        lead_owner_name = owner.NAME if owner else ""

    branding = company_branding_variables(db, vendor_id)
    shared_variables = {
        **branding,
        "our_company_name": branding["company_name"],
        "customer_name": customer.NAME or "",
        "company_name": customer.COMPANY_NAME or "",
        "contact_name": (lead.CONTACT_NAME if lead else None) or customer.NAME or "",
        "contact_email": (lead.CONTACT_EMAIL if lead else None) or customer.EMAIL or "",
        "contact_phone": (lead.CONTACT_MOBILE if lead else None) or customer.PHONE_NUMBER or "",
        "lead_owner_name": lead_owner_name,
        "project_name": project.NAME or "",
        "quotation_type_label": quotation_type_label(quotation.QUOTATION_TYPE),
        "quoted_price": f"{float(quotation.QUOTED_PRICE):,.2f}",
        "request_mode_label": request_mode_label,
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
            log.exception("send_po_requested_notification: failed sending to %s", emp.EMAIL)
        if not ok:
            log.warning("send_po_requested_notification: failed sending to %s: %s", emp.EMAIL, message)
        results.append((emp.EMAIL, ok, message))
    return results
