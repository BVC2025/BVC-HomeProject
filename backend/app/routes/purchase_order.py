"""
Phase 4 — Purchase Order Module routes.

Endpoints:
  POST   /purchase-orders                       Create PO
  GET    /purchase-orders                       List
  GET    /purchase-orders/{id}                  Detail (with lines)
  PATCH  /purchase-orders/{id}                  Update header
  DELETE /purchase-orders/{id}                  Delete (DRAFT/CANCELLED only)

  POST   /purchase-orders/{id}/lines            Add line
  PATCH  /purchase-orders/{id}/lines/{lid}      Update line
  DELETE /purchase-orders/{id}/lines/{lid}      Remove line

  POST   /purchase-orders/{id}/send             Mark SENT + email supplier
  POST   /purchase-orders/{id}/resend-email     Re-dispatch the email
  POST   /purchase-orders/{id}/confirm          Mark CONFIRMED
  POST   /purchase-orders/{id}/cancel           Mark CANCELLED with reason

  POST   /purchase-orders/{id}/grn              Record a goods receipt
  GET    /purchase-orders/{id}/grn              List GRNs for this PO
  POST   /purchase-orders/grn/{gid}/finalize    Lock GRN + push to Inventory

  GET    /purchase-orders/{id}/activity         Timeline
  DELETE /purchase-orders/{id}/activity/{aid}   Remove a single activity row

  POST   /purchase-orders/auto-from-project     Auto-generate POs from
                                                 a project's BOM, grouped
                                                 by supplier
"""

from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Supplier,
    Employee,
    Project,
    ProductModel,
    Inventory,
    BOMItem,
    PurchaseOrder,
    PurchaseOrderLine,
    GoodsReceiptNote,
    GoodsReceiptLine,
    PurchaseOrderActivity
)

from app.schemas.purchase_order_schema import (
    PurchaseOrderCreate,
    PurchaseOrderUpdate,
    POLineCreate,
    POLineUpdate,
    POCancellation,
    GRNCreate,
    AutoFromProjectRequest
)

from app.services.email_service import send_alert_email


router = APIRouter()


# =========================
# Helpers
# =========================

def _next_po_number(db: Session) -> str:

    year = datetime.utcnow().year

    prefix = f"PO-{year}-"

    last = db.query(PurchaseOrder).filter(
        PurchaseOrder.PO_NUMBER.like(f"{prefix}%")
    ).order_by(PurchaseOrder.PO_NUMBER.desc()).first()

    if not last or not last.PO_NUMBER:

        return f"{prefix}0001"

    try:

        n = int(last.PO_NUMBER.split("-")[-1])

    except (ValueError, IndexError):

        n = 0

    return f"{prefix}{n + 1:04d}"


def _next_grn_number(db: Session) -> str:

    year = datetime.utcnow().year

    prefix = f"GRN-{year}-"

    last = db.query(GoodsReceiptNote).filter(
        GoodsReceiptNote.GRN_NUMBER.like(f"{prefix}%")
    ).order_by(GoodsReceiptNote.GRN_NUMBER.desc()).first()

    if not last or not last.GRN_NUMBER:

        return f"{prefix}0001"

    try:

        n = int(last.GRN_NUMBER.split("-")[-1])

    except (ValueError, IndexError):

        n = 0

    return f"{prefix}{n + 1:04d}"


def _compute_line_total(line: PurchaseOrderLine) -> float:

    qty = float(line.QUANTITY or 0)

    price = float(line.UNIT_PRICE or 0)

    disc = float(line.DISCOUNT_PERCENT or 0)

    return round(qty * price * (1.0 - disc / 100.0), 2)


def _recompute_po_totals(db: Session, po: PurchaseOrder) -> None:

    lines = db.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.PO_ID == po.ID
    ).all()

    subtotal = sum(_compute_line_total(l) for l in lines)

    po.SUBTOTAL = round(subtotal, 2)

    disc_pct = float(po.DISCOUNT_PERCENT or 0)

    po.DISCOUNT_AMOUNT = round(subtotal * disc_pct / 100.0, 2)

    taxable = subtotal - po.DISCOUNT_AMOUNT

    tax_pct = float(po.TAX_PERCENT or 0)

    po.TAX_AMOUNT = round(taxable * tax_pct / 100.0, 2)

    po.GRAND_TOTAL = round(taxable + po.TAX_AMOUNT, 2)


def _log_activity(
    db: Session,
    po_id: int,
    event_type: str,
    detail: str = None,
    actor_type: str = "SYSTEM",
    actor_name: str = None
):

    db.add(PurchaseOrderActivity(
        PO_ID=po_id,
        EVENT_TYPE=event_type,
        EVENT_DETAIL=detail,
        ACTOR_TYPE=actor_type,
        ACTOR_NAME=actor_name
    ))


def _refresh_po_status_from_receipts(db: Session, po: PurchaseOrder) -> str:
    """Look at PO line QUANTITY_RECEIVED vs QUANTITY and adjust
    PO.STATUS to PARTIAL_RECEIVED or RECEIVED. Caller commits."""

    if po.STATUS in ("DRAFT", "CANCELLED"):

        return po.STATUS

    lines = db.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.PO_ID == po.ID
    ).all()

    if not lines:

        return po.STATUS

    fully_received = all(
        (float(l.QUANTITY_RECEIVED or 0)) >= (float(l.QUANTITY or 0))
        for l in lines
    )

    any_received = any(
        (float(l.QUANTITY_RECEIVED or 0)) > 0 for l in lines
    )

    if fully_received:

        po.STATUS = "RECEIVED"

    elif any_received:

        po.STATUS = "PARTIAL_RECEIVED"

    return po.STATUS


def _serialize_po_line(l: PurchaseOrderLine, db: Session = None) -> dict:
    """PO line serializer with full receipt breakdown:
    ORDERED       — how many were ordered
    ACCEPTED      — good units that landed in inventory (FINAL GRNs only)
    REJECTED      — damaged/bad units, tracked but NOT in inventory
    PENDING       — still owed by supplier = ORDERED - ACCEPTED
    Optional db param: when given, REJECTED is aggregated from
    goods_receipt_line; otherwise REJECTED is 0."""

    ordered = float(l.QUANTITY or 0)

    accepted = float(l.QUANTITY_RECEIVED or 0)

    # Rejected total — sum across all FINAL GRN lines for this PO line
    rejected = 0.0

    if db is not None:

        rejected = float(
            db.query(
                func.coalesce(func.sum(GoodsReceiptLine.QUANTITY_REJECTED), 0)
            ).join(
                GoodsReceiptNote,
                GoodsReceiptLine.GRN_ID == GoodsReceiptNote.ID
            ).filter(
                GoodsReceiptLine.PO_LINE_ID == l.ID,
                GoodsReceiptNote.STATUS == "FINAL"
            ).scalar() or 0
        )

    pending = max(0.0, round(ordered - accepted, 4))

    return {
        "ID": l.ID,
        "PO_ID": l.PO_ID,
        "PRODUCT_ID": l.PRODUCT_ID,
        "BOM_ITEM_ID": l.BOM_ITEM_ID,
        "DESCRIPTION": l.DESCRIPTION,
        "HSN_CODE": l.HSN_CODE,
        # Canonical naming
        "ORDERED": ordered,
        "ACCEPTED": accepted,
        "REJECTED": round(rejected, 4),
        "PENDING": pending,
        # Back-compat aliases — old UI code still reads these names
        "QUANTITY": ordered,
        "QUANTITY_RECEIVED": accepted,
        "QUANTITY_PENDING": pending,
        "UNIT": l.UNIT,
        "UNIT_PRICE": l.UNIT_PRICE,
        "DISCOUNT_PERCENT": l.DISCOUNT_PERCENT,
        "LINE_TOTAL": l.LINE_TOTAL,
        "SORT_ORDER": l.SORT_ORDER
    }


