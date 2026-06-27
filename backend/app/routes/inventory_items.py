"""
Inventory Items — new comprehensive item master.

InventoryItem links a ProductMaster to a physical storage location
and carries reorder/safety-stock thresholds.  Stock levels live in
InventoryStock; every change is logged in InventoryMovement via the
inventory_automation_service.record_movement() entry-point.
"""

import io
from datetime import datetime, date
from typing import Optional, List

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import CustomField, CustomFieldTableValue
from app.models.inventory_models import (
    InventoryCategory,
    ProductMaster,
    InventoryItem,
    InventoryStock,
    InventoryBatch,
)
from app.schemas.inventory_item_schema import (
    InventoryItemCreate,
    InventoryItemUpdate,
    StockMovementRequest,
    StockTransferRequest,
    BatchCreate,
    BatchUpdate,
)
from app.services.inventory_automation_service import record_movement

router = APIRouter(prefix="/inventory-items", tags=["Inventory Items"])


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _cf_fields_for_table(table_name: str, vendor_id: int, db: Session):
    return (
        db.query(CustomField)
        .filter(CustomField.TABLE_NAME == table_name, CustomField.VENDOR_ID == vendor_id)
        .order_by(CustomField.SORT_ORDER, CustomField.FIELD_NAME)
        .all()
    )


def _upsert_cf_bulk(row_id: str, table_name: str, cf_field_id: str, value, db: Session):
    existing = (
        db.query(CustomFieldTableValue)
        .filter(
            CustomFieldTableValue.TABLE_NAME == table_name,
            CustomFieldTableValue.TABLE_ROW_ID == str(row_id),
            CustomFieldTableValue.CUSTOM_FIELD_ID == cf_field_id,
        )
        .first()
    )
    if existing:
        existing.CUSTOM_FIELD_VALUE = value if value else None
    elif value is not None:
        db.add(CustomFieldTableValue(
            TABLE_NAME=table_name,
            TABLE_ROW_ID=str(row_id),
            CUSTOM_FIELD_ID=cf_field_id,
            CUSTOM_FIELD_VALUE=value,
        ))


def _serialize_item(item: InventoryItem, stock: Optional[InventoryStock] = None) -> dict:
    d = {
        "ID": item.ID,
        "VENDOR_ID": item.VENDOR_ID,
        "PRODUCT_ID": item.PRODUCT_ID,
        "LOCATION": item.LOCATION,
        "BATCH_TRACKING": item.BATCH_TRACKING,
        "REORDER_LEVEL": item.REORDER_LEVEL,
        "REORDER_QTY": item.REORDER_QTY,
        "SAFETY_STOCK": item.SAFETY_STOCK,
        "MAX_STOCK": item.MAX_STOCK,
        "CREATED_AT": item.CREATED_AT.isoformat() if item.CREATED_AT else None,
        "UPDATED_AT": item.UPDATED_AT.isoformat() if item.UPDATED_AT else None,
    }
    if item.product:
        d["PRODUCT_CODE"] = item.product.PRODUCT_CODE
        d["PRODUCT_NAME"] = item.product.PRODUCT_NAME
        d["UNIT"] = item.product.UNIT
    s = stock or item.stock
    if s:
        d["stock"] = {
            "CURRENT_QTY": s.CURRENT_QTY,
            "RESERVED_QTY": s.RESERVED_QTY,
            "AVAILABLE_QTY": s.AVAILABLE_QTY,
            "UNIT_COST": s.UNIT_COST,
            "STATUS": s.STATUS,
            "LAST_MOVEMENT_AT": s.LAST_MOVEMENT_AT.isoformat() if s.LAST_MOVEMENT_AT else None,
        }
    else:
        d["stock"] = None
    return d


# ─────────────────────────────────────────────────────────────────────
# InventoryItem CRUD
# ─────────────────────────────────────────────────────────────────────

