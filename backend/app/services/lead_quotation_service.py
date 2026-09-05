"""Lead-conversion quotation workflow — builds the customer-facing PDF (by
reusing the Project's own ProjectQuotationTemplate, unmodified, with the
real customer + actual quoted price overlaid on an in-memory-only copy of
its content) and sends it via the existing EmailTemplate/vendor-SMTP
architecture (mirroring supplier_onboarding.py's/employee.py's onboarding
email pattern exactly). Never touches the stored ProjectQuotationTemplate
row, ProjectPricing, or the existing email infrastructure's own callers."""

import copy
import json
import logging
import os
import secrets
from types import SimpleNamespace
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import ProjectQuotationTemplate, VendorEmailConfig, CustomerProjectPurchaseOrder
from app.services.company_settings_service import get_company_settings, format_full_address
from app.services.project_quotation_service import (
    build_default_quotation_content,
    default_quotation_number,
    render_quotation_html,
    render_quotation_pdf_bytes,
)
from app.services.email_template_service import get_template_for_send, render_template
from app.services.email_service import send_via_vendor_smtp, send_via_resend
from app.services.email_logo_service import build_email_logo, apply_cid_logo, extract_cid_logo
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)


def _backend_url() -> str:
    return os.getenv("BACKEND_URL", "").rstrip("/") or "http://192.168.1.10:8001"


def build_action_links(action_token: str) -> tuple:
    """(accept_link, reject_link) for the quotation email's buttons —
    matches leave_service.py's _backend_url() convention for the same
    kind of public, token-secured email action link."""
    base = _backend_url()
    return (
        f"{base}/quotation-actions/{action_token}/accept",
        f"{base}/quotation-actions/{action_token}/reject",
    )


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def get_or_create_purchase_order_row(db: Session, assignment) -> CustomerProjectPurchaseOrder:
    """Get-or-create the (at most one) CustomerProjectPurchaseOrder row for
    this assignment, generating UPLOAD_TOKEN once if missing. Called the
    first time a Purchase Order Request email is sent (auto or manual) —
    the row then exists and is reachable via its own token for every
    subsequent upload/re-upload, whether or not the request email itself
    succeeded. Does not commit — caller owns the transaction boundary."""
    row = db.query(CustomerProjectPurchaseOrder).filter(
        CustomerProjectPurchaseOrder.ASSIGNMENT_ID == assignment.ID
    ).first()
    if not row:
        row = CustomerProjectPurchaseOrder(ASSIGNMENT_ID=assignment.ID)
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            # Idempotent under a race — unlike convert_lead()'s LEAD_ID
            # uniqueness (a genuine "may only happen once" guarantee where
            # a race is a real 409), two near-simultaneous PO Request sends
            # for the same assignment should both just resolve to the one
            # row, not error out.
            db.rollback()
            row = db.query(CustomerProjectPurchaseOrder).filter(
                CustomerProjectPurchaseOrder.ASSIGNMENT_ID == assignment.ID
            ).first()
    if row and not row.UPLOAD_TOKEN:
        row.UPLOAD_TOKEN = secrets.token_urlsafe(32)
        db.flush()
    return row


def build_po_upload_link(upload_token: str) -> str:
    """Public customer-facing link to the React PO-upload page — points at
    FRONTEND_URL (not BACKEND_URL/build_action_links' server-rendered-HTML
    convention), matching the existing supplier_onboarding.py registration-
    link pattern, since /po-upload/:token is a real React route, not a
    one-shot GET-click HTML confirmation page."""
    return f"{_frontend_url()}/po-upload/{upload_token}"


def _get_or_build_template_row(db: Session, project) -> ProjectQuotationTemplate:
    """Read-only variant of project_quotation.py's _get_or_create_quotation —
    returns the persisted template if one exists; otherwise builds an
    in-memory-only default (never commits) so a project that's never been
    opened in the quotation editor can still be quoted from immediately."""
    row = db.query(ProjectQuotationTemplate).filter(
        ProjectQuotationTemplate.PROJECT_ID == project.ID
    ).first()
    if row:
        return row

    company = get_company_settings(db, project.VENDOR_ID)
    content = build_default_quotation_content(project, company)
    return SimpleNamespace(
        CONTENT_JSON=json.dumps(content),
        QUOTATION_NUMBER=default_quotation_number(project, company, now_ist().date()),
        QUOTATION_DATE=now_ist().date(),
    )


