from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database.database import get_db

from app.models.models import (
    Inventory,
    MaterialCatalog,
    MaterialDepartment,
    Department,
    Employee,
    Vendor
)

from pydantic import BaseModel, Field
from typing import List

from app.auth.auth_bearer import get_current_employee

from app.schemas.inventory_schema import (
    InventoryCreate,
    StockUpdate
)

from app.services.seed_data import MATERIAL_CATALOG


router = APIRouter()


# =========================
# MATERIAL CATALOG
# =========================

class MaterialDeptSet(BaseModel):

    DEPARTMENT_IDS: List[int]


@router.get("/materials-catalog")
def list_catalog(
    db: Session = Depends(get_db)
):
    """
    Returns the master list of allowed material names with
    the department IDs each one is tagged for.
    """

    rows = db.query(MaterialCatalog).order_by(
        MaterialCatalog.MATERIAL_NAME
    ).all()

    # Build a map material_id -> [department_id, ...]
    tag_map = {}

    for row in db.query(MaterialDepartment).all():

        tag_map.setdefault(row.MATERIAL_ID, []).append(row.DEPARTMENT_ID)

    return [
        {
            "ID": r.ID,
            "MATERIAL_NAME": r.MATERIAL_NAME,
            "DEPARTMENT_IDS": tag_map.get(r.ID, [])
        }
        for r in rows
    ]


@router.put("/materials-catalog/{material_id}/departments")
def set_material_departments(
    material_id: int,
    data: MaterialDeptSet,
    db: Session = Depends(get_db)
):
    """
    Replace the department tags for one material.
    Empty list = unclassified (admin-only).
    """

    mat = db.query(MaterialCatalog).filter(
        MaterialCatalog.ID == material_id
    ).first()

    if not mat:

        raise HTTPException(
            status_code=404,
            detail="Material not in catalog"
        )

    # Validate department IDs exist
    if data.DEPARTMENT_IDS:

        existing = {
            d.ID for d in db.query(Department).filter(
                Department.ID.in_(data.DEPARTMENT_IDS)
            ).all()
        }

        unknown = set(data.DEPARTMENT_IDS) - existing

        if unknown:

            raise HTTPException(
                status_code=400,
                detail=f"Unknown department IDs: {sorted(unknown)}"
            )

    # Wipe + insert (simpler than diffing)
    db.query(MaterialDepartment).filter(
        MaterialDepartment.MATERIAL_ID == material_id
    ).delete()

    for dept_id in set(data.DEPARTMENT_IDS):

        db.add(MaterialDepartment(
            MATERIAL_ID=material_id,
            DEPARTMENT_ID=dept_id
        ))

    db.commit()

    return {
        "message": "Material tags updated",
        "MATERIAL_ID": material_id,
        "DEPARTMENT_IDS": sorted(set(data.DEPARTMENT_IDS))
    }


