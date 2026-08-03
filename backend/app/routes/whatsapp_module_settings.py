"""CRUD API for WhatsAppModuleSetting — per-vendor, per-module WhatsApp
automation behavior (welcome/re-engagement templates, AI-reply toggle,
supported languages). Separate from routes/whatsapp_config.py, which owns
the shared Meta connection every module reuses unchanged. Mirrors that
router's conventions exactly (vendor_id query param, get_current_admin,
hand-built serializer dicts)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.whatsapp_models import WhatsAppModuleSetting
from app.schemas.whatsapp_schema import WhatsAppModuleSettingCreate, WhatsAppModuleSettingUpdate
from app.auth.auth_bearer import get_current_admin

router = APIRouter(prefix="/whatsapp-module-settings", tags=["WhatsApp Module Settings"])


def _serialize_setting(row: WhatsAppModuleSetting) -> dict:
    return {
        "ID": row.ID,
        "VENDOR_ID": row.VENDOR_ID,
        "MODULE_CODE": row.MODULE_CODE,
        "IS_ENABLED": row.IS_ENABLED,
        "AUTO_TRIGGER_ENABLED": row.AUTO_TRIGGER_ENABLED,
        "WELCOME_TEMPLATE_NAME": row.WELCOME_TEMPLATE_NAME,
        "WELCOME_TEMPLATE_LANG": row.WELCOME_TEMPLATE_LANG,
        "WELCOME_TEMPLATE_PARAMS": row.WELCOME_TEMPLATE_PARAMS,
        "REENGAGE_TEMPLATE_NAME": row.REENGAGE_TEMPLATE_NAME,
        "REENGAGE_TEMPLATE_LANG": row.REENGAGE_TEMPLATE_LANG,
        "AI_REPLY_ENABLED": row.AI_REPLY_ENABLED,
        "SUPPORTED_LANGUAGES": row.SUPPORTED_LANGUAGES,
        "CREATED_AT": row.CREATED_AT.isoformat() if row.CREATED_AT else None,
        "UPDATED_AT": row.UPDATED_AT.isoformat() if row.UPDATED_AT else None,
    }


def _get_or_404(db: Session, setting_id: str) -> WhatsAppModuleSetting:
    row = db.query(WhatsAppModuleSetting).filter(WhatsAppModuleSetting.ID == setting_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="WhatsApp module setting not found")
    return row


@router.get("")
def list_settings(
    vendor_id: int = Query(1),
    module_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    q = db.query(WhatsAppModuleSetting).filter(WhatsAppModuleSetting.VENDOR_ID == vendor_id)
    if module_code:
        q = q.filter(WhatsAppModuleSetting.MODULE_CODE == module_code)
    rows = q.order_by(WhatsAppModuleSetting.MODULE_CODE).all()
    return {"rows": [_serialize_setting(r) for r in rows]}


@router.get("/by-module")
def get_by_module(
    vendor_id: int = Query(1),
    module_code: str = Query(...),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    """Convenience lookup for a module's settings page (e.g. Lead
    Management's own config page) — returns null rather than 404 if the
    module hasn't been configured for this vendor yet, since "not yet
    configured" is the normal/expected first-run state."""
    row = db.query(WhatsAppModuleSetting).filter(
        WhatsAppModuleSetting.VENDOR_ID == vendor_id, WhatsAppModuleSetting.MODULE_CODE == module_code
    ).first()
    return {"row": _serialize_setting(row) if row else None}


@router.post("", status_code=201)
def create_setting(
    data: WhatsAppModuleSettingCreate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    if db.query(WhatsAppModuleSetting).filter(
        WhatsAppModuleSetting.VENDOR_ID == vendor_id, WhatsAppModuleSetting.MODULE_CODE == data.MODULE_CODE
    ).first():
        raise HTTPException(status_code=409, detail=f"A WhatsApp setting for module '{data.MODULE_CODE}' already exists for this vendor.")

    if data.AUTO_TRIGGER_ENABLED and not (data.WELCOME_TEMPLATE_NAME or "").strip():
        raise HTTPException(status_code=400, detail="WELCOME_TEMPLATE_NAME is required when auto-trigger is enabled.")

    row = WhatsAppModuleSetting(
        VENDOR_ID=vendor_id,
        MODULE_CODE=data.MODULE_CODE,
        IS_ENABLED=data.IS_ENABLED,
        AUTO_TRIGGER_ENABLED=data.AUTO_TRIGGER_ENABLED,
        WELCOME_TEMPLATE_NAME=(data.WELCOME_TEMPLATE_NAME or None),
        WELCOME_TEMPLATE_LANG=data.WELCOME_TEMPLATE_LANG.strip(),
        WELCOME_TEMPLATE_PARAMS=(data.WELCOME_TEMPLATE_PARAMS or None),
        REENGAGE_TEMPLATE_NAME=(data.REENGAGE_TEMPLATE_NAME or None),
        REENGAGE_TEMPLATE_LANG=data.REENGAGE_TEMPLATE_LANG.strip(),
        AI_REPLY_ENABLED=data.AI_REPLY_ENABLED,
        SUPPORTED_LANGUAGES=data.SUPPORTED_LANGUAGES.strip() or "en",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"message": "WhatsApp module setting created", **_serialize_setting(row)}


@router.get("/{setting_id}")
def get_setting(setting_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    return _serialize_setting(_get_or_404(db, setting_id))


@router.put("/{setting_id}")
def update_setting(
    setting_id: str,
    data: WhatsAppModuleSettingUpdate,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    row = _get_or_404(db, setting_id)

    if data.IS_ENABLED is not None: row.IS_ENABLED = data.IS_ENABLED
    if data.AUTO_TRIGGER_ENABLED is not None: row.AUTO_TRIGGER_ENABLED = data.AUTO_TRIGGER_ENABLED
    if data.WELCOME_TEMPLATE_NAME is not None: row.WELCOME_TEMPLATE_NAME = data.WELCOME_TEMPLATE_NAME.strip() or None
    if data.WELCOME_TEMPLATE_LANG is not None: row.WELCOME_TEMPLATE_LANG = data.WELCOME_TEMPLATE_LANG.strip()
    if data.WELCOME_TEMPLATE_PARAMS is not None: row.WELCOME_TEMPLATE_PARAMS = data.WELCOME_TEMPLATE_PARAMS.strip() or None
    if data.REENGAGE_TEMPLATE_NAME is not None: row.REENGAGE_TEMPLATE_NAME = data.REENGAGE_TEMPLATE_NAME.strip() or None
    if data.REENGAGE_TEMPLATE_LANG is not None: row.REENGAGE_TEMPLATE_LANG = data.REENGAGE_TEMPLATE_LANG.strip()
    if data.AI_REPLY_ENABLED is not None: row.AI_REPLY_ENABLED = data.AI_REPLY_ENABLED
    if data.SUPPORTED_LANGUAGES is not None: row.SUPPORTED_LANGUAGES = data.SUPPORTED_LANGUAGES.strip() or "en"

    if row.AUTO_TRIGGER_ENABLED and not (row.WELCOME_TEMPLATE_NAME or "").strip():
        raise HTTPException(status_code=400, detail="WELCOME_TEMPLATE_NAME is required when auto-trigger is enabled.")

    db.commit()
    db.refresh(row)
    return {"message": "WhatsApp module setting updated", **_serialize_setting(row)}


@router.delete("/{setting_id}")
def delete_setting(setting_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    row = _get_or_404(db, setting_id)
    db.delete(row)
    db.commit()
    return {"message": "WhatsApp module setting deleted"}
