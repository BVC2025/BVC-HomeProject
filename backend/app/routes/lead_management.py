from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.utils.db_error_handler import raise_db_error
from app.models.lead_models import LeadPollingConfig, Lead, LeadPollingLog
from app.models.models import Employee, Customer, CustomerProjectAssignment
from app.schemas.lead_schema import (
    LeadPollingConfigCreate, LeadPollingConfigUpdate, LivePreviewRequest,
    LeadCreate, LeadUpdate, LeadConvertRequest,
)
from app.services.lead_polling_service import sync_config, preview_leads
from app.auth.auth_bearer import require, has_permission
from app.routes.project_template import (
    _cf_fields_for_table, _upsert_cf_bulk, _validate_cf_value, _parse_bulk_xl, _cell,
)
from app.routes.customer_master import _create_customer_row, _serialize as _serialize_customer_master

router = APIRouter(prefix="/lead-management", tags=["Lead Management"])

_KEY_MASK = "●●●●●●●●"
_VALID_API_TYPES = {"DATE_RANGE", "DATETIME_RANGE", "LAST_24_HOURS"}
_MIN_POLL_INTERVAL_MINUTES = 5  # IndiaMART's own rate-limit floor
_CF_TABLE = "lead"
_LEAD_STD_COLS = {
    "S.NO", "S.N", "SN", "",
    "CONTACT NAME", "CONTACT MOBILE", "CONTACT EMAIL", "COMPANY NAME",
    "ADDRESS", "CITY", "STATE", "PINCODE", "COUNTRY ISO", "GST NUMBER",
    "LEAD MESSAGE", "PRODUCT INTEREST", "LEAD STATUS",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_config(cfg: LeadPollingConfig, mask: bool = True) -> dict:
    return {
        "ID": cfg.ID,
        "VENDOR_ID": cfg.VENDOR_ID,
        "ACCOUNT_LABEL": cfg.ACCOUNT_LABEL,
        "PLATFORM_NAME": cfg.PLATFORM_NAME,
        "BASE_URL": cfg.BASE_URL,
        "ENDPOINT_URL": cfg.ENDPOINT_URL,
        "PULL_API_KEY": _KEY_MASK if mask else cfg.PULL_API_KEY,
        "API_TYPE": cfg.API_TYPE,
        "API_DESCRIPTION": cfg.API_DESCRIPTION,
        "IS_ACTIVE": cfg.IS_ACTIVE,
        "POLL_INTERVAL_MINUTES": cfg.POLL_INTERVAL_MINUTES,
        "LAST_SYNCED_AT": cfg.LAST_SYNCED_AT.isoformat() if cfg.LAST_SYNCED_AT else None,
        "LAST_SYNC_STATUS": cfg.LAST_SYNC_STATUS,
        "LAST_SYNC_MESSAGE": cfg.LAST_SYNC_MESSAGE,
        "LAST_LEAD_COUNT": cfg.LAST_LEAD_COUNT,
        "CONSECUTIVE_FAILURES": cfg.CONSECUTIVE_FAILURES,
        "CREATED_BY_ID": cfg.CREATED_BY_ID,
        "UPDATED_BY_ID": cfg.UPDATED_BY_ID,
        "CREATED_AT": cfg.CREATED_AT.isoformat() if cfg.CREATED_AT else None,
        "UPDATED_AT": cfg.UPDATED_AT.isoformat() if cfg.UPDATED_AT else None,
    }


def _serialize_lead(row: Lead) -> dict:
    return {
        "ID": row.ID,
        "VENDOR_ID": row.VENDOR_ID,
        "LEAD_SOURCE": row.LEAD_SOURCE,
        "CREATED_BY_ID": row.CREATED_BY_ID,
        "ASSIGNED_TO_ID": row.ASSIGNED_TO_ID,
        "EXTERNAL_REFERENCE_ID": row.EXTERNAL_REFERENCE_ID,
        "ENQUIRY_TYPE": row.ENQUIRY_TYPE,
        "ENQUIRY_TIME": row.ENQUIRY_TIME.isoformat() if row.ENQUIRY_TIME else None,
        "CONTACT_NAME": row.CONTACT_NAME,
        "CONTACT_MOBILE": row.CONTACT_MOBILE,
        "CONTACT_EMAIL": row.CONTACT_EMAIL,
        "COMPANY_NAME": row.COMPANY_NAME,
        "ADDRESS": row.ADDRESS,
        "CITY": row.CITY,
        "STATE": row.STATE,
        "PINCODE": row.PINCODE,
        "COUNTRY_ISO": row.COUNTRY_ISO,
        "LEAD_MESSAGE": row.LEAD_MESSAGE,
        "PRODUCT_INTEREST": row.PRODUCT_INTEREST,
        "PROJECT_ID": row.PROJECT_ID,
        "CUSTOMER_ID": row.CUSTOMER_ID,
        "CUSTOMER_ASSIGNMENT_TYPE": row.CUSTOMER_ASSIGNMENT_TYPE,
        "GST_NUMBER": row.GST_NUMBER,
        "LEAD_STATUS": row.LEAD_STATUS,
        "SOURCE_FETCHED_AT": row.SOURCE_FETCHED_AT.isoformat() if row.SOURCE_FETCHED_AT else None,
        "CREATED_AT": row.CREATED_AT.isoformat() if row.CREATED_AT else None,
        "UPDATED_AT": row.UPDATED_AT.isoformat() if row.UPDATED_AT else None,
    }


def _serialize_log(row: LeadPollingLog) -> dict:
    return {
        "ID": row.ID,
        "VENDOR_ID": row.VENDOR_ID,
        "CONFIG_ID": row.CONFIG_ID,
        "POLL_TIME": row.POLL_TIME.isoformat() if row.POLL_TIME else None,
        "API_TYPE": row.API_TYPE,
        "STATUS": row.STATUS,
        "ERROR_MESSAGE": row.ERROR_MESSAGE,
        "ERROR_DETAILS": row.ERROR_DETAILS,
        "RESPONSE_DETAILS": row.RESPONSE_DETAILS,
        "DURATION_MS": row.DURATION_MS,
        "LEAD_COUNT": row.LEAD_COUNT,
        "CREATED_AT": row.CREATED_AT.isoformat() if row.CREATED_AT else None,
    }


def _get_config_or_404(db: Session, config_id: str) -> LeadPollingConfig:
    cfg = db.query(LeadPollingConfig).filter(LeadPollingConfig.ID == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Lead polling configuration not found")
    return cfg


def _get_lead_or_404(db: Session, lead_id: str, payload: dict) -> Lead:
    lead = db.query(Lead).filter(Lead.ID == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if not has_permission(payload, "lead.records.all_lead_view"):
        if lead.ASSIGNED_TO_ID != payload.get("employee_id"):
            # 404, not 403 — a lead outside the caller's scope should
            # look indistinguishable from one that doesn't exist.
            raise HTTPException(status_code=404, detail="Lead not found")
    return lead


def _validate_api_type(api_type: str):
    if api_type not in _VALID_API_TYPES:
        raise HTTPException(status_code=400, detail=f"API_TYPE must be one of {sorted(_VALID_API_TYPES)}")


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date/time value: {value!r} (expected ISO format)")


def _apply_lead_custom_fields(db: Session, lead_id: str, vendor_id: int, custom_fields: Optional[dict]):
    if not custom_fields:
        return
    fields_by_id = {f.ID: f for f in _cf_fields_for_table(_CF_TABLE, vendor_id, db)}
    for cf_id, value in custom_fields.items():
        field = fields_by_id.get(cf_id)
        if field:
            err = _validate_cf_value(field, value)
            if err:
                raise HTTPException(status_code=400, detail=f"{field.FIELD_NAME}: {err}")
        _upsert_cf_bulk(lead_id, _CF_TABLE, cf_id, value, db)


def _resolve_customer_choice(db: Session, vendor_id: int, assignment_type: Optional[str], existing_customer_id: Optional[str]):
    """Validate + resolve a NEW/EXISTING customer-assignment choice.
    Returns (assignment_type_or_None, customer_or_None):
      - assignment_type is None       -> (None, None)          "not decided yet" — legal (deferred to conversion time).
      - assignment_type == "NEW"      -> ("NEW", None)
      - assignment_type == "EXISTING" -> ("EXISTING", <Customer row>)
    Raises HTTPException(400) for an unrecognized type or EXISTING with no
    ID given; HTTPException(404) if the referenced Customer doesn't exist
    for this vendor."""
    if assignment_type is None:
        return None, None
    if assignment_type not in ("NEW", "EXISTING"):
        raise HTTPException(status_code=400, detail="CUSTOMER_ASSIGNMENT_TYPE must be 'NEW' or 'EXISTING'.")
    if assignment_type == "NEW":
        return "NEW", None
    if not existing_customer_id:
        raise HTTPException(status_code=400, detail="EXISTING_CUSTOMER_ID is required when CUSTOMER_ASSIGNMENT_TYPE is 'EXISTING'.")
    customer = db.query(Customer).filter(
        Customer.ID == existing_customer_id, Customer.VENDOR_ID == vendor_id
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Selected customer not found.")
    return "EXISTING", customer


# ── Config CRUD ───────────────────────────────────────────────────────────────

@router.get("/configs")
def list_configs(
    vendor_id: int = Query(1),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _admin=Depends(require("lead.config.view")),
):
    q = db.query(LeadPollingConfig).filter(LeadPollingConfig.VENDOR_ID == vendor_id)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            LeadPollingConfig.ACCOUNT_LABEL.ilike(term)
            | LeadPollingConfig.ENDPOINT_URL.ilike(term)
            | LeadPollingConfig.API_DESCRIPTION.ilike(term)
        )
    rows = q.order_by(LeadPollingConfig.CREATED_AT.desc()).all()
    return [_serialize_config(r) for r in rows]


@router.post("/configs", status_code=201)
def create_config(
    data: LeadPollingConfigCreate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    admin=Depends(require("lead.config.manage")),
):
    _validate_api_type(data.API_TYPE)
    if data.POLL_INTERVAL_MINUTES < _MIN_POLL_INTERVAL_MINUTES:
        raise HTTPException(
            status_code=400,
            detail=f"Polling interval must be at least {_MIN_POLL_INTERVAL_MINUTES} minutes (IndiaMART's own rate limit).",
        )

    label = data.ACCOUNT_LABEL.strip()
    existing = db.query(LeadPollingConfig).filter(
        LeadPollingConfig.VENDOR_ID == vendor_id,
        LeadPollingConfig.ACCOUNT_LABEL == label,
        LeadPollingConfig.API_TYPE == data.API_TYPE,
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A configuration named '{label}' with API type '{data.API_TYPE}' already exists for this vendor.",
        )

    employee_id = admin.get("employee_id")
    cfg = LeadPollingConfig(
        VENDOR_ID=vendor_id,
        ACCOUNT_LABEL=label,
        PLATFORM_NAME=(data.PLATFORM_NAME or "IndiaMART").strip(),
        BASE_URL=data.BASE_URL.strip(),
        ENDPOINT_URL=data.ENDPOINT_URL.strip(),
        PULL_API_KEY=data.PULL_API_KEY.strip(),
        API_TYPE=data.API_TYPE,
        API_DESCRIPTION=(data.API_DESCRIPTION.strip() if data.API_DESCRIPTION else None),
        IS_ACTIVE=data.IS_ACTIVE,
        POLL_INTERVAL_MINUTES=data.POLL_INTERVAL_MINUTES,
        CREATED_BY_ID=employee_id,
        UPDATED_BY_ID=employee_id,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"message": "Lead polling configuration created", **_serialize_config(cfg)}


@router.get("/configs/{config_id}")
def get_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(require("lead.config.view"))):
    return _serialize_config(_get_config_or_404(db, config_id))


@router.put("/configs/{config_id}")
def update_config(
    config_id: str,
    data: LeadPollingConfigUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require("lead.config.manage")),
):
    cfg = _get_config_or_404(db, config_id)

    new_label = data.ACCOUNT_LABEL.strip() if data.ACCOUNT_LABEL is not None else cfg.ACCOUNT_LABEL
    new_type = data.API_TYPE if data.API_TYPE is not None else cfg.API_TYPE
    if data.API_TYPE is not None:
        _validate_api_type(data.API_TYPE)
    if new_label != cfg.ACCOUNT_LABEL or new_type != cfg.API_TYPE:
        conflict = db.query(LeadPollingConfig).filter(
            LeadPollingConfig.VENDOR_ID == cfg.VENDOR_ID,
            LeadPollingConfig.ACCOUNT_LABEL == new_label,
            LeadPollingConfig.API_TYPE == new_type,
            LeadPollingConfig.ID != config_id,
        ).first()
        if conflict:
            raise HTTPException(
                status_code=409,
                detail=f"A configuration named '{new_label}' with API type '{new_type}' already exists for this vendor.",
            )

    if data.ACCOUNT_LABEL is not None: cfg.ACCOUNT_LABEL = new_label
    if data.PLATFORM_NAME is not None: cfg.PLATFORM_NAME = data.PLATFORM_NAME.strip()
    if data.BASE_URL is not None: cfg.BASE_URL = data.BASE_URL.strip()
    if data.ENDPOINT_URL is not None: cfg.ENDPOINT_URL = data.ENDPOINT_URL.strip()
    # Only update the key when a non-empty value is provided — blank preserves the existing key.
    if data.PULL_API_KEY and data.PULL_API_KEY.strip():
        cfg.PULL_API_KEY = data.PULL_API_KEY.strip()
    if data.API_TYPE is not None: cfg.API_TYPE = new_type
    if data.API_DESCRIPTION is not None: cfg.API_DESCRIPTION = data.API_DESCRIPTION.strip() or None
    if data.IS_ACTIVE is not None: cfg.IS_ACTIVE = data.IS_ACTIVE
    if data.POLL_INTERVAL_MINUTES is not None:
        if data.POLL_INTERVAL_MINUTES < _MIN_POLL_INTERVAL_MINUTES:
            raise HTTPException(
                status_code=400,
                detail=f"Polling interval must be at least {_MIN_POLL_INTERVAL_MINUTES} minutes (IndiaMART's own rate limit).",
            )
        cfg.POLL_INTERVAL_MINUTES = data.POLL_INTERVAL_MINUTES

    cfg.UPDATED_BY_ID = admin.get("employee_id")
    db.commit()
    db.refresh(cfg)
    return {"message": "Lead polling configuration updated", **_serialize_config(cfg)}


@router.delete("/configs/{config_id}")
def delete_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(require("lead.config.manage"))):
    cfg = _get_config_or_404(db, config_id)
    db.delete(cfg)
    db.commit()
    return {"message": "Lead polling configuration deleted"}


