"""Customer Master — a simplified, /project-categories-style master-data
page over the `customer` table. This is now the sole CRUD surface for
customers (the older /customers admin page was retired in favor of this
one — GET /customers in routes/project.py survives only as a read-only
picker data source for Quotations/SalesOrders/Projects/InvoiceOrder).
Own route prefix and own RBAC codes (customer.master.*). See
CustomFieldsModal-driven Custom Field Configuration for anything beyond
the fixed core columns below."""

from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database.database import get_db
from app.utils.db_error_handler import raise_db_error
from app.auth.auth_bearer import require
from app.models.models import Customer, CustomFieldTableValue
from app.routes.project_template import (
    _cf_fields_for_table, _upsert_cf_bulk, _validate_cf_value, _parse_bulk_xl, _cell,
)
from app.routes.project import _md_recipient_email, _build_customer_profile_email_html

router = APIRouter(prefix="/customer-master", tags=["Customer Master"])

_CF_TABLE = "customer_master"
_CUST_STD_COLS = {
    "S.NO", "S.N", "SN", "",
    "NAME", "COMPANY NAME", "PHONE NUMBER", "EMAIL", "ADDRESS", "GST NUMBER",
    "CITY", "STATE", "PINCODE", "COUNTRY ISO",
}


# ── Schemas ──────────────────────────────────────────────────────────────────

class CustomerMasterCreate(BaseModel):
    NAME: str
    PHONE_NUMBER: str
    EMAIL: str
    ADDRESS: str
    COMPANY_NAME: Optional[str] = None
    GST_NUMBER: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY_ISO: Optional[str] = None
    VENDOR_ID: int = 1
    CUSTOM_FIELDS: Optional[dict] = None


class CustomerMasterUpdate(BaseModel):
    NAME: Optional[str] = None
    COMPANY_NAME: Optional[str] = None
    PHONE_NUMBER: Optional[str] = None
    EMAIL: Optional[str] = None
    ADDRESS: Optional[str] = None
    GST_NUMBER: Optional[str] = None
    CITY: Optional[str] = None
    STATE: Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY_ISO: Optional[str] = None
    CUSTOM_FIELDS: Optional[dict] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _serialize(c: Customer) -> dict:
    return {
        "ID": c.ID,
        "VENDOR_ID": c.VENDOR_ID,
        "NAME": c.NAME,
        "COMPANY_NAME": c.COMPANY_NAME,
        "PHONE_NUMBER": c.PHONE_NUMBER,
        "EMAIL": c.EMAIL,
        "ADDRESS": c.ADDRESS,
        "GST_NUMBER": c.GST_NUMBER,
        "CITY": c.CITY,
        "STATE": c.STATE,
        "PINCODE": c.PINCODE,
        "COUNTRY_ISO": c.COUNTRY_ISO,
        "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None,
        "UPDATED_AT": c.UPDATED_AT.isoformat() if c.UPDATED_AT else None,
    }


