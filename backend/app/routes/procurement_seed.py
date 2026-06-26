"""
One-shot reset + seed endpoint for procurement data.

Wipes existing supplier / material / product / BOM / PO data,
then seeds realistic vending-machine manufacturing data so the
ERP has a working demo dataset.

Safe to re-run — the wipe is idempotent and the seed is
all-or-nothing (one transaction per data type, with FK checks
temporarily disabled during the wipe).
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin

from app.models.models import (
    Supplier,
    MaterialCatalog,
    Inventory,
    ProductModel,
    BOMItem
)

from app.services.vending_seed_data import (
    SUPPLIERS,
    MATERIALS,
    PRODUCTS
)


router = APIRouter()


@router.post("/procurement/reset-and-seed")
def reset_and_seed(
    wipe: bool = Query(True, description="Delete existing data first"),
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Reset + seed procurement data.

    Wipes (in this order, FK-safe via MySQL SET FOREIGN_KEY_CHECKS=0):
      - purchase_order_activity, goods_receipt_line, goods_receipt_note,
        purchase_order_line, purchase_order
      - inventory, material_department, bom_item, material_catalog,
        product_model, supplier
      - Nulls out PRODUCT_MODEL_ID on quotation_line, project,
        customer_requirement (and clears PREFERRED_SUPPLIER_ID on
        any orphan BOM rows that survived a partial wipe).

    Seeds:
      - 20 suppliers (Tata Steel, Bosch, Emerson, Pine Labs, …)
      - 47 materials with starting Inventory rows (qty=0, real prices)
      - 2 vending machine ProductModels (Snack-Beverage Combo, Coffee Pro)
      - Full BOM lines mapped to materials + preferred suppliers

    Returns counts so the UI can show a summary.
    """

    summary = {"wiped": {}, "created": {}}

    # Capture {row_id: model_code} maps BEFORE wiping product_model
    # so we can repoint surviving project/requirement/quotation_line
    # rows to the freshly-seeded products by matching MODEL_CODE.
    # This preserves customer-facing links across a reset+reseed.
    preserved_links = {
        "project": {},
        "customer_requirement": {},
        "quotation_line": {}
    }

    if wipe:

        for table in preserved_links.keys():

            try:

                rows = db.execute(text(
                    f"SELECT t.ID, pm.MODEL_CODE "
                    f"FROM {table} t "
                    f"JOIN product_model pm ON t.PRODUCT_MODEL_ID = pm.ID "
                    f"WHERE t.PRODUCT_MODEL_ID IS NOT NULL"
                )).all()

                for row_id, code in rows:

                    if code:

                        preserved_links[table][row_id] = code

            except Exception:

                pass

    # ---- 1. WIPE ----
    if wipe:

        try:

            db.execute(text("SET FOREIGN_KEY_CHECKS = 0"))

            # Null outbound FKs so wiping product_model / supplier
            # doesn't leave dangling references. Links will be
            # restored after re-seed via the preserved_links map.
            for sql in [
                "UPDATE quotation_line SET PRODUCT_MODEL_ID = NULL "
                "WHERE PRODUCT_MODEL_ID IS NOT NULL",
                "UPDATE project SET PRODUCT_MODEL_ID = NULL "
                "WHERE PRODUCT_MODEL_ID IS NOT NULL",
                "UPDATE customer_requirement SET PRODUCT_MODEL_ID = NULL "
                "WHERE PRODUCT_MODEL_ID IS NOT NULL"
            ]:

                try:

                    db.execute(text(sql))

                except Exception:

                    pass

            # Now wipe in child-first order
            wipe_tables = [
                # PO + GRN ecosystem (child → parent)
                "purchase_order_activity",
                "goods_receipt_line",
                "goods_receipt_note",
                "purchase_order_line",
                "purchase_order",
                # BOM + materials + inventory
                "inventory",
                "material_department",
                "bom_item",
                "material_catalog",
                # Products + suppliers
                "product_model",
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

    # ---- 3. SEED materials + matching Inventory rows ----
    name_to_material = {}

    name_to_supplier_id = {}

    inventory_created = 0

    for name, price, supplier_code, unit, hsn in MATERIALS:

        mat = db.query(MaterialCatalog).filter(
            MaterialCatalog.MATERIAL_NAME == name
        ).first()

        if not mat:

            mat = MaterialCatalog(MATERIAL_NAME=name)

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
            Inventory.MATERIAL_ID == mat.ID,
            Inventory.VENDOR_ID == vendor_id
        ).first()

        if not inv:

            db.add(Inventory(
                MATERIAL_ID=mat.ID,
                MATERIAL_NAME=name,
                QUANTITY=0,
                UNIT_PRICE=float(price),
                VENDOR_ID=vendor_id
            ))

            inventory_created += 1

    db.commit()

    summary["created"]["materials"] = len(name_to_material)

    summary["created"]["inventory_rows"] = inventory_created

    # ---- 4. SEED products + their BOMs ----
    products_created = 0

    bom_lines_created = 0

    bom_lines_skipped = 0

    for p in PRODUCTS:

        prod = db.query(ProductModel).filter(
            ProductModel.VENDOR_ID == vendor_id,
            ProductModel.MODEL_CODE == p["MODEL_CODE"]
        ).first()

        if not prod:

            prod = ProductModel(
                MODEL_CODE=p["MODEL_CODE"],
                MODEL_NAME=p["MODEL_NAME"],
                CATEGORY=p["CATEGORY"],
                DESCRIPTION=p["DESCRIPTION"],
                ESTIMATED_BUILD_DAYS=p["ESTIMATED_BUILD_DAYS"],
                VENDOR_ID=vendor_id,
                STATUS="ACTIVE"
            )

            db.add(prod)

            db.flush()

            products_created += 1

        # Wipe any leftover BOM lines for this product so the seed
        # is fully deterministic (re-running gives the same result).
        db.query(BOMItem).filter(
            BOMItem.PRODUCT_MODEL_ID == prod.ID
        ).delete()

        for (mat_name, qty, unit, item_no, notes) in p["BOM"]:

            mat = name_to_material.get(mat_name)

            if not mat:

                bom_lines_skipped += 1

                continue

            db.add(BOMItem(
                PRODUCT_MODEL_ID=prod.ID,
                MATERIAL_ID=mat.ID,
                MATERIAL_NAME=mat_name,
                QUANTITY=float(qty),
                UNIT=unit,
                ITEM_TYPE="PURCHASE",
                PREFERRED_SUPPLIER_ID=name_to_supplier_id.get(mat_name),
                NOTES=notes or None,
                ITEM_NO=item_no
            ))

            bom_lines_created += 1

    db.commit()

    summary["created"]["products"] = products_created

    summary["created"]["bom_lines"] = bom_lines_created

    if bom_lines_skipped:

        summary["created"]["bom_lines_skipped"] = bom_lines_skipped

    # ---- 5. RELINK preserved project / requirement / quotation_line ----
    # Map fresh MODEL_CODE → new ProductModel.ID, then repoint any rows
    # we saved before the wipe. This restores customer-facing links
    # across a reset+reseed so existing projects / requirements
    # remain functional.
    relinked = {"project": 0, "customer_requirement": 0, "quotation_line": 0}

    new_code_to_id = {}

    for pm in db.query(ProductModel).all():

        if pm.MODEL_CODE:

            new_code_to_id[pm.MODEL_CODE] = pm.ID

    for table, id_to_code in preserved_links.items():

        for row_id, code in id_to_code.items():

            new_id = new_code_to_id.get(code)

            if not new_id:

                continue

            try:

                db.execute(text(
                    f"UPDATE {table} "
                    f"SET PRODUCT_MODEL_ID = {int(new_id)} "
                    f"WHERE ID = {int(row_id)}"
                ))

                relinked[table] += 1

            except Exception:

                pass

    db.commit()

    summary["relinked"] = relinked

    return {
        "message": (
            f"Reset {'+ seed' if wipe else ''} complete. "
            f"{summary['created'].get('suppliers', 0)} suppliers, "
            f"{summary['created'].get('materials', 0)} materials, "
            f"{summary['created'].get('products', 0)} products, "
            f"{summary['created'].get('bom_lines', 0)} BOM lines."
        ),
        **summary
    }