@router.get("/materials/for-me")
def materials_for_me(
    project_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user=Depends(get_current_employee)
):
    """
    Returns inventory rows scoped for the logged-in employee.

    Filtering rules:
      - If `project_id` is passed, scope to materials tagged
        with that project's department.
      - Otherwise, scope to the employee's own department.
      - Admins / managers see everything regardless.
    """

    from app.models.models import Project

    role = user.get("role")

    admin_like = role in (
        "SUPER_ADMIN", "ADMIN", "MANAGER", "PRODUCTION_HEAD", "HR"
    )

    # Admins / managers: full inventory (still optionally
    # scoped to a project's dept if project_id was passed)
    if admin_like and project_id is None:

        rows = db.query(Inventory).all()

        return {
            "scope": "all",
            "ROLE": role,
            "INVENTORY": [
                {
                    "ID": r.ID,
                    "MATERIAL_ID": r.MATERIAL_ID,
                    "MATERIAL_NAME": r.MATERIAL_NAME,
                    "QUANTITY": r.QUANTITY,
                    "UNIT_PRICE": r.UNIT_PRICE,
                    "VENDOR_ID": r.VENDOR_ID
                }
                for r in rows
            ]
        }

    # Determine which department to filter by
    scope_department_id = None

    scope_source = None

    if project_id is not None:

        proj = db.query(Project).filter(
            Project.ID == project_id
        ).first()

        if proj and proj.DEPARTMENT_ID:

            scope_department_id = proj.DEPARTMENT_ID

            scope_source = "project"

    if scope_department_id is None:

        # Fall back to the employee's own department
        emp = db.query(Employee).filter(
            Employee.ID == user.get("employee_id")
        ).first()

        if not emp or not emp.DEPARTMENT_ID:

            return {
                "scope": "department",
                "DEPARTMENT_ID": None,
                "PROJECT_ID": project_id,
                "INVENTORY": [],
                "message": (
                    "No department to scope by. Ask your admin "
                    "to set your department first."
                )
            }

        scope_department_id = emp.DEPARTMENT_ID

        scope_source = "employee"

    # Material IDs tagged for the chosen department
    allowed_material_ids = [
        row.MATERIAL_ID
        for row in db.query(MaterialDepartment).filter(
            MaterialDepartment.DEPARTMENT_ID == scope_department_id
        ).all()
    ]

    if not allowed_material_ids:

        return {
            "scope": "department",
            "DEPARTMENT_ID": scope_department_id,
            "PROJECT_ID": project_id,
            "SCOPE_SOURCE": scope_source,
            "INVENTORY": [],
            "message": (
                "No materials are tagged for this department yet. "
                "Ask your admin to assign relevant materials."
            )
        }

    rows = db.query(Inventory).filter(
        Inventory.MATERIAL_ID.in_(allowed_material_ids)
    ).all()

    return {
        "scope": "department",
        "DEPARTMENT_ID": scope_department_id,
        "PROJECT_ID": project_id,
        "SCOPE_SOURCE": scope_source,
        "INVENTORY": [
            {
                "ID": r.ID,
                "MATERIAL_ID": r.MATERIAL_ID,
                "MATERIAL_NAME": r.MATERIAL_NAME,
                "QUANTITY": r.QUANTITY,
                "UNIT_PRICE": r.UNIT_PRICE
            }
            for r in rows
        ]
    }


@router.post("/seed-materials")
def seed_materials(
    db: Session = Depends(get_db)
):
    """
    Idempotent — inserts any catalog entries that are
    missing, leaves existing ones alone.
    """

    created = 0

    for name in MATERIAL_CATALOG:

        existing = db.query(MaterialCatalog).filter(
            MaterialCatalog.MATERIAL_NAME == name
        ).first()

        if existing:

            continue

        db.add(MaterialCatalog(MATERIAL_NAME=name))

        created += 1

    db.commit()

    total = db.query(MaterialCatalog).count()

    return {
        "message": (
            f"{created} catalog item(s) added"
            if created > 0
            else "Catalog already in sync"
        ),
        "added": created,
        "total": total
    }


# =========================
# ADD MATERIAL (stock entry)
# =========================

@router.post("/create-material")
def create_material(
    data: InventoryCreate,
    db: Session = Depends(get_db)
):

    try:

        # Resolve material — accept either MATERIAL_ID or MATERIAL_NAME
        material_name = data.MATERIAL_NAME

        material_id = data.MATERIAL_ID

        if material_id:

            catalog = db.query(MaterialCatalog).filter(
                MaterialCatalog.ID == material_id
            ).first()

            if not catalog:

                raise HTTPException(
                    status_code=400,
                    detail="Material not in catalog"
                )

            material_name = catalog.MATERIAL_NAME

        elif material_name:

            catalog = db.query(MaterialCatalog).filter(
                MaterialCatalog.MATERIAL_NAME == material_name
            ).first()

            if not catalog:

                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"'{material_name}' is not in the catalog. "
                        "Call POST /seed-materials first or pick "
                        "a name from GET /materials-catalog."
                    )
                )

            material_id = catalog.ID

        else:

            raise HTTPException(
                status_code=400,
                detail="MATERIAL_ID or MATERIAL_NAME is required"
            )

        # Vendor required
        vendor = db.query(Vendor).filter(
            Vendor.ID == data.VENDOR_ID
        ).first()

        if not vendor:

            raise HTTPException(
                status_code=400,
                detail="Vendor not found"
            )

        material = Inventory(
            MATERIAL_ID=material_id,
            MATERIAL_NAME=material_name,
            QUANTITY=data.QUANTITY,
            UNIT_PRICE=data.UNIT_PRICE,
            VENDOR_ID=data.VENDOR_ID
        )

        db.add(material)

        db.commit()

        db.refresh(material)

        return {
            "message": "Material created successfully",
            "material_id": material.ID
        }

    except HTTPException:

        raise

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# VIEW MATERIALS (optionally filtered by vendor)
# =========================

