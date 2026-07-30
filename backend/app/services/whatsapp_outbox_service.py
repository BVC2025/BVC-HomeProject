"""Transactional outbox for WhatsApp sends. Lead-creation paths (and the
inbound worker, for AI replies) only ever INSERT a PENDING WhatsAppMessage
row via enqueue_*() — fast, local, never touches Meta's API, and can never
fail the caller's request. A separate APScheduler tick (whatsapp_scheduler.py
-> dispatch_outbound_once) drains PENDING rows and actually calls Meta's
Cloud API, with per-vendor throttling, daily caps, and a DB-backed circuit
breaker.

This decoupling is exactly why "10 leads created at once" is cheap: the
request path does a handful of extra INSERTs; the outbound HTTP calls to
Meta happen later, off the request path, at a controlled rate.

Template/behavior config (WELCOME_TEMPLATE_NAME, etc.) is resolved from
WhatsAppModuleSetting (per vendor + module_code), NOT from
VendorWhatsAppConfig — that table is the shared Meta connection only. See
whatsapp_config_service.resolve_module_setting()."""
import logging
from datetime import timedelta
from typing import List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database.database import SessionLocal
from app.models.lead_models import Lead
from app.models.whatsapp_models import VendorWhatsAppConfig, WhatsAppModuleSetting, WhatsAppConversation, WhatsAppMessage
from app.services import whatsapp_config_service, whatsapp_cloud_client
from app.utils.datetime_utils import now_ist
from app.utils.phone_utils import normalize_msisdn

log = logging.getLogger(__name__)

_SESSION_WINDOW = timedelta(hours=24)
_TRANSIENT_BACKOFF = [1, 4, 15, 60, 300]  # seconds, indexed by attempt number


# ── Conversation helpers ─────────────────────────────────────────────────────

def get_or_create_conversation(db: Session, vendor_id: int, config_id: Optional[str], wa_id: str,
                                 source_record_id: Optional[str] = None, module_code: str = "lead_module") -> WhatsAppConversation:
    """module_code is only set when a NEW conversation is created — which AI
    module (see rag_modules/<module_code>_rag_module/) owns this conversation
    for inbound-reply purposes never changes once established. Defaults to
    "lead_module" so every existing caller (Lead Management) is unaffected;
    a future module (Sales, Support, ...) passes its own module_code and its
    own source_record_id (its own entity's ID — generic, no FK)."""
    conv = (
        db.query(WhatsAppConversation)
        .filter(WhatsAppConversation.VENDOR_ID == vendor_id, WhatsAppConversation.WA_ID == wa_id)
        .first()
    )
    if conv:
        if source_record_id and not conv.SOURCE_RECORD_ID:
            conv.SOURCE_RECORD_ID = source_record_id
        if config_id:
            conv.CONFIG_ID = config_id
        return conv

    conv = WhatsAppConversation(
        VENDOR_ID=vendor_id, CONFIG_ID=config_id, WA_ID=wa_id,
        SOURCE_RECORD_ID=source_record_id, MODULE_CODE=module_code,
    )
    db.add(conv)
    db.flush()
    return conv


def resolve_send_mode(conversation: WhatsAppConversation) -> str:
    """Evaluated at SEND time, not enqueue time — a row can sit in the queue
    while the 24h session window closes."""
    if conversation.LAST_INBOUND_AT and (now_ist() - conversation.LAST_INBOUND_AT) < _SESSION_WINDOW:
        return "text"
    return "template"


# ── Enqueue (called from request paths — must never raise) ──────────────────

