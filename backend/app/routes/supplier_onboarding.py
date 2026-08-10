"""
Supplier Self-Onboarding — procurement module.

Admin generates a single-use token link and sends it to a prospective
supplier. The supplier fills in their company details and product list
on a public page (no ERP login required). Drafts auto-save so they
can resume after closing the browser. On submission the registration
enters an admin review queue; admin can approve or reject with a
reason.

PUBLIC endpoints  (token IS the secret — no JWT required):
  GET    /supplier-onboarding/register/{token}           Resume state
  POST   /supplier-onboarding/register/{token}/save-draft  Auto-save
  POST   /supplier-onboarding/register/{token}/submit    Final submit

ADMIN endpoints  (called from ERP UI):
  POST   /supplier-onboarding/invite                     Generate link
  GET    /supplier-onboarding/invitations                List all
  GET    /supplier-onboarding/invitations/{id}           Detail + draft
  POST   /supplier-onboarding/invitations/{id}/resend    Resend email
  POST   /supplier-onboarding/invitations/{id}/expire    Expire manually
  GET    /supplier-onboarding/pending-review             Submitted queue
  POST   /supplier-onboarding/invitations/{id}/approve   Approve
  POST   /supplier-onboarding/invitations/{id}/reject    Reject
"""

import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Supplier, Vendor, Employee, Department, Role, CustomField, CustomFieldTableValue
from app.utils.datetime_utils import now_ist
from app.utils.db_error_handler import raise_db_error
from app.models.supplier_models import (
    SupplierInvitation,
    SupplierRegistrationDraft,
    SupplierApprovalLog,
    SupplierProduct,
)
from app.models.inventory_models import ProductMaster

from app.schemas.supplier_onboarding_schema import (
    InvitationCreate,
    DraftSaveRequest,
    ApprovalRequest,
    RejectionRequest,
)
from app.services.email_service import send_via_resend, send_via_vendor_smtp
from app.services.email_template_service import (
    get_or_create_template,
    get_template_for_send,
    render_template,
)
from app.services.company_settings_service import get_company_settings, format_full_address
from app.models.email_models import VendorEmailConfig

router = APIRouter(prefix="/supplier-onboarding", tags=["Supplier Onboarding"])

import os as _os
import re as _re
import base64 as _b64
from pathlib import Path as _Path


def _build_email_logo(company):
    """Return (logo_bytes, logo_content_type, logo_html) for all email flows.

    Priority:
    1. Read bytes directly from the disk file (fastest, no network).
    2. Fetch bytes via HTTP from the local backend (fallback when the static
       root resolves differently at runtime — e.g. Docker volume mounts).
    3. Use the raw HTTP URL as last resort so the email still renders in
       clients that allow external images (logo will be missing in Gmail).

    Steps 1 and 2 produce a CID attachment, which is the only method that
    reliably renders a logo in Gmail, Outlook, and Apple Mail.  This matters
    especially for the Approval and Rejection templates, which use a
    {{logo_html}} placeholder in the catalog HTML rather than having a base64
    data URI baked in by the email editor.
    """
    logo_bytes = None
    logo_content_type = "image/png"
    logo_url = ""

    if company.LOGO_URL:
        rel = company.LOGO_URL.split("/static/", 1)[-1]
        logo_disk = _Path(__file__).resolve().parent.parent.parent / "static" / rel
        if logo_disk.exists():
            # ── Path 1: disk read ────────────────────────────────────────
            logo_bytes = logo_disk.read_bytes()
            ext = logo_disk.suffix.lower()
            logo_content_type = {
                ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".gif": "image/gif", ".webp": "image/webp",
                ".svg": "image/svg+xml",
            }.get(ext, "image/png")
            logo_url = "cid:company_logo"
        else:
            # ── Path 2: HTTP fetch from local backend ────────────────────
            # The invitation template has the logo embedded as a base64 data
            # URI by the email editor, so _extract_cid_logo() rescues it.
            # Approval / Rejection templates use {{logo_html}} → substituted
            # with an HTTP URL → _extract_cid_logo finds nothing.  Fetching
            # here ensures all four email flows get CID bytes.
            backend_base = _os.getenv("BACKEND_URL", "http://localhost:8001").rstrip("/")
            http_url = (
                company.LOGO_URL if company.LOGO_URL.startswith("http")
                else f"{backend_base}{company.LOGO_URL}"
            )
            try:
                import urllib.request as _urlreq
                _rq = _urlreq.Request(
                    http_url,
                    headers={"User-Agent": "BVC24-Mailer/1.0"},
                )
                with _urlreq.urlopen(_rq, timeout=5) as _resp:
                    logo_bytes = _resp.read()
                    _ct = _resp.headers.get("Content-Type", "image/png").split(";")[0].strip()
                    logo_content_type = _ct if _ct.startswith("image/") else "image/png"
                logo_url = "cid:company_logo"
            except Exception:
                # ── Path 3: fall back to HTTP URL ────────────────────────
                logo_url = http_url

    logo_html = (
        f'<img src="{logo_url}" alt="{company.LEGAL_NAME or "Company"} Logo"'
        f' style="max-height:70px;max-width:200px;display:block;margin:0 auto 12px;" />'
    ) if logo_url else ""

    return logo_bytes, logo_content_type, logo_html


def _apply_cid_logo(rendered_html: str, logo_bytes: bytes, company) -> str:
    """Rewrite all logo img src attributes in rendered HTML to use the CID reference."""
    if not (logo_bytes and company.LOGO_URL):
        return rendered_html
    logo_fname = company.LOGO_URL.rsplit("/", 1)[-1]
    CID = "cid:company_logo"

    def _ok(src):
        return (
            not src
            or logo_fname in src
            or company.LOGO_URL in src
            or src.startswith(("http://localhost", "http://127.0.0.1", "/static/company/"))
            or src.startswith("data:")
        )

    def _dq(m): return (m.group(1) + CID + m.group(3)) if _ok(m.group(2)) else m.group(0)
    def _sq(m): return (m.group(1) + CID + m.group(3)) if _ok(m.group(2)) else m.group(0)

    rendered_html = _re.sub(r'(<img\b[^>]+\bsrc=")([^"]*?)(")', _dq, rendered_html, flags=_re.IGNORECASE)
    rendered_html = _re.sub(r"(<img\b[^>]+\bsrc=')([^']*?)(')", _sq, rendered_html, flags=_re.IGNORECASE)
    return rendered_html


