"""
Inventory Batch / Lot tracking.

Batches are created automatically when a GRN is finalized (see
purchase_order.py's _apply_grn_to_inventory), or manually via this API.
They track QTY_RECEIVED vs QTY_REMAINING and support expiry-date
management. Manual batch creation is transactional with the stock
increment: creating a batch always also increments InventoryStock.
CURRENT_QTY and records an InventoryMovement — a batch is never created
without the stock system knowing about it.
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.utils.db_error_handler import raise_db_error
from app.database.database import get_db
from app.models.inventory_models import InventoryBatch, ProductMaster
from app.schemas.inventory_item_schema import BatchCreate, BatchUpdate
from app.services.inventory_automation_service import record_movement
from app.auth.auth_bearer import require

router = APIRouter(prefix="/inventory-batches", tags=["Inventory Batches"])


def _serialize_batch(b: InventoryBatch) -> dict:
    return {
        "ID": b.ID,
        "VENDOR_ID": b.VENDOR_ID,
        "PRODUCT_ID": b.PRODUCT_ID,
        "PRODUCT_CODE": b.product.PRODUCT_CODE if b.product else None,
        "PRODUCT_NAME": b.product.PRODUCT_NAME if b.product else None,
        "BATCH_NUMBER": b.BATCH_NUMBER,
        "LOT_NUMBER": b.LOT_NUMBER,
        "SUPPLIER_ID": b.SUPPLIER_ID,
        "PO_ID": b.PO_ID,
        "GRN_ID": b.GRN_ID,
        "RECEIVED_DATE": b.RECEIVED_DATE.isoformat() if b.RECEIVED_DATE else None,
        "MANUFACTURING_DATE": b.MANUFACTURING_DATE.isoformat() if b.MANUFACTURING_DATE else None,
        "EXPIRY_DATE": b.EXPIRY_DATE.isoformat() if b.EXPIRY_DATE else None,
        "QTY_RECEIVED": b.QTY_RECEIVED,
        "QTY_REMAINING": b.QTY_REMAINING,
        "UNIT_COST": b.UNIT_COST,
        "DC_FILE_URL": b.DC_FILE_URL,
        "INVOICE_FILE_URL": b.INVOICE_FILE_URL,
        "STATUS": b.STATUS,
        "NOTES": b.NOTES,
        "CREATED_BY": b.CREATED_BY,
        "CREATED_AT": b.CREATED_AT.isoformat() if b.CREATED_AT else None,
        "UPDATED_AT": b.UPDATED_AT.isoformat() if b.UPDATED_AT else None,
    }


def _parse_date(value: Optional[str], field: str) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {field} (use YYYY-MM-DD)")


@router.get("", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def list_batches(
    vendor_id: int = Query(1),
    product_id: Optional[str] = Query(None),
    supplier_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    q = db.query(InventoryBatch).filter(InventoryBatch.VENDOR_ID == vendor_id)
    if product_id:
        q = q.filter(InventoryBatch.PRODUCT_ID == product_id)
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


@router.post("", dependencies=[Depends(require("inventory.purchase", "inventory.batches.create"))])
def create_batch(payload: BatchCreate, db: Session = Depends(get_db)):
    """Manual batch receipt. Requires at least one of INVOICE_FILE_URL /
    DC_FILE_URL — a batch cannot be created with neither document on
    file. Atomically increments InventoryStock and records an
    InventoryMovement (STOCK_IN, REFERENCE_TYPE="MANUAL_BATCH")."""
    if not payload.INVOICE_FILE_URL and not payload.DC_FILE_URL:
        raise HTTPException(
            status_code=400,
            detail="An Invoice or Delivery Challan file is required to create a batch.",
        )

    product = db.query(ProductMaster).filter(
        ProductMaster.ID == payload.PRODUCT_ID,
        ProductMaster.VENDOR_ID == payload.VENDOR_ID,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    existing = db.query(InventoryBatch).filter(
        InventoryBatch.VENDOR_ID == payload.VENDOR_ID,
        InventoryBatch.PRODUCT_ID == payload.PRODUCT_ID,
        InventoryBatch.BATCH_NUMBER == payload.BATCH_NUMBER,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Batch '{payload.BATCH_NUMBER}' already exists for this product")

    if payload.QTY_RECEIVED <= 0:
        raise HTTPException(status_code=400, detail="QTY_RECEIVED must be greater than zero")

    received_date = _parse_date(payload.RECEIVED_DATE, "RECEIVED_DATE") or date.today()
    mfg_date = _parse_date(payload.MANUFACTURING_DATE, "MANUFACTURING_DATE")
    exp_date = _parse_date(payload.EXPIRY_DATE, "EXPIRY_DATE")

    try:
        batch = InventoryBatch(
            VENDOR_ID=payload.VENDOR_ID,
            PRODUCT_ID=payload.PRODUCT_ID,
            BATCH_NUMBER=payload.BATCH_NUMBER,
            LOT_NUMBER=payload.LOT_NUMBER,
            SUPPLIER_ID=payload.SUPPLIER_ID,
            RECEIVED_DATE=received_date,
            MANUFACTURING_DATE=mfg_date,
            EXPIRY_DATE=exp_date,
            QTY_RECEIVED=payload.QTY_RECEIVED,
            QTY_REMAINING=payload.QTY_RECEIVED,
            UNIT_COST=payload.UNIT_COST,
            DC_FILE_URL=payload.DC_FILE_URL,
            INVOICE_FILE_URL=payload.INVOICE_FILE_URL,
            NOTES=payload.NOTES,
            CREATED_BY=payload.CREATED_BY,
            STATUS="ACTIVE",
        )
        db.add(batch)
        db.flush()

        record_movement(
            db, payload.VENDOR_ID, payload.PRODUCT_ID, "STOCK_IN", payload.QTY_RECEIVED,
            performed_by_id=payload.CREATED_BY,
            reference_type="MANUAL_BATCH", reference_id=batch.ID,
            batch_id=batch.ID, unit_cost=payload.UNIT_COST,
        )
        db.commit()
        db.refresh(batch)
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "create inventory batch")
    return {"message": "Batch created and stock updated", "ID": batch.ID}


@router.get("/expiring-soon", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def expiring_soon(
    vendor_id: int = Query(1),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Batches expiring within N days."""
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


@router.get("/{batch_id}", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def get_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = db.query(InventoryBatch).filter(InventoryBatch.ID == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return _serialize_batch(batch)


@router.put("/{batch_id}", dependencies=[Depends(require("inventory.purchase", "inventory.batches.update"))])
def update_batch(batch_id: str, payload: BatchUpdate, db: Session = Depends(get_db)):
    batch = db.query(InventoryBatch).filter(InventoryBatch.ID == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    for k, v in payload.dict(exclude_none=True).items():
        setattr(batch, k, v)
    db.commit()
    return {"message": "Batch updated"}
