"""Admin visibility + manual actions for WhatsApp conversations — the surface
that makes "never silently dropped" real for a human operator (unmatched
conversations, failed sends, per-conversation message history, human
takeover toggle, manual replies)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.lead_models import Lead
from app.models.whatsapp_models import WhatsAppConversation, WhatsAppMessage
from app.schemas.whatsapp_schema import WhatsAppLinkLeadRequest, WhatsAppAiToggleRequest, WhatsAppManualSendRequest
from app.auth.auth_bearer import get_current_admin
from app.services import whatsapp_outbox_service

router = APIRouter(prefix="/whatsapp-inbox", tags=["WhatsApp Inbox"])


def _serialize_conversation(conv: WhatsAppConversation) -> dict:
    return {
        "ID": conv.ID,
        "VENDOR_ID": conv.VENDOR_ID,
        "CONFIG_ID": conv.CONFIG_ID,
        "SOURCE_RECORD_ID": conv.SOURCE_RECORD_ID,
        "WA_ID": conv.WA_ID,
        "CONTACT_PROFILE_NAME": conv.CONTACT_PROFILE_NAME,
        "LAST_INBOUND_AT": conv.LAST_INBOUND_AT.isoformat() if conv.LAST_INBOUND_AT else None,
        "LAST_OUTBOUND_AT": conv.LAST_OUTBOUND_AT.isoformat() if conv.LAST_OUTBOUND_AT else None,
        "LAST_AI_REPLY_AT": conv.LAST_AI_REPLY_AT.isoformat() if conv.LAST_AI_REPLY_AT else None,
        "INBOUND_COUNT": conv.INBOUND_COUNT,
        "OUTBOUND_COUNT": conv.OUTBOUND_COUNT,
        "WA_OPT_STATE": conv.WA_OPT_STATE,
        "AI_ENABLED": conv.AI_ENABLED,
        "NEEDS_HUMAN": conv.NEEDS_HUMAN,
        "HANDOFF_REASON": conv.HANDOFF_REASON,
        "PREFERRED_LANGUAGE": conv.PREFERRED_LANGUAGE,
        "CREATED_AT": conv.CREATED_AT.isoformat() if conv.CREATED_AT else None,
        "UPDATED_AT": conv.UPDATED_AT.isoformat() if conv.UPDATED_AT else None,
    }


def _serialize_message(row: WhatsAppMessage) -> dict:
    return {
        "ID": row.ID,
        "CONVERSATION_ID": row.CONVERSATION_ID,
        "SOURCE_RECORD_ID": row.SOURCE_RECORD_ID,
        "DIRECTION": row.DIRECTION,
        "MESSAGE_TYPE": row.MESSAGE_TYPE,
        "PURPOSE": row.PURPOSE,
        "BODY_TEXT": row.BODY_TEXT,
        "STATUS": row.STATUS,
        "DELIVERY_STATUS": row.DELIVERY_STATUS,
        "ERROR_CODE": row.ERROR_CODE,
        "ERROR_MESSAGE": row.ERROR_MESSAGE,
        "NEEDS_HUMAN": row.NEEDS_HUMAN,
        "QUEUED_AT": row.QUEUED_AT.isoformat() if row.QUEUED_AT else None,
        "SENT_AT": row.SENT_AT.isoformat() if row.SENT_AT else None,
        "CREATED_AT": row.CREATED_AT.isoformat() if row.CREATED_AT else None,
    }


def _get_conversation_or_404(db: Session, conversation_id: str) -> WhatsAppConversation:
    conv = db.query(WhatsAppConversation).filter(WhatsAppConversation.ID == conversation_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.get("/conversations")
def list_conversations(
    vendor_id: int = Query(1),
    needs_human: Optional[bool] = Query(None),
    unmatched: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    q = db.query(WhatsAppConversation).filter(WhatsAppConversation.VENDOR_ID == vendor_id)
    if needs_human is not None:
        q = q.filter(WhatsAppConversation.NEEDS_HUMAN == needs_human)
    if unmatched is not None:
        q = q.filter(WhatsAppConversation.SOURCE_RECORD_ID.is_(None) if unmatched else WhatsAppConversation.SOURCE_RECORD_ID.isnot(None))
    if search:
        term = f"%{search.strip()}%"
        q = q.filter(WhatsAppConversation.WA_ID.ilike(term) | WhatsAppConversation.CONTACT_PROFILE_NAME.ilike(term))

    total = q.count()
    rows = q.order_by(WhatsAppConversation.UPDATED_AT.desc()).offset(offset).limit(limit).all()
    return {"total": total, "limit": limit, "offset": offset, "rows": [_serialize_conversation(r) for r in rows]}


@router.get("/conversations/{conversation_id}/messages")
def list_conversation_messages(
    conversation_id: str,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    _get_conversation_or_404(db, conversation_id)
    q = db.query(WhatsAppMessage).filter(WhatsAppMessage.CONVERSATION_ID == conversation_id)
    total = q.count()
    rows = q.order_by(WhatsAppMessage.CREATED_AT.asc()).offset(offset).limit(limit).all()
    return {"total": total, "limit": limit, "offset": offset, "rows": [_serialize_message(r) for r in rows]}


@router.post("/conversations/{conversation_id}/link-lead")
def link_lead(conversation_id: str, data: WhatsAppLinkLeadRequest, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    """Deliberately Lead-specific by name and payload — a concrete "link this
    conversation to a Lead" admin action — even though the storage underneath
    is the generic SOURCE_RECORD_ID/MODULE_CODE pair. Mirrors how
    enqueue_welcome_safe() wraps the generic enqueue_template_message()."""
    conv = _get_conversation_or_404(db, conversation_id)
    lead = db.query(Lead).filter(Lead.ID == data.LEAD_ID, Lead.VENDOR_ID == conv.VENDOR_ID).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found for this vendor")

    conv.SOURCE_RECORD_ID = lead.ID
    conv.MODULE_CODE = conv.MODULE_CODE or "lead_module"
    db.query(WhatsAppMessage).filter(WhatsAppMessage.CONVERSATION_ID == conv.ID).update({"SOURCE_RECORD_ID": lead.ID})
    db.commit()
    return {"message": "Conversation linked to lead", **_serialize_conversation(conv)}


@router.post("/conversations/{conversation_id}/ai-toggle")
def toggle_ai(conversation_id: str, data: WhatsAppAiToggleRequest, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    conv = _get_conversation_or_404(db, conversation_id)
    conv.AI_ENABLED = data.AI_ENABLED
    if data.AI_ENABLED:
        conv.NEEDS_HUMAN = False
        conv.HANDOFF_REASON = None
    db.commit()
    return {"message": "AI auto-reply toggled", **_serialize_conversation(conv)}


@router.post("/conversations/{conversation_id}/send")
def manual_send(conversation_id: str, data: WhatsAppManualSendRequest, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    conv = _get_conversation_or_404(db, conversation_id)
    msg = whatsapp_outbox_service.enqueue_manual(db, conv, data.BODY_TEXT)
    return {"message": "Message queued", **_serialize_message(msg)}


@router.post("/messages/{message_id}/retry")
def retry_message(message_id: str, db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    msg = db.query(WhatsAppMessage).filter(WhatsAppMessage.ID == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg.DIRECTION != "OUT" or msg.STATUS not in ("FAILED", "BLOCKED"):
        raise HTTPException(status_code=400, detail="Only FAILED/BLOCKED outbound messages can be retried")

    msg.STATUS = "PENDING"
    msg.NEXT_ATTEMPT_AT = None
    msg.ATTEMPT_COUNT = 0
    msg.ERROR_CODE = None
    msg.ERROR_MESSAGE = None
    db.commit()
    return {"message": "Message requeued", **_serialize_message(msg)}


@router.get("/failed")
def list_failed(vendor_id: int = Query(1), db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    rows = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.VENDOR_ID == vendor_id,
        WhatsAppMessage.DIRECTION == "OUT",
        WhatsAppMessage.STATUS.in_(["FAILED", "BLOCKED"]),
    ).order_by(WhatsAppMessage.CREATED_AT.desc()).limit(200).all()
    return {"rows": [_serialize_message(r) for r in rows]}


@router.get("/stats")
def stats(vendor_id: int = Query(1), db: Session = Depends(get_db), _admin=Depends(get_current_admin)):
    total_conversations = db.query(WhatsAppConversation).filter(WhatsAppConversation.VENDOR_ID == vendor_id).count()
    needs_human = db.query(WhatsAppConversation).filter(
        WhatsAppConversation.VENDOR_ID == vendor_id, WhatsAppConversation.NEEDS_HUMAN.is_(True)
    ).count()
    unmatched = db.query(WhatsAppConversation).filter(
        WhatsAppConversation.VENDOR_ID == vendor_id, WhatsAppConversation.SOURCE_RECORD_ID.is_(None)
    ).count()
    pending_outbound = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.VENDOR_ID == vendor_id, WhatsAppMessage.DIRECTION == "OUT", WhatsAppMessage.STATUS == "PENDING"
    ).count()
    failed_outbound = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.VENDOR_ID == vendor_id, WhatsAppMessage.DIRECTION == "OUT",
        WhatsAppMessage.STATUS.in_(["FAILED", "BLOCKED"]),
    ).count()
    return {
        "total_conversations": total_conversations,
        "needs_human": needs_human,
        "unmatched": unmatched,
        "pending_outbound": pending_outbound,
        "failed_outbound": failed_outbound,
    }
