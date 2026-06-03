"""
WhatsApp notification service — free / zero-cost MD alerts.

Supports two backends (auto-detected from .env):

1. CallMeBot (recommended for MD-only personal-use alerts)
   - 100% free, no business account, no monthly limits
   - MD sends one WhatsApp message to +34 644 04 75 28 to enable
   - Receives an API key by reply
   - Set CALLMEBOT_API_KEY + MD_WHATSAPP_NUMBER in .env

2. WhatsApp Cloud API (Meta — for sending to customers later)
   - Free tier: 1000 conversations/month
   - Requires Facebook Business account + phone verification
   - Set WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID in .env

All failures are SILENT — they log a warning and return False so the
calling endpoint never fails just because WhatsApp is offline.
"""

import os
import logging
import urllib.parse
from typing import Tuple, Optional

import requests


log = logging.getLogger(__name__)


# =====================================================================
# Config helpers
# =====================================================================

def _get_env(key: str) -> str:

    return (os.getenv(key) or "").strip()


def _md_phone() -> Optional[str]:
    """The Managing Director's WhatsApp number for alerts. Stripped
    of any '+' and non-digits so providers accept it consistently."""

    raw = _get_env("MD_WHATSAPP_NUMBER")

    if not raw:

        return None

    # Keep only digits — drop +, spaces, dashes, brackets
    digits = "".join(c for c in raw if c.isdigit())

    return digits or None


def is_callmebot_configured() -> bool:

    return bool(_get_env("CALLMEBOT_API_KEY")) and bool(_md_phone())


def is_cloud_api_configured() -> bool:

    return (
        bool(_get_env("WHATSAPP_TOKEN"))
        and bool(_get_env("WHATSAPP_PHONE_NUMBER_ID"))
        and bool(_md_phone())
    )


def is_any_provider_configured() -> bool:

    return is_callmebot_configured() or is_cloud_api_configured()


# =====================================================================
# Providers
# =====================================================================

def _send_via_callmebot(phone: str, message: str) -> Tuple[bool, str]:
    """Free WhatsApp via CallMeBot — best for personal-use MD alerts."""

    api_key = _get_env("CALLMEBOT_API_KEY")

    if not api_key:

        return False, "CALLMEBOT_API_KEY not set"

    # CallMeBot expects phone without '+' and message URL-encoded
    url = "https://api.callmebot.com/whatsapp.php"

    params = {
        "phone": phone,
        "text": message,
        "apikey": api_key
    }

    try:

        r = requests.get(url, params=params, timeout=10)

        body = (r.text or "")[:300]

        # CallMeBot responds with HTML; success contains "Message sent"
        # or "queued". Failure contains error text or HTTP != 200.
        if r.status_code == 200 and (
            "Message queued" in body
            or "Message sent" in body
            or "successfully" in body.lower()
        ):

            return True, "Sent via CallMeBot"

        return False, f"CallMeBot HTTP {r.status_code}: {body}"

    except Exception as exc:

        return False, f"CallMeBot request failed: {exc}"


def _send_via_cloud_api(phone: str, message: str) -> Tuple[bool, str]:
    """WhatsApp Cloud API (Meta) — free tier 1000 conversations/month."""

    token = _get_env("WHATSAPP_TOKEN")

    phone_id = _get_env("WHATSAPP_PHONE_NUMBER_ID")

    if not (token and phone_id):

        return False, "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set"

    url = f"https://graph.facebook.com/v22.0/{phone_id}/messages"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    payload = {
        "messaging_product": "whatsapp",
        "to": phone,
        "type": "text",
        "text": {"body": message}
    }

    try:

        r = requests.post(url, json=payload, headers=headers, timeout=12)

        if r.status_code in (200, 201):

            return True, "Sent via WhatsApp Cloud API"

        return False, f"Cloud API HTTP {r.status_code}: {r.text[:200]}"

    except Exception as exc:

        return False, f"Cloud API request failed: {exc}"


# =====================================================================
# Public API
# =====================================================================

def send_whatsapp(message: str, phone: Optional[str] = None) -> Tuple[bool, str]:
    """Send a WhatsApp message. Returns (success, status_message).

    - If `phone` is None, uses MD_WHATSAPP_NUMBER from env.
    - Tries CallMeBot first (free, simpler).
    - Falls back to WhatsApp Cloud API if configured.
    - Silently returns (False, reason) if nothing is configured —
      the caller should always treat WhatsApp as best-effort.
    """

    target = phone or _md_phone()

    if not target:

        log.info(
            "WhatsApp skipped: no MD_WHATSAPP_NUMBER and no phone given"
        )

        return False, "No recipient phone configured"

    if not message or not message.strip():

        return False, "Empty message"

    # Try CallMeBot first (free, personal-use)
    if is_callmebot_configured():

        ok, msg = _send_via_callmebot(target, message)

        if ok:

            log.info("WhatsApp delivered to %s: %s", target, msg)

            return True, msg

        log.warning("CallMeBot failed (%s), trying next provider", msg)

    # Fall back to Cloud API
    if is_cloud_api_configured():

        ok, msg = _send_via_cloud_api(target, message)

        if ok:

            log.info("WhatsApp delivered to %s: %s", target, msg)

            return True, msg

        log.warning("Cloud API failed: %s", msg)

        return False, msg

    log.info("WhatsApp skipped: no provider configured")

    return False, "No WhatsApp provider configured in .env"


def notify_md_safe(message: str) -> Tuple[bool, str]:
    """Fire-and-forget MD notification. Catches every exception so
    a broken WhatsApp never breaks the originating endpoint."""

    try:

        return send_whatsapp(message)

    except Exception as exc:

        log.warning("notify_md_safe swallowed exception: %s", exc)

        return False, str(exc)