@router.post("/configs/{config_id}/activate")
def activate_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(require("lead.config.manage"))):
    cfg = _get_config_or_404(db, config_id)
    cfg.IS_ACTIVE = True
    db.commit()
    return {"message": "Configuration activated", **_serialize_config(cfg)}


@router.post("/configs/{config_id}/deactivate")
def deactivate_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(require("lead.config.manage"))):
    cfg = _get_config_or_404(db, config_id)
    cfg.IS_ACTIVE = False
    db.commit()
    return {"message": "Configuration deactivated", **_serialize_config(cfg)}


# ── Operational routes (polling) ─────────────────────────────────────────────

@router.post("/configs/{config_id}/sync-now")
def sync_now(config_id: str, db: Session = Depends(get_db), _admin=Depends(require("lead.config.manage"))):
    """Manually trigger a poll for a single config — useful for testing without waiting for the scheduler."""
    cfg = _get_config_or_404(db, config_id)
    ok, message, detail = sync_config(db, cfg, store=True)
    if not ok:
        raise HTTPException(status_code=502, detail=message)
    return {"message": message, **detail}


@router.post("/live-preview")
def live_preview(data: LivePreviewRequest, db: Session = Depends(get_db), _admin=Depends(require("lead.live.view"))):
    """Live Lead Viewer passthrough — calls the source API directly through the
    backend and returns the mapped leads. Never writes to the database."""
    _validate_api_type(data.API_TYPE)
    cfg = _get_config_or_404(db, data.CONFIG_ID)

    start = _parse_iso(data.START_TIME)
    end = _parse_iso(data.END_TIME)
    if data.API_TYPE in ("DATE_RANGE", "DATETIME_RANGE") and (not start or not end):
        raise HTTPException(status_code=400, detail="START_TIME and END_TIME are required for this API type")

    ok, message, leads = preview_leads(cfg.BASE_URL, cfg.ENDPOINT_URL, cfg.PULL_API_KEY, data.API_TYPE, start, end)
    if not ok:
        raise HTTPException(status_code=502, detail=message)
    return {"message": message, "count": len(leads), "leads": leads}