def _serialize_po(
    db: Session, po: PurchaseOrder, include_lines: bool = True
) -> dict:

    base = {
        "ID": po.ID,
        "PO_NUMBER": po.PO_NUMBER,
        "SUPPLIER_ID": po.SUPPLIER_ID,
        "PO_DATE": po.PO_DATE.isoformat() if po.PO_DATE else None,
        "EXPECTED_DELIVERY_DATE": (
            po.EXPECTED_DELIVERY_DATE.isoformat()
            if po.EXPECTED_DELIVERY_DATE else None
        ),
        "STATUS": po.STATUS,
        "SUBTOTAL": po.SUBTOTAL,
        "DISCOUNT_PERCENT": po.DISCOUNT_PERCENT,
        "DISCOUNT_AMOUNT": po.DISCOUNT_AMOUNT,
        "TAX_PERCENT": po.TAX_PERCENT,
        "TAX_AMOUNT": po.TAX_AMOUNT,
        "GRAND_TOTAL": po.GRAND_TOTAL,
        "DELIVERY_ADDRESS": po.DELIVERY_ADDRESS,
        "TERMS_AND_CONDITIONS": po.TERMS_AND_CONDITIONS,
        "NOTES": po.NOTES,
        "PREPARED_BY": po.PREPARED_BY,
        "LINKED_PROJECT_ID": po.LINKED_PROJECT_ID,
        "SENT_AT": po.SENT_AT.isoformat() if po.SENT_AT else None,
        "CONFIRMED_AT": po.CONFIRMED_AT.isoformat() if po.CONFIRMED_AT else None,
        "CANCELLED_AT": po.CANCELLED_AT.isoformat() if po.CANCELLED_AT else None,
        "CANCEL_REASON": po.CANCEL_REASON,
        "EMAIL_SENT_AT": po.EMAIL_SENT_AT.isoformat() if po.EMAIL_SENT_AT else None,
        "EMAIL_SENT_COUNT": po.EMAIL_SENT_COUNT or 0,
        "LAST_EMAIL_STATUS": po.LAST_EMAIL_STATUS,
        "VENDOR_ID": po.VENDOR_ID,
        "CREATED_AT": po.CREATED_AT.isoformat() if po.CREATED_AT else None,
        "UPDATED_AT": po.UPDATED_AT.isoformat() if po.UPDATED_AT else None
    }

    # Supplier lookup
    if po.SUPPLIER_ID:

        s = db.query(Supplier).filter(Supplier.ID == po.SUPPLIER_ID).first()

        if s:

            base["SUPPLIER_NAME"] = s.COMPANY_NAME
            base["SUPPLIER_CODE"] = s.SUPPLIER_CODE
            base["SUPPLIER_PHONE"] = s.PHONE
            base["SUPPLIER_EMAIL"] = s.EMAIL
            base["SUPPLIER_GST"] = s.GST_NUMBER
            base["SUPPLIER_ADDRESS"] = ", ".join(filter(None, [
                s.ADDRESS_LINE1, s.ADDRESS_LINE2, s.CITY, s.STATE, s.PINCODE
            ]))

    # Preparer
    if po.PREPARED_BY:

        emp = db.query(Employee).filter(Employee.ID == po.PREPARED_BY).first()

        if emp:

            base["PREPARED_BY_NAME"] = emp.NAME

    # Linked project
    if po.LINKED_PROJECT_ID:

        p = db.query(Project).filter(Project.ID == po.LINKED_PROJECT_ID).first()

        if p:

            base["LINKED_PROJECT_NAME"] = p.PROJECT_NAME

    if include_lines:

        lines = db.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.PO_ID == po.ID
        ).order_by(
            PurchaseOrderLine.SORT_ORDER,
            PurchaseOrderLine.ID
        ).all()

        base["LINES"] = [_serialize_po_line(l, db) for l in lines]

    return base


def _build_po_email_html(po: PurchaseOrder, supplier: Supplier) -> str:
    """Customer-facing HTML body for the PO email to supplier."""

    inr = lambda n: "Rs. " + "{:,.2f}".format(float(n or 0))

    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f1f5f9; font-family: Arial, sans-serif;">
  <div style="max-width: 640px; margin: 30px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 30px rgba(0,0,0,0.08);">

    <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 24px 28px;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; opacity: 0.9;">
        BVC24 · PURCHASE ORDER
      </div>
      <h1 style="margin: 6px 0 0; font-size: 22px;">{po.PO_NUMBER}</h1>
    </div>

    <div style="padding: 26px 28px; color: #0f172a; line-height: 1.55;">
      <p style="margin: 0 0 14px; font-size: 15px;">Dear <b>{supplier.COMPANY_NAME}</b>,</p>

      <p style="margin: 0 0 18px; font-size: 14px; color: #475569;">
        Please find attached our purchase order. Kindly acknowledge
        receipt and confirm the expected delivery date.
      </p>

      <div style="background:#fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
        <table style="width:100%; font-size: 13px; color: #475569;">
          <tr><td>PO Number</td><td style="text-align:right; color:#0f172a; font-weight:700;">{po.PO_NUMBER}</td></tr>
          <tr><td>PO Date</td><td style="text-align:right; color:#0f172a;">{po.PO_DATE}</td></tr>
          <tr><td>Expected Delivery</td><td style="text-align:right; color:#0f172a;">{po.EXPECTED_DELIVERY_DATE or '—'}</td></tr>
          <tr><td style="padding-top:8px; font-size:15px;"><b>Grand Total</b></td>
              <td style="text-align:right; padding-top:8px; color:#047857; font-size:18px; font-weight:800;">
                {inr(po.GRAND_TOTAL)}
              </td></tr>
        </table>
      </div>

      <p style="margin: 14px 0; font-size: 13px; color: #475569;">
        Please reply to this email to acknowledge or call us at
        <b>+91 90000 12345</b> for any clarifications.
      </p>

      <p style="margin: 20px 0 0; font-size: 13px; color: #0f172a;">
        Warm regards,<br>
        <b>Procurement — BVC24</b>
      </p>
    </div>

    <div style="background:#f8fafc; padding: 14px 28px; font-size: 11px; color: #94a3b8; text-align: center;">
      Bharath Vending Corporation · Chennai, Tamil Nadu, India · www.bvc24.in
    </div>
  </div>
