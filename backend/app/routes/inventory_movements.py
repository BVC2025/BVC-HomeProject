"""
Inventory Movement audit trail — append-only stock ledger.
Rows are created by inventory_automation_service.record_movement()
and are NEVER updated after insert.
"""

import io
from datetime import datetime
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.inventory_models import InventoryItem, InventoryMovement, ProductMaster

router = APIRouter(prefix="/inventory-movements", tags=["Inventory Movements"])


@router.get("")
def list_movements(
    vendor_id: int = Query(1),
    item_id: Optional[str] = Query(None),
    movement_type: Optional[str] = Query(None),
    reference_type: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(InventoryMovement).filter(InventoryMovement.VENDOR_ID == vendor_id)
    if item_id:
        q = q.filter(InventoryMovement.INVENTORY_ITEM_ID == item_id)
    if movement_type:
        q = q.filter(InventoryMovement.MOVEMENT_TYPE == movement_type.upper())
    if reference_type:
        q = q.filter(InventoryMovement.REFERENCE_TYPE == reference_type.upper())
    if from_date:
        try:
            q = q.filter(InventoryMovement.CREATED_AT >= datetime.fromisoformat(from_date))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid from_date format (use YYYY-MM-DD)")
    if to_date:
        try:
            q = q.filter(InventoryMovement.CREATED_AT <= datetime.fromisoformat(to_date + "T23:59:59"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid to_date format (use YYYY-MM-DD)")

    total = q.count()
    rows = q.order_by(InventoryMovement.CREATED_AT.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_serialize_movement(m) for m in rows],
    }


@router.get("/{item_id}/history")
def get_item_history(
    item_id: str,
    vendor_id: int = Query(1),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """All movements for a single inventory item, most recent first."""
    item = db.query(InventoryItem).filter(
        InventoryItem.ID == item_id,
        InventoryItem.VENDOR_ID == vendor_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    q = db.query(InventoryMovement).filter(
        InventoryMovement.INVENTORY_ITEM_ID == item_id
    )
    total = q.count()
    rows = q.order_by(InventoryMovement.CREATED_AT.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "item_id": item_id,
        "total": total, "page": page, "page_size": page_size,
        "movements": [_serialize_movement(m) for m in rows],
    }


@router.get("/export/excel")
def export_movements(
    vendor_id: int = Query(1),
    item_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(InventoryMovement).filter(InventoryMovement.VENDOR_ID == vendor_id)
    if item_id:
        q = q.filter(InventoryMovement.INVENTORY_ITEM_ID == item_id)
    if from_date:
        q = q.filter(InventoryMovement.CREATED_AT >= datetime.fromisoformat(from_date))
    if to_date:
        q = q.filter(InventoryMovement.CREATED_AT <= datetime.fromisoformat(to_date + "T23:59:59"))
    rows = q.order_by(InventoryMovement.CREATED_AT.desc()).all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Movements"
    ws.append([
        "MOVEMENT ID", "ITEM ID", "TYPE", "QTY", "QTY BEFORE", "QTY AFTER",
        "UNIT COST", "REFERENCE TYPE", "REFERENCE ID", "REASON", "CREATED AT",
    ])
    for r in rows:
        ws.append([
            r.ID, r.INVENTORY_ITEM_ID, r.MOVEMENT_TYPE,
            r.QTY, r.QTY_BEFORE, r.QTY_AFTER,
            r.UNIT_COST or "", r.REFERENCE_TYPE or "", r.REFERENCE_ID or "",
            r.REASON or "",
            r.CREATED_AT.isoformat() if r.CREATED_AT else "",
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inventory_movements_export.xlsx"},
    )


def _serialize_movement(m: InventoryMovement) -> dict:
    return {
        "ID": m.ID,
        "INVENTORY_ITEM_ID": m.INVENTORY_ITEM_ID,
        "MOVEMENT_TYPE": m.MOVEMENT_TYPE,
        "QTY": m.QTY,
        "QTY_BEFORE": m.QTY_BEFORE,
        "QTY_AFTER": m.QTY_AFTER,
        "UNIT_COST": m.UNIT_COST,
        "REFERENCE_TYPE": m.REFERENCE_TYPE,
        "REFERENCE_ID": m.REFERENCE_ID,
        "BATCH_ID": m.BATCH_ID,
        "REASON": m.REASON,
        "NOTES": m.NOTES,
        "PERFORMED_BY_ID": m.PERFORMED_BY_ID,
        "CREATED_AT": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
    }
