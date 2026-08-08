"""
Phase 3 — Quotation Module routes.

Endpoints:
  POST   /quotations                    Create quotation (header + lines)
  GET    /quotations                    List (with optional filters)
  GET    /quotations/{id}               Detail (header + lines + customer + sales)
  PATCH  /quotations/{id}               Update header
  DELETE /quotations/{id}               Delete (only if DRAFT)

  POST   /quotations/{id}/lines         Add a line
  PATCH  /quotations/{id}/lines/{lid}   Update a line
  DELETE /quotations/{id}/lines/{lid}   Remove a line

  POST   /quotations/{id}/send          Mark SENT (records SENT_AT)
  POST   /quotations/{id}/approve       Mark APPROVED
  POST   /quotations/{id}/reject        Mark REJECTED (with reason)

  POST   /quotations/from-requirements  Auto-create from requirement IDs
                                        — uses BOM-based pricing if available

  POST   /quotations/auto-generate      One-shot: pick all active reqs
                                        for a customer, build draft +
                                        optionally email it.

  GET    /quotations/dashboard-stats    Counters for the quotation
                                        dashboard tiles.

  GET    /quotations/auto-price         Compute suggested price from a
                                        product's BOM + margin
"""

import os
import re
import secrets

from datetime import datetime, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    Customer,
    CustomerRequirement,
    Employee,
    ProductModel,
    BOMItem,
    Inventory,
    Quotation,
    QuotationLine,
    QuotationActivity,
    QuotationNegotiation,
    SalesOrder,
    Setting
)

from app.services.quotation_negotiation_service import (
    negotiate as ai_negotiate
)

from app.services.email_service import send_alert_email

from app.services.quotation_pricing import (
    compute_unit_price_from_bom,
    get_product_pricing_breakdown
)

from app.schemas.quotation_schema import (
    QuotationCreate,
    QuotationUpdate,
    QuotationLineCreate,
    QuotationLineUpdate,
    QuotationRejection,
    QuotationFromRequirement,
    AutoGenerateQuotation
)


router = APIRouter()


# =========================
# Helpers
# =========================

def _log_activity(
    db: Session,
    quotation_id: int,
    event_type: str,
    detail: str = None,
    actor_type: str = "SYSTEM",
    actor_name: str = None
):
    """Append a row to the quotation_activity timeline. Caller commits."""

    db.add(QuotationActivity(
        QUOTATION_ID=quotation_id,
        EVENT_TYPE=event_type,
        EVENT_DETAIL=detail,
        ACTOR_TYPE=actor_type,
        ACTOR_NAME=actor_name
    ))


def _ensure_public_token(q: Quotation) -> None:
    """Generate a long random token if the quotation doesn't have one
    yet. Same token reused across resends so shared links stay valid."""

    if not q.PUBLIC_TOKEN:

        q.PUBLIC_TOKEN = secrets.token_urlsafe(24)


# =========================
# Setting helpers (auto-SO + discount policy)
# =========================

AUTO_CREATE_SO_KEY = "quotation.auto_create_so"
MAX_DISCOUNT_KEY = "quotation.max_discount_percent"


def _get_setting(db: Session, key: str, default: str = "") -> str:
    """Fetch a raw setting value; returns `default` if not present."""

    row = db.query(Setting).filter(Setting.KEY == key).first()

    if not row or row.VALUE is None:

        return default

    return row.VALUE


def _set_setting(db: Session, key: str, value: str) -> None:
    """UPSERT a setting row. Caller commits."""

    row = db.query(Setting).filter(Setting.KEY == key).first()

    if row:

        row.VALUE = value

        row.UPDATED_AT = datetime.utcnow()

    else:

        db.add(Setting(
            KEY=key,
            VALUE=value,
            UPDATED_AT=datetime.utcnow()
        ))


def _auto_create_so_enabled(db: Session) -> bool:
    """Read the quotation.auto_create_so flag. Defaults to True if
    the row is missing (the startup seed will normally create it)."""

    raw = _get_setting(db, AUTO_CREATE_SO_KEY, "true")

    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def seed_quotation_settings(db: Session) -> None:
    """Idempotent UPSERT for the auto-SO + max-discount flags.
    Called once at app startup from main.py. Existing values are
    preserved — only missing rows get a default."""

    if not db.query(Setting).filter(Setting.KEY == AUTO_CREATE_SO_KEY).first():

        db.add(Setting(
            KEY=AUTO_CREATE_SO_KEY,
            VALUE="true",
            UPDATED_AT=datetime.utcnow()
        ))

    if not db.query(Setting).filter(Setting.KEY == MAX_DISCOUNT_KEY).first():

        db.add(Setting(
            KEY=MAX_DISCOUNT_KEY,
            VALUE="10",
            UPDATED_AT=datetime.utcnow()
        ))

    db.commit()