</body>
</html>
"""


def _send_po_email(db: Session, po: PurchaseOrder) -> tuple:

    supplier = db.query(Supplier).filter(
        Supplier.ID == po.SUPPLIER_ID
    ).first()

    if not supplier or not supplier.EMAIL:

        return False, "Supplier has no EMAIL on file"

    subject = f"Purchase Order {po.PO_NUMBER} from Bharath Vending Corp."

    html = _build_po_email_html(po, supplier)

    return send_alert_email(subject, html, recipient=supplier.EMAIL)


# =========================
# Rejection Notice (auto-fired on GRN finalize when items rejected)
# =========================

def _build_rejection_email_html(
    grn: GoodsReceiptNote,
    po: PurchaseOrder,
    supplier: Supplier,
    rejected_lines: list,
    db: Session
) -> str:
    """Customer-facing HTML body for the rejection notice email.
    Lists every rejected material with quantity and reason."""

    # Build table rows
    rows_html = ""

    for rl in rejected_lines:

        po_line = db.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.ID == rl.PO_LINE_ID
        ).first()

        material_name = (po_line.DESCRIPTION if po_line else "—")

        unit = (po_line.UNIT if po_line else "pcs")

        reason = (rl.REJECTION_REASON or "Not specified")

        rows_html += f"""
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #0f172a;">
            {material_name}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: center; color: #b91c1c; font-weight: 800; font-size: 15px;">
            {rl.QUANTITY_REJECTED} {unit}
          </td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #475569; font-style: italic;">
            {reason}
          </td>
        </tr>
        """

    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f1f5f9; font-family: Arial, sans-serif;">
  <div style="max-width: 660px; margin: 30px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 30px rgba(0,0,0,0.08);">

    <div style="background: linear-gradient(135deg, #dc2626, #991b1b); color: white; padding: 24px 28px;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; opacity: 0.9;">
        BVC24 · WAREHOUSE QC
      </div>
      <h1 style="margin: 6px 0 0; font-size: 20px;">
        Material Rejection Notice — {po.PO_NUMBER}
      </h1>
    </div>

    <div style="padding: 26px 28px; color: #0f172a; line-height: 1.55;">

      <p style="margin: 0 0 14px; font-size: 15px;">
        Dear <b>{supplier.COMPANY_NAME}</b>,
      </p>

      <p style="margin: 0 0 18px; font-size: 14px; color: #475569;">
        During Goods Receipt inspection on
        <b>{grn.RECEIVED_DATE}</b> against
        <b>{po.PO_NUMBER}</b> (GRN: <b>{grn.GRN_NUMBER}</b>),
        the following material(s) were <b style="color:#b91c1c;">rejected</b>:
      </p>

      <table style="width:100%; border-collapse: collapse; margin-bottom: 22px; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background:#fee2e2; color: #7f1d1d;">
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; letter-spacing: 0.8px;">MATERIAL</th>
            <th style="padding: 10px 12px; text-align: center; font-size: 11px; letter-spacing: 0.8px;">REJECTED QTY</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; letter-spacing: 0.8px;">REASON</th>
          </tr>
        </thead>
        <tbody>
          {rows_html}
        </tbody>
      </table>

      <div style="background:#fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
        <b>Action requested:</b> Please arrange a <b>replacement</b>
        for the rejected quantities at the earliest, or provide
        clarification if you believe these were dispatched in
        acceptable condition.
      </div>

      <p style="margin: 14px 0; font-size: 13px; color: #475569;">
        For any clarifications, reply to this email or call us at
        <b>+91 90000 12345</b>. Quote PO <b>{po.PO_NUMBER}</b> and
        GRN <b>{grn.GRN_NUMBER}</b>.
      </p>

      <p style="margin: 22px 0 0; font-size: 13px; color: #0f172a;">
        Regards,<br>
        <b>BVC24 Purchase Team</b>
      </p>
    </div>

    <div style="background:#f8fafc; padding: 14px 28px; font-size: 11px; color: #94a3b8; text-align: center;">
      Bharath Vending Corporation · Chennai, Tamil Nadu, India · www.bvc24.in<br>
      Auto-generated by BVC24 ERP on {datetime.utcnow().strftime("%d %b %Y, %H:%M")} UTC
    </div>
  </div>
</body>
</html>
"""


def _send_rejection_notice(db: Session, grn: GoodsReceiptNote) -> tuple:
    """Fire a rejection-notice email to the supplier listing every
    rejected line on this GRN. Returns (success, msg). Skipped (with
    a polite message) if there are no rejected lines."""

    # Find rejected lines first — if none, nothing to send
    rejected_lines = db.query(GoodsReceiptLine).filter(
        GoodsReceiptLine.GRN_ID == grn.ID,
        GoodsReceiptLine.QUANTITY_REJECTED > 0
    ).all()

    if not rejected_lines:

        return False, "No rejected lines — notice not needed"

    po = db.query(PurchaseOrder).filter(
        PurchaseOrder.ID == grn.PO_ID
    ).first()

    if not po:

        return False, "Parent PO not found"

    supplier = db.query(Supplier).filter(
        Supplier.ID == po.SUPPLIER_ID
    ).first()

    if not supplier or not supplier.EMAIL:

        return False, "Supplier has no EMAIL on file"

    subject = (
        f"Material Rejection Notice — {po.PO_NUMBER} / {grn.GRN_NUMBER}"
    )

    html = _build_rejection_email_html(
        grn, po, supplier, rejected_lines, db
    )

    return send_alert_email(subject, html, recipient=supplier.EMAIL)


# =========================
# PO CRUD
# =========================

