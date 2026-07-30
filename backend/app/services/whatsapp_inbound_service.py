"""Inbound WhatsApp processing: webhook ingestion (fast path, called from the
request handler) and AI-reply generation (slow path, drained by an
APScheduler tick — see whatsapp_scheduler.py).

Ingestion is deliberately cheap and defensive: verify signature, persist,
return 200 as fast as possible. Meta retries webhook deliveries at-least-once
and will eventually disable a subscription that keeps returning non-2xx, so
every code path here returns 200 except a genuine bad signature."""
import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import SessionLocal
from app.models.rag_models import AIChatHistory, AIModule
from app.models.whatsapp_models import VendorWhatsAppConfig, WhatsAppConversation, WhatsAppMessage, WhatsAppWebhookEvent
from app.services import whatsapp_config_service, whatsapp_outbox_service, whatsapp_lead_matcher
from app.utils.datetime_utils import now_ist
from app.utils.whatsapp_language_utils import resolve_language_from_button_title, language_display_name

log = logging.getLogger(__name__)

_MODULE_CODE = "lead_module"
_KNOWN_TYPES = {"text", "image", "audio", "video", "document", "location", "sticker", "interactive", "button"}
_STOP_KEYWORDS = {"stop", "unsubscribe", "opt out", "optout"}
_FALLBACK_MESSAGE = "Thanks for your message — one of our sales executives will follow up with you shortly."

_DEBOUNCE_SECONDS = int(os.getenv("WA_DEBOUNCE_SECONDS", "3"))
_INBOUND_WORKERS = int(os.getenv("WA_INBOUND_WORKERS", "3"))
_MAX_BODY_BYTES = 1_000_000  # 1 MB


# ── Webhook ingestion (called from routes/whatsapp_webhook.py) ──────────────

def ingest_webhook(db: Session, raw_body: bytes, headers: Dict[str, str]) -> Tuple[int, dict]:
    if len(raw_body) > _MAX_BODY_BYTES:
        _log_event(db, None, None, "MISSING", "TOO_LARGE")
        return 200, {"status": "ignored"}

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        _log_event(db, None, None, "MISSING", "MALFORMED", error_message="invalid JSON", raw_body=raw_body)
        return 200, {"status": "ignored"}

    try:
        entry = (payload.get("entry") or [{}])[0]
        change = (entry.get("changes") or [{}])[0]
        value = change.get("value") or {}
        phone_number_id = (value.get("metadata") or {}).get("phone_number_id")
    except Exception:
        _log_event(db, None, None, "MISSING", "MALFORMED", error_message="unexpected payload shape", raw_body=raw_body)
        return 200, {"status": "ignored"}

    if not phone_number_id:
        _log_event(db, None, None, "MISSING", "MALFORMED", raw_body=raw_body)
        return 200, {"status": "ignored"}

    cfg = whatsapp_config_service.resolve_by_phone_number_id(db, phone_number_id)
    if not cfg:
        _log_event(db, None, phone_number_id, "MISSING", "UNKNOWN_PHONE_ID", raw_body=raw_body)
        return 200, {"status": "ignored"}

    sig_status = "SKIPPED"
    if cfg.APP_SECRET:
        signature_header = headers.get("x-hub-signature-256") or headers.get("X-Hub-Signature-256", "")
        app_secret = whatsapp_config_service.get_app_secret(cfg)
        if not _verify_signature(app_secret, raw_body, signature_header):
            _log_event(db, cfg.VENDOR_ID, phone_number_id, "INVALID", "BAD_SIGNATURE", raw_body=raw_body)
            return 401, {"status": "invalid signature"}
        sig_status = "VALID"

    messages = value.get("messages") or []
    statuses = value.get("statuses") or []
    contacts = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in (value.get("contacts") or [])}

    claimed = 0
    for m in messages:
        if _store_inbound_message(db, cfg, m, contacts.get(m.get("from"))):
            claimed += 1

    for s in statuses:
        _apply_status_update(db, s)

    if messages:
        result = "ACCEPTED" if claimed else "DUPLICATE"
    elif statuses:
        result = "STATUS_ONLY"
    else:
        result = "IGNORED"

    _log_event(db, cfg.VENDOR_ID, phone_number_id, sig_status, result,
               message_count=len(messages), status_count=len(statuses), claimed_count=claimed)
    return 200, {"status": "ok"}


