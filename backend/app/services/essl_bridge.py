"""
eSSL biometric device bridge — pull mode.

Connects to the office X2008 device over TCP, fetches attendance events
newer than the last sync, and writes them into the `attendance` table
using the same logic as POST /biometric/scan.

Design goals:
  • Idempotent — running twice on the same events is a no-op
  • Read-only against the device — never clears logs after fetch, so a
    later comparison with the device UI is always possible
  • Employee mapping via Employee.FINGERPRINT_ID (already in schema)
  • Config from .env — swap the device by editing environment vars only
  • Every fetched log is also mirrored into BiometricEvent (audit)

Usage:
  A) One-shot from CLI / cron:
       .\\venv\\Scripts\\python.exe -m app.services.essl_bridge

  B) Programmatic (from a scheduler like APScheduler):
       from app.services.essl_bridge import sync_once
       sync_once()

Env vars (default in parens):
  ESSL_DEVICE_IP        (192.168.0.201)
  ESSL_DEVICE_PORT      (4370)
  ESSL_COMM_KEY         (0)
  ESSL_DEVICE_ID        (X2008-01)   — cosmetic tag saved on each event
  ESSL_VENDOR_ID        (1)          — multi-tenant vendor for new rows
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.database.database import SessionLocal
from app.models.models import (
    Attendance,
    BiometricEvent,
    Employee,
)

log = logging.getLogger("uvicorn")


# ------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------

@dataclass
class DeviceConfig:
    ip: str
    port: int
    comm_key: int
    device_id: str
    vendor_id: int

    @classmethod
    def from_env(cls) -> "DeviceConfig":
        return cls(
            ip=os.getenv("ESSL_DEVICE_IP", "192.168.0.201"),
            port=int(os.getenv("ESSL_DEVICE_PORT", "4370")),
            comm_key=int(os.getenv("ESSL_COMM_KEY", "0")),
            device_id=os.getenv("ESSL_DEVICE_ID", "X2008-01"),
            vendor_id=int(os.getenv("ESSL_VENDOR_ID", "1")),
        )


# ------------------------------------------------------------------
# Attendance settings — same rule as /check-in
# ------------------------------------------------------------------

WORK_START_HOUR   = 9      # Shift starts 9:00
WORK_START_MINUTE = 15     # LATE threshold — 15-min grace past shift start
WORK_END_HOUR     = 18     # anything past 18:00 counts toward OT

def _office_start_for(d: date) -> datetime:
    return datetime.combine(
        d, datetime.min.time()
    ).replace(hour=WORK_START_HOUR, minute=WORK_START_MINUTE)


def _compute_status_and_late(check_in_dt: datetime) -> tuple:
    """Returns (STATUS, LATE_MINUTES). Mirrors the check-in endpoint."""

    start = _office_start_for(check_in_dt.date())

    if check_in_dt <= start:
        return "PRESENT", 0

    late = int((check_in_dt - start).total_seconds() // 60)
    return "LATE", max(0, late)


# ------------------------------------------------------------------
# Employee lookup
# ------------------------------------------------------------------

def _resolve_employee(
    db: Session,
    device_user_id: str,
) -> Optional[Employee]:
    """Map the device's user_id to an Employee row.

    Devices usually return numeric IDs (1, 2, 3…). We store that in
    Employee.FINGERPRINT_ID. Comparison is done as a string to avoid
    surprises with leading zeros or type juggling.
    """
    if device_user_id is None:
        return None

    key = str(device_user_id).strip()
    if not key:
        return None

    return (
        db.query(Employee)
        .filter(Employee.FINGERPRINT_ID == key)
        .first()
    )


# ------------------------------------------------------------------
# Attendance write — same shape as /biometric/scan
# ------------------------------------------------------------------

def _apply_event(
    db: Session,
    emp: Employee,
    event_dt: datetime,
    cfg: DeviceConfig,
    row_cache: dict,
) -> str:
    """Write / update the attendance row for this event.

    Returns a short label describing what happened, for logging.
    Rules — mirror the manual check-in / check-out logic:
      • First scan of the day  → CHECK_IN (STATUS + LATE_MINUTES set)
      • Scan while checked-in  → CHECK_OUT (WORKED_HOURS computed)
      • Scan after check-out   → OT_CHECK_IN
      • Scan after OT check-in → OT_CHECK_OUT (OVERTIME_HOURS computed)
      • Further scans          → ignored (return 'duplicate')

    row_cache is a (employee_id, date) -> Attendance dict maintained by
    the caller for the duration of this sync — SQLAlchemy's autoflush
    is not reliable for `unique` collisions when we don't commit
    between events, so we cache lookups + creations ourselves.
    """

    today = event_dt.date()
    cache_key = (emp.ID, today)

    row = row_cache.get(cache_key)
    if row is None:
        row = (
            db.query(Attendance)
            .filter(
                Attendance.EMPLOYEE_ID == emp.ID,
                Attendance.DATE == today,
            )
            .first()
        )
        if row is not None:
            row_cache[cache_key] = row

    # 1. First scan of the day → CHECK_IN
    if row is None:
        status, late_min = _compute_status_and_late(event_dt)
        row = Attendance(
            EMPLOYEE_ID=emp.ID,
            DATE=today,
            CHECK_IN=event_dt,
            STATUS=status,
            LATE_MINUTES=late_min,
            VENDOR_ID=cfg.vendor_id,
            GEOFENCE_STATUS="BIOMETRIC",     # tag so admin can see origin
            DEVICE_INFO=f"eSSL {cfg.device_id}",
        )
        db.add(row)
        row_cache[cache_key] = row
        return f"check-in @ {event_dt:%H:%M} status={status} late={late_min}m"

    # 2. Already have a row — figure out which slot this event fills
    if row.CHECK_IN is None:
        # Rare — row was pre-created for the day but no check-in yet
        status, late_min = _compute_status_and_late(event_dt)
        row.CHECK_IN = event_dt
        row.STATUS = status
        row.LATE_MINUTES = late_min
        return f"check-in (backfilled) @ {event_dt:%H:%M}"

    # 3. CHECK_IN set, CHECK_OUT not yet → this is CHECK_OUT
    if row.CHECK_OUT is None:
        # Guard against too-close punches (a debounce within 60 s
        # of check-in is almost certainly a repeat scan, not a real
        # check-out).
        if (event_dt - row.CHECK_IN).total_seconds() < 60:
            return "duplicate (within 60s of check-in)"

        row.CHECK_OUT = event_dt
        delta = event_dt - row.CHECK_IN
        row.WORKED_HOURS = round(delta.total_seconds() / 3600.0, 2)
        return f"check-out @ {event_dt:%H:%M} worked={row.WORKED_HOURS}h"

    # 4. CHECK_OUT set, OT_CHECK_IN not yet → OT_CHECK_IN
    if row.OT_CHECK_IN is None:
        if (event_dt - row.CHECK_OUT).total_seconds() < 60:
            return "duplicate (within 60s of check-out)"
        row.OT_CHECK_IN = event_dt
        return f"OT check-in @ {event_dt:%H:%M}"

    # 5. OT_CHECK_IN set, OT_CHECK_OUT not yet → OT_CHECK_OUT
    if row.OT_CHECK_OUT is None:
        if (event_dt - row.OT_CHECK_IN).total_seconds() < 60:
            return "duplicate (within 60s of OT check-in)"
        row.OT_CHECK_OUT = event_dt
        ot_delta = event_dt - row.OT_CHECK_IN
        row.OVERTIME_HOURS = round(ot_delta.total_seconds() / 3600.0, 2)
        return f"OT check-out @ {event_dt:%H:%M} ot={row.OVERTIME_HOURS}h"

    # 6. All four slots filled — further events are ignored (audit only)
    return "ignored (all slots filled)"


# ------------------------------------------------------------------
# Cursor — remember the last event we've processed
# ------------------------------------------------------------------
# We use the max CREATED_AT on BiometricEvent as the watermark. Any
# event on the device newer than that is imported. This survives
# server restarts without needing a separate state file.

def _last_watermark(db: Session, cfg: DeviceConfig) -> datetime:
    """The high-water mark for what we've already imported.

    Priority:
      1. ESSL_BACKFILL_FROM env var (absolute date, YYYY-MM-DD) —
         forces the watermark to that date, ignoring existing rows.
         Use this to bulk-import from a specific start date.
      2. Most recent SUCCESS BiometricEvent from this device.
      3. Fallback: today - ESSL_BACKFILL_DAYS (default 7).

    Only SUCCESS rows count. UNKNOWN_USER rows are events whose device
    user_id had no matching employee at sync time — after HR enrolls that
    employee, we want the next sync to re-process those events, so we do
    NOT let them advance the watermark.
    """

    # 1. Absolute override — bulk import from a specific date
    backfill_from = os.getenv("ESSL_BACKFILL_FROM", "").strip()
    if backfill_from:
        try:
            return datetime.strptime(backfill_from, "%Y-%m-%d")
        except ValueError:
            log.warning(
                "essl-bridge: ESSL_BACKFILL_FROM=%r not YYYY-MM-DD, ignored",
                backfill_from,
            )

    # 2. Resume from last successful event on this device
    row = (
        db.query(BiometricEvent)
        .filter(
            BiometricEvent.DEVICE_ID == cfg.device_id,
            BiometricEvent.RESULT == "SUCCESS",
        )
        .order_by(BiometricEvent.EVENT_TIME.desc())
        .first()
    )
    if row and row.EVENT_TIME:
        return row.EVENT_TIME

    # 3. First run — days-based lookback
    days = int(os.getenv("ESSL_BACKFILL_DAYS", "7"))
    return datetime.now() - timedelta(days=days)


# ------------------------------------------------------------------
# Main sync routine
# ------------------------------------------------------------------

def sync_once(cfg: Optional[DeviceConfig] = None) -> dict:
    """One sync pass. Safe to call on a schedule.

    Returns a summary dict for logging / status endpoints:
      {
        applied: int,          # events successfully applied
        skipped_unmapped: int, # events for user_ids we don't know
        skipped_duplicate: int,# events already processed
        error: str | None
      }
    """
    cfg = cfg or DeviceConfig.from_env()

    try:
        from zk import ZK
    except ImportError:
        return {
            "applied": 0, "skipped_unmapped": 0, "skipped_duplicate": 0,
            "error": "pyzk not installed. Run: pip install pyzk==0.9",
        }

    log.debug("essl-bridge: connecting to %s:%s", cfg.ip, cfg.port)

    zk = ZK(cfg.ip, port=cfg.port, password=cfg.comm_key, timeout=15)
    conn = None
    db: Session = SessionLocal()

    applied = 0
    skipped_unmapped = 0
    skipped_duplicate = 0
    row_cache: dict = {}   # (employee_id, date) -> Attendance

    try:
        conn = zk.connect()
        conn.disable_device()               # freeze punches during sync

        watermark = _last_watermark(db, cfg)
        log.debug("essl-bridge: watermark = %s", watermark)

        events = conn.get_attendance()
        events.sort(key=lambda e: e.timestamp)

        for ev in events:
            if ev.timestamp <= watermark:
                skipped_duplicate += 1
                continue

            emp = _resolve_employee(db, ev.user_id)
            if not emp:
                skipped_unmapped += 1
                # Still write a BiometricEvent row for audit
                db.add(BiometricEvent(
                    DEVICE_ID=cfg.device_id,
                    FINGERPRINT_ID=str(ev.user_id),
                    EMPLOYEE_ID=None,
                    EVENT_TIME=ev.timestamp,
                    VERIFY_MODE="FP",
                    RESULT="UNKNOWN_USER",
                    RAW_PAYLOAD=(
                        f"punch={ev.punch} status={ev.status}"
                    ),
                    VENDOR_ID=cfg.vendor_id,
                ))
                continue

            outcome = _apply_event(db, emp, ev.timestamp, cfg, row_cache)

            db.add(BiometricEvent(
                DEVICE_ID=cfg.device_id,
                FINGERPRINT_ID=str(ev.user_id),
                EMPLOYEE_ID=emp.ID,
                EVENT_TIME=ev.timestamp,
                VERIFY_MODE="FP",
                RESULT="SUCCESS",
                RAW_PAYLOAD=(
                    f"punch={ev.punch} status={ev.status} -> {outcome}"
                ),
                VENDOR_ID=cfg.vendor_id,
            ))

            applied += 1
            log.info(
                "essl-bridge: %s (%s) → %s",
                emp.EMPLOYEE_CODE, ev.user_id, outcome,
            )

        db.commit()

        return {
            "applied": applied,
            "skipped_unmapped": skipped_unmapped,
            "skipped_duplicate": skipped_duplicate,
            "error": None,
        }

    except Exception as e:
        db.rollback()
        # Device-unreachable errors are noisy at INFO level (the autosync
        # runs every 2 min). Log those as a single WARN line so an
        # unplugged / powered-off device doesn't spam full tracebacks.
        # Anything else (auth, protocol errors) still gets the full trace.
        if e.__class__.__name__ == "ZKNetworkError":
            log.warning(
                "essl-bridge: device unreachable at %s:%s — %s "
                "(check device power / Ethernet / IP)",
                cfg.ip, cfg.port, e,
            )
        else:
            log.exception("essl-bridge: FAILED %s", e)
        return {
            "applied": applied,
            "skipped_unmapped": skipped_unmapped,
            "skipped_duplicate": skipped_duplicate,
            "error": f"{type(e).__name__}: {e}",
        }

    finally:
        if conn:
            try:
                conn.enable_device()
                conn.disconnect()
            except Exception:
                pass
        db.close()


# ------------------------------------------------------------------
# CLI entry
# ------------------------------------------------------------------

if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    result = sync_once()

    print()
    print(f"Applied         : {result['applied']}")
    print(f"Skipped (dup)   : {result['skipped_duplicate']}")
    print(f"Skipped (unmap) : {result['skipped_unmapped']}")
    if result["error"]:
        print(f"Error           : {result['error']}")
        sys.exit(1)
    sys.exit(0)
