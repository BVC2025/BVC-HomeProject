"""
Inventory Automation Service.

Single entry point for ALL stock changes.  Every movement (in/out/adjust/
transfer) goes through record_movement() which atomically:
  1. Row-locks the InventoryStock row (prevents race conditions)
  2. Validates the movement (e.g. STOCK_OUT cannot exceed available qty)
  3. Computes the new quantity
  4. Creates an InventoryMovement row (append-only ledger)
  5. Updates InventoryStock
  6. Recalculates and persists the stock STATUS
  7. Fires low-stock/out-of-stock notifications if thresholds crossed

Callers must commit the session after this function returns.
(db.flush() is called internally so FKs are resolvable within the same tx.)
"""

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.inventory_models import (
    InventoryItem,
    InventoryStock,
    InventoryMovement,
)


# Movement types that ADD to stock
_ADDITIVE = {"STOCK_IN", "TRANSFER_IN", "RETURN", "OPENING_STOCK"}

# Movement types that SUBTRACT from stock
_SUBTRACTIVE = {"STOCK_OUT", "TRANSFER_OUT", "WRITE_OFF"}

# Movement types that SET stock to an absolute value
_ABSOLUTE = {"ADJUSTMENT"}


def record_movement(
    db: Session,
    vendor_id: int,
    item_id: str,
    movement_type: str,
    qty: float,
    performed_by_id: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    reason: Optional[str] = None,
    notes: Optional[str] = None,
    unit_cost: Optional[float] = None,
) -> InventoryMovement:
    """
    Record a stock movement and update InventoryStock atomically.

    Parameters
    ----------
    db              : SQLAlchemy session (caller commits)
    vendor_id       : tenant ID
    item_id         : InventoryItem.ID
    movement_type   : one of the INV_MOVEMENT_TYPE_ENUM values
    qty             : always POSITIVE — direction is implied by movement_type
    performed_by_id : Employee.ID (optional)
    reference_type  : "PO" | "GRN" | "SO" | "MANUAL" | etc. (optional)
    reference_id    : ID of the referenced document (optional)
    batch_id        : InventoryBatch.ID (optional)
    reason          : short reason string (optional)
    notes           : long-form notes (optional)
    unit_cost       : unit cost at time of movement (optional)

    Returns
    -------
    InventoryMovement row (not yet committed)
    """
    if qty <= 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Movement quantity must be positive")

    # ── Load item ─────────────────────────────────────────────────────
    item: Optional[InventoryItem] = (
        db.query(InventoryItem)
        .filter(InventoryItem.ID == item_id, InventoryItem.VENDOR_ID == vendor_id)
        .first()
    )
    if not item:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Inventory item not found")

    # ── Row-lock the stock row to prevent race conditions ─────────────
    stock: Optional[InventoryStock] = (
        db.query(InventoryStock)
        .filter(InventoryStock.INVENTORY_ITEM_ID == item_id)
        .with_for_update()
        .first()
    )

    if not stock:
        # Auto-create if missing (e.g. first movement for this item)
        stock = InventoryStock(
            VENDOR_ID=vendor_id,
            INVENTORY_ITEM_ID=item_id,
            CURRENT_QTY=0.0,
            RESERVED_QTY=0.0,
            AVAILABLE_QTY=0.0,
            UNIT_COST=0.0,
            STATUS="OUT_OF_STOCK",
        )
        db.add(stock)
        db.flush()

    qty_before = stock.CURRENT_QTY

    # ── Compute new quantity ──────────────────────────────────────────
    if movement_type in _ADDITIVE:
        qty_after = qty_before + qty

    elif movement_type in _SUBTRACTIVE:
        if qty > stock.AVAILABLE_QTY:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient stock. Requested: {qty}, "
                    f"Available: {stock.AVAILABLE_QTY:.2f}"
                )
            )
        qty_after = qty_before - qty

    elif movement_type in _ABSOLUTE:
        qty_after = qty   # ADJUSTMENT sets absolute value

    else:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Unknown movement type: {movement_type}"
        )

    # ── Create InventoryMovement row ──────────────────────────────────
    movement = InventoryMovement(
        VENDOR_ID=vendor_id,
        INVENTORY_ITEM_ID=item_id,
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

    # ── Update InventoryStock ─────────────────────────────────────────
    stock.CURRENT_QTY = qty_after
    stock.AVAILABLE_QTY = max(0.0, qty_after - stock.RESERVED_QTY)
    stock.LAST_MOVEMENT_AT = datetime.utcnow()

    # Update weighted average cost on STOCK_IN / OPENING_STOCK
    if movement_type in ("STOCK_IN", "OPENING_STOCK") and unit_cost is not None:
        if qty_before > 0 and stock.UNIT_COST:
            stock.UNIT_COST = (
                (stock.UNIT_COST * qty_before + unit_cost * qty) / qty_after
            )
        else:
            stock.UNIT_COST = unit_cost

    # ── Compute STATUS ────────────────────────────────────────────────
    stock.STATUS = _compute_status(qty_after, item)

    db.flush()

    # ── Fire notifications if thresholds crossed ──────────────────────
    _maybe_notify(db, vendor_id, item_id, stock.STATUS, item)

    return movement


def _compute_status(current_qty: float, item: InventoryItem) -> str:
    """Derive IN_STOCK / LOW_STOCK / OUT_OF_STOCK / OVERSTOCK from qty + thresholds."""
    if current_qty <= 0:
        return "OUT_OF_STOCK"
    if item.REORDER_LEVEL and current_qty <= item.REORDER_LEVEL:
        return "LOW_STOCK"
    if item.MAX_STOCK and item.MAX_STOCK > 0 and current_qty > item.MAX_STOCK:
        return "OVERSTOCK"
    return "IN_STOCK"


def _maybe_notify(
    db: Session,
    vendor_id: int,
    item_id: str,
    status: str,
    _item: InventoryItem,
) -> None:
    """Send a low-stock or out-of-stock notification (best-effort, never raises)."""
    if status not in ("LOW_STOCK", "OUT_OF_STOCK"):
        return
    try:
        # Reuse the existing Notification model if available
        from app.models.models import Notification
        msg = (
            f"{'OUT OF STOCK' if status == 'OUT_OF_STOCK' else 'LOW STOCK'}: "
            f"Item {item_id} — please reorder."
        )
        notif = Notification(
            VENDOR_ID=vendor_id,
            TYPE="INVENTORY_ALERT",
            TITLE="Inventory Alert",
            MESSAGE=msg,
        )
        db.add(notif)
        db.flush()
    except Exception:
        # Notification failure must never break the stock movement
        pass


def recalculate_stock_status(db: Session, vendor_id: int, item_id: str) -> None:
    """Recalculate and persist stock status without creating a movement row.
    Used after bulk uploads or manual corrections."""
    stock = db.query(InventoryStock).filter(
        InventoryStock.INVENTORY_ITEM_ID == item_id
    ).first()
    if not stock:
        return
    item = db.query(InventoryItem).filter(InventoryItem.ID == item_id).first()
    if not item:
        return
    stock.STATUS = _compute_status(stock.CURRENT_QTY, item)
    db.commit()
