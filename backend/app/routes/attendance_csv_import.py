"""
attendance_csv_import.py

Manual attendance backfill from a biometric-device USB export.

Usage flow (admin only):
  1. HR walks to the eSSL X2008, plugs in a USB pendrive, and does
     Menu → USB Management → Download Attendance.  The device drops
     a plain text or CSV file (see FORMAT SUPPORT below).
  2. Admin opens ERP → Attendance page → clicks "Import Biometric CSV",
     picks the file from the pendrive.
  3. Frontend POSTs the file here; backend parses each row, matches
     the device user_id to Employee.FINGERPRINT_ID, and applies the
     event via the same idempotent `_apply_event` used by the
     automatic bridge — so re-uploading the same file is a no-op.

FORMAT SUPPORT
--------------
The parser is deliberately permissive. It accepts:
  • Comma-separated  (a.csv from device menu)
  • Tab-separated    (a.dat / a.txt raw device dump)
  • Semicolon-separated
  • With or without a header row
  • Column order in any arrangement — we detect a user_id column
    (all-numeric) and a timestamp column (contains a date + time).

If a row can't be parsed cleanly it's counted as `skipped_invalid`;
the whole import doesn't fail on a single bad row.
"""

from __future__ import annotations

import csv
import io
import logging
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import BiometricEvent
from app.services.essl_bridge import (
    DeviceConfig,
    _apply_event,
    _resolve_employee,
)

log = logging.getLogger("uvicorn")

router = APIRouter(prefix="/api/attendance", tags=["Attendance Import"])


# ------------------------------------------------------------------
# Response schema
# ------------------------------------------------------------------

class ImportSummary(BaseModel):
    total_rows: int
    applied: int
    skipped_duplicate: int
    skipped_unmapped: int
    skipped_invalid: int
    error: Optional[str] = None
    sample_unmapped_ids: list[str] = []


# ------------------------------------------------------------------
# Parser helpers
# ------------------------------------------------------------------

# Common eSSL / ZKTeco timestamp formats seen in exports.
_DATE_FORMATS = [
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d %H:%M:%S",
    "%d-%m-%Y %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
    "%d-%m-%Y %H:%M",
    "%m/%d/%Y %H:%M:%S",
    "%Y%m%d%H%M%S",
]


def _sniff_delimiter(sample: str) -> str:
    """Best-effort delimiter detection between comma / tab / semicolon."""
    counts = {
        ",":  sample.count(","),
        "\t": sample.count("\t"),
        ";":  sample.count(";"),
    }
    # Whichever is most common wins; tab wins ties (device dumps).
    return max(counts, key=lambda k: (counts[k], k == "\t"))


def _parse_timestamp(raw: str) -> Optional[datetime]:
    s = (raw or "").strip()
    if not s:
        return None
    # Some devices dump ISO-8601 with a T — normalise to space.
    s = s.replace("T", " ").split(".")[0]
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _looks_like_id(cell: str) -> bool:
    """Device user_ids are numeric — but strip any surrounding quotes."""
    s = (cell or "").strip().strip('"').strip("'")
    return bool(s) and s.isdigit() and 1 <= len(s) <= 12


def _find_columns(header: list[str], first_row: list[str]) -> tuple[int, int]:
    """Return (user_id_col_index, timestamp_col_index).

    Priority: header names when present ("user_id" / "id", "date-time"
    / "timestamp"), else fall back to first_row heuristic (numeric
    cell = id, date-like cell = timestamp).
    """
    # 1. Header name lookup
    id_names = {"user_id", "userid", "id", "empid", "employee_id", "code"}
    ts_names = {"datetime", "date_time", "timestamp", "time", "date-time", "punchtime"}

    id_col = ts_col = -1
    lower = [(h or "").strip().lower() for h in header]
    for i, name in enumerate(lower):
        if id_col < 0 and any(n in name for n in id_names):
            id_col = i
        if ts_col < 0 and any(n in name for n in ts_names):
            ts_col = i

    if id_col >= 0 and ts_col >= 0:
        return id_col, ts_col

    # 2. Fallback: guess from the first data row
    if id_col < 0:
        for i, cell in enumerate(first_row):
            if _looks_like_id(cell):
                id_col = i
                break
    if ts_col < 0:
        for i, cell in enumerate(first_row):
            if _parse_timestamp(cell) is not None:
                ts_col = i
                break

    if id_col < 0 or ts_col < 0:
        raise ValueError(
            "Could not detect user_id and timestamp columns. "
            "Expected a numeric id column and a date-time column."
        )
    return id_col, ts_col


# ------------------------------------------------------------------
# Endpoint
# ------------------------------------------------------------------