def _verify_signature(app_secret: str, raw_body: bytes, signature_header: str) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    provided = signature_header.split("=", 1)[1]
    return hmac.compare_digest(expected, provided)


def _store_inbound_message(db: Session, cfg: VendorWhatsAppConfig, m: dict, profile_name: Optional[str]) -> bool:
    wamid = m.get("id")
    from_wa = m.get("from")
    if not from_wa:
        return False

    msg_type = m.get("type") or "unsupported"
    wa_timestamp = None
    ts_raw = m.get("timestamp")
    if ts_raw:
        try:
            wa_timestamp = datetime.fromtimestamp(int(ts_raw))
        except (ValueError, OSError):
            wa_timestamp = None

    body_text, media_id, media_mime = _extract_body(msg_type, m)

    conv = whatsapp_outbox_service.get_or_create_conversation(db, cfg.VENDOR_ID, cfg.ID, from_wa)
    conv.LAST_INBOUND_AT = now_ist()
    conv.INBOUND_COUNT = (conv.INBOUND_COUNT or 0) + 1
    if profile_name:
        conv.CONTACT_PROFILE_NAME = profile_name
    if not conv.SOURCE_RECORD_ID:
        lead = whatsapp_lead_matcher.resolve_lead_for_wa_id(db, cfg.VENDOR_ID, from_wa, cfg.DEFAULT_COUNTRY_CODE)
        if lead:
            conv.SOURCE_RECORD_ID = lead.ID

    if msg_type in ("interactive", "button"):
        # A tapped quick-reply button is the one fully-reliable language
        # signal — never inferred from free-typed text (see module docstring
        # in whatsapp_language_utils.py for why).
        tapped_language = resolve_language_from_button_title(body_text)
        if tapped_language:
            conv.PREFERRED_LANGUAGE = tapped_language

    db.add(WhatsAppMessage(
        VENDOR_ID=cfg.VENDOR_ID,
        CONVERSATION_ID=conv.ID,
        SOURCE_RECORD_ID=conv.SOURCE_RECORD_ID,
        CONFIG_ID=cfg.ID,
        DIRECTION="IN",
        WA_MESSAGE_ID=wamid,
        WA_TIMESTAMP=wa_timestamp,
        MESSAGE_TYPE=msg_type if msg_type in _KNOWN_TYPES else "unsupported",
        BODY_TEXT=body_text,
        MEDIA_ID=media_id,
        MEDIA_MIME=media_mime,
        STATUS="RECEIVED",
        PROCESSING_STATE="PENDING",
        NEXT_ATTEMPT_AT=now_ist() + timedelta(seconds=_DEBOUNCE_SECONDS),
        RAW_PAYLOAD=json.dumps(m, default=str)[:8000],
    ))
    try:
        db.commit()
        return True
    except IntegrityError:
        db.rollback()  # duplicate wamid — Meta redelivered a message we already have
        return False


def _extract_body(msg_type: str, m: dict) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    if msg_type == "text":
        return (m.get("text") or {}).get("body"), None, None
    if msg_type == "button":
        return (m.get("button") or {}).get("text"), None, None
    if msg_type == "interactive":
        interactive = m.get("interactive") or {}
        if interactive.get("type") == "button_reply":
            return (interactive.get("button_reply") or {}).get("title"), None, None
        if interactive.get("type") == "list_reply":
            return (interactive.get("list_reply") or {}).get("title"), None, None
        return None, None, None
    if msg_type in ("image", "audio", "video", "document", "sticker"):
        media = m.get(msg_type) or {}
        return media.get("caption"), media.get("id"), media.get("mime_type")
    return None, None, None


_STATUS_RANK = {"sent": 1, "delivered": 2, "read": 3, "failed": 99}


