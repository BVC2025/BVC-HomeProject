"""Admin Module 4 — Approval Center.

Single endpoint that returns every pending item across 4 buckets
(Leaves, Permissions, Purchase Orders, Supplier Payments) plus a
unified approve/reject dispatcher.

Wire-up:

  GET    /admin/approvals/pending
  POST   /admin/approvals/{kind}/{id}/approve
  POST   /admin/approvals/{kind}/{id}/reject
  POST   /admin/approvals/supplier-payments        — create

`kind` ∈ {leave, permission, purchase_order, supplier_payment}
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.auth.auth_bearer import get_current_admin, get_current_user

from app.models.models import (
    LeaveRequest,
    PurchaseOrder,
    SupplierPayment,
    Employee,
    Customer,
    Supplier,
)


router = APIRouter(prefix="/admin/approvals", tags=["Approval Center"])


# ---- Serializers ---------------------------------------------------

def _emp(db: Session, emp_id: str):

    if not emp_id:

        return None

    e = db.query(Employee).filter(Employee.ID == emp_id).first()

    return {"ID": e.ID, "NAME": e.NAME, "CODE": e.EMPLOYEE_CODE} if e else None


def _serialize_leave(db: Session, lr: LeaveRequest, kind: str):

    emp = _emp(db, lr.EMPLOYEE_ID)

    return {
        "kind":         kind,
        "id":           lr.ID,
        "title":        (
            f"{(emp or {}).get('NAME','Unknown')} — "
            f"{lr.LEAVE_TYPE}"
            + (f" / {lr.PERMISSION_SUBTYPE}" if (lr.PERMISSION_SUBTYPE) else "")
        ),
        "subtitle":     (
            f"{lr.START_DATE.isoformat() if lr.START_DATE else '?'} "
            + (
                f"→ {lr.END_DATE.isoformat()}"
                if lr.END_DATE and lr.END_DATE != lr.START_DATE
                else ""
            )
            + (
                f" · {lr.DURATION_HOURS:g} hr(s)"
                if (lr.DURATION_HOURS or 0) > 0
                else f" · {lr.DAYS or 0:g} day(s)"
            )
        ),
        "reason":       lr.REASON or "",
        "amount":       None,
        "requested_at": lr.CREATED_AT.isoformat() if lr.CREATED_AT else None,
        "actor":        emp,
        "leave_type":   lr.LEAVE_TYPE,
        "subtype":      lr.PERMISSION_SUBTYPE,
        "status":       lr.STATUS,
    }


def _serialize_po(db: Session, po: PurchaseOrder):

    sup = (
        db.query(Supplier).filter(Supplier.ID == po.SUPPLIER_ID).first()
        if po.SUPPLIER_ID else None
    )

    return {
        "kind":         "purchase_order",
        "id":           po.ID,
        "title":        po.PO_NUMBER or f"PO #{po.ID}",
        "subtitle":     (sup.COMPANY_NAME if sup else "—"),
        "reason":       "",
        "amount":       float(po.GRAND_TOTAL or 0.0),
        "requested_at": (
            po.CREATED_AT.isoformat()
            if getattr(po, "CREATED_AT", None) else None
        ),
        "actor":        None,
        "status":       po.STATUS,
    }


def _serialize_sup_pay(db: Session, sp: SupplierPayment):

    po = (
        db.query(PurchaseOrder).filter(PurchaseOrder.ID == sp.PO_ID).first()
        if sp.PO_ID else None
    )

    sup_name = None

    if po and po.SUPPLIER_ID:

        s = db.query(Supplier).filter(Supplier.ID == po.SUPPLIER_ID).first()

        sup_name = s.SUPPLIER_NAME if s else None

    return {
        "kind":         "supplier_payment",
        "id":           sp.ID,
        "title":        (
            f"{sup_name or 'Supplier'} — "
            f"INR {(sp.AMOUNT or 0):,.2f}"
        ),
        "subtitle":     (
            f"PO {po.PO_NUMBER if po else f'#{sp.PO_ID}'} "
            f"· {sp.PAYMENT_MODE or '—'}"
            f" · Ref {sp.REFERENCE_NO or '—'}"
        ),
        "reason":       sp.NOTES or "",
        "amount":       float(sp.AMOUNT or 0.0),
        "requested_at": sp.CREATED_AT.isoformat() if sp.CREATED_AT else None,
        "actor":        _emp(db, sp.REQUESTED_BY_ID),
        "status":       sp.STATUS,
    }


# ---- Pending feed --------------------------------------------------

@router.get("/pending", dependencies=[Depends(get_current_admin)])
def list_pending_approvals(db: Session = Depends(get_db)):
    """Returns all 4 buckets in one call. Each bucket is an array of
    items shaped uniformly so the frontend can render one card per
    item without bucket-specific code paths."""

    # 1. Leave Requests (excluding PERMISSION)
    leaves = db.query(LeaveRequest).filter(
        LeaveRequest.STATUS == "PENDING_APPROVAL",
        LeaveRequest.LEAVE_TYPE != "PERMISSION"
    ).order_by(LeaveRequest.CREATED_AT.desc()).all()

    leave_items = [_serialize_leave(db, lr, "leave") for lr in leaves]

    # 2. Permission Requests
    perms = db.query(LeaveRequest).filter(
        LeaveRequest.STATUS == "PENDING_APPROVAL",
        LeaveRequest.LEAVE_TYPE == "PERMISSION"
    ).order_by(LeaveRequest.CREATED_AT.desc()).all()

    perm_items = [_serialize_leave(db, lr, "permission") for lr in perms]

    # 3. Purchase Orders — DRAFTs are pending review before being sent
    pos = db.query(PurchaseOrder).filter(
        PurchaseOrder.STATUS == "DRAFT"
    ).order_by(PurchaseOrder.ID.desc()).all()

    po_items = [_serialize_po(db, po) for po in pos]

    # 5. Supplier Payments
    sps = db.query(SupplierPayment).filter(
        SupplierPayment.STATUS == "PENDING_APPROVAL"
    ).order_by(SupplierPayment.CREATED_AT.desc()).all()

    sp_items = [_serialize_sup_pay(db, sp) for sp in sps]

    buckets = {
        "leaves":             leave_items,
        "permissions":        perm_items,
        "purchase_orders":    po_items,
        "supplier_payments":  sp_items,
    }

    total = sum(len(v) for v in buckets.values())

    return {
        "total_pending": total,
        "as_of":         datetime.utcnow().isoformat(),
        "buckets":       buckets,
    }


# ---- Approve / Reject dispatcher -----------------------------------

class RejectBody(BaseModel):

    REJECTION_REASON: Optional[str] = None


class ApproveBody(BaseModel):

    NOTES: Optional[str] = None


@router.post("/{kind}/{item_id}/approve", dependencies=[Depends(get_current_admin)])
def approve_item(
    kind: str,
    item_id: int,
    body: Optional[ApproveBody] = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_current_admin),
):

    admin_id = admin.get("employee_id")

    now = datetime.utcnow()

    # 1. Leave / Permission — delegate to leave service
    if kind in ("leave", "permission"):

        lr = db.query(LeaveRequest).filter(LeaveRequest.ID == item_id).first()

        if not lr:

            raise HTTPException(status_code=404, detail="Leave request not found")

        if lr.STATUS != "PENDING_APPROVAL":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve — current status is {lr.STATUS}"
            )

        from app.services.leave_service import deduct_balance

        lr.STATUS = "APPROVED"

        lr.APPROVAL_RESOLVED_AT = now

        # Deduct balance for day-based leaves only
        if lr.LEAVE_TYPE in ("CASUAL", "SICK", "EARNED", "MATERNITY"):

            deduct_balance(db, lr.EMPLOYEE_ID, lr.LEAVE_TYPE, lr.DAYS or 0)

        db.commit()

        return {"message": f"{kind.title()} approved.", "id": lr.ID}

    # 2. Purchase Order — approve = SENT
    if kind == "purchase_order":

        po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == item_id).first()

        if not po:

            raise HTTPException(status_code=404, detail="PO not found")

        if po.STATUS != "DRAFT":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve — current status is {po.STATUS}"
            )

        po.STATUS = "SENT"

        if hasattr(po, "APPROVED_AT"):

            po.APPROVED_AT = now

        db.commit()

        return {"message": "Purchase Order approved & sent.", "id": po.ID}

    # 3. Supplier Payment
    if kind == "supplier_payment":

        sp = db.query(SupplierPayment).filter(SupplierPayment.ID == item_id).first()

        if not sp:

            raise HTTPException(status_code=404, detail="Supplier payment not found")

        if sp.STATUS != "PENDING_APPROVAL":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve — current status is {sp.STATUS}"
            )

        sp.STATUS         = "APPROVED"
        sp.APPROVED_AT    = now
        sp.APPROVED_BY_ID = admin_id

        db.commit()

        return {"message": "Supplier payment approved.", "id": sp.ID}

    raise HTTPException(status_code=400, detail=f"Unknown approval kind: {kind}")


@router.post("/{kind}/{item_id}/reject", dependencies=[Depends(get_current_admin)])
def reject_item(
    kind: str,
    item_id: int,
    body: RejectBody,
    db: Session = Depends(get_db),
    admin: dict = Depends(get_current_admin),
):

    admin_id = admin.get("employee_id")

    now = datetime.utcnow()

    reason = (body.REJECTION_REASON or "").strip() or None

    if kind in ("leave", "permission"):

        lr = db.query(LeaveRequest).filter(LeaveRequest.ID == item_id).first()

        if not lr:

            raise HTTPException(status_code=404, detail="Leave request not found")

        if lr.STATUS != "PENDING_APPROVAL":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot reject — current status is {lr.STATUS}"
            )

        lr.STATUS = "REJECTED"

        lr.APPROVAL_RESOLVED_AT = now

        lr.REJECTION_REASON = reason

        db.commit()

        return {"message": f"{kind.title()} rejected.", "id": lr.ID}

    if kind == "purchase_order":

        po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == item_id).first()

        if not po:

            raise HTTPException(status_code=404, detail="PO not found")

        if po.STATUS != "DRAFT":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot reject — current status is {po.STATUS}"
            )

        po.STATUS = "CANCELLED"

        if hasattr(po, "CANCELLED_AT"):

            po.CANCELLED_AT = now

        if hasattr(po, "CANCEL_REASON"):

            po.CANCEL_REASON = reason

        db.commit()

        return {"message": "Purchase Order rejected.", "id": po.ID}

    if kind == "supplier_payment":

        sp = db.query(SupplierPayment).filter(SupplierPayment.ID == item_id).first()

        if not sp:

            raise HTTPException(status_code=404, detail="Supplier payment not found")

        if sp.STATUS != "PENDING_APPROVAL":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot reject — current status is {sp.STATUS}"
            )

        sp.STATUS            = "REJECTED"
        sp.REJECTION_REASON  = reason
        sp.APPROVED_BY_ID    = admin_id  # actor of the rejection
        sp.APPROVED_AT       = now

        db.commit()

        return {"message": "Supplier payment rejected.", "id": sp.ID}

    raise HTTPException(status_code=400, detail=f"Unknown approval kind: {kind}")


# ---- Create endpoints for buckets 5 & 6 ----------------------------

class SupplierPaymentCreate(BaseModel):

    PO_ID: int
    AMOUNT: float
    PAYMENT_DATE: Optional[str] = None  # ISO date
    PAYMENT_MODE: Optional[str] = None
    REFERENCE_NO: Optional[str] = None
    NOTES: Optional[str] = None


@router.post("/supplier-payments", dependencies=[Depends(get_current_user)])
def create_supplier_payment(
    body: SupplierPaymentCreate,
    db: Session = Depends(get_db)
):
    """Record a new supplier payment pending admin approval."""

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == body.PO_ID).first()

    if not po:

        raise HTTPException(status_code=404, detail="Purchase Order not found")

    payment_date = None

    if body.PAYMENT_DATE:

        try:

            payment_date = datetime.fromisoformat(body.PAYMENT_DATE).date()

        except ValueError:

            raise HTTPException(
                status_code=400,
                detail="PAYMENT_DATE must be YYYY-MM-DD"
            )

    sp = SupplierPayment(
        PO_ID=body.PO_ID,
        AMOUNT=body.AMOUNT,
        PAYMENT_DATE=payment_date,
        PAYMENT_MODE=body.PAYMENT_MODE,
        REFERENCE_NO=body.REFERENCE_NO,
        NOTES=body.NOTES,
        STATUS="PENDING_APPROVAL",
        VENDOR_ID=getattr(po, "VENDOR_ID", None) or 1,
    )

    db.add(sp)

    db.commit()

    db.refresh(sp)

    return {
        "message": f"Payment of INR {sp.AMOUNT:,.2f} logged — awaiting admin approval.",
        "payment": _serialize_sup_pay(db, sp),
    }