@router.get("/materials")
def get_materials(
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Inventory)

    if vendor_id is not None:

        q = q.filter(Inventory.VENDOR_ID == vendor_id)

    return q.all()


# =========================
# UPDATE STOCK
# =========================

@router.put("/update-stock/{material_id}")
def update_stock(
    material_id: int,
    data: StockUpdate,
    db: Session = Depends(get_db)
):

    material = db.query(Inventory).filter(
        Inventory.ID == material_id
    ).first()

    if not material:

        raise HTTPException(
            status_code=404,
            detail="Material not found"
        )

    material.QUANTITY = data.QUANTITY

    db.commit()

    return {
        "message": "Stock updated"
    }


# =========================
# DELETE MATERIAL
# =========================

@router.delete("/delete-material/{material_id}")
def delete_material(
    material_id: int,
    db: Session = Depends(get_db)
):

    material = db.query(Inventory).filter(
        Inventory.ID == material_id
    ).first()

    if not material:

        raise HTTPException(
            status_code=404,
            detail="Material not found"
        )

    db.delete(material)

    db.commit()

    return {
        "message": "Material deleted"
    }


# =========================================================================
# ENRICHED INVENTORY (for the new Inventory page)
# =========================================================================
# Returns a fat row per material — quantity, value, preferred supplier
# (resolved from BOM), products that use it, low-stock flag, and the
# last-received date from finalized GRNs. One DB roundtrip's worth of
# queries, all aggregated server-side so the React page can just render.

from sqlalchemy import func

from app.models.models import (
    BOMItem,
    Supplier,
    ProductModel,
    GoodsReceiptNote,
    GoodsReceiptLine,
    PurchaseOrderLine
)


# Tunable: anything below this is flagged "LOW STOCK" in the UI
DEFAULT_LOW_STOCK_THRESHOLD = 5


def _category_for_material(material_name: str) -> str:
    """Best-effort category from the material name. Mirrors the chip
    colors on the inventory grid."""

    n = (material_name or "").lower()

    rules = [
        ("Sheet Metal",   ("sheet", "gi ", "ss ", "ms angle", "rod ")),
        ("Refrigeration", ("compressor", "condenser", "evaporator",
                            "refrigerant", "capillary")),
        ("Electronics",   ("pcb", "microcontroller", "sensor", "relay",
                            "ic ", "stm32", "dht")),
        ("Display",       ("lcd", "touch", "led indicator")),
        ("Motors",        ("motor", "stepper", "spiral", "gear")),
        ("Payment",       ("coin", "bill", "nfc", "qr ", "scanner",
                            "payment")),
        ("Glass",         ("glass", "acrylic")),
        ("Wires",         ("wiring", "cable", "harness")),
        ("Hardware",      ("lock", "hinge", "screw", "bolt", "nut",
                            "gasket")),
        ("Insulation",    ("insulation", "foam", "rubber")),
        ("Plumbing",      ("pump", "tubing", "filter", "pipe")),
        ("Heating",       ("heating", "boiler", "thermostat", "heater")),
        ("Power",         ("smps", "power", "supply", "fan ", "battery")),
        ("Packaging",     ("box", "padding", "sticker", "label"))
    ]

    for cat, kws in rules:

        for kw in kws:

            if kw in n:

                return cat

    return "Other"


