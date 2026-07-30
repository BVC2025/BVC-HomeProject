"""Thin, stateless transport layer over Meta's WhatsApp Cloud (Graph) API.

Every function takes the already-decrypted access token and per-vendor
API base/graph-version explicitly — this module holds no config lookup and
no DB session, so it can be unit-tested and reused identically by the
outbound dispatcher, the config CRUD's test-connection endpoint, and the
webhook's template-listing helper.

Payload shapes mirror the existing (env-var-based, MD/approval-only)
integrations already in this codebase — services/approval_service.py's
_send_via_whatsapp and services/whatsapp_service.py's _send_via_cloud_api —
so behaviour Meta already accepts in production here is reused, not
reinvented."""
import logging
import re
from typing import Dict, List, Optional, Tuple

import requests

log = logging.getLogger(__name__)

_HTTP_TIMEOUT = 15


def _base(api_base_url: str, graph_api_version: str, phone_number_id: str, path: str = "messages") -> str:
    return f"{api_base_url.rstrip('/')}/{graph_api_version}/{phone_number_id}/{path}"


def _headers(access_token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}


def sanitize_template_param(value: str, max_len: int = 1000) -> str:
    """Meta rejects template body parameters containing newlines, tabs, or 4+
    consecutive spaces. Collapses all whitespace runs to a single space."""
    collapsed = re.sub(r"\s+", " ", value or "").strip()
    return collapsed[:max_len]


def send_text(api_base_url: str, graph_api_version: str, phone_number_id: str, access_token: str,
               to_wa_id: str, body: str) -> Tuple[bool, Optional[str], Optional[dict]]:
    """Free-form text — only deliverable inside Meta's 24h customer-service
    window. Returns (ok, wamid_or_None, error_dict_or_None)."""
    url = _base(api_base_url, graph_api_version, phone_number_id)
    payload = {
        "messaging_product": "whatsapp",
        "to": to_wa_id,
        "type": "text",
        "text": {"body": body[:4096]},
    }
    return _post(url, payload, access_token)


def send_template(api_base_url: str, graph_api_version: str, phone_number_id: str, access_token: str,
                   to_wa_id: str, template_name: str, template_lang: str,
                   body_params: Optional[List[str]] = None) -> Tuple[bool, Optional[str], Optional[dict]]:
    """Approved-template message — the only kind Meta allows outside the 24h
    window (a brand-new lead is always outside it)."""
    url = _base(api_base_url, graph_api_version, phone_number_id)
    template: Dict = {"name": template_name, "language": {"code": template_lang or "en_US"}}

    if body_params:
        template["components"] = [{
            "type": "body",
            "parameters": [{"type": "text", "text": sanitize_template_param(p)} for p in body_params],
        }]

    payload = {
        "messaging_product": "whatsapp",
        "to": to_wa_id,
        "type": "template",
        "template": template,
    }
    return _post(url, payload, access_token)


def send_document_link(api_base_url: str, graph_api_version: str, phone_number_id: str, access_token: str,
                        to_wa_id: str, link: str, filename: Optional[str] = None,
                        caption: Optional[str] = None) -> Tuple[bool, Optional[str], Optional[dict]]:
    """Sends an existing file (e.g. a quotation PDF) by public URL — Meta
    fetches the file itself, no upload step needed. Like send_text, only
    deliverable inside the 24h customer-service window (documents are not
    exempt from that rule the way approved templates are)."""
    url = _base(api_base_url, graph_api_version, phone_number_id)
    document: Dict = {"link": link}
    if filename:
        document["filename"] = filename
    if caption:
        document["caption"] = caption[:1024]

    payload = {
        "messaging_product": "whatsapp",
        "to": to_wa_id,
        "type": "document",
        "document": document,
    }
    return _post(url, payload, access_token)