def _extract_cid_logo(rendered_html: str):
    """Fallback when the logo file is not on disk.

    The frontend email editor bakes the logo into BODY_HTML as a base64
    data URI (``<img src="data:image/png;base64,...">``) rather than a
    ``{{logo_html}}`` placeholder.  Gmail and most email clients strip
    data URIs from received emails for security reasons.

    This function extracts the raw bytes from the first such data URI,
    replaces **all** data-URI img src values with ``cid:company_logo``,
    and returns the modified HTML together with the bytes and MIME type
    needed to attach the image as a CID part in the MIME message.

    Returns ``(original_html, None, 'image/png')`` when no data URI is
    found so callers can safely destructure the result unconditionally.
    """
    m = _re.search(
        r"""<img\b[^>]+\bsrc=["'](data:image/([^;]+);base64,([^"']+))["']""",
        rendered_html,
        _re.IGNORECASE,
    )
    if not m:
        return rendered_html, None, "image/png"

    mime_sub = m.group(2).lower()   # e.g. "png", "jpeg", "gif", "webp"
    b64_raw  = m.group(3).strip()
    # base64.b64decode requires padding to a multiple of 4
    pad = (4 - len(b64_raw) % 4) % 4
    try:
        logo_bytes = _b64.b64decode(b64_raw + "=" * pad)
        logo_content_type = f"image/{mime_sub}"
    except Exception:
        return rendered_html, None, "image/png"

    # Rewrite all data-URI img src values to the CID reference so the
    # email client renders the CID attachment inline.
    CID = "cid:company_logo"

    def _rw(match):
        return (match.group(1) + CID + match.group(3)) if match.group(2).startswith("data:image/") else match.group(0)

    rendered_html = _re.sub(r'(<img\b[^>]+\bsrc=")([^"]*?)(")', _rw, rendered_html, flags=_re.IGNORECASE)
    rendered_html = _re.sub(r"(<img\b[^>]+\bsrc=')([^']*?)(')", _rw, rendered_html, flags=_re.IGNORECASE)
    return rendered_html, logo_bytes, logo_content_type


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _safe_int(v):
    try:
        return int(v) if v not in (None, "") else None
    except Exception:
        return None


def _safe_decimal(v):
    try:
        return float(v) if v not in (None, "") else None
    except Exception:
        return None


