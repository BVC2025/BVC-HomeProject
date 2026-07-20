"""
Lead polling service — pulls leads from external lead-source APIs on behalf of
a LeadPollingConfig row and stores them as generic Lead records.

Today the only implemented source is IndiaMART's Pull API (LMS/CRM
Integration V2): https://help.indiamart.com/knowledge-base/lms-crm-integration-v2/
The date-format quirks and rate-limit handling below are genuine facts about
that specific API, not naming choices — this module itself is written
generically so a future source (e.g. a company-website intake) can reuse the
same Lead table and LeadPollingLog monitoring without a rework.

All functions are plain (no classes, matching every other service module) and
return (ok, message) / (ok, message, detail) tuples — they never raise to the
caller, so a bad upstream response never crashes the scheduler tick or an API
route.

No same-call retry: IndiaMART enforces a hard 5-minute minimum between calls
and a 15-minute lockout after 5 hits/minute, so hammering retries risks
tripping that lockout. A single attempt is made per call; failures are
logged and surfaced via the config's LAST_SYNC_STATUS/LAST_SYNC_MESSAGE and a
LeadPollingLog row.
"""

import json
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

import requests
from sqlalchemy.orm import Session

from app.models.lead_models import LeadPollingConfig, Lead, LeadPollingLog
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

_HTTP_TIMEOUT = 30  # generous — a single response can carry many leads, IndiaMART paginates nothing

_DATE_FMT = "%d-%b-%Y"              # 01-Jan-2022
_DATETIME_FMT = "%d-%b-%Y%H:%M:%S"  # 01-Jan-202209:00:00 — no separator, per IndiaMART's docs

_ENQUIRY_TIME_FORMATS = ("%d-%b-%Y %H:%M:%S", "%d-%b-%Y%H:%M:%S", "%Y-%m-%d %H:%M:%S")


def build_pull_params(api_key: str, api_type: str,
                       start: Optional[datetime] = None,
                       end: Optional[datetime] = None) -> dict:
    """Build the query-param dict for the given API_TYPE. LAST_24_HOURS sends
    only the key; DATE_RANGE/DATETIME_RANGE add start_time/end_time formatted
    per the variant."""
    params = {"glusr_crm_key": api_key}
    if api_type == "DATE_RANGE" and start and end:
        params["start_time"] = start.strftime(_DATE_FMT)
        params["end_time"] = end.strftime(_DATE_FMT)
    elif api_type == "DATETIME_RANGE" and start and end:
        params["start_time"] = start.strftime(_DATETIME_FMT)
        params["end_time"] = end.strftime(_DATETIME_FMT)
    return params


