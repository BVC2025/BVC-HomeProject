"""
eSSL ADMS Cloud Push endpoint — device-initiated attendance sync.

WHY this exists
---------------
The office biometric (eSSL X2008) sits on the BVC WiFi network. The
FastAPI backend runs on a wired server on a different segment. The
router isolates the two segments — the SERVER cannot ping the device
(`Destination Host Unreachable`), so the older pyzk pull-mode bridge
(`app.services.essl_bridge`) never gets a socket to :4370.

The device itself CAN reach the server (client-isolation typically
blocks WiFi client → WiFi client, not WiFi client → wired server on
the same router LAN). So we invert the flow: configure the device's
"Cloud Server Setting" (ADMS) to push attendance to us over HTTP, and
this router receives it.

Protocol notes (eSSL / ZKTeco Push SDK)
---------------------------------------
The device speaks HTTP with a small handful of URLs. The two we care
about:

  GET  /iclock/cdata?SN=<serial>&options=all&pushver=2.4.1
       — initial handshake. We return a plaintext config that tells
         the device to push in realtime and how often to poll.

  POST /iclock/cdata?SN=<serial>&table=ATTLOG&Stamp=<n>
       — attendance push. Body is newline-delimited, tab-separated:
             user_id \t YYYY-MM-DD HH:MM:SS \t status \t verify \t ...
         We parse each line and write an Attendance / BiometricEvent
         row, reusing the same helpers the pull-bridge uses.

  GET  /iclock/getrequest?SN=<serial>
       — command poll. We have no outbound commands, so return "OK".

  POST /iclock/devicecmd?SN=<serial>
       — command reply. Accept + return "OK".

Everything must be served from the ROOT path (no `/api` prefix) —
that path is hardcoded in the device firmware.

Idempotency
-----------
Duplicate punches are absorbed at two levels:
  1. `_apply_event` in essl_bridge — if the row already has all four
     time slots filled, further events are ignored.
  2. BiometricEvent has DEVICE_ID + FINGERPRINT_ID + EVENT_TIME. We
     look up matching rows before writing to avoid stacked duplicates
     when the device retries a batch.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import BiometricEvent
from app.services.essl_bridge import (
    DeviceConfig,
    _apply_event,
    _resolve_employee,
)


log = logging.getLogger("uvicorn")

router = APIRouter(tags=["ADMS"])


# =========================================================
# HANDSHAKE — device asks for its config
# =========================================================
# Response format is text/plain, one key=value per line. The device
# parses this to decide push cadence + which tables to send.

def _handshake_body(sn: str) -> str:
    return "\n".join([
        f"GET OPTION FROM: {sn}",
        "Stamp=9999",
        "OpStamp=9999",
        "ATTLOGStamp=None",       # push ALL history on first sync
        "OPERLOGStamp=9999",
        "ATTPHOTOStamp=None",
        "ErrorDelay=30",
        "Delay=10",
        "TransTimes=00:00;14:05",
        "TransInterval=1",
        "TransFlag=1000000000",
        "TimeZone=8",
        "Realtime=1",
        "Encrypt=None",
    ]) + "\n"


@router.get("/iclock/cdata", response_class=PlainTextResponse)
def iclock_handshake(SN: str = "unknown"):
    log.info("adms-push: handshake SN=%s", SN)
    return _handshake_body(SN)


# =========================================================
# ATTENDANCE PUSH — device sends punches here
# =========================================================
# Body sample (records separated by newline, fields by TAB):
#
#     1	2026-07-17 10:23:45	0	1		0	0
#     2	2026-07-17 10:24:12	0	1		0	0
#
# Columns (tab-separated):
#   [0] user_id   — device enrollment ID (maps to Employee.FINGERPRINT_ID)
#   [1] datetime  — YYYY-MM-DD HH:MM:SS
#   [2] status    — punch state (0=check-in, 1=check-out, etc. — we ignore
#                                 and let _apply_event decide by slot)
#   [3] verify    — verification mode (1=FP, 4=Card, 15=Face…)
#   [4] workcode  — usually empty
#   [5..]         — reserved
#
# We accept records for `table=ATTLOG`. `table=OPERLOG` is user/finger
# data — we ACK it but don't process (employees are managed via the
# ERP UI, not synced from the device).

def _parse_attlog(body: str) -> list[tuple[str, datetime, str]]:
    """Return list of (user_id, event_dt, verify_mode) tuples."""

    out: list[tuple[str, datetime, str]] = []

    for raw_line in body.splitlines():

        line = raw_line.strip()
        if not line:
            continue

        parts = line.split("\t")
        if len(parts) < 2:
            continue

        user_id = parts[0].strip()
        ts_str = parts[1].strip()

        if not user_id or not ts_str:
            continue

        try:
            event_dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            # Some firmwares send with a T separator or trailing tz
            try:
                event_dt = datetime.fromisoformat(ts_str.replace("T", " ")[:19])
            except ValueError:
                log.warning("adms-push: bad timestamp %r, skipping", ts_str)
                continue

        verify = parts[3].strip() if len(parts) > 3 else ""

        out.append((user_id, event_dt, verify))

    return out


def _already_recorded(
    db: Session,
    device_id: str,
    user_id: str,
    event_dt: datetime,
) -> bool:
    """Duplicate guard — device retries can resend a batch."""

    return db.query(BiometricEvent).filter(
        BiometricEvent.DEVICE_ID == device_id,
        BiometricEvent.FINGERPRINT_ID == user_id,
        BiometricEvent.EVENT_TIME == event_dt,
    ).first() is not None


@router.post("/iclock/cdata", response_class=PlainTextResponse)
async def iclock_push(
    request: Request,
    SN: str = "unknown",
    table: str = "ATTLOG",
    Stamp: Optional[str] = None,
    db: Session = Depends(get_db),
):
    body_bytes = await request.body()
    body = body_bytes.decode("utf-8", errors="replace")

    log.info(
        "adms-push: SN=%s table=%s stamp=%s bytes=%d",
        SN, table, Stamp, len(body_bytes),
    )

    cfg = DeviceConfig.from_env()
    # Prefer the SN the device sends over the .env device_id — that way
    # a plant with multiple devices is distinguishable in audit logs.
    device_id = SN if SN and SN != "unknown" else cfg.device_id

    # OPERLOG (user/finger data) — we don't sync employees FROM the device,
    # but we must acknowledge the push or the device will retry forever.
    if table.upper() != "ATTLOG":
        log.debug("adms-push: table=%s ignored, body=%r", table, body[:200])
        return "OK"

    records = _parse_attlog(body)

    applied = 0
    duplicates = 0
    unmapped = 0
    row_cache: dict = {}

    for user_id, event_dt, verify in records:

        if _already_recorded(db, device_id, user_id, event_dt):
            duplicates += 1
            continue

        emp = _resolve_employee(db, user_id)

        if not emp:
            unmapped += 1
            db.add(BiometricEvent(
                DEVICE_ID=device_id,
                FINGERPRINT_ID=user_id,
                EMPLOYEE_ID=None,
                EVENT_TIME=event_dt,
                VERIFY_MODE=verify or "FP",
                RESULT="UNKNOWN_USER",
                RAW_PAYLOAD=f"adms push verify={verify}",
                VENDOR_ID=cfg.vendor_id,
            ))
            continue

        outcome = _apply_event(db, emp, event_dt, cfg, row_cache)

        db.add(BiometricEvent(
            DEVICE_ID=device_id,
            FINGERPRINT_ID=user_id,
            EMPLOYEE_ID=emp.ID,
            EVENT_TIME=event_dt,
            VERIFY_MODE=verify or "FP",
            RESULT="SUCCESS",
            RAW_PAYLOAD=f"adms push verify={verify} -> {outcome}",
            VENDOR_ID=cfg.vendor_id,
        ))

        applied += 1
        log.info(
            "adms-push: %s (%s) @ %s → %s",
            emp.EMPLOYEE_CODE, user_id, event_dt, outcome,
        )

    if applied or duplicates or unmapped:
        db.commit()
        log.info(
            "adms-push: SN=%s applied=%d dup=%d unmapped=%d",
            device_id, applied, duplicates, unmapped,
        )

    # eSSL protocol — plain "OK: <count>" acknowledges the batch.
    return f"OK: {len(records)}"


# =========================================================
# COMMAND POLL — device asks "any commands for me?"
# =========================================================
# We don't send remote commands (unlock door, sync users, reboot…).
# Returning "OK" tells the device there's nothing to do.

@router.get("/iclock/getrequest", response_class=PlainTextResponse)
def iclock_getrequest(SN: str = "unknown"):
    log.debug("adms-push: getrequest SN=%s", SN)
    return "OK"


# =========================================================
# COMMAND REPLY — device tells us the result of a command
# =========================================================

@router.post("/iclock/devicecmd", response_class=PlainTextResponse)
async def iclock_devicecmd(request: Request, SN: str = "unknown"):
    body = (await request.body()).decode("utf-8", errors="replace")
    log.debug("adms-push: devicecmd SN=%s body=%r", SN, body[:400])
    return "OK"
