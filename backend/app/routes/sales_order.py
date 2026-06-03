"""
Phase 5 — Sales Order Module routes.

Endpoints:
  POST   /sales-orders                       Create SO (header + lines)
  GET    /sales-orders                       List
  GET    /sales-orders/{id}                  Detail (with lines)
  PATCH  /sales-orders/{id}                  Update header
  DELETE /sales-orders/{id}                  Delete (DRAFT/CANCELLED only)

  POST   /sales-orders/{id}/lines            Add line
  PATCH  /sales-orders/{id}/lines/{lid}      Update line
  DELETE /sales-orders/{id}/lines/{lid}      Remove line

  POST   /sales-orders/{id}/confirm          Mark CONFIRMED + email
  POST   /sales-orders/{id}/start-production Spawn projects + flip status
  POST   /sales-orders/{id}/ship             Mark SHIPPED
  POST   /sales-orders/{id}/deliver          Mark DELIVERED
  POST   /sales-orders/{id}/close            Mark CLOSED
  POST   /sales-orders/{id}/cancel           Mark CANCELLED with reason
  POST   /sales-orders/{id}/payment          Record payment milestone

  POST   /sales-orders/from-quotation        Convert APPROVED quotation → SO
  GET    /sales-orders/{id}/activity         Timeline
"""

import os

from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Customer,
    Employee,
    Quotation,
    QuotationLine,
    Project,
    ProductModel,
    SalesOrder,
    SalesOrderLine,
    SalesOrderActivity,
    Setting
)

from app.schemas.sales_order_schema import (
    SalesOrderCreate,
    SalesOrderUpdate,
    SOLineCreate,
    SOLineUpdate,
    SOCancellation,
    SOFromQuotation,
    SOPaymentRecord
)

from app.services.email_service import send_alert_email


router = APIRouter()


# =========================
# Helpers
# =========================

def _next_so_number(db: Session) -> str:

    year = datetime.utcnow().year

    prefix = f"SO-{year}-"

    last = db.query(SalesOrder).filter(
        SalesOrder.SO_NUMBER.like(f"{prefix}%")
    ).order_by(SalesOrder.SO_NUMBER.desc()).first()

    if not last or not last.SO_NUMBER:

        return f"{prefix}0001"

    try:

        n = int(last.SO_NUMBER.split("-")[-1])

    except (ValueError, IndexError):

        n = 0

    return f"{prefix}{n + 1:04d}"


# ----------------------------------------------------------------
# Settings + automation flags (UPSERT-style, idempotent)
# ----------------------------------------------------------------

def _get_setting(db: Session, key: str, default: str = "") -> str:
    """Read a Setting row by KEY. Empty string fallback."""

    row = db.query(Setting).filter(Setting.KEY == key).first()

    return row.VALUE if row and row.VALUE is not None else default


def _set_setting(db: Session, key: str, value: str) -> None:

    row = db.query(Setting).filter(Setting.KEY == key).first()

    if row:

        row.VALUE = value

        row.UPDATED_AT = datetime.utcnow()

    else:

        db.add(Setting(KEY=key, VALUE=value, UPDATED_AT=datetime.utcnow()))


def _bool_setting(db: Session, key: str, default: bool = True) -> bool:

    v = (_get_setting(db, key) or "").strip().lower()

    if not v:

        return default

    return v in ("1", "true", "yes", "on", "y")


def seed_sales_order_settings(db: Session) -> None:
    """Idempotent: insert default automation flags if missing.
    Called from main.py at startup."""

    defaults = {
        "sales_order.auto_start_production": "true",
        "sales_order.auto_create_pos":       "true",
    }

    for k, v in defaults.items():

        if not db.query(Setting).filter(Setting.KEY == k).first():

            db.add(Setting(KEY=k, VALUE=v, UPDATED_AT=datetime.utcnow()))

    db.commit()


def _auto_start_production_for_so(
    db: Session,
    so: SalesOrder,
    actor_type: str = "SYSTEM",
    actor_name: str = "Auto-start-production"
) -> dict:
    """Best-effort version of /sales-orders/{id}/start-production.
    Never raises — failure is logged to SalesOrderActivity and the
    caller decides what to do with the return value. Used by the
    record_payment auto-confirm hook so a CONFIRMED SO immediately
    spawns its projects + tasks + work orders without admin clicks.

    Returns: { ok, projects_spawned, projects, skipped, error? }
    """

    if so.STATUS != "CONFIRMED":

        return {
            "ok": False,
            "projects_spawned": 0,
            "skipped": 0,
            "error": f"SO status is {so.STATUS}, not CONFIRMED"
        }

    try:

        from app.services.project_from_product_service import (
            create_project_from_product
        )

        lines = db.query(SalesOrderLine).filter(
            SalesOrderLine.SO_ID == so.ID
        ).all()

        projects_spawned = 0

        skipped = 0

        project_summaries = []

        for line in lines:

            if line.SPAWNED_PROJECT_ID:

                continue

            if not line.PRODUCT_MODEL_ID:

                skipped += 1

                continue

            try:

                result = create_project_from_product(
                    db,
                    customer_id=so.CUSTOMER_ID,
                    product_model_id=line.PRODUCT_MODEL_ID,
                    quantity=int(line.QUANTITY or 1),
                    priority="MEDIUM",
                    target_date=so.EXPECTED_DELIVERY_DATE,
                    notes=(
                        f"Auto-spawned from {so.SO_NUMBER} "
                        f"(line #{line.ID}). {line.DESCRIPTION}"
                    ),
                    vendor_id=so.VENDOR_ID or 1
                )

                project_id = (
                    result.get("project", {}).get("ID")
                    or result.get("PROJECT_ID")
                )

                if project_id:

                    line.SPAWNED_PROJECT_ID = project_id

                    projects_spawned += 1

                    project_summaries.append({
                        "line_id": line.ID,
                        "project_id": project_id,
                        "product": line.DESCRIPTION
                    })

            except Exception as line_exc:

                _log_activity(
                    db, so.ID, "AUTO_START_PRODUCTION_LINE_FAILED",
                    detail=f"Line #{line.ID}: {line_exc}",
                    actor_type=actor_type, actor_name=actor_name
                )

                skipped += 1

        if projects_spawned > 0:

            so.STATUS = "IN_PRODUCTION"

            so.PRODUCTION_STARTED_AT = datetime.utcnow()

            _log_activity(
                db, so.ID, "AUTO_START_PRODUCTION",
                detail=(
                    f"{projects_spawned} project(s) auto-spawned"
                    + (f", {skipped} line(s) skipped" if skipped else "")
                ),
                actor_type=actor_type, actor_name=actor_name
            )

        # ---- Auto-PO step (gated by setting) -------------------
        po_summary = {"created": 0, "skipped_no_bom": 0}

        if (
            projects_spawned > 0
            and _bool_setting(db, "sales_order.auto_create_pos", True)
        ):

            try:

                from app.schemas.purchase_order_schema import (
                    AutoFromProjectRequest
                )

                from app.routes.purchase_order import auto_from_project

                for ps in project_summaries:

                    try:

                        req = AutoFromProjectRequest(
                            PROJECT_ID=ps["project_id"],
                            VENDOR_ID=so.VENDOR_ID or 1
                        )

                        result = auto_from_project(req, db=db)

                        po_summary["created"] += (
                            result.get("po_count", 0)
                            if isinstance(result, dict) else 0
                        )

                    except Exception as po_exc:

                        po_summary["skipped_no_bom"] += 1

                        _log_activity(
                            db, so.ID, "AUTO_PO_FAILED",
                            detail=(
                                f"Project #{ps['project_id']}: "
                                f"{str(po_exc)[:200]}"
                            ),
                            actor_type=actor_type, actor_name=actor_name
                        )

                if po_summary["created"] > 0:

                    _log_activity(
                        db, so.ID, "AUTO_POS_CREATED",
                        detail=(
                            f"{po_summary['created']} PO(s) auto-generated "
                            f"from project BOM"
                        ),
                        actor_type=actor_type, actor_name=actor_name
                    )

            except Exception as po_outer:

                _log_activity(
                    db, so.ID, "AUTO_POS_SKIPPED",
                    detail=f"Auto-PO scaffolding failed: {po_outer}",
                    actor_type=actor_type, actor_name=actor_name
                )

        return {
            "ok": True,
            "projects_spawned": projects_spawned,
            "projects": project_summaries,
            "skipped": skipped,
            "pos_created": po_summary["created"],
            "pos_skipped_no_bom": po_summary["skipped_no_bom"]
        }

    except Exception as exc:

        _log_activity(
            db, so.ID, "AUTO_START_PRODUCTION_FAILED",
            detail=f"{str(exc)[:300]}",
            actor_type=actor_type, actor_name=actor_name
        )

        return {
            "ok": False,
            "projects_spawned": 0,
            "skipped": 0,
            "error": str(exc)[:300]
        }


