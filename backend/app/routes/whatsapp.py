"""
WhatsApp config diagnostics + send-test endpoint.

Lets you verify CallMeBot / WhatsApp Cloud API setup without going
through a customer enquiry first. Use:

  GET  /whatsapp/diagnose     → check what's configured
  POST /whatsapp/test         → send a test message right now
"""

import os

from fastapi import APIRouter

from app.services.whatsapp_service import (
    send_whatsapp,
    is_callmebot_configured,
    is_cloud_api_configured,
    is_any_provider_configured
)


router = APIRouter()


@router.get("/whatsapp/diagnose")
def whatsapp_diagnose():
    """Returns the current WhatsApp configuration state. Helpful
    when alerts aren't arriving and you don't know which env var
    is missing."""

    md_phone = (os.getenv("MD_WHATSAPP_NUMBER") or "").strip()

    cmb_key = (os.getenv("CALLMEBOT_API_KEY") or "").strip()

    wa_token = (os.getenv("WHATSAPP_TOKEN") or "").strip()

    wa_phone_id = (os.getenv("WHATSAPP_PHONE_NUMBER_ID") or "").strip()

    return {
        "any_provider_ready": is_any_provider_configured(),
        "MD_WHATSAPP_NUMBER_set": bool(md_phone),
        "MD_WHATSAPP_NUMBER_value": md_phone[:5] + "***" if md_phone else None,
        "callmebot": {
            "configured": is_callmebot_configured(),
            "CALLMEBOT_API_KEY_set": bool(cmb_key),
            "CALLMEBOT_API_KEY_length": len(cmb_key) if cmb_key else 0
        },
        "whatsapp_cloud_api": {
            "configured": is_cloud_api_configured(),
            "WHATSAPP_TOKEN_set": bool(wa_token),
            "WHATSAPP_PHONE_NUMBER_ID_set": bool(wa_phone_id)
        },
        "next_step": (
            "Configured — try POST /whatsapp/test to send a real message"
            if is_any_provider_configured()
            else (
                "No WhatsApp provider configured. Set MD_WHATSAPP_NUMBER "
                "plus either CALLMEBOT_API_KEY (free, recommended) or "
                "WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID in backend/.env."
            )
        )
    }


@router.post("/whatsapp/test")
def whatsapp_test():
    """Sends a real test message to the MD's number. Use this once
    after setting env vars to confirm everything works end-to-end."""

    ok, msg = send_whatsapp(
        "🧪 *BVC24 WhatsApp test*\n\n"
        "If you're seeing this, your MD notification pipeline is "
        "working correctly. Real alerts will arrive when new enquiries, "
        "customers, or sales orders are created."
    )

    return {
        "sent": ok,
        "detail": msg
    }