def _check_invitation(db: Session, invitation_id: str) -> SupplierInvitation:
    inv = db.query(SupplierInvitation).filter(
        SupplierInvitation.ID == invitation_id
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    return inv


def _get_by_token(db: Session, token: str) -> SupplierInvitation:
    inv = db.query(SupplierInvitation).filter(
        SupplierInvitation.TOKEN == token
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invalid or expired invitation link")
    if inv.STATUS == "EXPIRED":
        raise HTTPException(status_code=410, detail="This invitation link has expired")
    if inv.STATUS in ("APPROVED", "REJECTED"):
        raise HTTPException(
            status_code=409,
            detail=f"This invitation has already been {inv.STATUS.lower()}"
        )
    if inv.EXPIRES_AT and inv.EXPIRES_AT < now_ist():
        inv.STATUS = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=410, detail="This invitation link has expired")
    return inv


def _serialize_invitation(
    inv: SupplierInvitation,
    include_draft: bool = False,
    creator: "Employee | None" = None,
    creator_dept: "Department | None" = None,
    creator_role: "Role | None" = None,
) -> dict:
    d = {
        "ID": inv.ID,
        "VENDOR_ID": inv.VENDOR_ID,
        "INVITED_EMAIL": inv.INVITED_EMAIL,
        "INVITED_PHONE": inv.INVITED_PHONE,
        "INVITED_COMPANY_NAME": inv.INVITED_COMPANY_NAME,
        "STATUS": inv.STATUS,
        "SUPPLIER_ID": inv.SUPPLIER_ID,
        "CREATED_BY_ID": inv.CREATED_BY_ID,
        "CREATED_BY_NAME": creator.NAME if creator else None,
        "CREATED_BY_CODE": creator.EMPLOYEE_CODE if creator else None,
        "CREATED_BY_EMAIL": creator.EMAIL if creator else None,
        "CREATED_BY_PHONE": creator.PHONE if creator else None,
        "CREATED_BY_DEPARTMENT": creator_dept.NAME if creator_dept else None,
        "CREATED_BY_ROLE": creator_role.NAME if creator_role else None,
        "EXPIRES_AT": inv.EXPIRES_AT.isoformat() if inv.EXPIRES_AT else None,
        "SUBMITTED_AT": inv.SUBMITTED_AT.isoformat() if inv.SUBMITTED_AT else None,
        "APPROVED_AT": inv.APPROVED_AT.isoformat() if inv.APPROVED_AT else None,
        "REJECTED_AT": inv.REJECTED_AT.isoformat() if inv.REJECTED_AT else None,
        "REJECTION_REASON": inv.REJECTION_REASON,
        "EMAIL_SENT_AT": inv.EMAIL_SENT_AT.isoformat() if inv.EMAIL_SENT_AT else None,
        "NOTES": inv.NOTES,
        "CREATED_AT": inv.CREATED_AT.isoformat() if inv.CREATED_AT else None,
        "UPDATED_AT": inv.UPDATED_AT.isoformat() if inv.UPDATED_AT else None,
    }
    if include_draft and inv.draft:
        d["draft"] = {
            "FORM_DATA": inv.draft.FORM_DATA,
            "PRODUCTS_DATA": inv.draft.PRODUCTS_DATA,
            "LAST_SAVED_AT": inv.draft.LAST_SAVED_AT.isoformat() if inv.draft.LAST_SAVED_AT else None,
            "ENTRY_MODE": inv.draft.ENTRY_MODE,
        }
    return d


# ─────────────────────────────────────────────────────────────────────
# ADMIN ENDPOINTS
# ─────────────────────────────────────────────────────────────────────

@router.post("/invite")
def create_invitation(payload: InvitationCreate, db: Session = Depends(get_db)):
    """Admin generates a unique onboarding link for a prospective supplier."""
    vendor = db.query(Vendor).filter(Vendor.ID == payload.VENDOR_ID).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # ── Validate CREATED_BY_ID refers to a real employee row ──────────
    # Root cause of IntegrityError 1452: the UUID stored in the browser's
    # localStorage may be stale (e.g. DB was reset during development).
    # Validate explicitly so we return a clear error instead of a raw FK failure.
    if payload.CREATED_BY_ID:
        creator = db.query(Employee).filter(Employee.ID == payload.CREATED_BY_ID).first()
        if not creator:
            raise HTTPException(
                status_code=422,
                detail={
                    "success": False,
                    "message": "Failed to create supplier invitation.",
                    "error": (
                        f"Employee ID '{payload.CREATED_BY_ID}' does not exist in the "
                        "employee table. Your session may be stale — please sign out "
                        "and sign in again to refresh your credentials."
                    ),
                },
            )

    # ── Issue 11: Duplicate supplier validation ───────────────────────
    if payload.INVITED_EMAIL:
        dup = db.query(Supplier).filter(
            Supplier.VENDOR_ID == payload.VENDOR_ID,
            Supplier.EMAIL == payload.INVITED_EMAIL.strip().lower(),
        ).first()
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f"A supplier with email '{payload.INVITED_EMAIL}' already exists in the system.",
            )
    if payload.INVITED_PHONE:
        dup = db.query(Supplier).filter(
            Supplier.VENDOR_ID == payload.VENDOR_ID,
            Supplier.PHONE == payload.INVITED_PHONE.strip(),
        ).first()
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f"A supplier with phone number '{payload.INVITED_PHONE}' already exists in the system.",
            )

    token = secrets.token_urlsafe(48)   # 64-char URL-safe string

    expires_at = None
    if payload.EXPIRES_IN_DAYS:
        expires_at = now_ist() + timedelta(days=payload.EXPIRES_IN_DAYS)

    inv = SupplierInvitation(
        VENDOR_ID=payload.VENDOR_ID,
        TOKEN=token,
        INVITED_EMAIL=payload.INVITED_EMAIL,
        INVITED_PHONE=payload.INVITED_PHONE,
        INVITED_COMPANY_NAME=payload.INVITED_COMPANY_NAME,
        NOTES=payload.NOTES,
        EXPIRES_AT=expires_at,
        STATUS="OPEN",
        CREATED_BY_ID=payload.CREATED_BY_ID,
    )
    try:
        db.add(inv)
        db.commit()
        db.refresh(inv)
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "create supplier invitation")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "create supplier invitation")

    # Build the public registration URL
    frontend_base = "http://localhost:3000"   # override with env var in production
    import os
    frontend_base = os.getenv("FRONTEND_URL", frontend_base).rstrip("/")
    registration_url = f"{frontend_base}/supplier-register/{token}"

    # Send email using vendor SMTP config → fall back to Resend
    email_result = {
        "sent": False, "method": None,
        "smtp_connected": False, "authentication_success": False,
        "from_email": None, "from_name": None,
        "to_email": payload.INVITED_EMAIL, "bcc_email": None,
        "smtp_host": None, "message_id": None,
        "sent_at": None, "delivery_status": None, "error": None,
    }

    if payload.INVITED_EMAIL:
        company    = get_company_settings(db, payload.VENDOR_ID)
        tmpl       = get_or_create_template(db, payload.VENDOR_ID, "SUPPLIER_INVITATION")
        expires_str = inv.EXPIRES_AT.strftime("%d %B %Y") if inv.EXPIRES_AT else "N/A"

        # ── Logo: shared helper handles CID embedding with HTTP fallback ──
        logo_bytes, logo_content_type, logo_html = _build_email_logo(company)
        logo_url = "cid:company_logo" if logo_bytes else (
            company.LOGO_URL if company.LOGO_URL and company.LOGO_URL.startswith("http") else ""
        ) if company.LOGO_URL else ""

        variables  = {
            "company_name":      company.LEGAL_NAME or "",
            "invited_company":   inv.INVITED_COMPANY_NAME or "",
            "registration_link": registration_url,
            "expires_at":        expires_str,
            "support_email":     company.EMAIL or "",
            "company_address":   format_full_address(company),
            "contact_number":    company.PHONE or "",
            "website":           company.WEBSITE or "",
            "logo_url":          logo_url,
            "logo_html":         logo_html,
        }
        tmpl_html    = tmpl.BODY_HTML    if tmpl else ""
        tmpl_subject = tmpl.SUBJECT      if tmpl else f"Supplier Registration Invitation — {vendor.VENDOR_NAME}"
        rendered_subject, rendered_html = render_template(tmpl_html, tmpl_subject, variables)

        rendered_html = _apply_cid_logo(rendered_html, logo_bytes, company)
        # Fallback: if logo file was not on disk, extract bytes from the
        # base64 data URI the frontend editor bakes into BODY_HTML.
        if not logo_bytes:
            rendered_html, logo_bytes, logo_content_type = _extract_cid_logo(rendered_html)

        active_cfgs = db.query(VendorEmailConfig).filter(
            VendorEmailConfig.VENDOR_ID == payload.VENDOR_ID,
            VendorEmailConfig.IS_ACTIVE == True,
        ).all()

        used_cfg = None
        smtp_error = None
        last_detail: dict = {}

        for cfg in active_cfgs:
            ok, err, detail = send_via_vendor_smtp(
                cfg, payload.INVITED_EMAIL, rendered_subject, rendered_html,
                logo_bytes=logo_bytes, logo_content_type=logo_content_type,
            )
            last_detail = detail
            if ok:
                used_cfg = cfg
                break
            smtp_error = err

        # Propagate SMTP connection/auth detail from last attempt
        email_result.update({
            "smtp_connected": last_detail.get("smtp_connected", False),
            "authentication_success": last_detail.get("authentication_success", False),
            "message_id": last_detail.get("message_id"),
        })

        if used_cfg:
            email_result.update({
                "sent": True, "method": "smtp",
                "from_email": last_detail.get("effective_from") or used_cfg.FROM_EMAIL,
                "from_name": used_cfg.FROM_NAME,
                "bcc_email": used_cfg.BCC_EMAIL, "smtp_host": used_cfg.SMTP_HOST,
                "sent_at": now_ist().strftime("%Y-%m-%d %H:%M:%S"),
                "delivery_status": "accepted",
            })
            inv.EMAIL_SENT_AT = now_ist()
            db.commit()
        else:
            email_result["error"] = smtp_error
            ok_r, err_r = send_via_resend(
                subject=rendered_subject,
                body_html=rendered_html,
                recipient=payload.INVITED_EMAIL,
            )
            if ok_r:
                email_result.update({
                    "sent": True, "method": "resend",
                    "from_email": _os.getenv("SMTP_FROM", ""),
                    "sent_at": now_ist().strftime("%Y-%m-%d %H:%M:%S"),
                    "delivery_status": "accepted",
                    "error": None,
                })
                inv.EMAIL_SENT_AT = now_ist()
                db.commit()
            else:
                email_result.update({
                    "delivery_status": "failed",
                    "error": smtp_error or err_r,
                })

    return {
        "message": "Invitation created successfully",
        "invitation_id": inv.ID,
        "token": token,
        "registration_url": registration_url,
        "email_status": email_result,
    }