def _compute_line_total(line: SalesOrderLine) -> float:

    qty = float(line.QUANTITY or 0)

    price = float(line.UNIT_PRICE or 0)

    disc = float(line.DISCOUNT_PERCENT or 0)

    return round(qty * price * (1.0 - disc / 100.0), 2)


def _recompute_totals(db: Session, so: SalesOrder) -> None:

    lines = db.query(SalesOrderLine).filter(
        SalesOrderLine.SO_ID == so.ID
    ).all()

    subtotal = sum(_compute_line_total(l) for l in lines)

    so.SUBTOTAL = round(subtotal, 2)

    disc_pct = float(so.DISCOUNT_PERCENT or 0)

    so.DISCOUNT_AMOUNT = round(subtotal * disc_pct / 100.0, 2)

    taxable = subtotal - so.DISCOUNT_AMOUNT

    tax_pct = float(so.TAX_PERCENT or 0)

    so.TAX_AMOUNT = round(taxable * tax_pct / 100.0, 2)

    so.GRAND_TOTAL = round(taxable + so.TAX_AMOUNT, 2)


def _log_activity(
    db: Session,
    so_id: int,
    event_type: str,
    detail: str = None,
    actor_type: str = "SYSTEM",
    actor_name: str = None
):

    db.add(SalesOrderActivity(
        SO_ID=so_id,
        EVENT_TYPE=event_type,
        EVENT_DETAIL=detail,
        ACTOR_TYPE=actor_type,
        ACTOR_NAME=actor_name
    ))


def _serialize_line(l: SalesOrderLine) -> dict:

    return {
        "ID": l.ID,
        "SO_ID": l.SO_ID,
        "PRODUCT_MODEL_ID": l.PRODUCT_MODEL_ID,
        "QUOTATION_LINE_ID": l.QUOTATION_LINE_ID,
        "SPAWNED_PROJECT_ID": l.SPAWNED_PROJECT_ID,
        "DESCRIPTION": l.DESCRIPTION,
        "HSN_CODE": l.HSN_CODE,
        "QUANTITY": l.QUANTITY,
        "UNIT": l.UNIT,
        "UNIT_PRICE": l.UNIT_PRICE,
        "DISCOUNT_PERCENT": l.DISCOUNT_PERCENT,
        "LINE_TOTAL": l.LINE_TOTAL,
        "SORT_ORDER": l.SORT_ORDER
    }


