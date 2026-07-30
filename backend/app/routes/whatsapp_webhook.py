"""Public (no-auth) Meta WhatsApp Cloud API webhook — the entire
unauthenticated surface of this feature lives in this one file for easy
audit. Kept separate from routes/whatsapp_config.py (which requires
get_current_admin on every route)."""
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.services import whatsapp_config_service, whatsapp_inbound_service

router = APIRouter(prefix="/whatsapp-webhook", tags=["WhatsApp Webhook"])


@router.get("")
async def verify_webhook(request: Request, db: Session = Depends(get_db)):
    """Meta's one-time subscription handshake. Must return the bare
    hub.challenge string (not JSON) on success."""
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge", "")

    if mode != "subscribe" or not token:
        return PlainTextResponse("Forbidden", status_code=403)

    cfg = whatsapp_config_service.find_by_verify_token(db, token)
    if not cfg:
        return PlainTextResponse("Forbidden", status_code=403)

    return PlainTextResponse(challenge, status_code=200)


@router.post("")
async def receive_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    status_code, body = whatsapp_inbound_service.ingest_webhook(db, raw_body, dict(request.headers))
    return JSONResponse(body, status_code=status_code)