@router.get("/invitations")
def list_invitations(
    vendor_id: int = Query(1),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    filter_field: Optional[str] = Query(None, description="Date field to filter on: CREATED_AT|EMAIL_SENT_AT|EXPIRES_AT|SUBMITTED_AT|APPROVED_AT|REJECTED_AT"),
    from_dt: Optional[str] = Query(None, description="ISO datetime lower bound (inclusive)"),
    to_dt: Optional[str] = Query(None, description="ISO datetime upper bound (inclusive)"),
    db: Session = Depends(get_db),
):
    """Admin: list all invitations for a vendor."""
    from datetime import datetime as _dt
    q = db.query(SupplierInvitation).filter(
        SupplierInvitation.VENDOR_ID == vendor_id
    )
    if status:
        q = q.filter(SupplierInvitation.STATUS == status.upper())
    if search:
        term = f"%{search}%"
        q = q.filter(
            SupplierInvitation.INVITED_EMAIL.ilike(term) |
            SupplierInvitation.INVITED_COMPANY_NAME.ilike(term) |
            SupplierInvitation.INVITED_PHONE.ilike(term)
        )
    # Date-range filter on the selected date field
    _ALLOWED_FIELDS = {
        "CREATED_AT": SupplierInvitation.CREATED_AT,
        "EMAIL_SENT_AT": SupplierInvitation.EMAIL_SENT_AT,
        "EXPIRES_AT": SupplierInvitation.EXPIRES_AT,
        "SUBMITTED_AT": SupplierInvitation.SUBMITTED_AT,
        "APPROVED_AT": SupplierInvitation.APPROVED_AT,
        "REJECTED_AT": SupplierInvitation.REJECTED_AT,
    }
    col = _ALLOWED_FIELDS.get((filter_field or "CREATED_AT").upper())
    if col is not None and (from_dt or to_dt):
        if from_dt:
            try:
                q = q.filter(col >= _dt.fromisoformat(from_dt))
            except ValueError:
                pass
        if to_dt:
            try:
                q = q.filter(col <= _dt.fromisoformat(to_dt))
            except ValueError:
                pass
    rows = q.order_by(SupplierInvitation.CREATED_AT.desc()).all()
    return [_serialize_invitation(r) for r in rows]


@router.get("/pending-review")
def list_pending_review(vendor_id: int = Query(1), db: Session = Depends(get_db)):
    """Admin: list all SUBMITTED invitations awaiting review."""
    rows = (
        db.query(SupplierInvitation)
        .filter(
            SupplierInvitation.VENDOR_ID == vendor_id,
            SupplierInvitation.STATUS == "SUBMITTED",
        )
        .order_by(SupplierInvitation.SUBMITTED_AT.asc())
        .all()
    )
    # Fetch custom field definitions once for this vendor (same for all rows)
    cf_field_rows = (
        db.query(CustomField)
        .filter(
            CustomField.VENDOR_ID == vendor_id,
            CustomField.TABLE_NAME == "inventory_supplier_details",
        )
        .order_by(CustomField.SORT_ORDER, CustomField.FIELD_NAME)
        .all()
    )
    cf_fields_serialized = [
        {
            "ID": f.ID,
            "FIELD_NAME": f.FIELD_NAME,
            "FIELD_TYPE": f.FIELD_TYPE,
            "OPTIONS": f.OPTIONS,
            "IS_REQUIRED": f.IS_REQUIRED,
        }
        for f in cf_field_rows
    ]
    result = []
    for r in rows:
        row_data = _serialize_invitation(r, include_draft=True)
        row_data["cf_fields"] = cf_fields_serialized
        result.append(row_data)
    return result


@router.get("/invitations/{invitation_id}")
def get_invitation(invitation_id: str, db: Session = Depends(get_db)):
    """Admin: full invitation detail including draft preview and creator employee info."""
    inv = _check_invitation(db, invitation_id)
    creator = creator_dept = creator_role = None
    if inv.CREATED_BY_ID:
        creator = db.query(Employee).filter(Employee.ID == inv.CREATED_BY_ID).first()
        if creator:
            if creator.DEPARTMENT_ID:
                creator_dept = db.query(Department).filter(Department.ID == creator.DEPARTMENT_ID).first()
            if creator.ROLE_ID:
                creator_role = db.query(Role).filter(Role.ID == creator.ROLE_ID).first()
    result = _serialize_invitation(inv, include_draft=True, creator=creator, creator_dept=creator_dept, creator_role=creator_role)
    # Include custom field definitions so the ReviewModal can display supplier-entered values
    cf_field_rows = (
        db.query(CustomField)
        .filter(
            CustomField.VENDOR_ID == inv.VENDOR_ID,
            CustomField.TABLE_NAME == "inventory_supplier_details",
        )
        .order_by(CustomField.SORT_ORDER, CustomField.FIELD_NAME)
        .all()
    )
    result["cf_fields"] = [
        {
            "ID": f.ID,
            "FIELD_NAME": f.FIELD_NAME,
            "FIELD_TYPE": f.FIELD_TYPE,
            "OPTIONS": f.OPTIONS,
            "IS_REQUIRED": f.IS_REQUIRED,
        }
        for f in cf_field_rows
    ]
    return result


