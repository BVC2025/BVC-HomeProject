"""
Low-stock -> supplier-grouped Purchase Order automation (spec Parts 12/13).

evaluate_and_propose_reorder() is called from two places:
  - inventory_automation_service.record_movement(), right after STATUS is
    recomputed, whenever a movement pushes a product into LOW_STOCK/
    OUT_OF_STOCK (best-effort, wrapped in try/except there — a reorder
    failure must never block the stock movement that triggered it).
  - inventory.py's set_min_stock(), when a threshold edit alone (no
    movement) pushes a product into shortage.

For every InventoryStock row currently at or below its MIN_QTY, this
resolves a supplier (PurchaseRecommendation -> top SupplierRanking ->
preferred SupplierProduct -> cheapest active SupplierProduct -> none),
computes a reorder quantity, groups products by resolved supplier (one
DRAFT PurchaseOrder per supplier), and wraps the created POs in one
PurchaseOrderApprovalBatch for a single consolidated Approve/Reject
decision — see purchase_order_approval_service.py.

Idempotent: a product already sitting on a DRAFT PO inside a still-
PROPOSED batch is skipped, so calling this repeatedly (e.g. once per
STOCK_OUT movement) never creates duplicate reorder proposals for the
same shortage.
"""

import logging
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.models.inventory_models import InventoryStock
from app.models.supplier_models import SupplierProduct, SupplierRanking, PurchaseRecommendation
from app.models.models import PurchaseOrder, PurchaseOrderLine, PurchaseOrderApprovalBatch

log = logging.getLogger(__name__)


def resolve_supplier_for_product(db: Session, vendor_id: int, product_id: str) -> Optional[dict]:
    """Best-supplier resolution for a reorder line. Returns
    {"supplier_id": int, "supplier_product": SupplierProduct} or None if
    no active SupplierProduct exists for this product at all."""

    rec = (
        db.query(PurchaseRecommendation)
        .filter(
            PurchaseRecommendation.VENDOR_ID == vendor_id,
            PurchaseRecommendation.PRODUCT_ID == product_id,
            PurchaseRecommendation.IS_ACTIVE.is_(True),
        )
        .first()
    )
    if rec:
        sp = db.query(SupplierProduct).filter(
            SupplierProduct.ID == rec.SUPPLIER_PRODUCT_ID, SupplierProduct.STATUS == "ACTIVE"
        ).first()
        if sp:
            return {"supplier_id": rec.RECOMMENDED_SUPPLIER_ID, "supplier_product": sp}

    top_rank = (
        db.query(SupplierRanking)
        .filter(SupplierRanking.VENDOR_ID == vendor_id, SupplierRanking.PRODUCT_ID == product_id)
        .order_by(SupplierRanking.RANK.asc())
        .first()
    )
    if top_rank:
        sp = db.query(SupplierProduct).filter(
            SupplierProduct.ID == top_rank.SUPPLIER_PRODUCT_ID, SupplierProduct.STATUS == "ACTIVE"
        ).first()
        if sp:
            return {"supplier_id": top_rank.SUPPLIER_ID, "supplier_product": sp}

    preferred = (
        db.query(SupplierProduct)
        .filter(
            SupplierProduct.VENDOR_ID == vendor_id, SupplierProduct.PRODUCT_ID == product_id,
            SupplierProduct.STATUS == "ACTIVE", SupplierProduct.IS_PREFERRED.is_(True),
        )
        .order_by(SupplierProduct.UNIT_PRICE.asc())
        .first()
    )
    if preferred:
        return {"supplier_id": preferred.SUPPLIER_ID, "supplier_product": preferred}

    cheapest = (
        db.query(SupplierProduct)
        .filter(SupplierProduct.VENDOR_ID == vendor_id, SupplierProduct.PRODUCT_ID == product_id,
                SupplierProduct.STATUS == "ACTIVE")
        .order_by(SupplierProduct.UNIT_PRICE.asc())
        .first()
    )
    if cheapest:
        return {"supplier_id": cheapest.SUPPLIER_ID, "supplier_product": cheapest}

    return None


def _compute_reorder_qty(stock: InventoryStock, moq: float) -> float:
    if stock.MAX_QTY and float(stock.MAX_QTY) > float(stock.CURRENT_QTY or 0):
        qty = float(stock.MAX_QTY) - float(stock.CURRENT_QTY or 0)
    else:
        qty = max(0.0, float(stock.MIN_QTY or 0) - float(stock.CURRENT_QTY or 0))
    if qty <= 0:
        qty = float(stock.MIN_QTY or 0) or 1.0
    if moq and moq > qty:
        qty = moq
    return qty


