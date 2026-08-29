"""Payment Milestone configuration — a common, vendor-level ordered list of
payment thresholds (e.g. "Initial Payment", "Middle Payment", "Final
Payment") shared across every Customer Lead Project for that vendor.
Replaces the old per-Project project_payment_milestone.py (routes
/project-payment-milestones, model ProjectPaymentMilestone) — same CRUD/
reorder shape, now scoped by VENDOR_ID instead of PROJECT_ID throughout.

REQUIRED_PAYMENT_PERCENTAGE is INCREMENTAL (see project_milestone_models.py's
module docstring) — the sum of all active milestones' REQUIRED_PAYMENT_
PERCENTAGE for a vendor must not exceed 100."""

from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.utils.db_error_handler import raise_db_error
from app.auth.auth_bearer import require
from app.models.models import Vendor, PaymentMilestone

router = APIRouter()


class MilestoneCreate(BaseModel):
    MILESTONE_NAME: str
    MILESTONE_ORDER: int
    PROJECT_COMPLETION_TRIGGER_PERCENTAGE: float = Field(ge=0, le=100)
    REQUIRED_PAYMENT_PERCENTAGE: float = Field(gt=0, le=100)
    DESCRIPTION: Optional[str] = None
    IS_ACTIVE: bool = True
    VENDOR_ID: int = 1


class MilestoneUpdate(BaseModel):
    MILESTONE_NAME: Optional[str] = None
    MILESTONE_ORDER: Optional[int] = None
    PROJECT_COMPLETION_TRIGGER_PERCENTAGE: Optional[float] = Field(default=None, ge=0, le=100)
    REQUIRED_PAYMENT_PERCENTAGE: Optional[float] = Field(default=None, gt=0, le=100)
    DESCRIPTION: Optional[str] = None
    IS_ACTIVE: Optional[bool] = None


class MilestoneReorderItem(BaseModel):
    id: str
    milestone_order: int


def _to_dict(m: PaymentMilestone) -> dict:
    return {
        "ID": m.ID,
        "VENDOR_ID": m.VENDOR_ID,
        "MILESTONE_NAME": m.MILESTONE_NAME,
        "MILESTONE_ORDER": m.MILESTONE_ORDER,
        "PROJECT_COMPLETION_TRIGGER_PERCENTAGE": float(m.PROJECT_COMPLETION_TRIGGER_PERCENTAGE) if m.PROJECT_COMPLETION_TRIGGER_PERCENTAGE is not None else None,
        "REQUIRED_PAYMENT_PERCENTAGE": float(m.REQUIRED_PAYMENT_PERCENTAGE) if m.REQUIRED_PAYMENT_PERCENTAGE is not None else None,
        "DESCRIPTION": m.DESCRIPTION,
        "IS_ACTIVE": m.IS_ACTIVE,
        "CREATED_AT": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
        "UPDATED_AT": m.UPDATED_AT.isoformat() if m.UPDATED_AT else None,
    }


def _validate_percentage_sum(db: Session, vendor_id: int, *, exclude_id: Optional[str], new_percentage: Decimal, is_active: bool):
    """Total REQUIRED_PAYMENT_PERCENTAGE across all ACTIVE milestones for
    this vendor (including the one being saved, at its new value/active
    state) must not exceed 100 — Requirement 6."""
    if not is_active:
        return  # an inactive milestone doesn't count toward the total
    q = db.query(PaymentMilestone).filter(
        PaymentMilestone.VENDOR_ID == vendor_id, PaymentMilestone.IS_ACTIVE == True,  # noqa: E712
    )
    if exclude_id:
        q = q.filter(PaymentMilestone.ID != exclude_id)
    existing_total = sum((Decimal(m.REQUIRED_PAYMENT_PERCENTAGE) for m in q.all()), Decimal("0"))
    total = existing_total + new_percentage
    if total > 100:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The combined Required Payment Percentage of all active milestones cannot exceed 100% "
                f"(would be {total:.2f}%)."
            ),
        )


