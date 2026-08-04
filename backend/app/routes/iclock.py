"""
ADMS-Push endpoints for ZKTeco / ESSL biometric devices.

Real-hardware protocol notes
----------------------------
The device (e.g. ESSL X2008, firmware 8.0.4.7, Push Service 2.0.33S)
talks to the ERP over PLAIN HTTP with a tiny text protocol — NOT
JSON. Every request carries `?SN=<serial>` in the query string; the
serial identifies which physical box is talking. All responses are
`text/plain`.

Endpoints implemented
---------------------
  GET  /iclock/cdata        — handshake, returns server options
  POST /iclock/cdata        — receives ATTLOG (punches) + OPERLOG
                              (user enrolments / operator actions)
  GET  /iclock/getrequest   — device polls for commands. We reply OK
                              (no server-side commands yet)
  POST /iclock/devicecmd    — device reports command results → OK
  GET  /iclock/ping         — heartbeat some firmwares use → OK

Flow for a normal punch
-----------------------
1. Employee places finger on the device.
2. Device POSTs to /iclock/cdata?SN=JNP2255102739&table=ATTLOG&Stamp=...
   Body (tab-separated, one record per line):
       8   2026-07-30 09:12:03   0   1   0   0
       │   │                     │   │
       PIN timestamp             status verify_mode
3. We look up Employee where FINGERPRINT_ID = "8" → BVC008 (Puviyarasi).
4. Write one BiometricEvent row (raw log, keeps unmapped PINs too).
5. Update today's Attendance:
      - device status 0 (or first punch)  → CHECK_IN if empty
      - device status 1 (or later punch)  → CHECK_OUT (overwrites)
      - device status 4 / 5               → OT_CHECK_IN / OT_CHECK_OUT
6. Reply `OK: 1` — device marks the record as delivered and stops
   retrying.
"""

from __future__ import annotations

from datetime import datetime, date, time
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_
from sqlalchemy.exc import IntegrityError

from app.database.database import get_db
from app.models.models import Employee, Attendance, BiometricEvent


router = APIRouter(prefix="/iclock", tags=["ADMS Biometric"])


# ---------------------------------------------------------------------
# Config — tune only if the device misbehaves.
# ---------------------------------------------------------------------

# Anyone scanning in AFTER this time is marked LATE. Matches
# attendance.py / biometric.py so all three code paths agree.
WORK_START = time(9, 15)

# If the device sends any status code we don't understand, we auto-
# decide based on today's Attendance row:
#   no CHECK_IN yet  →  treat as check-in
#   CHECK_IN present →  treat as check-out (updates each subsequent scan)
AUTO_DECIDE_ON_UNKNOWN_STATUS = True


# ---------------------------------------------------------------------
# GET /iclock/cdata — device handshake on power-up / config-refresh.
#
# The device sends: ?SN=<serial>&options=all&pushver=<v>&language=<l>
# We reply with the standard ADMS option block. The exact keys the
# device cares about are Stamp, OpStamp, TransFlag, TransInterval,
# Realtime — everything else is informational. Keeping Realtime=1 tells
# the device to push each punch immediately (no batching).
# ---------------------------------------------------------------------
@router.get("/cdata", response_class=PlainTextResponse)
@router.get("/cdata.aspx", response_class=PlainTextResponse)
def iclock_handshake(
    SN: str = Query(""),
    options: str = Query("all"),
    pushver: str = Query(""),
    language: str = Query(""),
):
    lines = [
        f"GET OPTION FROM: {SN}",
        "Stamp=9999",
        "OpStamp=9999",
        "ErrorDelay=30",
        "Delay=10",
        "TransTimes=00:00;14:05",
        "TransInterval=1",
        "TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP UserPic",
        "TimeZone=8",
        "Realtime=1",
        "Encrypt=None",
        "ServerVer=2.4.1",
        "PushProtVer=2.4.1",
    ]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------
# POST /iclock/cdata — punches (table=ATTLOG) + user changes (OPERLOG).
#
# The body is text/plain with lines separated by \n or \r\n, records
# separated inside a line by TABS. We accept latin-1 decoding to survive
# devices that send extended chars for user names.
# ---------------------------------------------------------------------
@router.post("/cdata", response_class=PlainTextResponse)
@router.post("/cdata.aspx", response_class=PlainTextResponse)
async def iclock_push(
    request: Request,
    SN: str = Query(""),
    table: str = Query(""),
    Stamp: str = Query(""),
    db: Session = Depends(get_db),
):
    body_bytes = await request.body()

    # Some firmwares send latin-1; UTF-8 in newer builds. Try UTF-8
    # first, fall back to latin-1 which never fails.
    try:
        body = body_bytes.decode("utf-8")
    except UnicodeDecodeError:
        body = body_bytes.decode("latin-1", errors="replace")

    if table.upper() == "ATTLOG":
        count = _handle_attlog(db, SN, body)
        return f"OK: {count}"

    if table.upper() == "OPERLOG":
        count = _handle_operlog(db, SN, body)
        return f"OK: {count}"

    # Unknown table → don't error, just acknowledge so the device
    # doesn't sit in a retry loop.
    return "OK"