@router.get("/polling-logs")
def list_polling_logs(
    vendor_id: int = Query(1),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    config_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _admin=Depends(require("lead.polling_log.view")),
):
    q = db.query(LeadPollingLog).filter(LeadPollingLog.VENDOR_ID == vendor_id)
    if config_id:
        q = q.filter(LeadPollingLog.CONFIG_ID == config_id)
    if status:
        q = q.filter(LeadPollingLog.STATUS == status)
    frm = _parse_iso(date_from)
    to = _parse_iso(date_to)
    if frm:
        q = q.filter(LeadPollingLog.POLL_TIME >= frm)
    if to:
        q = q.filter(LeadPollingLog.POLL_TIME <= to)

    total = q.count()
    rows = q.order_by(LeadPollingLog.POLL_TIME.desc()).offset(offset).limit(limit).all()
    return {"total": total, "limit": limit, "offset": offset, "rows": [_serialize_log(r) for r in rows]}


# ── Lead CRUD (manual entry + unified listing across all sources) ───────────

@router.post("/leads", status_code=201)
def create_lead(
    data: LeadCreate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    admin=Depends(require("lead.records.create")),
):
    employee_id = admin.get("employee_id")
    assigned_to_id = employee_id
    if data.ASSIGNED_TO_ID and has_permission(admin, "lead.records.owner_select_create"):
        assigned_to_id = data.ASSIGNED_TO_ID

    assignment_type, existing_customer = _resolve_customer_choice(
        db, vendor_id, data.CUSTOMER_ASSIGNMENT_TYPE, data.EXISTING_CUSTOMER_ID
    )

    lead = Lead(
        VENDOR_ID=vendor_id,
        LEAD_SOURCE="MANUAL",
        CREATED_BY_ID=employee_id,
        ASSIGNED_TO_ID=assigned_to_id,
        CONTACT_NAME=data.CONTACT_NAME.strip(),
        CONTACT_MOBILE=(data.CONTACT_MOBILE or None),
        CONTACT_EMAIL=(data.CONTACT_EMAIL or None),
        COMPANY_NAME=(data.COMPANY_NAME or None),
        ADDRESS=(data.ADDRESS or None),
        CITY=(data.CITY or None),
        STATE=(data.STATE or None),
        PINCODE=(data.PINCODE or None),
        COUNTRY_ISO=(data.COUNTRY_ISO or None),
        LEAD_MESSAGE=(data.LEAD_MESSAGE or None),
        PRODUCT_INTEREST=(data.PRODUCT_INTEREST or None),
        PROJECT_ID=(data.PROJECT_ID or None),
        GST_NUMBER=(data.GST_NUMBER or None),
        CUSTOMER_ASSIGNMENT_TYPE=assignment_type,
        CUSTOMER_ID=(existing_customer.ID if existing_customer else None),
        ENQUIRY_TYPE=(data.ENQUIRY_TYPE or None),
        ENQUIRY_TIME=_parse_iso(data.ENQUIRY_TIME),
        LEAD_STATUS="NEW",  # always forced — a lead is never created in any other status
    )
    db.add(lead)
    db.flush()
    _apply_lead_custom_fields(db, lead.ID, vendor_id, data.CUSTOM_FIELDS)
    db.commit()
    db.refresh(lead)

    from app.services.whatsapp_outbox_service import enqueue_welcome_safe
    enqueue_welcome_safe(db, lead)

    return {"message": "Lead created", **_serialize_lead(lead)}


