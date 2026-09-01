"""
Inventory Automation Service.

Single entry point for ALL stock changes. Every movement (in/out/adjust)
goes through record_movement() which atomically:
  1. Row-locks the InventoryStock row (prevents race conditions)
  2. Validates the movement (e.g. STOCK_OUT cannot exceed current qty)
  3. Computes the new quantity
  4. Creates an InventoryMovement row (append-only ledger)
  5. Updates InventoryStock
  6. Recalculates and persists the stock STATUS
  7. Fires low-stock/out-of-stock notifications + the automatic
     reorder-evaluation pass if thresholds crossed

Callers must commit the session after this function returns.
(db.flush() is called internally so FKs are resolvable within the same tx.)

Keyed by (VENDOR_ID, PRODUCT_ID) directly — InventoryItem (the old
location-scoped intermediate table) has been removed; ProductMaster ->
InventoryStock/InventoryBatch/InventoryMovement is now a direct
relationship. There is no more RESERVED_QTY/AVAILABLE_QTY distinction —
STOCK_OUT validates against CURRENT_QTY directly. There is no more a
weighted-average UNIT_COST on InventoryStock — cost now lives per-batch/
per-movement only; get_latest_unit_cost() is the one place downstream
code should look up "current cost" instead of duplicating this query.
"""

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models.inventory_models import InventoryStock, InventoryMovement, InventoryBatch
from app.utils.datetime_utils import now_ist


# Movement types that ADD to stock
_ADDITIVE = {"STOCK_IN", "TRANSFER_IN", "RETURN", "OPENING_STOCK"}

# Movement types that SUBTRACT from stock
_SUBTRACTIVE = {"STOCK_OUT", "TRANSFER_OUT", "WRITE_OFF"}

# Movement types that SET stock to an absolute value
_ABSOLUTE = {"ADJUSTMENT"}


def get_or_create_stock(db: Session, vendor_id: int, product_id: str) -> InventoryStock:
    stock = (
        db.query(InventoryStock)
        .filter(InventoryStock.VENDOR_ID == vendor_id, InventoryStock.PRODUCT_ID == product_id)
        .with_for_update()
        .first()
    )
    if not stock:
        stock = InventoryStock(
            VENDOR_ID=vendor_id, PRODUCT_ID=product_id,
            CURRENT_QTY=0.0, MIN_QTY=0.0, STATUS="OUT_OF_STOCK",
        )
        db.add(stock)
        db.flush()
    return stock


def record_movement(
    db: Session,
    vendor_id: int,
    product_id: str,
    movement_type: str,
    qty: float,
    performed_by_id: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    reason: Optional[str] = None,
    notes: Optional[str] = None,
    unit_cost: Optional[float] = None,
    allow_negative: bool = False,
) -> InventoryMovement:
    """
    Record a stock movement and update InventoryStock atomically.

    Parameters
    ----------
    db              : SQLAlchemy session (caller commits)
    vendor_id       : tenant ID
    product_id      : ProductMaster.ID
    movement_type   : one of the INV_MOVEMENT_TYPE_ENUM values
    qty             : always POSITIVE for additive/subtractive types;
                       for ADJUSTMENT this is the new ABSOLUTE quantity
    performed_by_id : Employee.ID (optional)
    reference_type  : "PO" | "GRN" | "MANUAL" | "CUSTOMER_PROJECT_ASSIGNMENT" | etc.
    reference_id    : ID of the referenced document (optional)
    batch_id        : InventoryBatch.ID (optional)
    reason          : short reason string (optional)
    notes           : long-form notes (optional)
    unit_cost       : unit cost at time of movement (optional, stored on the movement row only)
    allow_negative  : if True, a STOCK_OUT/TRANSFER_OUT/WRITE_OFF exceeding
                       CURRENT_QTY is allowed to drive it negative instead of
                       raising — used only by inventory_consumption_service
                       (production consumption must never block on a
                       shortage; the reorder automation is the real answer
                       to that). Every other caller keeps the default guard.

    Returns
    -------
    InventoryMovement row (not yet committed)
    """
    if movement_type not in _ADDITIVE and movement_type not in _SUBTRACTIVE and movement_type not in _ABSOLUTE:
        raise HTTPException(status_code=400, detail=f"Unknown movement type: {movement_type}")

    if movement_type not in _ABSOLUTE and qty <= 0:
        raise HTTPException(status_code=400, detail="Movement quantity must be positive")

    stock = get_or_create_stock(db, vendor_id, product_id)

    qty_before = stock.CURRENT_QTY

    if movement_type in _ADDITIVE:
        qty_after = qty_before + qty

    elif movement_type in _SUBTRACTIVE:
        if qty > qty_before and not allow_negative:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock. Requested: {qty}, Available: {qty_before:.2f}",
            )
        qty_after = qty_before - qty

    else:  # ADJUSTMENT — qty is the new absolute value
        qty_after = qty

    movement = InventoryMovement(
        VENDOR_ID=vendor_id,
        PRODUCT_ID=product_id,
        MOVEMENT_TYPE=movement_type,
        QTY=qty,
        QTY_BEFORE=qty_before,
        QTY_AFTER=qty_after,
        UNIT_COST=unit_cost,
        REFERENCE_TYPE=reference_type,
        REFERENCE_ID=reference_id,
        BATCH_ID=batch_id,
        REASON=reason,
        NOTES=notes,
        PERFORMED_BY_ID=performed_by_id,
    )
    db.add(movement)

    stock.CURRENT_QTY = qty_after
    stock.STATUS = _compute_status(qty_after, stock.MIN_QTY, stock.MAX_QTY)

    db.flush()

    _maybe_notify(db, vendor_id, product_id, stock.STATUS)

    if stock.STATUS in ("LOW_STOCK", "OUT_OF_STOCK"):
        try:
            from app.services.inventory_reorder_service import evaluate_and_propose_reorder
            evaluate_and_propose_reorder(db, vendor_id, product_ids=[product_id])
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "record_movement: reorder evaluation failed for product %s", product_id
            )

    return movement