@router.get("")
def list_items(
    vendor_id: int = Query(1),
    product_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = (
        db.query(InventoryItem)
        .join(ProductMaster, ProductMaster.ID == InventoryItem.PRODUCT_ID)
        .filter(InventoryItem.VENDOR_ID == vendor_id)
    )
    if product_id:
        q = q.filter(InventoryItem.PRODUCT_ID == product_id)
    if search:
        term = f"%{search}%"
        q = q.filter(
            ProductMaster.PRODUCT_NAME.ilike(term) |
            ProductMaster.PRODUCT_CODE.ilike(term)
        )
    if status:
        q = q.join(InventoryStock, InventoryStock.INVENTORY_ITEM_ID == InventoryItem.ID, isouter=True)
        q = q.filter(InventoryStock.STATUS == status.upper())

    total = q.count()
    items = q.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_serialize_item(i) for i in items],
    }


@router.post("")
def create_item(payload: InventoryItemCreate, db: Session = Depends(get_db)):
    product = db.query(ProductMaster).filter(
        ProductMaster.ID == payload.PRODUCT_ID,
        ProductMaster.VENDOR_ID == payload.VENDOR_ID,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    existing = db.query(InventoryItem).filter(
        InventoryItem.VENDOR_ID == payload.VENDOR_ID,
        InventoryItem.PRODUCT_ID == payload.PRODUCT_ID,
        InventoryItem.LOCATION == payload.LOCATION,
    ).first()
    if existing:
        raise HTTPException(
            status_code=400,
            detail="An inventory item already exists for this product and location"
        )

    item = InventoryItem(**payload.dict())
    db.add(item)
    db.flush()

    # Auto-create stock row
    stock = InventoryStock(
        VENDOR_ID=payload.VENDOR_ID,
        INVENTORY_ITEM_ID=item.ID,
        CURRENT_QTY=0.0,
        AVAILABLE_QTY=0.0,
        STATUS="OUT_OF_STOCK",
    )
    db.add(stock)
    db.commit()
    db.refresh(item)
    return {"message": "Inventory item created", "ID": item.ID}


@router.get("/low-stock")
def get_low_stock(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    rows = (
        db.query(InventoryItem)
        .join(InventoryStock, InventoryStock.INVENTORY_ITEM_ID == InventoryItem.ID)
        .filter(
            InventoryItem.VENDOR_ID == vendor_id,
            InventoryStock.STATUS == "LOW_STOCK",
        )
        .all()
    )
    return [_serialize_item(r) for r in rows]


@router.get("/out-of-stock")
def get_out_of_stock(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    rows = (
        db.query(InventoryItem)
        .join(InventoryStock, InventoryStock.INVENTORY_ITEM_ID == InventoryItem.ID)
        .filter(
            InventoryItem.VENDOR_ID == vendor_id,
            InventoryStock.STATUS == "OUT_OF_STOCK",
        )
        .all()
    )
    return [_serialize_item(r) for r in rows]


@router.get("/{item_id}")
def get_item(item_id: str, db: Session = Depends(get_db)):
    item = db.query(InventoryItem).filter(InventoryItem.ID == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    result = _serialize_item(item)
    result["custom_fields"] = [
        {"ID": f.ID, "FIELD_NAME": f.FIELD_NAME, "FIELD_TYPE": f.FIELD_TYPE,
         "IS_REQUIRED": f.IS_REQUIRED, "SORT_ORDER": f.SORT_ORDER, "OPTIONS": f.OPTIONS}
        for f in _cf_fields_for_table("inventory_item", item.VENDOR_ID, db)
    ]
    result["custom_field_values"] = [
        {"CUSTOM_FIELD_ID": v.CUSTOM_FIELD_ID, "VALUE": v.CUSTOM_FIELD_VALUE}
        for v in db.query(CustomFieldTableValue).filter(
            CustomFieldTableValue.TABLE_NAME == "inventory_item",
            CustomFieldTableValue.TABLE_ROW_ID == str(item_id),
        ).all()
    ]
    return result


@router.put("/{item_id}")
def update_item(item_id: str, payload: InventoryItemUpdate, db: Session = Depends(get_db)):
    item = db.query(InventoryItem).filter(InventoryItem.ID == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    for k, v in payload.dict(exclude_none=True).items():
        setattr(item, k, v)
    db.commit()
    # Recalculate status if thresholds changed
    from app.services.inventory_automation_service import recalculate_stock_status
    recalculate_stock_status(db, item.VENDOR_ID, item_id)
    return {"message": "Inventory item updated"}


@router.delete("/{item_id}")
def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.query(InventoryItem).filter(InventoryItem.ID == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")
    if item.stock and item.stock.CURRENT_QTY > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete item with stock ({item.stock.CURRENT_QTY} units remaining). "
                   "Adjust stock to zero first."
        )
    db.delete(item)
    db.commit()
    return {"message": "Inventory item deleted"}


@router.get("/{item_id}/stock")
def get_stock(item_id: str, db: Session = Depends(get_db)):
    stock = db.query(InventoryStock).filter(
        InventoryStock.INVENTORY_ITEM_ID == item_id
    ).first()
    if not stock:
        raise HTTPException(status_code=404, detail="No stock record found for this item")
    return {
        "INVENTORY_ITEM_ID": item_id,
        "CURRENT_QTY": stock.CURRENT_QTY,
        "RESERVED_QTY": stock.RESERVED_QTY,
        "AVAILABLE_QTY": stock.AVAILABLE_QTY,
        "UNIT_COST": stock.UNIT_COST,
        "STATUS": stock.STATUS,
        "LAST_MOVEMENT_AT": stock.LAST_MOVEMENT_AT.isoformat() if stock.LAST_MOVEMENT_AT else None,
        "UPDATED_AT": stock.UPDATED_AT.isoformat() if stock.UPDATED_AT else None,
    }


# ─────────────────────────────────────────────────────────────────────
# Stock Operations — all go through record_movement()
# ─────────────────────────────────────────────────────────────────────

@router.post("/stock-in")
def stock_in(payload: StockMovementRequest, db: Session = Depends(get_db)):
    """Receive stock into inventory."""
    movement = record_movement(
        db=db,
        vendor_id=payload.VENDOR_ID,
        item_id=payload.INVENTORY_ITEM_ID,
        movement_type="STOCK_IN",
        qty=payload.QTY,
        performed_by_id=payload.PERFORMED_BY_ID,
        reference_type=payload.REFERENCE_TYPE,
        reference_id=payload.REFERENCE_ID,
        batch_id=payload.BATCH_ID,
        reason=payload.REASON,
        notes=payload.NOTES,
        unit_cost=payload.UNIT_COST,
    )
    db.commit()
    return {
        "message": "Stock in recorded",
        "MOVEMENT_ID": movement.ID,
        "QTY_AFTER": movement.QTY_AFTER,
    }


@router.post("/stock-out")
def stock_out(payload: StockMovementRequest, db: Session = Depends(get_db)):
    """Issue stock from inventory."""
    movement = record_movement(
        db=db,
        vendor_id=payload.VENDOR_ID,
        item_id=payload.INVENTORY_ITEM_ID,
        movement_type="STOCK_OUT",
        qty=payload.QTY,
        performed_by_id=payload.PERFORMED_BY_ID,
        reference_type=payload.REFERENCE_TYPE,
        reference_id=payload.REFERENCE_ID,
        batch_id=payload.BATCH_ID,
        reason=payload.REASON,
        notes=payload.NOTES,
    )
    db.commit()
    return {
        "message": "Stock out recorded",
        "MOVEMENT_ID": movement.ID,
        "QTY_AFTER": movement.QTY_AFTER,
    }


@router.post("/stock-adjust")
def stock_adjust(payload: StockMovementRequest, db: Session = Depends(get_db)):
    """Manual stock adjustment — sets qty to an absolute value."""
    movement = record_movement(
        db=db,
        vendor_id=payload.VENDOR_ID,
        item_id=payload.INVENTORY_ITEM_ID,
        movement_type="ADJUSTMENT",
        qty=payload.QTY,
        performed_by_id=payload.PERFORMED_BY_ID,
        reason=payload.REASON,
        notes=payload.NOTES,
        unit_cost=payload.UNIT_COST,
    )
    db.commit()
    return {
        "message": "Stock adjusted",
        "MOVEMENT_ID": movement.ID,
        "QTY_AFTER": movement.QTY_AFTER,
    }


@router.post("/stock-transfer")
def stock_transfer(payload: StockTransferRequest, db: Session = Depends(get_db)):
    """Transfer stock between two InventoryItem locations (atomic pair of movements)."""
    # TRANSFER_OUT from source
    out_mv = record_movement(
        db=db,
        vendor_id=payload.VENDOR_ID,
        item_id=payload.FROM_ITEM_ID,
        movement_type="TRANSFER_OUT",
        qty=payload.QTY,
        performed_by_id=payload.PERFORMED_BY_ID,
        reference_type="TRANSFER",
        reference_id=payload.TO_ITEM_ID,
        reason=payload.REASON,
    )
    # TRANSFER_IN at destination
    in_mv = record_movement(
        db=db,
        vendor_id=payload.VENDOR_ID,
        item_id=payload.TO_ITEM_ID,
        movement_type="TRANSFER_IN",
        qty=payload.QTY,
        performed_by_id=payload.PERFORMED_BY_ID,
        reference_type="TRANSFER",
        reference_id=payload.FROM_ITEM_ID,
        reason=payload.REASON,
    )
    db.commit()
    return {
        "message": "Stock transferred",
        "from_movement_id": out_mv.ID,
        "to_movement_id": in_mv.ID,
        "qty_transferred": payload.QTY,
    }


# ─────────────────────────────────────────────────────────────────────
# Bulk Upload / Template / Export
# ─────────────────────────────────────────────────────────────────────

def _parse_bulk_xl(content: bytes, required_sheet: str):
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    if required_sheet not in wb.sheetnames:
        available = ", ".join(f'"{s}"' for s in wb.sheetnames)
        raise HTTPException(
            status_code=400,
            detail=f'Sheet "{required_sheet}" not found. Available: {available}.',
        )
    ws = wb[required_sheet]
    headers = None
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            headers = [str(c).strip().upper() if c is not None else "" for c in row]
            continue
        if all(c is None for c in row):
            continue
        rows.append(row)
    return headers, rows


def _cell(record: dict, *keys) -> str:
    for k in keys:
        v = record.get(k.upper())
        if v is not None:
            s = str(v).strip()
            if s:
                return s
    return ""


_ITEM_STD_COLS = {
    "PRODUCT CODE", "LOCATION", "REORDER LEVEL", "REORDER QTY",
    "SAFETY STOCK", "MAX STOCK", "BATCH TRACKING", "S.NO", "SN", ""
}


@router.get("/bulk-template")
def download_item_template(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "InventoryItems"
    std_cols = ["PRODUCT CODE", "LOCATION", "REORDER LEVEL",
                "REORDER QTY", "SAFETY STOCK", "MAX STOCK", "BATCH TRACKING"]
    cf_fields = _cf_fields_for_table("inventory_item", vendor_id, db)
    cf_cols = [f.FIELD_NAME for f in cf_fields]
    ws.append(std_cols + cf_cols)
    from openpyxl.styles import Font, PatternFill
    hdr_fill = PatternFill(start_color="1F3864", end_color="1F3864", fill_type="solid")
    hdr_font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.fill = hdr_fill
        cell.font = hdr_font
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inventory_items_template.xlsx"},
    )


@router.post("/bulk-upload")
async def bulk_upload_items(
    vendor_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    content = await file.read()
    headers, data_rows = _parse_bulk_xl(content, "InventoryItems")

    cf_fields = _cf_fields_for_table("inventory_item", vendor_id, db)
    cf_by_upper = {f.FIELD_NAME.upper(): f for f in cf_fields}
    cf_cols = [h for h in headers if h not in _ITEM_STD_COLS and h in cf_by_upper]

    products_by_code = {
        p.PRODUCT_CODE.upper(): p
        for p in db.query(ProductMaster).filter(
            ProductMaster.VENDOR_ID == vendor_id
        ).all()
    }

    inserted = updated = skipped = 0
    errors: List[dict] = []

    for row_num, raw in enumerate(data_rows, start=2):
        record = {headers[i].upper(): raw[i] for i in range(len(headers))}
        prod_code = _cell(record, "PRODUCT CODE")
        if not prod_code:
            errors.append({"row": row_num, "field": "PRODUCT CODE", "message": "Required"})
            continue

        product = products_by_code.get(prod_code.upper())
        if not product:
            errors.append({"row": row_num, "field": "PRODUCT CODE", "message": f"Product '{prod_code}' not found"})
            continue

        location = _cell(record, "LOCATION") or None

        existing = db.query(InventoryItem).filter(
            InventoryItem.VENDOR_ID == vendor_id,
            InventoryItem.PRODUCT_ID == product.ID,
            InventoryItem.LOCATION == location,
        ).first()

        def safe_float(val, default=0.0):
            try:
                return float(val) if val not in (None, "") else default
            except (ValueError, TypeError):
                return default

        if existing:
            existing.REORDER_LEVEL = safe_float(_cell(record, "REORDER LEVEL"), existing.REORDER_LEVEL)
            existing.REORDER_QTY = safe_float(_cell(record, "REORDER QTY"), existing.REORDER_QTY)
            existing.SAFETY_STOCK = safe_float(_cell(record, "SAFETY STOCK"), existing.SAFETY_STOCK)
            existing.MAX_STOCK = safe_float(_cell(record, "MAX STOCK"), existing.MAX_STOCK)
            bt_val = _cell(record, "BATCH TRACKING")
            if bt_val:
                existing.BATCH_TRACKING = bt_val.upper() in ("YES", "TRUE", "1", "Y")
            for cf_id in cf_cols:
                _upsert_cf_bulk(existing.ID, "inventory_item", cf_by_upper[cf_id].ID, record.get(cf_id), db)
            updated += 1
        else:
            item = InventoryItem(
                VENDOR_ID=vendor_id,
                PRODUCT_ID=product.ID,
                LOCATION=location,
                REORDER_LEVEL=safe_float(_cell(record, "REORDER LEVEL")),
                REORDER_QTY=safe_float(_cell(record, "REORDER QTY")),
                SAFETY_STOCK=safe_float(_cell(record, "SAFETY STOCK")),
                MAX_STOCK=safe_float(_cell(record, "MAX STOCK")),
                BATCH_TRACKING=_cell(record, "BATCH TRACKING").upper() in ("YES", "TRUE", "1", "Y"),
            )
            db.add(item)
            db.flush()
            # Auto-create stock row
            db.add(InventoryStock(
                VENDOR_ID=vendor_id,
                INVENTORY_ITEM_ID=item.ID,
                CURRENT_QTY=0.0,
                AVAILABLE_QTY=0.0,
                STATUS="OUT_OF_STOCK",
            ))
            for col in cf_cols:
                _upsert_cf_bulk(item.ID, "inventory_item", cf_by_upper[col].ID, record.get(col), db)
            inserted += 1

    db.commit()
    return {
        "message": f"Upload: {inserted} inserted, {updated} updated, {skipped} skipped",
        "inserted": inserted, "updated": updated, "skipped": skipped,
        "total_rows": len(data_rows), "errors": errors,
    }


@router.get("/export/excel")
def export_items(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    rows = (
        db.query(InventoryItem)
        .join(ProductMaster, ProductMaster.ID == InventoryItem.PRODUCT_ID, isouter=True)
        .filter(InventoryItem.VENDOR_ID == vendor_id)
        .order_by(ProductMaster.PRODUCT_NAME)
        .all()
    )
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "InventoryItems"
    ws.append([
        "PRODUCT CODE", "PRODUCT NAME", "LOCATION", "UNIT",
        "CURRENT QTY", "AVAILABLE QTY", "STATUS",
        "REORDER LEVEL", "REORDER QTY", "SAFETY STOCK", "MAX STOCK",
    ])
    for r in rows:
        s = r.stock
        ws.append([
            r.product.PRODUCT_CODE if r.product else "",
            r.product.PRODUCT_NAME if r.product else "",
            r.LOCATION or "",
            r.product.UNIT if r.product else "",
            s.CURRENT_QTY if s else 0,
            s.AVAILABLE_QTY if s else 0,
            s.STATUS if s else "UNKNOWN",
            r.REORDER_LEVEL, r.REORDER_QTY, r.SAFETY_STOCK, r.MAX_STOCK,
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inventory_items_export.xlsx"},
    )