@router.get("/leads/{lead_id}")
def get_lead(lead_id: str, db: Session = Depends(get_db), admin=Depends(require("lead.records.view"))):
    return _serialize_lead(_get_lead_or_404(db, lead_id, admin))


@router.put("/leads/{lead_id}")
def update_lead(
    lead_id: str,
    data: LeadUpdate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    admin=Depends(require("lead.records.update")),
):
    """Edits any lead's contact/status/owner fields regardless of source — sales
    works IndiaMART/website leads too. LEAD_SOURCE and EXTERNAL_REFERENCE_ID are
    immutable after creation and are not accepted by LeadUpdate at all."""
    lead = _get_lead_or_404(db, lead_id, admin)

    if data.CONTACT_NAME is not None: lead.CONTACT_NAME = data.CONTACT_NAME.strip()
    if data.CONTACT_MOBILE is not None: lead.CONTACT_MOBILE = data.CONTACT_MOBILE.strip() or None
    if data.CONTACT_EMAIL is not None: lead.CONTACT_EMAIL = data.CONTACT_EMAIL.strip() or None
    if data.COMPANY_NAME is not None: lead.COMPANY_NAME = data.COMPANY_NAME.strip() or None
    if data.ADDRESS is not None: lead.ADDRESS = data.ADDRESS.strip() or None
    if data.CITY is not None: lead.CITY = data.CITY.strip() or None
    if data.STATE is not None: lead.STATE = data.STATE.strip() or None
    if data.PINCODE is not None: lead.PINCODE = data.PINCODE.strip() or None
    if data.COUNTRY_ISO is not None: lead.COUNTRY_ISO = data.COUNTRY_ISO.strip() or None
    if data.LEAD_MESSAGE is not None: lead.LEAD_MESSAGE = data.LEAD_MESSAGE.strip() or None
    if data.PRODUCT_INTEREST is not None: lead.PRODUCT_INTEREST = data.PRODUCT_INTEREST.strip() or None
    if data.PROJECT_ID is not None: lead.PROJECT_ID = data.PROJECT_ID or None
    if data.GST_NUMBER is not None: lead.GST_NUMBER = data.GST_NUMBER.strip() or None
    if data.ENQUIRY_TYPE is not None: lead.ENQUIRY_TYPE = data.ENQUIRY_TYPE.strip() or None
    if data.ENQUIRY_TIME is not None: lead.ENQUIRY_TIME = _parse_iso(data.ENQUIRY_TIME)

    if data.LEAD_STATUS is not None:
        if data.LEAD_STATUS == "CONVERTED":
            raise HTTPException(
                status_code=400,
                detail="A lead cannot be marked CONVERTED directly — use POST /lead-management/leads/{lead_id}/convert instead.",
            )
        lead.LEAD_STATUS = data.LEAD_STATUS

    if data.CUSTOMER_ASSIGNMENT_TYPE is not None or data.EXISTING_CUSTOMER_ID is not None:
        if lead.LEAD_STATUS == "CONVERTED":
            raise HTTPException(status_code=400, detail="Cannot change customer assignment on an already-converted lead.")
        new_type, new_customer = _resolve_customer_choice(db, vendor_id, data.CUSTOMER_ASSIGNMENT_TYPE, data.EXISTING_CUSTOMER_ID)
        lead.CUSTOMER_ASSIGNMENT_TYPE = new_type
        lead.CUSTOMER_ID = (new_customer.ID if new_customer else None)

    if data.ASSIGNED_TO_ID is not None and has_permission(admin, "lead.records.owner_select_update"):
        lead.ASSIGNED_TO_ID = data.ASSIGNED_TO_ID or None

    _apply_lead_custom_fields(db, lead.ID, vendor_id, data.CUSTOM_FIELDS)
    db.commit()
    db.refresh(lead)
    return {"message": "Lead updated", **_serialize_lead(lead)}