def _validate_order_uniqueness(db: Session, vendor_id: int, order: int, *, exclude_id: Optional[str]):
    q = db.query(PaymentMilestone).filter(
        PaymentMilestone.VENDOR_ID == vendor_id, PaymentMilestone.MILESTONE_ORDER == order,
    )
    if exclude_id:
        q = q.filter(PaymentMilestone.ID != exclude_id)
    if q.first():
        raise HTTPException(status_code=400, detail="A milestone with this order already exists.")


def _validate_trigger_ordering(db: Session, vendor_id: int, *, exclude_id: Optional[str], order: int, trigger: Decimal, is_active: bool):
    """Trigger percentages must be non-decreasing as MILESTONE_ORDER
    increases across active milestones (Requirement 16) — a later-ordered
    milestone triggering before an earlier one is logically incoherent."""
    if not is_active:
        return
    q = db.query(PaymentMilestone).filter(
        PaymentMilestone.VENDOR_ID == vendor_id, PaymentMilestone.IS_ACTIVE == True,  # noqa: E712
    )
    if exclude_id:
        q = q.filter(PaymentMilestone.ID != exclude_id)
    others = q.all()
    for other in others:
        other_trigger = Decimal(other.PROJECT_COMPLETION_TRIGGER_PERCENTAGE)
        if other.MILESTONE_ORDER < order and other_trigger > trigger:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Project Completion Trigger must not decrease with milestone order — '
                    f'"{other.MILESTONE_NAME}" (order {other.MILESTONE_ORDER}) already triggers at '
                    f"{other_trigger:.2f}%, which is higher than this milestone's {trigger:.2f}%."
                ),
            )
        if other.MILESTONE_ORDER > order and other_trigger < trigger:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Project Completion Trigger must not decrease with milestone order — '
                    f'"{other.MILESTONE_NAME}" (order {other.MILESTONE_ORDER}) triggers at only '
                    f"{other_trigger:.2f}%, which is lower than this milestone's {trigger:.2f}%."
                ),
            )


@router.get("/payment-milestones", dependencies=[Depends(require("system.payment_milestones.view"))])
def list_payment_milestones(vendor_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    q = db.query(PaymentMilestone)
    if vendor_id is not None:
        q = q.filter(PaymentMilestone.VENDOR_ID == vendor_id)
    milestones = q.order_by(PaymentMilestone.MILESTONE_ORDER).all()
    return [_to_dict(m) for m in milestones]


@router.post("/payment-milestones", dependencies=[Depends(require("system.payment_milestones.create"))])
def create_payment_milestone(data: MilestoneCreate, db: Session = Depends(get_db)):
    vendor = db.query(Vendor).filter(Vendor.ID == data.VENDOR_ID).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    _validate_order_uniqueness(db, data.VENDOR_ID, data.MILESTONE_ORDER, exclude_id=None)
    _validate_percentage_sum(
        db, data.VENDOR_ID, exclude_id=None,
        new_percentage=Decimal(str(data.REQUIRED_PAYMENT_PERCENTAGE)), is_active=data.IS_ACTIVE,
    )
    _validate_trigger_ordering(
        db, data.VENDOR_ID, exclude_id=None, order=data.MILESTONE_ORDER,
        trigger=Decimal(str(data.PROJECT_COMPLETION_TRIGGER_PERCENTAGE)), is_active=data.IS_ACTIVE,
    )

    milestone = PaymentMilestone(
        VENDOR_ID=data.VENDOR_ID,
        MILESTONE_NAME=data.MILESTONE_NAME,
        MILESTONE_ORDER=data.MILESTONE_ORDER,
        PROJECT_COMPLETION_TRIGGER_PERCENTAGE=data.PROJECT_COMPLETION_TRIGGER_PERCENTAGE,
        REQUIRED_PAYMENT_PERCENTAGE=data.REQUIRED_PAYMENT_PERCENTAGE,
        DESCRIPTION=data.DESCRIPTION,
        IS_ACTIVE=data.IS_ACTIVE,
    )
    db.add(milestone)
    try:
        db.commit()
        db.refresh(milestone)
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "create payment milestone")
    return {"message": "Payment milestone created", "ID": milestone.ID}