def enqueue_template_message(db: Session, vendor_id: int, to_mobile: str, purpose: str, dedup_key: Optional[str],
                              source_record_id: Optional[str] = None, module_code: str = "lead_module",
                              config: Optional[VendorWhatsAppConfig] = None) -> Optional[WhatsAppMessage]:
    """Generic outbound-template enqueue primitive — the shared seam ANY ERP
    module uses to send a WhatsApp template message through the one common
    vendor_whatsapp_config, without needing a Lead row at all. Inserts a
    PENDING WhatsAppMessage row and returns it (None if skipped: no active
    config, unusable mobile number, or dedup_key already enqueued). Actual
    sending happens later, off this call path, via the outbound scheduler
    tick (dispatch_outbound_once). Never raises — callers that need a
    fire-and-forget contract should wrap this the same way
    enqueue_welcome_safe() wraps its own call.

    Example — a future Sales module confirming an order:
        enqueue_template_message(db, vendor_id, customer_mobile,
                                  purpose="ORDER_CONFIRMATION",
                                  dedup_key=f"order_confirm:{order_id}",
                                  source_record_id=order_id, module_code="sales_whatsapp")
    """
    cfg = config or whatsapp_config_service.resolve_by_vendor_id(db, vendor_id)
    if not cfg:
        return None

    wa_id = normalize_msisdn(to_mobile, cfg.DEFAULT_COUNTRY_CODE)
    if not wa_id or not (10 <= len(wa_id) <= 15):
        log.info("Skipping WhatsApp %s enqueue — unusable mobile number %r", purpose, to_mobile)
        return None

    if dedup_key and db.query(WhatsAppMessage).filter(
        WhatsAppMessage.VENDOR_ID == vendor_id, WhatsAppMessage.DEDUP_KEY == dedup_key
    ).first():
        return None  # already enqueued (e.g. re-run, race) — DEDUP_KEY unique constraint is the hard guarantee

    conv = get_or_create_conversation(db, vendor_id, cfg.ID, wa_id, source_record_id=source_record_id, module_code=module_code)

    msg = WhatsAppMessage(
        VENDOR_ID=vendor_id,
        CONVERSATION_ID=conv.ID,
        SOURCE_RECORD_ID=source_record_id,
        CONFIG_ID=cfg.ID,
        DIRECTION="OUT",
        DEDUP_KEY=dedup_key,
        MESSAGE_TYPE="template",
        PURPOSE=purpose,
        STATUS="PENDING",
    )
    db.add(msg)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # lost a race to another process — already queued
        return None
    return msg


def enqueue_document_message(db: Session, vendor_id: int, wa_id: str, media_url: str, purpose: str,
                              filename: Optional[str] = None, caption: Optional[str] = None,
                              dedup_key: Optional[str] = None, module_code: str = "lead_module",
                              config: Optional[VendorWhatsAppConfig] = None) -> Optional[WhatsAppMessage]:
    """Generic outbound document/media-link enqueue primitive — same shape as
    enqueue_template_message but for sending an existing file (e.g. a
    quotation PDF) via its public URL. Requires an active 24h session
    window at send time (same Meta rule as free-form text) — callers should
    only use this mid-conversation, after the customer has already messaged
    in, never as a cold first-contact message (use enqueue_template_message
    for that)."""
    cfg = config or whatsapp_config_service.resolve_by_vendor_id(db, vendor_id)
    if not cfg:
        return None

    if dedup_key and db.query(WhatsAppMessage).filter(
        WhatsAppMessage.VENDOR_ID == vendor_id, WhatsAppMessage.DEDUP_KEY == dedup_key
    ).first():
        return None

    conv = get_or_create_conversation(db, vendor_id, cfg.ID, wa_id, module_code=module_code)

    msg = WhatsAppMessage(
        VENDOR_ID=vendor_id,
        CONVERSATION_ID=conv.ID,
        SOURCE_RECORD_ID=conv.SOURCE_RECORD_ID,
        CONFIG_ID=cfg.ID,
        DIRECTION="OUT",
        DEDUP_KEY=dedup_key,
        MESSAGE_TYPE="document",
        MEDIA_URL=media_url,
        TEMPLATE_NAME=filename,  # reused as a convenient filename slot — see _send_one's document branch
        BODY_TEXT=caption,
        PURPOSE=purpose,
        STATUS="PENDING",
    )
    db.add(msg)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return msg


def enqueue_welcome_safe(db: Session, lead: Lead) -> None:
    """Best-effort, never raises, never affects the caller's already-committed
    lead-creation transaction. Mirrors notify_md_safe()'s fire-and-forget
    contract (services/whatsapp_service.py). A thin, Lead-specific wrapper
    around the generic enqueue_template_message() — this is the ONLY place
    Lead Management's welcome flow reaches into Lead-specific gating logic
    (the lead_module module setting's AUTO_TRIGGER_ENABLED); the actual
    enqueue is fully generic."""
    try:
        _enqueue_welcome(db, lead)
    except Exception:
        db.rollback()
        log.warning("enqueue_welcome_safe swallowed an exception for lead %s", getattr(lead, "ID", None), exc_info=True)


def _enqueue_welcome(db: Session, lead: Lead) -> None:
    cfg = whatsapp_config_service.resolve_by_vendor_id(db, lead.VENDOR_ID)
    if not cfg:
        return

    setting = whatsapp_config_service.resolve_module_setting(db, lead.VENDOR_ID, "lead_module")
    if not setting or not setting.IS_ENABLED or not setting.AUTO_TRIGGER_ENABLED:
        return
    if not lead.CONTACT_MOBILE:
        return

    enqueue_template_message(
        db, lead.VENDOR_ID, lead.CONTACT_MOBILE, purpose="WELCOME",
        dedup_key=f"welcome:{lead.ID}", source_record_id=lead.ID, module_code="lead_module", config=cfg,
    )