@router.post("/import-csv", response_model=ImportSummary)
async def import_biometric_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Accept a biometric-device CSV/TXT export and apply it as attendance.

    Idempotent: rows whose timestamp <= existing server watermark are
    counted as `skipped_duplicate`, so re-uploading the same file is
    safe.  Rows for user_ids we don't have an Employee for are counted
    as `skipped_unmapped` and mirrored into BiometricEvent for audit;
    HR can later enrol that finger and re-import.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Read the whole file — biometric exports are tiny (KB range).
    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Decode robustly — most devices dump UTF-8 or latin-1.
    try:
        text = raw_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw_bytes.decode("latin-1")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Could not decode file. Save the device export as UTF-8 or ASCII.",
            )

    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="File has no data rows")

    delim = _sniff_delimiter(lines[0])
    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = list(reader)
    rows = [r for r in rows if any((c or "").strip() for c in r)]
    if not rows:
        raise HTTPException(status_code=400, detail="No parseable rows in file")

    # Header detection: if first row has NO numeric id and NO parseable
    # date, treat as a header line.
    first_row = rows[0]
    looks_like_header = not (
        any(_looks_like_id(c) for c in first_row) and
        any(_parse_timestamp(c) for c in first_row)
    )
    header = first_row if looks_like_header else [""] * len(first_row)
    data_rows = rows[1:] if looks_like_header else rows

    if not data_rows:
        raise HTTPException(status_code=400, detail="File has header only, no data rows")

    try:
        id_col, ts_col = _find_columns(header, data_rows[0])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cfg = DeviceConfig.from_env()

    # Sort by timestamp — same reason essl_bridge does it: apply_event
    # relies on chronological order to correctly slot check-in / out /
    # OT-in / OT-out into the day's row.
    parsed: list[tuple[str, datetime]] = []
    invalid = 0
    for r in data_rows:
        try:
            uid = (r[id_col] or "").strip().strip('"').strip("'")
            ts = _parse_timestamp(r[ts_col])
        except IndexError:
            invalid += 1
            continue
        if not uid or ts is None:
            invalid += 1
            continue
        parsed.append((uid, ts))
    parsed.sort(key=lambda x: x[1])

    applied = 0
    skipped_duplicate = 0
    skipped_unmapped = 0
    row_cache: dict = {}
    unmapped_sample: list[str] = []

    # Compute the current watermark ONCE — anything older is a dup.
    from app.services.essl_bridge import _last_watermark
    watermark = _last_watermark(db, cfg)

    for uid, ts in parsed:
        if ts <= watermark:
            skipped_duplicate += 1
            continue

        emp = _resolve_employee(db, uid)
        if not emp:
            skipped_unmapped += 1
            if len(unmapped_sample) < 10 and uid not in unmapped_sample:
                unmapped_sample.append(uid)
            db.add(BiometricEvent(
                DEVICE_ID=cfg.device_id,
                FINGERPRINT_ID=uid,
                EMPLOYEE_ID=None,
                EVENT_TIME=ts,
                VERIFY_MODE="FP",
                RESULT="UNKNOWN_USER",
                RAW_PAYLOAD=f"source=csv-import file={file.filename}",
                VENDOR_ID=cfg.vendor_id,
            ))
            continue

        _apply_event(db, emp, ts, cfg, row_cache)
        db.add(BiometricEvent(
            DEVICE_ID=cfg.device_id,
            FINGERPRINT_ID=uid,
            EMPLOYEE_ID=emp.ID,
            EVENT_TIME=ts,
            VERIFY_MODE="FP",
            RESULT="SUCCESS",
            RAW_PAYLOAD=f"source=csv-import file={file.filename}",
            VENDOR_ID=cfg.vendor_id,
        ))
        applied += 1

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        log.exception("attendance CSV import: DB commit failed")
        return ImportSummary(
            total_rows=len(parsed),
            applied=0,
            skipped_duplicate=skipped_duplicate,
            skipped_unmapped=skipped_unmapped,
            skipped_invalid=invalid,
            error=f"{type(e).__name__}: {e}",
        )

    log.info(
        "attendance CSV import '%s' — total=%d applied=%d dup=%d unmapped=%d invalid=%d",
        file.filename, len(parsed), applied, skipped_duplicate,
        skipped_unmapped, invalid,
    )
    return ImportSummary(
        total_rows=len(parsed),
        applied=applied,
        skipped_duplicate=skipped_duplicate,
        skipped_unmapped=skipped_unmapped,
        skipped_invalid=invalid,
        sample_unmapped_ids=unmapped_sample,
    )