@router.post("/leads/{lead_id}/convert")
def convert_lead(
    lead_id: str,
    data: LeadConvertRequest,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    admin=Depends(require("lead.records.convert")),
):
    """Converts a VIEWED lead into CONVERTED, creating/linking a Customer
    Master record and a CustomerProjectAssignment row in one transaction.
    See the Lead-to-Customer-conversion feature plan for the full design —
    the short version: a Lead must already carry a real PROJECT_ID (set via
    the Add/Edit Lead modal's Category->Product cascade) and either an
    already-resolved customer assignment (decided at Lead creation time) or
    one supplied fresh in this request body (the legacy-lead fallback)."""
    lead = _get_lead_or_404(db, lead_id, admin)

    # 1. Idempotent-friendly guard — repeat/duplicate clicks and retried
    #    requests must never look like failures to the caller.
    if lead.LEAD_STATUS == "CONVERTED":
        assignment = db.query(CustomerProjectAssignment).filter(
            CustomerProjectAssignment.LEAD_ID == lead.ID
        ).first()
        customer = (
            db.query(Customer).filter(Customer.ID == lead.CUSTOMER_ID).first()
            if lead.CUSTOMER_ID else None
        )
        return {
            "message": "This lead has already been converted.",
            "already_converted": True,
            "lead": _serialize_lead(lead),
            "customer": _serialize_customer_master(customer) if customer else None,
            "assignment_id": assignment.ID if assignment else None,
        }

    # 2. Status precondition — the only place a status-transition rule is
    #    enforced today. VIEWED -> CONVERTED specifically, per the business rule.
    if lead.LEAD_STATUS != "VIEWED":
        raise HTTPException(
            status_code=400,
            detail=f"Lead must be in VIEWED status before it can be converted (current status: {lead.LEAD_STATUS}).",
        )

    # 3. Project precondition — no body override; set at creation via the cascade.
    project_id = lead.PROJECT_ID
    if not project_id:
        raise HTTPException(status_code=400, detail="Please assign a project to this lead before converting it.")

    # 4. Resolve effective customer assignment: creation-time decision wins;
    #    otherwise this is a legacy lead — require the body to supply it fresh.
    if lead.CUSTOMER_ASSIGNMENT_TYPE == "EXISTING":
        if not lead.CUSTOMER_ID:
            raise HTTPException(status_code=400, detail="This lead is marked for an existing customer but none is linked. Please update the lead first.")
        customer = db.query(Customer).filter(
            Customer.ID == lead.CUSTOMER_ID, Customer.VENDOR_ID == vendor_id
        ).first()
        if not customer:
            raise HTTPException(status_code=404, detail="The customer linked to this lead could not be found. It may have been deleted.")
        assignment_type = "EXISTING"
    elif lead.CUSTOMER_ASSIGNMENT_TYPE == "NEW":
        assignment_type, customer = "NEW", None
    else:
        assignment_type, customer = _resolve_customer_choice(
            db, vendor_id, data.CUSTOMER_ASSIGNMENT_TYPE, data.EXISTING_CUSTOMER_ID
        )
        if not assignment_type:
            raise HTTPException(status_code=400, detail="This lead has no customer assignment. Please specify CUSTOMER_ASSIGNMENT_TYPE ('NEW' or 'EXISTING') to convert it.")

    # 5. NEW path — build the Customer via the shared helper. Everything
    #    below is add()/flush() only — the single commit is at the very end.
    if assignment_type == "NEW":
        name = (data.NAME or lead.CONTACT_NAME or "").strip()
        phone_number = (data.PHONE_NUMBER or lead.CONTACT_MOBILE or "").strip()
        email = (data.EMAIL or lead.CONTACT_EMAIL or "").strip()
        address = (data.ADDRESS or lead.ADDRESS or "").strip()
        missing = [n for n, v in (("NAME", name), ("PHONE_NUMBER", phone_number), ("EMAIL", email), ("ADDRESS", address)) if not v]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing required customer field(s) to convert this lead: {', '.join(missing)}.")
        try:
            customer = _create_customer_row(
                db,
                name=name, phone_number=phone_number, email=email, address=address,
                company_name=(data.COMPANY_NAME or lead.COMPANY_NAME or None),
                gst_number=(data.GST_NUMBER or lead.GST_NUMBER or None),
                city=(data.CITY or lead.CITY or None),
                state=(data.STATE or lead.STATE or None),
                pincode=(data.PINCODE or lead.PINCODE or None),
                country_iso=(data.COUNTRY_ISO or lead.COUNTRY_ISO or None),
                vendor_id=vendor_id,
                custom_fields=data.CUSTOM_FIELDS,
            )
        except HTTPException:
            db.rollback()
            raise
        except IntegrityError as e:
            db.rollback()
            raise_db_error(e, "convert lead: create customer")
        except Exception as e:
            db.rollback()
            raise_db_error(e, "convert lead: create customer")

    # 6. Link — rely on the DB unique constraint (LEAD_ID) for duplicate-safety,
    #    not a racy pre-check-then-insert.
    assignment = CustomerProjectAssignment(
        VENDOR_ID=vendor_id, CUSTOMER_ID=customer.ID, PROJECT_ID=project_id, LEAD_ID=lead.ID,
    )
    db.add(assignment)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This lead has already been converted.")

    # 7. Finalize the Lead
    lead.CUSTOMER_ID = customer.ID
    if not lead.CUSTOMER_ASSIGNMENT_TYPE:
        lead.CUSTOMER_ASSIGNMENT_TYPE = assignment_type
    lead.LEAD_STATUS = "CONVERTED"

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "convert lead")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "convert lead")

    db.refresh(lead)
    db.refresh(customer)

    return {
        "message": "Lead converted successfully.",
        "already_converted": False,
        "lead": _serialize_lead(lead),
        "customer": _serialize_customer_master(customer),
        "assignment_id": assignment.ID,
    }