def company_branding_variables(db: Session, vendor_id: int) -> dict:
    """Shared footer/header variables used by every email this module
    sends — matches the exact variable set employee.py's onboarding email
    already uses (company_name/support_email/company_address/
    contact_number/website/logo_html)."""
    company = get_company_settings(db, vendor_id)
    return {
        "company_name": company.LEGAL_NAME or "",
        "support_email": company.EMAIL or "",
        "company_address": format_full_address(company),
        "contact_number": company.PHONE or "",
        "website": company.WEBSITE or "",
        "logo_html": build_email_logo(company)[2],
    }


def _format_customer_address(customer) -> str:
    return ", ".join(filter(None, [
        customer.ADDRESS, customer.CITY, customer.STATE, customer.PINCODE, customer.COUNTRY_ISO,
    ]))


def build_customer_quotation_content(template_row, customer, quoted_price) -> dict:
    """Deep-copies the template's CONTENT_JSON and overlays the real
    customer identity + the actual quoted price — entirely in-memory, the
    source template_row/its DB row (if any) is never written to."""
    content = copy.deepcopy(json.loads(template_row.CONTENT_JSON))

    customer_name = customer.NAME or ""
    customer_address = _format_customer_address(customer)

    customer_info = content.get("customerInfo")
    if customer_info is not None:
        customer_info["namePlaceholder"] = customer_name
        customer_info["addressPlaceholder"] = customer_address

    for key in ("introHtml", "termsHtml", "notesHtml", "footerHtml"):
        html = content.get(key)
        if html:
            content[key] = html.replace("{{customer_name}}", customer_name).replace(
                "{{customer_address}}", customer_address
            )

    # Same field path sync_final_price_into_quotation() uses on the
    # persisted template — mirrored here on this copy only, with the
    # actual quoted price, not ProjectPricing.FINAL_PRICE.
    for section in content.get("sections", []):
        if section.get("type") == "table" and section.get("rows"):
            section["rows"][0]["unitPrice"] = float(quoted_price)
            break

    return content


def build_customer_quotation_pdf(db: Session, project, customer, quoted_price) -> tuple:
    """Returns (pdf_bytes, error, quotation_number). Reuses
    render_quotation_html()/render_quotation_pdf_bytes() completely
    unmodified — only the in-memory content handed to them is
    customer/price-specific."""
    template_row = _get_or_build_template_row(db, project)
    content = build_customer_quotation_content(template_row, customer, quoted_price)

    company = get_company_settings(db, project.VENDOR_ID)
    snapshot = SimpleNamespace(
        CONTENT_JSON=json.dumps(content),
        QUOTATION_NUMBER=template_row.QUOTATION_NUMBER,
        QUOTATION_DATE=template_row.QUOTATION_DATE,
    )
    html = render_quotation_html(snapshot, company)
    pdf_bytes, err = render_quotation_pdf_bytes(html)
    return pdf_bytes, err, template_row.QUOTATION_NUMBER


def send_quotation_email(
    db: Session,
    *,
    vendor_id: int,
    template_type: str,
    customer,
    project,
    quoted_price,
    accept_link: str,
    reject_link: str,
    pdf_bytes: Optional[bytes],
    quotation_number: Optional[str],
    revision_reason: Optional[str] = None,
    previous_amount=None,
) -> tuple:
    """Mirrors supplier_onboarding.py's/employee.py's onboarding-email
    pattern exactly: get_template_for_send() -> render_template() -> loop
    active VendorEmailConfig rows via send_via_vendor_smtp() -> send_via_resend()
    fallback. Returns (sent: bool, message: str)."""
    if not customer.EMAIL:
        return False, "Customer has no email address on file."

    body_html, subject = get_template_for_send(db, vendor_id, template_type)
    if not body_html:
        return False, f"No email template configured for {template_type}."

    variables = {
        **company_branding_variables(db, vendor_id),
        "customer_name": customer.NAME or "",
        "project_name": project.NAME or "",
        "quoted_amount": f"{float(quoted_price):,.2f}",
        "accept_link": accept_link,
        "reject_link": reject_link,
        "quotation_number": quotation_number or "",
        "revision_reason": revision_reason or "",
        "previous_amount": f"{float(previous_amount):,.2f}" if previous_amount is not None else "",
    }
    rendered_subject, rendered_html = render_template(body_html, subject, variables)

    company = get_company_settings(db, vendor_id)
    logo_bytes, logo_content_type, _logo_html = build_email_logo(company)
    rendered_html = apply_cid_logo(rendered_html, logo_bytes, company)
    if not logo_bytes:
        rendered_html, logo_bytes, logo_content_type = extract_cid_logo(rendered_html)

    attachments = None
    if pdf_bytes:
        filename = f"Quotation-{quotation_number or project.NAME}.pdf".replace(" ", "-")
        attachments = [{"filename": filename, "content": pdf_bytes, "content_type": "application/pdf"}]

    active_cfgs = db.query(VendorEmailConfig).filter(
        VendorEmailConfig.VENDOR_ID == vendor_id, VendorEmailConfig.IS_ACTIVE == True,  # noqa: E712
    ).all()
    for cfg in active_cfgs:
        ok, err, _detail = send_via_vendor_smtp(
            cfg, customer.EMAIL, rendered_subject, rendered_html, attachments=attachments,
            logo_bytes=logo_bytes, logo_content_type=logo_content_type,
        )
        if ok:
            return True, "Sent"
        log.warning("send_quotation_email: vendor SMTP config %s failed: %s", cfg.ID, err)

    ok, err = send_via_resend(
        subject=rendered_subject, body_html=rendered_html, recipient=customer.EMAIL, attachments=attachments,
    )
    if ok:
        return True, "Sent via Resend fallback"
    return False, err or "Failed to send quotation email — no working email configuration."


