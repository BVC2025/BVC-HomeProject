from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Vendor
from app.schemas.vendor_schema import VendorCreate
from app.auth.auth_bearer import get_current_root, get_current_admin

router = APIRouter()


# =========================
# CREATE VENDOR
# =========================
# Creating a new tenant/account is account-provisioning, not a normal
# admin action — gated Root-only. (True multi-tenant onboarding policy
# is a separate future decision; this is the safe default for now.)

@router.post("/create-vendor", dependencies=[Depends(get_current_root)])
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

@router.get("/vendors", dependencies=[Depends(get_current_admin)])
def get_vendors(
    db: Session = Depends(get_db)
):

    vendors = db.query(Vendor).all()

    return vendors