def fetch_leads_raw(base_url: str, endpoint_url: str, api_key: str, api_type: str,
                     start: Optional[datetime] = None,
                     end: Optional[datetime] = None):
    """Single HTTP GET to the source's Pull API. Returns
    (ok, message, leads_list|None, meta) where meta is always a dict:
    {"duration_ms": int, "error_kind": "AUTH_FAILED"|"RATE_LIMITED"|"ERROR"|None,
     "response_summary": str} — feeds LeadPollingLog directly."""
    url = base_url.rstrip("/") + "/" + endpoint_url.lstrip("/")
    params = build_pull_params(api_key, api_type, start, end)

    t0 = time.monotonic()

    def _meta(error_kind, summary):
        return {
            "duration_ms": int((time.monotonic() - t0) * 1000),
            "error_kind": error_kind,
            "response_summary": summary[:2000] if summary else summary,
        }

    try:
        resp = requests.get(url, params=params, timeout=_HTTP_TIMEOUT)
    except requests.exceptions.Timeout:
        msg = f"Request timed out after {_HTTP_TIMEOUT}s"
        return False, msg, None, _meta("ERROR", msg)
    except requests.exceptions.RequestException as exc:
        msg = f"Request failed: {exc}"
        return False, msg, None, _meta("ERROR", msg)

    if resp.status_code == 204:
        return True, "No leads in the given range", [], _meta(None, "HTTP 204 no content")
    if resp.status_code == 401:
        msg = "Invalid or expired API key (401)"
        return False, msg, None, _meta("AUTH_FAILED", resp.text)
    if resp.status_code == 400:
        msg = "Invalid date parameters sent to the source API (400)"
        return False, msg, None, _meta("ERROR", resp.text)
    if resp.status_code == 429:
        msg = "Rate limit exceeded (429) — back off"
        return False, msg, None, _meta("RATE_LIMITED", resp.text)
    if resp.status_code == 500:
        msg = "Source API server error (500)"
        return False, msg, None, _meta("ERROR", resp.text)
    if resp.status_code != 200:
        msg = f"Unexpected response: HTTP {resp.status_code}"
        return False, msg, None, _meta("ERROR", resp.text)

    try:
        body = resp.json()
    except ValueError:
        msg = "Source API returned a non-JSON response"
        return False, msg, None, _meta("ERROR", resp.text)

    if not isinstance(body, dict):
        msg = "Source API returned an unexpected response shape"
        return False, msg, None, _meta("ERROR", str(body))

    # IndiaMART sometimes returns HTTP 200 with an error CODE embedded in the body.
    code = body.get("CODE")
    if code is not None and str(code) not in ("200", "204"):
        msg = str(body.get("MESSAGE") or f"Source API error CODE {code}")
        return False, msg, None, _meta("ERROR", json.dumps(body)[:2000])

    leads = body.get("RESPONSE")
    if not isinstance(leads, list):
        leads = []
    message = str(body.get("MESSAGE") or "OK")
    return True, message, leads, _meta(None, f"MESSAGE={message} COUNT={len(leads)}")


def _parse_enquiry_time(raw_value) -> Optional[datetime]:
    if not raw_value:
        return None
    raw_value = str(raw_value).strip()
    for fmt in _ENQUIRY_TIME_FORMATS:
        try:
            return datetime.strptime(raw_value, fmt)
        except ValueError:
            continue
    return None


def map_lead(vendor_id, raw: dict) -> dict:
    """Pure mapper: raw source-API lead dict -> Lead kwargs (minus LEAD_SOURCE/
    CREATED_BY_ID/ASSIGNED_TO_ID, which are the caller's responsibility). Never
    fails on a bad timestamp — the full raw payload is preserved regardless."""
    return {
        "VENDOR_ID": vendor_id,
        "EXTERNAL_REFERENCE_ID": str(raw.get("UNIQUE_QUERY_ID") or "").strip() or None,
        "ENQUIRY_TYPE": raw.get("QUERY_TYPE"),
        "ENQUIRY_TIME": _parse_enquiry_time(raw.get("QUERY_TIME")),
        "CONTACT_NAME": raw.get("SENDER_NAME"),
        "CONTACT_MOBILE": raw.get("SENDER_MOBILE"),
        "CONTACT_EMAIL": raw.get("SENDER_EMAIL"),
        "COMPANY_NAME": raw.get("SENDER_COMPANY"),
        "ADDRESS": raw.get("SENDER_ADDRESS"),
        "CITY": raw.get("SENDER_CITY"),
        "STATE": raw.get("SENDER_STATE"),
        "PINCODE": raw.get("SENDER_PINCODE"),
        "COUNTRY_ISO": raw.get("SENDER_COUNTRY_ISO"),
        "LEAD_MESSAGE": raw.get("QUERY_MESSAGE"),
        "PRODUCT_INTEREST": raw.get("QUERY_PRODUCT_NAME"),
        "RAW_SOURCE_PAYLOAD": json.dumps(raw, default=str),
        "SOURCE_FETCHED_AT": now_ist(),
    }


def _derive_window(config: LeadPollingConfig):
    """For DATE_RANGE/DATETIME_RANGE configs polled automatically, use a
    rolling window from the last successful sync (or the last 24h on first
    run) up to now. LAST_24_HOURS ignores this entirely — IndiaMART handles
    the "since last call" logic itself when no dates are sent."""
    if config.API_TYPE == "LAST_24_HOURS":
        return None, None
    now = now_ist()
    start = config.LAST_SYNCED_AT or (now - timedelta(hours=24))
    return start, now


