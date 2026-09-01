"""
Internal "Purchase Order Approval Needed" notification — fired once per
PurchaseOrderApprovalBatch created by inventory_reorder_service.
evaluate_and_propose_reorder(). Structured identically to
production_notification_service.send_production_schedule_approval_
notification(): same recipient resolution (email_send_rule_service.
resolve_recipients against the PURCHASE_ORDER_APPROVAL_NEEDED event),
same TEMPLATE_CATALOG content system, one email per resolved recipient
plus one in-app Notification row each.
"""

import logging
import os

from sqlalchemy.orm import Session

from app.models.models import Notification, PurchaseOrderApprovalBatch, PurchaseOrder, PurchaseOrderLine
from app.models.supplier_models import Supplier
from app.services.email_send_rule_service import resolve_recipients
from app.services.email_template_service import get_template_for_send
from app.services.email_logo_service import build_email_logo
from app.services.company_settings_service import get_company_settings
from app.services.lead_quotation_service import company_branding_variables
from app.services.production_notification_service import _render_and_send

log = logging.getLogger(__name__)


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _build_supplier_groups_table_html(db: Session, batch: PurchaseOrderApprovalBatch) -> str:
    pos = db.query(PurchaseOrder).filter(PurchaseOrder.BATCH_ID == batch.ID).order_by(PurchaseOrder.ID).all()
    if not pos:
        return "<p style='color:#94a3b8;'>No purchase orders in this batch.</p>"

    blocks = []
    for po in pos:
        supplier = db.query(Supplier).filter(Supplier.ID == po.SUPPLIER_ID).first()
        supplier_name = supplier.COMPANY_NAME if supplier else "Unknown Supplier"
        lines = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.PO_ID == po.ID).order_by(PurchaseOrderLine.SORT_ORDER).all()

        rows_html = "".join(
            "<tr>"
            f"<td style='padding:8px;border:1px solid #e5e7eb;'>{l.DESCRIPTION or '—'}</td>"
            f"<td style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>{float(l.QUANTITY or 0):g} {l.UNIT or ''}</td>"
            f"<td style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>&#8377;{float(l.UNIT_PRICE or 0):,.2f}</td>"
            f"<td style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>&#8377;{float(l.LINE_TOTAL or 0):,.2f}</td>"
            "</tr>"
            for l in lines
        )

        blocks.append(
            "<div style='margin:0 0 20px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;'>"
            f"<div style='background:#f8fafc;padding:12px 16px;font-weight:700;color:#0f172a;'>"
            f"{supplier_name} &middot; PO {po.PO_NUMBER}"
            "</div>"
            "<table style='width:100%;border-collapse:collapse;'>"
            "<thead><tr>"
            "<th style='padding:8px;border:1px solid #e5e7eb;text-align:left;'>Product</th>"
            "<th style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>Qty</th>"
            "<th style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>Unit Price</th>"
            "<th style='padding:8px;border:1px solid #e5e7eb;text-align:right;'>Line Total</th>"
            "</tr></thead>"
            f"<tbody>{rows_html}</tbody>"
            "</table>"
            f"<div style='padding:10px 16px;text-align:right;font-weight:700;color:#047857;'>"
            f"Grand Total: &#8377;{float(po.GRAND_TOTAL or 0):,.2f}"
            "</div>"
            "</div>"
        )

    return "".join(blocks)


def send_purchase_order_approval_notification(db: Session, batch: PurchaseOrderApprovalBatch) -> list:
    """Best-effort — resolves recipients via the
    PURCHASE_ORDER_APPROVAL_NEEDED Email Send Rule event, sends one
    independent email per recipient plus one in-app Notification row
    each. Returns [(recipient_email, sent, message), ...] for
    diagnostics. Silently returns [] if the rule has no recipients
    configured (a valid, expected state — mirrors every other event)."""
    vendor_id = batch.VENDOR_ID
    recipients = resolve_recipients(db, vendor_id, "PURCHASE_ORDER_APPROVAL_NEEDED", lead=None)
    if not recipients:
        return []

    body_html, subject_tpl = get_template_for_send(db, vendor_id, "PURCHASE_ORDER_APPROVAL")
    if not body_html:
        log.warning("send_purchase_order_approval_notification: no PURCHASE_ORDER_APPROVAL template configured")
        return [(e.EMAIL, False, "No email template configured") for e in recipients]

    pos = db.query(PurchaseOrder).filter(PurchaseOrder.BATCH_ID == batch.ID).all()
    supplier_count = len({po.SUPPLIER_ID for po in pos})
    supplier_groups_table_html = _build_supplier_groups_table_html(db, batch)
    review_batch_url = f"{_frontend_url()}/purchase-order-approval/{batch.ID}"

    company = get_company_settings(db, vendor_id)
    logo_bytes, _logo_content_type, _logo_html = build_email_logo(company)
    branding = company_branding_variables(db, vendor_id)

    subject = subject_tpl.replace("{{supplier_count}}", str(supplier_count))

    shared_variables = {
        **branding,
        "supplier_count": str(supplier_count),
        "trigger_note": batch.TRIGGER_NOTE or "",
        "supplier_groups_table_html": supplier_groups_table_html,
        "review_batch_url": review_batch_url,
    }

    results = []
    for emp in recipients:
        if not emp.EMAIL:
            continue
        variables = {**shared_variables, "recipient_name": emp.NAME or ""}
        ok, message = _render_and_send(db, vendor_id, company, logo_bytes, body_html, subject, emp.EMAIL, variables)
        if not ok:
            log.warning("send_purchase_order_approval_notification: failed sending to %s: %s", emp.EMAIL, message)
        results.append((emp.EMAIL, ok, message))

        db.add(Notification(
            VENDOR_ID=vendor_id,
            EMPLOYEE_ID=emp.ID,
            TYPE="WARNING",
            TITLE="Purchase Order Approval Needed",
            MESSAGE=f"{supplier_count} auto-generated supplier purchase order(s) are awaiting your approval.",
            REF_TYPE="PURCHASE_ORDER_APPROVAL_BATCH",
        ))
    db.flush()
    return results
