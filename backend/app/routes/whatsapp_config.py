"""CRUD API for VendorWhatsAppConfig — one shared, vendor-level Meta
WhatsApp Cloud API configuration reused by every ERP module that sends or
receives WhatsApp messages (Lead Management today; Sales/CRM/Support/
Marketing in the future — see whatsapp_outbox_service.
enqueue_template_message for the generic send seam any module calls into).
Not owned by, or scoped to, any single business module."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.whatsapp_models import VendorWhatsAppConfig
from app.schemas.whatsapp_schema import (
    VendorWhatsAppConfigCreate, VendorWhatsAppConfigUpdate, WhatsAppTestSendRequest,
)
from app.auth.auth_bearer import get_current_admin
from app.utils.crypto_utils import encrypt_secret, decrypt_secret, fingerprint, is_encryption_configured
from app.utils.phone_utils import normalize_msisdn
from app.services import whatsapp_cloud_client
from app.services import whatsapp_config_service

router = APIRouter(prefix="/whatsapp-config", tags=["WhatsApp Configuration"])

_SECRET_MASK = "●●●●●●●●"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_config(cfg: VendorWhatsAppConfig, mask: bool = True) -> dict:
    return {
        "ID": cfg.ID,
        "VENDOR_ID": cfg.VENDOR_ID,
        "ACCOUNT_LABEL": cfg.ACCOUNT_LABEL,
        "BUSINESS_DISPLAY_NAME": cfg.BUSINESS_DISPLAY_NAME,
        "BUSINESS_PHONE_NUMBER": cfg.BUSINESS_PHONE_NUMBER,
        "PHONE_NUMBER_ID": cfg.PHONE_NUMBER_ID,
        "WABA_ID": cfg.WABA_ID,
        "APP_ID": cfg.APP_ID,
        "APP_SECRET": _SECRET_MASK if (mask and cfg.APP_SECRET) else None,
        "HAS_APP_SECRET": bool(cfg.APP_SECRET),
        "ACCESS_TOKEN": _SECRET_MASK if mask else None,
        "ACCESS_TOKEN_FINGERPRINT": cfg.ACCESS_TOKEN_FINGERPRINT,
        "TOKEN_EXPIRES_AT": cfg.TOKEN_EXPIRES_AT.isoformat() if cfg.TOKEN_EXPIRES_AT else None,
        "VERIFY_TOKEN": cfg.VERIFY_TOKEN,  # not a Meta secret — the admin must paste this into Meta's dashboard
        "API_BASE_URL": cfg.API_BASE_URL,
        "GRAPH_API_VERSION": cfg.GRAPH_API_VERSION,
        "WEBHOOK_CALLBACK_URL": cfg.WEBHOOK_CALLBACK_URL,
        "WEBHOOK_ENABLED": cfg.WEBHOOK_ENABLED,
        "DEFAULT_COUNTRY_CODE": cfg.DEFAULT_COUNTRY_CODE,
        "DEFAULT_LANGUAGE": cfg.DEFAULT_LANGUAGE,
        "MAX_SEND_PER_SECOND": cfg.MAX_SEND_PER_SECOND,
        "DAILY_SEND_CAP": cfg.DAILY_SEND_CAP,
        "HEALTH_STATUS": cfg.HEALTH_STATUS,
        "LAST_ERROR_CODE": cfg.LAST_ERROR_CODE,
        "LAST_ERROR_MESSAGE": cfg.LAST_ERROR_MESSAGE,
        "LAST_ERROR_AT": cfg.LAST_ERROR_AT.isoformat() if cfg.LAST_ERROR_AT else None,
        "LAST_SUCCESS_AT": cfg.LAST_SUCCESS_AT.isoformat() if cfg.LAST_SUCCESS_AT else None,
        "CONSECUTIVE_FAILURES": cfg.CONSECUTIVE_FAILURES,
        "PAUSED_UNTIL": cfg.PAUSED_UNTIL.isoformat() if cfg.PAUSED_UNTIL else None,
        "IS_ACTIVE": cfg.IS_ACTIVE,
        "CREATED_BY_ID": cfg.CREATED_BY_ID,
        "UPDATED_BY_ID": cfg.UPDATED_BY_ID,
        "CREATED_AT": cfg.CREATED_AT.isoformat() if cfg.CREATED_AT else None,
        "UPDATED_AT": cfg.UPDATED_AT.isoformat() if cfg.UPDATED_AT else None,
    }


def _get_config_or_404(db: Session, config_id: str) -> VendorWhatsAppConfig:
    cfg = db.query(VendorWhatsAppConfig).filter(VendorWhatsAppConfig.ID == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="WhatsApp configuration not found")
    return cfg


def _require_encryption():
    if not is_encryption_configured():
        raise HTTPException(
            status_code=503,
            detail="WA_ENCRYPTION_KEY is not configured in backend/.env — cannot store WhatsApp credentials securely.",
        )


def _require_app_secret_if_webhook_enabled(cfg: VendorWhatsAppConfig):
    """Signature verification (whatsapp_inbound_service.ingest_webhook) is
    silently skipped when APP_SECRET is blank — closing that gap here rather
    than only at send/receive time, so an insecure webhook can never be
    saved in the first place."""
    if cfg.WEBHOOK_ENABLED and not cfg.APP_SECRET:
        raise HTTPException(
            status_code=400,
            detail="App Secret is required when the webhook is enabled, to allow Meta's signature to be verified.",
        )


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
def list_configs(
    vendor_id: int = Query(1),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    q = db.query(VendorWhatsAppConfig).filter(VendorWhatsAppConfig.VENDOR_ID == vendor_id)
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(
            VendorWhatsAppConfig.ACCOUNT_LABEL.ilike(term)
            | VendorWhatsAppConfig.BUSINESS_DISPLAY_NAME.ilike(term)
            | VendorWhatsAppConfig.PHONE_NUMBER_ID.ilike(term)
        )
    total = q.count()
    rows = q.order_by(VendorWhatsAppConfig.CREATED_AT.desc()).offset(offset).limit(limit).all()
    return {"total": total, "limit": limit, "offset": offset, "rows": [_serialize_config(r) for r in rows]}


@router.post("", status_code=201)
def create_config(
    data: VendorWhatsAppConfigCreate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    _require_encryption()

    label = data.ACCOUNT_LABEL.strip()
    if db.query(VendorWhatsAppConfig).filter(
        VendorWhatsAppConfig.VENDOR_ID == vendor_id, VendorWhatsAppConfig.ACCOUNT_LABEL == label
    ).first():
        raise HTTPException(status_code=409, detail=f"A WhatsApp configuration named '{label}' already exists for this vendor.")

    if db.query(VendorWhatsAppConfig).filter(VendorWhatsAppConfig.PHONE_NUMBER_ID == data.PHONE_NUMBER_ID).first():
        raise HTTPException(status_code=409, detail="This Phone Number ID is already configured for another vendor.")

    if db.query(VendorWhatsAppConfig).filter(VendorWhatsAppConfig.VERIFY_TOKEN == data.VERIFY_TOKEN).first():
        raise HTTPException(status_code=409, detail="This Verify Token is already in use — generate a unique one.")

    employee_id = admin.get("employee_id")
    cfg = VendorWhatsAppConfig(
        VENDOR_ID=vendor_id,
        ACCOUNT_LABEL=label,
        BUSINESS_DISPLAY_NAME=(data.BUSINESS_DISPLAY_NAME or None),
        BUSINESS_PHONE_NUMBER=(data.BUSINESS_PHONE_NUMBER or None),
        PHONE_NUMBER_ID=data.PHONE_NUMBER_ID.strip(),
        WABA_ID=data.WABA_ID.strip(),
        APP_ID=(data.APP_ID or None),
        APP_SECRET=encrypt_secret(data.APP_SECRET.strip()) if data.APP_SECRET else None,
        ACCESS_TOKEN=encrypt_secret(data.ACCESS_TOKEN.strip()),
        ACCESS_TOKEN_FINGERPRINT=fingerprint(data.ACCESS_TOKEN.strip()),
        TOKEN_EXPIRES_AT=_parse_iso(data.TOKEN_EXPIRES_AT),
        VERIFY_TOKEN=data.VERIFY_TOKEN.strip(),
        API_BASE_URL=data.API_BASE_URL.strip(),
        GRAPH_API_VERSION=data.GRAPH_API_VERSION.strip(),
        WEBHOOK_CALLBACK_URL=(data.WEBHOOK_CALLBACK_URL or None),
        WEBHOOK_ENABLED=data.WEBHOOK_ENABLED,
        DEFAULT_COUNTRY_CODE=data.DEFAULT_COUNTRY_CODE.strip(),
        DEFAULT_LANGUAGE=data.DEFAULT_LANGUAGE.strip(),
        MAX_SEND_PER_SECOND=data.MAX_SEND_PER_SECOND,
        DAILY_SEND_CAP=data.DAILY_SEND_CAP,
        IS_ACTIVE=data.IS_ACTIVE,
        CREATED_BY_ID=employee_id,
        UPDATED_BY_ID=employee_id,
    )
    _require_app_secret_if_webhook_enabled(cfg)
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return {"message": "WhatsApp configuration created", **_serialize_config(cfg)}


@router.get("/{config_id}")
def get_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return _serialize_config(_get_config_or_404(db, config_id))


@router.put("/{config_id}")
def update_config(
    config_id: str,
    data: VendorWhatsAppConfigUpdate,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    cfg = _get_config_or_404(db, config_id)

    if data.ACCOUNT_LABEL is not None:
        new_label = data.ACCOUNT_LABEL.strip()
        if new_label != cfg.ACCOUNT_LABEL and db.query(VendorWhatsAppConfig).filter(
            VendorWhatsAppConfig.VENDOR_ID == cfg.VENDOR_ID,
            VendorWhatsAppConfig.ACCOUNT_LABEL == new_label,
            VendorWhatsAppConfig.ID != config_id,
        ).first():
            raise HTTPException(status_code=409, detail=f"A WhatsApp configuration named '{new_label}' already exists for this vendor.")
        cfg.ACCOUNT_LABEL = new_label

    if data.PHONE_NUMBER_ID is not None:
        new_pnid = data.PHONE_NUMBER_ID.strip()
        if new_pnid != cfg.PHONE_NUMBER_ID and db.query(VendorWhatsAppConfig).filter(
            VendorWhatsAppConfig.PHONE_NUMBER_ID == new_pnid, VendorWhatsAppConfig.ID != config_id
        ).first():
            raise HTTPException(status_code=409, detail="This Phone Number ID is already configured for another vendor.")
        cfg.PHONE_NUMBER_ID = new_pnid

    if data.VERIFY_TOKEN is not None:
        new_token = data.VERIFY_TOKEN.strip()
        if new_token != cfg.VERIFY_TOKEN and db.query(VendorWhatsAppConfig).filter(
            VendorWhatsAppConfig.VERIFY_TOKEN == new_token, VendorWhatsAppConfig.ID != config_id
        ).first():
            raise HTTPException(status_code=409, detail="This Verify Token is already in use — generate a unique one.")
        cfg.VERIFY_TOKEN = new_token

    if data.BUSINESS_DISPLAY_NAME is not None: cfg.BUSINESS_DISPLAY_NAME = data.BUSINESS_DISPLAY_NAME.strip() or None
    if data.BUSINESS_PHONE_NUMBER is not None: cfg.BUSINESS_PHONE_NUMBER = data.BUSINESS_PHONE_NUMBER.strip() or None
    if data.WABA_ID is not None: cfg.WABA_ID = data.WABA_ID.strip()
    if data.APP_ID is not None: cfg.APP_ID = data.APP_ID.strip() or None

    # Blank/None secret fields preserve the existing encrypted value — same
    # convention as lead_management.py's PULL_API_KEY / email_config.py's SMTP_PASSWORD.
    if data.APP_SECRET and data.APP_SECRET.strip():
        _require_encryption()
        cfg.APP_SECRET = encrypt_secret(data.APP_SECRET.strip())
    if data.ACCESS_TOKEN and data.ACCESS_TOKEN.strip():
        _require_encryption()
        cfg.ACCESS_TOKEN = encrypt_secret(data.ACCESS_TOKEN.strip())
        cfg.ACCESS_TOKEN_FINGERPRINT = fingerprint(data.ACCESS_TOKEN.strip())

    if data.TOKEN_EXPIRES_AT is not None: cfg.TOKEN_EXPIRES_AT = _parse_iso(data.TOKEN_EXPIRES_AT)
    if data.API_BASE_URL is not None: cfg.API_BASE_URL = data.API_BASE_URL.strip()
    if data.GRAPH_API_VERSION is not None: cfg.GRAPH_API_VERSION = data.GRAPH_API_VERSION.strip()
    if data.WEBHOOK_CALLBACK_URL is not None: cfg.WEBHOOK_CALLBACK_URL = data.WEBHOOK_CALLBACK_URL.strip() or None
    if data.WEBHOOK_ENABLED is not None: cfg.WEBHOOK_ENABLED = data.WEBHOOK_ENABLED
    if data.DEFAULT_COUNTRY_CODE is not None: cfg.DEFAULT_COUNTRY_CODE = data.DEFAULT_COUNTRY_CODE.strip()
    if data.DEFAULT_LANGUAGE is not None: cfg.DEFAULT_LANGUAGE = data.DEFAULT_LANGUAGE.strip()

    if data.MAX_SEND_PER_SECOND is not None: cfg.MAX_SEND_PER_SECOND = data.MAX_SEND_PER_SECOND
    if data.DAILY_SEND_CAP is not None: cfg.DAILY_SEND_CAP = data.DAILY_SEND_CAP
    if data.IS_ACTIVE is not None: cfg.IS_ACTIVE = data.IS_ACTIVE

    _require_app_secret_if_webhook_enabled(cfg)

    cfg.UPDATED_BY_ID = admin.get("employee_id")
    db.commit()
    db.refresh(cfg)
    return {"message": "WhatsApp configuration updated", **_serialize_config(cfg)}


@router.delete("/{config_id}")
def delete_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    db.delete(cfg)
    db.commit()
    return {"message": "WhatsApp configuration deleted"}


@router.post("/{config_id}/activate")
def activate_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    cfg.IS_ACTIVE = True
    db.commit()
    return {"message": "Configuration activated", **_serialize_config(cfg)}


@router.post("/{config_id}/deactivate")
def deactivate_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    cfg.IS_ACTIVE = False
    db.commit()
    return {"message": "Configuration deactivated", **_serialize_config(cfg)}


# ── Operational routes ───────────────────────────────────────────────────────

@router.post("/{config_id}/test-connection")
def test_connection(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    token = decrypt_secret(cfg.ACCESS_TOKEN)
    ok, info, err = whatsapp_cloud_client.get_phone_number_info(
        cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.PHONE_NUMBER_ID, token
    )
    if not ok:
        whatsapp_config_service.mark_error(db, cfg, "ERROR", err.get("code"), err.get("message"))
        raise HTTPException(status_code=502, detail=err.get("message"))

    cfg.BUSINESS_DISPLAY_NAME = info.get("verified_name") or cfg.BUSINESS_DISPLAY_NAME
    cfg.BUSINESS_PHONE_NUMBER = info.get("display_phone_number") or cfg.BUSINESS_PHONE_NUMBER
    whatsapp_config_service.mark_success(db, cfg)
    return {"message": "Connection verified", "info": info, **_serialize_config(cfg)}


@router.get("/{config_id}/templates")
def list_templates(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    token = decrypt_secret(cfg.ACCESS_TOKEN)
    ok, templates, err = whatsapp_cloud_client.list_templates(cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.WABA_ID, token)
    if not ok:
        raise HTTPException(status_code=502, detail=err.get("message"))
    return {"templates": templates}


@router.post("/{config_id}/send-test")
def send_test(config_id: str, data: WhatsAppTestSendRequest, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    cfg = _get_config_or_404(db, config_id)
    token = decrypt_secret(cfg.ACCESS_TOKEN)
    to_wa_id = normalize_msisdn(data.TO_PHONE, cfg.DEFAULT_COUNTRY_CODE)

    if data.USE_TEMPLATE:
        setting = whatsapp_config_service.resolve_module_setting(db, cfg.VENDOR_ID, data.MODULE_CODE)
        template_name = setting.WELCOME_TEMPLATE_NAME if setting else None
        if not template_name:
            raise HTTPException(status_code=400, detail=f"No WELCOME_TEMPLATE_NAME configured for module '{data.MODULE_CODE}' to test with.")
        ok, wamid, err = whatsapp_cloud_client.send_template(
            cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.PHONE_NUMBER_ID, token,
            to_wa_id, template_name, setting.WELCOME_TEMPLATE_LANG, ["Test Contact"],
        )
    else:
        ok, wamid, err = whatsapp_cloud_client.send_text(
            cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.PHONE_NUMBER_ID, token,
            to_wa_id, "This is a test message from your WhatsApp configuration.",
        )

    if not ok:
        whatsapp_config_service.mark_error(db, cfg, "ERROR", err.get("code"), err.get("message"))
        raise HTTPException(status_code=502, detail=err.get("message"))

    whatsapp_config_service.mark_success(db, cfg)
    return {"message": "Test message sent", "wamid": wamid}


@router.post("/{config_id}/resume")
def resume_config(config_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    """Clears the circuit breaker after fixing a config (e.g. a rotated
    token) and requeues any BLOCKED/FAILED outbound messages."""
    cfg = _get_config_or_404(db, config_id)
    whatsapp_config_service.resume(db, cfg)

    from app.services import whatsapp_outbox_service
    requeued = whatsapp_outbox_service.requeue_blocked(db, cfg)
    return {"message": f"Configuration resumed, {requeued} message(s) requeued", **_serialize_config(cfg)}


def _parse_iso(value: Optional[str]):
    if not value:
        return None
    from datetime import datetime
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date/time value: {value!r} (expected ISO format)")