@router.delete("/invitations/{invitation_id}")
def delete_invitation(invitation_id: str, db: Session = Depends(get_db)):
    """Admin: permanently delete an invitation record. Blocked if already APPROVED."""
    inv = _check_invitation(db, invitation_id)
    if inv.STATUS == "APPROVED":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete an approved invitation — the supplier account already exists"
        )
    try:
        db.delete(inv)
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "delete invitation")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "delete invitation")
    return {"message": "Invitation deleted"}


@router.post("/invitations/{invitation_id}/resend")
def resend_invitation(invitation_id: str, db: Session = Depends(get_db)):
    """Admin: resend the invitation email."""
    inv = _check_invitation(db, invitation_id)
    if not inv.INVITED_EMAIL:
        raise HTTPException(status_code=400, detail="No email address on this invitation")

    frontend_base = _os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    registration_url = f"{frontend_base}/supplier-register/{inv.TOKEN}"

    vendor = db.query(Vendor).filter(Vendor.ID == inv.VENDOR_ID).first()
    vendor_name = vendor.VENDOR_NAME if vendor else "ERP"

    company    = get_company_settings(db, inv.VENDOR_ID)
    tmpl       = get_or_create_template(db, inv.VENDOR_ID, "SUPPLIER_INVITATION")
    expires_str = inv.EXPIRES_AT.strftime("%d %B %Y") if inv.EXPIRES_AT else "N/A"

    logo_bytes, logo_content_type, logo_html = _build_email_logo(company)
    logo_url = "cid:company_logo" if logo_bytes else (
        company.LOGO_URL if company.LOGO_URL and company.LOGO_URL.startswith("http") else ""
    ) if company.LOGO_URL else ""

    variables  = {
        "company_name":      company.LEGAL_NAME or "",
        "invited_company":   inv.INVITED_COMPANY_NAME or "",
        "registration_link": registration_url,
        "expires_at":        expires_str,
        "support_email":     company.EMAIL or "",
        "company_address":   format_full_address(company),
        "contact_number":    company.PHONE or "",
        "website":           company.WEBSITE or "",
        "logo_url":          logo_url,
        "logo_html":         logo_html,
    }
    tmpl_html    = tmpl.BODY_HTML if tmpl else ""
    tmpl_subject = tmpl.SUBJECT   if tmpl else f"Reminder: Supplier Registration — {vendor_name}"
    rendered_subject, rendered_html = render_template(tmpl_html, tmpl_subject, variables)

    rendered_html = _apply_cid_logo(rendered_html, logo_bytes, company)
    if not logo_bytes:
        rendered_html, logo_bytes, logo_content_type = _extract_cid_logo(rendered_html)

    active_cfgs = db.query(VendorEmailConfig).filter(
        VendorEmailConfig.VENDOR_ID == inv.VENDOR_ID,
        VendorEmailConfig.IS_ACTIVE == True,
    ).all()

    email_result = {
        "sent": False, "method": None,
        "smtp_connected": False, "authentication_success": False,
        "from_email": None, "from_name": None,
        "to_email": inv.INVITED_EMAIL, "bcc_email": None,
        "smtp_host": None, "message_id": None,
        "sent_at": None, "delivery_status": None, "error": None,
    }

    used_cfg = None
    smtp_error = None
    last_detail: dict = {}

    for cfg in active_cfgs:
        ok, err, detail = send_via_vendor_smtp(
            cfg, inv.INVITED_EMAIL, rendered_subject, rendered_html,
            logo_bytes=logo_bytes, logo_content_type=logo_content_type,
        )
        last_detail = detail
        if ok:
            used_cfg = cfg
            break
        smtp_error = err

    email_result.update({
        "smtp_connected": last_detail.get("smtp_connected", False),
        "authentication_success": last_detail.get("authentication_success", False),
        "message_id": last_detail.get("message_id"),
    })

    if used_cfg:
        email_result.update({
            "sent": True, "method": "smtp",
            "from_email": last_detail.get("effective_from") or used_cfg.FROM_EMAIL,
            "from_name": used_cfg.FROM_NAME,
            "bcc_email": used_cfg.BCC_EMAIL, "smtp_host": used_cfg.SMTP_HOST,
            "sent_at": now_ist().strftime("%Y-%m-%d %H:%M:%S"),
            "delivery_status": "accepted",
        })
        inv.EMAIL_SENT_AT = now_ist()
        db.commit()
    else:
        email_result["error"] = smtp_error
        ok_r, err_r = send_via_resend(
            subject=rendered_subject,
            body_html=rendered_html,
            recipient=inv.INVITED_EMAIL,
        )
        if ok_r:
            email_result.update({
                "sent": True, "method": "resend",
                "from_email": _os.getenv("SMTP_FROM", ""),
                "sent_at": now_ist().strftime("%Y-%m-%d %H:%M:%S"),
                "delivery_status": "accepted",
                "error": None,
            })
            inv.EMAIL_SENT_AT = now_ist()
            db.commit()
        else:
            email_result.update({
                "delivery_status": "failed",
                "error": smtp_error or err_r,
            })

    return {
        "message": "Email resent successfully" if email_result["sent"] else "Email delivery failed",
        "email_status": email_result,
    }


@router.post("/invitations/{invitation_id}/expire")
def expire_invitation(invitation_id: str, db: Session = Depends(get_db)):
    """Admin: manually expire an invitation link."""
    inv = _check_invitation(db, invitation_id)
    if inv.STATUS in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Cannot expire an already processed invitation")
    inv.STATUS = "EXPIRED"
    inv.EXPIRES_AT = now_ist()
    db.commit()
    return {"message": "Invitation expired"}