def _get_or_404(db: Session, customer_id: str) -> Customer:
    c = db.query(Customer).filter(Customer.ID == customer_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    return c


def _apply_custom_fields(db: Session, customer_id: str, vendor_id: int, custom_fields: Optional[dict]):
    if not custom_fields:
        return
    fields_by_id = {f.ID: f for f in _cf_fields_for_table(_CF_TABLE, vendor_id, db)}
    for cf_id, value in custom_fields.items():
        field = fields_by_id.get(cf_id)
        if field:
            err = _validate_cf_value(field, value)
            if err:
                raise HTTPException(status_code=400, detail=f"{field.FIELD_NAME}: {err}")
        _upsert_cf_bulk(customer_id, _CF_TABLE, cf_id, value, db)


def _create_customer_row(
    db: Session,
    *,
    name: str,
    phone_number: str,
    email: str,
    address: str,
    company_name: Optional[str] = None,
    gst_number: Optional[str] = None,
    city: Optional[str] = None,
    state: Optional[str] = None,
    pincode: Optional[str] = None,
    country_iso: Optional[str] = None,
    vendor_id: int = 1,
    custom_fields: Optional[dict] = None,
) -> Customer:
    """Build + add + flush a new Customer row and apply its Customer Master
    Custom Field values — WITHOUT committing. The caller owns the transaction
    boundary: create_customer_master() below commits immediately and fires
    its own notification (unchanged behavior); the Lead-conversion endpoint
    (lead_management.convert_lead) flushes here and commits later alongside
    the Lead/assignment writes, so a failure anywhere in that larger
    transaction rolls this insert back too.

    Raises whatever _apply_custom_fields/db.flush() raise (HTTPException for
    a bad custom-field value, IntegrityError for a DB constraint) — the
    caller decides how to translate/roll back."""
    cust = Customer(
        NAME=name.strip(),
        COMPANY_NAME=(company_name or None),
        PHONE_NUMBER=phone_number.strip(),
        EMAIL=email.strip(),
        ADDRESS=address.strip(),
        GST_NUMBER=(gst_number or None),
        CITY=(city or None),
        STATE=(state or None),
        PINCODE=(pincode or None),
        COUNTRY_ISO=(country_iso or None),
        VENDOR_ID=vendor_id,
    )
    db.add(cust)
    db.flush()
    _apply_custom_fields(db, cust.ID, vendor_id, custom_fields)
    return cust


def _find_duplicate_customer(
    db: Session,
    vendor_id: int,
    *,
    phone_number: Optional[str] = None,
    email: Optional[str] = None,
    company_name: Optional[str] = None,
    gst_number: Optional[str] = None,
    exclude_customer_id: Optional[str] = None,
) -> Optional[tuple[Customer, str]]:
    """Returns (conflicting_row, field_name) for the first of
    PHONE_NUMBER/EMAIL/COMPANY_NAME/GST_NUMBER that already belongs to
    ANOTHER Customer Master row under the same vendor, or None if clear.
    exclude_customer_id excludes the record currently being edited (so
    saving a customer's own unchanged data is never flagged as a
    duplicate of itself). Blank/None values are never checked — an empty
    COMPANY_NAME or GST_NUMBER is not a "duplicate"."""
    checks = [
        ("PHONE_NUMBER", phone_number, Customer.PHONE_NUMBER),
        ("EMAIL", email, Customer.EMAIL),
        ("COMPANY_NAME", company_name, Customer.COMPANY_NAME),
        ("GST_NUMBER", gst_number, Customer.GST_NUMBER),
    ]
    for field_name, value, column in checks:
        value = (value or "").strip()
        if not value:
            continue
        q = db.query(Customer).filter(
            Customer.VENDOR_ID == vendor_id,
            column == value,
        )
        if exclude_customer_id:
            q = q.filter(Customer.ID != exclude_customer_id)
        match = q.first()
        if match:
            return match, field_name
    return None


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("", dependencies=[Depends(require("customer.master.view"))])
def list_customer_masters(
    vendor_id: int = Query(1),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Customer).filter(Customer.VENDOR_ID == vendor_id)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            Customer.NAME.ilike(term)
            | Customer.COMPANY_NAME.ilike(term)
            | Customer.PHONE_NUMBER.ilike(term)
            | Customer.EMAIL.ilike(term)
        )
    rows = q.order_by(Customer.NAME).all()
    return [_serialize(c) for c in rows]


@router.get("/{customer_id}", dependencies=[Depends(require("customer.master.view"))])
def get_customer_master(customer_id: str, db: Session = Depends(get_db)):
    return _serialize(_get_or_404(db, customer_id))


@router.post("", status_code=201, dependencies=[Depends(require("customer.master.create"))])
def create_customer_master(data: CustomerMasterCreate, db: Session = Depends(get_db)):
    try:
        cust = _create_customer_row(
            db,
            name=data.NAME, phone_number=data.PHONE_NUMBER, email=data.EMAIL, address=data.ADDRESS,
            company_name=data.COMPANY_NAME, gst_number=data.GST_NUMBER, vendor_id=data.VENDOR_ID,
            city=data.CITY, state=data.STATE, pincode=data.PINCODE, country_iso=data.COUNTRY_ISO,
            custom_fields=data.CUSTOM_FIELDS,
        )
        db.commit()
        db.refresh(cust)
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "create customer")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "create customer")

    # 📲 Notify MD about the new customer — same fire-and-forget
    # WhatsApp + email pattern the old /create-customer route used.
    # Never let a notification failure block the customer-save response.
    result = {"message": "Customer created", **_serialize(cust)}
    try:
        from app.services.whatsapp_service import notify_md_safe

        notify_md_safe(
            f"✅ *New Customer Registered — BVC24*\n\n"
            f"🏢 *{cust.NAME}*\n"
            f"📞 {cust.PHONE_NUMBER}\n"
            + (f"📧 {cust.EMAIL}\n" if cust.EMAIL else "")
        )

        md_target = _md_recipient_email()
        if md_target:
            from app.services.email_service import send_alert_email

            html = _build_customer_profile_email_html(cust)
            subject = f"New Customer Registered — {cust.NAME}"
            ok, msg = send_alert_email(subject, html, recipient=md_target)
            result["email_sent"] = ok
            result["email_message"] = msg
            result["email_recipient"] = md_target
    except Exception as notify_exc:
        result["email_sent"] = False
        result["email_message"] = f"notification skipped: {notify_exc}"

    return result