def _compute_status(current_qty: float, min_qty: Optional[float], max_qty: Optional[float]) -> str:
    """Derive IN_STOCK / LOW_STOCK / OUT_OF_STOCK / OVERSTOCK from qty + thresholds."""
    if current_qty <= 0:
        return "OUT_OF_STOCK"
    if min_qty and current_qty <= min_qty:
        return "LOW_STOCK"
    if max_qty and max_qty > 0 and current_qty > max_qty:
        return "OVERSTOCK"
    return "IN_STOCK"


def _maybe_notify(db: Session, vendor_id: int, product_id: str, status: str) -> None:
    """Send a low-stock or out-of-stock notification (best-effort, never raises)."""
    if status not in ("LOW_STOCK", "OUT_OF_STOCK"):
        return
    try:
        from app.models.models import Notification, ProductMaster
        product = db.query(ProductMaster).filter(ProductMaster.ID == product_id).first()
        name = product.PRODUCT_NAME if product else product_id
        msg = (
            f"{'OUT OF STOCK' if status == 'OUT_OF_STOCK' else 'LOW STOCK'}: "
            f"{name} — please reorder."
        )
        db.add(Notification(
            VENDOR_ID=vendor_id, TYPE="INVENTORY_ALERT", TITLE="Inventory Alert", MESSAGE=msg,
        ))
        db.flush()
    except Exception:
        # Notification failure must never break the stock movement
        pass


def recalculate_stock_status(db: Session, vendor_id: int, product_id: str) -> None:
    """Recalculate and persist stock status without creating a movement row.
    Used after bulk uploads or manual threshold edits."""
    stock = db.query(InventoryStock).filter(
        InventoryStock.VENDOR_ID == vendor_id, InventoryStock.PRODUCT_ID == product_id
    ).first()
    if not stock:
        return
    stock.STATUS = _compute_status(stock.CURRENT_QTY, stock.MIN_QTY, stock.MAX_QTY)
    db.commit()


def get_latest_unit_cost(db: Session, vendor_id: int, product_id: str) -> Optional[float]:
    """The most recent per-unit cost paid for this product, sourced from
    its most recently received InventoryBatch. Returns None if the
    product has never been received. This is the single place "current
    cost" should be looked up now that InventoryStock no longer carries
    a cost column — every valuation/costing call site that used to read
    the old Inventory.UNIT_PRICE should call this instead of duplicating
    the query."""
    batch = (
        db.query(InventoryBatch)
        .filter(InventoryBatch.VENDOR_ID == vendor_id, InventoryBatch.PRODUCT_ID == product_id)
        .order_by(desc(InventoryBatch.CREATED_AT))
        .first()
    )
    return float(batch.UNIT_COST) if batch and batch.UNIT_COST is not None else None
