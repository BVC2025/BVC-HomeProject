from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Vendor
from app.schemas.vendor_schema import VendorCreate
from app.auth.auth_bearer import require

router = APIRouter()

# RBAC sweep: Vendor is the tenant itself — creating/listing tenants is
# platform-level, not a normal admin action. vendor.manage is deliberately
# not granted to any operational role (see seed_permissions.py), so only
# the existing top-tier ALL-wildcard roles can call this.
_VENDOR_MANAGE_DEP = Depends(require("vendor.manage"))


# =========================
# CREATE VENDOR
# =========================

@router.post("/create-vendor", dependencies=[_VENDOR_MANAGE_DEP])
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

@router.get("/vendors", dependencies=[_VENDOR_MANAGE_DEP])
def get_vendors(
    db: Session = Depends(get_db)
):

    vendors = db.query(Vendor).all()

    return vendors