@router.post("/invitations/{invitation_id}/approve")
def approve_invitation(
    invitation_id: str,
    payload: Optional[ApprovalRequest] = None,
    db: Session = Depends(get_db),
):
    """
    Admin approves a submitted invitation:
    1. Creates Supplier row (existing table) from draft FORM_DATA
    2. Creates ProductMaster + SupplierProduct rows from PRODUCTS_DATA
    3. Sets invitation STATUS = APPROVED, links SUPPLIER_ID
    4. Logs to SupplierApprovalLog
    """
    inv = _check_invitation(db, invitation_id)
    if inv.STATUS != "SUBMITTED":
        raise HTTPException(
            status_code=400,
            detail=f"Invitation is in '{inv.STATUS}' status — only SUBMITTED invitations can be approved"
        )

    draft = inv.draft
    if not draft:
        raise HTTPException(status_code=400, detail="No draft data found for this invitation")

    form = draft.FORM_DATA or {}

    # ── 1. Create Supplier row ────────────────────────────────────────
    existing_count = db.query(Supplier).filter(Supplier.VENDOR_ID == inv.VENDOR_ID).count()
    supplier_code = f"SUP-{inv.VENDOR_ID:02d}-{(existing_count + 1):04d}"

    # Wrap ALL DB operations — including every db.flush() — inside a single
    # try/except.  Previously the flush calls were outside this block, so any
    # flush failure (missing column, constraint violation, etc.) propagated as
    # an unhandled exception and produced a bare 500 without CORS headers.
    try:
        supplier = Supplier(
            VENDOR_ID=inv.VENDOR_ID,
            SUPPLIER_CODE=supplier_code,
            COMPANY_NAME=form.get("company_name", inv.INVITED_COMPANY_NAME or "Unknown"),
            CONTACT_PERSON=form.get("contact_person"),
            PHONE=form.get("phone", inv.INVITED_PHONE),
            EMAIL=form.get("email", inv.INVITED_EMAIL),
            ADDRESS_LINE1=form.get("address_line1"),
            ADDRESS_LINE2=form.get("address_line2"),
            CITY=form.get("city"),
            STATE=form.get("state"),
            PINCODE=form.get("pincode"),
            GST_NUMBER=form.get("gst_number"),
            PAN_NUMBER=form.get("pan_number"),
            BANK_NAME=form.get("bank_name"),
            ACCOUNT_NUMBER=form.get("account_number"),
            IFSC_CODE=form.get("ifsc_code"),
            PAYMENT_TERMS=form.get("payment_terms"),
            STATUS="ACTIVE",
            REGISTRATION_NO=form.get("registration_no"),
            COMPANY_TYPE=form.get("company_type"),
            WEBSITE=form.get("website"),
            ALTERNATE_EMAIL=form.get("alternate_email"),
            ALTERNATE_PHONE=form.get("alternate_phone"),
            YEARS_IN_BUSINESS=_safe_int(form.get("years_in_business")),
            ANNUAL_TURNOVER=_safe_decimal(form.get("annual_turnover")),
            EMPLOYEE_COUNT=_safe_int(form.get("employee_count")),
            CERTIFICATIONS=form.get("certifications"),
            ADVANCE_PERCENT=_safe_decimal(form.get("advance_percent")),
            CREDIT_DAYS=_safe_int(form.get("credit_days")),
            MINIMUM_ORDER_VALUE=_safe_decimal(form.get("minimum_order_value")),
            LEAD_TIME_DAYS=_safe_int(form.get("lead_time_days")),
            DELIVERY_MODES=form.get("delivery_modes"),
        )
        db.add(supplier)
        db.flush()  # obtain supplier.ID before committing

        # ── 2. Persist custom-field values ────────────────────────────────
        cf_values = form.get("cf_values", {})
        if cf_values and isinstance(cf_values, dict):
            for field_id, field_value in cf_values.items():
                if field_id and field_value is not None:
                    db.add(CustomFieldTableValue(
                        TABLE_NAME="inventory_supplier_details",
                        TABLE_ROW_ID=str(supplier.ID),
                        CUSTOM_FIELD_ID=field_id,
                        CUSTOM_FIELD_VALUE=field_value,
                    ))

        # ── 3. Transfer declared products → SupplierProduct ──────────────
        # Only rows that carry a real product_master.ID (saved by the portal
        # after the fix to supplierRegistrationService.js) are transferred.
        # Rows with a null or synthetic "restored-N" ID are silently skipped.
        _products_data = draft.PRODUCTS_DATA or []
        _candidate_ids = [
            row.get("product_id") for row in _products_data
            if row.get("product_id")
            and not str(row["product_id"]).startswith("restored-")
        ]
        _pm_map: dict = {}
        if _candidate_ids:
            _pm_map = {
                pm.ID: pm.CATEGORY_ID
                for pm in db.query(ProductMaster).filter(
                    ProductMaster.ID.in_(_candidate_ids)
                ).all()
            }
        for _row in _products_data:
            _pid = _row.get("product_id")
            if not _pid or str(_pid).startswith("restored-") or _pid not in _pm_map:
                continue
            db.add(SupplierProduct(
                VENDOR_ID=inv.VENDOR_ID,
                SUPPLIER_ID=supplier.ID,
                PRODUCT_ID=_pid,
                CATEGORY_ID=_pm_map.get(_pid),
                UNIT_PRICE=float(_row.get("unit_price") or 0),
                MOQ=float(_row.get("moq") or 1),
                LEAD_TIME_DAYS=int(_row.get("lead_time_days") or 7),
            ))

        # ── 4. Update invitation ──────────────────────────────────────────
        inv.STATUS = "APPROVED"
        inv.SUPPLIER_ID = supplier.ID
        inv.APPROVED_AT = now_ist()

        # ── 5. Log ────────────────────────────────────────────────────────
        log_entry = SupplierApprovalLog(
            VENDOR_ID=inv.VENDOR_ID,
            INVITATION_ID=inv.ID,
            ACTION="APPROVED",
            REVIEWED_AT=now_ist(),
            COMMENTS=payload.COMMENTS if payload else None,
        )
        db.add(log_entry)

        # ── 6. Delete draft — no orphan data after approval ───────────────
        db.delete(draft)

        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "approve supplier invitation")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "approve supplier invitation")

    # Trigger ranking recalculation in background (best-effort)
    try:
        from app.services.supplier_ranking_service import recalculate_ranking_for_supplier
        recalculate_ranking_for_supplier(db, inv.VENDOR_ID, supplier.ID)
    except Exception as exc:
        print(f"[supplier-onboarding] ranking recalc failed (non-fatal): {exc}")

    # ── Issue 8: Send approval email ──────────────────────────────────
    try:
        _company = get_company_settings(db, inv.VENDOR_ID)
        _body_html, _tmpl_subject = get_template_for_send(db, inv.VENDOR_ID, "SUPPLIER_APPROVAL")
        _logo_bytes, _logo_ct, _logo_html = _build_email_logo(_company)
        _approved_at = now_ist().strftime("%d %b %Y, %I:%M %p")
        _vars = {
            "company_name":          _company.LEGAL_NAME or "",
            "supplier_company_name": supplier.COMPANY_NAME or "",
            "supplier_name":         supplier.CONTACT_PERSON or supplier.COMPANY_NAME or "",
            "approved_at":           _approved_at,
            "support_email":         _company.EMAIL or "",
            "company_address":       format_full_address(_company),
            "contact_number":        _company.PHONE or "",
            "website":               _company.WEBSITE or "",
            "logo_html":             _logo_html,
            # Fallbacks for cross-template placeholder safety
            "invited_company":       inv.INVITED_COMPANY_NAME or "",
            "expires_at":            "",
            "registration_link":     "",
            "rejected_at":           "",
            "rejection_reason":      "",
        }
        _rendered_subj, _rendered_html = render_template(
            _body_html,
            _tmpl_subject or f"Supplier Approval — {supplier.COMPANY_NAME}",
            _vars,
        )
        _rendered_html = _apply_cid_logo(_rendered_html, _logo_bytes, _company)
        if not _logo_bytes:
            _rendered_html, _logo_bytes, _logo_ct = _extract_cid_logo(_rendered_html)
        _recipient = inv.INVITED_EMAIL or supplier.EMAIL
        if _recipient:
            _active_cfgs = db.query(VendorEmailConfig).filter(
                VendorEmailConfig.VENDOR_ID == inv.VENDOR_ID,
                VendorEmailConfig.IS_ACTIVE == True,
            ).all()
            _smtp_ok = False
            for _cfg in _active_cfgs:
                _ok, _err, _ = send_via_vendor_smtp(
                    _cfg, _recipient, _rendered_subj, _rendered_html,
                    logo_bytes=_logo_bytes, logo_content_type=_logo_ct,
                )
                if _ok:
                    _smtp_ok = True
                    break
            if not _smtp_ok:
                send_via_resend(
                    subject=_rendered_subj,
                    body_html=_rendered_html,
                    recipient=_recipient,
                )
    except Exception as _e:
        print(f"[supplier-onboarding] approval email failed (non-fatal): {_e}")

    return {
        "message": "Supplier approved and activated",
        "supplier_id": supplier.ID,
        "supplier_code": supplier_code,
    }