@router.post("/purchase-orders")
def create_po(
    data: PurchaseOrderCreate,
    db: Session = Depends(get_db)
):

    supplier = db.query(Supplier).filter(
        Supplier.ID == data.SUPPLIER_ID
    ).first()

    if not supplier:

        raise HTTPException(status_code=404, detail="Supplier not found")

    po = PurchaseOrder(
        PO_NUMBER=_next_po_number(db),
        SUPPLIER_ID=data.SUPPLIER_ID,
        PO_DATE=data.PO_DATE or date.today(),
        EXPECTED_DELIVERY_DATE=data.EXPECTED_DELIVERY_DATE,
        DISCOUNT_PERCENT=data.DISCOUNT_PERCENT or 0.0,
        TAX_PERCENT=data.TAX_PERCENT if data.TAX_PERCENT is not None else 18.0,
        DELIVERY_ADDRESS=data.DELIVERY_ADDRESS,
        TERMS_AND_CONDITIONS=data.TERMS_AND_CONDITIONS,
        NOTES=data.NOTES,
        PREPARED_BY=data.PREPARED_BY,
        LINKED_PROJECT_ID=data.LINKED_PROJECT_ID,
        VENDOR_ID=data.VENDOR_ID or 1,
        STATUS="DRAFT"
    )

    db.add(po)

    db.flush()

    for idx, line_data in enumerate(data.LINES):

        line = PurchaseOrderLine(
            PO_ID=po.ID,
            PRODUCT_ID=line_data.PRODUCT_ID,
            BOM_ITEM_ID=line_data.BOM_ITEM_ID,
            DESCRIPTION=line_data.DESCRIPTION,
            HSN_CODE=line_data.HSN_CODE,
            QUANTITY=line_data.QUANTITY or 1.0,
            UNIT=line_data.UNIT or "pcs",
            UNIT_PRICE=line_data.UNIT_PRICE or 0.0,
            DISCOUNT_PERCENT=line_data.DISCOUNT_PERCENT or 0.0,
            SORT_ORDER=line_data.SORT_ORDER or idx
        )

        line.LINE_TOTAL = _compute_line_total(line)

        db.add(line)

    db.flush()

    _recompute_po_totals(db, po)

    _log_activity(
        db, po.ID, "CREATED",
        detail=f"PO {po.PO_NUMBER} created with {len(data.LINES)} line(s)"
    )

    db.commit()

    db.refresh(po)

    return {
        "message": "PO created",
        "purchase_order": _serialize_po(db, po)
    }


