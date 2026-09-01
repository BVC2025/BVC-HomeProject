"""
Purchase Order Approval Batches — HTTP surface for the low-stock
reorder propose -> approve/reject workflow (spec Parts 12-14).
Structural mirror of routes/production_schedule.py's own approve/reject
endpoints. Reuses the existing purchase_order.view/purchase_order.manage
RBAC codes (purchase_order.manage's catalogue description already reads
"Create/approve/GRN") rather than adding new ones.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import require
from app.models.models import PurchaseOrderApprovalBatch, PurchaseOrder, Employee
from app.services.purchase_order_approval_service import approve_batch, reject_batch
from app.services.inventory_reorder_service import evaluate_and_propose_reorder

log = logging.getLogger(__name__)

router = APIRouter(tags=["Purchase Order Approval"])


def _iso(v):
    return v.isoformat() if v else None


def _serialize_batch(db: Session, batch: PurchaseOrderApprovalBatch) -> dict:
    from app.routes.purchase_order import _serialize_po  # lazy — avoid route<->route cycle at import time

    approver = db.query(Employee).filter(Employee.ID == batch.APPROVED_BY_ID).first() if batch.APPROVED_BY_ID else None
    rejecter = db.query(Employee).filter(Employee.ID == batch.REJECTED_BY_ID).first() if batch.REJECTED_BY_ID else None
    pos = db.query(PurchaseOrder).filter(PurchaseOrder.BATCH_ID == batch.ID).order_by(PurchaseOrder.ID).all()

    return {
        "id": batch.ID,
        "vendor_id": batch.VENDOR_ID,
        "status": batch.STATUS,
        "trigger_type": batch.TRIGGER_TYPE,
        "trigger_note": batch.TRIGGER_NOTE,
        "approved_by_name": approver.NAME if approver else None,
        "approved_at": _iso(batch.APPROVED_AT),
        "rejected_by_name": rejecter.NAME if rejecter else None,
        "rejected_at": _iso(batch.REJECTED_AT),
        "reject_reason": batch.REJECT_REASON,
        "created_at": _iso(batch.CREATED_AT),
        "purchase_orders": [_serialize_po(db, po, include_lines=True) for po in pos],
    }


@router.get("/purchase-order-approvals", dependencies=[Depends(require("purchase_order.view"))])
def list_purchase_order_approvals(
    status: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(1),
    db: Session = Depends(get_db),
):
    q = db.query(PurchaseOrderApprovalBatch).filter(PurchaseOrderApprovalBatch.VENDOR_ID == vendor_id)
    if status:
        q = q.filter(PurchaseOrderApprovalBatch.STATUS == status.upper())
    rows = q.order_by(PurchaseOrderApprovalBatch.CREATED_AT.desc()).all()
    return [_serialize_batch(db, r) for r in rows]


@router.get("/purchase-order-approvals/{batch_id}", dependencies=[Depends(require("purchase_order.view"))])
def get_purchase_order_approval(batch_id: str, db: Session = Depends(get_db)):
    batch = db.query(PurchaseOrderApprovalBatch).filter(PurchaseOrderApprovalBatch.ID == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Purchase order approval batch not found")
    return _serialize_batch(db, batch)


class EvaluateReorderBody(BaseModel):
    vendor_id: int = 1
    product_ids: Optional[list] = None


@router.post("/purchase-order-approvals/evaluate", dependencies=[Depends(require("purchase_order.manage"))])
def trigger_reorder_evaluation(body: EvaluateReorderBody, db: Session = Depends(get_db)):
    """Manual (re)trigger of the low-stock reorder scan — normally this
    fires automatically off record_movement()/set_min_stock(); this
    exists for an on-demand re-check from the Inventory page."""
    try:
        batch = evaluate_and_propose_reorder(db, body.vendor_id, product_ids=body.product_ids)
    except Exception as e:
        log.exception("trigger_reorder_evaluation: failed for vendor %s", body.vendor_id)
        raise HTTPException(status_code=400, detail=str(e))
    if not batch:
        db.rollback()
        return {"message": "No new reorder proposal — nothing is currently low on stock, or a proposal already exists.", "batch": None}
    db.commit()
    return {"message": "Reorder proposal created", "batch": _serialize_batch(db, batch)}


@router.post("/purchase-order-approvals/{batch_id}/approve", dependencies=[Depends(require("purchase_order.manage"))])
def approve_purchase_order_batch(batch_id: str, db: Session = Depends(get_db), admin=Depends(require("purchase_order.manage"))):
    try:
        batch = approve_batch(db, batch_id, approved_by_employee_id=admin.get("employee_id"))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _serialize_batch(db, batch)


class RejectBatchBody(BaseModel):
    reason: Optional[str] = None


@router.post("/purchase-order-approvals/{batch_id}/reject", dependencies=[Depends(require("purchase_order.manage"))])
def reject_purchase_order_batch(
    batch_id: str, body: RejectBatchBody, db: Session = Depends(get_db),
    admin=Depends(require("purchase_order.manage")),
):
    try:
        batch = reject_batch(db, batch_id, rejected_by_employee_id=admin.get("employee_id"), reason=body.reason)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    return _serialize_batch(db, batch)