@router.delete("/leads/{lead_id}")
def delete_lead(lead_id: str, db: Session = Depends(get_db), admin=Depends(require("lead.records.delete"))):
    lead = _get_lead_or_404(db, lead_id, admin)
    db.delete(lead)
    db.commit()
    return {"message": "Lead deleted"}


@router.get("/leads")
def list_leads(
    vendor_id: int = Query(1),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    lead_source: Optional[str] = Query(None),
    lead_status: Optional[str] = Query(None),
    assigned_to_id: Optional[str] = Query(None),
    department_id: Optional[int] = Query(None),
    role_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None),
    created_from: Optional[str] = Query(None),
    created_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin=Depends(require("lead.records.view")),
):
    q = db.query(Lead).filter(Lead.VENDOR_ID == vendor_id)

    # Without all_lead_view, a caller only ever sees leads assigned to
    # them — this ANDs onto every filter below, so no additional
    # filter (department_id/role_id/assigned_to_id/etc.) can widen
    # past this, it can only narrow further within it.
    if not has_permission(admin, "lead.records.all_lead_view"):
        q = q.filter(Lead.ASSIGNED_TO_ID == admin.get("employee_id"))

    # Only join Employee when a dept/role filter is actually requested, so leads
    # with no owner aren't wrongly excluded when no dept/role filter is set.
    if department_id is not None or role_id is not None:
        q = q.join(Employee, Lead.ASSIGNED_TO_ID == Employee.ID)
        if department_id is not None:
            q = q.filter(Employee.DEPARTMENT_ID == department_id)
        if role_id is not None:
            q = q.filter(Employee.ROLE_ID == role_id)

    if assigned_to_id:
        q = q.filter(Lead.ASSIGNED_TO_ID == assigned_to_id)
    if lead_source:
        q = q.filter(Lead.LEAD_SOURCE == lead_source)
    if lead_status:
        q = q.filter(Lead.LEAD_STATUS == lead_status)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            Lead.CONTACT_NAME.ilike(term)
            | Lead.COMPANY_NAME.ilike(term)
            | Lead.CONTACT_MOBILE.ilike(term)
            | Lead.CONTACT_EMAIL.ilike(term)
        )
    frm = _parse_iso(created_from)
    to = _parse_iso(created_to)
    if frm:
        q = q.filter(Lead.CREATED_AT >= frm)
    if to:
        q = q.filter(Lead.CREATED_AT <= to)

    total = q.count()
    rows = (
        q.order_by(Lead.CREATED_AT.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {"total": total, "limit": limit, "offset": offset, "rows": [_serialize_lead(r) for r in rows]}


@router.post("/leads/bulk-upload")
async def bulk_upload_leads(
    vendor_id: int = Query(1),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin=Depends(require("lead.records.import")),
):
    """Bulk-import leads from an xlsx file (sheet: 'Leads'). Every valid row is
    a fresh INSERT with LEAD_SOURCE="MANUAL" — leads have no natural dedupe
    key like a category name, so this mirrors how CRM bulk imports normally
    work (no upsert-by-key)."""
    content = await file.read()
    headers, data_rows = _parse_bulk_xl(content, "Leads")

    if not headers:
        raise HTTPException(status_code=400, detail="Template has no header row.")

    h = {name.strip().upper(): idx for idx, name in enumerate(headers)}

    def col(row, name: str, default=None):
        idx = h.get(name.upper())
        return row[idx] if idx is not None and idx < len(row) else default

    cf_fields = _cf_fields_for_table(_CF_TABLE, vendor_id, db)
    cf_by_upper = {f.FIELD_NAME.upper(): f for f in cf_fields}
    cf_cols = [name for name in headers if name.upper() not in _LEAD_STD_COLS and name.upper() in cf_by_upper]

    employee_id = admin.get("employee_id")
    inserted = 0
    errors = []
    created_leads = []

    for row_num, row in enumerate(data_rows, start=2):
        record = {headers[i].upper(): row[i] for i in range(len(headers))}
        contact_name = _cell(record, "CONTACT NAME")
        if not contact_name:
            errors.append({"row": row_num, "field": "Contact Name", "message": "Contact Name is required"})
            continue

        cf_vals = {}
        row_errors = []
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

        lead = Lead(
            VENDOR_ID=vendor_id,
            LEAD_SOURCE="MANUAL",
            CREATED_BY_ID=employee_id,
            ASSIGNED_TO_ID=employee_id,
            CONTACT_NAME=contact_name,
            CONTACT_MOBILE=_cell(record, "CONTACT MOBILE") or None,
            CONTACT_EMAIL=_cell(record, "CONTACT EMAIL") or None,
            COMPANY_NAME=_cell(record, "COMPANY NAME") or None,
            ADDRESS=_cell(record, "ADDRESS") or None,
            CITY=_cell(record, "CITY") or None,
            STATE=_cell(record, "STATE") or None,
            PINCODE=_cell(record, "PINCODE") or None,
            COUNTRY_ISO=_cell(record, "COUNTRY ISO") or None,
            GST_NUMBER=_cell(record, "GST NUMBER") or None,
            LEAD_MESSAGE=_cell(record, "LEAD MESSAGE") or None,
            PRODUCT_INTEREST=_cell(record, "PRODUCT INTEREST") or None,
            LEAD_STATUS="NEW",  # always forced — any "LEAD STATUS" column value is ignored
        )
        db.add(lead)
        db.flush()
        for cf_id, val in cf_vals.items():
            _upsert_cf_bulk(lead.ID, _CF_TABLE, cf_id, val, db)
        created_leads.append(lead)
        inserted += 1

    db.commit()

    from app.services.whatsapp_outbox_service import enqueue_welcome_safe
    for lead in created_leads:
        enqueue_welcome_safe(db, lead)

    return {
        "message": f"Upload complete: {inserted} inserted, {len(errors)} error(s)",
        "inserted": inserted,
        "updated": 0,
        "skipped": 0,
        "total_rows": inserted + len(errors),
        "errors": errors,
    }