def _apply_status_update(db: Session, s: dict) -> None:
    wamid, status = s.get("id"), s.get("status")
    if not wamid or status not in _STATUS_RANK:
        return

    msg = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.WA_MESSAGE_ID == wamid, WhatsAppMessage.DIRECTION == "OUT"
    ).first()
    if not msg:
        return

    if _STATUS_RANK[status] <= _STATUS_RANK.get(msg.DELIVERY_STATUS or "", 0):
        return  # forward-only — Meta's status callbacks can arrive out of order

    msg.DELIVERY_STATUS = status
    if status == "delivered":
        msg.DELIVERED_AT = now_ist()
    elif status == "read":
        msg.READ_AT = now_ist()
    elif status == "failed":
        errors = s.get("errors") or []
        if errors:
            msg.ERROR_CODE = str(errors[0].get("code"))
            msg.ERROR_MESSAGE = errors[0].get("title") or errors[0].get("message")
    db.commit()


def _log_event(db: Session, vendor_id: Optional[int], phone_number_id: Optional[str], sig_status: str, result: str,
               message_count: int = 0, status_count: int = 0, claimed_count: int = 0,
               error_message: Optional[str] = None, raw_body: Optional[bytes] = None) -> None:
    try:
        db.add(WhatsAppWebhookEvent(
            VENDOR_ID=vendor_id,
            PHONE_NUMBER_ID=phone_number_id,
            SIGNATURE_STATUS=sig_status,
            RESULT=result,
            MESSAGE_COUNT=message_count,
            STATUS_COUNT=status_count,
            CLAIMED_COUNT=claimed_count,
            ERROR_MESSAGE=error_message,
            RAW_BODY=(raw_body.decode("utf-8", errors="replace")[:16000] if raw_body else None),
        ))
        db.commit()
    except Exception:
        db.rollback()
        log.exception("Failed to write whatsapp_webhook_event")


# ── AI reply generation (drained by whatsapp_scheduler.py's inbound tick) ───

def process_pending_inbound_once() -> None:
    from concurrent.futures import ThreadPoolExecutor

    db = SessionLocal()
    try:
        rows = (
            db.query(WhatsAppMessage)
            .filter(WhatsAppMessage.DIRECTION == "IN", WhatsAppMessage.PROCESSING_STATE == "PENDING")
            .filter((WhatsAppMessage.NEXT_ATTEMPT_AT.is_(None)) | (WhatsAppMessage.NEXT_ATTEMPT_AT <= now_ist()))
            .order_by(WhatsAppMessage.CREATED_AT)
            .limit(50)
            .all()
        )
        if not rows:
            return

        conversation_ids: List[str] = []
        seen = set()
        for r in rows:
            if r.CONVERSATION_ID not in seen:
                seen.add(r.CONVERSATION_ID)
                conversation_ids.append(r.CONVERSATION_ID)
            r.PROCESSING_STATE = "PROCESSING"
        db.commit()

        with ThreadPoolExecutor(max_workers=_INBOUND_WORKERS) as executor:
            futures = [executor.submit(_handle_conversation_safe, cid) for cid in conversation_ids]
            for f in futures:
                f.result()  # tick doesn't return until every claimed conversation is done — no cross-tick overlap
    except Exception:
        log.exception("WhatsApp inbound tick failed")
    finally:
        db.close()


def _handle_conversation_safe(conversation_id: str) -> None:
    db = SessionLocal()
    try:
        _handle_conversation(db, conversation_id)
    except Exception:
        db.rollback()
        log.exception("WhatsApp inbound processing failed for conversation %s", conversation_id)
    finally:
        db.close()


