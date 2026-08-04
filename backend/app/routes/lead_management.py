from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.lead_models import LeadPollingConfig, Lead, LeadPollingLog
from app.models.models import Employee
from app.schemas.lead_schema import (
    LeadPollingConfigCreate, LeadPollingConfigUpdate, LivePreviewRequest,
    LeadCreate, LeadUpdate,
)
from app.services.lead_polling_service import sync_config, preview_leads
from app.auth.auth_bearer import get_current_admin
from app.routes.project_template import (
    _cf_fields_for_table, _upsert_cf_bulk, _validate_cf_value, _parse_bulk_xl, _cell,
)

router = APIRouter(prefix="/lead-management", tags=["Lead Management"])

_KEY_MASK = "●●●●●●●●"
_VALID_API_TYPES = {"DATE_RANGE", "DATETIME_RANGE", "LAST_24_HOURS"}
_MIN_POLL_INTERVAL_MINUTES = 5  # IndiaMART's own rate-limit floor
_CF_TABLE = "lead"
_LEAD_STD_COLS = {
    "S.NO", "S.N", "SN", "",
    "CONTACT NAME", "CONTACT MOBILE", "CONTACT EMAIL", "COMPANY NAME",
    "ADDRESS", "CITY", "STATE", "PINCODE", "COUNTRY ISO",
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


def _get_lead_or_404(db: Session, lead_id: str) -> Lead:
    lead = db.query(Lead).filter(Lead.ID == lead_id).first()
    if not lead:
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


# ── Config CRUD ───────────────────────────────────────────────────────────────

@router.get("/configs")
def list_configs(
    vendor_id: int = Query(1),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
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
    admin=Depends(get_current_admin),
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
def get_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return _serialize_config(_get_config_or_404(db, config_id))


@router.put("/configs/{config_id}")
def update_config(
    config_id: str,
    data: LeadPollingConfigUpdate,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
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
def delete_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    db.delete(cfg)
    db.commit()
    return {"message": "Lead polling configuration deleted"}


@router.post("/configs/{config_id}/activate")
def activate_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    cfg.IS_ACTIVE = True
    db.commit()
    return {"message": "Configuration activated", **_serialize_config(cfg)}


@router.post("/configs/{config_id}/deactivate")
def deactivate_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    cfg.IS_ACTIVE = False
    db.commit()
    return {"message": "Configuration deactivated", **_serialize_config(cfg)}


# ── Operational routes (polling) ─────────────────────────────────────────────

@router.post("/configs/{config_id}/sync-now")
def sync_now(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    """Manually trigger a poll for a single config — useful for testing without waiting for the scheduler."""
    cfg = _get_config_or_404(db, config_id)
    ok, message, detail = sync_config(db, cfg, store=True)
    if not ok:
        raise HTTPException(status_code=502, detail=message)
    return {"message": message, **detail}


@router.post("/live-preview")
def live_preview(data: LivePreviewRequest, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
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
    _admin=Depends(get_current_admin),
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
    admin=Depends(get_current_admin),
):
    employee_id = admin.get("employee_id")
    lead = Lead(
        VENDOR_ID=vendor_id,
        LEAD_SOURCE="MANUAL",
        CREATED_BY_ID=employee_id,
        ASSIGNED_TO_ID=data.ASSIGNED_TO_ID or employee_id,
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
        ENQUIRY_TYPE=(data.ENQUIRY_TYPE or None),
        ENQUIRY_TIME=_parse_iso(data.ENQUIRY_TIME),
        LEAD_STATUS=data.LEAD_STATUS or "NEW",
    )
    db.add(lead)
    db.flush()
    _apply_lead_custom_fields(db, lead.ID, vendor_id, data.CUSTOM_FIELDS)
    db.commit()
    db.refresh(lead)
    return {"message": "Lead created", **_serialize_lead(lead)}


@router.get("/leads/{lead_id}")
def get_lead(lead_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return _serialize_lead(_get_lead_or_404(db, lead_id))


@router.put("/leads/{lead_id}")
def update_lead(
    lead_id: str,
    data: LeadUpdate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    """Edits any lead's contact/status/owner fields regardless of source — sales
    works IndiaMART/website leads too. LEAD_SOURCE and EXTERNAL_REFERENCE_ID are
    immutable after creation and are not accepted by LeadUpdate at all."""
    lead = _get_lead_or_404(db, lead_id)

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
    if data.ENQUIRY_TYPE is not None: lead.ENQUIRY_TYPE = data.ENQUIRY_TYPE.strip() or None
    if data.ENQUIRY_TIME is not None: lead.ENQUIRY_TIME = _parse_iso(data.ENQUIRY_TIME)
    if data.LEAD_STATUS is not None: lead.LEAD_STATUS = data.LEAD_STATUS
    if data.ASSIGNED_TO_ID is not None: lead.ASSIGNED_TO_ID = data.ASSIGNED_TO_ID or None

    _apply_lead_custom_fields(db, lead.ID, vendor_id, data.CUSTOM_FIELDS)
    db.commit()
    db.refresh(lead)
    return {"message": "Lead updated", **_serialize_lead(lead)}


@router.delete("/leads/{lead_id}")
def delete_lead(lead_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    lead = _get_lead_or_404(db, lead_id)
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
    _admin=Depends(get_current_admin),
):
    q = db.query(Lead).filter(Lead.VENDOR_ID == vendor_id)

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
    admin=Depends(get_current_admin),
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
            LEAD_MESSAGE=_cell(record, "LEAD MESSAGE") or None,
            PRODUCT_INTEREST=_cell(record, "PRODUCT INTEREST") or None,
            LEAD_STATUS=_cell(record, "LEAD STATUS") or "NEW",
        )
        db.add(lead)
        db.flush()
        for cf_id, val in cf_vals.items():
            _upsert_cf_bulk(lead.ID, _CF_TABLE, cf_id, val, db)
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