@router.get("/purchase-orders")
def list_pos(
    status: Optional[str] = Query(None),
    supplier_id: Optional[int] = Query(None),
    project_id: Optional[int] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(PurchaseOrder)

    if status:

        q = q.filter(PurchaseOrder.STATUS == status.upper())

    if supplier_id:

        q = q.filter(PurchaseOrder.SUPPLIER_ID == supplier_id)

    if project_id:

        q = q.filter(PurchaseOrder.LINKED_PROJECT_ID == project_id)

    if vendor_id:

        q = q.filter(PurchaseOrder.VENDOR_ID == vendor_id)

    rows = q.order_by(PurchaseOrder.CREATED_AT.desc()).all()

    return [_serialize_po(db, r, include_lines=False) for r in rows]


@router.get("/purchase-orders/{po_id}")
def get_po(
    po_id: int,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    return _serialize_po(db, po, include_lines=True)


@router.patch("/purchase-orders/{po_id}")
def update_po(
    po_id: int,
    data: PurchaseOrderUpdate,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS in ("RECEIVED", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit a {po.STATUS} PO"
        )

    payload = data.dict(exclude_unset=True)

    for field, value in payload.items():

        setattr(po, field, value)

    _recompute_po_totals(db, po)

    db.commit()

    db.refresh(po)

    return {"message": "PO updated", "purchase_order": _serialize_po(db, po)}


@router.delete("/purchase-orders/{po_id}")
def delete_po(
    po_id: int,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS not in ("DRAFT", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete a {po.STATUS} PO. "
                f"Only DRAFT / CANCELLED can be deleted."
            )
        )

    # Wipe child rows so FKs don't block delete
    db.query(PurchaseOrderActivity).filter(
        PurchaseOrderActivity.PO_ID == po_id
    ).delete()

    db.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.PO_ID == po_id
    ).delete()

    db.delete(po)

    db.commit()

    return {"message": "PO removed"}


# =========================
# Line CRUD
# =========================

@router.post("/purchase-orders/{po_id}/lines")
def add_line(
    po_id: int,
    data: POLineCreate,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS in ("RECEIVED", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit lines on a {po.STATUS} PO"
        )

    line = PurchaseOrderLine(
        PO_ID=po_id,
        PRODUCT_ID=data.PRODUCT_ID,
        BOM_ITEM_ID=data.BOM_ITEM_ID,
        DESCRIPTION=data.DESCRIPTION,
        HSN_CODE=data.HSN_CODE,
        QUANTITY=data.QUANTITY or 1.0,
        UNIT=data.UNIT or "pcs",
        UNIT_PRICE=data.UNIT_PRICE or 0.0,
        DISCOUNT_PERCENT=data.DISCOUNT_PERCENT or 0.0,
        SORT_ORDER=data.SORT_ORDER or 0
    )

    line.LINE_TOTAL = _compute_line_total(line)

    db.add(line)

    db.flush()

    _recompute_po_totals(db, po)

    db.commit()

    db.refresh(line)

    return {
        "message": "Line added",
        "line": _serialize_po_line(line, db),
        "totals": {"SUBTOTAL": po.SUBTOTAL, "GRAND_TOTAL": po.GRAND_TOTAL}
    }


@router.patch("/purchase-orders/{po_id}/lines/{line_id}")
def update_line(
    po_id: int,
    line_id: int,
    data: POLineUpdate,
    db: Session = Depends(get_db)
):

    line = db.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.ID == line_id,
        PurchaseOrderLine.PO_ID == po_id
    ).first()

    if not line:

        raise HTTPException(status_code=404, detail="Line not found")

    payload = data.dict(exclude_unset=True)

    for field, value in payload.items():

        setattr(line, field, value)

    line.LINE_TOTAL = _compute_line_total(line)

    db.flush()

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    _recompute_po_totals(db, po)

    db.commit()

    db.refresh(line)

    return {
        "message": "Line updated",
        "line": _serialize_po_line(line, db),
        "totals": {"SUBTOTAL": po.SUBTOTAL, "GRAND_TOTAL": po.GRAND_TOTAL}
    }


@router.delete("/purchase-orders/{po_id}/lines/{line_id}")
def delete_line(
    po_id: int,
    line_id: int,
    db: Session = Depends(get_db)
):

    line = db.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.ID == line_id,
        PurchaseOrderLine.PO_ID == po_id
    ).first()

    if not line:

        raise HTTPException(status_code=404, detail="Line not found")

    db.delete(line)

    db.flush()

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    _recompute_po_totals(db, po)

    db.commit()

    return {
        "message": "Line removed",
        "totals": {"SUBTOTAL": po.SUBTOTAL, "GRAND_TOTAL": po.GRAND_TOTAL}
    }


# =========================
# Workflow
# =========================

@router.post("/purchase-orders/{po_id}/send")
def send_po(
    po_id: int,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS != "DRAFT":

        raise HTTPException(
            status_code=400,
            detail=f"Only DRAFT POs can be sent (current: {po.STATUS})"
        )

    po.STATUS = "SENT"

    po.SENT_AT = datetime.utcnow()

    _log_activity(db, po.ID, "SENT", detail="PO status: DRAFT → SENT")

    ok, msg = _send_po_email(db, po)

    po.LAST_EMAIL_STATUS = msg[:200] if msg else None

    if ok:

        po.EMAIL_SENT_AT = datetime.utcnow()

        po.EMAIL_SENT_COUNT = (po.EMAIL_SENT_COUNT or 0) + 1

        _log_activity(
            db, po.ID, "EMAIL_SENT",
            detail=f"Email delivered to supplier ({msg})"
        )

    else:

        _log_activity(
            db, po.ID, "EMAIL_FAILED",
            detail=f"Email send failed: {msg}"
        )

    db.commit()

    db.refresh(po)

    return {
        "message": (
            "PO sent + email delivered" if ok
            else "PO marked SENT but email failed — check LAST_EMAIL_STATUS"
        ),
        "email_sent": ok,
        "email_status": msg,
        "purchase_order": _serialize_po(db, po, include_lines=False)
    }


@router.post("/purchase-orders/{po_id}/resend-email")
def resend_po_email(
    po_id: int,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS in ("CANCELLED",):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot resend a {po.STATUS} PO"
        )

    ok, msg = _send_po_email(db, po)

    po.LAST_EMAIL_STATUS = msg[:200] if msg else None

    if ok:

        po.EMAIL_SENT_AT = datetime.utcnow()

        po.EMAIL_SENT_COUNT = (po.EMAIL_SENT_COUNT or 0) + 1

        _log_activity(
            db, po.ID, "EMAIL_SENT",
            detail=f"Resent — {msg}"
        )

    else:

        _log_activity(
            db, po.ID, "EMAIL_FAILED",
            detail=f"Resend failed: {msg}"
        )

    db.commit()

    db.refresh(po)

    return {
        "email_sent": ok,
        "email_status": msg,
        "purchase_order": _serialize_po(db, po, include_lines=False)
    }


@router.post("/purchase-orders/{po_id}/confirm")
def confirm_po(
    po_id: int,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS not in ("SENT", "DRAFT"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot confirm a {po.STATUS} PO"
        )

    po.STATUS = "CONFIRMED"

    po.CONFIRMED_AT = datetime.utcnow()

    _log_activity(db, po.ID, "CONFIRMED", detail="Supplier acknowledged the PO")

    db.commit()

    db.refresh(po)

    return {
        "message": "PO confirmed",
        "purchase_order": _serialize_po(db, po, include_lines=False)
    }


@router.post("/purchase-orders/{po_id}/cancel")
def cancel_po(
    po_id: int,
    data: POCancellation,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS in ("RECEIVED", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=f"PO already {po.STATUS}"
        )

    po.STATUS = "CANCELLED"

    po.CANCELLED_AT = datetime.utcnow()

    po.CANCEL_REASON = data.CANCEL_REASON

    _log_activity(
        db, po.ID, "CANCELLED",
        detail=data.CANCEL_REASON or "PO cancelled"
    )

    db.commit()

    db.refresh(po)

    return {
        "message": "PO cancelled",
        "purchase_order": _serialize_po(db, po, include_lines=False)
    }


# =========================
# GRN — Goods Receipt
# =========================

def _serialize_grn(db: Session, g: GoodsReceiptNote) -> dict:
    """Full GRN payload with PO context, supplier info, and line
    breakdown including resolved material/description names so the
    print view can render without extra round-trips."""

    lines = db.query(GoodsReceiptLine).filter(
        GoodsReceiptLine.GRN_ID == g.ID
    ).all()

    # Receiver employee name
    receiver_name = None

    if g.RECEIVED_BY:

        emp = db.query(Employee).filter(Employee.ID == g.RECEIVED_BY).first()

        if emp:

            receiver_name = emp.NAME

    # PO + supplier context
    po = db.query(PurchaseOrder).filter(
        PurchaseOrder.ID == g.PO_ID
    ).first()

    supplier_name = None
    supplier_code = None
    po_number = None

    if po:

        po_number = po.PO_NUMBER

        if po.SUPPLIER_ID:

            s = db.query(Supplier).filter(Supplier.ID == po.SUPPLIER_ID).first()

            if s:

                supplier_name = s.COMPANY_NAME

                supplier_code = s.SUPPLIER_CODE

    # Resolve PO line descriptions / units / ordered qty
    po_line_ids = [l.PO_LINE_ID for l in lines if l.PO_LINE_ID]

    po_line_map = {}

    if po_line_ids:

        for pl in db.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.ID.in_(po_line_ids)
        ).all():

            po_line_map[pl.ID] = pl

    # Build line array + totals
    line_array = []

    total_accepted = 0.0

    total_rejected = 0.0

    for l in lines:

        pl = po_line_map.get(l.PO_LINE_ID)

        accepted = float(l.QUANTITY_RECEIVED or 0)

        rejected = float(l.QUANTITY_REJECTED or 0)

        total_accepted += accepted

        total_rejected += rejected

        line_array.append({
            "ID": l.ID,
            "PO_LINE_ID": l.PO_LINE_ID,
            "DESCRIPTION": pl.DESCRIPTION if pl else None,
            "UNIT": pl.UNIT if pl else None,
            "ORDERED": float(pl.QUANTITY or 0) if pl else 0,
            "QUANTITY_RECEIVED": accepted,
            "QUANTITY_REJECTED": rejected,
            "ACCEPTED": accepted,
            "REJECTED": rejected,
            "ARRIVED": round(accepted + rejected, 4),
            "REJECTION_REASON": l.REJECTION_REASON
        })

    return {
        "ID": g.ID,
        "GRN_NUMBER": g.GRN_NUMBER,
        "PO_ID": g.PO_ID,
        "PO_NUMBER": po_number,
        "SUPPLIER_NAME": supplier_name,
        "SUPPLIER_CODE": supplier_code,
        "RECEIVED_DATE": (
            g.RECEIVED_DATE.isoformat() if g.RECEIVED_DATE else None
        ),
        "RECEIVED_BY": g.RECEIVED_BY,
        "RECEIVED_BY_NAME": receiver_name,
        "STATUS": g.STATUS,
        "INVOICE_NUMBER": g.INVOICE_NUMBER,
        "NOTES": g.NOTES,
        "FINALIZED_AT": (
            g.FINALIZED_AT.isoformat() if g.FINALIZED_AT else None
        ),
        "CREATED_AT": g.CREATED_AT.isoformat() if g.CREATED_AT else None,
        "TOTAL_ACCEPTED": round(total_accepted, 4),
        "TOTAL_REJECTED": round(total_rejected, 4),
        "TOTAL_ARRIVED": round(total_accepted + total_rejected, 4),
        "LINES": line_array
    }


def _apply_grn_to_inventory(db: Session, grn: GoodsReceiptNote) -> int:
    """Pushes accepted (not rejected) quantities from a GRN into
    Inventory. Returns count of inventory rows touched. Caller commits.

    For each GRN line:
      - Look up the PO line (for PRODUCT_ID, UNIT_PRICE)
      - Find matching Inventory row (vendor + material)
      - QUANTITY += QUANTITY_RECEIVED
      - UNIT_PRICE = weighted average of old and new costs
    """

    touched = 0

    po = db.query(PurchaseOrder).filter(
        PurchaseOrder.ID == grn.PO_ID
    ).first()

    if not po:

        return 0

    grn_lines = db.query(GoodsReceiptLine).filter(
        GoodsReceiptLine.GRN_ID == grn.ID
    ).all()

    for gl in grn_lines:

        qty_in = float(gl.QUANTITY_RECEIVED or 0)

        if qty_in <= 0:

            continue

        po_line = db.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.ID == gl.PO_LINE_ID
        ).first()

        if not po_line:

            continue

        # Bump the PO line's running received count
        po_line.QUANTITY_RECEIVED = (
            float(po_line.QUANTITY_RECEIVED or 0) + qty_in
        )

        if not po_line.PRODUCT_ID:

            # Free-text line — can't update Inventory, skip silently
            continue

        product_id = po_line.PRODUCT_ID

        unit_price = float(po_line.UNIT_PRICE or 0)

        inv = db.query(Inventory).filter(
            Inventory.PRODUCT_ID == product_id,
            Inventory.VENDOR_ID == (po.VENDOR_ID or 1)
        ).first()

        if inv:

            old_qty = float(inv.QUANTITY or 0)

            old_price = float(inv.UNIT_PRICE or 0)

            new_qty = old_qty + qty_in

            # Weighted average — keeps Inventory price honest as
            # market prices drift across multiple POs.
            if new_qty > 0 and unit_price > 0:

                inv.UNIT_PRICE = round(
                    (old_qty * old_price + qty_in * unit_price) / new_qty,
                    2
                )

            inv.QUANTITY = int(new_qty)

        else:

            # First time we're stocking this product — create row
            inv = Inventory(
                PRODUCT_ID=product_id,
                MATERIAL_NAME=po_line.DESCRIPTION,
                QUANTITY=int(qty_in),
                UNIT_PRICE=unit_price,
                VENDOR_ID=po.VENDOR_ID or 1
            )

            db.add(inv)

        touched += 1

    return touched


@router.post("/purchase-orders/{po_id}/grn")
def create_grn(
    po_id: int,
    data: GRNCreate,
    db: Session = Depends(get_db)
):

    po = db.query(PurchaseOrder).filter(PurchaseOrder.ID == po_id).first()

    if not po:

        raise HTTPException(status_code=404, detail="PO not found")

    if po.STATUS in ("DRAFT", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot record receipts on a {po.STATUS} PO. "
                f"Send + confirm the PO first."
            )
        )

    if not data.LINES:

        raise HTTPException(status_code=400, detail="At least one GRN line required")

    grn = GoodsReceiptNote(
        GRN_NUMBER=_next_grn_number(db),
        PO_ID=po_id,
        RECEIVED_DATE=data.RECEIVED_DATE or date.today(),
        RECEIVED_BY=data.RECEIVED_BY,
        STATUS="DRAFT",
        INVOICE_NUMBER=data.INVOICE_NUMBER,
        NOTES=data.NOTES,
        VENDOR_ID=po.VENDOR_ID or 1
    )

    db.add(grn)

    db.flush()

    for line_data in data.LINES:

        # Validate PO_LINE belongs to this PO
        po_line = db.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.ID == line_data.PO_LINE_ID,
            PurchaseOrderLine.PO_ID == po_id
        ).first()

        if not po_line:

            raise HTTPException(
                status_code=400,
                detail=f"PO line {line_data.PO_LINE_ID} not found on this PO"
            )

        accepted_qty = float(line_data.QUANTITY_RECEIVED or 0)

        rejected_qty = float(line_data.QUANTITY_REJECTED or 0)

        # Refuse negative quantities
        if accepted_qty < 0 or rejected_qty < 0:

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Line '{po_line.DESCRIPTION}': quantities can't be negative"
                )
            )

        # Over-receive check — accepted can't exceed the still-pending
        # quantity on the PO line (PO_LINE.QUANTITY - already-accepted).
        # Rejected units are sent back to the supplier, so they DON'T
        # count against pending — but they do need a reason.
        ordered = float(po_line.QUANTITY or 0)

        already_accepted = float(po_line.QUANTITY_RECEIVED or 0)

        pending = max(0.0, ordered - already_accepted)

        if accepted_qty > pending + 0.001:  # tiny epsilon for float

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Line '{po_line.DESCRIPTION}': accepted {accepted_qty} "
                    f"exceeds pending {pending} (ordered {ordered}, "
                    f"already accepted {already_accepted})"
                )
            )

        # Rejected with no reason is suspicious — warn via 400
        if rejected_qty > 0 and not (line_data.REJECTION_REASON or "").strip():

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Line '{po_line.DESCRIPTION}': {rejected_qty} unit(s) "
                    f"marked rejected — please provide a rejection reason"
                )
            )

        db.add(GoodsReceiptLine(
            GRN_ID=grn.ID,
            PO_LINE_ID=line_data.PO_LINE_ID,
            QUANTITY_RECEIVED=accepted_qty,
            QUANTITY_REJECTED=rejected_qty,
            REJECTION_REASON=line_data.REJECTION_REASON
        ))

    _log_activity(
        db, po.ID, "GRN_RECORDED",
        detail=f"GRN {grn.GRN_NUMBER} drafted ({len(data.LINES)} line(s))"
    )

    db.flush()

    rejection_notice_status = None

    if data.FINALIZE:

        touched = _apply_grn_to_inventory(db, grn)

        grn.STATUS = "FINAL"

        grn.FINALIZED_AT = datetime.utcnow()

        _refresh_po_status_from_receipts(db, po)

        _log_activity(
            db, po.ID, "GRN_FINALIZED",
            detail=(
                f"{grn.GRN_NUMBER} finalized — "
                f"{touched} inventory row(s) updated. "
                f"PO status now: {po.STATUS}"
            )
        )

        # Auto-fire rejection notice when finalizing — only if any
        # lines were rejected. Supplier accountability + quality
        # tracking workflow.
        ok, msg = _send_rejection_notice(db, grn)

        rejection_notice_status = {"sent": ok, "detail": msg}

        if ok:

            _log_activity(
                db, po.ID, "REJECTION_NOTICE_SENT",
                detail=(
                    f"{grn.GRN_NUMBER} rejection email delivered to supplier ({msg})"
                )
            )

        elif "No rejected lines" not in msg:

            # Only log a failure when there WERE rejected lines but
            # the email actually failed (e.g. supplier email missing,
            # SMTP error). Skipping due to "no rejected lines" is
            # the happy path — no log entry needed.
            _log_activity(
                db, po.ID, "REJECTION_NOTICE_FAILED",
                detail=f"Auto-rejection-notice failed: {msg}"
            )

    db.commit()

    db.refresh(grn)

    return {
        "message": (
            f"GRN {grn.GRN_NUMBER} created"
            + (" + finalized (Inventory updated)" if data.FINALIZE else " (DRAFT)")
        ),
        "grn": _serialize_grn(db, grn),
        "po_status": po.STATUS,
        "rejection_notice": rejection_notice_status
    }