@router.get("/inventory/full")
def inventory_full(
    vendor_id: int = Query(1),
    low_threshold: int = Query(DEFAULT_LOW_STOCK_THRESHOLD),
    db: Session = Depends(get_db)
):
    """Fat inventory view powering the redesigned Inventory page.

    Returns: { summary: {...}, items: [...] }
    where each item has supplier, product usage, and the last GRN date.
    """

    rows = db.query(Inventory).filter(
        Inventory.VENDOR_ID == vendor_id
    ).all()

    # --- Pre-fetch per-material relations ----------------------------------
    material_ids = [r.MATERIAL_ID for r in rows if r.MATERIAL_ID]

    # BOMItem → preferred supplier mapping (one supplier per material;
    # if a material is in multiple BOMs with different suppliers, the
    # first non-null wins).
    supplier_by_material = {}

    products_by_material = {}

    if material_ids:

        boms = db.query(BOMItem).filter(
            BOMItem.MATERIAL_ID.in_(material_ids)
        ).all()

        supplier_ids = {b.PREFERRED_SUPPLIER_ID for b in boms if b.PREFERRED_SUPPLIER_ID}

        supplier_map = {}

        if supplier_ids:

            for s in db.query(Supplier).filter(Supplier.ID.in_(supplier_ids)).all():

                supplier_map[s.ID] = {
                    "ID": s.ID,
                    "COMPANY_NAME": s.COMPANY_NAME,
                    "SUPPLIER_CODE": s.SUPPLIER_CODE,
                    "CATEGORY": s.CATEGORY
                }

        product_ids = {b.PRODUCT_MODEL_ID for b in boms if b.PRODUCT_MODEL_ID}

        product_map = {}

        if product_ids:

            for p in db.query(ProductModel).filter(ProductModel.ID.in_(product_ids)).all():

                product_map[p.ID] = {
                    "ID": p.ID,
                    "MODEL_CODE": p.MODEL_CODE,
                    "MODEL_NAME": p.MODEL_NAME
                }

        for b in boms:

            if b.MATERIAL_ID is None:

                continue

            if b.PREFERRED_SUPPLIER_ID and b.MATERIAL_ID not in supplier_by_material:

                sup = supplier_map.get(b.PREFERRED_SUPPLIER_ID)

                if sup:

                    supplier_by_material[b.MATERIAL_ID] = sup

            if b.PRODUCT_MODEL_ID:

                pm = product_map.get(b.PRODUCT_MODEL_ID)

                if pm:

                    products_by_material.setdefault(b.MATERIAL_ID, []).append(pm)

    # Last-received date per material via FINAL GRN line → PO line → material
    last_received_by_material = {}

    if material_ids:

        sub = (
            db.query(
                PurchaseOrderLine.MATERIAL_ID,
                func.max(GoodsReceiptNote.RECEIVED_DATE).label("last_date")
            )
            .join(
                GoodsReceiptLine,
                GoodsReceiptLine.PO_LINE_ID == PurchaseOrderLine.ID
            )
            .join(
                GoodsReceiptNote,
                GoodsReceiptNote.ID == GoodsReceiptLine.GRN_ID
            )
            .filter(
                GoodsReceiptNote.STATUS == "FINAL",
                PurchaseOrderLine.MATERIAL_ID.in_(material_ids)
            )
            .group_by(PurchaseOrderLine.MATERIAL_ID)
            .all()
        )

        for mat_id, last_date in sub:

            if last_date:

                last_received_by_material[mat_id] = last_date.isoformat()

    # --- Build response ----------------------------------------------------
    items = []

    total_value = 0.0

    low_count = 0

    out_count = 0

    cat_totals = {}

    for r in rows:

        qty = int(r.QUANTITY or 0)

        price = float(r.UNIT_PRICE or 0)

        # Per-row reorder threshold — falls back to the global default
        # when the admin hasn't set a specific value yet. This is the
        # source of truth for the BELOW_MIN / Reorder-Alert flag.
        row_min = int(r.MIN_STOCK or 0)

        effective_threshold = row_min if row_min > 0 else low_threshold

        line_value = qty * price

        total_value += line_value

        if qty == 0:

            stock_status = "OUT"

            out_count += 1

        elif qty <= effective_threshold:

            stock_status = "LOW"

            low_count += 1

        else:

            stock_status = "OK"

        # Distinct flag for the "row has explicit MIN_STOCK set AND
        # we're at or below it" case — feeds the Reorder-Alert badge
        # in the UI vs the default global LOW indication.
        below_min = row_min > 0 and qty <= row_min

        category = _category_for_material(r.MATERIAL_NAME)

        cat_totals[category] = cat_totals.get(category, 0) + 1

        items.append({
            "ID": r.ID,
            "MATERIAL_ID": r.MATERIAL_ID,
            "MATERIAL_NAME": r.MATERIAL_NAME,
            "CATEGORY": category,
            "QUANTITY": qty,
            "UNIT_PRICE": price,
            "MIN_STOCK": row_min,
            "BELOW_MIN": below_min,
            "TOTAL_VALUE": round(line_value, 2),
            "STOCK_STATUS": stock_status,
            "SUPPLIER": supplier_by_material.get(r.MATERIAL_ID),
            "USED_IN_PRODUCTS": products_by_material.get(r.MATERIAL_ID, []),
            "LAST_RECEIVED": last_received_by_material.get(r.MATERIAL_ID),
            "VENDOR_ID": r.VENDOR_ID
        })

    # Sort: lowest stock first so the user sees urgent items at the top
    items.sort(
        key=lambda x: (
            0 if x["STOCK_STATUS"] == "OUT" else
            (1 if x["STOCK_STATUS"] == "LOW" else 2),
            -x["TOTAL_VALUE"]
        )
    )

    return {
        "summary": {
            "total_materials": len(items),
            "total_value": round(total_value, 2),
            "low_stock_count": low_count,
            "out_of_stock_count": out_count,
            "in_stock_count": len(items) - low_count - out_count,
            "categories": cat_totals,
            "low_threshold": low_threshold
        },
        "items": items
    }