@router.post("/invitations/{invitation_id}/reject")
def reject_invitation(
    invitation_id: str,
    payload: RejectionRequest,
    db: Session = Depends(get_db),
):
    """Admin rejects a submitted invitation with a reason."""
    inv = _check_invitation(db, invitation_id)
    if inv.STATUS != "SUBMITTED":
        raise HTTPException(
            status_code=400,
            detail=f"Invitation is in '{inv.STATUS}' status — only SUBMITTED invitations can be rejected"
        )

    inv.STATUS = "REJECTED"
    inv.REJECTION_REASON = payload.REJECTION_REASON
    inv.REJECTED_AT = now_ist()

    log_entry = SupplierApprovalLog(
        VENDOR_ID=inv.VENDOR_ID,
        INVITATION_ID=inv.ID,
        ACTION="REJECTED",
        REVIEWED_AT=now_ist(),
        REJECTION_REASON=payload.REJECTION_REASON,
        COMMENTS=payload.COMMENTS,
    )
    db.add(log_entry)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "reject supplier invitation")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "reject supplier invitation")

    # ── Send rejection email ─────────────────────────────────────────
    try:
        _company = get_company_settings(db, inv.VENDOR_ID)
        _body_html, _tmpl_subject = get_template_for_send(db, inv.VENDOR_ID, "SUPPLIER_REJECTION")
        _logo_bytes, _logo_ct, _logo_html = _build_email_logo(_company)
        _rejected_at = now_ist().strftime("%d %b %Y, %I:%M %p")
        _form = inv.draft.FORM_DATA if inv.draft else {}
        _vars = {
            "company_name":          _company.LEGAL_NAME or "",
            "supplier_company_name": _form.get("company_name") or inv.INVITED_COMPANY_NAME or "",
            "supplier_name":         _form.get("contact_person") or _form.get("company_name") or inv.INVITED_COMPANY_NAME or "",
            "rejection_reason":      payload.REJECTION_REASON or "Not specified",
            "rejected_at":           _rejected_at,
            "support_email":         _company.EMAIL or "",
            "company_address":       format_full_address(_company),
            "contact_number":        _company.PHONE or "",
            "website":               _company.WEBSITE or "",
            "logo_html":             _logo_html,
            # Fallbacks for cross-template placeholder safety
            "invited_company":       _form.get("company_name") or inv.INVITED_COMPANY_NAME or "",
            "expires_at":            "",
            "registration_link":     "",
            "approved_at":           "",
        }
        _supplier_company = _form.get("company_name") or inv.INVITED_COMPANY_NAME or ""
        _rendered_subj, _rendered_html = render_template(
            _body_html,
            _tmpl_subject or f"Supplier Registration Update — {_supplier_company}",
            _vars,
        )
        _rendered_html = _apply_cid_logo(_rendered_html, _logo_bytes, _company)
        if not _logo_bytes:
            _rendered_html, _logo_bytes, _logo_ct = _extract_cid_logo(_rendered_html)
        _recipient = inv.INVITED_EMAIL
        if _recipient:
            _active_cfgs = db.query(VendorEmailConfig).filter(
                VendorEmailConfig.VENDOR_ID == inv.VENDOR_ID,
                VendorEmailConfig.IS_ACTIVE == True,
            ).all()
            _smtp_ok = False
            for _cfg in _active_cfgs:
                _ok, _err, _ = send_via_vendor_smtp(
                    _cfg, _recipient, _rendered_subj, _rendered_html,
                    logo_bytes=_logo_bytes, logo_content_type=_logo_ct,
                )
                if _ok:
                    _smtp_ok = True
                    break
            if not _smtp_ok:
                send_via_resend(
                    subject=_rendered_subj,
                    body_html=_rendered_html,
                    recipient=_recipient,
                )
    except Exception as _e:
        print(f"[supplier-onboarding] rejection email failed (non-fatal): {_e}")

    return {"message": "Invitation rejected", "reason": payload.REJECTION_REASON}


