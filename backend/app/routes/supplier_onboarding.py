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
import uuid
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Supplier, Vendor
from app.models.supplier_models import (
    SupplierInvitation,
    SupplierRegistrationDraft,
    SupplierProduct,
    SupplierApprovalLog,
)
from app.models.inventory_models import ProductMaster

from app.schemas.supplier_onboarding_schema import (
    InvitationCreate,
    DraftSaveRequest,
    ApprovalRequest,
    RejectionRequest,
)
from app.services.email_service import send_via_resend

router = APIRouter(prefix="/supplier-onboarding", tags=["Supplier Onboarding"])


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

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
    if inv.EXPIRES_AT and inv.EXPIRES_AT < datetime.utcnow():
        inv.STATUS = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=410, detail="This invitation link has expired")
    return inv


def _serialize_invitation(inv: SupplierInvitation, include_draft: bool = False) -> dict:
    d = {
        "ID": inv.ID,
        "VENDOR_ID": inv.VENDOR_ID,
        "INVITED_EMAIL": inv.INVITED_EMAIL,
        "INVITED_PHONE": inv.INVITED_PHONE,
        "INVITED_COMPANY_NAME": inv.INVITED_COMPANY_NAME,
        "STATUS": inv.STATUS,
        "SUPPLIER_ID": inv.SUPPLIER_ID,
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

    token = secrets.token_urlsafe(48)   # 64-char URL-safe string

    expires_at = None
    if payload.EXPIRES_IN_DAYS:
        expires_at = datetime.utcnow() + timedelta(days=payload.EXPIRES_IN_DAYS)

    inv = SupplierInvitation(
        VENDOR_ID=payload.VENDOR_ID,
        TOKEN=token,
        INVITED_EMAIL=payload.INVITED_EMAIL,
        INVITED_PHONE=payload.INVITED_PHONE,
        INVITED_COMPANY_NAME=payload.INVITED_COMPANY_NAME,
        NOTES=payload.NOTES,
        EXPIRES_AT=expires_at,
        STATUS="OPEN",
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    # Build the public registration URL
    frontend_base = "http://localhost:3000"   # override with env var in production
    import os
    frontend_base = os.getenv("FRONTEND_URL", frontend_base).rstrip("/")
    registration_url = f"{frontend_base}/supplier-register/{token}"

    # Send email if configured and an email address was provided
    email_sent = False
    if payload.INVITED_EMAIL:
        html_body = f"""
        <h2>You're invited to register as a supplier</h2>
        <p>Hello {payload.INVITED_COMPANY_NAME or 'Supplier'},</p>
        <p>You have been invited to register as a supplier for <strong>{vendor.VENDOR_NAME}</strong>.</p>
        <p>Please click the link below to complete your registration:</p>
        <p><a href="{registration_url}" style="color:#0066cc;">{registration_url}</a></p>
        <p>This link {'expires in ' + str(payload.EXPIRES_IN_DAYS) + ' days' if payload.EXPIRES_IN_DAYS else 'does not expire'}.</p>
        <br><p>If you have any questions, please contact us.</p>
        """
        ok, _ = send_via_resend(
            subject=f"Supplier Registration Invitation — {vendor.VENDOR_NAME}",
            body_html=html_body,
            recipient=payload.INVITED_EMAIL,
        )
        if ok:
            inv.EMAIL_SENT_AT = datetime.utcnow()
            db.commit()
            email_sent = True

    return {
        "message": "Invitation created successfully",
        "invitation_id": inv.ID,
        "token": token,
        "registration_url": registration_url,
        "email_sent": email_sent,
    }


@router.get("/invitations")
def list_invitations(
    vendor_id: int = Query(1),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Admin: list all invitations for a vendor."""
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
    return [_serialize_invitation(r, include_draft=True) for r in rows]


@router.get("/invitations/{invitation_id}")
def get_invitation(invitation_id: str, db: Session = Depends(get_db)):
    """Admin: full invitation detail including draft preview."""
    inv = _check_invitation(db, invitation_id)
    return _serialize_invitation(inv, include_draft=True)


@router.post("/invitations/{invitation_id}/resend")
def resend_invitation(invitation_id: str, db: Session = Depends(get_db)):
    """Admin: resend the invitation email."""
    inv = _check_invitation(db, invitation_id)
    if not inv.INVITED_EMAIL:
        raise HTTPException(status_code=400, detail="No email address on this invitation")

    import os
    frontend_base = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    registration_url = f"{frontend_base}/supplier-register/{inv.TOKEN}"

    vendor = db.query(Vendor).filter(Vendor.ID == inv.VENDOR_ID).first()
    vendor_name = vendor.VENDOR_NAME if vendor else "ERP"

    html_body = f"""
    <h2>Supplier Registration Reminder</h2>
    <p>This is a reminder to complete your supplier registration for <strong>{vendor_name}</strong>.</p>
    <p><a href="{registration_url}">{registration_url}</a></p>
    """
    ok, msg = send_via_resend(
        subject=f"Reminder: Supplier Registration — {vendor_name}",
        body_html=html_body,
        recipient=inv.INVITED_EMAIL,
    )
    if ok:
        inv.EMAIL_SENT_AT = datetime.utcnow()
        db.commit()
    return {"message": "Email resent" if ok else f"Email failed: {msg}", "ok": ok}


@router.post("/invitations/{invitation_id}/expire")
def expire_invitation(invitation_id: str, db: Session = Depends(get_db)):
    """Admin: manually expire an invitation link."""
    inv = _check_invitation(db, invitation_id)
    if inv.STATUS in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="Cannot expire an already processed invitation")
    inv.STATUS = "EXPIRED"
    inv.EXPIRES_AT = datetime.utcnow()
    db.commit()
    return {"message": "Invitation expired"}


@router.post("/invitations/{invitation_id}/approve")
def approve_invitation(
    invitation_id: str,
    payload: ApprovalRequest,
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
    products_data = draft.PRODUCTS_DATA or []

    # ── 1. Create Supplier row ────────────────────────────────────────
    # Generate a unique supplier code
    existing_count = db.query(Supplier).filter(Supplier.VENDOR_ID == inv.VENDOR_ID).count()
    supplier_code = f"SUP-{inv.VENDOR_ID:02d}-{(existing_count + 1):04d}"

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
        STATUS="ACTIVE",
    )
    db.add(supplier)
    db.flush()   # get supplier.ID without committing

    # ── 2. Create ProductMaster + SupplierProduct rows ────────────────
    for idx, p in enumerate(products_data):
        pname = p.get("product_name", "").strip()
        if not pname:
            continue

        # Generate product code from name
        safe = "".join(c for c in pname.upper() if c.isalnum())[:12]
        prod_code = f"PRD-{inv.VENDOR_ID:02d}-{safe}-{idx + 1:03d}"

        product = ProductMaster(
            VENDOR_ID=inv.VENDOR_ID,
            PRODUCT_CODE=prod_code,
            PRODUCT_NAME=pname,
            DESCRIPTION=p.get("description"),
            UNIT=p.get("unit", "PCS"),
            HSN_CODE=p.get("hsn_code"),
            STATUS="ACTIVE",
        )
        db.add(product)
        db.flush()

        if p.get("unit_price") is not None:
            sp = SupplierProduct(
                VENDOR_ID=inv.VENDOR_ID,
                SUPPLIER_ID=supplier.ID,
                PRODUCT_ID=product.ID,
                UNIT_PRICE=p["unit_price"],
                MOQ=p.get("moq", 1.0),
                AVAILABLE_QTY=p.get("available_qty"),
                LEAD_TIME_DAYS=p.get("lead_time_days", 7),
                STATUS="ACTIVE",
                NOTES=p.get("remarks"),
            )
            db.add(sp)

    # ── 4. Update invitation ──────────────────────────────────────────
    inv.STATUS = "APPROVED"
    inv.SUPPLIER_ID = supplier.ID
    inv.APPROVED_AT = datetime.utcnow()

    # ── 5. Log ────────────────────────────────────────────────────────
    log_entry = SupplierApprovalLog(
        VENDOR_ID=inv.VENDOR_ID,
        INVITATION_ID=inv.ID,
        ACTION="APPROVED",
        REVIEWED_AT=datetime.utcnow(),
        COMMENTS=payload.COMMENTS,
    )
    db.add(log_entry)

    db.commit()

    # Trigger ranking recalculation in background (best-effort)
    try:
        from app.services.supplier_ranking_service import recalculate_ranking_for_supplier
        recalculate_ranking_for_supplier(db, inv.VENDOR_ID, supplier.ID)
    except Exception as exc:
        print(f"[supplier-onboarding] ranking recalc failed (non-fatal): {exc}")

    return {
        "message": "Supplier approved and activated",
        "supplier_id": supplier.ID,
        "supplier_code": supplier_code,
        "products_created": len([p for p in products_data if p.get("product_name")]),
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
    inv.REJECTED_AT = datetime.utcnow()

    log_entry = SupplierApprovalLog(
        VENDOR_ID=inv.VENDOR_ID,
        INVITATION_ID=inv.ID,
        ACTION="REJECTED",
        REVIEWED_AT=datetime.utcnow(),
        REJECTION_REASON=payload.REJECTION_REASON,
        COMMENTS=payload.COMMENTS,
    )
    db.add(log_entry)
    db.commit()

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

    # Build form_data from payload fields
    form_data = {}
    for field in [
        "company_name", "contact_person", "phone", "email",
        "address_line1", "address_line2", "city", "state",
        "pincode", "gst_number", "pan_number", "website",
    ]:
        val = getattr(payload, field, None)
        if val is not None:
            form_data[field] = val

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
        draft.LAST_SAVED_AT = datetime.utcnow()
    else:
        draft = SupplierRegistrationDraft(
            INVITATION_ID=inv.ID,
            FORM_DATA=form_data or None,
            PRODUCTS_DATA=products_data,
            ENTRY_MODE=payload.ENTRY_MODE or "MANUAL",
            VOICE_TRANSCRIPT=payload.VOICE_TRANSCRIPT,
            LAST_SAVED_AT=datetime.utcnow(),
        )
        db.add(draft)

    if inv.STATUS == "OPEN":
        inv.STATUS = "DRAFT_SAVED"

    db.commit()
    return {"message": "Draft saved", "last_saved_at": draft.LAST_SAVED_AT.isoformat()}


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
    inv.SUBMITTED_AT = datetime.utcnow()
    db.commit()

    return {
        "message": "Registration submitted successfully. Our team will review and contact you shortly.",
        "submitted_at": inv.SUBMITTED_AT.isoformat(),
    }
