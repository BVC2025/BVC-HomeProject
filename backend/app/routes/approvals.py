"""Admin Module 4 — Approval Center.

Single endpoint that returns every pending item across 6 buckets
(Leaves, Permissions, Quotations, Purchase Orders, Supplier Payments,
Discount Requests) plus a unified approve/reject dispatcher.

Wire-up:

  GET    /admin/approvals/pending
  POST   /admin/approvals/{kind}/{id}/approve
  POST   /admin/approvals/{kind}/{id}/reject
  POST   /admin/approvals/supplier-payments        — create
  POST   /admin/approvals/discount-requests        — create

`kind` ∈ {leave, permission, quotation, purchase_order, supplier_payment, discount_request}
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    LeaveRequest,
    Quotation,
    PurchaseOrder,
    SupplierPayment,
    DiscountRequest,
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


def _serialize_quotation(db: Session, q: Quotation):

    cust = (
        db.query(Customer).filter(Customer.ID == q.CUSTOMER_ID).first()
        if q.CUSTOMER_ID else None
    )

    return {
        "kind":         "quotation",
        "id":           q.ID,
        "title":        q.QUOTATION_NUMBER or f"Quotation #{q.ID}",
        "subtitle":     (cust.CUSTOMER_NAME if cust else "—"),
        "reason":       q.NOTES or "",
        "amount":       float(q.GRAND_TOTAL or 0.0),
        "requested_at": (
            q.CREATED_AT.isoformat()
            if getattr(q, "CREATED_AT", None) else None
        ),
        "actor":        None,
        "status":       q.STATUS,
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


def _serialize_discount(db: Session, dr: DiscountRequest):

    q = (
        db.query(Quotation).filter(Quotation.ID == dr.QUOTATION_ID).first()
        if dr.QUOTATION_ID else None
    )

    cust = None

    if q and q.CUSTOMER_ID:

        c = db.query(Customer).filter(Customer.ID == q.CUSTOMER_ID).first()

        cust = c.CUSTOMER_NAME if c else None

    return {
        "kind":         "discount_request",
        "id":           dr.ID,
        "title":        (
            f"{cust or 'Customer'} — "
            f"{(dr.REQUESTED_DISCOUNT_PERCENT or 0):g}% discount"
        ),
        "subtitle":     (
            f"Quotation {q.QUOTATION_NUMBER if q else f'#{dr.QUOTATION_ID}'} "
            f"· Bot: {dr.BOT_ACTION or '—'}"
        ),
        "reason":       dr.CUSTOMER_REASON or "",
        "amount":       (
            float(q.GRAND_TOTAL or 0.0) if q else None
        ),
        "requested_at": dr.CREATED_AT.isoformat() if dr.CREATED_AT else None,
        "actor":        _emp(db, dr.REQUESTED_BY_ID),
        "status":       dr.STATUS,
    }


# ---- Pending feed --------------------------------------------------

@router.get("/pending")
def list_pending_approvals(db: Session = Depends(get_db)):
    """Returns all 6 buckets in one call. Each bucket is an array of
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

    # 3. Quotations — SENT and NEGOTIATION are awaiting internal sign-off
    quotes = db.query(Quotation).filter(
        Quotation.STATUS.in_(["SENT", "NEGOTIATION"])
    ).order_by(Quotation.ID.desc()).all()

    quote_items = [_serialize_quotation(db, q) for q in quotes]

    # 4. Purchase Orders — DRAFTs are pending review before being sent
    pos = db.query(PurchaseOrder).filter(
        PurchaseOrder.STATUS == "DRAFT"
    ).order_by(PurchaseOrder.ID.desc()).all()

    po_items = [_serialize_po(db, po) for po in pos]

    # 5. Supplier Payments
    sps = db.query(SupplierPayment).filter(
        SupplierPayment.STATUS == "PENDING_APPROVAL"
    ).order_by(SupplierPayment.CREATED_AT.desc()).all()

    sp_items = [_serialize_sup_pay(db, sp) for sp in sps]

    # 6. Discount Requests
    drs = db.query(DiscountRequest).filter(
        DiscountRequest.STATUS == "PENDING"
    ).order_by(DiscountRequest.CREATED_AT.desc()).all()

    dr_items = [_serialize_discount(db, dr) for dr in drs]

    buckets = {
        "leaves":             leave_items,
        "permissions":        perm_items,
        "quotations":         quote_items,
        "purchase_orders":    po_items,
        "supplier_payments":  sp_items,
        "discount_requests":  dr_items,
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


def _admin_id_from_request() -> Optional[str]:
    """Stub for future role-based audit — returns None for now.
    When admin JWT is enforced on this router we can populate via
    Depends(get_current_admin)."""

    return None


@router.post("/{kind}/{item_id}/approve")
def approve_item(
    kind: str,
    item_id: int,
    body: Optional[ApproveBody] = None,
    db: Session = Depends(get_db)
):

    admin_id = _admin_id_from_request()

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

    # 2. Quotation
    if kind == "quotation":

        q = db.query(Quotation).filter(Quotation.ID == item_id).first()

        if not q:

            raise HTTPException(status_code=404, detail="Quotation not found")

        if q.STATUS not in ("DRAFT", "SENT", "NEGOTIATION"):

            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve — current status is {q.STATUS}"
            )

        q.STATUS = "APPROVED"

        if hasattr(q, "APPROVED_AT"):

            q.APPROVED_AT = now

        db.commit()

        return {"message": "Quotation approved.", "id": q.ID}

    # 3. Purchase Order — approve = SENT
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

    # 4. Supplier Payment
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

    # 5. Discount Request — apply to parent quotation if approved
    if kind == "discount_request":

        dr = db.query(DiscountRequest).filter(DiscountRequest.ID == item_id).first()

        if not dr:

            raise HTTPException(status_code=404, detail="Discount request not found")

        if dr.STATUS != "PENDING":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot approve — current status is {dr.STATUS}"
            )

        # Apply the discount to the parent quotation
        q = db.query(Quotation).filter(Quotation.ID == dr.QUOTATION_ID).first()

        if q and hasattr(q, "DISCOUNT_PERCENT"):

            q.DISCOUNT_PERCENT = dr.REQUESTED_DISCOUNT_PERCENT

        dr.STATUS         = "APPROVED"
        dr.APPROVED_AT    = now
        dr.APPROVED_BY_ID = admin_id

        db.commit()

        return {
            "message": (
                f"Discount {dr.REQUESTED_DISCOUNT_PERCENT}% approved "
                "and applied to the quotation."
            ),
            "id": dr.ID
        }

    raise HTTPException(status_code=400, detail=f"Unknown approval kind: {kind}")