def enqueue_ai_reply(db: Session, conversation: WhatsAppConversation, body_text: str, dedup_key: str) -> Optional[WhatsAppMessage]:
    if db.query(WhatsAppMessage).filter(
        WhatsAppMessage.VENDOR_ID == conversation.VENDOR_ID, WhatsAppMessage.DEDUP_KEY == dedup_key
    ).first():
        return None

    msg = WhatsAppMessage(
        VENDOR_ID=conversation.VENDOR_ID,
        CONVERSATION_ID=conversation.ID,
        SOURCE_RECORD_ID=conversation.SOURCE_RECORD_ID,
        CONFIG_ID=conversation.CONFIG_ID,
        DIRECTION="OUT",
        DEDUP_KEY=dedup_key,
        MESSAGE_TYPE="text",
        PURPOSE="AI_REPLY",
        BODY_TEXT=body_text,
        STATUS="PENDING",
    )
    db.add(msg)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return msg


def enqueue_manual(db: Session, conversation: WhatsAppConversation, body_text: str) -> WhatsAppMessage:
    """Unconstrained — a rep may send as many manual messages as they like,
    so DEDUP_KEY is left NULL (a nullable column in a MySQL UNIQUE index
    permits unlimited NULLs)."""
    msg = WhatsAppMessage(
        VENDOR_ID=conversation.VENDOR_ID,
        CONVERSATION_ID=conversation.ID,
        SOURCE_RECORD_ID=conversation.SOURCE_RECORD_ID,
        CONFIG_ID=conversation.CONFIG_ID,
        DIRECTION="OUT",
        MESSAGE_TYPE="text",
        PURPOSE="MANUAL",
        BODY_TEXT=body_text,
        STATUS="PENDING",
    )
    db.add(msg)
    db.commit()
    return msg


def requeue_blocked(db: Session, cfg: VendorWhatsAppConfig) -> int:
    rows = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.CONFIG_ID == cfg.ID,
        WhatsAppMessage.DIRECTION == "OUT",
        WhatsAppMessage.STATUS == "BLOCKED",
    ).all()
    for row in rows:
        row.STATUS = "PENDING"
        row.NEXT_ATTEMPT_AT = None
        row.ATTEMPT_COUNT = 0
        row.ERROR_CODE = None
        row.ERROR_MESSAGE = None
    db.commit()
    return len(rows)


# ── Outbound drain (called by whatsapp_scheduler.py's tick) ──────────────────

def dispatch_outbound_once() -> None:
    db = SessionLocal()
    try:
        configs = db.query(VendorWhatsAppConfig).filter(VendorWhatsAppConfig.IS_ACTIVE.is_(True)).all()
        for cfg in configs:
            try:
                _drain_config(db, cfg)
            except Exception:
                db.rollback()
                log.exception("WhatsApp outbound drain failed for config %s", cfg.ID)
    except Exception:
        log.exception("WhatsApp outbound tick failed")
    finally:
        db.close()


def _drain_config(db: Session, cfg: VendorWhatsAppConfig) -> None:
    if whatsapp_config_service.is_paused(cfg):
        return

    today_start = now_ist().replace(hour=0, minute=0, second=0, microsecond=0)
    sent_today = db.query(func.count(WhatsAppMessage.ID)).filter(
        WhatsAppMessage.CONFIG_ID == cfg.ID,
        WhatsAppMessage.DIRECTION == "OUT",
        WhatsAppMessage.STATUS == "SENT",
        WhatsAppMessage.SENT_AT >= today_start,
    ).scalar() or 0

    remaining_daily = cfg.DAILY_SEND_CAP - sent_today
    if remaining_daily <= 0:
        if cfg.HEALTH_STATUS != "DAILY_CAP_REACHED":
            cfg.HEALTH_STATUS = "DAILY_CAP_REACHED"
            db.commit()
        return

    batch_size = max(1, min(cfg.MAX_SEND_PER_SECOND * 2, remaining_daily, 50))
    rows = (
        db.query(WhatsAppMessage)
        .filter(
            WhatsAppMessage.CONFIG_ID == cfg.ID,
            WhatsAppMessage.DIRECTION == "OUT",
            WhatsAppMessage.STATUS == "PENDING",
        )
        .filter((WhatsAppMessage.NEXT_ATTEMPT_AT.is_(None)) | (WhatsAppMessage.NEXT_ATTEMPT_AT <= now_ist()))
        .order_by(WhatsAppMessage.QUEUED_AT)
        .limit(batch_size)
        .all()
    )
    if not rows:
        return

    token = whatsapp_config_service.get_access_token(cfg)
    for msg in rows:
        try:
            _send_one(db, cfg, msg, token)
        except Exception:
            db.rollback()
            log.exception("WhatsApp send failed unexpectedly for message %s", msg.ID)


