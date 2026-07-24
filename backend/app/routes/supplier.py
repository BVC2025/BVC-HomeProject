"""
Supplier master endpoints.

Models the companies BVC24 buys from. Mirrors the Employee
master pattern: full CRUD with code lookup, status filtering,
and category-based grouping for the purchase workflow.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database.database import get_db

from app.models.models import Supplier, Vendor, BOMItem

from app.schemas.supplier_schema import (
    SupplierCreate,
    SupplierUpdate
)


router = APIRouter(prefix="/suppliers", tags=["Suppliers"])


def _resolve_vendor_id(db: Session, requested: Optional[int]) -> int:

    if requested:

        has_data = (
            db.query(Supplier)
            .filter(Supplier.VENDOR_ID == requested)
            .first()
            is not None
        )

        if has_data:

            return requested

    bvc = db.query(Vendor).filter(
        Vendor.VENDOR_NAME == "Bharath Vending Corporation"
    ).first()

    if bvc:

        return bvc.ID

    any_v = db.query(Vendor).first()

    return any_v.ID if any_v else (requested or 1)


def _serialize_supplier(s: Supplier) -> dict:

    return {
        "ID": s.ID,
        "SUPPLIER_CODE": s.SUPPLIER_CODE,
        "COMPANY_NAME": s.COMPANY_NAME,
        "CONTACT_PERSON": s.CONTACT_PERSON,
        "PHONE": s.PHONE,
        "EMAIL": s.EMAIL,
        "ADDRESS_LINE1": s.ADDRESS_LINE1,
        "ADDRESS_LINE2": s.ADDRESS_LINE2,
        "CITY": s.CITY,
        "STATE": s.STATE,
        "PINCODE": s.PINCODE,
        "GST_NUMBER": s.GST_NUMBER,
        "PAN_NUMBER": s.PAN_NUMBER,
        "BANK_NAME": s.BANK_NAME,
        "ACCOUNT_NUMBER": s.ACCOUNT_NUMBER,
        "IFSC_CODE": s.IFSC_CODE,
        "CATEGORY": s.CATEGORY,
        "PAYMENT_TERMS": s.PAYMENT_TERMS,
        "STATUS": s.STATUS,
        "NOTES": s.NOTES,
        "VENDOR_ID": s.VENDOR_ID,
        "CREATED_AT": (
            s.CREATED_AT.isoformat() if s.CREATED_AT else None
        )
    }


@router.post("")
def create_supplier(
    data: SupplierCreate,
    db: Session = Depends(get_db)
):

    clash = db.query(Supplier).filter(
        Supplier.VENDOR_ID == data.VENDOR_ID,
        Supplier.SUPPLIER_CODE == data.SUPPLIER_CODE
    ).first()

    if clash:

        raise HTTPException(
            status_code=409,
            detail=(
                f"SUPPLIER_CODE {data.SUPPLIER_CODE} already "
                f"exists for this vendor."
            )
        )

    supplier = Supplier(**data.dict())

    db.add(supplier)

    db.commit()

    db.refresh(supplier)

    return {
        "message": "Supplier created",
        "supplier": _serialize_supplier(supplier)
    }


@router.get("")
def list_suppliers(
    vendor_id: int = 1,
    status: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    q = db.query(Supplier).filter(Supplier.VENDOR_ID == vendor_id)

    if status:

        q = q.filter(Supplier.STATUS == status)

    if category:

        q = q.filter(Supplier.CATEGORY == category)

    if search:

        pattern = f"%{search.strip()}%"

        q = q.filter(
            or_(
                Supplier.COMPANY_NAME.ilike(pattern),
                Supplier.SUPPLIER_CODE.ilike(pattern),
                Supplier.CONTACT_PERSON.ilike(pattern),
                Supplier.GST_NUMBER.ilike(pattern)
            )
        )

    rows = q.order_by(Supplier.COMPANY_NAME).all()

    return [_serialize_supplier(s) for s in rows]


@router.get("/categories")
def supplier_categories(
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):
    """Distinct categories in use — useful for the purchase
    dropdown to filter suppliers by what they sell."""

    vendor_id = _resolve_vendor_id(db, vendor_id)

    rows = (
        db.query(Supplier.CATEGORY)
        .filter(
            Supplier.VENDOR_ID == vendor_id,
            Supplier.CATEGORY.isnot(None)
        )
        .distinct()
        .all()
    )

    return sorted([r[0] for r in rows if r[0]])


@router.get("/{supplier_id}")
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db)
):

    supplier = db.query(Supplier).filter(
        Supplier.ID == supplier_id
    ).first()

    if not supplier:

        raise HTTPException(status_code=404, detail="Supplier not found")

    # Also surface which BOM items use this supplier — handy for
    # the supplier detail view
    using_bom_count = db.query(BOMItem).filter(
        BOMItem.PREFERRED_SUPPLIER_ID == supplier_id
    ).count()

    return {
        "supplier": _serialize_supplier(supplier),
        "bom_items_linked": using_bom_count
    }


@router.patch("/{supplier_id}")
def update_supplier(
    supplier_id: int,
    data: SupplierUpdate,
    db: Session = Depends(get_db)
):

    supplier = db.query(Supplier).filter(
        Supplier.ID == supplier_id
    ).first()

    if not supplier:

        raise HTTPException(status_code=404, detail="Supplier not found")

    for field, value in data.dict(exclude_unset=True).items():

        setattr(supplier, field, value)

    db.commit()

    db.refresh(supplier)

    return {
        "message": "Supplier updated",
        "supplier": _serialize_supplier(supplier)
    }


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db)
):
    """Soft delete — set STATUS to INACTIVE so existing BOM
    links keep resolving."""

    supplier = db.query(Supplier).filter(
        Supplier.ID == supplier_id
    ).first()

    if not supplier:

        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier.STATUS = "INACTIVE"

    db.commit()

    return {"message": "Supplier deactivated"}
