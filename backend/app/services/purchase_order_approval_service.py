"""
Approve/Reject a PurchaseOrderApprovalBatch (spec Part 14) — the
consolidated decision point for a low-stock reorder proposal
(inventory_reorder_service.evaluate_and_propose_reorder()) that may
contain several per-supplier DRAFT PurchaseOrder rows.

Mirrors production_scheduling_service.approve_schedule()/
reject_and_reschedule()'s shape exactly: row-lock the batch, idempotent
on a repeat call, flush-only (caller commits).

Approve -> every DRAFT PO in the batch is sent to its supplier (reusing
the exact same status-transition + email-send steps as the existing
manual POST /purchase-orders/{id}/send endpoint in routes/purchase_
order.py, imported lazily to avoid a route<->service import cycle).
Reject -> every DRAFT PO in the batch is CANCELLED with the batch's
reject reason; nothing is emailed.
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import PurchaseOrderApprovalBatch, PurchaseOrder

log = logging.getLogger(__name__)


def _get_batch_for_update(db: Session, batch_id: str) -> PurchaseOrderApprovalBatch:
    batch = (
        db.query(PurchaseOrderApprovalBatch)
        .filter(PurchaseOrderApprovalBatch.ID == batch_id)
        .with_for_update()
        .first()
    )
    if not batch:
        raise ValueError("Purchase order approval batch not found.")
    return batch


def approve_batch(db: Session, batch_id: str, approved_by_employee_id: str) -> PurchaseOrderApprovalBatch:
    batch = _get_batch_for_update(db, batch_id)
    if batch.STATUS == "APPROVED":
        return batch  # idempotent — already approved
    if batch.STATUS != "PROPOSED":
        raise ValueError(f"This batch is already {batch.STATUS} and cannot be approved.")

    # Lazy imports — routes.purchase_order may itself import inventory
    # services at module scope; importing it back at module load time here
    # would risk a cycle, so defer to call time (same pattern already used
    # by record_movement()'s forward reference to inventory_reorder_service).
    from app.routes.purchase_order import _send_po_email, _log_activity

    pos = db.query(PurchaseOrder).filter(PurchaseOrder.BATCH_ID == batch.ID).all()
    for po in pos:
        if po.STATUS != "DRAFT":
            continue  # already sent/cancelled individually — leave as-is
        po.STATUS = "SENT"
        po.SENT_AT = datetime.utcnow()
        _log_activity(db, po.ID, "SENT", detail="Approved via low-stock reorder batch review")
        db.flush()

        ok, msg = _send_po_email(db, po)
        po.LAST_EMAIL_STATUS = msg[:200] if msg else None
        if ok:
            po.EMAIL_SENT_AT = datetime.utcnow()
            po.EMAIL_SENT_COUNT = (po.EMAIL_SENT_COUNT or 0) + 1
            _log_activity(db, po.ID, "EMAIL_SENT", detail=f"Email delivered to supplier ({msg})")
        else:
            _log_activity(db, po.ID, "EMAIL_FAILED", detail=f"Email send failed: {msg}")

    batch.STATUS = "APPROVED"
    batch.APPROVED_BY_ID = approved_by_employee_id
    batch.APPROVED_AT = datetime.utcnow()
    db.flush()
    return batch


def reject_batch(
    db: Session, batch_id: str, rejected_by_employee_id: str, reason: Optional[str] = None,
) -> PurchaseOrderApprovalBatch:
    batch = _get_batch_for_update(db, batch_id)
    if batch.STATUS == "REJECTED":
        return batch  # idempotent — already rejected
    if batch.STATUS != "PROPOSED":
        raise ValueError(f"This batch is already {batch.STATUS} and cannot be rejected.")

    from app.routes.purchase_order import _log_activity

    cancel_reason = reason or "Rejected via low-stock reorder batch review"
    pos = db.query(PurchaseOrder).filter(PurchaseOrder.BATCH_ID == batch.ID).all()
    for po in pos:
        if po.STATUS != "DRAFT":
            continue
        po.STATUS = "CANCELLED"
        po.CANCELLED_AT = datetime.utcnow()
        po.CANCEL_REASON = cancel_reason
        _log_activity(db, po.ID, "CANCELLED", detail=cancel_reason)

    batch.STATUS = "REJECTED"
    batch.REJECTED_BY_ID = rejected_by_employee_id
    batch.REJECTED_AT = datetime.utcnow()
    batch.REJECT_REASON = reason
    db.flush()
    return batch