# ─────────────────────────────────────────────────────────────────────
# PUBLIC ENDPOINTS  (NO AUTH — token is the secret)
# ─────────────────────────────────────────────────────────────────────

@router.get("/register/{token}")
def get_registration_state(token: str, db: Session = Depends(get_db)):
    """
    Supplier opens their onboarding link.
    Returns current draft state (if any) so the frontend can resume.
    """
    inv = _get_by_token(db, token)
    result = {
        "invitation_id": inv.ID,
        "vendor_id": inv.VENDOR_ID,
        "status": inv.STATUS,
        "invited_company_name": inv.INVITED_COMPANY_NAME,
        "invited_email": inv.INVITED_EMAIL,
        "expires_at": inv.EXPIRES_AT.isoformat() if inv.EXPIRES_AT else None,
    }
    if inv.draft:
        result["draft"] = {
            "form_data": inv.draft.FORM_DATA,
            "products_data": inv.draft.PRODUCTS_DATA,
            "last_saved_at": inv.draft.LAST_SAVED_AT.isoformat() if inv.draft.LAST_SAVED_AT else None,
            "entry_mode": inv.draft.ENTRY_MODE,
        }
    else:
        result["draft"] = None
    return result


@router.post("/register/{token}/save-draft")
def save_draft(
    token: str,
    payload: DraftSaveRequest,
    db: Session = Depends(get_db),
):
    """
    Auto-save the supplier's partially filled form.
    Idempotent — safe to call on every keystroke.
    Creates or updates SupplierRegistrationDraft for this invitation.
    """
    inv = _get_by_token(db, token)

    # Build form_data from payload fields (string + numeric + list fields)
    form_data = {}
    for field in [
        "company_name", "registration_no", "company_type",
        "contact_person", "phone", "alternate_phone",
        "email", "alternate_email", "website",
        "address_line1", "address_line2", "city", "state", "pincode",
        "gst_number", "pan_number", "bank_name", "account_number",
        "ifsc_code", "payment_terms",
        "years_in_business", "annual_turnover", "employee_count",
        "certifications", "advance_percent", "credit_days",
        "minimum_order_value", "lead_time_days", "delivery_modes",
    ]:
        val = getattr(payload, field, None)
        if val is not None:
            form_data[field] = val

    # Save custom field values alongside the standard form data
    if payload.cf_values is not None:
        form_data["cf_values"] = payload.cf_values

    products_data = None
    if payload.products is not None:
        products_data = [p.dict() for p in payload.products]

    draft = inv.draft
    if draft:
        if form_data:
            merged = dict(draft.FORM_DATA or {})
            merged.update(form_data)
            draft.FORM_DATA = merged
        if products_data is not None:
            draft.PRODUCTS_DATA = products_data
        if payload.ENTRY_MODE:
            draft.ENTRY_MODE = payload.ENTRY_MODE
        if payload.VOICE_TRANSCRIPT:
            draft.VOICE_TRANSCRIPT = payload.VOICE_TRANSCRIPT
        draft.LAST_SAVED_AT = now_ist()
    else:
        draft = SupplierRegistrationDraft(
            INVITATION_ID=inv.ID,
            FORM_DATA=form_data or None,
            PRODUCTS_DATA=products_data,
            ENTRY_MODE=payload.ENTRY_MODE or "MANUAL",
            VOICE_TRANSCRIPT=payload.VOICE_TRANSCRIPT,
            LAST_SAVED_AT=now_ist(),
        )
        db.add(draft)

    if inv.STATUS == "OPEN":
        inv.STATUS = "DRAFT_SAVED"

    db.commit()
    return {"message": "Draft saved", "last_saved_at": draft.LAST_SAVED_AT.isoformat()}


@router.get("/register/{token}/custom-fields")
def get_registration_custom_fields(token: str, db: Session = Depends(get_db)):
    """
    Return the custom field definitions configured for the supplier entity
    (TABLE_NAME = 'inventory_supplier_details') for this invitation's vendor.

    The public registration portal calls this (token is the auth secret) to
    render any admin-configured additional fields in the registration form.
    """
    inv = _get_by_token(db, token)
    fields = (
        db.query(CustomField)
        .filter(
            CustomField.VENDOR_ID == inv.VENDOR_ID,
            CustomField.TABLE_NAME == "inventory_supplier_details",
        )
        .order_by(CustomField.SORT_ORDER, CustomField.FIELD_NAME)
        .all()
    )
    return [
        {
            "ID": f.ID,
            "FIELD_NAME": f.FIELD_NAME,
            "FIELD_TYPE": f.FIELD_TYPE,
            "OPTIONS": f.OPTIONS,
            "IS_REQUIRED": f.IS_REQUIRED,
            "SORT_ORDER": f.SORT_ORDER,
        }
        for f in fields
    ]


@router.post("/register/{token}/submit")
def submit_registration(token: str, db: Session = Depends(get_db)):
    """
    Supplier finalises their registration.
    Sets invitation STATUS = SUBMITTED so it appears in the admin review queue.
    """
    inv = _get_by_token(db, token)

    if not inv.draft or not inv.draft.FORM_DATA:
        raise HTTPException(
            status_code=400,
            detail="Please save your company details before submitting"
        )

    form = inv.draft.FORM_DATA or {}
    if not form.get("company_name"):
        raise HTTPException(status_code=400, detail="Company name is required")

    inv.STATUS = "SUBMITTED"
    inv.SUBMITTED_AT = now_ist()
    db.commit()

    return {
        "message": "Registration submitted successfully. Our team will review and contact you shortly.",
        "submitted_at": inv.SUBMITTED_AT.isoformat(),
    }