@router.get("/purchase-orders/{po_id}/grn")
def list_grns(
    po_id: int,
    db: Session = Depends(get_db)
):

    rows = db.query(GoodsReceiptNote).filter(
        GoodsReceiptNote.PO_ID == po_id
    ).order_by(GoodsReceiptNote.CREATED_AT.desc()).all()

    return [_serialize_grn(db, g) for g in rows]


@router.get("/purchase-orders/grn/{grn_id}")
def get_grn(
    grn_id: int,
    db: Session = Depends(get_db)
):
    """Fetch a single GRN by ID — used by the print view so it
    doesn't have to walk every PO to find one GRN."""

    grn = db.query(GoodsReceiptNote).filter(
        GoodsReceiptNote.ID == grn_id
    ).first()

    if not grn:

        raise HTTPException(status_code=404, detail="GRN not found")

    return _serialize_grn(db, grn)


@router.post("/purchase-orders/grn/{grn_id}/finalize")
def finalize_grn(
    grn_id: int,
    db: Session = Depends(get_db)
):

    grn = db.query(GoodsReceiptNote).filter(
        GoodsReceiptNote.ID == grn_id
    ).first()

    if not grn:

        raise HTTPException(status_code=404, detail="GRN not found")

    if grn.STATUS == "FINAL":

        raise HTTPException(status_code=400, detail="GRN already finalized")

    touched = _apply_grn_to_inventory(db, grn)

    grn.STATUS = "FINAL"

    grn.FINALIZED_AT = datetime.utcnow()

    po = db.query(PurchaseOrder).filter(
        PurchaseOrder.ID == grn.PO_ID
    ).first()

    _refresh_po_status_from_receipts(db, po)

    _log_activity(
        db, po.ID, "GRN_FINALIZED",
        detail=(
            f"{grn.GRN_NUMBER} finalized — "
            f"{touched} inventory row(s) updated. "
            f"PO status now: {po.STATUS}"
        )
    )

    # Auto-fire supplier rejection notice for rejected lines
    rn_ok, rn_msg = _send_rejection_notice(db, grn)

    rejection_notice_status = {"sent": rn_ok, "detail": rn_msg}

    if rn_ok:

        _log_activity(
            db, po.ID, "REJECTION_NOTICE_SENT",
            detail=(
                f"{grn.GRN_NUMBER} rejection email delivered to supplier ({rn_msg})"
            )
        )

    elif "No rejected lines" not in rn_msg:

        _log_activity(
            db, po.ID, "REJECTION_NOTICE_FAILED",
            detail=f"Auto-rejection-notice failed: {rn_msg}"
        )

    db.commit()

    return {
        "message": f"GRN finalized, {touched} inventory rows updated",
        "grn": _serialize_grn(db, grn),
        "po_status": po.STATUS,
        "rejection_notice": rejection_notice_status
    }


