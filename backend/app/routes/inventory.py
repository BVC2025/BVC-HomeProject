"""
/inventory — the at-a-glance product stock overview page.

Rebuilt against the consolidated inventory system (ProductMaster ->
InventoryStock/InventoryBatch/InventoryMovement, see inventory_models.py)
— the legacy Inventory model (MATERIAL_NAME/QUANTITY/UNIT_PRICE/MIN_STOCK)
this file used to serve is no longer written to by anything (GRN
receiving was rewired to the new system in purchase_order.py's
_apply_grn_to_inventory) and is kept only as an unmapped historical
table (see models.py's own retirement note next to the class).

/inventory-items (inventory_items.py) is the companion detailed
stock-operations page (adjust/threshold-edit + Batches + Movements
tabs) — this page is the summary/overview + entry point for creating a
Purchase Order.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Employee, Notification
from app.models.inventory_models import ProductMaster, InventoryCategory, InventoryStock, InventoryMovement
from app.models.supplier_models import Supplier, SupplierProduct
from app.auth.auth_bearer import get_current_employee, require
from app.services.inventory_automation_service import record_movement, get_latest_unit_cost

router = APIRouter()


# =========================================================================
# Employee-scoped read (department-based), unchanged scoping rules
# =========================================================================

@router.get("/materials/for-me")
def materials_for_me(
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):
    """Returns inventory stock rows scoped for the logged-in employee.
    Scoping uses ProductMaster.DEPARTMENT_ID — products belonging to the
    employee's department. Admins/managers see everything."""

    role = user.get("role")
    admin_like = role in ("SUPER_ADMIN", "ADMIN", "MANAGER", "PRODUCTION_HEAD", "HR")

    def _serialize(stock: InventoryStock):
        return {
            "ID": stock.ID,
            "PRODUCT_ID": stock.PRODUCT_ID,
            "PRODUCT_NAME": stock.product.PRODUCT_NAME if stock.product else None,
            "CURRENT_QTY": stock.CURRENT_QTY,
            "STATUS": stock.STATUS,
            "VENDOR_ID": stock.VENDOR_ID,
        }

    if admin_like and project_id is None:
        rows = db.query(InventoryStock).all()
        return {"scope": "all", "ROLE": role, "INVENTORY": [_serialize(r) for r in rows]}

    scope_department_id = None
    scope_source = None

    emp = db.query(Employee).filter(Employee.ID == user.get("employee_id")).first()
    if not emp or not emp.DEPARTMENT_ID:
        return {
            "scope": "department", "DEPARTMENT_ID": None,
            "PROJECT_ID": project_id, "INVENTORY": [],
            "message": "No department to scope by. Ask your admin to set your department first."
        }
    scope_department_id = emp.DEPARTMENT_ID
    scope_source = "employee"

    allowed_product_ids = [
        p.ID for p in db.query(ProductMaster).filter(
            ProductMaster.DEPARTMENT_ID == scope_department_id
        ).all()
    ]

    if not allowed_product_ids:
        return {
            "scope": "department", "DEPARTMENT_ID": scope_department_id,
            "PROJECT_ID": project_id, "SCOPE_SOURCE": scope_source,
            "INVENTORY": [],
            "message": "No products are assigned to this department yet.",
        }

    rows = db.query(InventoryStock).filter(InventoryStock.PRODUCT_ID.in_(allowed_product_ids)).all()

    return {
        "scope": "department",
        "DEPARTMENT_ID": scope_department_id,
        "PROJECT_ID": project_id,
        "SCOPE_SOURCE": scope_source,
        "INVENTORY": [_serialize(r) for r in rows],
    }


# =========================================================================
# Enriched inventory overview — powers the /inventory page
# =========================================================================

def _resolve_preferred_supplier(db: Session, vendor_id: int, product_ids: list) -> dict:
    """One preferred (or, failing that, first active) SupplierProduct per
    PRODUCT_ID — mirrors the same resolution used by the low-stock reorder
    engine (inventory_reorder_service.resolve_supplier_for_product), kept
    intentionally simple here (display-only, not a reorder decision)."""
    if not product_ids:
        return {}
    rows = (
        db.query(SupplierProduct, Supplier)
        .join(Supplier, Supplier.ID == SupplierProduct.SUPPLIER_ID)
        .filter(
            SupplierProduct.VENDOR_ID == vendor_id,
            SupplierProduct.PRODUCT_ID.in_(product_ids),
            SupplierProduct.STATUS == "ACTIVE",
        )
        .order_by(SupplierProduct.IS_PREFERRED.desc(), SupplierProduct.UNIT_PRICE.asc())
        .all()
    )
    resolved = {}
    for sp, supplier in rows:
        if sp.PRODUCT_ID in resolved:
            continue
        resolved[sp.PRODUCT_ID] = {
            "ID": supplier.ID, "COMPANY_NAME": supplier.COMPANY_NAME,
            "SUPPLIER_CODE": supplier.SUPPLIER_CODE, "CATEGORY": supplier.CATEGORY,
        }
    return resolved