@router.put("/payment-milestones/{milestone_id}", dependencies=[Depends(require("system.payment_milestones.update"))])
def update_payment_milestone(milestone_id: str, data: MilestoneUpdate, db: Session = Depends(get_db)):
    milestone = db.query(PaymentMilestone).filter(PaymentMilestone.ID == milestone_id).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Payment milestone not found")

    new_order = data.MILESTONE_ORDER if data.MILESTONE_ORDER is not None else milestone.MILESTONE_ORDER
    new_required = Decimal(str(data.REQUIRED_PAYMENT_PERCENTAGE)) if data.REQUIRED_PAYMENT_PERCENTAGE is not None else Decimal(milestone.REQUIRED_PAYMENT_PERCENTAGE)
    new_trigger = Decimal(str(data.PROJECT_COMPLETION_TRIGGER_PERCENTAGE)) if data.PROJECT_COMPLETION_TRIGGER_PERCENTAGE is not None else Decimal(milestone.PROJECT_COMPLETION_TRIGGER_PERCENTAGE)
    new_active = data.IS_ACTIVE if data.IS_ACTIVE is not None else milestone.IS_ACTIVE

    if data.MILESTONE_ORDER is not None and data.MILESTONE_ORDER != milestone.MILESTONE_ORDER:
        _validate_order_uniqueness(db, milestone.VENDOR_ID, new_order, exclude_id=milestone.ID)
    _validate_percentage_sum(db, milestone.VENDOR_ID, exclude_id=milestone.ID, new_percentage=new_required, is_active=new_active)
    _validate_trigger_ordering(db, milestone.VENDOR_ID, exclude_id=milestone.ID, order=new_order, trigger=new_trigger, is_active=new_active)

    if data.MILESTONE_NAME is not None:
        milestone.MILESTONE_NAME = data.MILESTONE_NAME
    if data.MILESTONE_ORDER is not None:
        milestone.MILESTONE_ORDER = data.MILESTONE_ORDER
    if data.PROJECT_COMPLETION_TRIGGER_PERCENTAGE is not None:
        milestone.PROJECT_COMPLETION_TRIGGER_PERCENTAGE = data.PROJECT_COMPLETION_TRIGGER_PERCENTAGE
    if data.REQUIRED_PAYMENT_PERCENTAGE is not None:
        milestone.REQUIRED_PAYMENT_PERCENTAGE = data.REQUIRED_PAYMENT_PERCENTAGE
    if data.DESCRIPTION is not None:
        milestone.DESCRIPTION = data.DESCRIPTION
    if data.IS_ACTIVE is not None:
        milestone.IS_ACTIVE = data.IS_ACTIVE

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "update payment milestone")
    return {"message": "Payment milestone updated"}


@router.delete("/payment-milestones/{milestone_id}", dependencies=[Depends(require("system.payment_milestones.delete"))])
def delete_payment_milestone(milestone_id: str, db: Session = Depends(get_db)):
    milestone = db.query(PaymentMilestone).filter(PaymentMilestone.ID == milestone_id).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Payment milestone not found")
    db.delete(milestone)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "delete payment milestone")
    return {"message": "Payment milestone deleted"}


@router.patch("/payment-milestones/reorder", dependencies=[Depends(require("system.payment_milestones.update"))])
def reorder_payment_milestones(items: List[MilestoneReorderItem], db: Session = Depends(get_db)):
    for item in items:
        milestone = db.query(PaymentMilestone).filter(PaymentMilestone.ID == item.id).first()
        if milestone:
            milestone.MILESTONE_ORDER = item.milestone_order
    db.commit()
    return {"message": "Payment milestones reordered"}
