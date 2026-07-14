"""
bvc_sync.py — Windows-side eSSL bridge.

Runs on a Windows workstation that is physically able to reach BOTH:
    • The biometric device on WiFi (192.168.1.5:4370)     — via pyzk
    • The ERP backend on the Ubuntu server (192.168.1.10) — via HTTPS

Every cycle:
    1. GET  /api/essl-bridge/watermark   → last processed event timestamp
    2. Connect to the biometric device via pyzk
    3. Fetch all attendance events
    4. Filter to events > watermark
    5. POST /api/essl-bridge/ingest     → server persists to MySQL

The Ubuntu server sits in a network segment that cannot reach the
device's WiFi IP, so this bridge exists to work around that
asymmetric isolation. Task Scheduler runs this every 5 minutes.

Configuration
-------------
Two files, in the same directory as this script:

  bvc-sync.env         — key=value overrides for defaults below
  bvc-sync.log         — rotating log file (created automatically)

Environment / config keys:

  BACKEND_URL          Base URL of the ERP backend
                       default: http://192.168.1.10:8001
  API_KEY              Shared secret matching ESSL_BRIDGE_API_KEY on server
                       (REQUIRED — script exits with error if missing)
  DEVICE_IP            eSSL device IP on WiFi
                       default: 192.168.1.5
  DEVICE_PORT          eSSL TCP port
                       default: 4370
  DEVICE_COMM_KEY      Device password / comm key (integer)
                       default: 0
  DEVICE_ID            Cosmetic tag saved on each event
                       default: X2008-01
  VENDOR_ID            Multi-tenant vendor id
                       default: 1
  DRY_RUN              1 = print events, don't POST; 0 = run for real
                       default: 0

Exit codes
----------
  0 = success (events applied or none to apply)
  1 = configuration problem (missing API_KEY, bad env)
  2 = device unreachable
  3 = server unreachable
  4 = server returned an error
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

import requests


HERE = Path(__file__).resolve().parent
LOG_FILE = HERE / "bvc-sync.log"
ENV_FILE = HERE / "bvc-sync.env"


# ---------------------------------------------------------------
# Config loading — read .env style file, then let real env override
# ---------------------------------------------------------------

def _load_env_file() -> None:
    """Populate os.environ from bvc-sync.env if that file exists.

    Lines starting with # and blank lines are ignored. `KEY=value` is
    the only supported form. Values are not quoted (we do not run
    inside a shell). Environment variables already set take precedence
    so a Scheduled Task with explicit env can override the file.
    """
    if not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if key and key not in os.environ:
            os.environ[key] = val


_load_env_file()


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


BACKEND_URL     = env("BACKEND_URL",     "http://192.168.1.10:8001").rstrip("/")
API_KEY         = env("API_KEY",         "")
DEVICE_IP       = env("DEVICE_IP",       "192.168.1.5")
DEVICE_PORT     = int(env("DEVICE_PORT", "4370"))
DEVICE_COMM_KEY = int(env("DEVICE_COMM_KEY", "0"))
DEVICE_ID       = env("DEVICE_ID",       "X2008-01")
VENDOR_ID       = int(env("VENDOR_ID",   "1"))
DRY_RUN         = env("DRY_RUN",         "0") == "1"


# ---------------------------------------------------------------
# Logging — rotate at 512 KB, keep 5 files
# ---------------------------------------------------------------

log = logging.getLogger("bvc-sync")
log.setLevel(logging.INFO)

_fmt = logging.Formatter(
    fmt="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

_fh = RotatingFileHandler(
    LOG_FILE, maxBytes=512 * 1024, backupCount=5, encoding="utf-8"
)
_fh.setFormatter(_fmt)
log.addHandler(_fh)

_ch = logging.StreamHandler(sys.stdout)
_ch.setFormatter(_fmt)
log.addHandler(_ch)


# ---------------------------------------------------------------
# Steps
# ---------------------------------------------------------------

def die(code: int, msg: str) -> None:
    log.error(msg)
    sys.exit(code)


def fetch_watermark() -> Optional[datetime]:
    """Ask the server: what's the newest event you already processed?

    Returns None if the server can be reached but has never seen an
    event (fresh install) — the pyzk side will then dump everything.
    """
    url = f"{BACKEND_URL}/api/essl-bridge/watermark"
    try:
        r = requests.get(
            url,
            headers={"X-API-Key": API_KEY},
            timeout=10,
        )
    except requests.exceptions.RequestException as e:
        die(3, f"cannot reach server watermark endpoint: {e}")

    if r.status_code == 401:
        die(1, "server rejected the API key — check API_KEY in bvc-sync.env")
    if r.status_code == 503:
        die(1, "server has ESSL_BRIDGE_API_KEY unset — see .env on server")
    if not r.ok:
        die(4, f"watermark call returned {r.status_code}: {r.text[:200]}")

    body = r.json()
    ts = body.get("watermark")
    if not ts:
        return None
    return datetime.fromisoformat(ts)


def fetch_events_from_device(since: Optional[datetime]) -> list:
    """Connect to the biometric device and return every attendance
    event newer than `since` (inclusive of an equal-timestamp guard).
    """
    try:
        from zk import ZK
    except ImportError:
        die(1, "pyzk not installed — run: pip install pyzk==0.9")

    log.info("connecting to device %s:%s", DEVICE_IP, DEVICE_PORT)
    zk = ZK(
        DEVICE_IP,
        port=DEVICE_PORT,
        password=DEVICE_COMM_KEY,
        timeout=15,
    )

    conn = None
    try:
        conn = zk.connect()
    except Exception as e:
        die(2, f"cannot reach biometric device {DEVICE_IP}:{DEVICE_PORT} — {e}")

    try:
        conn.disable_device()  # brief freeze while we pull
        raw = conn.get_attendance() or []
    finally:
        try:
            conn.enable_device()
            conn.disconnect()
        except Exception:
            pass

    fresh = []
    for ev in raw:
        if since and ev.timestamp <= since:
            continue
        fresh.append({
            "user_id": str(ev.user_id),
            "timestamp": ev.timestamp.isoformat(),
            "punch": int(getattr(ev, "punch", 0) or 0),
            "status": int(getattr(ev, "status", 1) or 1),
        })

    log.info(
        "device returned %d events, %d newer than watermark",
        len(raw), len(fresh),
    )
    return fresh


def post_events(events: list) -> dict:
    """POST events to the server ingest endpoint. Server dedupes by
    watermark internally, so this call is safe to retry."""
    url = f"{BACKEND_URL}/api/essl-bridge/ingest"
    payload = {
        "device_id": DEVICE_ID,
        "vendor_id": VENDOR_ID,
        "events": events,
    }

    try:
        r = requests.post(
            url,
            headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=30,
        )
    except requests.exceptions.RequestException as e:
        die(3, f"cannot reach server ingest endpoint: {e}")

    if not r.ok:
        die(4, f"ingest returned {r.status_code}: {r.text[:400]}")
    return r.json()


# ---------------------------------------------------------------
# Main
# ---------------------------------------------------------------

def main() -> None:
    if not API_KEY:
        die(1, "API_KEY missing — set it in bvc-sync.env or as env var")

    log.info("=" * 60)
    log.info("bvc-sync starting  backend=%s device=%s", BACKEND_URL, DEVICE_IP)

    watermark = fetch_watermark()
    log.info("server watermark = %s", watermark)

    events = fetch_events_from_device(watermark)
    if not events:
        log.info("nothing new to send — done")
        return

    if DRY_RUN:
        log.info("DRY_RUN=1 → not POSTing. Would send %d events.", len(events))
        for ev in events[:5]:
            log.info("  sample: %s", ev)
        return

    result = post_events(events)
    log.info(
        "ingest result: applied=%s skipped_unmapped=%s skipped_dup=%s error=%s",
        result.get("applied"),
        result.get("skipped_unmapped"),
        result.get("skipped_duplicate"),
        result.get("error"),
    )
    if result.get("error"):
        die(4, f"server-side error: {result['error']}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log.exception("unexpected failure: %s", e)
        sys.exit(4)