@router.get("/inventory/full", dependencies=[Depends(require("inventory.view"))])
def inventory_full(
    vendor_id: int = Query(1),
    db: Session = Depends(get_db)
):
    """Fat inventory overview powering /inventory. Returns
    { summary: {...}, items: [...] } — one row per tracked product
    (an InventoryStock row already exists for it), each enriched with
    category name, latest unit cost, preferred supplier, and last
    movement date."""

    rows = (
        db.query(InventoryStock)
        .join(ProductMaster, ProductMaster.ID == InventoryStock.PRODUCT_ID)
        .filter(InventoryStock.VENDOR_ID == vendor_id)
        .all()
    )

    product_ids = [r.PRODUCT_ID for r in rows]

    category_ids = {r.product.CATEGORY_ID for r in rows if r.product and r.product.CATEGORY_ID}
    categories = {
        c.ID: c.NAME for c in db.query(InventoryCategory).filter(InventoryCategory.ID.in_(category_ids)).all()
    } if category_ids else {}

    supplier_by_product = _resolve_preferred_supplier(db, vendor_id, product_ids)

    last_movement_by_product = {}
    if product_ids:
        sub = (
            db.query(InventoryMovement.PRODUCT_ID, func.max(InventoryMovement.CREATED_AT).label("last_at"))
            .filter(InventoryMovement.PRODUCT_ID.in_(product_ids))
            .group_by(InventoryMovement.PRODUCT_ID)
            .all()
        )
        for pid, last_at in sub:
            if last_at:
                last_movement_by_product[pid] = last_at.isoformat()

    items = []
    total_value = 0.0
    low_count = 0
    out_count = 0
    overstock_count = 0
    cat_totals = {}

    for stock in rows:
        product = stock.product
        qty = float(stock.CURRENT_QTY or 0)
        unit_cost = get_latest_unit_cost(db, vendor_id, stock.PRODUCT_ID) or 0.0
        line_value = qty * unit_cost
        total_value += line_value

        status = stock.STATUS or "OUT_OF_STOCK"
        if status == "OUT_OF_STOCK":
            out_count += 1
        elif status == "LOW_STOCK":
            low_count += 1
        elif status == "OVERSTOCK":
            overstock_count += 1

        category_name = categories.get(product.CATEGORY_ID) if product else None
        category_name = category_name or "Uncategorized"
        cat_totals[category_name] = cat_totals.get(category_name, 0) + 1

        items.append({
            "ID": stock.ID,
            "PRODUCT_ID": stock.PRODUCT_ID,
            "PRODUCT_CODE": product.PRODUCT_CODE if product else None,
            "PRODUCT_NAME": product.PRODUCT_NAME if product else "Unknown Product",
            "CATEGORY_ID": product.CATEGORY_ID if product else None,
            "CATEGORY_NAME": category_name,
            "UNIT": product.UNIT if product else "PCS",
            "CURRENT_QTY": qty,
            "MIN_QTY": float(stock.MIN_QTY or 0),
            "MAX_QTY": float(stock.MAX_QTY) if stock.MAX_QTY is not None else None,
            "UNIT_COST": unit_cost,
            "TOTAL_VALUE": round(line_value, 2),
            "STATUS": status,
            "PREFERRED_SUPPLIER": supplier_by_product.get(stock.PRODUCT_ID),
            "LAST_MOVEMENT_AT": last_movement_by_product.get(stock.PRODUCT_ID),
            "VENDOR_ID": stock.VENDOR_ID,
        })

    # Sort: most urgent first (out of stock, then low, then overstock, then ok), highest value first within each bucket
    _status_rank = {"OUT_OF_STOCK": 0, "LOW_STOCK": 1, "OVERSTOCK": 2, "IN_STOCK": 3}
    items.sort(key=lambda x: (_status_rank.get(x["STATUS"], 4), -x["TOTAL_VALUE"]))

    return {
        "summary": {
            "total_products": len(items),
            "total_value": round(total_value, 2),
            "low_stock_count": low_count,
            "out_of_stock_count": out_count,
            "overstock_count": overstock_count,
            "in_stock_count": len(items) - low_count - out_count - overstock_count,
            "categories": cat_totals,
        },
        "items": items,
    }


class StockAdjustRequest(BaseModel):
    QUANTITY: float
    REASON: str
    NOTES: Optional[str] = None
    PERFORMED_BY_ID: Optional[str] = None