class StockAdjustRequest(BaseModel):
    """Manual stock correction — used for opening stock, write-offs,
    cycle-count adjustments. Always recorded with a reason."""

    QUANTITY: int
    REASON: str
    NOTES: Optional[str] = None


@router.post("/inventory/{inventory_id}/adjust")
def adjust_stock(
    inventory_id: int,
    data: StockAdjustRequest,
    db: Session = Depends(get_db)
):
    """Manual stock adjustment. Sets the inventory row's quantity
    to the requested value. Reason is required to keep an audit
    trail (logged to console for now; can be moved to a dedicated
    audit table later)."""

    inv = db.query(Inventory).filter(Inventory.ID == inventory_id).first()

    if not inv:

        raise HTTPException(status_code=404, detail="Inventory row not found")

    if data.QUANTITY < 0:

        raise HTTPException(
            status_code=400,
            detail="Quantity cannot be negative"
        )

    if not (data.REASON or "").strip():

        raise HTTPException(
            status_code=400,
            detail="A reason is required for stock adjustments"
        )

    old_qty = inv.QUANTITY

    inv.QUANTITY = data.QUANTITY

    db.commit()

    import logging

    logging.getLogger(__name__).info(
        "Stock adjust: %s (#%s) %s → %s | reason=%s",
        inv.MATERIAL_NAME, inv.ID, old_qty, data.QUANTITY, data.REASON
    )

    # Mfg Phase 1 — Reorder Alert: fire a Notification only when this
    # write crosses the threshold (was above, now at-or-below). Avoids
    # spamming when subsequent writes stay below the threshold.
    _maybe_notify_low_stock(db, inv, old_qty, data.QUANTITY)

    return {
        "message": "Stock adjusted",
        "old_quantity": old_qty,
        "new_quantity": data.QUANTITY,
        "delta": data.QUANTITY - old_qty
    }


class MinStockRequest(BaseModel):
    MIN_STOCK: int = Field(..., ge=0)
    # Set to 0 to disable alerting for this row.


@router.patch("/inventory/{inventory_id}/min-stock")
def set_min_stock(
    inventory_id: int,
    data: MinStockRequest,
    db: Session = Depends(get_db),
):
    """Set the per-row reorder threshold. When QUANTITY later drops
    at or below MIN_STOCK, a low-stock Notification is generated."""

    inv = db.query(Inventory).filter(Inventory.ID == inventory_id).first()

    if not inv:
        raise HTTPException(status_code=404, detail="Inventory row not found")

    old_min = int(inv.MIN_STOCK or 0)

    inv.MIN_STOCK = data.MIN_STOCK

    db.commit()

    # If the user raised the threshold above the current stock,
    # fire an immediate notification — the row is now "below min"
    # even though stock didn't actually change.
    if data.MIN_STOCK > 0 and int(inv.QUANTITY or 0) <= data.MIN_STOCK:
        _push_low_stock_notification(db, inv)

    return {
        "message": "Reorder threshold updated",
        "min_stock": inv.MIN_STOCK,
        "old_min_stock": old_min,
        "current_quantity": inv.QUANTITY,
    }


