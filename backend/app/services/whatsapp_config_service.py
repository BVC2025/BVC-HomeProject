"""Resolution and lifecycle helpers for VendorWhatsAppConfig — shared by the
CRUD routes, the outbound/inbound dispatch services, and the public webhook.
Kept as plain functions (no classes), matching every other service module in
this codebase."""
import logging
from datetime import timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.whatsapp_models import VendorWhatsAppConfig, WhatsAppModuleSetting
from app.utils.crypto_utils import decrypt_secret
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)


def resolve_module_setting(db: Session, vendor_id: int, module_code: str) -> Optional[WhatsAppModuleSetting]:
    """The per-module automation settings (templates, AI-reply toggle,
    supported languages) for a vendor — separate from the shared Meta
    connection (VendorWhatsAppConfig), so each module's welcome/re-engage
    templates live independently. Returns None if the module hasn't been
    configured for this vendor yet (callers must treat that as "disabled",
    not crash)."""
    return (
        db.query(WhatsAppModuleSetting)
        .filter(WhatsAppModuleSetting.VENDOR_ID == vendor_id, WhatsAppModuleSetting.MODULE_CODE == module_code)
        .first()
    )


def resolve_by_vendor_id(db: Session, vendor_id: int) -> Optional[VendorWhatsAppConfig]:
    """The single active, non-paused config for a vendor — used for outbound
    sends (welcome messages, AI replies)."""
    return (
        db.query(VendorWhatsAppConfig)
        .filter(
            VendorWhatsAppConfig.VENDOR_ID == vendor_id,
            VendorWhatsAppConfig.IS_ACTIVE.is_(True),
        )
        .order_by(VendorWhatsAppConfig.CREATED_AT.desc())
        .first()
    )


def resolve_by_phone_number_id(db: Session, phone_number_id: str) -> Optional[VendorWhatsAppConfig]:
    """Webhook routing: Meta's payload carries only phone_number_id, which is
    globally unique (UNIQUE constraint on the column)."""
    if not phone_number_id:
        return None
    return (
        db.query(VendorWhatsAppConfig)
        .filter(VendorWhatsAppConfig.PHONE_NUMBER_ID == phone_number_id)
        .first()
    )


def find_by_verify_token(db: Session, token: str) -> Optional[VendorWhatsAppConfig]:
    """GET handshake: Meta's verify request carries no phone_number_id, so the
    verify token itself (unique per config) is the only discriminator."""
    if not token:
        return None
    for cfg in db.query(VendorWhatsAppConfig).filter(VendorWhatsAppConfig.WEBHOOK_ENABLED.is_(True)).all():
        if cfg.VERIFY_TOKEN and _constant_time_eq(cfg.VERIFY_TOKEN, token):
            return cfg
    return None


def _constant_time_eq(a: str, b: str) -> bool:
    import hmac as _hmac
    return _hmac.compare_digest(a.encode(), b.encode())


def get_access_token(cfg: VendorWhatsAppConfig) -> str:
    return decrypt_secret(cfg.ACCESS_TOKEN)


def get_app_secret(cfg: VendorWhatsAppConfig) -> Optional[str]:
    return decrypt_secret(cfg.APP_SECRET) if cfg.APP_SECRET else None


def is_paused(cfg: VendorWhatsAppConfig) -> bool:
    return bool(cfg.PAUSED_UNTIL and cfg.PAUSED_UNTIL > now_ist())


# ── Health / circuit-breaker mutation ────────────────────────────────────────
# All of these commit immediately — callers are single-row dispatch loops, not
# request handlers, so there's no outer transaction to preserve.

def mark_success(db: Session, cfg: VendorWhatsAppConfig) -> None:
    cfg.HEALTH_STATUS = "HEALTHY"
    cfg.LAST_SUCCESS_AT = now_ist()
    cfg.CONSECUTIVE_FAILURES = 0
    cfg.PAUSED_UNTIL = None
    # Clear any stale failure so a past error never lingers next to a
    # current HEALTHY status (e.g. after a token is refreshed).
    cfg.LAST_ERROR_CODE = None
    cfg.LAST_ERROR_MESSAGE = None
    cfg.LAST_ERROR_AT = None
    db.commit()


def mark_error(db: Session, cfg: VendorWhatsAppConfig, health_status: str, error_code: str, error_message: str,
               pause_seconds: int = 0) -> None:
    cfg.HEALTH_STATUS = health_status
    cfg.LAST_ERROR_CODE = error_code
    cfg.LAST_ERROR_MESSAGE = (error_message or "")[:500]
    cfg.LAST_ERROR_AT = now_ist()
    cfg.CONSECUTIVE_FAILURES = (cfg.CONSECUTIVE_FAILURES or 0) + 1
    if pause_seconds > 0:
        cfg.PAUSED_UNTIL = now_ist() + timedelta(seconds=pause_seconds)
    db.commit()

    if health_status == "AUTH_FAILED" and cfg.CONSECUTIVE_FAILURES == 1:
        try:
            from app.services.whatsapp_service import notify_md_safe
            notify_md_safe(
                f"⚠️ WhatsApp config '{cfg.ACCOUNT_LABEL}' (vendor {cfg.VENDOR_ID}) "
                f"failed authentication with Meta — token may be expired. "
                f"WhatsApp lead messaging is paused until this is fixed."
            )
        except Exception:
            log.warning("Could not send MD alert for WhatsApp auth failure", exc_info=True)


def resume(db: Session, cfg: VendorWhatsAppConfig) -> None:
    """Clears the circuit breaker. Any BLOCKED/FAILED messages are requeued by
    the caller (routes/whatsapp_config.py) via whatsapp_outbox_service."""
    cfg.PAUSED_UNTIL = None
    cfg.CONSECUTIVE_FAILURES = 0
    cfg.HEALTH_STATUS = "UNKNOWN"
    db.commit()