def _build_template_params(db: Session, setting: Optional[WhatsAppModuleSetting], msg: WhatsAppMessage) -> List[str]:
    if msg.PURPOSE == "WELCOME":
        lead = db.query(Lead).filter(Lead.ID == msg.SOURCE_RECORD_ID).first() if msg.SOURCE_RECORD_ID else None
        field_names = [f.strip() for f in ((setting.WELCOME_TEMPLATE_PARAMS if setting else None) or "").split(",") if f.strip()]

        if not field_names:
            # No mapping configured — fall back to the single most common
            # case, a 1-parameter template whose {{1}} is the contact name.
            name = lead.CONTACT_NAME if lead else None
            return [whatsapp_cloud_client.sanitize_template_param(name or "there")]

        params = []
        for field_name in field_names:
            value = getattr(lead, field_name, None) if lead else None
            params.append(whatsapp_cloud_client.sanitize_template_param(str(value) if value not in (None, "") else "-"))
        return params

    # Re-engagement templates are designed with exactly one {{1}} body param
    # for the AI's message text (see WhatsAppModuleSetting's REENGAGE_TEMPLATE_* docstring).
    return [whatsapp_cloud_client.sanitize_template_param(msg.BODY_TEXT or "")]


def _send_one(db: Session, cfg: VendorWhatsAppConfig, msg: WhatsAppMessage, token: str) -> None:
    conv = db.query(WhatsAppConversation).filter(WhatsAppConversation.ID == msg.CONVERSATION_ID).first()
    if not conv:
        msg.STATUS = "FAILED"
        msg.ERROR_MESSAGE = "Conversation missing"
        db.commit()
        return

    setting = whatsapp_config_service.resolve_module_setting(db, cfg.VENDOR_ID, conv.MODULE_CODE or "lead_module")

    msg.STATUS = "SENDING"
    msg.ATTEMPT_COUNT = (msg.ATTEMPT_COUNT or 0) + 1
    db.commit()

    if msg.MESSAGE_TYPE == "document":
        mode = "document"
    else:
        mode = "template" if msg.PURPOSE == "WELCOME" else resolve_send_mode(conv)
    ok, wamid, err = False, None, None

    try:
        if mode == "document":
            ok, wamid, err = whatsapp_cloud_client.send_document_link(
                cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.PHONE_NUMBER_ID, token,
                conv.WA_ID, msg.MEDIA_URL, filename=msg.TEMPLATE_NAME, caption=msg.BODY_TEXT,
            )
        elif mode == "template":
            template_name = setting.WELCOME_TEMPLATE_NAME if (setting and msg.PURPOSE == "WELCOME") else (setting.REENGAGE_TEMPLATE_NAME if setting else None)
            template_lang = (setting.WELCOME_TEMPLATE_LANG if (setting and msg.PURPOSE == "WELCOME") else (setting.REENGAGE_TEMPLATE_LANG if setting else None)) or "en_US"
            if not template_name:
                _fail_permanent(db, cfg, msg, "TEMPLATE_MISSING", "NO_TEMPLATE",
                                 "No template configured for this message purpose", needs_human=True)
                return
            params = _build_template_params(db, setting, msg)
            ok, wamid, err = whatsapp_cloud_client.send_template(
                cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.PHONE_NUMBER_ID, token,
                conv.WA_ID, template_name, template_lang, params,
            )
            msg.TEMPLATE_NAME, msg.TEMPLATE_LANG, msg.MESSAGE_TYPE = template_name, template_lang, "template"
        else:
            ok, wamid, err = whatsapp_cloud_client.send_text(
                cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.PHONE_NUMBER_ID, token, conv.WA_ID, msg.BODY_TEXT or "",
            )
            msg.MESSAGE_TYPE = "text"
    except Exception as exc:
        err = {"kind": "TRANSIENT", "code": "EXCEPTION", "message": str(exc)}

    if ok:
        msg.STATUS = "SENT"
        msg.WA_MESSAGE_ID = wamid
        msg.SENT_AT = now_ist()
        conv.LAST_OUTBOUND_AT = now_ist()
        conv.OUTBOUND_COUNT = (conv.OUTBOUND_COUNT or 0) + 1
        db.commit()
        whatsapp_config_service.mark_success(db, cfg)
        return

    _apply_send_failure(db, cfg, setting, msg, conv, err, mode)


