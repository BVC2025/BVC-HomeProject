from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Vendor
from app.schemas.vendor_schema import VendorCreate

router = APIRouter()


# =========================
# CREATE VENDOR
# =========================

@router.post("/create-vendor")
def create_vendor(
    data: VendorCreate,
    db: Session = Depends(get_db)
):

    try:

        new_vendor = Vendor(
            VENDOR_NAME=data.VENDOR_NAME
        )

        db.add(new_vendor)

        db.commit()

        db.refresh(new_vendor)

        return {
            "message": "Vendor created successfully",
            "vendor_id": new_vendor.ID
        }

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=str(e)
        )


# =========================
# GET ALL VENDORS
# =========================

@router.get("/vendors")
def get_vendors(
    db: Session = Depends(get_db)
):

    vendors = db.query(Vendor).all()

    return vendors