@router.post("/purchase-orders/grn/{grn_id}/resend-rejection-notice")
def resend_rejection_notice(
    grn_id: int,
    db: Session = Depends(get_db)
):
    """Manually resend the rejection notice for a finalized GRN —
    useful when the auto-send failed (e.g. supplier email was empty
    at finalize time, fixed now) or when you want to chase the
    supplier again."""

    grn = db.query(GoodsReceiptNote).filter(
        GoodsReceiptNote.ID == grn_id
    ).first()

    if not grn:

        raise HTTPException(status_code=404, detail="GRN not found")

    if grn.STATUS != "FINAL":

        raise HTTPException(
            status_code=400,
            detail="Only FINAL GRNs can have rejection notices resent"
        )

    ok, msg = _send_rejection_notice(db, grn)

    if "No rejected lines" in (msg or ""):

        raise HTTPException(
            status_code=400,
            detail="This GRN has no rejected lines — nothing to notify"
        )

    if ok:

        _log_activity(
            db, grn.PO_ID, "REJECTION_NOTICE_SENT",
            detail=f"{grn.GRN_NUMBER} rejection notice resent ({msg})"
        )

    else:

        _log_activity(
            db, grn.PO_ID, "REJECTION_NOTICE_FAILED",
            detail=f"Resend failed: {msg}"
        )

    db.commit()

    return {
        "sent": ok,
        "detail": msg
    }


@router.delete("/purchase-orders/grn/{grn_id}")
def delete_grn(
    grn_id: int,
    db: Session = Depends(get_db)
):
    """Delete a DRAFT GRN. FINAL GRNs cannot be deleted because
    their accepted quantities have already been pushed to Inventory
    — that's an audited transaction. Use a reverse-GRN flow if you
    need to correct a finalized receipt."""

    grn = db.query(GoodsReceiptNote).filter(
        GoodsReceiptNote.ID == grn_id
    ).first()

    if not grn:

        raise HTTPException(status_code=404, detail="GRN not found")

    if grn.STATUS == "FINAL":

        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot delete a FINAL GRN. Inventory has already "
                "been updated. Record a correction GRN with negative "
                "or rejected quantities instead."
            )
        )

    db.query(GoodsReceiptLine).filter(
        GoodsReceiptLine.GRN_ID == grn_id
    ).delete()

    po_id = grn.PO_ID

    grn_number = grn.GRN_NUMBER

    db.delete(grn)

    _log_activity(
        db, po_id, "GRN_RECORDED",
        detail=f"Draft GRN {grn_number} deleted"
    )

    db.commit()

    return {"message": f"GRN {grn_number} (DRAFT) removed"}


# =========================
# Activity
# =========================

@router.get("/purchase-orders/{po_id}/activity")
def get_po_activity(
    po_id: int,
    db: Session = Depends(get_db)
):

    rows = db.query(PurchaseOrderActivity).filter(
        PurchaseOrderActivity.PO_ID == po_id
    ).order_by(PurchaseOrderActivity.CREATED_AT.desc()).all()

    return [
        {
            "ID": r.ID,
            "EVENT_TYPE": r.EVENT_TYPE,
            "EVENT_DETAIL": r.EVENT_DETAIL,
            "ACTOR_TYPE": r.ACTOR_TYPE,
            "ACTOR_NAME": r.ACTOR_NAME,
            "CREATED_AT": r.CREATED_AT.isoformat() if r.CREATED_AT else None
        }
        for r in rows
    ]


