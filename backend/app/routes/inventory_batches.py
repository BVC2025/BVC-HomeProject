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

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.utils.db_error_handler import raise_db_error
from app.database.database import get_db
from app.models.inventory_models import InventoryBatch, ProductMaster
from app.models.supplier_models import Supplier, SupplierProduct
from app.models.employee_models import Employee
from app.schemas.inventory_item_schema import BatchUpdate
from app.services.inventory_automation_service import record_movement
from app.services.inventory_batch_file_service import (
    ALLOWED_BATCH_FILE_EXTENSIONS, MAX_BATCH_FILE_BYTES,
    mime_for_filename, save_batch_file, read_batch_file_bytes,
)
from app.utils.datetime_utils import now_ist
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
        "SUPPLIER_ID": b.SUPPLIER_ID,
        "PO_ID": b.PO_ID,
        "GRN_ID": b.GRN_ID,
        "RECEIVED_DATE": b.RECEIVED_DATE.isoformat() if b.RECEIVED_DATE else None,
        "MANUFACTURING_DATE": b.MANUFACTURING_DATE.isoformat() if b.MANUFACTURING_DATE else None,
        "EXPIRY_DATE": b.EXPIRY_DATE.isoformat() if b.EXPIRY_DATE else None,
        "IS_NO_EXPIRY": b.IS_NO_EXPIRY,
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


def _generate_batch_number(db: Session, vendor_id: int, product_id: str, product_code: str) -> str:
    """PRODUCT_CODE-YYYYMMDD-HHMMSS-N — N is the count of existing batches
    for this product so far, plus one (never resets by day). Called only
    after the caller has already locked the ProductMaster row via
    with_for_update(), which serializes concurrent batch creations for the
    same product and makes this count-then-use safe from a duplicate-
    number race (the table's own UniqueConstraint is still a last-resort
    backstop — see create_batch's IntegrityError handling)."""
    count = db.query(func.count(InventoryBatch.ID)).filter(
        InventoryBatch.VENDOR_ID == vendor_id,
        InventoryBatch.PRODUCT_ID == product_id,
    ).scalar() or 0
    now = now_ist()
    return f"{product_code.strip()}-{now.strftime('%Y%m%d')}-{now.strftime('%H%M%S')}-{count + 1}"