def _handle_conversation(db: Session, conversation_id: str) -> None:
    conv = (
        db.query(WhatsAppConversation)
        .filter(WhatsAppConversation.ID == conversation_id)
        .with_for_update()
        .first()
    )
    if not conv:
        return

    cfg = None
    if conv.CONFIG_ID:
        cfg = db.query(VendorWhatsAppConfig).filter(VendorWhatsAppConfig.ID == conv.CONFIG_ID).first()
    if not cfg:
        cfg = whatsapp_config_service.resolve_by_vendor_id(db, conv.VENDOR_ID)

    module_setting = whatsapp_config_service.resolve_module_setting(db, conv.VENDOR_ID, conv.MODULE_CODE or _MODULE_CODE)

    pending = (
        db.query(WhatsAppMessage)
        .filter(
            WhatsAppMessage.CONVERSATION_ID == conv.ID,
            WhatsAppMessage.DIRECTION == "IN",
            WhatsAppMessage.PROCESSING_STATE == "PROCESSING",
        )
        .order_by(WhatsAppMessage.CREATED_AT)
        .all()
    )
    if not pending:
        return

    ai_reply_enabled = bool(module_setting and module_setting.IS_ENABLED and module_setting.AI_REPLY_ENABLED)
    if not conv.AI_ENABLED or conv.WA_OPT_STATE != "ACTIVE" or not cfg or not ai_reply_enabled:
        for row in pending:
            row.PROCESSING_STATE = "DISCARDED"
        db.commit()
        return

    combined = " ".join((r.BODY_TEXT or "").strip() for r in pending).strip().lower()
    if combined in _STOP_KEYWORDS:
        conv.WA_OPT_STATE = "OPTED_OUT"
        for row in pending:
            row.PROCESSING_STATE = "DISCARDED"
        db.commit()
        return

    usable = [r for r in pending if (r.BODY_TEXT or "").strip()]
    if not usable:
        for row in pending:
            row.PROCESSING_STATE = "DISCARDED"
        db.commit()
        return

    # Coalesce rapid-fire messages into a single turn, keyed off the last one.
    for row in usable[:-1]:
        row.PROCESSING_STATE = "COALESCED"
    last = usable[-1]
    last.PROCESSING_STATE = "PROCESSED"
    turn_text = "\n".join(r.BODY_TEXT.strip() for r in usable)
    db.commit()

    history = build_history(db, conv, exclude_message_id=last.ID)
    answer, meta, had_error = run_ai_turn(db, conv, turn_text, history)

    if had_error or not answer:
        answer = _FALLBACK_MESSAGE
        meta = {}
        conv.NEEDS_HUMAN = True
        conv.HANDOFF_REASON = "AI reply failed"

    dedup_key = f"reply:{last.WA_MESSAGE_ID or last.ID}"
    reply_msg = whatsapp_outbox_service.enqueue_ai_reply(db, conv, answer, dedup_key)

    if reply_msg:
        _write_chat_history(db, conv, turn_text, answer, meta)

    conv.LAST_AI_REPLY_AT = now_ist()
    db.commit()


