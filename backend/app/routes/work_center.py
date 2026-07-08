"""
Work Center — master list of shop-floor capabilities used by Routing.

A Work Center groups one or more Machines that perform the same kind
of operation (e.g. "Welding" → 3 welding bays). Routing then assigns
each manufacturing step to a Work Center, not to a specific machine,
so the scheduler can pick whichever bay is free.

Endpoints
---------
  GET    /work-centers              List (optional ?active_only=1)
  POST   /work-centers              Create
  GET    /work-centers/{id}         Single
  PATCH  /work-centers/{id}         Update
  DELETE /work-centers/{id}         Soft-deactivate (IS_ACTIVE=0)
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.auth.auth_bearer import get_current_admin
from app.models.models import WorkCenter


router = APIRouter(prefix="/work-centers", tags=["Work Centers"])


# ---------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------

ALLOWED_CATEGORIES = {
    "FABRICATION", "WELDING", "PAINTING", "ASSEMBLY",
    "TESTING", "PACKAGING", "QC", "OTHER",
}


class WorkCenterCreate(BaseModel):
    NAME:              str   = Field(..., min_length=1, max_length=100)
    CODE:              Optional[str] = Field(None, max_length=20)
    CATEGORY:          str   = Field("ASSEMBLY")
    CAPACITY_PER_HOUR: float = 1.0
    HOURLY_COST:       float = 0.0
    LOCATION:          Optional[str] = None
    NOTES:             Optional[str] = None
    IS_ACTIVE:         bool  = True
    VENDOR_ID:         int   = 1


class WorkCenterUpdate(BaseModel):
    NAME:              Optional[str]   = None
    CODE:              Optional[str]   = None
    CATEGORY:          Optional[str]   = None
    CAPACITY_PER_HOUR: Optional[float] = None
    HOURLY_COST:       Optional[float] = None
    LOCATION:          Optional[str]   = None
    NOTES:             Optional[str]   = None
    IS_ACTIVE:         Optional[bool]  = None


def _serialize(w: WorkCenter) -> dict:
    return {
        "ID":                w.ID,
        "NAME":              w.NAME,
        "CODE":              w.CODE,
        "CATEGORY":          w.CATEGORY,
        "CAPACITY_PER_HOUR": w.CAPACITY_PER_HOUR,
        "HOURLY_COST":       w.HOURLY_COST,
        "LOCATION":          w.LOCATION,
        "NOTES":             w.NOTES,
        "IS_ACTIVE":         bool(w.IS_ACTIVE),
        "VENDOR_ID":         w.VENDOR_ID,
        "CREATED_AT":        w.CREATED_AT.isoformat() if w.CREATED_AT else None,
    }


def _validate_category(cat: str) -> None:
    if cat and cat.upper() not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"CATEGORY must be one of {sorted(ALLOWED_CATEGORIES)}",
        )


# ---------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------

@router.get("")
def list_work_centers(
    active_only: bool = Query(False),
    vendor_id:   int  = 1,
    db: Session = Depends(get_db),
):
    """List work centers. By default returns both active and inactive
    so the admin page can show a strikethrough on retired ones."""

    q = db.query(WorkCenter).filter(WorkCenter.VENDOR_ID == vendor_id)

    if active_only:
        q = q.filter(WorkCenter.IS_ACTIVE == 1)

    rows = q.order_by(WorkCenter.CATEGORY, WorkCenter.NAME).all()

    return [_serialize(w) for w in rows]


@router.post("", dependencies=[Depends(get_current_admin)])
def create_work_center(
    data: WorkCenterCreate,
    db:   Session = Depends(get_db),
):
    """Create one work center. (VENDOR_ID, NAME) must be unique."""

    _validate_category(data.CATEGORY)

    exists = (
        db.query(WorkCenter)
          .filter(
              WorkCenter.VENDOR_ID == data.VENDOR_ID,
              WorkCenter.NAME == data.NAME.strip(),
          )
          .first()
    )

    if exists:
        raise HTTPException(
            status_code=409,
            detail=f"Work center '{data.NAME}' already exists.",
        )

    w = WorkCenter(
        NAME=data.NAME.strip()[:100],
        CODE=(data.CODE or "").strip()[:20] or None,
        CATEGORY=data.CATEGORY.upper(),
        CAPACITY_PER_HOUR=max(0.0, data.CAPACITY_PER_HOUR),
        HOURLY_COST=max(0.0, data.HOURLY_COST),
        LOCATION=(data.LOCATION or "").strip()[:200] or None,
        NOTES=(data.NOTES or "").strip()[:500] or None,
        IS_ACTIVE=1 if data.IS_ACTIVE else 0,
        VENDOR_ID=data.VENDOR_ID,
    )

    db.add(w)
    db.commit()
    db.refresh(w)

    return {"message": "Work center created", "work_center": _serialize(w)}


@router.get("/{wc_id}")
def get_work_center(wc_id: int, db: Session = Depends(get_db)):

    w = db.query(WorkCenter).filter(WorkCenter.ID == wc_id).first()

    if not w:
        raise HTTPException(404, "Work center not found")

    return _serialize(w)


@router.patch("/{wc_id}", dependencies=[Depends(get_current_admin)])
def update_work_center(
    wc_id: int,
    data:  WorkCenterUpdate,
    db:    Session = Depends(get_db),
):

    w = db.query(WorkCenter).filter(WorkCenter.ID == wc_id).first()

    if not w:
        raise HTTPException(404, "Work center not found")

    payload = data.model_dump(exclude_unset=True)

    if "CATEGORY" in payload and payload["CATEGORY"]:
        _validate_category(payload["CATEGORY"])
        payload["CATEGORY"] = payload["CATEGORY"].upper()

    if "IS_ACTIVE" in payload:
        payload["IS_ACTIVE"] = 1 if payload["IS_ACTIVE"] else 0

    for k, v in payload.items():
        setattr(w, k, v)

    db.commit()

    return {"message": "Work center updated", "work_center": _serialize(w)}


@router.delete("/{wc_id}", dependencies=[Depends(get_current_admin)])
def deactivate_work_center(wc_id: int, db: Session = Depends(get_db)):
    """Soft delete — sets IS_ACTIVE=0. The row stays so historical
    Routing assignments to this work center remain interpretable."""

    w = db.query(WorkCenter).filter(WorkCenter.ID == wc_id).first()

    if not w:
        raise HTTPException(404, "Work center not found")

    w.IS_ACTIVE = 0
    db.commit()

    return {"message": "Work center deactivated"}
