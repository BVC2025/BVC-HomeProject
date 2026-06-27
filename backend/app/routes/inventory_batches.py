"""
Inventory Batch / Lot tracking.

Batches are created automatically when a GRN is finalized, or manually
via this API. They track QTY_RECEIVED vs QTY_REMAINING and support
expiry-date management.
"""

from datetime import datetime, date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.inventory_models import InventoryBatch, InventoryItem
from app.schemas.inventory_item_schema import BatchCreate, BatchUpdate

router = APIRouter(prefix="/inventory-batches", tags=["Inventory Batches"])


def _serialize_batch(b: InventoryBatch) -> dict:
    return {
        "ID": b.ID,
        "VENDOR_ID": b.VENDOR_ID,
        "INVENTORY_ITEM_ID": b.INVENTORY_ITEM_ID,
        "BATCH_NUMBER": b.BATCH_NUMBER,
        "LOT_NUMBER": b.LOT_NUMBER,
        "SUPPLIER_ID": b.SUPPLIER_ID,
        "PO_ID": b.PO_ID,
        "GRN_ID": b.GRN_ID,
        "MANUFACTURING_DATE": b.MANUFACTURING_DATE.isoformat() if b.MANUFACTURING_DATE else None,
        "EXPIRY_DATE": b.EXPIRY_DATE.isoformat() if b.EXPIRY_DATE else None,
        "QTY_RECEIVED": b.QTY_RECEIVED,
        "QTY_REMAINING": b.QTY_REMAINING,
        "UNIT_COST": b.UNIT_COST,
        "STATUS": b.STATUS,
        "NOTES": b.NOTES,
        "CREATED_AT": b.CREATED_AT.isoformat() if b.CREATED_AT else None,
        "UPDATED_AT": b.UPDATED_AT.isoformat() if b.UPDATED_AT else None,
    }


@router.get("")
def list_batches(
    vendor_id: int = Query(1),
    item_id: Optional[str] = Query(None),
    supplier_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = db.query(InventoryBatch).filter(InventoryBatch.VENDOR_ID == vendor_id)
    if item_id:
        q = q.filter(InventoryBatch.INVENTORY_ITEM_ID == item_id)
    if supplier_id:
        q = q.filter(InventoryBatch.SUPPLIER_ID == supplier_id)
    if status:
        q = q.filter(InventoryBatch.STATUS == status.upper())
    total = q.count()
    rows = q.order_by(InventoryBatch.CREATED_AT.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_serialize_batch(r) for r in rows],
    }


@router.post("")
def create_batch(payload: BatchCreate, db: Session = Depends(get_db)):
    item = db.query(InventoryItem).filter(
        InventoryItem.ID == payload.INVENTORY_ITEM_ID,
        InventoryItem.VENDOR_ID == payload.VENDOR_ID,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found")

    existing = db.query(InventoryBatch).filter(
        InventoryBatch.VENDOR_ID == payload.VENDOR_ID,
        InventoryBatch.INVENTORY_ITEM_ID == payload.INVENTORY_ITEM_ID,
        InventoryBatch.BATCH_NUMBER == payload.BATCH_NUMBER,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Batch '{payload.BATCH_NUMBER}' already exists for this item")

    mfg_date = None
    exp_date = None
    if payload.MANUFACTURING_DATE:
        try:
            mfg_date = date.fromisoformat(payload.MANUFACTURING_DATE)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid MANUFACTURING_DATE (use YYYY-MM-DD)")
    if payload.EXPIRY_DATE:
        try:
            exp_date = date.fromisoformat(payload.EXPIRY_DATE)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid EXPIRY_DATE (use YYYY-MM-DD)")

    batch = InventoryBatch(
        VENDOR_ID=payload.VENDOR_ID,
        INVENTORY_ITEM_ID=payload.INVENTORY_ITEM_ID,
        BATCH_NUMBER=payload.BATCH_NUMBER,
        LOT_NUMBER=payload.LOT_NUMBER,
        SUPPLIER_ID=payload.SUPPLIER_ID,
        PO_ID=payload.PO_ID,
        GRN_ID=payload.GRN_ID,
        MANUFACTURING_DATE=mfg_date,
        EXPIRY_DATE=exp_date,
        QTY_RECEIVED=payload.QTY_RECEIVED,
        QTY_REMAINING=payload.QTY_RECEIVED,
        UNIT_COST=payload.UNIT_COST,
        NOTES=payload.NOTES,
        STATUS="ACTIVE",
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return {"message": "Batch created", "ID": batch.ID}


@router.get("/expiring-soon")
def expiring_soon(
    vendor_id: int = Query(1),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Batches expiring within N days."""
    from datetime import timedelta
    cutoff = date.today() + timedelta(days=days)
    rows = (
        db.query(InventoryBatch)
        .filter(
            InventoryBatch.VENDOR_ID == vendor_id,
            InventoryBatch.EXPIRY_DATE.isnot(None),
            InventoryBatch.EXPIRY_DATE <= cutoff,
            InventoryBatch.STATUS == "ACTIVE",
            InventoryBatch.QTY_REMAINING > 0,
        )
        .order_by(InventoryBatch.EXPIRY_DATE.asc())
        .all()
    )
    return [_serialize_batch(r) for r in rows]


@router.get("/{batch_id}")
def get_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = db.query(InventoryBatch).filter(InventoryBatch.ID == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _serialize_batch(batch)


@router.put("/{batch_id}")
def update_batch(batch_id: str, payload: BatchUpdate, db: Session = Depends(get_db)):
    batch = db.query(InventoryBatch).filter(InventoryBatch.ID == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    for k, v in payload.dict(exclude_none=True).items():
        setattr(batch, k, v)
    db.commit()
    return {"message": "Batch updated"}