def _products_already_in_open_batch(db: Session, vendor_id: int) -> set:
    rows = (
        db.query(PurchaseOrderLine.PRODUCT_ID)
        .join(PurchaseOrder, PurchaseOrder.ID == PurchaseOrderLine.PO_ID)
        .join(PurchaseOrderApprovalBatch, PurchaseOrderApprovalBatch.ID == PurchaseOrder.BATCH_ID)
        .filter(PurchaseOrderApprovalBatch.STATUS == "PROPOSED", PurchaseOrder.VENDOR_ID == vendor_id)
        .all()
    )
    return {r[0] for r in rows if r[0]}


def evaluate_and_propose_reorder(
    db: Session, vendor_id: int, product_ids: Optional[list] = None,
    triggered_by_employee_id: Optional[str] = None,
) -> Optional[PurchaseOrderApprovalBatch]:
    """Evaluate low/out-of-stock products (optionally restricted to
    `product_ids`) and propose a supplier-grouped PurchaseOrderApprovalBatch.
    Returns None if there is nothing new to propose. Caller commits —
    this function only flushes."""

    q = db.query(InventoryStock).filter(
        InventoryStock.VENDOR_ID == vendor_id,
        InventoryStock.STATUS.in_(("LOW_STOCK", "OUT_OF_STOCK")),
    )
    if product_ids:
        q = q.filter(InventoryStock.PRODUCT_ID.in_(product_ids))
    candidates = q.all()
    if not candidates:
        return None

    already_open = _products_already_in_open_batch(db, vendor_id)
    candidates = [c for c in candidates if c.PRODUCT_ID not in already_open]
    if not candidates:
        return None

    by_supplier: dict = {}
    unassigned_names = []

    for stock in candidates:
        resolution = resolve_supplier_for_product(db, vendor_id, stock.PRODUCT_ID)
        if not resolution:
            product = stock.product
            unassigned_names.append(product.PRODUCT_NAME if product else stock.PRODUCT_ID)
            continue
        sp = resolution["supplier_product"]
        reorder_qty = _compute_reorder_qty(stock, float(sp.MOQ or 0))
        by_supplier.setdefault(resolution["supplier_id"], []).append((stock, sp, reorder_qty))

    if not by_supplier:
        if unassigned_names:
            log.warning(
                "evaluate_and_propose_reorder: no supplier could be resolved for any of the "
                "%d low-stock product(s) for vendor %s: %s",
                len(unassigned_names), vendor_id, ", ".join(unassigned_names),
            )
        return None

    # Lazy imports — avoid a module-load-time cycle with routes.purchase_order
    # (which itself may import inventory services), matching the established
    # pattern already used by record_movement()'s own forward reference.
    from app.routes.purchase_order import _next_po_number, _recompute_po_totals, _log_activity

    batch = PurchaseOrderApprovalBatch(
        VENDOR_ID=vendor_id,
        STATUS="PROPOSED",
        TRIGGER_TYPE="LOW_STOCK",
        TRIGGER_NOTE=(
            "Could not resolve a supplier for: " + ", ".join(unassigned_names)
        ) if unassigned_names else None,
    )
    db.add(batch)
    db.flush()

    created_pos = []
    for supplier_id, items in by_supplier.items():
        po = PurchaseOrder(
            PO_NUMBER=_next_po_number(db),
            SUPPLIER_ID=supplier_id,
            VENDOR_ID=vendor_id,
            STATUS="DRAFT",
            BATCH_ID=batch.ID,
            PO_DATE=date.today(),
            PREPARED_BY=triggered_by_employee_id,
            NOTES="Auto-generated by the low-stock reorder automation.",
        )
        db.add(po)
        db.flush()

        for i, (stock, sp, reorder_qty) in enumerate(items):
            product = stock.product
            unit_price = float(sp.UNIT_PRICE or 0)
            db.add(PurchaseOrderLine(
                PO_ID=po.ID,
                PRODUCT_ID=stock.PRODUCT_ID,
                DESCRIPTION=product.PRODUCT_NAME if product else None,
                HSN_CODE=product.HSN_CODE if product else None,
                QUANTITY=reorder_qty,
                UNIT=product.UNIT if product else "PCS",
                UNIT_PRICE=unit_price,
                LINE_TOTAL=round(reorder_qty * unit_price, 2),
                SORT_ORDER=i,
            ))
        db.flush()
        _recompute_po_totals(db, po)
        _log_activity(db, po.ID, "CREATED", detail="Auto-generated by the low-stock reorder automation.")
        created_pos.append(po)

    db.flush()

    try:
        from app.services.inventory_reorder_notification_service import send_purchase_order_approval_notification
        send_purchase_order_approval_notification(db, batch)
    except Exception:
        log.exception("evaluate_and_propose_reorder: approval notification failed for batch %s", batch.ID)

    return batch