# ---------------------------------------------------------------------
# Low-stock notification helpers (Mfg Phase 1 — Reorder Alerts)
# ---------------------------------------------------------------------

def _maybe_notify_low_stock(
    db: Session, inv: Inventory, old_qty: int, new_qty: int
) -> None:
    """Notification fires only on a fresh crossing of the threshold —
    old_qty was strictly above MIN_STOCK and new_qty is now at or
    below. Re-adjusts that keep stock below the threshold do NOT
    re-fire to prevent spam."""

    min_stock = int(inv.MIN_STOCK or 0)

    if min_stock <= 0:
        return

    if int(old_qty or 0) > min_stock and int(new_qty or 0) <= min_stock:
        _push_low_stock_notification(db, inv)


def _push_low_stock_notification(db: Session, inv: Inventory) -> None:
    """Insert a single Notification row about this low-stock material.
    Best-effort — wraps in try/except so any failure here never breaks
    the inventory write that triggered it."""

    try:

        from app.models.models import Notification

        title = f"Low stock: {inv.MATERIAL_NAME or 'Material'}"

        body = (
            f"{inv.MATERIAL_NAME or 'Material'} stock is {inv.QUANTITY} units "
            f"(reorder threshold: {inv.MIN_STOCK}). Place a purchase order."
        )

        db.add(Notification(
            TITLE=title,
            MESSAGE=body[:500],
            TYPE="WARNING",
            VENDOR_ID=inv.VENDOR_ID or 1,
        ))

        db.commit()

    except Exception as e:

        import logging
        logging.getLogger(__name__).warning(
            "low-stock notification skipped: %s: %s",
            type(e).__name__, e,
        )


@router.get("/inventory/{inventory_id}/movements")
def inventory_movements(
    inventory_id: int,
    db: Session = Depends(get_db)
):
    """Recent stock movements for a single material — finalized GRN
    receipts that hit this material. Powers the detail drawer in the
    new Inventory page."""

    inv = db.query(Inventory).filter(Inventory.ID == inventory_id).first()

    if not inv:

        raise HTTPException(status_code=404, detail="Inventory row not found")

    if not inv.MATERIAL_ID:

        return {"inventory": {"ID": inv.ID, "MATERIAL_NAME": inv.MATERIAL_NAME},
                "movements": []}

    rows = (
        db.query(
            GoodsReceiptLine,
            GoodsReceiptNote,
            PurchaseOrderLine
        )
        .join(GoodsReceiptNote, GoodsReceiptNote.ID == GoodsReceiptLine.GRN_ID)
        .join(PurchaseOrderLine, PurchaseOrderLine.ID == GoodsReceiptLine.PO_LINE_ID)
        .filter(
            PurchaseOrderLine.MATERIAL_ID == inv.MATERIAL_ID,
            GoodsReceiptNote.STATUS == "FINAL"
        )
        .order_by(GoodsReceiptNote.FINALIZED_AT.desc())
        .limit(30)
        .all()
    )

    movements = []

    for grn_line, grn, po_line in rows:

        movements.append({
            "GRN_NUMBER": grn.GRN_NUMBER,
            "GRN_ID": grn.ID,
            "RECEIVED_DATE": grn.RECEIVED_DATE.isoformat() if grn.RECEIVED_DATE else None,
            "FINALIZED_AT": grn.FINALIZED_AT.isoformat() if grn.FINALIZED_AT else None,
            "QUANTITY_RECEIVED": float(grn_line.QUANTITY_RECEIVED or 0),
            "QUANTITY_REJECTED": float(grn_line.QUANTITY_REJECTED or 0),
            "UNIT_PRICE": float(po_line.UNIT_PRICE or 0),
            "PO_NUMBER": None  # filled below if needed
        })

    return {
        "inventory": {
            "ID": inv.ID,
            "MATERIAL_NAME": inv.MATERIAL_NAME,
            "QUANTITY": inv.QUANTITY,
            "UNIT_PRICE": inv.UNIT_PRICE
        },
        "movements": movements
    }
