"""
eSSL bridge ingest endpoint — accepts attendance events POSTed by an
external bridge process (e.g. `scripts/bvc-sync.py` running on a Windows
PC that can reach the biometric device on WiFi).

Why this exists
---------------
The office network has an asymmetric isolation: the Ubuntu server
(where the ERP backend runs) sits on a segment that cannot reach the
biometric device's WiFi IP, but a Windows workstation on a different
Ethernet port CAN reach both the device AND the server. That Windows
PC therefore acts as a "bridge":

    device (WiFi) → Windows PC (pyzk) → HTTPS POST → this endpoint → MySQL

The endpoint reuses the same idempotent apply-event logic used by
`app.services.essl_bridge.sync_once`, so an event that arrives twice
becomes a single Attendance row.

Auth
----
The endpoint is protected by a shared secret in the `X-API-Key` header,
sourced from the `ESSL_BRIDGE_API_KEY` env var. If that env var is unset
the endpoint returns 503 — so a mis-deployment never accepts unauth'd
writes silently.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import BiometricEvent
from app.services.essl_bridge import (
    DeviceConfig,
    _apply_event,
    _last_watermark,
    _resolve_employee,
)


router = APIRouter(prefix="/api/essl-bridge", tags=["eSSL bridge"])


# ----------------------------------------------------------------
# Request / response schemas
# ----------------------------------------------------------------

class IngestEvent(BaseModel):
    """One attendance punch as emitted by pyzk on the bridge side."""

    user_id: str = Field(..., description="Device fingerprint / user id")
    timestamp: datetime = Field(..., description="Local time of the punch")
    punch: int = Field(0, description="pyzk punch code (0=check-in, 1=check-out, etc.)")
    status: int = Field(1, description="pyzk verify status (1=fingerprint, etc.)")


class IngestBatch(BaseModel):
    """Batch of events pushed by the Windows-side bridge."""

    device_id: Optional[str] = Field(None, description="Overrides ESSL_DEVICE_ID env")
    vendor_id: Optional[int] = Field(None, description="Overrides ESSL_VENDOR_ID env")
    events: List[IngestEvent] = Field(default_factory=list)


class IngestResult(BaseModel):
    """Summary returned to the bridge so it can log / advance its cursor."""

    applied: int
    skipped_unmapped: int
    skipped_duplicate: int
    watermark: Optional[datetime] = None
    error: Optional[str] = None


class WatermarkResult(BaseModel):
    """High-water mark the bridge can filter its device dump against."""

    watermark: datetime
    device_id: str


# ----------------------------------------------------------------
# API key gate
# ----------------------------------------------------------------

def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """Fails the request unless the caller presents the configured key.

    503 (not 401) when the server itself hasn't been configured with a
    key — that surfaces a deploy problem instead of silently opening up.
    """
    expected = os.getenv("ESSL_BRIDGE_API_KEY", "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ESSL_BRIDGE_API_KEY is not set on the server",
        )
    if not x_api_key or x_api_key != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key",
        )


# ----------------------------------------------------------------
# GET /watermark — bridge fetches this before pulling the device
# ----------------------------------------------------------------

@router.get("/watermark", response_model=WatermarkResult)
def get_watermark(
    db: Session = Depends(get_db),
    _auth: None = Depends(require_api_key),
):
    """Return the timestamp of the newest event this server has already
    processed for the configured device.

    The Windows-side bridge should discard any pyzk event whose timestamp
    is <= this value before POSTing. That keeps every HTTP round-trip
    small even after months of running.
    """
    cfg = DeviceConfig.from_env()
    return WatermarkResult(
        watermark=_last_watermark(db, cfg),
        device_id=cfg.device_id,
    )


# ----------------------------------------------------------------
# POST /ingest — accept a batch of events
# ----------------------------------------------------------------

@router.post("/ingest", response_model=IngestResult)
def ingest_events(
    payload: IngestBatch,
    db: Session = Depends(get_db),
    _auth: None = Depends(require_api_key),
):
    """Apply a batch of attendance events from the bridge.

    Idempotent — an event whose timestamp <= existing watermark is skipped.
    Events for unknown user_ids are still recorded in `biometric_event`
    with RESULT='UNKNOWN_USER' so HR can retroactively enroll and
    re-import.
    """

    # Merge env config with per-call overrides from the bridge.
    env_cfg = DeviceConfig.from_env()
    cfg = DeviceConfig(
        ip=env_cfg.ip,
        port=env_cfg.port,
        comm_key=env_cfg.comm_key,
        device_id=(payload.device_id or env_cfg.device_id),
        vendor_id=(payload.vendor_id or env_cfg.vendor_id),
    )

    applied = 0
    skipped_unmapped = 0
    skipped_duplicate = 0
    row_cache: dict = {}

    # Sort events chronologically — /apply_event relies on this so that
    # (check-in, check-out, OT-in, OT-out) fill the correct slots.
    events = sorted(payload.events, key=lambda e: e.timestamp)

    watermark = _last_watermark(db, cfg)
    max_ts = watermark

    for ev in events:
        if ev.timestamp <= watermark:
            skipped_duplicate += 1
            continue

        emp = _resolve_employee(db, ev.user_id)
        if not emp:
            skipped_unmapped += 1
            db.add(BiometricEvent(
                DEVICE_ID=cfg.device_id,
                FINGERPRINT_ID=str(ev.user_id),
                EMPLOYEE_ID=None,
                EVENT_TIME=ev.timestamp,
                VERIFY_MODE="FP",
                RESULT="UNKNOWN_USER",
                RAW_PAYLOAD=f"punch={ev.punch} status={ev.status}",
                VENDOR_ID=cfg.vendor_id,
            ))
            continue

        _apply_event(db, emp, ev.timestamp, cfg, row_cache)
        db.add(BiometricEvent(
            DEVICE_ID=cfg.device_id,
            FINGERPRINT_ID=str(ev.user_id),
            EMPLOYEE_ID=emp.ID,
            EVENT_TIME=ev.timestamp,
            VERIFY_MODE="FP",
            RESULT="SUCCESS",
            RAW_PAYLOAD=f"punch={ev.punch} status={ev.status}",
            VENDOR_ID=cfg.vendor_id,
        ))
        applied += 1
        if ev.timestamp > max_ts:
            max_ts = ev.timestamp

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        return IngestResult(
            applied=0,
            skipped_unmapped=skipped_unmapped,
            skipped_duplicate=skipped_duplicate,
            watermark=watermark,
            error=f"{type(e).__name__}: {e}",
        )

    return IngestResult(
        applied=applied,
        skipped_unmapped=skipped_unmapped,
        skipped_duplicate=skipped_duplicate,
        watermark=max_ts,
        error=None,
    )