def run_ai_turn(db: Session, conv: WhatsAppConversation, turn_text: str,
                 history: List[Dict]) -> Tuple[str, dict, bool]:
    """Drains run_chat() for one turn. run_chat() does NOT raise on failure —
    it yields {"type": "error", ...} then {"type": "done"} — so failure must
    be detected by checking event types, not by catching an exception alone.

    Which RAG module answers is conv.MODULE_CODE — set once when the
    conversation was created (see whatsapp_outbox_service.
    get_or_create_conversation). Falls back to _MODULE_CODE ("lead_module")
    for any conversation row created before this column existed, so no
    backfill/migration is required. A future module (Sales, Support, ...)
    that creates its own conversations with its own module_code gets routed
    to its own RAG module here automatically, with zero change to this
    function."""
    from app.rag_modules.core.chat_orchestrator import run_chat
    from app.rag_modules.core.module_registry import get_tools, get_tool_resolver, get_system_prompt

    module_code = conv.MODULE_CODE or _MODULE_CODE

    # Soft default only — never a hard lock. A customer who tapped "English"
    # but later types in Tamil is still followed naturally; this just gives
    # the model a confirmed starting point instead of guessing from scratch
    # every turn (and losing the signal entirely once history truncates).
    system_prompt_override = None
    if conv.PREFERRED_LANGUAGE:
        label = language_display_name(conv.PREFERRED_LANGUAGE)
        system_prompt_override = get_system_prompt(module_code) + (
            f"\n\nThe customer has confirmed their preferred language is {label} "
            f"(selected via the welcome message's language button). Reply in {label} "
            f"by default — but if the customer clearly writes in a different language, "
            f"follow their lead and reply in that language instead, exactly as you "
            f"already do today."
        )

    tools = get_tools(module_code)
    resolver_fn = get_tool_resolver(module_code)
    # Generic key name — this dict is built here in the shared inbound
    # service, so it shouldn't hardcode Lead's vocabulary. Each module's own
    # tools.py interprets source_record_id according to its own MODULE_CODE
    # (for "lead_module" it's a Lead.ID).
    tool_context = {"vendor_id": conv.VENDOR_ID, "source_record_id": conv.SOURCE_RECORD_ID, "conversation_id": conv.ID}
    tool_resolver = (lambda name, args: resolver_fn(name, args, db, tool_context)) if resolver_fn else None

    parts: List[str] = []
    meta: dict = {}
    had_error = False

    try:
        for event in run_chat(
            db, module_code, turn_text, session_id=conv.SESSION_ID, history=history,
            tools=tools, tool_resolver=tool_resolver, system_prompt_override=system_prompt_override,
        ):
            if event["type"] == "text":
                parts.append(event["text"])
            elif event["type"] == "error":
                had_error = True
            elif event["type"] == "usage":
                meta = event
    except Exception:
        log.exception("run_chat raised unexpectedly for WhatsApp conversation %s", conv.ID)
        had_error = True

    return "".join(parts).strip(), meta, had_error


def build_history(db: Session, conv: WhatsAppConversation, exclude_message_id: Optional[str] = None,
                   limit: int = 20, max_chars: int = 6000) -> List[Dict]:
    rows = (
        db.query(WhatsAppMessage)
        .filter(WhatsAppMessage.CONVERSATION_ID == conv.ID, WhatsAppMessage.BODY_TEXT.isnot(None))
        .order_by(WhatsAppMessage.CREATED_AT.desc())
        .limit(limit + 5)
        .all()
    )
    rows = [r for r in rows if r.ID != exclude_message_id and (r.DIRECTION == "IN" or r.STATUS == "SENT")]
    rows.reverse()  # chronological

    turns = []
    for r in rows:
        text = (r.BODY_TEXT or "").strip()
        if not text:
            continue
        turns.append({"role": "user" if r.DIRECTION == "IN" else "model", "text": text})

    # Gemini requires history to start with a "user" turn — every lead's
    # first stored message is the outbound welcome ("model"), so without
    # this the customer's very first reply would fail every single time.
    while turns and turns[0]["role"] == "model":
        turns.pop(0)

    total = sum(len(t["text"]) for t in turns)
    while total > max_chars and turns:
        removed = turns.pop(0)
        total -= len(removed["text"])
        while turns and turns[0]["role"] == "model":
            turns.pop(0)

    return turns[-limit:]


def _write_chat_history(db: Session, conv: WhatsAppConversation, question: str, answer: str, meta: dict) -> None:
    try:
        module_id = (
            db.query(AIModule.ID).filter(AIModule.MODULE_CODE == (conv.MODULE_CODE or _MODULE_CODE)).scalar()
        )
        if not module_id:
            return
        db.add(AIChatHistory(
            MODULE_ID=module_id,
            USER_ID=None,
            SESSION_ID=conv.SESSION_ID,
            QUESTION=question,
            ANSWER=answer,
            PROMPT_TOKENS=meta.get("prompt_tokens"),
            COMPLETION_TOKENS=meta.get("completion_tokens"),
            TOTAL_TOKENS=meta.get("total_tokens"),
            RESPONSE_TIME=meta.get("response_time"),
            MODEL_NAME=meta.get("model_name"),
        ))
        db.commit()
    except Exception:
        db.rollback()
        log.warning("Failed to write AIChatHistory row for WhatsApp conversation %s", conv.ID, exc_info=True)