def _serialize_so(
    db: Session, so: SalesOrder, include_lines: bool = True
) -> dict:

    payment_total_received = (
        float(so.ADVANCE_RECEIVED or 0)
        + float(so.DISPATCH_RECEIVED or 0)
        + float(so.INSTALLATION_RECEIVED or 0)
    )

    grand = float(so.GRAND_TOTAL or 0)

    base = {
        "ID": so.ID,
        "SO_NUMBER": so.SO_NUMBER,
        "CUSTOMER_ID": so.CUSTOMER_ID,
        "QUOTATION_ID": so.QUOTATION_ID,
        "SO_DATE": so.SO_DATE.isoformat() if so.SO_DATE else None,
        "EXPECTED_DELIVERY_DATE": (
            so.EXPECTED_DELIVERY_DATE.isoformat()
            if so.EXPECTED_DELIVERY_DATE else None
        ),
        "ADVANCE_DUE_DATE": (
            so.ADVANCE_DUE_DATE.isoformat() if so.ADVANCE_DUE_DATE else None
        ),
        "ADVANCE_AMOUNT": round(
            float(so.GRAND_TOTAL or 0) * float(so.ADVANCE_PERCENT or 0) / 100,
            2
        ),
        "DISPATCH_AMOUNT": round(
            float(so.GRAND_TOTAL or 0) * float(so.DISPATCH_PERCENT or 0) / 100,
            2
        ),
        "INSTALLATION_AMOUNT": round(
            float(so.GRAND_TOTAL or 0) * float(so.INSTALLATION_PERCENT or 0) / 100,
            2
        ),
        "STATUS": so.STATUS,
        "SUBTOTAL": so.SUBTOTAL,
        "DISCOUNT_PERCENT": so.DISCOUNT_PERCENT,
        "DISCOUNT_AMOUNT": so.DISCOUNT_AMOUNT,
        "TAX_PERCENT": so.TAX_PERCENT,
        "TAX_AMOUNT": so.TAX_AMOUNT,
        "GRAND_TOTAL": so.GRAND_TOTAL,
        "ADVANCE_PERCENT": so.ADVANCE_PERCENT,
        "DISPATCH_PERCENT": so.DISPATCH_PERCENT,
        "INSTALLATION_PERCENT": so.INSTALLATION_PERCENT,
        "ADVANCE_RECEIVED": so.ADVANCE_RECEIVED or 0,
        "DISPATCH_RECEIVED": so.DISPATCH_RECEIVED or 0,
        "INSTALLATION_RECEIVED": so.INSTALLATION_RECEIVED or 0,
        "PAYMENT_RECEIVED_TOTAL": round(payment_total_received, 2),
        "PAYMENT_PENDING": round(grand - payment_total_received, 2),
        "PAYMENT_PROGRESS_PCT": (
            round(payment_total_received / grand * 100, 1)
            if grand > 0 else 0
        ),
        "SHIPPING_ADDRESS": so.SHIPPING_ADDRESS,
        "BILLING_ADDRESS": so.BILLING_ADDRESS,
        "TERMS_AND_CONDITIONS": so.TERMS_AND_CONDITIONS,
        "NOTES": so.NOTES,
        "PREPARED_BY": so.PREPARED_BY,
        "CONFIRMED_AT": so.CONFIRMED_AT.isoformat() if so.CONFIRMED_AT else None,
        "PRODUCTION_STARTED_AT": (
            so.PRODUCTION_STARTED_AT.isoformat()
            if so.PRODUCTION_STARTED_AT else None
        ),
        "SHIPPED_AT": so.SHIPPED_AT.isoformat() if so.SHIPPED_AT else None,
        "DELIVERED_AT": so.DELIVERED_AT.isoformat() if so.DELIVERED_AT else None,
        "CLOSED_AT": so.CLOSED_AT.isoformat() if so.CLOSED_AT else None,
        "CANCELLED_AT": so.CANCELLED_AT.isoformat() if so.CANCELLED_AT else None,
        "CANCEL_REASON": so.CANCEL_REASON,
        "EMAIL_SENT_AT": so.EMAIL_SENT_AT.isoformat() if so.EMAIL_SENT_AT else None,
        "EMAIL_SENT_COUNT": so.EMAIL_SENT_COUNT or 0,
        "LAST_EMAIL_STATUS": so.LAST_EMAIL_STATUS,
        "VENDOR_ID": so.VENDOR_ID,
        "CREATED_AT": so.CREATED_AT.isoformat() if so.CREATED_AT else None,
        "UPDATED_AT": so.UPDATED_AT.isoformat() if so.UPDATED_AT else None
    }

    if so.CUSTOMER_ID:

        c = db.query(Customer).filter(Customer.ID == so.CUSTOMER_ID).first()

        if c:

            base["CUSTOMER_NAME"] = c.CUSTOMER_NAME

            base["CUSTOMER_CODE"] = c.CUSTOMER_CODE

            base["CUSTOMER_PHONE"] = c.PHONE

            base["CUSTOMER_EMAIL"] = c.EMAIL

            base["CUSTOMER_GST"] = c.GST_NUMBER

            base["CUSTOMER_ADDRESS"] = (
                c.BILLING_ADDRESS or c.ADDRESS or ""
            )

    if so.QUOTATION_ID:

        q = db.query(Quotation).filter(Quotation.ID == so.QUOTATION_ID).first()

        if q:

            base["QUOTATION_NUMBER"] = q.QUOTATION_NUMBER

    if so.PREPARED_BY:

        emp = db.query(Employee).filter(Employee.ID == so.PREPARED_BY).first()

        if emp:

            base["PREPARED_BY_NAME"] = emp.NAME

    if include_lines:

        lines = db.query(SalesOrderLine).filter(
            SalesOrderLine.SO_ID == so.ID
        ).order_by(
            SalesOrderLine.SORT_ORDER,
            SalesOrderLine.ID
        ).all()

        # Enrich with product names + spawned project names
        line_list = []

        for l in lines:

            row = _serialize_line(l)

            if l.PRODUCT_MODEL_ID:

                p = db.query(ProductModel).filter(
                    ProductModel.ID == l.PRODUCT_MODEL_ID
                ).first()

                if p:

                    row["PRODUCT_MODEL_NAME"] = p.MODEL_NAME

                    row["PRODUCT_MODEL_CODE"] = p.MODEL_CODE

            if l.SPAWNED_PROJECT_ID:

                pr = db.query(Project).filter(
                    Project.ID == l.SPAWNED_PROJECT_ID
                ).first()

                if pr:

                    row["SPAWNED_PROJECT_NAME"] = pr.PROJECT_NAME

                    row["SPAWNED_PROJECT_STATUS"] = pr.STATUS

            line_list.append(row)

        base["LINES"] = line_list

    return base


