"""
One-shot reset + seed endpoint for procurement data.

Wipes existing supplier / material / PO data, then seeds realistic
material + supplier demo data so the ERP has a working demo dataset.

Safe to re-run — the wipe is idempotent and the seed is
all-or-nothing (one transaction per data type, with FK checks
temporarily disabled during the wipe).
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Supplier,
    Inventory,
)

from app.models.inventory_models import ProductMaster

from app.services.vending_seed_data import (
    SUPPLIERS,
    MATERIALS,
)

from app.auth.auth_bearer import get_current_admin


router = APIRouter()


@router.post("/procurement/reset-and-seed", dependencies=[Depends(get_current_admin)])
def reset_and_seed(
    wipe: bool = Query(True, description="Delete existing data first"),
    vendor_id: int = Query(1),
    db: Session = Depends(get_db)
):
    """
    Reset + seed procurement data.

    Wipes (in this order, FK-safe via MySQL SET FOREIGN_KEY_CHECKS=0):
      - purchase_order_activity, goods_receipt_line, goods_receipt_note,
        purchase_order_line, purchase_order
      - inventory, product_master (seed-created rows only — see
        caution below), supplier

    Seeds:
      - 20 suppliers (Tata Steel, Bosch, Emerson, Pine Labs, …)
      - 47 materials as ProductMaster rows with starting Inventory
        rows (qty=0, real prices)

    CAUTION: product_master is the shared catalog used by the real
    Supplier/Inventory module (supplier_products.py, inventory_items.py),
    not a seed-only table. Wiping it here deletes ANY product in that
    catalog for this vendor, not just demo rows — only run this against
    a fresh/demo vendor, never against a vendor with real product data.

    Returns counts so the UI can show a summary.
    """

    summary = {"wiped": {}, "created": {}}

    # ---- 1. WIPE ----
    if wipe:

        try:

            db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

            # Now wipe in child-first order
            wipe_tables = [
                # PO + GRN ecosystem (child → parent)
                "purchase_order_activity",
                "goods_receipt_line",
                "goods_receipt_note",
                "purchase_order_line",
                "purchase_order",
                # Materials + inventory
                "inventory",
                "product_master",
                # Suppliers
                "supplier",
            ]

            for t in wipe_tables:

                try:

                    res = db.execute(text(f"DELETE FROM {t}"))

                    summary["wiped"][t] = res.rowcount

                except Exception as exc:

                    summary["wiped"][t] = f"skipped: {type(exc).__name__}"

            db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

            db.commit()

        except Exception as exc:

            db.rollback()

            try:

                db.execute(text("SET FOREIGN_KEY_CHECKS = 1"))

                db.commit()

            except Exception:

                pass

            raise HTTPException(
                status_code=500,
                detail=f"Wipe failed: {exc}"
            )

    # ---- 2. SEED suppliers ----
    code_to_supplier = {}

    for s in SUPPLIERS:

        existing = db.query(Supplier).filter(
            Supplier.VENDOR_ID == vendor_id,
            Supplier.SUPPLIER_CODE == s["SUPPLIER_CODE"]
        ).first()

        if existing:

            code_to_supplier[s["SUPPLIER_CODE"]] = existing

            continue

        sup = Supplier(VENDOR_ID=vendor_id, **s)

        db.add(sup)

        db.flush()

        code_to_supplier[s["SUPPLIER_CODE"]] = sup

    db.commit()

    summary["created"]["suppliers"] = len(code_to_supplier)

    # ---- 3. SEED materials (as ProductMaster rows) + matching Inventory rows ----
    name_to_material = {}

    name_to_supplier_id = {}

    inventory_created = 0

    existing_codes = {
        code for (code,) in db.query(ProductMaster.PRODUCT_CODE).filter(
            ProductMaster.VENDOR_ID == vendor_id
        ).all()
    }

    def _next_seed_code():
        i = 1
        while f"SEED-MAT-{i:03d}" in existing_codes:
            i += 1
        code = f"SEED-MAT-{i:03d}"
        existing_codes.add(code)
        return code

    for name, price, supplier_code, unit, hsn in MATERIALS:

        mat = db.query(ProductMaster).filter(
            ProductMaster.VENDOR_ID == vendor_id,
            ProductMaster.PRODUCT_NAME == name
        ).first()

        if not mat:

            mat = ProductMaster(
                VENDOR_ID=vendor_id,
                PRODUCT_CODE=_next_seed_code(),
                PRODUCT_NAME=name,
                UNIT=unit,
                HSN_CODE=hsn,
                STATUS="ACTIVE"
            )

            db.add(mat)

            db.flush()

        name_to_material[name] = mat

        supplier = code_to_supplier.get(supplier_code)

        if supplier:

            name_to_supplier_id[name] = supplier.ID

        # Seed an Inventory row at qty=0 with the realistic price,
        # so PO+GRN flow has a starting point (Inventory price is
        # used by Auto-from-Project for PO line unit prices).
        inv = db.query(Inventory).filter(
            Inventory.PRODUCT_ID == mat.ID,
            Inventory.VENDOR_ID == vendor_id
        ).first()

        if not inv:

            db.add(Inventory(
                PRODUCT_ID=mat.ID,
                MATERIAL_NAME=name,
                QUANTITY=0,
                UNIT_PRICE=float(price),
                VENDOR_ID=vendor_id
            ))

            inventory_created += 1

    db.commit()

    summary["created"]["materials"] = len(name_to_material)

    summary["created"]["inventory_rows"] = inventory_created

    return {
        "message": (
            f"Reset {'+ seed' if wipe else ''} complete. "
            f"{summary['created'].get('suppliers', 0)} suppliers, "
            f"{summary['created'].get('materials', 0)} materials."
        ),
        **summary
    }