def _post(url: str, payload: dict, access_token: str) -> Tuple[bool, Optional[str], Optional[dict]]:
    try:
        resp = requests.post(url, json=payload, headers=_headers(access_token), timeout=_HTTP_TIMEOUT)
    except requests.exceptions.Timeout:
        return False, None, {"code": "TIMEOUT", "message": f"Request timed out after {_HTTP_TIMEOUT}s"}
    except requests.exceptions.RequestException as exc:
        return False, None, {"code": "CONNECTION_ERROR", "message": str(exc)}

    if resp.status_code in (200, 201):
        try:
            body = resp.json()
            wamid = body.get("messages", [{}])[0].get("id")
        except (ValueError, IndexError, KeyError):
            wamid = None
        return True, wamid, None

    return False, None, classify_error(resp.status_code, resp.text)


def get_phone_number_info(api_base_url: str, graph_api_version: str, phone_number_id: str,
                           access_token: str) -> Tuple[bool, Optional[dict], Optional[dict]]:
    """Live health-probe / test-connection call — confirms the token and
    phone_number_id are valid and returns Meta's verified display name."""
    url = f"{api_base_url.rstrip('/')}/{graph_api_version}/{phone_number_id}"
    params = {"fields": "display_phone_number,verified_name,code_verification_status,quality_rating"}
    try:
        resp = requests.get(url, params=params, headers=_headers(access_token), timeout=_HTTP_TIMEOUT)
    except requests.exceptions.RequestException as exc:
        return False, None, {"code": "CONNECTION_ERROR", "message": str(exc)}

    if resp.status_code == 200:
        return True, resp.json(), None
    return False, None, classify_error(resp.status_code, resp.text)


def list_templates(api_base_url: str, graph_api_version: str, waba_id: str,
                    access_token: str, name_filter: Optional[str] = None) -> Tuple[bool, list, Optional[dict]]:
    url = f"{api_base_url.rstrip('/')}/{graph_api_version}/{waba_id}/message_templates"
    params = {"limit": 100}
    if name_filter:
        params["name"] = name_filter
    try:
        resp = requests.get(url, params=params, headers=_headers(access_token), timeout=_HTTP_TIMEOUT)
    except requests.exceptions.RequestException as exc:
        return False, [], {"code": "CONNECTION_ERROR", "message": str(exc)}

    if resp.status_code == 200:
        return True, resp.json().get("data", []), None
    return False, [], classify_error(resp.status_code, resp.text)


# ── Error taxonomy ───────────────────────────────────────────────────────────
# kind values: AUTH_FAILED | RATE_LIMITED | TRANSIENT | WINDOW_CLOSED |
# UNREACHABLE | TEMPLATE_ERROR | OPTED_OUT | PERMANENT

_AUTH_CODES = {190, 200, 10}
_RATE_CODES = {130429, 131048, 133016}
_WINDOW_CLOSED_CODES = {131047}
_UNREACHABLE_CODES = {131026}
_TEMPLATE_CODES = set(range(132000, 132999))
_OPTED_OUT_CODES = {131050}


def classify_error(http_status: int, body_text: str) -> dict:
    code = None
    message = (body_text or "")[:500]
    try:
        import json
        body = json.loads(body_text)
        err = body.get("error", {})
        code = err.get("code")
        message = err.get("message") or message
    except Exception:
        pass

    if http_status in (401, 403) or code in _AUTH_CODES:
        kind = "AUTH_FAILED"
    elif http_status == 429 or code in _RATE_CODES:
        kind = "RATE_LIMITED"
    elif code in _WINDOW_CLOSED_CODES or http_status in (470, 471):
        kind = "WINDOW_CLOSED"
    elif code in _UNREACHABLE_CODES:
        kind = "UNREACHABLE"
    elif code in _TEMPLATE_CODES:
        kind = "TEMPLATE_ERROR"
    elif code in _OPTED_OUT_CODES:
        kind = "OPTED_OUT"
    elif http_status in (500, 502, 503, 504):
        kind = "TRANSIENT"
    else:
        kind = "PERMANENT"

    return {"kind": kind, "code": str(code) if code is not None else str(http_status), "message": message}