def _build_so_email_html(so: SalesOrder, customer: Customer) -> str:

    inr = lambda n: "Rs. " + "{:,.2f}".format(float(n or 0))

    grand = float(so.GRAND_TOTAL or 0)
    advance_amt = grand * float(so.ADVANCE_PERCENT or 0) / 100
    dispatch_amt = grand * float(so.DISPATCH_PERCENT or 0) / 100
    install_amt = grand * float(so.INSTALLATION_PERCENT or 0) / 100

    advance_due_str = (
        so.ADVANCE_DUE_DATE.strftime("%d %b %Y")
        if so.ADVANCE_DUE_DATE else "at your earliest convenience"
    )

    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f1f5f9; font-family: Arial, sans-serif;">
  <div style="max-width: 660px; margin: 30px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 30px rgba(0,0,0,0.08);">

    <div style="background: linear-gradient(135deg, #C8102E, #8B0B1F); color: white; padding: 24px 28px;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; opacity: 0.9;">
        BVC24 · SALES ORDER — ADVANCE PAYMENT REQUEST
      </div>
      <h1 style="margin: 6px 0 0; font-size: 22px;">{so.SO_NUMBER}</h1>
    </div>

    <div style="padding: 26px 28px; color: #0f172a; line-height: 1.55;">
      <p style="margin: 0 0 14px; font-size: 15px;">Dear <b>{customer.CUSTOMER_NAME}</b>,</p>

      <p style="margin: 0 0 18px; font-size: 14px; color: #475569;">
        Thank you for placing your order with Bharath Vending
        Corporation. Please find your Sales Order details below.
        Production will commence as soon as the advance payment is
        received.
      </p>

      <div style="background:#fef2f2; border-left: 4px solid #C8102E; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
        <table style="width:100%; font-size: 13px; color: #475569;">
          <tr><td>SO Number</td><td style="text-align:right; color:#0f172a; font-weight:700;">{so.SO_NUMBER}</td></tr>
          <tr><td>SO Date</td><td style="text-align:right; color:#0f172a;">{so.SO_DATE}</td></tr>
          <tr><td>Expected Delivery</td><td style="text-align:right; color:#0f172a;">{so.EXPECTED_DELIVERY_DATE or '—'}</td></tr>
          <tr><td style="padding-top:8px; font-size:15px;"><b>Order Total</b></td>
              <td style="text-align:right; padding-top:8px; color:#0f172a; font-size:18px; font-weight:800;">
                {inr(so.GRAND_TOTAL)}
              </td></tr>
        </table>
      </div>

      <!-- Highlighted advance-due call-to-action -->
      <div style="background: linear-gradient(135deg, #fff7ed, #ffedd5); border: 2px solid #F4B324; padding: 18px 20px; border-radius: 10px; margin: 18px 0 22px;">
        <div style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #8B4500; margin-bottom: 6px;">
          💰 ADVANCE PAYMENT DUE
        </div>
        <div style="font-size: 26px; font-weight: 900; color: #C8102E; margin-bottom: 4px;">
          {inr(advance_amt)}
        </div>
        <div style="font-size: 13px; color: #6b4226; margin-bottom: 10px;">
          ({so.ADVANCE_PERCENT}% of order value)
        </div>
        <div style="background: white; padding: 10px 14px; border-radius: 6px; font-size: 13px;">
          <b style="color:#8B0B1F;">Please pay by:</b>
          <span style="color:#0f172a; font-weight: 700;">{advance_due_str}</span>
        </div>
        <p style="margin: 10px 0 0; font-size: 12px; color: #6b4226;">
          Your order will move to <b>CONFIRMED</b> status as soon as we
          receive and verify your advance payment, after which
          production will begin immediately.
        </p>
      </div>

      <div style="background:#f8fafc; padding: 14px 18px; border-radius: 6px; margin-bottom: 18px;">
        <div style="font-size: 12px; font-weight: 700; color: #475569; letter-spacing: 1px; margin-bottom: 8px;">
          PAYMENT SCHEDULE
        </div>
        <table style="width:100%; font-size: 13px; color: #475569;">
          <tr>
            <td style="padding: 4px 0;">1. Advance ({so.ADVANCE_PERCENT}%)</td>
            <td style="text-align:right; color:#0f172a; font-weight:700;">{inr(advance_amt)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">2. On Dispatch ({so.DISPATCH_PERCENT}%)</td>
            <td style="text-align:right; color:#0f172a;">{inr(dispatch_amt)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0;">3. On Installation ({so.INSTALLATION_PERCENT}%)</td>
            <td style="text-align:right; color:#0f172a;">{inr(install_amt)}</td>
          </tr>
          <tr>
            <td style="padding-top: 8px; border-top: 1px solid #e2e8f0; font-weight: 700;">Total</td>
            <td style="padding-top: 8px; border-top: 1px solid #e2e8f0; text-align:right; color:#C8102E; font-weight:800;">{inr(so.GRAND_TOTAL)}</td>
          </tr>
        </table>
      </div>

      <p style="margin: 22px 0 0; font-size: 13px; color: #0f172a;">
        Warm regards,<br>
        <b>Sales Team — BVC24</b>
      </p>
    </div>

    <div style="background:#f8fafc; padding: 14px 28px; font-size: 11px; color: #94a3b8; text-align: center;">
      Bharath Vending Corporation · Chennai, Tamil Nadu, India · www.bvc24.in
    </div>
  </div>
</body>
</html>
"""


def _send_so_email(db: Session, so: SalesOrder) -> tuple:

    customer = db.query(Customer).filter(
        Customer.ID == so.CUSTOMER_ID
    ).first()

    if not customer or not customer.EMAIL:

        return False, "Customer has no EMAIL on file"

    subject = f"Sales Order Confirmation {so.SO_NUMBER} — Bharath Vending Corp."

    html = _build_so_email_html(so, customer)

    return send_alert_email(subject, html, recipient=customer.EMAIL)


# =========================
# SO CRUD
# =========================

@router.post("/sales-orders")
def create_so(
    data: SalesOrderCreate,
    db: Session = Depends(get_db)
):

    customer = db.query(Customer).filter(
        Customer.ID == data.CUSTOMER_ID
    ).first()

    if not customer:

        raise HTTPException(status_code=404, detail="Customer not found")

    # Payment milestones must sum to 100
    pay_total = (
        (data.ADVANCE_PERCENT or 0)
        + (data.DISPATCH_PERCENT or 0)
        + (data.INSTALLATION_PERCENT or 0)
    )

    if abs(pay_total - 100) > 0.01:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Payment milestones must sum to 100% "
                f"(got {pay_total}%)"
            )
        )

    so_date = data.SO_DATE or date.today()

    # Default advance-due = 7 days from SO date if not specified
    advance_due = data.ADVANCE_DUE_DATE or (so_date + timedelta(days=7))

    so = SalesOrder(
        SO_NUMBER=_next_so_number(db),
        CUSTOMER_ID=data.CUSTOMER_ID,
        QUOTATION_ID=data.QUOTATION_ID,
        SO_DATE=so_date,
        EXPECTED_DELIVERY_DATE=data.EXPECTED_DELIVERY_DATE,
        ADVANCE_DUE_DATE=advance_due,
        DISCOUNT_PERCENT=data.DISCOUNT_PERCENT or 0.0,
        TAX_PERCENT=data.TAX_PERCENT if data.TAX_PERCENT is not None else 18.0,
        ADVANCE_PERCENT=data.ADVANCE_PERCENT or 50.0,
        DISPATCH_PERCENT=data.DISPATCH_PERCENT or 40.0,
        INSTALLATION_PERCENT=data.INSTALLATION_PERCENT or 10.0,
        SHIPPING_ADDRESS=data.SHIPPING_ADDRESS,
        BILLING_ADDRESS=data.BILLING_ADDRESS,
        TERMS_AND_CONDITIONS=data.TERMS_AND_CONDITIONS,
        NOTES=data.NOTES,
        PREPARED_BY=data.PREPARED_BY,
        VENDOR_ID=data.VENDOR_ID or 1,
        STATUS="DRAFT"
    )

    db.add(so)

    db.flush()

    for idx, line_data in enumerate(data.LINES):

        line = SalesOrderLine(
            SO_ID=so.ID,
            PRODUCT_MODEL_ID=line_data.PRODUCT_MODEL_ID,
            QUOTATION_LINE_ID=line_data.QUOTATION_LINE_ID,
            DESCRIPTION=line_data.DESCRIPTION,
            HSN_CODE=line_data.HSN_CODE,
            QUANTITY=line_data.QUANTITY or 1.0,
            UNIT=line_data.UNIT or "nos",
            UNIT_PRICE=line_data.UNIT_PRICE or 0.0,
            DISCOUNT_PERCENT=line_data.DISCOUNT_PERCENT or 0.0,
            SORT_ORDER=line_data.SORT_ORDER or idx
        )

        line.LINE_TOTAL = _compute_line_total(line)

        db.add(line)

    db.flush()

    _recompute_totals(db, so)

    _log_activity(
        db, so.ID, "CREATED",
        detail=f"SO {so.SO_NUMBER} created with {len(data.LINES)} line(s)"
    )

    db.commit()

    db.refresh(so)

    return {
        "message": "Sales Order created",
        "sales_order": _serialize_so(db, so)
    }


# ----------------------------------------------------------------
# Admin settings (defined BEFORE /sales-orders/{so_id} so the
# fixed "_settings" path isn't captured by the dynamic id route).
# ----------------------------------------------------------------

@router.get("/sales-orders/_settings")
def get_so_settings(db: Session = Depends(get_db)):
    """Return the current SO automation flags so a future admin UI
    can read + toggle them. Defaults applied when row missing."""

    return {
        "auto_start_production": _bool_setting(
            db, "sales_order.auto_start_production", True
        ),
        "auto_create_pos": _bool_setting(
            db, "sales_order.auto_create_pos", True
        ),
    }


@router.patch("/sales-orders/_settings")
def update_so_settings(
    payload: dict,
    db: Session = Depends(get_db)
):
    """Update one or more SO automation flags. Body accepts:
        { auto_start_production?: bool, auto_create_pos?: bool }
    Each provided field is UPSERTed into the Setting table."""

    if not isinstance(payload, dict):

        raise HTTPException(
            status_code=400,
            detail="Body must be a JSON object with boolean fields"
        )

    if "auto_start_production" in payload:

        _set_setting(
            db,
            "sales_order.auto_start_production",
            "true" if bool(payload["auto_start_production"]) else "false"
        )

    if "auto_create_pos" in payload:

        _set_setting(
            db,
            "sales_order.auto_create_pos",
            "true" if bool(payload["auto_create_pos"]) else "false"
        )

    db.commit()

    return get_so_settings(db)


@router.get("/sales-orders")
def list_sos(
    status: Optional[str] = Query(None),
    customer_id: Optional[int] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(SalesOrder)

    if status:

        q = q.filter(SalesOrder.STATUS == status.upper())

    if customer_id:

        q = q.filter(SalesOrder.CUSTOMER_ID == customer_id)

    if vendor_id:

        q = q.filter(SalesOrder.VENDOR_ID == vendor_id)

    rows = q.order_by(SalesOrder.CREATED_AT.desc()).all()

    return [_serialize_so(db, r, include_lines=False) for r in rows]


@router.get("/sales-orders/{so_id}")
def get_so(
    so_id: int,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="Sales Order not found")

    return _serialize_so(db, so, include_lines=True)


@router.patch("/sales-orders/{so_id}")
def update_so(
    so_id: int,
    data: SalesOrderUpdate,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="Sales Order not found")

    if so.STATUS in ("CLOSED", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit a {so.STATUS} sales order"
        )

    payload = data.dict(exclude_unset=True)

    for field, value in payload.items():

        setattr(so, field, value)

    _recompute_totals(db, so)

    db.commit()

    db.refresh(so)

    return {"message": "SO updated", "sales_order": _serialize_so(db, so)}


@router.delete("/sales-orders/{so_id}")
def delete_so(
    so_id: int,
    force: bool = False,
    db: Session = Depends(get_db)
):
    """Delete a Sales Order and its lines/activity.

    Default behaviour blocks deletion of CONFIRMED / IN_PRODUCTION / etc.
    SOs to protect the audit trail. Pass ?force=true to override (e.g.
    cleaning up test data).

    Spawned projects (via SalesOrderLine.SPAWNED_PROJECT_ID) are NOT
    deleted — they are siblings, not children. Delete the project
    separately from the Projects page if needed.
    """

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="Sales Order not found")

    if not force and so.STATUS not in ("DRAFT", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete a {so.STATUS} SO without force=true. "
                f"Append ?force=true to confirm."
            )
        )

    activity_deleted = db.query(SalesOrderActivity).filter(
        SalesOrderActivity.SO_ID == so_id
    ).delete(synchronize_session=False)

    lines_deleted = db.query(SalesOrderLine).filter(
        SalesOrderLine.SO_ID == so_id
    ).delete(synchronize_session=False)

    db.delete(so)

    db.commit()

    return {
        "message": f"Sales Order {so.SO_NO or so_id} removed.",
        "lines_deleted": lines_deleted,
        "activity_deleted": activity_deleted
    }


# =========================
# Line CRUD
# =========================

@router.post("/sales-orders/{so_id}/lines")
def add_line(
    so_id: int,
    data: SOLineCreate,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS not in ("DRAFT", "CONFIRMED"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit lines on a {so.STATUS} SO"
        )

    line = SalesOrderLine(
        SO_ID=so_id,
        PRODUCT_MODEL_ID=data.PRODUCT_MODEL_ID,
        QUOTATION_LINE_ID=data.QUOTATION_LINE_ID,
        DESCRIPTION=data.DESCRIPTION,
        HSN_CODE=data.HSN_CODE,
        QUANTITY=data.QUANTITY or 1.0,
        UNIT=data.UNIT or "nos",
        UNIT_PRICE=data.UNIT_PRICE or 0.0,
        DISCOUNT_PERCENT=data.DISCOUNT_PERCENT or 0.0,
        SORT_ORDER=data.SORT_ORDER or 0
    )

    line.LINE_TOTAL = _compute_line_total(line)

    db.add(line)

    db.flush()

    _recompute_totals(db, so)

    db.commit()

    db.refresh(line)

    return {"message": "Line added", "line": _serialize_line(line)}


@router.patch("/sales-orders/{so_id}/lines/{line_id}")
def update_line(
    so_id: int,
    line_id: int,
    data: SOLineUpdate,
    db: Session = Depends(get_db)
):

    line = db.query(SalesOrderLine).filter(
        SalesOrderLine.ID == line_id,
        SalesOrderLine.SO_ID == so_id
    ).first()

    if not line:

        raise HTTPException(status_code=404, detail="Line not found")

    for field, value in data.dict(exclude_unset=True).items():

        setattr(line, field, value)

    line.LINE_TOTAL = _compute_line_total(line)

    db.flush()

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    _recompute_totals(db, so)

    db.commit()

    db.refresh(line)

    return {"message": "Line updated", "line": _serialize_line(line)}


@router.delete("/sales-orders/{so_id}/lines/{line_id}")
def delete_line(
    so_id: int,
    line_id: int,
    db: Session = Depends(get_db)
):

    line = db.query(SalesOrderLine).filter(
        SalesOrderLine.ID == line_id,
        SalesOrderLine.SO_ID == so_id
    ).first()

    if not line:

        raise HTTPException(status_code=404, detail="Line not found")

    db.delete(line)

    db.flush()

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    _recompute_totals(db, so)

    db.commit()

    return {"message": "Line removed"}


# =========================
# Workflow
# =========================

@router.post("/sales-orders/{so_id}/confirm")
def confirm_so(
    so_id: int,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS != "DRAFT":

        raise HTTPException(
            status_code=400,
            detail=(
                f"Only DRAFT SOs can be sent for advance payment "
                f"(current: {so.STATUS})"
            )
        )

    # Make sure ADVANCE_DUE_DATE is set — fall back to SO_DATE + 7 days
    if not so.ADVANCE_DUE_DATE:

        so.ADVANCE_DUE_DATE = (so.SO_DATE or date.today()) + timedelta(days=7)

    so.STATUS = "AWAITING_ADVANCE"

    advance_amt = float(so.GRAND_TOTAL or 0) * float(so.ADVANCE_PERCENT or 0) / 100

    _log_activity(
        db, so.ID, "AWAITING_ADVANCE",
        detail=(
            f"Advance payment request sent to customer — "
            f"Rs. {advance_amt:,.2f} due by {so.ADVANCE_DUE_DATE}"
        )
    )

    ok, msg = _send_so_email(db, so)

    so.LAST_EMAIL_STATUS = msg[:200] if msg else None

    if ok:

        so.EMAIL_SENT_AT = datetime.utcnow()

        so.EMAIL_SENT_COUNT = (so.EMAIL_SENT_COUNT or 0) + 1

        _log_activity(db, so.ID, "EMAIL_SENT", detail=f"Advance payment request emailed ({msg})")

    else:

        _log_activity(db, so.ID, "EMAIL_FAILED", detail=f"Email failed: {msg}")

    db.commit()

    db.refresh(so)

    # 📲 Notify MD — order placed, awaiting advance
    from app.services.whatsapp_service import notify_md_safe

    customer = db.query(Customer).filter(Customer.ID == so.CUSTOMER_ID).first()

    notify_md_safe(
        f"📩 *Sales Order — Awaiting Advance — BVC24*\n\n"
        f"📑 *{so.SO_NUMBER}*\n"
        f"🏢 Customer: *{customer.CUSTOMER_NAME if customer else f'#{so.CUSTOMER_ID}'}*\n"
        f"💰 Order Total: *₹{(so.GRAND_TOTAL or 0):,.2f}*\n"
        f"📅 Expected Delivery: {so.EXPECTED_DELIVERY_DATE or 'TBD'}\n\n"
        f"💳 Advance Requested:\n"
        f"  • Amount ({so.ADVANCE_PERCENT}%): *₹{advance_amt:,.2f}*\n"
        f"  • Due By: *{so.ADVANCE_DUE_DATE}*\n\n"
        f"Status will flip to *CONFIRMED* once the advance is "
        f"received and recorded."
    )

    return {
        "message": (
            "Advance payment request sent to customer"
            + (" + email delivered" if ok else " (email failed)")
        ),
        "email_sent": ok,
        "sales_order": _serialize_so(db, so, include_lines=False)
    }


@router.post("/sales-orders/{so_id}/start-production")
def start_production(
    so_id: int,
    db: Session = Depends(get_db)
):
    """Spawn one Project per SO line with PRODUCT_MODEL_ID set, then
    flip status to IN_PRODUCTION. Lines without a product link are
    skipped (free-text only)."""

    from app.services.project_from_product_service import (
        create_project_from_product
    )

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS != "CONFIRMED":

        raise HTTPException(
            status_code=400,
            detail=(
                f"Production starts from a CONFIRMED SO "
                f"(current: {so.STATUS}). Confirm the SO first."
            )
        )

    lines = db.query(SalesOrderLine).filter(
        SalesOrderLine.SO_ID == so_id
    ).all()

    projects_spawned = 0

    skipped = 0

    project_summaries = []

    for line in lines:

        if line.SPAWNED_PROJECT_ID:

            # Already spawned — leave it alone
            continue

        if not line.PRODUCT_MODEL_ID:

            skipped += 1

            continue

        try:

            result = create_project_from_product(
                db,
                customer_id=so.CUSTOMER_ID,
                product_model_id=line.PRODUCT_MODEL_ID,
                quantity=int(line.QUANTITY or 1),
                priority="MEDIUM",
                target_date=so.EXPECTED_DELIVERY_DATE,
                notes=(
                    f"Auto-spawned from {so.SO_NUMBER} (line #{line.ID}). "
                    f"{line.DESCRIPTION}"
                ),
                vendor_id=so.VENDOR_ID or 1
            )

            project_id = result.get("project", {}).get("ID") or result.get("PROJECT_ID")

            if project_id:

                line.SPAWNED_PROJECT_ID = project_id

                projects_spawned += 1

                project_summaries.append({
                    "line_id": line.ID,
                    "project_id": project_id,
                    "product": line.DESCRIPTION
                })

        except Exception as e:

            _log_activity(
                db, so.ID, "PROJECTS_SPAWNED",
                detail=f"Project spawn failed for line #{line.ID}: {e}"
            )

            skipped += 1

    if projects_spawned == 0:

        raise HTTPException(
            status_code=400,
            detail=(
                "No projects were spawned. Make sure SO lines have a "
                "PRODUCT_MODEL_ID set so the workflow knows what to build."
            )
        )

    so.STATUS = "IN_PRODUCTION"

    so.PRODUCTION_STARTED_AT = datetime.utcnow()

    _log_activity(
        db, so.ID, "PROJECTS_SPAWNED",
        detail=(
            f"{projects_spawned} project(s) created"
            + (f", {skipped} line(s) skipped" if skipped else "")
        )
    )

    db.commit()

    db.refresh(so)

    return {
        "message": (
            f"Production started — {projects_spawned} project(s) spawned"
            + (f", {skipped} skipped" if skipped else "")
        ),
        "projects_spawned": projects_spawned,
        "skipped": skipped,
        "projects": project_summaries,
        "sales_order": _serialize_so(db, so)
    }


@router.post("/sales-orders/{so_id}/ship")
def ship_so(
    so_id: int,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS != "IN_PRODUCTION":

        raise HTTPException(
            status_code=400,
            detail=f"Cannot ship a {so.STATUS} SO (must be IN_PRODUCTION)"
        )

    so.STATUS = "SHIPPED"

    so.SHIPPED_AT = datetime.utcnow()

    _log_activity(db, so.ID, "SHIPPED", detail="Goods dispatched to customer")

    db.commit()

    db.refresh(so)

    return {"message": "SO marked as shipped", "sales_order": _serialize_so(db, so, False)}


@router.post("/sales-orders/{so_id}/deliver")
def deliver_so(
    so_id: int,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS != "SHIPPED":

        raise HTTPException(
            status_code=400,
            detail=f"Cannot deliver a {so.STATUS} SO (must be SHIPPED)"
        )

    so.STATUS = "DELIVERED"

    so.DELIVERED_AT = datetime.utcnow()

    _log_activity(db, so.ID, "DELIVERED", detail="Customer signed acceptance")

    db.commit()

    db.refresh(so)

    return {"message": "SO marked as delivered", "sales_order": _serialize_so(db, so, False)}


@router.post("/sales-orders/{so_id}/close")
def close_so(
    so_id: int,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS not in ("DELIVERED", "SHIPPED"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot close a {so.STATUS} SO"
        )

    so.STATUS = "CLOSED"

    so.CLOSED_AT = datetime.utcnow()

    _log_activity(db, so.ID, "CLOSED", detail="Contract closed — final payment received")

    db.commit()

    db.refresh(so)

    return {"message": "SO closed", "sales_order": _serialize_so(db, so, False)}


@router.post("/sales-orders/{so_id}/cancel")
def cancel_so(
    so_id: int,
    data: SOCancellation,
    db: Session = Depends(get_db)
):

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS in ("CLOSED", "CANCELLED"):

        raise HTTPException(
            status_code=400,
            detail=f"SO already {so.STATUS}"
        )

    so.STATUS = "CANCELLED"

    so.CANCELLED_AT = datetime.utcnow()

    so.CANCEL_REASON = data.CANCEL_REASON

    _log_activity(
        db, so.ID, "CANCELLED",
        detail=data.CANCEL_REASON or "SO cancelled"
    )

    db.commit()

    db.refresh(so)

    return {"message": "SO cancelled", "sales_order": _serialize_so(db, so, False)}


@router.post("/sales-orders/{so_id}/payment")
def record_payment(
    so_id: int,
    data: SOPaymentRecord,
    db: Session = Depends(get_db)
):
    """Record a payment milestone receipt — advance, dispatch, or
    installation. Adds to the milestone's running total."""

    so = db.query(SalesOrder).filter(SalesOrder.ID == so_id).first()

    if not so:

        raise HTTPException(status_code=404, detail="SO not found")

    if so.STATUS in ("CANCELLED",):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot record payment on a {so.STATUS} SO"
        )

    milestone = data.MILESTONE.upper()

    if milestone not in ("ADVANCE", "DISPATCH", "INSTALLATION"):

        raise HTTPException(
            status_code=400,
            detail="MILESTONE must be ADVANCE, DISPATCH, or INSTALLATION"
        )

    if data.AMOUNT <= 0:

        raise HTTPException(status_code=400, detail="Amount must be positive")

    if milestone == "ADVANCE":

        so.ADVANCE_RECEIVED = (so.ADVANCE_RECEIVED or 0) + data.AMOUNT

    elif milestone == "DISPATCH":

        so.DISPATCH_RECEIVED = (so.DISPATCH_RECEIVED or 0) + data.AMOUNT

    elif milestone == "INSTALLATION":

        so.INSTALLATION_RECEIVED = (so.INSTALLATION_RECEIVED or 0) + data.AMOUNT

    _log_activity(
        db, so.ID, "PAYMENT_RECEIVED",
        detail=(
            f"{milestone}: Rs. {data.AMOUNT:,.2f} received"
            + (f" — {data.NOTES}" if data.NOTES else "")
        )
    )

    # ----- Auto-confirm gate -----
    # If the SO is AWAITING_ADVANCE and the advance is now fully
    # paid, flip the status to CONFIRMED automatically. This is the
    # payment-gated trigger the user asked for.
    grand = float(so.GRAND_TOTAL or 0)

    required_advance = round(grand * float(so.ADVANCE_PERCENT or 0) / 100, 2)

    advance_paid_total = float(so.ADVANCE_RECEIVED or 0)

    auto_confirmed = False

    if (
        so.STATUS == "AWAITING_ADVANCE"
        and required_advance > 0
        and advance_paid_total + 0.01 >= required_advance
    ):

        so.STATUS = "CONFIRMED"

        so.CONFIRMED_AT = datetime.utcnow()

        auto_confirmed = True

        _log_activity(
            db, so.ID, "CONFIRMED",
            detail=(
                f"Auto-confirmed — advance fully received "
                f"(Rs. {advance_paid_total:,.2f} / Rs. {required_advance:,.2f})"
            )
        )

    db.commit()

    db.refresh(so)

    # ---- Auto-start-production hook ----
    # If the auto-confirm just fired AND the setting flag is on,
    # immediately spawn projects + tasks + (optionally) POs without
    # waiting for an admin to click 'Start Production'. The helper
    # is best-effort: any failure is logged to activity but the
    # payment response still succeeds.
    auto_started = False

    auto_start_summary = None

    if (
        auto_confirmed
        and _bool_setting(db, "sales_order.auto_start_production", True)
    ):

        auto_start_summary = _auto_start_production_for_so(
            db, so,
            actor_type="SYSTEM",
            actor_name="record_payment-auto-confirm"
        )

        if auto_start_summary.get("ok") and auto_start_summary.get("projects_spawned", 0) > 0:

            auto_started = True

        db.commit()

        db.refresh(so)

    # 📲 Notify MD if we just flipped to CONFIRMED
    if auto_confirmed:

        try:

            from app.services.whatsapp_service import notify_md_safe

            customer = db.query(Customer).filter(
                Customer.ID == so.CUSTOMER_ID
            ).first()

            extra = ""

            if auto_started:

                spawned = auto_start_summary.get("projects_spawned", 0)

                pos = auto_start_summary.get("pos_created", 0)

                extra = (
                    f"\n\n🏭 Auto-started: {spawned} project(s) spawned"
                    + (f", {pos} PO(s) auto-generated" if pos else "")
                )

            notify_md_safe(
                f"✅ *Sales Order CONFIRMED — Advance Received*\n\n"
                f"📑 *{so.SO_NUMBER}*\n"
                f"🏢 Customer: *{customer.CUSTOMER_NAME if customer else f'#{so.CUSTOMER_ID}'}*\n"
                f"💰 Advance Received: *₹{advance_paid_total:,.2f}*\n"
                f"📦 Order Total: ₹{grand:,.2f}"
                + extra
            )

        except Exception:

            pass

    return {
        "message": (
            f"{milestone} payment of Rs. {data.AMOUNT:,.2f} recorded"
            + (" — SO auto-confirmed" if auto_confirmed else "")
            + (
                f" — production auto-started ("
                f"{auto_start_summary.get('projects_spawned', 0)} project(s))"
                if auto_started else ""
            )
        ),
        "auto_confirmed": auto_confirmed,
        "auto_started": auto_started,
        "auto_start_summary": auto_start_summary,
        "sales_order": _serialize_so(db, so, include_lines=False)
    }


# =========================
# From-Quotation
# =========================

@router.post("/sales-orders/from-quotation")
def sales_order_from_quotation(
    data: SOFromQuotation,
    db: Session = Depends(get_db)
):
    """Convert an APPROVED quotation into a DRAFT sales order.
    Copies header info + every line. Refuses if the quotation isn't
    APPROVED, or has already been converted."""

    quot = db.query(Quotation).filter(
        Quotation.ID == data.QUOTATION_ID
    ).first()

    if not quot:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if quot.STATUS not in ("APPROVED",):

        raise HTTPException(
            status_code=400,
            detail=(
                f"Only APPROVED quotations can be converted "
                f"(current: {quot.STATUS})"
            )
        )

    existing = db.query(SalesOrder).filter(
        SalesOrder.QUOTATION_ID == quot.ID
    ).first()

    if existing:

        raise HTTPException(
            status_code=400,
            detail=(
                f"This quotation was already converted to "
                f"{existing.SO_NUMBER}."
            )
        )

    pay_total = (
        (data.ADVANCE_PERCENT or 0)
        + (data.DISPATCH_PERCENT or 0)
        + (data.INSTALLATION_PERCENT or 0)
    )

    if abs(pay_total - 100) > 0.01:

        raise HTTPException(
            status_code=400,
            detail=f"Payment milestones must sum to 100% (got {pay_total}%)"
        )

    customer = db.query(Customer).filter(
        Customer.ID == quot.CUSTOMER_ID
    ).first()

    so = SalesOrder(
        SO_NUMBER=_next_so_number(db),
        CUSTOMER_ID=quot.CUSTOMER_ID,
        QUOTATION_ID=quot.ID,
        SO_DATE=date.today(),
        EXPECTED_DELIVERY_DATE=data.EXPECTED_DELIVERY_DATE,
        DISCOUNT_PERCENT=quot.DISCOUNT_PERCENT or 0,
        TAX_PERCENT=quot.TAX_PERCENT or 18,
        ADVANCE_PERCENT=data.ADVANCE_PERCENT or 50,
        DISPATCH_PERCENT=data.DISPATCH_PERCENT or 40,
        INSTALLATION_PERCENT=data.INSTALLATION_PERCENT or 10,
        SHIPPING_ADDRESS=(customer.SHIPPING_ADDRESS if customer else None),
        BILLING_ADDRESS=(customer.BILLING_ADDRESS if customer else None),
        TERMS_AND_CONDITIONS=quot.TERMS_AND_CONDITIONS,
        NOTES=(
            data.NOTES
            or f"Auto-generated from {quot.QUOTATION_NUMBER}"
        ),
        PREPARED_BY=quot.PREPARED_BY,
        VENDOR_ID=data.VENDOR_ID or quot.VENDOR_ID or 1,
        STATUS="DRAFT"
    )

    db.add(so)

    db.flush()

    # Copy lines 1-to-1
    quot_lines = db.query(QuotationLine).filter(
        QuotationLine.QUOTATION_ID == quot.ID
    ).order_by(QuotationLine.SORT_ORDER, QuotationLine.ID).all()

    for idx, ql in enumerate(quot_lines):

        so_line = SalesOrderLine(
            SO_ID=so.ID,
            PRODUCT_MODEL_ID=ql.PRODUCT_MODEL_ID,
            QUOTATION_LINE_ID=ql.ID,
            DESCRIPTION=ql.DESCRIPTION,
            HSN_CODE=ql.HSN_CODE,
            QUANTITY=ql.QUANTITY or 1,
            UNIT=ql.UNIT or "nos",
            UNIT_PRICE=ql.UNIT_PRICE or 0,
            DISCOUNT_PERCENT=ql.DISCOUNT_PERCENT or 0,
            SORT_ORDER=idx
        )

        so_line.LINE_TOTAL = _compute_line_total(so_line)

        db.add(so_line)

    db.flush()

    _recompute_totals(db, so)

    _log_activity(
        db, so.ID, "CREATED",
        detail=(
            f"Auto-converted from quotation {quot.QUOTATION_NUMBER} "
            f"({len(quot_lines)} line(s))"
        )
    )

    # Mark the source quotation as CONVERTED for traceability
    quot.STATUS = "CONVERTED"

    db.commit()

    db.refresh(so)

    # 📲 Notify MD — quotation has converted, this is the big win
    from app.services.whatsapp_service import notify_md_safe

    notify_md_safe(
        f"🏆 *Quotation CONVERTED to Sales Order — BVC24*\n\n"
        f"📑 *{so.SO_NUMBER}*\n"
        f"📄 From quotation: {quot.QUOTATION_NUMBER}\n"
        f"🏢 Customer: *{customer.CUSTOMER_NAME if customer else f'#{so.CUSTOMER_ID}'}*\n"
        f"💰 Grand Total: *₹{(so.GRAND_TOTAL or 0):,.2f}*\n"
        f"📅 Expected Delivery: {so.EXPECTED_DELIVERY_DATE or 'TBD'}\n\n"
        f"Status: DRAFT — review & confirm in the SO module to "
        f"trigger production."
    )

    return {
        "message": (
            f"Created {so.SO_NUMBER} from {quot.QUOTATION_NUMBER}"
        ),
        "sales_order": _serialize_so(db, so)
    }


# =========================
# Activity
# =========================

@router.get("/sales-orders/{so_id}/activity")
def get_activity(
    so_id: int,
    db: Session = Depends(get_db)
):

    rows = db.query(SalesOrderActivity).filter(
        SalesOrderActivity.SO_ID == so_id
    ).order_by(SalesOrderActivity.CREATED_AT.desc()).all()

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


@router.delete("/sales-orders/{so_id}/activity/{activity_id}")
def delete_activity_row(
    so_id: int,
    activity_id: int,
    db: Session = Depends(get_db)
):

    row = db.query(SalesOrderActivity).filter(
        SalesOrderActivity.ID == activity_id,
        SalesOrderActivity.SO_ID == so_id
    ).first()

    if not row:

        raise HTTPException(status_code=404, detail="Activity row not found")

    db.delete(row)

    db.commit()

    return {"message": "Activity row removed"}