@router.get("", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def list_batches(
    vendor_id: int = Query(1),
    product_id: Optional[str] = Query(None),
    supplier_id: Optional[int] = Query(None),
    category_id: Optional[str] = Query(None),
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
    if category_id:
        # InventoryBatch has no CATEGORY_ID of its own — filter through
        # the same ProductMaster relationship every other category
        # lookup in this codebase uses, rather than duplicating category
        # data onto the batch row.
        q = q.join(ProductMaster, ProductMaster.ID == InventoryBatch.PRODUCT_ID).filter(
            ProductMaster.CATEGORY_ID == category_id
        )
    if status:
        q = q.filter(InventoryBatch.STATUS == status.upper())
    total = q.count()
    rows = q.order_by(InventoryBatch.CREATED_AT.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_serialize_batch(r) for r in rows],
    }


@router.post("", dependencies=[Depends(require("inventory.purchase", "inventory.batches.create"))])
async def create_batch(
    vendor_id: int = Form(1),
    product_id: str = Form(...),
    supplier_id: Optional[str] = Form(None),
    received_date: Optional[str] = Form(None),
    manufacturing_date: Optional[str] = Form(None),
    expiry_date: Optional[str] = Form(None),
    is_no_expiry: bool = Form(False),
    qty_received: str = Form(...),
    unit_cost: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    created_by: Optional[str] = Form(None),
    dc_file: Optional[UploadFile] = File(None),
    invoice_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Manual batch receipt. Requires at least one of Invoice / Delivery
    Challan file uploads — a batch cannot be created with neither document
    on file. Batch Number is generated server-side, never client-supplied.
    Atomically increments InventoryStock and records an InventoryMovement
    (STOCK_IN, REFERENCE_TYPE="MANUAL_BATCH")."""
    if dc_file is None and invoice_file is None:
        raise HTTPException(
            status_code=400,
            detail="An Invoice or Delivery Challan file is required to create a batch.",
        )

    async def _read_upload(upload: Optional[UploadFile], label: str):
        if upload is None or not upload.filename:
            return None, None
        ext = ("." + upload.filename.rsplit(".", 1)[-1].lower()) if "." in upload.filename else ""
        if ext not in ALLOWED_BATCH_FILE_EXTENSIONS:
            raise HTTPException(status_code=400, detail=f"Unsupported {label} file type. Accepted: PDF, image, or Word document.")
        content = await upload.read()
        if content and len(content) > MAX_BATCH_FILE_BYTES:
            raise HTTPException(status_code=400, detail=f"{label} file is too large — the maximum size is 15 MB.")
        return upload.filename, content

    dc_filename, dc_content = await _read_upload(dc_file, "Delivery Challan")
    invoice_filename, invoice_content = await _read_upload(invoice_file, "Invoice")

    try:
        qty_received_f = float(qty_received)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid QTY_RECEIVED")
    if qty_received_f <= 0:
        raise HTTPException(status_code=400, detail="QTY_RECEIVED must be greater than zero")

    unit_cost_f = None
    if unit_cost not in (None, ""):
        try:
            unit_cost_f = float(unit_cost)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid UNIT_COST")

    supplier_id_i = None
    if supplier_id not in (None, ""):
        try:
            supplier_id_i = int(supplier_id)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid SUPPLIER_ID")

    received_date_v = _parse_date(received_date, "RECEIVED_DATE") or date.today()
    mfg_date = _parse_date(manufacturing_date, "MANUFACTURING_DATE")
    # No-expiry always wins over a stray expiry_date value — a batch is
    # never left with IS_NO_EXPIRY=True alongside a stale/sentinel date.
    exp_date = None if is_no_expiry else _parse_date(expiry_date, "EXPIRY_DATE")

    # Row-locked for the duration of this transaction — serializes
    # concurrent batch creations for the same product so the count-based
    # batch-number sequence below can never collide (see
    # _generate_batch_number's docstring).
    product = (
        db.query(ProductMaster)
        .filter(ProductMaster.ID == product_id, ProductMaster.VENDOR_ID == vendor_id)
        .with_for_update()
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    batch_number = _generate_batch_number(db, vendor_id, product_id, product.PRODUCT_CODE)

    try:
        batch = InventoryBatch(
            VENDOR_ID=vendor_id,
            PRODUCT_ID=product_id,
            BATCH_NUMBER=batch_number,
            SUPPLIER_ID=supplier_id_i,
            RECEIVED_DATE=received_date_v,
            MANUFACTURING_DATE=mfg_date,
            EXPIRY_DATE=exp_date,
            IS_NO_EXPIRY=is_no_expiry,
            QTY_RECEIVED=qty_received_f,
            QTY_REMAINING=qty_received_f,
            UNIT_COST=unit_cost_f,
            NOTES=notes,
            CREATED_BY=created_by,
            STATUS="ACTIVE",
        )
        db.add(batch)
        db.flush()

        if dc_content is not None:
            batch.DC_FILE_URL = save_batch_file(batch.ID, "dc", dc_filename, dc_content)
        if invoice_content is not None:
            batch.INVOICE_FILE_URL = save_batch_file(batch.ID, "invoice", invoice_filename, invoice_content)

        record_movement(
            db, vendor_id, product_id, "STOCK_IN", qty_received_f,
            performed_by_id=created_by,
            reference_type="MANUAL_BATCH", reference_id=batch.ID,
            batch_id=batch.ID, unit_cost=unit_cost_f,
        )
        db.commit()
        db.refresh(batch)
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "create inventory batch")
    return {"message": "Batch created and stock updated", "ID": batch.ID, "BATCH_NUMBER": batch.BATCH_NUMBER}


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


@router.get("/products/{product_id}/suppliers", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def get_product_suppliers_for_batch(product_id: str, vendor_id: int = Query(1), db: Session = Depends(get_db)):
    """Active suppliers for a product, ordered preferred-first then
    cheapest — powers the Add/Edit Batch modal's Supplier auto-suggest.
    Deliberately separate from GET /api/products/{id}/suppliers (gated on
    a different permission family, supplier.manage/supplier.products.view,
    that a user who can create batches isn't guaranteed to hold) — same
    ordering as routes/inventory.py's _resolve_preferred_supplier."""
    rows = (
        db.query(SupplierProduct, Supplier)
        .join(Supplier, Supplier.ID == SupplierProduct.SUPPLIER_ID)
        .filter(
            SupplierProduct.VENDOR_ID == vendor_id,
            SupplierProduct.PRODUCT_ID == product_id,
            SupplierProduct.STATUS == "ACTIVE",
        )
        .order_by(SupplierProduct.IS_PREFERRED.desc(), SupplierProduct.UNIT_PRICE.asc())
        .all()
    )
    return [
        {
            "SUPPLIER_ID": supplier.ID,
            "COMPANY_NAME": supplier.COMPANY_NAME,
            "SUPPLIER_CODE": supplier.SUPPLIER_CODE,
            "UNIT_PRICE": float(sp.UNIT_PRICE),
            "IS_PREFERRED": sp.IS_PREFERRED,
        }
        for sp, supplier in rows
    ]


@router.get("/suppliers", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def get_all_suppliers_for_batch(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    """Every active supplier for the vendor — the Add/Edit Batch modal's
    fallback list when a product has no supplier-product link yet (D4's
    'or show all suppliers if none assigned'). Same permission family as
    the product-scoped lookup above, for the same reason."""
    rows = (
        db.query(Supplier)
        .filter(Supplier.VENDOR_ID == vendor_id, Supplier.STATUS == "ACTIVE")
        .order_by(Supplier.COMPANY_NAME)
        .all()
    )
    return [
        {"SUPPLIER_ID": s.ID, "COMPANY_NAME": s.COMPANY_NAME, "SUPPLIER_CODE": s.SUPPLIER_CODE}
        for s in rows
    ]


@router.get("/{batch_id}/details", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def get_batch_details(batch_id: str, db: Session = Depends(get_db)):
    """Enriched single-batch payload for the Batch Details modal — category
    name, supplier details, creator name/code. Kept separate from
    _serialize_batch()/list_batches (which returns up to 5000 rows) so
    these extra joins only ever run for a single-row fetch."""
    batch = db.query(InventoryBatch).filter(InventoryBatch.ID == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    product = batch.product
    category = product.category if product else None
    supplier = db.query(Supplier).filter(Supplier.ID == batch.SUPPLIER_ID).first() if batch.SUPPLIER_ID else None
    creator = db.query(Employee).filter(Employee.ID == batch.CREATED_BY).first() if batch.CREATED_BY else None

    data = _serialize_batch(batch)
    data.update({
        "CATEGORY_ID": product.CATEGORY_ID if product else None,
        "CATEGORY_NAME": category.NAME if category else None,
        "UNIT": product.UNIT if product else None,
        "SUPPLIER_COMPANY_NAME": supplier.COMPANY_NAME if supplier else None,
        "SUPPLIER_CODE": supplier.SUPPLIER_CODE if supplier else None,
        "SUPPLIER_CONTACT_PERSON": supplier.CONTACT_PERSON if supplier else None,
        "SUPPLIER_PHONE": supplier.PHONE if supplier else None,
        "SUPPLIER_EMAIL": supplier.EMAIL if supplier else None,
        "CREATED_BY_NAME": creator.NAME if creator else None,
        "CREATED_BY_CODE": creator.EMPLOYEE_CODE if creator else None,
    })
    return data


@router.get("/{batch_id}/file/{kind}", dependencies=[Depends(require("inventory.view", "inventory.batches.view"))])
def view_batch_file(batch_id: str, kind: str, db: Session = Depends(get_db)):
    """Authenticated DC/Invoice file-serving proxy (kind = 'dc' | 'invoice')
    — mirrors GET /customer-payments/{id}/proof's pattern of streaming
    bytes back rather than exposing the raw static path."""
    if kind not in ("dc", "invoice"):
        raise HTTPException(status_code=404, detail="Unknown file kind")
    batch = db.query(InventoryBatch).filter(InventoryBatch.ID == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    file_url = batch.DC_FILE_URL if kind == "dc" else batch.INVOICE_FILE_URL
    if not file_url:
        raise HTTPException(status_code=404, detail="No file on file for this batch.")
    content = read_batch_file_bytes(file_url)
    if content is None:
        raise HTTPException(status_code=404, detail="File could not be found on disk.")
    filename = file_url.rsplit("/", 1)[-1]
    return Response(
        content=content,
        media_type=mime_for_filename(filename),
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


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

    # EXPIRY_DATE/IS_NO_EXPIRY are special-cased — kept mutually
    # consistent (never a stale date sitting alongside IS_NO_EXPIRY=True)
    # rather than run through the generic setattr loop below, which would
    # otherwise try to assign a raw ISO string straight onto a Date
    # column. exclude_unset (not exclude_none) here just detects whether
    # the client sent these two keys at all — every other field below is
    # untouched, still using the existing exclude_none-based handling.
    provided = payload.dict(exclude_unset=True)
    if "IS_NO_EXPIRY" in provided or "EXPIRY_DATE" in provided:
        no_expiry = provided.get("IS_NO_EXPIRY", batch.IS_NO_EXPIRY)
        if no_expiry:
            batch.IS_NO_EXPIRY = True
            batch.EXPIRY_DATE = None
        else:
            batch.IS_NO_EXPIRY = False
            if "EXPIRY_DATE" in provided:
                batch.EXPIRY_DATE = _parse_date(provided["EXPIRY_DATE"], "EXPIRY_DATE")

    for k, v in payload.dict(exclude_none=True).items():
        if k in ("IS_NO_EXPIRY", "EXPIRY_DATE"):
            continue
        setattr(batch, k, v)
    db.commit()
    return {"message": "Batch updated"}