def _auto_create_so_for_quotation(
    db: Session,
    q: Quotation,
    actor_type: str = "SYSTEM",
    actor_name: str = None
) -> Optional[dict]:
    """Best-effort: create a DRAFT Sales Order from a freshly APPROVED
    quotation, mirroring the logic of POST /sales-orders/from-quotation.

    NEVER raises — failures are logged to QuotationActivity and the
    function returns None so the caller's approval flow stays green.

    Returns: { "ID": int, "SO_NUMBER": str } on success, else None.
    """

    # Lazy import to avoid a circular import at module load time —
    # sales_order.py imports nothing from quotation.py, but importing
    # at the top would couple their load order. Local import is cheap
    # because Python caches modules in sys.modules.
    try:

        from app.routes.sales_order import (
            _next_so_number,
            _compute_line_total as _so_compute_line_total,
            _recompute_totals as _so_recompute_totals,
            _log_activity as _so_log_activity
        )

        from app.models.models import (
            SalesOrderLine
        )

    except Exception as exc:

        _log_activity(
            db, q.ID, "AUTO_SO_FAILED",
            detail=f"Import error: {exc}",
            actor_type=actor_type,
            actor_name=actor_name
        )

        return None

    try:

        # Race-condition guard: if an SO already exists for this
        # quotation (admin manual convert beat us, or this is a
        # double-fire), skip creation gracefully.
        existing = db.query(SalesOrder).filter(
            SalesOrder.QUOTATION_ID == q.ID
        ).first()

        if existing:

            _log_activity(
                db, q.ID, "AUTO_SO_SKIPPED",
                detail=(
                    f"SO {existing.SO_NUMBER} already exists "
                    f"for this quotation."
                ),
                actor_type=actor_type,
                actor_name=actor_name
            )

            return {
                "ID": existing.ID,
                "SO_NUMBER": existing.SO_NUMBER
            }

        customer = db.query(Customer).filter(
            Customer.ID == q.CUSTOMER_ID
        ).first()

        so = SalesOrder(
            SO_NUMBER=_next_so_number(db),
            CUSTOMER_ID=q.CUSTOMER_ID,
            QUOTATION_ID=q.ID,
            SO_DATE=date.today(),
            EXPECTED_DELIVERY_DATE=None,
            DISCOUNT_PERCENT=q.DISCOUNT_PERCENT or 0,
            TAX_PERCENT=q.TAX_PERCENT or 18,
            ADVANCE_PERCENT=50,
            DISPATCH_PERCENT=40,
            INSTALLATION_PERCENT=10,
            SHIPPING_ADDRESS=(
                customer.SHIPPING_ADDRESS if customer else None
            ),
            BILLING_ADDRESS=(
                customer.BILLING_ADDRESS if customer else None
            ),
            TERMS_AND_CONDITIONS=q.TERMS_AND_CONDITIONS,
            NOTES=f"Auto-created from approved quotation {q.QUOTATION_NUMBER}",
            PREPARED_BY=q.PREPARED_BY,
            VENDOR_ID=q.VENDOR_ID or 1,
            STATUS="DRAFT"
        )

        db.add(so)

        db.flush()

        # Copy lines 1-to-1
        quot_lines = db.query(QuotationLine).filter(
            QuotationLine.QUOTATION_ID == q.ID
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

            so_line.LINE_TOTAL = _so_compute_line_total(so_line)

            db.add(so_line)

        db.flush()

        _so_recompute_totals(db, so)

        _so_log_activity(
            db, so.ID, "CREATED",
            detail=(
                f"Auto-created from approved quotation "
                f"{q.QUOTATION_NUMBER} ({len(quot_lines)} line(s))"
            ),
            actor_type=actor_type,
            actor_name=actor_name
        )

        _log_activity(
            db, q.ID, "AUTO_SO_CREATED",
            detail=(
                f"Auto-created Sales Order {so.SO_NUMBER} "
                f"on quotation approval."
            ),
            actor_type=actor_type,
            actor_name=actor_name
        )

        db.commit()

        db.refresh(so)

        # Best-effort MD notification — never let WhatsApp failures
        # bubble up and break the approve flow.
        try:

            from app.services.whatsapp_service import notify_md_safe

            notify_md_safe(
                f"AUTO Sales Order created — BVC24\n\n"
                f"SO: *{so.SO_NUMBER}* (DRAFT)\n"
                f"From quotation: {q.QUOTATION_NUMBER}\n"
                f"Customer: *"
                f"{customer.CUSTOMER_NAME if customer else f'#{so.CUSTOMER_ID}'}*\n"
                f"Grand Total: Rs. {(so.GRAND_TOTAL or 0):,.2f}\n\n"
                f"Review & confirm in the SO module to trigger production."
            )

        except Exception as exc_wa:

            # Already committed — log a non-fatal warning row.
            try:

                _log_activity(
                    db, q.ID, "AUTO_SO_WHATSAPP_FAILED",
                    detail=f"WhatsApp notify failed: {exc_wa}",
                    actor_type=actor_type,
                    actor_name=actor_name
                )

                db.commit()

            except Exception:

                db.rollback()

        return {
            "ID": so.ID,
            "SO_NUMBER": so.SO_NUMBER
        }

    except Exception as exc:

        # Roll back the half-built SO so the DB stays clean, then
        # log the failure on the quotation timeline. Never re-raise.
        try:

            db.rollback()

        except Exception:

            pass

        try:

            _log_activity(
                db, q.ID, "AUTO_SO_FAILED",
                detail=f"Auto-SO creation error: {exc}",
                actor_type=actor_type,
                actor_name=actor_name
            )

            db.commit()

        except Exception:

            db.rollback()

        return None


def _public_url(token: str) -> str:
    """Public URL the customer opens. Uses FRONTEND_BASE_URL if set,
    otherwise falls back to the dev server."""

    base = os.getenv("FRONTEND_BASE_URL", "").rstrip("/")

    if not base:

        base = "http://localhost:5173"

    return f"{base}/q/{token}"


def _build_quotation_email_html(q: Quotation, customer: Customer, public_link: str) -> str:
    """Customer-facing HTML body for the quotation email."""

    inr = (
        lambda n: "Rs. " + ("{:,.2f}".format(float(n or 0)))
    )

    return f"""
<!DOCTYPE html>
<html>
<body style="margin:0; padding:0; background:#f1f5f9; font-family: Arial, sans-serif;">
  <div style="max-width: 640px; margin: 30px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 6px 30px rgba(0,0,0,0.08);">

    <div style="background: linear-gradient(135deg, #0ea5e9, #6366f1); color: white; padding: 24px 28px;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; opacity: 0.9;">
        BVC24 · BHARATH VENDING CORPORATION
      </div>
      <h1 style="margin: 6px 0 0; font-size: 22px;">
        Quotation {q.QUOTATION_NUMBER}
      </h1>
    </div>

    <div style="padding: 26px 28px; color: #0f172a; line-height: 1.55;">

      <p style="margin: 0 0 14px; font-size: 15px;">
        Dear <b>{customer.CUSTOMER_NAME}</b>,
      </p>

      <p style="margin: 0 0 18px; font-size: 14px; color: #475569;">
        Thank you for your interest in Bharath Vending Corporation.
        Please find attached our quotation for your requirements:
      </p>

      <div style="background:#f8fafc; border-left: 4px solid #0ea5e9; padding: 14px 18px; border-radius: 6px; margin-bottom: 20px;">
        <table style="width:100%; font-size: 13px; color: #475569;">
          <tr><td>Quotation No</td><td style="text-align:right; color:#0f172a; font-weight:700;">{q.QUOTATION_NUMBER}</td></tr>
          <tr><td>Date</td><td style="text-align:right; color:#0f172a;">{q.QUOTATION_DATE}</td></tr>
          <tr><td>Valid Until</td><td style="text-align:right; color:#0f172a;">{q.EXPIRY_DATE}</td></tr>
          <tr><td style="padding-top:8px; font-size:15px;"><b>Grand Total</b></td>
              <td style="text-align:right; padding-top:8px; color:#047857; font-size:18px; font-weight:800;">
                {inr(q.GRAND_TOTAL)}
              </td></tr>
        </table>
      </div>

      <div style="text-align:center; margin: 22px 0;">
        <a href="{public_link}" style="background: linear-gradient(135deg, #06b6d4, #6366f1); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 800; font-size: 14px; letter-spacing: 0.5px; display: inline-block;">
          📄 View Quotation & Download PDF
        </a>
      </div>

      <p style="margin: 14px 0; font-size: 12px; color: #94a3b8; text-align: center;">
        Or copy this link: <span style="color:#475569;">{public_link}</span>
      </p>

      <hr style="border:none; border-top:1px solid #e2e8f0; margin: 22px 0;">

      <p style="margin: 0 0 8px; font-size: 13px; color: #475569;">
        If you have any questions or need clarifications, please reply
        to this email or call us at <b>+91 90000 12345</b>.
      </p>

      <p style="margin: 20px 0 0; font-size: 13px; color: #0f172a;">
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


def _next_quotation_number(db: Session, vendor_id: int) -> str:
    """Generate next quotation number: QUOT-YYYY-NNNN scoped to year."""

    year = datetime.utcnow().year

    prefix = f"QUOT-{year}-"

    last = db.query(Quotation).filter(
        Quotation.QUOTATION_NUMBER.like(f"{prefix}%")
    ).order_by(Quotation.QUOTATION_NUMBER.desc()).first()

    if not last or not last.QUOTATION_NUMBER:

        return f"{prefix}0001"

    try:

        n = int(last.QUOTATION_NUMBER.split("-")[-1])

    except (ValueError, IndexError):

        n = 0

    return f"{prefix}{n + 1:04d}"


def _compute_line_total(line: QuotationLine) -> float:
    """LINE_TOTAL = QTY * UNIT_PRICE * (1 - DISCOUNT/100)."""

    qty = float(line.QUANTITY or 0)

    price = float(line.UNIT_PRICE or 0)

    disc = float(line.DISCOUNT_PERCENT or 0)

    return round(qty * price * (1.0 - disc / 100.0), 2)


def _recompute_quotation_totals(db: Session, quotation: Quotation) -> None:
    """Recompute SUBTOTAL / DISCOUNT_AMOUNT / TAX_AMOUNT / GRAND_TOTAL."""

    lines = db.query(QuotationLine).filter(
        QuotationLine.QUOTATION_ID == quotation.ID
    ).all()

    subtotal = sum(_compute_line_total(l) for l in lines)

    quotation.SUBTOTAL = round(subtotal, 2)

    disc_pct = float(quotation.DISCOUNT_PERCENT or 0)

    quotation.DISCOUNT_AMOUNT = round(subtotal * disc_pct / 100.0, 2)

    taxable = subtotal - quotation.DISCOUNT_AMOUNT

    tax_pct = float(quotation.TAX_PERCENT or 0)

    quotation.TAX_AMOUNT = round(taxable * tax_pct / 100.0, 2)

    quotation.GRAND_TOTAL = round(taxable + quotation.TAX_AMOUNT, 2)


def _set_expiry(q: Quotation) -> None:

    if q.QUOTATION_DATE and q.VALIDITY_DAYS:

        q.EXPIRY_DATE = q.QUOTATION_DATE + timedelta(days=q.VALIDITY_DAYS)


def _bom_cost_per_unit(db: Session, product_model_id: int, vendor_id: int) -> float:
    """Compute raw material cost for ONE unit of a product from its BOM.

    Looks up Inventory.UNIT_PRICE for each BOMItem.PRODUCT_ID.
    Missing prices contribute 0 (we don't fail loudly — better to
    return a low estimate than throw)."""

    rows = db.query(BOMItem).filter(
        BOMItem.PRODUCT_MODEL_ID == product_model_id
    ).all()

    if not rows:

        return 0.0

    material_ids = [r.PRODUCT_ID for r in rows if r.PRODUCT_ID]

    price_by_mat = {}

    if material_ids:

        invs = db.query(Inventory).filter(
            Inventory.PRODUCT_ID.in_(material_ids),
            Inventory.VENDOR_ID == vendor_id
        ).all()

        for inv in invs:

            # If a material has multiple inventory rows, keep the
            # latest (max) price — a safer estimate for quoting.
            current = price_by_mat.get(inv.PRODUCT_ID, 0.0)

            if (inv.UNIT_PRICE or 0) > current:

                price_by_mat[inv.PRODUCT_ID] = inv.UNIT_PRICE or 0.0

    total = 0.0

    for r in rows:

        qty = float(r.QUANTITY or 0)

        price = price_by_mat.get(r.PRODUCT_ID, 0.0) if r.PRODUCT_ID else 0.0

        total += qty * price

    return round(total, 2)


def _serialize_line(l: QuotationLine) -> dict:

    return {
        "ID": l.ID,
        "QUOTATION_ID": l.QUOTATION_ID,
        "PRODUCT_MODEL_ID": l.PRODUCT_MODEL_ID,
        "REQUIREMENT_ID": l.REQUIREMENT_ID,
        "DESCRIPTION": l.DESCRIPTION,
        "HSN_CODE": l.HSN_CODE,
        "QUANTITY": l.QUANTITY,
        "UNIT": l.UNIT,
        "UNIT_PRICE": l.UNIT_PRICE,
        "DISCOUNT_PERCENT": l.DISCOUNT_PERCENT,
        "LINE_TOTAL": l.LINE_TOTAL,
        "SORT_ORDER": l.SORT_ORDER
    }


def _serialize_quotation(
    db: Session, q: Quotation, include_lines: bool = True
) -> dict:

    base = {
        "ID": q.ID,
        "QUOTATION_NUMBER": q.QUOTATION_NUMBER,
        "CUSTOMER_ID": q.CUSTOMER_ID,
        "QUOTATION_DATE": (
            q.QUOTATION_DATE.isoformat() if q.QUOTATION_DATE else None
        ),
        "VALIDITY_DAYS": q.VALIDITY_DAYS,
        "EXPIRY_DATE": q.EXPIRY_DATE.isoformat() if q.EXPIRY_DATE else None,
        "STATUS": q.STATUS,
        "SUBTOTAL": q.SUBTOTAL,
        "DISCOUNT_PERCENT": q.DISCOUNT_PERCENT,
        "DISCOUNT_AMOUNT": q.DISCOUNT_AMOUNT,
        "TAX_PERCENT": q.TAX_PERCENT,
        "TAX_AMOUNT": q.TAX_AMOUNT,
        "GRAND_TOTAL": q.GRAND_TOTAL,
        "TERMS_AND_CONDITIONS": q.TERMS_AND_CONDITIONS,
        "NOTES": q.NOTES,
        "PREPARED_BY": q.PREPARED_BY,
        "SENT_AT": q.SENT_AT.isoformat() if q.SENT_AT else None,
        "APPROVED_AT": q.APPROVED_AT.isoformat() if q.APPROVED_AT else None,
        "REJECTED_AT": q.REJECTED_AT.isoformat() if q.REJECTED_AT else None,
        "REJECTION_REASON": q.REJECTION_REASON,
        "VENDOR_ID": q.VENDOR_ID,
        "CREATED_AT": q.CREATED_AT.isoformat() if q.CREATED_AT else None,
        "UPDATED_AT": q.UPDATED_AT.isoformat() if q.UPDATED_AT else None,
        # Tracking — for the detail modal badges
        "PUBLIC_TOKEN": q.PUBLIC_TOKEN,
        "PUBLIC_URL": _public_url(q.PUBLIC_TOKEN) if q.PUBLIC_TOKEN else None,
        "EMAIL_SENT_AT": q.EMAIL_SENT_AT.isoformat() if q.EMAIL_SENT_AT else None,
        "EMAIL_SENT_COUNT": q.EMAIL_SENT_COUNT or 0,
        "LAST_EMAIL_STATUS": q.LAST_EMAIL_STATUS,
        "VIEWED_AT": q.VIEWED_AT.isoformat() if q.VIEWED_AT else None,
        "LAST_VIEWED_AT": q.LAST_VIEWED_AT.isoformat() if q.LAST_VIEWED_AT else None,
        "VIEW_COUNT": q.VIEW_COUNT or 0
    }

    # Lookup customer name (cheap — single PK fetch)
    if q.CUSTOMER_ID:

        c = db.query(Customer).filter(Customer.ID == q.CUSTOMER_ID).first()

        if c:

            base["CUSTOMER_NAME"] = c.CUSTOMER_NAME
            base["CUSTOMER_CODE"] = c.CUSTOMER_CODE
            base["CUSTOMER_PHONE"] = c.PHONE
            base["CUSTOMER_EMAIL"] = c.EMAIL
            base["CUSTOMER_ADDRESS"] = (
                c.BILLING_ADDRESS or c.ADDRESS or ""
            )
            base["CUSTOMER_GST"] = c.GST_NUMBER

    # Lookup preparer name
    if q.PREPARED_BY:

        emp = db.query(Employee).filter(Employee.ID == q.PREPARED_BY).first()

        if emp:

            base["PREPARED_BY_NAME"] = emp.NAME

    if include_lines:

        lines = db.query(QuotationLine).filter(
            QuotationLine.QUOTATION_ID == q.ID
        ).order_by(
            QuotationLine.SORT_ORDER,
            QuotationLine.ID
        ).all()

        base["LINES"] = [_serialize_line(l) for l in lines]

    return base


# =========================
# Quotation policy settings (auto-SO + max discount)
# =========================
#
# These routes MUST be declared before any "/quotations/{quotation_id}"
# route, otherwise FastAPI's path-parameter matcher will swallow the
# literal "_settings" segment as an ID and 422 on integer conversion.

@router.get("/quotations/_settings")
def get_quotation_settings(
    db: Session = Depends(get_db)
):
    """Read the auto-SO + discount policy flags. Powers a future
    admin settings UI without hard-coding values on the frontend."""

    auto_raw = _get_setting(db, AUTO_CREATE_SO_KEY, "true")

    max_disc_raw = _get_setting(db, MAX_DISCOUNT_KEY, "10")

    try:

        max_disc = float(max_disc_raw)

    except (TypeError, ValueError):

        max_disc = 10.0

    return {
        "auto_create_so": str(auto_raw).strip().lower() in (
            "1", "true", "yes", "on"
        ),
        "max_discount_percent": max_disc
    }


@router.patch("/quotations/_settings")
def update_quotation_settings(
    payload: dict,
    db: Session = Depends(get_db)
):
    """Upsert one or both policy flags. Body is intentionally a free
    dict so future fields don't require a schema migration. Unknown
    keys are ignored."""

    if not isinstance(payload, dict):

        raise HTTPException(
            status_code=400,
            detail="Request body must be a JSON object"
        )

    if "auto_create_so" in payload:

        val = payload["auto_create_so"]

        # Accept bool, "true"/"false", 0/1
        if isinstance(val, bool):

            normalized = "true" if val else "false"

        else:

            normalized = (
                "true"
                if str(val).strip().lower() in ("1", "true", "yes", "on")
                else "false"
            )

        _set_setting(db, AUTO_CREATE_SO_KEY, normalized)

    if "max_discount_percent" in payload:

        try:

            pct = float(payload["max_discount_percent"])

        except (TypeError, ValueError):

            raise HTTPException(
                status_code=400,
                detail="max_discount_percent must be a number"
            )

        if pct < 0 or pct > 100:

            raise HTTPException(
                status_code=400,
                detail="max_discount_percent must be between 0 and 100"
            )

        _set_setting(db, MAX_DISCOUNT_KEY, str(pct))

    db.commit()

    # Echo the new state so the UI can refresh without a second GET.
    return get_quotation_settings(db)


# =========================
# Quotation CRUD
# =========================

@router.post("/quotations")
def create_quotation(
    data: QuotationCreate,
    db: Session = Depends(get_db)
):

    customer = db.query(Customer).filter(
        Customer.ID == data.CUSTOMER_ID
    ).first()

    if not customer:

        raise HTTPException(status_code=404, detail="Customer not found")

    q = Quotation(
        QUOTATION_NUMBER=_next_quotation_number(db, data.VENDOR_ID or 1),
        CUSTOMER_ID=data.CUSTOMER_ID,
        QUOTATION_DATE=data.QUOTATION_DATE or date.today(),
        VALIDITY_DAYS=data.VALIDITY_DAYS or 30,
        DISCOUNT_PERCENT=data.DISCOUNT_PERCENT or 0.0,
        TAX_PERCENT=data.TAX_PERCENT if data.TAX_PERCENT is not None else 18.0,
        TERMS_AND_CONDITIONS=data.TERMS_AND_CONDITIONS,
        NOTES=data.NOTES,
        PREPARED_BY=data.PREPARED_BY,
        VENDOR_ID=data.VENDOR_ID or 1,
        STATUS="DRAFT"
    )

    _set_expiry(q)

    db.add(q)

    db.flush()

    # Insert lines
    for idx, line_data in enumerate(data.LINES):

        line = QuotationLine(
            QUOTATION_ID=q.ID,
            PRODUCT_MODEL_ID=line_data.PRODUCT_MODEL_ID,
            REQUIREMENT_ID=line_data.REQUIREMENT_ID,
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

    _recompute_quotation_totals(db, q)

    _log_activity(
        db, q.ID, "CREATED",
        detail=f"Quotation {q.QUOTATION_NUMBER} created with {len(data.LINES)} line(s)"
    )

    db.commit()

    db.refresh(q)

    return {
        "message": "Quotation created",
        "quotation": _serialize_quotation(db, q)
    }


@router.get("/quotations")
def list_quotations(
    status: Optional[str] = Query(None),
    customer_id: Optional[int] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):

    q = db.query(Quotation)

    if status:

        q = q.filter(Quotation.STATUS == status.upper())

    if customer_id:

        q = q.filter(Quotation.CUSTOMER_ID == customer_id)

    if vendor_id:

        q = q.filter(Quotation.VENDOR_ID == vendor_id)

    rows = q.order_by(Quotation.CREATED_AT.desc()).all()

    return [
        _serialize_quotation(db, r, include_lines=False)
        for r in rows
    ]


@router.get("/quotations/{quotation_id}")
def get_quotation(
    quotation_id: int,
    db: Session = Depends(get_db)
):

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    return _serialize_quotation(db, q, include_lines=True)


@router.patch("/quotations/{quotation_id}")
def update_quotation(
    quotation_id: int,
    data: QuotationUpdate,
    db: Session = Depends(get_db)
):

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS in ("CONVERTED",):

        raise HTTPException(
            status_code=400,
            detail="Cannot edit a converted quotation"
        )

    payload = data.dict(exclude_unset=True)

    for field, value in payload.items():

        setattr(q, field, value)

    _set_expiry(q)

    _recompute_quotation_totals(db, q)

    db.commit()

    db.refresh(q)

    return {
        "message": "Quotation updated",
        "quotation": _serialize_quotation(db, q)
    }


@router.delete("/quotations/{quotation_id}")
def delete_quotation(
    quotation_id: int,
    force: bool = False,
    db: Session = Depends(get_db)
):
    """Delete a quotation and its lines/activity.

    Default behaviour blocks deletion of CONVERTED / SENT quotations to
    protect the audit trail. Pass ?force=true to override (e.g. cleaning
    up test data).

    SalesOrderLine rows that referenced our QuotationLine via
    QUOTATION_LINE_ID are NULL-unlinked so they survive — the line keeps
    its product/qty/price but forgets which quote it came from.
    """

    from app.models.models import (
        QuotationActivity,
        QuotationNegotiation,
        SalesOrder,
        SalesOrderLine,
        DiscountRequest
    )

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if not force and q.STATUS not in ("DRAFT", "REJECTED", "EXPIRED"):

        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot delete a {q.STATUS} quotation without force=true. "
                f"Append ?force=true to confirm."
            )
        )

    # Collect line IDs before deleting so we can unlink SO lines
    line_ids = [
        r[0] for r in db.query(QuotationLine.ID).filter(
            QuotationLine.QUOTATION_ID == quotation_id
        ).all()
    ]

    so_lines_unlinked = 0

    if line_ids:

        so_lines_unlinked = db.query(SalesOrderLine).filter(
            SalesOrderLine.QUOTATION_LINE_ID.in_(line_ids)
        ).update(
            {SalesOrderLine.QUOTATION_LINE_ID: None},
            synchronize_session=False
        )

    # Sales orders converted from this quote — keep the SO row but
    # NULL out the back-pointer so the order survives the quote delete.
    sos_unlinked = db.query(SalesOrder).filter(
        SalesOrder.QUOTATION_ID == quotation_id
    ).update(
        {SalesOrder.QUOTATION_ID: None},
        synchronize_session=False
    )

    # Chat-style negotiation messages tied to this quote → delete.
    negotiations_deleted = db.query(QuotationNegotiation).filter(
        QuotationNegotiation.QUOTATION_ID == quotation_id
    ).delete(synchronize_session=False)

    # Discount requests reference quotation NOT NULL → must delete first.
    discounts_deleted = db.query(DiscountRequest).filter(
        DiscountRequest.QUOTATION_ID == quotation_id
    ).delete(synchronize_session=False)

    activity_deleted = db.query(QuotationActivity).filter(
        QuotationActivity.QUOTATION_ID == quotation_id
    ).delete(synchronize_session=False)

    lines_deleted = db.query(QuotationLine).filter(
        QuotationLine.QUOTATION_ID == quotation_id
    ).delete(synchronize_session=False)

    # Snapshot the human-readable identifier BEFORE deleting the row
    # (after db.delete + commit the ORM may detach attributes).
    qnum = q.QUOTATION_NUMBER or str(quotation_id)

    db.delete(q)

    db.commit()

    return {
        "message": f"Quotation {qnum} removed.",
        "lines_deleted": lines_deleted,
        "activity_deleted": activity_deleted,
        "negotiations_deleted": negotiations_deleted,
        "discounts_deleted": discounts_deleted,
        "so_lines_unlinked": so_lines_unlinked,
        "sos_unlinked": sos_unlinked
    }


# =========================
# Line CRUD
# =========================

@router.post("/quotations/{quotation_id}/lines")
def add_line(
    quotation_id: int,
    data: QuotationLineCreate,
    db: Session = Depends(get_db)
):

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS in ("CONVERTED", "REJECTED"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot add lines to a {q.STATUS} quotation"
        )

    line = QuotationLine(
        QUOTATION_ID=quotation_id,
        PRODUCT_MODEL_ID=data.PRODUCT_MODEL_ID,
        REQUIREMENT_ID=data.REQUIREMENT_ID,
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

    _recompute_quotation_totals(db, q)

    db.commit()

    db.refresh(line)

    return {
        "message": "Line added",
        "line": _serialize_line(line),
        "totals": {
            "SUBTOTAL": q.SUBTOTAL,
            "GRAND_TOTAL": q.GRAND_TOTAL
        }
    }


@router.patch("/quotations/{quotation_id}/lines/{line_id}")
def update_line(
    quotation_id: int,
    line_id: int,
    data: QuotationLineUpdate,
    db: Session = Depends(get_db)
):

    line = db.query(QuotationLine).filter(
        QuotationLine.ID == line_id,
        QuotationLine.QUOTATION_ID == quotation_id
    ).first()

    if not line:

        raise HTTPException(status_code=404, detail="Line not found")

    payload = data.dict(exclude_unset=True)

    for field, value in payload.items():

        setattr(line, field, value)

    line.LINE_TOTAL = _compute_line_total(line)

    db.flush()

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    _recompute_quotation_totals(db, q)

    db.commit()

    db.refresh(line)

    return {
        "message": "Line updated",
        "line": _serialize_line(line),
        "totals": {
            "SUBTOTAL": q.SUBTOTAL,
            "GRAND_TOTAL": q.GRAND_TOTAL
        }
    }


@router.delete("/quotations/{quotation_id}/lines/{line_id}")
def delete_line(
    quotation_id: int,
    line_id: int,
    db: Session = Depends(get_db)
):

    line = db.query(QuotationLine).filter(
        QuotationLine.ID == line_id,
        QuotationLine.QUOTATION_ID == quotation_id
    ).first()

    if not line:

        raise HTTPException(status_code=404, detail="Line not found")

    db.delete(line)

    db.flush()

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    _recompute_quotation_totals(db, q)

    db.commit()

    return {
        "message": "Line removed",
        "totals": {
            "SUBTOTAL": q.SUBTOTAL,
            "GRAND_TOTAL": q.GRAND_TOTAL
        }
    }


# =========================
# Workflow transitions
# =========================

def _build_quotation_pdf_html(q: Quotation, customer: Customer, lines: list, company=None) -> str:
    """Print-styled HTML for the PDF attachment. Kept independent
    of _build_quotation_email_html so the layout can be optimised
    for A4 (xhtml2pdf supports a narrow CSS subset).

    `company` is a CompanyMaster row (auto-seeded). If None, the
    helper falls back to BVC defaults via the service."""

    if company is None:

        from app.database.database import SessionLocal

        from app.services.company_settings_service import get_company_settings

        _db = SessionLocal()

        try:

            company = get_company_settings(_db, q.VENDOR_ID or 1)

        finally:

            _db.close()

    from app.services.company_settings_service import format_full_address

    company_addr = format_full_address(company)

    inr = lambda n: "Rs. " + "{:,.2f}".format(float(n or 0))

    rows_html = ""

    for idx, l in enumerate(lines, start=1):

        rows_html += f"""
        <tr>
          <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:center;">{idx}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0;">{(l.DESCRIPTION or '')}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:center;">{l.HSN_CODE or '-'}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">{l.QUANTITY or 0}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">{inr(l.UNIT_PRICE)}</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right;">{(l.DISCOUNT_PERCENT or 0)}%</td>
          <td style="padding:6px 8px; border-bottom:1px solid #e2e8f0; text-align:right; font-weight:bold;">{inr(l.LINE_TOTAL)}</td>
        </tr>
        """

    if not rows_html:

        rows_html = (
            '<tr><td colspan="7" style="padding:14px; text-align:center; '
            'color:#94a3b8;">No line items</td></tr>'
        )

    customer_addr = (
        customer.BILLING_ADDRESS or customer.ADDRESS or ""
    )

    cust_city_state = ", ".join(
        x for x in [customer.CITY, customer.STATE, customer.PINCODE] if x
    )

    terms = q.TERMS_AND_CONDITIONS or ""

    terms_html = terms.replace("\n", "<br/>") if terms else "-"

    return f"""
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Quotation {q.QUOTATION_NUMBER}</title>
<style>
  @page {{ size: A4; margin: 18mm 14mm; }}
  body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #0f172a; }}
  h1, h2, h3 {{ margin: 0; }}
  .header {{ background-color:#C8102E; color:white; padding:14px 18px; }}
  .header h1 {{ font-size:18pt; }}
  .header .num {{ font-size:9pt; opacity:0.9; }}
  table {{ width:100%; border-collapse:collapse; }}
  .meta td {{ padding:4px 8px; vertical-align:top; }}
  .meta .label {{ color:#64748b; font-size:8pt; }}
  .items th {{ background-color:#fef2f2; color:#8B0B1F; padding:8px; text-align:left; font-size:9pt; border-bottom:1px solid #fecaca; }}
  .totals td {{ padding:5px 10px; }}
  .totals .grand {{ font-size:13pt; font-weight:bold; color:#C8102E; }}
  .terms {{ margin-top:16px; background-color:#f8fafc; padding:10px 12px; border-left:3px solid #C8102E; font-size:9pt; }}
  .footer {{ margin-top:20px; padding-top:10px; border-top:1px solid #e2e8f0; font-size:8pt; color:#94a3b8; text-align:center; }}
</style>
</head>
<body>

  <div class="header">
    <div class="num">{(company.SHORT_NAME or company.LEGAL_NAME or 'COMPANY')} &middot; QUOTATION</div>
    <h1>{q.QUOTATION_NUMBER}</h1>
    <div style="font-size:9pt; color:#475569; margin-top:6px;">
      <strong>{company.LEGAL_NAME or ''}</strong>
      {(' &middot; GST: ' + company.GST_NUMBER) if company.GST_NUMBER else ''}
      {(' &middot; PAN: ' + company.PAN_NUMBER) if company.PAN_NUMBER else ''}<br/>
      {company_addr}
      {(' &middot; ' + company.PHONE) if company.PHONE else ''}
      {(' &middot; ' + company.EMAIL) if company.EMAIL else ''}
    </div>
  </div>

  <table class="meta" style="margin-top:14px;">
    <tr>
      <td style="width:50%;">
        <div class="label">BILL TO</div>
        <div style="font-weight:bold;">{customer.CUSTOMER_NAME or ''}</div>
        {(f'<div>{customer.CONTACT_PERSON}</div>') if customer.CONTACT_PERSON else ''}
        <div>{customer_addr}</div>
        <div>{cust_city_state}</div>
        {(f'<div>GST: {customer.GST_NUMBER}</div>') if customer.GST_NUMBER else ''}
        {(f'<div>Phone: {customer.PHONE}</div>') if customer.PHONE else ''}
        {(f'<div>Email: {customer.EMAIL}</div>') if customer.EMAIL else ''}
      </td>
      <td style="width:50%; text-align:right;">
        <div class="label">DATE</div>
        <div style="font-weight:bold;">{q.QUOTATION_DATE or '-'}</div>
        <div class="label" style="margin-top:6px;">VALIDITY</div>
        <div>{q.VALIDITY_DAYS or 30} days (expires {q.EXPIRY_DATE or '-'})</div>
      </td>
    </tr>
  </table>

  <table class="items" style="margin-top:16px;">
    <thead>
      <tr>
        <th style="width:30px; text-align:center;">#</th>
        <th>Description</th>
        <th style="width:60px; text-align:center;">HSN</th>
        <th style="width:50px; text-align:right;">Qty</th>
        <th style="width:80px; text-align:right;">Unit Price</th>
        <th style="width:50px; text-align:right;">Disc</th>
        <th style="width:90px; text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      {rows_html}
    </tbody>
  </table>

  <table class="totals" style="margin-top:14px;">
    <tr><td colspan="6"></td>
      <td style="width:120px; text-align:right; color:#64748b;">Subtotal</td>
      <td style="width:120px; text-align:right;">{inr(q.SUBTOTAL)}</td>
    </tr>
    {(f'<tr><td colspan="6"></td><td style="text-align:right; color:#64748b;">Discount ({q.DISCOUNT_PERCENT}%)</td><td style="text-align:right;">- {inr(q.DISCOUNT_AMOUNT)}</td></tr>') if (q.DISCOUNT_AMOUNT or 0) > 0 else ''}
    <tr><td colspan="6"></td>
      <td style="text-align:right; color:#64748b;">GST ({q.TAX_PERCENT}%)</td>
      <td style="text-align:right;">{inr(q.TAX_AMOUNT)}</td>
    </tr>
    <tr><td colspan="6"></td>
      <td style="text-align:right; padding-top:8px;" class="grand">GRAND TOTAL</td>
      <td style="text-align:right; padding-top:8px;" class="grand">{inr(q.GRAND_TOTAL)}</td>
    </tr>
  </table>

  <div class="terms">
    <div style="font-weight:bold; color:#8B0B1F; margin-bottom:4px;">TERMS &amp; CONDITIONS</div>
    {terms_html}
  </div>

  <div class="footer">
    {company.LEGAL_NAME or ''} &middot; {company_addr}
    {(' &middot; ' + company.WEBSITE) if company.WEBSITE else ''}<br/>
    This is a system-generated quotation. Please review and respond at your convenience.
  </div>

</body>
</html>
"""


def render_quotation_pdf(q: Quotation, customer: Customer, lines: list) -> bytes:
    """Render the quotation as a PDF using xhtml2pdf. Returns the
    PDF bytes, or None if xhtml2pdf isn't installed / rendering
    fails (caller falls back to send-without-attachment)."""

    try:

        from xhtml2pdf import pisa

    except ImportError:

        return None

    html = _build_quotation_pdf_html(q, customer, lines)

    from io import BytesIO

    buf = BytesIO()

    try:

        result = pisa.CreatePDF(html, dest=buf)

        if result.err:

            return None

        return buf.getvalue()

    except Exception:

        return None


def _send_quotation_email(db: Session, q: Quotation) -> tuple:
    """Send the quotation email to the customer with the PDF
    attached. Recipient is ALWAYS customer.EMAIL — never an env
    override. Returns (success, msg)."""

    customer = db.query(Customer).filter(
        Customer.ID == q.CUSTOMER_ID
    ).first()

    if not customer or not customer.EMAIL:

        return False, "Customer has no EMAIL on file"

    _ensure_public_token(q)

    link = _public_url(q.PUBLIC_TOKEN)

    subject = f"Quotation {q.QUOTATION_NUMBER} from Bharath Vending Corp."

    html = _build_quotation_email_html(q, customer, link)

    # ---- Render PDF attachment ----
    lines = db.query(QuotationLine).filter(
        QuotationLine.QUOTATION_ID == q.ID
    ).order_by(QuotationLine.SORT_ORDER, QuotationLine.ID).all()

    pdf_bytes = render_quotation_pdf(q, customer, lines)

    attachments = None

    if pdf_bytes:

        attachments = [{
            "filename": f"{q.QUOTATION_NUMBER}.pdf",
            "content": pdf_bytes,
            "content_type": "application/pdf"
        }]

    ok, msg = send_alert_email(
        subject,
        html,
        recipient=customer.EMAIL,
        attachments=attachments
    )

    if ok and pdf_bytes:

        msg = f"{msg} (with PDF attached, {len(pdf_bytes)//1024} KB)"

    elif ok:

        msg = f"{msg} (PDF skipped — xhtml2pdf rendering failed)"

    return ok, msg


@router.post("/quotations/{quotation_id}/send")
def send_quotation(
    quotation_id: int,
    db: Session = Depends(get_db)
):
    """First send: marks SENT, generates public token, dispatches the
    email to the customer, logs an activity row. If email dispatch
    fails, the status still flips so the salesperson can retry
    manually via /resend-email."""

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS not in ("DRAFT",):

        raise HTTPException(
            status_code=400,
            detail=f"Only DRAFT quotations can be sent (current: {q.STATUS})"
        )

    q.STATUS = "SENT"

    q.SENT_AT = datetime.utcnow()

    _ensure_public_token(q)

    # Mark linked requirements as QUOTED
    lines = db.query(QuotationLine).filter(
        QuotationLine.QUOTATION_ID == quotation_id,
        QuotationLine.REQUIREMENT_ID.isnot(None)
    ).all()

    req_ids = {l.REQUIREMENT_ID for l in lines if l.REQUIREMENT_ID}

    if req_ids:

        db.query(CustomerRequirement).filter(
            CustomerRequirement.ID.in_(req_ids)
        ).update(
            {"STATUS": "QUOTED"}, synchronize_session=False
        )

    _log_activity(db, q.ID, "SENT", detail="Status changed to SENT")

    # Attempt email send
    email_ok, email_msg = _send_quotation_email(db, q)

    q.LAST_EMAIL_STATUS = email_msg[:200] if email_msg else None

    if email_ok:

        q.EMAIL_SENT_AT = datetime.utcnow()

        q.EMAIL_SENT_COUNT = (q.EMAIL_SENT_COUNT or 0) + 1

        _log_activity(
            db, q.ID, "EMAIL_SENT",
            detail=f"Email delivered to customer ({email_msg})"
        )

    else:

        _log_activity(
            db, q.ID, "EMAIL_FAILED",
            detail=f"Email send failed: {email_msg}"
        )

    db.commit()

    db.refresh(q)

    return {
        "message": (
            "Quotation sent + email delivered"
            if email_ok else
            "Quotation marked SENT but email delivery failed — check LAST_EMAIL_STATUS"
        ),
        "email_sent": email_ok,
        "email_status": email_msg,
        "public_url": _public_url(q.PUBLIC_TOKEN),
        "quotation": _serialize_quotation(db, q, include_lines=False)
    }


@router.post("/quotations/{quotation_id}/resend-email")
def resend_email(
    quotation_id: int,
    db: Session = Depends(get_db)
):
    """Re-send the quotation email. Allowed on SENT / APPROVED
    quotations — keeps the same public token so existing links
    continue to work."""

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS not in ("SENT", "APPROVED", "DRAFT"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot resend a {q.STATUS} quotation"
        )

    ok, msg = _send_quotation_email(db, q)

    q.LAST_EMAIL_STATUS = msg[:200] if msg else None

    if ok:

        q.EMAIL_SENT_AT = datetime.utcnow()

        q.EMAIL_SENT_COUNT = (q.EMAIL_SENT_COUNT or 0) + 1

        _log_activity(
            db, q.ID, "EMAIL_SENT",
            detail=f"Resent — {msg}"
        )

    else:

        _log_activity(
            db, q.ID, "EMAIL_FAILED",
            detail=f"Resend failed: {msg}"
        )

    db.commit()

    db.refresh(q)

    return {
        "email_sent": ok,
        "email_status": msg,
        "quotation": _serialize_quotation(db, q, include_lines=False)
    }


@router.post("/quotations/{quotation_id}/approve")
def approve_quotation(
    quotation_id: int,
    db: Session = Depends(get_db)
):

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS not in ("SENT", "DRAFT"):

        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve a {q.STATUS} quotation"
        )

    q.STATUS = "APPROVED"

    q.APPROVED_AT = datetime.utcnow()

    _log_activity(db, q.ID, "APPROVED", detail="Admin approved the quotation",
                  actor_type="ADMIN")

    db.commit()

    db.refresh(q)

    # ----- Auto-create Sales Order (best-effort, never blocks) -----
    auto_so_info = None

    if _auto_create_so_enabled(db):

        auto_so_info = _auto_create_so_for_quotation(
            db, q,
            actor_type="ADMIN",
            actor_name="auto-on-approval"
        )

    response = {
        "message": "Quotation approved",
        "quotation": _serialize_quotation(db, q, include_lines=False)
    }

    if auto_so_info:

        response["auto_created_so"] = auto_so_info

    return response


@router.post("/quotations/{quotation_id}/reject")
def reject_quotation(
    quotation_id: int,
    data: QuotationRejection,
    db: Session = Depends(get_db)
):

    q = db.query(Quotation).filter(Quotation.ID == quotation_id).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS in ("CONVERTED", "REJECTED"):

        raise HTTPException(
            status_code=400,
            detail=f"Quotation already {q.STATUS}"
        )

    q.STATUS = "REJECTED"

    q.REJECTED_AT = datetime.utcnow()

    q.REJECTION_REASON = data.REJECTION_REASON

    _log_activity(
        db, q.ID, "REJECTED",
        detail=data.REJECTION_REASON or "Quotation rejected"
    )

    db.commit()

    db.refresh(q)

    return {
        "message": "Quotation rejected",
        "quotation": _serialize_quotation(db, q, include_lines=False)
    }


# =========================
# Auto-pricing helpers
# =========================

@router.get("/quotations-auto-price")
def auto_price(
    product_model_id: int = Query(...),
    margin_percent: float = Query(25.0),
    vendor_id: int = Query(1),
    db: Session = Depends(get_db)
):
    """Compute suggested price for ONE unit of a product based on
    its BOM material costs + margin."""

    product = db.query(ProductModel).filter(
        ProductModel.ID == product_model_id
    ).first()

    if not product:

        raise HTTPException(status_code=404, detail="Product not found")

    raw_cost = _bom_cost_per_unit(db, product_model_id, vendor_id)

    suggested = round(raw_cost * (1.0 + margin_percent / 100.0), 2)

    return {
        "product_model_id": product_model_id,
        "model_name": product.MODEL_NAME,
        "model_code": product.MODEL_CODE,
        "raw_bom_cost": raw_cost,
        "margin_percent": margin_percent,
        "suggested_unit_price": suggested
    }


@router.post("/quotations/from-requirements")
def quotation_from_requirements(
    data: QuotationFromRequirement,
    db: Session = Depends(get_db)
):
    """Auto-create a draft quotation from one or more customer
    requirements. Each requirement → one line. Unit price comes from
    the requirement's TARGET_UNIT_PRICE if set, otherwise from
    BOM-based auto-pricing on the linked ProductModel."""

    customer = db.query(Customer).filter(
        Customer.ID == data.CUSTOMER_ID
    ).first()

    if not customer:

        raise HTTPException(status_code=404, detail="Customer not found")

    reqs = db.query(CustomerRequirement).filter(
        CustomerRequirement.ID.in_(data.REQUIREMENT_IDS),
        CustomerRequirement.CUSTOMER_ID == data.CUSTOMER_ID
    ).all()

    if not reqs:

        raise HTTPException(
            status_code=400,
            detail="No matching requirements found for this customer"
        )

    vendor_id = data.VENDOR_ID or customer.VENDOR_ID or 1

    q = Quotation(
        QUOTATION_NUMBER=_next_quotation_number(db, vendor_id),
        CUSTOMER_ID=customer.ID,
        QUOTATION_DATE=date.today(),
        VALIDITY_DAYS=30,
        DISCOUNT_PERCENT=0.0,
        TAX_PERCENT=18.0,
        PREPARED_BY=customer.ASSIGNED_SALES_ID,
        VENDOR_ID=vendor_id,
        STATUS="DRAFT"
    )

    _set_expiry(q)

    db.add(q)

    db.flush()

    for idx, r in enumerate(reqs):

        # Pick unit price: explicit target > BOM-based > 0
        if r.TARGET_UNIT_PRICE:

            unit_price = float(r.TARGET_UNIT_PRICE)

        elif r.PRODUCT_MODEL_ID:

            cost = _bom_cost_per_unit(db, r.PRODUCT_MODEL_ID, vendor_id)

            unit_price = round(
                cost * (1.0 + (data.MARGIN_PERCENT or 25.0) / 100.0),
                2
            )

        else:

            unit_price = 0.0

        # Build a descriptive line label
        parts = []

        if r.MACHINE_NAME:

            parts.append(r.MACHINE_NAME)

        if r.MACHINE_CATEGORY:

            parts.append(f"({r.MACHINE_CATEGORY})")

        if r.CAPACITY:

            parts.append(f"— {r.CAPACITY}")

        description = " ".join(parts) or f"Requirement #{r.ID}"

        if r.SPECIAL_NOTES:

            description += f". {r.SPECIAL_NOTES}"

        line = QuotationLine(
            QUOTATION_ID=q.ID,
            PRODUCT_MODEL_ID=r.PRODUCT_MODEL_ID,
            REQUIREMENT_ID=r.ID,
            DESCRIPTION=description[:500],
            QUANTITY=float(r.QUANTITY or 1),
            UNIT="nos",
            UNIT_PRICE=unit_price,
            DISCOUNT_PERCENT=0.0,
            SORT_ORDER=idx
        )

        line.LINE_TOTAL = _compute_line_total(line)

        db.add(line)

    db.flush()

    _recompute_quotation_totals(db, q)

    db.commit()

    db.refresh(q)

    return {
        "message": (
            f"Created quotation {q.QUOTATION_NUMBER} "
            f"from {len(reqs)} requirement(s)"
        ),
        "quotation": _serialize_quotation(db, q)
    }


# =========================
# Public share + tracking
# =========================

@router.get("/q/{token}")
def public_quotation_view(
    token: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Public endpoint — no auth required. Returns the quotation
    payload for the share link AND bumps view counters / logs an
    activity row the first time it's opened."""

    q = db.query(Quotation).filter(
        Quotation.PUBLIC_TOKEN == token
    ).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS == "DRAFT":

        # Don't expose drafts via public link — sales hasn't sent yet
        raise HTTPException(status_code=404, detail="Quotation not available")

    # Bump tracking
    now = datetime.utcnow()

    is_first_view = q.VIEWED_AT is None

    if is_first_view:

        q.VIEWED_AT = now

    q.LAST_VIEWED_AT = now

    q.VIEW_COUNT = (q.VIEW_COUNT or 0) + 1

    # Best-effort client IP for the activity log
    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )

    _log_activity(
        db, q.ID, "VIEWED",
        detail=(
            f"First view from IP {client_ip}"
            if is_first_view
            else f"Re-viewed from IP {client_ip} (view #{q.VIEW_COUNT})"
        ),
        actor_type="CUSTOMER"
    )

    db.commit()

    db.refresh(q)

    # Public payload — same as internal serializer but stripped of
    # internal-only fields the customer doesn't need
    payload = _serialize_quotation(db, q, include_lines=True)

    # Remove internal-only keys before exposing publicly
    for k in (
        "PREPARED_BY", "VENDOR_ID", "PUBLIC_TOKEN", "PUBLIC_URL",
        "EMAIL_SENT_AT", "EMAIL_SENT_COUNT", "LAST_EMAIL_STATUS"
    ):

        payload.pop(k, None)

    return payload


@router.post("/q/{token}/respond")
def public_quotation_respond(
    token: str,
    action: str = Query(..., description="approve | reject"),
    reason: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Customer-side approval / rejection from the public link.
    Useful when the salesperson wants the customer to confirm in one
    click, without a portal login."""

    q = db.query(Quotation).filter(
        Quotation.PUBLIC_TOKEN == token
    ).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    action = action.lower()

    if action not in ("approve", "reject"):

        raise HTTPException(
            status_code=400,
            detail="action must be 'approve' or 'reject'"
        )

    if q.STATUS in ("CONVERTED", "REJECTED", "APPROVED"):

        raise HTTPException(
            status_code=400,
            detail=f"Quotation already {q.STATUS}"
        )

    now = datetime.utcnow()

    if action == "approve":

        q.STATUS = "APPROVED"

        q.APPROVED_AT = now

        _log_activity(
            db, q.ID, "APPROVED",
            detail="Customer approved via public link",
            actor_type="CUSTOMER"
        )

    else:

        q.STATUS = "REJECTED"

        q.REJECTED_AT = now

        q.REJECTION_REASON = reason

        _log_activity(
            db, q.ID, "REJECTED",
            detail=(reason or "Customer rejected via public link"),
            actor_type="CUSTOMER"
        )

    db.commit()

    response = {"message": f"Recorded — {action.upper()}"}

    # ----- Auto-create Sales Order on customer approval -----
    # Only when (a) the customer actually approved, (b) the global
    # feature flag is ON. Wrapped in best-effort: any failure is
    # logged on the quotation timeline but never blocks the response.
    if action == "approve" and _auto_create_so_enabled(db):

        auto_so_info = _auto_create_so_for_quotation(
            db, q,
            actor_type="CUSTOMER",
            actor_name="auto-on-public-approval"
        )

        if auto_so_info:

            response["auto_created_so"] = auto_so_info

    return response


# =========================
# Public Negotiation Chat (AI assistant on /q/{token})
# =========================

class NegotiationMessageIn(BaseModel):
    """Request body for POST /q/{token}/negotiate."""

    MESSAGE: str


def _get_max_discount_percent(db: Session) -> float:
    """Read the discount ceiling from the Setting table. Falls back to
    10% if the row is missing or malformed."""

    raw = _get_setting(db, MAX_DISCOUNT_KEY, "10")

    try:

        val = float(str(raw).strip())

    except (TypeError, ValueError):

        val = 10.0

    if val < 0:

        val = 0.0

    if val > 100:

        val = 100.0

    return val


def _serialize_negotiation_row(row: QuotationNegotiation) -> dict:
    """DTO for a single chat message returned to the public widget."""

    return {
        "ID": row.ID,
        "ROLE": row.ROLE,
        "CONTENT": row.CONTENT,
        "INTENT": row.INTENT,
        "ACTION": row.ACTION,
        "DISCOUNT_PERCENT": row.DISCOUNT_PERCENT,
        "CREATED_AT": (
            row.CREATED_AT.isoformat() if row.CREATED_AT else None
        )
    }


@router.get("/q/{token}/negotiate/history")
def public_negotiation_history(
    token: str,
    db: Session = Depends(get_db)
):
    """Public — returns the full chat transcript so the widget can
    rehydrate on reload. Token in the URL is the auth."""

    q = db.query(Quotation).filter(
        Quotation.PUBLIC_TOKEN == token
    ).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    if q.STATUS == "DRAFT":

        raise HTTPException(status_code=404, detail="Quotation not available")

    rows = db.query(QuotationNegotiation).filter(
        QuotationNegotiation.QUOTATION_ID == q.ID
    ).order_by(
        QuotationNegotiation.CREATED_AT.asc(),
        QuotationNegotiation.ID.asc()
    ).all()

    return {
        "messages": [_serialize_negotiation_row(r) for r in rows],
        "max_discount_percent": _get_max_discount_percent(db),
        "quotation_status": q.STATUS
    }


@router.post("/q/{token}/negotiate")
def public_negotiation_send(
    token: str,
    body: NegotiationMessageIn,
    db: Session = Depends(get_db)
):
    """Public — customer types a message, AI replies, we persist
    both messages, and (if AUTO_APPROVE on a DISCOUNT) we update
    the quotation totals server-side. The bot's suggested discount
    is hard-clamped to the policy ceiling before persisting — the
    AI is advisory, the route is authoritative."""

    q = db.query(Quotation).filter(
        Quotation.PUBLIC_TOKEN == token
    ).first()

    if not q:

        raise HTTPException(status_code=404, detail="Quotation not found")

    # Only allow negotiation while the quote is still in play.
    # APPROVED / REJECTED / CONVERTED / EXPIRED / DRAFT are read-only.
    if q.STATUS != "SENT":

        raise HTTPException(
            status_code=400,
            detail=(
                f"Negotiation is closed for this quotation "
                f"(status: {q.STATUS})."
            )
        )

    # Expiry guard — don't let customers haggle a stale quote.
    if q.EXPIRY_DATE and q.EXPIRY_DATE < date.today():

        raise HTTPException(
            status_code=400,
            detail="This quotation has expired. Please contact sales."
        )

    msg = (body.MESSAGE or "").strip()

    if not msg:

        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if len(msg) > 2000:

        raise HTTPException(
            status_code=400,
            detail="Message too long (max 2000 chars)"
        )

    customer = db.query(Customer).filter(
        Customer.ID == q.CUSTOMER_ID
    ).first()

    max_discount = _get_max_discount_percent(db)

    # Load prior chat history so the bot has context for multi-turn.
    history_rows = db.query(QuotationNegotiation).filter(
        QuotationNegotiation.QUOTATION_ID == q.ID
    ).order_by(
        QuotationNegotiation.CREATED_AT.asc(),
        QuotationNegotiation.ID.asc()
    ).all()

    history_payload = [
        {
            "ROLE": r.ROLE,
            "CONTENT": r.CONTENT
        }
        for r in history_rows
    ]

    # 1) Persist the customer turn first (so even if the AI step
    # crashes mid-way, the customer's message is on record).
    customer_row = QuotationNegotiation(
        QUOTATION_ID=q.ID,
        ROLE="customer",
        CONTENT=msg,
        INTENT=None,
        ACTION=None,
        DISCOUNT_PERCENT=None
    )

    db.add(customer_row)

    db.flush()

    # 2) Call the AI. negotiate() is hardened — it always returns a
    # usable dict, never raises.
    try:

        ai_result = ai_negotiate(
            db, q, customer, msg,
            history=history_payload,
            max_discount_percent=max_discount
        )

    except Exception as exc:

        # Belt + suspenders. The service layer already has a safe
        # fallback, but if something exotic slips through we degrade
        # gracefully instead of 500-ing the chat.
        ai_result = {
            "reply": (
                "Thank you for your message. I'll have our sales team "
                "reach out shortly to discuss this in more detail."
            ),
            "intent": "OTHER",
            "action": "INFO_ONLY",
            "discount_percent": 0.0,
            "counter_text": f"(fallback: {exc})"
        }

    # 3) Hard-clamp the discount the bot offers — server is the
    # source of truth on policy. Even if the AI tries to be generous,
    # we never persist or surface a value above the ceiling.
    raw_pct = float(ai_result.get("discount_percent") or 0)

    if raw_pct < 0:

        raw_pct = 0.0

    if raw_pct > max_discount:

        raw_pct = max_discount

    intent = (ai_result.get("intent") or "OTHER").upper()

    action = (ai_result.get("action") or "INFO_ONLY").upper()

    # Only DISCOUNT actions actually carry a numeric offer.
    bot_discount = round(raw_pct, 2) if intent == "DISCOUNT" else 0.0

    reply_text = (ai_result.get("reply") or "").strip() or (
        "Thanks for reaching out — our team will follow up shortly."
    )

    # 4) Persist the assistant turn.
    assistant_row = QuotationNegotiation(
        QUOTATION_ID=q.ID,
        ROLE="assistant",
        CONTENT=reply_text,
        INTENT=intent,
        ACTION=action,
        DISCOUNT_PERCENT=bot_discount if intent == "DISCOUNT" else None
    )

    db.add(assistant_row)

    response = {
        "reply": reply_text,
        "intent": intent,
        "action": action,
        "discount_percent": bot_discount,
        "counter_text": ai_result.get("counter_text") or "",
        "max_discount_percent": max_discount
    }

    # 5) If the bot auto-approved a discount, actually apply it.
    # We update the quotation header DISCOUNT_PERCENT (capped at max)
    # and recompute totals so the customer sees the new grand total
    # immediately when they reload.
    if (
        action == "AUTO_APPROVE"
        and intent == "DISCOUNT"
        and bot_discount > 0
    ):

        prior_pct = float(q.DISCOUNT_PERCENT or 0)

        # Only apply if it's actually better than what's already on
        # the quote — never silently regress a customer's discount.
        if bot_discount > prior_pct:

            q.DISCOUNT_PERCENT = bot_discount

            _recompute_quotation_totals(db, q)

            _log_activity(
                db, q.ID, "NEGOTIATION_DISCOUNT_APPROVED",
                detail=(
                    f"AI assistant auto-approved a {bot_discount}% "
                    f"discount (was {prior_pct}%). New grand total: "
                    f"{q.GRAND_TOTAL:,.2f}"
                ),
                actor_type="SYSTEM",
                actor_name="negotiation-bot"
            )

            response["new_grand_total"] = q.GRAND_TOTAL

            response["new_discount_percent"] = q.DISCOUNT_PERCENT

            response["totals_updated"] = True

        else:

            # No-op but still log so audit trail captures the request
            _log_activity(
                db, q.ID, "NEGOTIATION_DISCOUNT_NOOP",
                detail=(
                    f"AI approved {bot_discount}% but quote already "
                    f"has {prior_pct}% — keeping the higher discount."
                ),
                actor_type="SYSTEM",
                actor_name="negotiation-bot"
            )

    elif action in ("COUNTER", "DECLINE") and intent == "DISCOUNT":

        # Audit the negotiation attempt even when we didn't apply it
        _log_activity(
            db, q.ID, f"NEGOTIATION_{action}",
            detail=(
                f"Customer asked for a discount; bot {action.lower()}d. "
                f"Offer in reply: {bot_discount}%."
            ),
            actor_type="CUSTOMER",
            actor_name=(customer.CUSTOMER_NAME if customer else None)
        )

    else:

        # Generic NEGOTIATION row for non-discount intents
        _log_activity(
            db, q.ID, "NEGOTIATION",
            detail=f"intent={intent} action={action}",
            actor_type="CUSTOMER",
            actor_name=(customer.CUSTOMER_NAME if customer else None)
        )

    db.commit()

    return response


@router.get("/quotations/{quotation_id}/activity")
def get_activity(
    quotation_id: int,
    db: Session = Depends(get_db)
):

    rows = db.query(QuotationActivity).filter(
        QuotationActivity.QUOTATION_ID == quotation_id
    ).order_by(
        QuotationActivity.CREATED_AT.desc()
    ).all()

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


@router.delete("/quotations/{quotation_id}/activity/{activity_id}")
def delete_activity_row(
    quotation_id: int,
    activity_id: int,
    db: Session = Depends(get_db)
):
    """Remove a single activity entry — useful for clearing noise
    like failed email attempts from earlier misconfigurations."""

    row = db.query(QuotationActivity).filter(
        QuotationActivity.ID == activity_id,
        QuotationActivity.QUOTATION_ID == quotation_id
    ).first()

    if not row:

        raise HTTPException(status_code=404, detail="Activity row not found")

    db.delete(row)

    db.commit()

    return {"message": "Activity row removed"}


# =========================
# Auto-generation (one-shot from a customer)
# =========================

# Default HSN for vending machines (Customs / GST chapter 84.24).
# Used when a quotation line is built from a ProductModel that has
# no per-product HSN column on the model (currently the case).
DEFAULT_VENDING_MACHINE_HSN = "84244000"

# Statuses on CustomerRequirement that are still "in play" for a
# new quotation. Skip ORDERED (already converted) and CANCELLED.
AUTO_GEN_REQUIREMENT_STATUSES = ("DRAFT", "CONFIRMED", "QUOTED")


# =====================================================================
# Pricing catalog used when auto-generating from customer requirements
# =====================================================================
#
# Customers who submit via the public chatbot or the onboarding portal
# usually don't pick a specific ProductModel — they just say "Combo
# Machine × 1" and describe features in free text. To turn that into
# a real quotation we need:
#
#   1. A reasonable base price per machine *category*, keyed by the
#      same labels the intake widgets / dropdowns use. The admin can
#      always edit a line before sending.
#
#   2. A feature add-on catalog. Each entry is a regex matched against
#      the requirement's free-text (SPECIAL_NOTES + MACHINE_NAME +
#      CAPACITY). One hit → one extra line on the quotation, with a
#      sensible price tag.
#
# All amounts are in INR.

CATEGORY_BASE_PRICE = {
    # Snack vending
    "snack":               180_000,
    "snack machine":       180_000,
    "snack vending":       180_000,

    # Beverage vending (cold drinks)
    "beverage":            200_000,
    "beverage machine":    200_000,
    "beverage vending":    200_000,

    # Combo (snack + beverage)
    "combo":               350_000,
    "combo machine":       350_000,
    "snack-beverage":      350_000,
    "snack & beverage":    350_000,
    "snack and beverage":  350_000,

    # Hot beverage (coffee / tea)
    "hot-beverage":        280_000,
    "hot beverage":        280_000,
    "coffee":              280_000,
    "coffee machine":      280_000,
    "tea":                 280_000,

    # Specialty
    "medicine":            225_000,
    "medicine machine":    225_000,
    "fruit":               240_000,
    "fruit & veg":         240_000,
    "fruit and veg":       240_000,
    "cosmetics":           195_000,
    "cosmetics machine":   195_000,

    # Custom
    "custom":              400_000,
    "custom machine":      400_000,
    "vending":             250_000,        # generic fallback
}

DEFAULT_BASE_PRICE = 250_000   # absolute fallback if nothing matches


def _category_base_price(category: str) -> float:
    """Look up a reasonable starting price for a machine category."""

    if not category:

        return DEFAULT_BASE_PRICE

    key = category.strip().lower()

    if key in CATEGORY_BASE_PRICE:

        return float(CATEGORY_BASE_PRICE[key])

    # Partial match — useful for free-text inputs like
    # "BVC24 Snack & Beverage Combo SS&B-001"
    for k, v in CATEGORY_BASE_PRICE.items():

        if k in key or key in k:

            return float(v)

    return DEFAULT_BASE_PRICE


# (regex pattern, label shown on quotation line, unit price INR, HSN code)
FEATURE_CATALOG = [
    (
        r"\b(cashless|upi|debit\s*card|credit\s*card|card\s*payment|qr\s*payment|qr\s*code)\b",
        "Cashless payment system (UPI / Card / QR)",
        15_000,
        "84709010"
    ),
    (
        r"\b(remote\s+(monitor|inventor)|iot|real[-\s]?time\s+monitor|smart\s+monitor|live\s+inventor)\b",
        "Remote inventory monitoring (IoT module)",
        25_000,
        "85176290"
    ),
    (
        r"\b(energy[-\s]?efficient|low\s+power|eco[-\s]?mode|green\s+power|power\s+saving)\b",
        "Energy-efficient operation (low-power mode)",
        12_000,
        None
    ),
    (
        r"\b(touch[-\s]?screen|hd\s+display|hd\s+screen|interactive\s+screen)\b",
        "Touchscreen interface (HD display)",
        18_000,
        "85285900"
    ),
    (
        r"\b(refriger|chiller|cooling\s+unit|cold\s+storage|cold\s+drink)\b",
        "Refrigeration / chiller unit (4–8°C)",
        22_000,
        "84189900"
    ),
    (
        r"\b(24/?7|round[-\s]?the[-\s]?clock|all[-\s]?day\s+operation|continuous\s+operation)\b",
        "24/7 operation capability (heavy-duty)",
        8_000,
        None
    ),
    (
        r"\b(brand|logo|custom[-\s]?paint|wrap|decal|sticker|skin)\b",
        "Custom branding (decals / logo paint)",
        10_000,
        None
    ),
    (
        r"\b(install|setup|on[-\s]?site|deployment|commissioning)\b",
        "On-site installation & commissioning",
        12_000,
        "998873"
    ),
    (
        r"\b(amc|maintenance|service\s+contract|extended\s+warranty)\b",
        "Annual Maintenance Contract (1 year)",
        30_000,
        "998719"
    ),
    (
        r"\b(restock|refill|replenish)\b",
        "Restocking service (weekly, 1 year)",
        18_000,
        "998719"
    ),
    (
        r"\b(train|orientation|user\s+training)\b",
        "Staff training session",
        5_000,
        "999293"
    ),
    (
        r"\b(led|lighting|interior\s+light|illuminated)\b",
        "LED interior illumination",
        4_000,
        None
    ),
    (
        r"\b(coin\s+accept|coin\s+mech|cash\s+accept|bill\s+accept|note\s+accept)\b",
        "Coin / note acceptor module",
        16_000,
        "84709010"
    ),
]


def _detect_features(req) -> list:
    """Scan a CustomerRequirement's free-text fields for feature
    keywords and return a list of {description, qty, unit_price, hsn}.

    Each match shows up as its own line on the quotation so the customer
    sees what they're paying for (instead of one opaque lump sum)."""

    haystack = " ".join(
        str(s or "") for s in (
            req.SPECIAL_NOTES, req.MACHINE_NAME, req.CAPACITY,
            req.MACHINE_CATEGORY
        )
    ).lower()

    if not haystack.strip():

        return []

    found = []

    seen_labels = set()

    for pattern, label, price, hsn in FEATURE_CATALOG:

        if re.search(pattern, haystack, flags=re.IGNORECASE):

            if label in seen_labels:

                continue

            seen_labels.add(label)

            found.append({
                "description": label,
                "qty": 1.0,
                "unit_price": float(price),
                "hsn": hsn
            })

    return found


def _default_terms_and_conditions(validity_days: int) -> str:
    """Sensible default T&C for an auto-generated quotation.

    Covers the three things every BVC24 quotation needs: warranty,
    payment milestones, and delivery window. Sales can edit them
    before sending if a customer negotiated different terms."""

    return (
        f"1. Warranty: 12 months on manufacturing defects from date of installation.\n"
        f"2. Payment Terms: 50% advance with PO, 40% before dispatch, "
        f"10% on installation & sign-off.\n"
        f"3. Delivery: Within {validity_days} days from receipt of advance "
        f"and confirmed BOM.\n"
        f"4. Prices are exclusive of GST and freight (unless explicitly stated).\n"
        f"5. Validity: This quotation is valid for {validity_days} days from "
        f"the quotation date.\n"
        f"6. Installation & training at site included within 100km radius."
    )


@router.post("/quotations/auto-generate")
def auto_generate_quotation(
    data: AutoGenerateQuotation,
    db: Session = Depends(get_db)
):
    """One-shot auto-generation of a quotation from a customer's
    active requirements.

    Flow:
      1. Validate customer exists.
      2. Fetch all requirements with STATUS in (DRAFT, CONFIRMED,
         QUOTED). Skip ORDERED / CANCELLED.
      3. Build one quotation line per requirement.
         - If PRODUCT_MODEL_ID is set: price = TARGET_UNIT_PRICE
           or compute_unit_price_from_bom().
         - Otherwise: free-text line from MACHINE_CATEGORY with
           TARGET_UNIT_PRICE (0 if missing).
      4. Recompute totals.
      5. If AUTO_SEND_EMAIL=true and customer has an EMAIL → flip
         STATUS=SENT, ensure PUBLIC_TOKEN, dispatch email.
      6. Mark consumed requirements as QUOTED.
      7. Notify MD on WhatsApp (best-effort)."""

    # --- 1. Customer ---
    customer = db.query(Customer).filter(
        Customer.ID == data.CUSTOMER_ID
    ).first()

    if not customer:

        raise HTTPException(status_code=404, detail="Customer not found")

    # --- 2. Requirements ---
    requirements = db.query(CustomerRequirement).filter(
        CustomerRequirement.CUSTOMER_ID == data.CUSTOMER_ID,
        CustomerRequirement.STATUS.in_(AUTO_GEN_REQUIREMENT_STATUSES)
    ).order_by(
        CustomerRequirement.CREATED_AT.asc(),
        CustomerRequirement.ID.asc()
    ).all()

    if not requirements:

        raise HTTPException(
            status_code=400,
            detail="Customer has no active requirements to quote"
        )

    warnings: list = []

    vendor_id = customer.VENDOR_ID or 1

    quotation_date = data.QUOTATION_DATE or date.today()

    validity_days = data.VALIDITY_DAYS or 30

    margin = float(data.MARGIN_PERCENT or 25.0)

    # --- 3. Header ---
    notes = data.NOTES or (
        f"Auto-generated from customer requirements "
        f"on {quotation_date.isoformat()}."
    )

    q = Quotation(
        QUOTATION_NUMBER=_next_quotation_number(db, vendor_id),
        CUSTOMER_ID=customer.ID,
        QUOTATION_DATE=quotation_date,
        VALIDITY_DAYS=validity_days,
        DISCOUNT_PERCENT=float(data.DISCOUNT_PERCENT or 0.0),
        TAX_PERCENT=18.0,
        TERMS_AND_CONDITIONS=_default_terms_and_conditions(validity_days),
        NOTES=notes,
        PREPARED_BY=customer.ASSIGNED_SALES_ID,
        VENDOR_ID=vendor_id,
        STATUS="DRAFT"
    )

    _set_expiry(q)

    db.add(q)

    db.flush()

    # --- 4. Lines ---
    # Each requirement spawns ONE machine line + N feature lines (auto-
    # detected from the requirement's free text). This way the customer
    # sees exactly what they're paying for instead of one opaque lump.
    line_sort = 0

    for r in requirements:

        # ---- 4a. Machine line — base price ----
        if r.PRODUCT_MODEL_ID:

            product = db.query(ProductModel).filter(
                ProductModel.ID == r.PRODUCT_MODEL_ID
            ).first()

            # Price precedence:
            #   1. Customer's TARGET_UNIT_PRICE (explicit budget)
            #   2. BOM rollup × margin
            #   3. Category default (covers empty-BOM products)
            if r.TARGET_UNIT_PRICE:

                unit_price = float(r.TARGET_UNIT_PRICE)

            else:

                unit_price = compute_unit_price_from_bom(
                    db, r.PRODUCT_MODEL_ID,
                    margin_pct=margin,
                    vendor_id=vendor_id
                )

                if unit_price == 0.0 and product:

                    unit_price = _category_base_price(product.CATEGORY)

                    warnings.append(
                        f"Requirement #{r.ID}: BOM is empty for product "
                        f"#{r.PRODUCT_MODEL_ID} — used category default "
                        f"price (₹{unit_price:,.0f}). Edit before sending "
                        f"if needed."
                    )

            description = (
                f"{product.MODEL_NAME} ({product.MODEL_CODE})"
                if product else (r.MACHINE_NAME or f"Product #{r.PRODUCT_MODEL_ID}")
            )

            if r.CAPACITY:

                description += f" — {r.CAPACITY}"

            hsn = DEFAULT_VENDING_MACHINE_HSN

        else:

            # ---- No ProductModel — chatbot / portal intake ----
            # Use TARGET_UNIT_PRICE if provided, else look up by category
            if r.TARGET_UNIT_PRICE:

                unit_price = float(r.TARGET_UNIT_PRICE)

            else:

                unit_price = _category_base_price(r.MACHINE_CATEGORY)

                if unit_price == DEFAULT_BASE_PRICE:

                    warnings.append(
                        f"Requirement #{r.ID}: category "
                        f"'{r.MACHINE_CATEGORY}' didn't match the pricing "
                        f"catalog — used generic default "
                        f"(₹{unit_price:,.0f}). Edit before sending."
                    )

            # Build a clean machine label (without dumping the whole
            # special-notes blob into the description — features get
            # their own lines below).
            parts = []

            if r.MACHINE_NAME:

                # Take just the first segment if customer pasted multiple
                # model names separated by spaces / commas
                first_name = re.split(r"[,;\n]| {2,}", r.MACHINE_NAME)[0].strip()

                parts.append(first_name or r.MACHINE_NAME)

            if r.MACHINE_CATEGORY:

                parts.append(f"({r.MACHINE_CATEGORY})")

            if r.CAPACITY:

                parts.append(f"— {r.CAPACITY}")

            description = " ".join(parts) or (
                r.MACHINE_CATEGORY or f"Vending Machine (Requirement #{r.ID})"
            )

            hsn = DEFAULT_VENDING_MACHINE_HSN

        machine_line = QuotationLine(
            QUOTATION_ID=q.ID,
            PRODUCT_MODEL_ID=r.PRODUCT_MODEL_ID,
            REQUIREMENT_ID=r.ID,
            DESCRIPTION=description[:500],
            HSN_CODE=hsn,
            QUANTITY=float(r.QUANTITY or 1),
            UNIT="nos",
            UNIT_PRICE=unit_price,
            DISCOUNT_PERCENT=0.0,
            SORT_ORDER=line_sort
        )

        machine_line.LINE_TOTAL = _compute_line_total(machine_line)

        db.add(machine_line)

        line_sort += 1

        # ---- 4b. Feature lines — detected from free-text ----
        # Each detected feature becomes its own quotation line with
        # qty = machine qty (1 cashless module per machine, etc.).
        machine_qty = float(r.QUANTITY or 1)

        for feat in _detect_features(r):

            feat_line = QuotationLine(
                QUOTATION_ID=q.ID,
                PRODUCT_MODEL_ID=None,
                REQUIREMENT_ID=r.ID,
                DESCRIPTION=feat["description"][:500],
                HSN_CODE=feat["hsn"],
                QUANTITY=feat["qty"] * machine_qty,
                UNIT="nos",
                UNIT_PRICE=feat["unit_price"],
                DISCOUNT_PERCENT=0.0,
                SORT_ORDER=line_sort
            )

            feat_line.LINE_TOTAL = _compute_line_total(feat_line)

            db.add(feat_line)

            line_sort += 1

    db.flush()

    _recompute_quotation_totals(db, q)

    _log_activity(
        db, q.ID, "CREATED",
        detail=(
            f"Auto-generated from {len(requirements)} requirement(s) "
            f"(margin {margin}%)"
        )
    )

    # --- 5. Optional email send ---
    email_sent = False

    email_status = "not_attempted"

    public_url = None

    if data.AUTO_SEND_EMAIL:

        if not customer.EMAIL:

            warnings.append(
                "Customer has no EMAIL on file — quotation stays DRAFT, "
                "email skipped."
            )

            email_status = "skipped_no_email"

            _log_activity(
                db, q.ID, "EMAIL_SKIPPED",
                detail="No customer EMAIL on file"
            )

        else:

            q.STATUS = "SENT"

            q.SENT_AT = datetime.utcnow()

            _ensure_public_token(q)

            public_url = _public_url(q.PUBLIC_TOKEN)

            ok, msg = _send_quotation_email(db, q)

            q.LAST_EMAIL_STATUS = msg[:200] if msg else None

            email_sent = ok

            email_status = msg or ("sent" if ok else "failed")

            if ok:

                q.EMAIL_SENT_AT = datetime.utcnow()

                q.EMAIL_SENT_COUNT = (q.EMAIL_SENT_COUNT or 0) + 1

                _log_activity(
                    db, q.ID, "SENT",
                    detail=f"Auto-sent to {customer.EMAIL}"
                )

                _log_activity(
                    db, q.ID, "EMAIL_SENT",
                    detail=f"Email delivered ({msg})"
                )

            else:

                # Keep STATUS=SENT (sales rep can resend); record the
                # failure so the UI shows it.
                _log_activity(
                    db, q.ID, "EMAIL_FAILED",
                    detail=f"Auto-send failed: {msg}"
                )

                warnings.append(
                    f"Email send failed: {msg}. Use Resend on the "
                    f"quotation detail screen."
                )

    # --- 6. Mark requirements as QUOTED ---
    requirement_ids = [r.ID for r in requirements]

    if requirement_ids:

        db.query(CustomerRequirement).filter(
            CustomerRequirement.ID.in_(requirement_ids)
        ).update(
            {"STATUS": "QUOTED"}, synchronize_session=False
        )

    db.commit()

    db.refresh(q)

    # --- 7. WhatsApp MD notification (best-effort, never blocks) ---
    try:

        from app.services.whatsapp_service import notify_md_safe

        prepared_label = (
            f"by {customer.ASSIGNED_SALES_ID}"
            if customer.ASSIGNED_SALES_ID else "automatically"
        )

        notify_md_safe(
            f"📄 *Quotation Auto-Generated — BVC24*\n\n"
            f"📑 *{q.QUOTATION_NUMBER}*\n"
            f"🏢 Customer: *{customer.CUSTOMER_NAME}*\n"
            f"📦 Lines: {len(requirements)} from active requirements\n"
            f"💰 Grand Total: Rs. {q.GRAND_TOTAL:,.2f}\n"
            f"📌 Status: {q.STATUS}\n"
            f"✉️ Email: {'sent' if email_sent else email_status}\n"
            f"🧑‍💼 Prepared {prepared_label}"
        )

    except Exception:

        # Best-effort: never fail the response because WhatsApp is down
        pass

    # --- 8. Response ---
    requirements_used = [
        {
            "ID": r.ID,
            "QUANTITY": r.QUANTITY,
            "MACHINE_NAME": r.MACHINE_NAME,
            "MACHINE_CATEGORY": r.MACHINE_CATEGORY,
            "STATUS": "QUOTED"
        }
        for r in requirements
    ]

    if email_sent:

        message = (
            f"Quotation {q.QUOTATION_NUMBER} auto-generated from "
            f"{len(requirements)} requirement(s) and sent to "
            f"{customer.EMAIL}"
        )

    else:

        message = (
            f"Quotation {q.QUOTATION_NUMBER} auto-generated from "
            f"{len(requirements)} requirement(s) "
            f"(STATUS={q.STATUS}, email={email_status})"
        )

    return {
        "message": message,
        "quotation_id": q.ID,
        "quotation_number": q.QUOTATION_NUMBER,
        "quotation": _serialize_quotation(db, q, include_lines=True),
        "lines_count": len(requirements),
        "email_sent": email_sent,
        "email_status": email_status,
        "public_url": public_url,
        "requirements_used": requirements_used,
        "warnings": warnings
    }


# =========================
# Dashboard stats
# =========================

@router.get("/quotations-dashboard-stats")
@router.get("/quotations/dashboard-stats")
def quotation_dashboard_stats(
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """Counter tiles for the Quotations dashboard.

    Two paths register the same handler so frontend can call either
    /quotations-dashboard-stats (hyphen — no risk of colliding with
    the /quotations/{id} dynamic route) or the nicer-looking
    /quotations/dashboard-stats. FastAPI matches /quotations/{id}
    first by registration order; when 'dashboard-stats' fails int
    conversion FastAPI returns 422, so the hyphenated path is what
    we recommend frontend use.

    All counts respect the optional vendor_id filter so a
    multi-tenant deployment can show per-tenant numbers. MTD_VALUE
    is the sum of GRAND_TOTAL for quotations CREATED in the current
    calendar month."""

    base = db.query(Quotation)

    if vendor_id:

        base = base.filter(Quotation.VENDOR_ID == vendor_id)

    today = date.today()

    month_start = today.replace(day=1)

    # GENERATED_TODAY: any quotation created today (regardless of
    # whether it was sent immediately).
    generated_today = base.filter(
        func.date(Quotation.CREATED_AT) == today
    ).count()

    # SENT_TOTAL: anything that has been pushed out to the customer
    # at least once (including downstream states).
    sent_statuses = ("SENT", "VIEWED", "APPROVED", "CONVERTED", "NEGOTIATION")

    sent_total = base.filter(Quotation.STATUS.in_(sent_statuses)).count()

    # VIEWED_TOTAL: customer actually opened the public link.
    viewed_total = base.filter(
        (Quotation.VIEW_COUNT.isnot(None)) & (Quotation.VIEW_COUNT > 0)
    ).count()

    approved_total = base.filter(Quotation.STATUS == "APPROVED").count()

    rejected_total = base.filter(Quotation.STATUS == "REJECTED").count()

    # PENDING: out the door but customer hasn't decided yet.
    pending_total = base.filter(
        Quotation.STATUS.in_(("SENT", "VIEWED"))
    ).count()

    converted_total = base.filter(Quotation.STATUS == "CONVERTED").count()

    # MTD_VALUE: sum of GRAND_TOTAL for quotations created this month.
    mtd_value = (
        base.filter(Quotation.CREATED_AT >= month_start)
            .with_entities(func.coalesce(func.sum(Quotation.GRAND_TOTAL), 0.0))
            .scalar()
    )

    return {
        "GENERATED_TODAY": int(generated_today or 0),
        "SENT_TOTAL": int(sent_total or 0),
        "VIEWED_TOTAL": int(viewed_total or 0),
        "APPROVED_TOTAL": int(approved_total or 0),
        "REJECTED_TOTAL": int(rejected_total or 0),
        "PENDING_TOTAL": int(pending_total or 0),
        "CONVERTED_TOTAL": int(converted_total or 0),
        "MTD_VALUE": round(float(mtd_value or 0.0), 2),
        "AS_OF": datetime.utcnow().isoformat()
    }


# =========================
# Pricing breakdown (diagnostics)
# =========================

@router.get("/quotations-pricing-breakdown")
@router.get("/quotations/pricing-breakdown")
def quotation_pricing_breakdown(
    product_model_id: int = Query(...),
    margin_percent: float = Query(25.0),
    vendor_id: int = Query(1),
    db: Session = Depends(get_db)
):
    """Itemized 'why is this price what it is?' breakdown for a
    ProductModel. Powers tooltips and the chatbot's pricing answers."""

    product = db.query(ProductModel).filter(
        ProductModel.ID == product_model_id
    ).first()

    if not product:

        raise HTTPException(status_code=404, detail="Product not found")

    breakdown = get_product_pricing_breakdown(
        db, product_model_id,
        margin_pct=margin_percent,
        vendor_id=vendor_id
    )

    breakdown["model_name"] = product.MODEL_NAME

    breakdown["model_code"] = product.MODEL_CODE

    return breakdown