# ---------------------------------------------------------------------
# GET /iclock/getrequest — device polls for server-side commands.
#
# Return "OK" when there's nothing to do. Later we can push a command
# by returning e.g. `C:1:REBOOT` or `C:2:DATA UPDATE USERINFO PIN=1...`
# ---------------------------------------------------------------------
@router.get("/getrequest", response_class=PlainTextResponse)
@router.get("/getrequest.aspx", response_class=PlainTextResponse)
def iclock_get_command(
    SN: str = Query(""),
    INFO: Optional[str] = Query(None),
):
    return "OK"


# ---------------------------------------------------------------------
# POST /iclock/devicecmd — device reports how a previously-sent command
# executed. We don't queue commands yet, but acknowledge so the device
# is happy.
# ---------------------------------------------------------------------
@router.post("/devicecmd", response_class=PlainTextResponse)
@router.post("/devicecmd.aspx", response_class=PlainTextResponse)
async def iclock_command_result(request: Request, SN: str = Query("")):
    return "OK"


# ---------------------------------------------------------------------
# GET /iclock/ping — heartbeat.
# ---------------------------------------------------------------------
@router.get("/ping", response_class=PlainTextResponse)
@router.get("/ping.aspx", response_class=PlainTextResponse)
def iclock_ping(SN: str = Query("")):
    return "OK"


# =====================================================================
# ATTLOG handler
# =====================================================================
def _handle_attlog(db: Session, device_sn: str, body: str) -> int:
    """
    ATTLOG body format (tab-separated, one record per line):

        PIN <TAB> YYYY-MM-DD HH:MM:SS <TAB> Status <TAB> VerifyMode
            <TAB> WorkCode <TAB> Reserved

    Status codes (per ADMS spec):
        0 = check-in       1 = check-out
        2 = break-out      3 = break-in
        4 = OT check-in    5 = OT check-out

    VerifyMode codes:
        0 = password       1 = fingerprint     2 = card
        15 = face

    Returns the number of records the ERP accepted (some rows may be
    duplicates or reference unknown PINs — we still count them so the
    device doesn't resend forever).
    """
    lines = [ln.strip() for ln in body.replace("\r\n", "\n").split("\n") if ln.strip()]
    processed = 0

    for line in lines:

        try:
            _process_one_attlog_line(db, device_sn, line)
            # Commit after each record so one bad line can't roll back
            # a whole batch — critical when a device dumps months of
            # backlogged punches on first successful push.
            db.commit()
            processed += 1

        except IntegrityError:
            # Almost always the (EMPLOYEE_ID, DATE) unique constraint —
            # we're trying to insert a second Attendance row for the
            # same employee on the same day. Roll back the failed
            # add, then update the existing row instead.
            db.rollback()
            try:
                _retry_attlog_line_as_update(db, device_sn, line)
                db.commit()
                processed += 1
            except Exception:
                db.rollback()
                # Give up on this specific line but keep going — return
                # "OK" to the device so it doesn't resend forever.
                processed += 1

        except Exception:
            db.rollback()
            # Any other failure — skip the line so one weird record
            # doesn't kill the whole batch. Device retries handle it.
            processed += 1

    return processed