@router.post("/inventory/{stock_id}/adjust", dependencies=[Depends(require("inventory.purchase"))])
def adjust_stock(stock_id: str, data: StockAdjustRequest, db: Session = Depends(get_db)):
    """Manual stock correction — goes through record_movement()
    (MOVEMENT_TYPE="ADJUSTMENT") so it's captured in the InventoryMovement
    ledger with Reason/Performed-By/Previous/New already recorded;
    Difference is QTY_AFTER - QTY_BEFORE, always derived, never stored."""
    stock = db.query(InventoryStock).filter(InventoryStock.ID == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Inventory stock row not found")
    if data.QUANTITY < 0:
        raise HTTPException(status_code=400, detail="Quantity cannot be negative")
    if not (data.REASON or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required for stock adjustments")

    movement = record_movement(
        db, stock.VENDOR_ID, stock.PRODUCT_ID, "ADJUSTMENT", data.QUANTITY,
        performed_by_id=data.PERFORMED_BY_ID, reason=data.REASON, notes=data.NOTES,
    )
    db.commit()

    return {
        "message": "Stock adjusted",
        "old_quantity": movement.QTY_BEFORE,
        "new_quantity": movement.QTY_AFTER,
        "delta": movement.QTY_AFTER - movement.QTY_BEFORE,
    }


class ThresholdRequest(BaseModel):
    MIN_QTY: Optional[float] = None
    MAX_QTY: Optional[float] = None


@router.patch("/inventory/{stock_id}/min-stock", dependencies=[Depends(require("inventory.purchase"))])
def set_min_stock(stock_id: str, data: ThresholdRequest, db: Session = Depends(get_db)):
    """Set MIN_QTY/MAX_QTY thresholds, recomputing STATUS immediately
    (a threshold edit can flip status even with no stock movement)."""
    stock = db.query(InventoryStock).filter(InventoryStock.ID == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Inventory stock row not found")

    old_min, old_max = stock.MIN_QTY, stock.MAX_QTY
    if data.MIN_QTY is not None:
        stock.MIN_QTY = data.MIN_QTY
    if data.MAX_QTY is not None:
        stock.MAX_QTY = data.MAX_QTY

    from app.services.inventory_automation_service import _compute_status
    stock.STATUS = _compute_status(stock.CURRENT_QTY, stock.MIN_QTY, stock.MAX_QTY)
    db.commit()

    if stock.STATUS in ("LOW_STOCK", "OUT_OF_STOCK") and (old_min != stock.MIN_QTY or old_max != stock.MAX_QTY):
        try:
            from app.services.inventory_reorder_service import evaluate_and_propose_reorder
            evaluate_and_propose_reorder(db, stock.VENDOR_ID, product_ids=[stock.PRODUCT_ID])
            db.commit()
        except Exception:
            import logging
            logging.getLogger(__name__).exception("set_min_stock: reorder evaluation failed for stock %s", stock_id)

    return {
        "message": "Thresholds updated",
        "min_qty": stock.MIN_QTY, "max_qty": stock.MAX_QTY,
        "old_min_qty": old_min, "old_max_qty": old_max,
        "current_quantity": stock.CURRENT_QTY, "status": stock.STATUS,
    }


@router.get("/inventory/{stock_id}/movements", dependencies=[Depends(require("inventory.view"))])
def inventory_movements_for_stock(stock_id: str, db: Session = Depends(get_db)):
    """Recent stock movements for a single product — powers the detail
    drawer on /inventory. Unlike the old GRN-only view, this now shows
    every movement type (receipts, adjustments, write-offs, production
    consumption, etc.) since InventoryMovement is the single ledger for
    all of them."""
    stock = db.query(InventoryStock).filter(InventoryStock.ID == stock_id).first()
    if not stock:
        raise HTTPException(status_code=404, detail="Inventory stock row not found")

    rows = (
        db.query(InventoryMovement)
        .filter(InventoryMovement.PRODUCT_ID == stock.PRODUCT_ID)
        .order_by(InventoryMovement.CREATED_AT.desc())
        .limit(30)
        .all()
    )

    movements = [{
        "ID": m.ID,
        "MOVEMENT_TYPE": m.MOVEMENT_TYPE,
        "QTY": m.QTY,
        "QTY_BEFORE": m.QTY_BEFORE,
        "QTY_AFTER": m.QTY_AFTER,
        "UNIT_COST": m.UNIT_COST,
        "REFERENCE_TYPE": m.REFERENCE_TYPE,
        "REFERENCE_ID": m.REFERENCE_ID,
        "REASON": m.REASON,
        "PERFORMED_BY_NAME": m.performed_by.NAME if m.performed_by else None,
        "CREATED_AT": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
    } for m in rows]

    return {
        "inventory": {
            "ID": stock.ID, "PRODUCT_NAME": stock.product.PRODUCT_NAME if stock.product else None,
            "CURRENT_QTY": stock.CURRENT_QTY,
        },
        "movements": movements,
    }