@router.post("/{kind}/{item_id}/reject")
def reject_item(
    kind: str,
    item_id: int,
    body: RejectBody,
    db: Session = Depends(get_db)
):

    admin_id = _admin_id_from_request()

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

    if kind == "quotation":

        q = db.query(Quotation).filter(Quotation.ID == item_id).first()

        if not q:

            raise HTTPException(status_code=404, detail="Quotation not found")

        if q.STATUS not in ("DRAFT", "SENT", "NEGOTIATION"):

            raise HTTPException(
                status_code=400,
                detail=f"Cannot reject — current status is {q.STATUS}"
            )

        q.STATUS = "REJECTED"

        if hasattr(q, "REJECTED_AT"):

            q.REJECTED_AT = now

        if hasattr(q, "REJECTION_REASON"):

            q.REJECTION_REASON = reason

        db.commit()

        return {"message": "Quotation rejected.", "id": q.ID}

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

    if kind == "discount_request":

        dr = db.query(DiscountRequest).filter(DiscountRequest.ID == item_id).first()

        if not dr:

            raise HTTPException(status_code=404, detail="Discount request not found")

        if dr.STATUS != "PENDING":

            raise HTTPException(
                status_code=400,
                detail=f"Cannot reject — current status is {dr.STATUS}"
            )

        dr.STATUS            = "REJECTED"
        dr.REJECTION_REASON  = reason
        dr.APPROVED_BY_ID    = admin_id
        dr.APPROVED_AT       = now

        db.commit()

        return {"message": "Discount request rejected.", "id": dr.ID}

    raise HTTPException(status_code=400, detail=f"Unknown approval kind: {kind}")


# ---- Create endpoints for buckets 5 & 6 ----------------------------

class SupplierPaymentCreate(BaseModel):

    PO_ID: int
    AMOUNT: float
    PAYMENT_DATE: Optional[str] = None  # ISO date
    PAYMENT_MODE: Optional[str] = None
    REFERENCE_NO: Optional[str] = None
    NOTES: Optional[str] = None


@router.post("/supplier-payments")
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


class DiscountRequestCreate(BaseModel):

    QUOTATION_ID: int
    REQUESTED_DISCOUNT_PERCENT: float
    CUSTOMER_REASON: Optional[str] = None
    BOT_ACTION: Optional[str] = "ESCALATE"


@router.post("/discount-requests")
def create_discount_request(
    body: DiscountRequestCreate,
    db: Session = Depends(get_db)
):
    """Log a discount request that needs admin sign-off. Called either
    by the quotation negotiation bot (when the asked-for discount
    exceeds the auto-approve cap) or by an admin manually."""

    q = db.query(Quotation).filter(Quotation.ID == body.QUOTATION_ID).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if not (0 < body.REQUESTED_DISCOUNT_PERCENT <= 100):

        raise HTTPException(
            status_code=400,
            detail="REQUESTED_DISCOUNT_PERCENT must be between 0 and 100"
        )

    dr = DiscountRequest(
        QUOTATION_ID=body.QUOTATION_ID,
        REQUESTED_DISCOUNT_PERCENT=body.REQUESTED_DISCOUNT_PERCENT,
        CUSTOMER_REASON=body.CUSTOMER_REASON,
        BOT_ACTION=body.BOT_ACTION,
        STATUS="PENDING",
        VENDOR_ID=getattr(q, "VENDOR_ID", None) or 1,
    )

    db.add(dr)

    db.commit()

    db.refresh(dr)

    return {
        "message": (
            f"Discount request {dr.REQUESTED_DISCOUNT_PERCENT}% on "
            f"{q.QUOTATION_NUMBER} queued for admin approval."
        ),
        "request": _serialize_discount(db, dr),
    }