def _process_one_attlog_line(db: Session, device_sn: str, line: str) -> None:
    """Parse a single ATTLOG record and apply it to BiometricEvent +
    Attendance. Caller handles commit/rollback."""

    parts = line.split("\t")

    if len(parts) < 2:
        return

    pin = parts[0].strip()
    raw_ts = parts[1].strip()

    try:
        event_time = datetime.strptime(raw_ts, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        _write_biometric_event(
            db, device_sn, pin, None,
            verify_mode="ERR", result="BAD_TIMESTAMP",
            raw=line, event_time=datetime.utcnow(),
        )
        return

    status_raw = parts[2].strip() if len(parts) >= 3 else "0"
    verify_raw = parts[3].strip() if len(parts) >= 4 else "1"
    verify_mode = _verify_label(verify_raw)

    emp = (
        db.query(Employee)
          .filter(Employee.FINGERPRINT_ID == pin)
          .first()
    )
    emp_id = emp.ID if emp else None

    already = (
        db.query(BiometricEvent)
          .filter(
              BiometricEvent.DEVICE_ID == device_sn,
              BiometricEvent.FINGERPRINT_ID == pin,
              BiometricEvent.EVENT_TIME == event_time,
          )
          .first()
    )

    if already:
        return

    _write_biometric_event(
        db, device_sn, pin, emp_id,
        verify_mode=verify_mode,
        result="SUCCESS" if emp else "UNKNOWN_USER",
        raw=line,
        event_time=event_time,
    )

    if emp:
        _apply_to_attendance(db, emp, event_time, status_raw)


def _retry_attlog_line_as_update(db: Session, device_sn: str, line: str) -> None:
    """Re-run a single ATTLOG line after an IntegrityError, assuming the
    Attendance row for (employee, day) already exists — so we UPDATE it
    instead of INSERTing. BiometricEvent write is retried too, since the
    session was rolled back."""

    parts = line.split("\t")
    if len(parts) < 2:
        return

    pin = parts[0].strip()
    try:
        event_time = datetime.strptime(parts[1].strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return

    status_raw = parts[2].strip() if len(parts) >= 3 else "0"
    verify_raw = parts[3].strip() if len(parts) >= 4 else "1"

    emp = (
        db.query(Employee)
          .filter(Employee.FINGERPRINT_ID == pin)
          .first()
    )
    if not emp:
        return

    # Write the BiometricEvent (audit) — safe on retry, has no unique
    # constraint other than the primary key.
    _write_biometric_event(
        db, device_sn, pin, emp.ID,
        verify_mode=_verify_label(verify_raw),
        result="SUCCESS",
        raw=line,
        event_time=event_time,
    )

    # Now apply to the *existing* Attendance row. Because we've flushed
    # the previous batch and rolled back the failed insert, a fresh
    # query will find the row that was already there before this batch.
    _apply_to_attendance(db, emp, event_time, status_raw)


def _apply_to_attendance(
    db: Session,
    emp: Employee,
    event_time: datetime,
    status_code: str,
) -> None:
    """
    Map an ADMS punch onto today's Attendance row.

    Every employee gets ONE row per day; this function either creates
    it (on first punch) or updates it. The device's status code drives
    the decision when it's a known value; otherwise we auto-decide
    based on what's already filled.
    """
    day = event_time.date()

    row = (
        db.query(Attendance)
          .filter(
              and_(
                  Attendance.EMPLOYEE_ID == emp.ID,
                  Attendance.DATE == day,
              )
          )
          .first()
      )

    if not row:

        row = Attendance(
            EMPLOYEE_ID=emp.ID,
            DATE=day,
            VENDOR_ID=getattr(emp, "VENDOR_ID", 1) or 1,
            STATUS="PRESENT",
        )
        db.add(row)
        # Flush so a subsequent query in the same session sees this
        # row. Without this, two ATTLOG lines for the same
        # (employee, day) both try to INSERT and the second violates
        # uq_attendance_employee_date.
        db.flush()

    # Decide what this punch means.
    action = _decide_action(row, status_code)

    if action == "CHECK_IN":

        row.CHECK_IN = event_time

        row.STATUS = "LATE" if event_time.time() > WORK_START else "PRESENT"

    elif action == "CHECK_OUT":

        row.CHECK_OUT = event_time

        # Recompute worked hours if we have both edges.
        if row.CHECK_IN and row.CHECK_OUT and row.CHECK_OUT > row.CHECK_IN:
            row.WORKED_HOURS = round(
                (row.CHECK_OUT - row.CHECK_IN).total_seconds() / 3600.0, 2
            )

    elif action == "OT_IN":

        row.OT_CHECK_IN = event_time

    elif action == "OT_OUT":

        row.OT_CHECK_OUT = event_time

        if row.OT_CHECK_IN and row.OT_CHECK_OUT and row.OT_CHECK_OUT > row.OT_CHECK_IN:
            row.OVERTIME_HOURS = round(
                (row.OT_CHECK_OUT - row.OT_CHECK_IN).total_seconds() / 3600.0, 2
            )

    row.DEVICE_INFO = "ESSL_ADMS"


def _decide_action(row: Attendance, status_code: str) -> str:
    """
    Return one of CHECK_IN / CHECK_OUT / OT_IN / OT_OUT.

    Devices differ: some send accurate status codes (0/1/4/5), others
    always send status=0 for every punch. Prefer the device code when
    it's a known value; otherwise auto-decide from row state so a
    'dumb' device still produces a correct check-in → check-out row.
    """
    if status_code == "0":
        # Explicit check-in from device. But if today's CHECK_IN is
        # already set, treat the SAME code as check-out — this is
        # the 'dumb device' fallback where status is always 0.
        if row.CHECK_IN is None:
            return "CHECK_IN"
        return "CHECK_OUT"

    if status_code == "1":
        return "CHECK_OUT"

    if status_code == "4":
        return "OT_IN"

    if status_code == "5":
        return "OT_OUT"

    if not AUTO_DECIDE_ON_UNKNOWN_STATUS:
        return "CHECK_OUT"

    # Unknown status — infer from row state.
    if row.CHECK_IN is None:
        return "CHECK_IN"
    if row.CHECK_OUT is None:
        return "CHECK_OUT"
    if row.OT_CHECK_IN is None:
        return "OT_IN"
    return "OT_OUT"


# =====================================================================
# OPERLOG handler — user enrolments / operator actions.
#
# We store a BiometricEvent for audit but don't try to auto-create
# Employees. Enrolment stays a manual admin step in the ERP so we
# always have an approving user.
# =====================================================================
def _handle_operlog(db: Session, device_sn: str, body: str) -> int:

    lines = [ln.strip() for ln in body.replace("\r\n", "\n").split("\n") if ln.strip()]

    for line in lines:

        _write_biometric_event(
            db, device_sn, None, None,
            verify_mode="OPERLOG",
            result="INFO",
            raw=line[:1000],
            event_time=datetime.utcnow(),
        )

    if lines:
        db.commit()

    return len(lines)


# =====================================================================
# Helpers
# =====================================================================
def _verify_label(code: str) -> str:

    return {
        "0":  "PWD",
        "1":  "FP",
        "2":  "CARD",
        "3":  "FP_PWD",
        "4":  "FP_CARD",
        "15": "FACE",
    }.get(code.strip(), f"MODE_{code}")


def _write_biometric_event(
    db: Session,
    device_sn: str,
    pin: Optional[str],
    employee_id: Optional[str],
    *,
    verify_mode: str,
    result: str,
    raw: str,
    event_time: datetime,
) -> None:

    ev = BiometricEvent(
        DEVICE_ID=device_sn or "UNKNOWN",
        FINGERPRINT_ID=(pin or ""),
        EMPLOYEE_ID=employee_id,
        EVENT_TIME=event_time,
        VERIFY_MODE=verify_mode,
        RESULT=result,
        RAW_PAYLOAD=(raw or "")[:1000],
        VENDOR_ID=1,
    )
    db.add(ev)


# =====================================================================
# USB-import fallback — when the device can't push over network.
#
# Workflow the admin follows:
#   1. Insert a USB pen drive into the ESSL X2008.
#   2. Menu → USB Manager → Download → Attendance Data
#      (device writes something like `1_attlog.dat` or `attlog.txt`).
#   3. Remove USB, plug into PC, open ERP admin page.
#   4. Choose the file → Upload.
#
# We accept both the plain-text ATTLOG format the ADMS Push uses AND
# the alternative "|"-separated format some ESSL firmwares export.
# Same PIN → Employee lookup, same dedup, same Attendance rules.
# =====================================================================
@router.post("/import-attlog")
async def import_attlog_file(
    file: UploadFile = File(...),
    device_sn: str = Form("MANUAL_USB"),
    db: Session = Depends(get_db),
):
    """
    Upload an attendance log exported from the biometric device via
    USB. Returns the number of records that landed vs. were skipped
    as duplicates vs. were mapped to unknown PINs.
    """
    raw = await file.read()

    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    # ESSL exports are usually latin-1; some newer firmwares are utf-8.
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")

    # Normalise: some devices use "|" as separator, others use tab.
    # Convert any "|" runs to "\t" so _handle_attlog works uniformly.
    normalised = text.replace("|", "\t")

    # Count DB rows before we start so we can report a delta accurately.
    before = db.query(BiometricEvent).filter(
        BiometricEvent.DEVICE_ID == device_sn
    ).count()

    processed = _handle_attlog(db, device_sn, normalised)

    after = db.query(BiometricEvent).filter(
        BiometricEvent.DEVICE_ID == device_sn
    ).count()

    inserted = after - before

    return {
        "filename": file.filename,
        "device_sn": device_sn,
        "records_seen": processed,
        "rows_inserted": inserted,
        "rows_skipped_as_duplicate": max(0, processed - inserted),
    }