@router.delete("/purchase-orders/{po_id}/activity/{activity_id}")
def delete_po_activity_row(
    po_id: int,
    activity_id: int,
    db: Session = Depends(get_db)
):

    row = db.query(PurchaseOrderActivity).filter(
        PurchaseOrderActivity.ID == activity_id,
        PurchaseOrderActivity.PO_ID == po_id
    ).first()

    if not row:

        raise HTTPException(status_code=404, detail="Activity row not found")

    db.delete(row)

    db.commit()

    return {"message": "Activity row removed"}


# =========================
# Auto-from-project
# =========================

@router.post("/purchase-orders/auto-from-project")
def auto_from_project(
    data: AutoFromProjectRequest,
    db: Session = Depends(get_db)
):
    """Generate POs from a project's BOM. BOM items are grouped by
    PREFERRED_SUPPLIER_ID — one PO per supplier. Quantities are
    multiplied by the project's TARGET_UNITS (or 1 if missing)."""

    project = db.query(Project).filter(Project.ID == data.PROJECT_ID).first()

    if not project:

        raise HTTPException(status_code=404, detail="Project not found")

    if not project.PRODUCT_MODEL_ID:

        # Self-heal: try to repoint by matching project name to a
        # product's MODEL_NAME. This recovers from a procurement
        # reset that nullified the link.
        candidates = db.query(ProductModel).filter(
            ProductModel.VENDOR_ID == (data.VENDOR_ID or 1)
        ).all()

        pname = (project.PROJECT_NAME or "").lower()

        matched = None

        for c in candidates:

            mname = (c.MODEL_NAME or "").lower()

            if mname and (mname in pname or pname.startswith(mname)):

                matched = c

                break

        if matched:

            project.PRODUCT_MODEL_ID = matched.ID

            db.commit()

        else:

            raise HTTPException(
                status_code=400,
                detail=(
                    "Project has no PRODUCT_MODEL_ID and no product "
                    "matches the project name. "
                    "Likely cause: the linked product was deleted by "
                    "a procurement reset. Delete and recreate the "
                    "project from the customer's Requirement."
                )
            )

    bom_rows = db.query(BOMItem).filter(
        BOMItem.PRODUCT_MODEL_ID == project.PRODUCT_MODEL_ID,
        BOMItem.ITEM_TYPE == "PURCHASE"
    ).all()

    if not bom_rows:

        raise HTTPException(
            status_code=400,
            detail="Product has no PURCHASE BOM lines"
        )

    units = max(1, int(getattr(project, "TARGET_UNITS", 1) or 1))

    # Group by supplier
    by_supplier = {}

    unassigned = []

    for b in bom_rows:

        if b.PREFERRED_SUPPLIER_ID:

            by_supplier.setdefault(b.PREFERRED_SUPPLIER_ID, []).append(b)

        else:

            unassigned.append(b)

    created_pos = []

    # Lookup inventory unit prices for the products
    product_ids = [b.PRODUCT_ID for b in bom_rows if b.PRODUCT_ID]

    inv_prices = {}

    if product_ids:

        for inv in db.query(Inventory).filter(
            Inventory.PRODUCT_ID.in_(product_ids),
            Inventory.VENDOR_ID == (data.VENDOR_ID or 1)
        ).all():

            inv_prices[inv.PRODUCT_ID] = float(inv.UNIT_PRICE or 0)

    for supplier_id, items in by_supplier.items():

        po = PurchaseOrder(
            PO_NUMBER=_next_po_number(db),
            SUPPLIER_ID=supplier_id,
            PO_DATE=date.today(),
            EXPECTED_DELIVERY_DATE=data.EXPECTED_DELIVERY_DATE,
            DISCOUNT_PERCENT=0.0,
            TAX_PERCENT=18.0,
            PREPARED_BY=data.PREPARED_BY,
            LINKED_PROJECT_ID=project.ID,
            VENDOR_ID=data.VENDOR_ID or 1,
            STATUS="DRAFT",
            NOTES=(
                f"Auto-generated from Project #{project.ID} "
                f"({project.PROJECT_NAME or 'unnamed'}) "
                f"for {units} unit(s)"
            )
        )

        db.add(po)

        db.flush()

        for idx, b in enumerate(items):

            qty = float(b.QUANTITY or 0) * units

            unit_price = inv_prices.get(b.PRODUCT_ID, 0.0)

            line = PurchaseOrderLine(
                PO_ID=po.ID,
                PRODUCT_ID=b.PRODUCT_ID,
                BOM_ITEM_ID=b.ID,
                DESCRIPTION=b.MATERIAL_NAME,
                QUANTITY=qty,
                UNIT=b.UNIT or "pcs",
                UNIT_PRICE=unit_price,
                DISCOUNT_PERCENT=0.0,
                SORT_ORDER=idx
            )

            line.LINE_TOTAL = _compute_line_total(line)

            db.add(line)

        db.flush()

        _recompute_po_totals(db, po)

        _log_activity(
            db, po.ID, "CREATED",
            detail=(
                f"Auto-generated from Project #{project.ID} BOM "
                f"({len(items)} line(s), {units} unit(s))"
            )
        )

        created_pos.append(po)

    # Handle unassigned BOM items if requested — single placeholder PO
    # with SUPPLIER_ID=NULL is invalid (FK), so we surface them in the
    # response instead. The user assigns suppliers in the BOM page and
    # re-runs.
    response_meta = {
        "project_id": project.ID,
        "units": units,
        "pos_created": [
            {
                "ID": p.ID,
                "PO_NUMBER": p.PO_NUMBER,
                "SUPPLIER_ID": p.SUPPLIER_ID,
                "GRAND_TOTAL": p.GRAND_TOTAL,
                "lines": len(by_supplier[p.SUPPLIER_ID])
            }
            for p in created_pos
        ],
        "unassigned_materials": [
            {
                "BOM_ITEM_ID": b.ID,
                "MATERIAL_NAME": b.MATERIAL_NAME,
                "QUANTITY_NEEDED": float(b.QUANTITY or 0) * units
            }
            for b in unassigned
        ]
    }

    db.commit()

    return {
        "message": (
            f"Created {len(created_pos)} PO(s) across "
            f"{len(created_pos)} supplier(s)"
            + (
                f". {len(unassigned)} BOM item(s) skipped — "
                "no preferred supplier set."
                if unassigned else ""
            )
        ),
        **response_meta
    }
