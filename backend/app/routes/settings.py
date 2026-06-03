from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from datetime import datetime
from pathlib import Path
import uuid
import shutil

from app.database.database import get_db

from app.models.models import Setting, CompanyMaster

from app.services.company_settings_service import (
    get_company_settings,
    serialize_company
)

from app.schemas.settings_schema import (
    EmailAlertsToggle,
    TestEmailRequest
)

from app.services.email_service import (
    get_email_config,
    is_smtp_configured,
    send_alert_email,
    build_alert_html
)


router = APIRouter()


EMAIL_ALERTS_KEY = "email_alerts_enabled"


# =========================
# HELPERS
# =========================

def get_setting_value(db, key, default=""):

    row = db.query(Setting).filter(
        Setting.KEY == key
    ).first()

    if not row:

        return default

    return row.VALUE


def set_setting_value(db, key, value):

    row = db.query(Setting).filter(
        Setting.KEY == key
    ).first()

    if row:

        row.VALUE = value

        row.UPDATED_AT = datetime.utcnow()

    else:

        row = Setting(
            KEY=key,
            VALUE=value,
            UPDATED_AT=datetime.utcnow()
        )

        db.add(row)

    db.commit()

    return row


def is_email_alerts_enabled(db):

    return get_setting_value(
        db,
        EMAIL_ALERTS_KEY,
        "false"
    ).lower() == "true"


# =========================
# OFFICE HOURS (attendance)
# =========================

from pydantic import BaseModel
from app.services.attendance_settings_service import (
    get_office_hours,
    set_office_hours,
    get_grace_minutes,
    set_grace_minutes
)


class OfficeHoursPatch(BaseModel):

    start_time: str   # "HH:MM" — e.g. "10:00"
    end_time:   str   # "HH:MM" — e.g. "17:30"


@router.get("/settings/office-hours")
def read_office_hours(db: Session = Depends(get_db)):
    """Current configured office hours. Defaults: 10:00 - 17:30."""

    start, end = get_office_hours(db)

    return {
        "start_time": start.strftime("%H:%M"),
        "end_time":   end.strftime("%H:%M"),
        "note": (
            "Login at/after start_time is recorded as Check-In; logout "
            "before end_time is recorded as Permission / Early Exit."
        )
    }


@router.patch("/settings/office-hours")
def update_office_hours(
    body: OfficeHoursPatch,
    db: Session = Depends(get_db)
):
    """Admin — change office hours. Validates HH:MM format and that
    start < end. Takes effect on the next login/logout."""

    try:

        start, end = set_office_hours(db, body.start_time, body.end_time)

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    return {
        "message": "Office hours updated.",
        "start_time": start.strftime("%H:%M"),
        "end_time":   end.strftime("%H:%M")
    }


# ---- Grace period (Phase D) ----

class GracePeriodPatch(BaseModel):

    late_grace_minutes:       int   # tolerance before a LATE_COMING permission is auto-created
    early_exit_grace_minutes: int   # tolerance before an EARLY_EXIT permission is auto-created


@router.get("/settings/attendance-grace")
def read_grace(db: Session = Depends(get_db)):
    """Current grace windows for auto-creating permissions."""

    late, early = get_grace_minutes(db)

    return {
        "late_grace_minutes":       late,
        "early_exit_grace_minutes": early,
        "note": (
            "Within these windows, the system does NOT auto-create a "
            "PERMISSION row. Past them, LATE_COMING / EARLY_EXIT "
            "permissions appear in the approval queue."
        )
    }


@router.patch("/settings/attendance-grace")
def update_grace(
    body: GracePeriodPatch,
    db: Session = Depends(get_db)
):

    try:

        late, early = set_grace_minutes(
            db,
            body.late_grace_minutes,
            body.early_exit_grace_minutes
        )

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))

    return {
        "message": "Grace periods updated.",
        "late_grace_minutes":       late,
        "early_exit_grace_minutes": early
    }


# =========================
# GET SETTINGS
# =========================

@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db)
):

    cfg = get_email_config()

    return {
        "email_alerts_enabled": is_email_alerts_enabled(
            db
        ),
        "smtp_configured": is_smtp_configured(),
        "smtp_host": cfg["host"] or None,
        "smtp_user": cfg["user"] or None,
        "from_addr": cfg["from_addr"] or None,
        "from_name": cfg["from_name"],
        "admin_email": cfg["admin_email"] or None,
        "use_tls": cfg["use_tls"]
    }


# =========================
# TOGGLE EMAIL ALERTS
# =========================

@router.put("/settings/email-alerts")
def toggle_email_alerts(
    data: EmailAlertsToggle,
    db: Session = Depends(get_db)
):

    set_setting_value(
        db,
        EMAIL_ALERTS_KEY,
        "true" if data.enabled else "false"
    )

    return {
        "email_alerts_enabled": data.enabled
    }


# =========================
# SEND TEST EMAIL
# =========================