_QUOTATION_TYPE_LABELS = {"FINAL_QUOTATION": "Final Quotation", "REVISED_QUOTATION": "Revised Quotation"}


def quotation_type_label(quotation_type: str) -> str:
    return _QUOTATION_TYPE_LABELS.get(quotation_type, quotation_type)


def get_quotation_number_for_project(db: Session, project) -> str:
    """Public wrapper around _get_or_build_template_row — for callers
    (e.g. quotation_notification_service) that just need the quotation
    number string, not a full PDF."""
    return _get_or_build_template_row(db, project).QUOTATION_NUMBER or ""


def send_purchase_order_request_email(db: Session, *, vendor_id: int, customer, project, quotation, assignment) -> tuple:
    """Sent when a Final or Revised Quotation is APPROVED (automatically,
    if enabled, or via the manual "Send Purchase Order Request" action) —
    requests the customer provide their Purchase Order for the approved
    quotation, with a link to upload it directly. No PDF attachment on
    this email itself (a request email, unlike the quotation emails).
    Mirrors send_quotation_email()'s send pipeline exactly; the caller
    owns duplicate-prevention (PO_REQUEST_SENT_AT)."""
    if not customer.EMAIL:
        return False, "Customer has no email address on file."

    body_html, subject = get_template_for_send(db, vendor_id, "PURCHASE_ORDER_REQUEST")
    if not body_html:
        return False, "No email template configured for PURCHASE_ORDER_REQUEST."

    template_row = _get_or_build_template_row(db, project)
    approved_at = quotation.RESPONDED_AT.strftime("%d %b %Y, %I:%M %p") if quotation.RESPONDED_AT else ""
    po_row = get_or_create_purchase_order_row(db, assignment)

    variables = {
        **company_branding_variables(db, vendor_id),
        "customer_name": customer.NAME or "",
        "customer_company_name": customer.COMPANY_NAME or "",
        "customer_email": customer.EMAIL or "",
        "customer_phone": customer.PHONE_NUMBER or "",
        "customer_address": _format_customer_address(customer),
        "project_name": project.NAME or "",
        "quotation_number": template_row.QUOTATION_NUMBER or "",
        "quotation_type_label": quotation_type_label(quotation.QUOTATION_TYPE),
        "approved_price": f"{float(quotation.QUOTED_PRICE):,.2f}",
        "approved_at": approved_at,
        "upload_link": build_po_upload_link(po_row.UPLOAD_TOKEN),
    }
    rendered_subject, rendered_html = render_template(body_html, subject, variables)

    company = get_company_settings(db, vendor_id)
    logo_bytes, logo_content_type, _logo_html = build_email_logo(company)
    rendered_html = apply_cid_logo(rendered_html, logo_bytes, company)
    if not logo_bytes:
        rendered_html, logo_bytes, logo_content_type = extract_cid_logo(rendered_html)

    active_cfgs = db.query(VendorEmailConfig).filter(
        VendorEmailConfig.VENDOR_ID == vendor_id, VendorEmailConfig.IS_ACTIVE == True,  # noqa: E712
    ).all()
    for cfg in active_cfgs:
        ok, err, _detail = send_via_vendor_smtp(
            cfg, customer.EMAIL, rendered_subject, rendered_html,
            logo_bytes=logo_bytes, logo_content_type=logo_content_type,
        )
        if ok:
            return True, "Sent"
        log.warning("send_purchase_order_request_email: vendor SMTP config %s failed: %s", cfg.ID, err)

    ok, err = send_via_resend(subject=rendered_subject, body_html=rendered_html, recipient=customer.EMAIL)
    if ok:
        return True, "Sent via Resend fallback"
    return False, err or "Failed to send purchase order request email — no working email configuration."