def _fail_permanent(db, cfg, msg, health_status, code, message, needs_human=False):
    msg.STATUS = "BLOCKED"
    msg.ERROR_CODE = code
    msg.ERROR_MESSAGE = message
    msg.NEEDS_HUMAN = needs_human
    db.commit()
    whatsapp_config_service.mark_error(db, cfg, health_status, code, message)


def _apply_send_failure(db: Session, cfg: VendorWhatsAppConfig, setting: Optional[WhatsAppModuleSetting],
                         msg: WhatsAppMessage, conv: WhatsAppConversation, err: dict, attempted_mode: str) -> None:
    kind, code, message = err.get("kind"), err.get("code"), err.get("message")
    msg.ERROR_CODE, msg.ERROR_MESSAGE = code, (message or "")[:500]

    if kind == "AUTH_FAILED":
        msg.STATUS = "BLOCKED"
        db.commit()
        whatsapp_config_service.mark_error(db, cfg, "AUTH_FAILED", code, message, pause_seconds=900)

    elif kind == "RATE_LIMITED":
        msg.STATUS = "PENDING"
        msg.NEXT_ATTEMPT_AT = now_ist() + timedelta(seconds=min(2 ** msg.ATTEMPT_COUNT, 300))
        db.commit()
        whatsapp_config_service.mark_error(db, cfg, "RATE_LIMITED", code, message, pause_seconds=30)

    elif kind == "WINDOW_CLOSED" and attempted_mode == "text":
        # Our LAST_INBOUND_AT was stale — self-heal with a single synchronous
        # fallback to the re-engagement template rather than requeuing (the
        # requeue would just recompute the same stale decision).
        template_name = setting.REENGAGE_TEMPLATE_NAME if setting else None
        template_lang = (setting.REENGAGE_TEMPLATE_LANG if setting else None) or "en_US"
        if not template_name:
            _fail_permanent(db, cfg, msg, "TEMPLATE_MISSING", "NO_REENGAGE_TEMPLATE",
                             "24h window closed and no re-engagement template is configured", needs_human=True)
            return
        token = whatsapp_config_service.get_access_token(cfg)
        params = [whatsapp_cloud_client.sanitize_template_param(msg.BODY_TEXT or "")]
        ok, wamid, err2 = whatsapp_cloud_client.send_template(
            cfg.API_BASE_URL, cfg.GRAPH_API_VERSION, cfg.PHONE_NUMBER_ID, token,
            conv.WA_ID, template_name, template_lang, params,
        )
        msg.TEMPLATE_NAME, msg.TEMPLATE_LANG, msg.MESSAGE_TYPE = template_name, template_lang, "template"
        if ok:
            msg.STATUS, msg.WA_MESSAGE_ID, msg.SENT_AT = "SENT", wamid, now_ist()
            conv.LAST_OUTBOUND_AT = now_ist()
            db.commit()
            whatsapp_config_service.mark_success(db, cfg)
        else:
            msg.STATUS = "FAILED"
            msg.ERROR_CODE, msg.ERROR_MESSAGE = err2.get("code"), (err2.get("message") or "")[:500]
            db.commit()

    elif kind == "UNREACHABLE":
        msg.STATUS = "FAILED"
        conv.WA_OPT_STATE = "NOT_ON_WHATSAPP"
        db.commit()

    elif kind == "OPTED_OUT":
        msg.STATUS = "FAILED"
        conv.WA_OPT_STATE = "OPTED_OUT"
        db.commit()

    elif kind == "TEMPLATE_ERROR":
        msg.STATUS = "BLOCKED"
        msg.NEEDS_HUMAN = True
        db.commit()
        whatsapp_config_service.mark_error(db, cfg, "TEMPLATE_MISSING", code, message)

    elif kind == "TRANSIENT":
        if msg.ATTEMPT_COUNT >= msg.MAX_ATTEMPTS:
            msg.STATUS = "FAILED"
        else:
            delay = _TRANSIENT_BACKOFF[min(msg.ATTEMPT_COUNT - 1, len(_TRANSIENT_BACKOFF) - 1)]
            msg.STATUS = "PENDING"
            msg.NEXT_ATTEMPT_AT = now_ist() + timedelta(seconds=delay)
        db.commit()

    else:  # PERMANENT
        msg.STATUS = "FAILED"
        db.commit()