@router.put("/{customer_id}", dependencies=[Depends(require("customer.master.update"))])
def update_customer_master(
    customer_id: str,
    data: CustomerMasterUpdate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
):
    cust = _get_or_404(db, customer_id)

    if data.NAME is not None: cust.NAME = data.NAME.strip()
    if data.COMPANY_NAME is not None: cust.COMPANY_NAME = data.COMPANY_NAME.strip() or None
    if data.PHONE_NUMBER is not None: cust.PHONE_NUMBER = data.PHONE_NUMBER.strip()
    if data.EMAIL is not None: cust.EMAIL = data.EMAIL.strip()
    if data.ADDRESS is not None: cust.ADDRESS = data.ADDRESS.strip()
    if data.GST_NUMBER is not None: cust.GST_NUMBER = data.GST_NUMBER.strip() or None
    if data.CITY is not None: cust.CITY = data.CITY.strip() or None
    if data.STATE is not None: cust.STATE = data.STATE.strip() or None
    if data.PINCODE is not None: cust.PINCODE = data.PINCODE.strip() or None
    if data.COUNTRY_ISO is not None: cust.COUNTRY_ISO = data.COUNTRY_ISO.strip() or None

    try:
        _apply_custom_fields(db, cust.ID, vendor_id, data.CUSTOM_FIELDS)
        db.commit()
        db.refresh(cust)
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "update customer")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "update customer")
    return {"message": "Customer updated", **_serialize(cust)}


@router.delete("/{customer_id}", dependencies=[Depends(require("customer.master.delete"))])
def delete_customer_master(customer_id: str, db: Session = Depends(get_db)):
    """Delete a customer, unlinking historical/financial rows first
    (preserves their audit value instead of hard-failing) — ported
    from the old /delete-customer/{id} route:
      * quotation                         — sales pipeline audit
      * sales_order                       — financial audit
    """
    cust = _get_or_404(db, customer_id)
    db.query(CustomFieldTableValue).filter(
        CustomFieldTableValue.TABLE_NAME == _CF_TABLE,
        CustomFieldTableValue.TABLE_ROW_ID == str(customer_id),
    ).delete(synchronize_session=False)
    try:
        db.delete(cust)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        # Some other table still referencing this row surfaces here as
        # a clean 409, not a 500.
        raise_db_error(e, "delete customer")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "delete customer")
    return {"message": "Customer deleted"}


# ── Bulk upload ──────────────────────────────────────────────────────────────

@router.post("/bulk-upload", dependencies=[Depends(require("customer.master.create", "customer.master.import"))])
async def bulk_upload_customer_masters(
    vendor_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Every valid row is a fresh INSERT — a customer name/phone/email has
    no natural dedupe key, so this mirrors Lead Management's bulk-upload
    precedent (no upsert-by-key) rather than Project Categories' upsert
    (which only works because category names are enforced-unique)."""
    content = await file.read()
    headers, data_rows = _parse_bulk_xl(content, "Customers")

    if not headers:
        raise HTTPException(status_code=400, detail="Template has no header row.")

    cf_fields = _cf_fields_for_table(_CF_TABLE, vendor_id, db)
    cf_by_upper = {f.FIELD_NAME.upper(): f for f in cf_fields}
    cf_cols = [name for name in headers if name.upper() not in _CUST_STD_COLS and name.upper() in cf_by_upper]

    inserted = 0
    errors: List[dict] = []

    for row_num, row in enumerate(data_rows, start=2):
        record = {headers[i].upper(): row[i] for i in range(len(headers))}

        name = _cell(record, "NAME")
        phone = _cell(record, "PHONE NUMBER")
        email = _cell(record, "EMAIL")
        address = _cell(record, "ADDRESS")

        row_errors = []
        if not name:
            row_errors.append({"row": row_num, "field": "Name", "message": "Name is required"})
        if not phone:
            row_errors.append({"row": row_num, "field": "Phone Number", "message": "Phone Number is required"})
        if not email:
            row_errors.append({"row": row_num, "field": "Email", "message": "Email is required"})
        if not address:
            row_errors.append({"row": row_num, "field": "Address", "message": "Address is required"})

        cf_vals = {}
        for col_name in cf_cols:
            field = cf_by_upper[col_name.upper()]
            raw_val = _cell(record, col_name)
            err = _validate_cf_value(field, raw_val)
            if err:
                row_errors.append({"row": row_num, "field": field.FIELD_NAME, "message": err})
            elif raw_val:
                cf_vals[field.ID] = raw_val

        if row_errors:
            errors.extend(row_errors)
            continue

        cust = Customer(
            NAME=name,
            PHONE_NUMBER=phone,
            EMAIL=email,
            ADDRESS=address,
            COMPANY_NAME=_cell(record, "COMPANY NAME") or None,
            GST_NUMBER=_cell(record, "GST NUMBER") or None,
            CITY=_cell(record, "CITY") or None,
            STATE=_cell(record, "STATE") or None,
            PINCODE=_cell(record, "PINCODE") or None,
            COUNTRY_ISO=_cell(record, "COUNTRY ISO") or None,
            VENDOR_ID=vendor_id,
        )
        db.add(cust)
        db.flush()
        for cf_id, val in cf_vals.items():
            _upsert_cf_bulk(cust.ID, _CF_TABLE, cf_id, val, db)
        inserted += 1

    db.commit()

    return {
        "message": f"Upload complete: {inserted} inserted, {len(errors)} error(s)",
        "inserted": inserted,
        "updated": 0,
        "skipped": 0,
        "total_rows": inserted + len(errors),
        "errors": errors,
    }