def sync_config(db: Session, config: LeadPollingConfig, store: bool = True):
    """Orchestration entry point used by both the scheduler tick and the
    manual 'sync now' route. Always writes exactly one LeadPollingLog row per
    attempt (success or failure). Returns (ok, message, {"fetched","inserted","skipped"})."""
    poll_time = now_ist()
    start, end = _derive_window(config)
    ok, message, leads, meta = fetch_leads_raw(
        config.BASE_URL, config.ENDPOINT_URL, config.PULL_API_KEY, config.API_TYPE, start, end
    )

    fetched = inserted = skipped = 0
    status = None

    if not ok:
        status = meta.get("error_kind") or "ERROR"
        config.LAST_SYNC_STATUS = status
        config.LAST_SYNC_MESSAGE = message[:500]
        config.CONSECUTIVE_FAILURES = (config.CONSECUTIVE_FAILURES or 0) + 1
        log.warning("Lead poll failed for config %s: %s", config.ID, message)
    else:
        fetched = len(leads)
        if store:
            for raw in leads:
                ref = str(raw.get("UNIQUE_QUERY_ID") or "").strip()
                if not ref:
                    skipped += 1
                    continue
                exists = db.query(Lead).filter(
                    Lead.VENDOR_ID == config.VENDOR_ID,
                    Lead.EXTERNAL_REFERENCE_ID == ref,
                ).first()
                if exists:
                    skipped += 1
                    continue
                kwargs = map_lead(config.VENDOR_ID, raw)
                db.add(Lead(**kwargs, LEAD_SOURCE="INDIAMART"))
                inserted += 1

        status = "SUCCESS" if fetched > 0 else "NO_LEADS"
        config.LAST_SYNCED_AT = now_ist()
        config.LAST_SYNC_STATUS = status
        config.LAST_SYNC_MESSAGE = message[:500]
        config.LAST_LEAD_COUNT = inserted
        config.CONSECUTIVE_FAILURES = 0
        log.info(
            "Lead poll for config %s: fetched=%s inserted=%s skipped=%s",
            config.ID, fetched, inserted, skipped,
        )

    db.add(LeadPollingLog(
        VENDOR_ID=config.VENDOR_ID,
        CONFIG_ID=config.ID,
        POLL_TIME=poll_time,
        API_TYPE=config.API_TYPE,
        STATUS=status,
        ERROR_MESSAGE=(message[:500] if not ok else None),
        ERROR_DETAILS=(meta.get("response_summary") if not ok else None),
        RESPONSE_DETAILS=(
            f"fetched={fetched} inserted={inserted} skipped={skipped}; {meta.get('response_summary')}"
            if ok else None
        ),
        DURATION_MS=meta.get("duration_ms"),
        LEAD_COUNT=fetched,
    ))
    db.commit()

    return ok, message, {"fetched": fetched, "inserted": inserted, "skipped": skipped}


def preview_leads(base_url: str, endpoint_url: str, api_key: str, api_type: str,
                   start: Optional[datetime] = None, end: Optional[datetime] = None):
    """Live Lead Viewer's function: fetch + map, no DB session touched, no
    insert, no dedup — used only for testing/viewing (requirement: must not
    persist anything)."""
    ok, message, leads, _meta = fetch_leads_raw(base_url, endpoint_url, api_key, api_type, start, end)
    if not ok:
        return False, message, []

    result = []
    for raw in leads:
        mapped = map_lead(None, raw)
        mapped.pop("VENDOR_ID", None)
        mapped.pop("RAW_SOURCE_PAYLOAD", None)
        mapped.pop("SOURCE_FETCHED_AT", None)
        if mapped.get("ENQUIRY_TIME"):
            mapped["ENQUIRY_TIME"] = mapped["ENQUIRY_TIME"].isoformat()
        result.append(mapped)
    return True, message, result