@router.post("/settings/test-email")
def send_test_email(
    data: TestEmailRequest,
    db: Session = Depends(get_db)
):

    # Accept either Resend (HTTP API) OR classic SMTP
    from app.services.email_service import is_resend_configured

    if not (is_resend_configured() or is_smtp_configured()):

        raise HTTPException(
            status_code=400,
            detail=(
                "No email provider configured. Either set "
                "RESEND_API_KEY (recommended) or "
                "SMTP_HOST / SMTP_USER / SMTP_PASSWORD / SMTP_FROM "
                "in .env. Restart uvicorn after editing."
            )
        )

    # Swagger fills 'recipient' with the literal word 'string'
    # if you don't type anything. Treat that as empty so we
    # fall back to ADMIN_EMAIL.
    raw = (data.recipient or "").strip()

    recipient = raw if raw and raw.lower() != "string" else None

    html = build_alert_html(
        "Test Alert",
        "This is a test email from your Bharath ERP "
        "system. If you received it, your email "
        "configuration is working.",
        "INFO"
    )

    ok, msg = send_alert_email(
        "[Bharath ERP] Test Alert",
        html,
        recipient=recipient
    )

    if not ok:

        raise HTTPException(
            status_code=500,
            detail=f"Email failed: {msg}"
        )

    return {
        "message": msg
    }


# ====================================================================
# Admin Module 3 — Company Master Settings
# ====================================================================

from pydantic import BaseModel
from typing import Optional


class CompanySettingsBody(BaseModel):

    LEGAL_NAME: Optional[str] = None
    SHORT_NAME: Optional[str] = None
    TAGLINE:    Optional[str] = None
    GST_NUMBER: Optional[str] = None
    PAN_NUMBER: Optional[str] = None
    CIN_NUMBER: Optional[str] = None
    ADDRESS_LINE_1: Optional[str] = None
    ADDRESS_LINE_2: Optional[str] = None
    CITY:    Optional[str] = None
    STATE:   Optional[str] = None
    PINCODE: Optional[str] = None
    COUNTRY: Optional[str] = None
    EMAIL:   Optional[str] = None
    PHONE:   Optional[str] = None
    WEBSITE: Optional[str] = None
    BANK_NAME:           Optional[str] = None
    BANK_ACCOUNT_NUMBER: Optional[str] = None
    BANK_IFSC:           Optional[str] = None
    BANK_BRANCH:         Optional[str] = None
    UPI_ID:              Optional[str] = None
    NOTES:               Optional[str] = None


@router.get("/settings/company")
def read_company_settings(
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):
    """Return the company master row for the given vendor.

    Auto-seeds a default row (legacy BVC values) on first access so
    this endpoint never 404s for a configured vendor."""

    row = get_company_settings(db, vendor_id)

    return serialize_company(row)


@router.put("/settings/company")
def update_company_settings(
    body: CompanySettingsBody,
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):
    """Update any subset of fields. Empty strings are coerced to NULL
    so HR can clear a value by submitting an empty string."""

    row = get_company_settings(db, vendor_id)

    for k, v in body.model_dump(exclude_unset=True).items():

        # Coerce empty strings to None so the column becomes NULL
        if isinstance(v, str) and v.strip() == "":

            v = None

        setattr(row, k, v)

    db.commit()

    db.refresh(row)

    return {
        "message": "Company settings updated.",
        "company": serialize_company(row),
    }


_ALLOWED_LOGO_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}

_LOGO_DIR = (
    Path(__file__).resolve().parent.parent.parent / "static" / "company"
)


@router.post("/settings/company/upload-logo")
def upload_company_logo(
    file: UploadFile = File(...),
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):
    """Upload a new company logo. Replaces the previous one on disk."""

    ext = Path(file.filename or "").suffix.lower()

    if ext not in _ALLOWED_LOGO_EXTS:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported logo extension '{ext}'. Allowed: "
                + ", ".join(sorted(_ALLOWED_LOGO_EXTS))
            )
        )

    _LOGO_DIR.mkdir(parents=True, exist_ok=True)

    fname = f"vendor-{vendor_id}-{uuid.uuid4().hex[:8]}{ext}"

    dest = _LOGO_DIR / fname

    with dest.open("wb") as out:

        shutil.copyfileobj(file.file, out)

    company = get_company_settings(db, vendor_id)

    # Remove previous logo file from disk
    if company.LOGO_URL:

        try:

            old_name = company.LOGO_URL.rsplit("/", 1)[-1]

            old_path = _LOGO_DIR / old_name

            if old_path.exists() and old_path.is_file():

                old_path.unlink()

        except Exception:

            pass

    new_url = f"/static/company/{fname}"

    company.LOGO_URL = new_url

    db.commit()

    db.refresh(company)

    return {
        "message": "Logo uploaded.",
        "logo_url": new_url,
        "company": serialize_company(company),
    }


@router.delete("/settings/company/logo")
def remove_company_logo(
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):
    """Clear the logo (delete the file + null the column)."""

    company = get_company_settings(db, vendor_id)

    if company.LOGO_URL:

        try:

            old_name = company.LOGO_URL.rsplit("/", 1)[-1]

            old_path = _LOGO_DIR / old_name

            if old_path.exists() and old_path.is_file():

                old_path.unlink()

        except Exception:

            pass

    company.LOGO_URL = None

    db.commit()

    return {"message": "Logo removed.", "company": serialize_company(company)}
