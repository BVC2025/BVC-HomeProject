"""Email Template Management API.

Endpoints:
  GET  /email-templates                    List all template types (auto-seeds missing ones)
  GET  /email-templates/{template_type}    Full template (HTML + design_json)
  PUT  /email-templates/{template_type}    Update subject + body_html + design_json
  POST /email-templates/preview            Render preview with sample variable substitution
"""

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.email_models import EmailTemplate
from app.services.company_settings_service import get_company_settings
from app.services.email_template_service import (
    TEMPLATE_CATALOG,
    seed_all_templates,
    get_or_create_template,
    render_template,
)

from app.auth.auth_bearer import require

router = APIRouter()

_SAMPLE_VARIABLES = {
    "company_name":        "Bharath Vending Corporation",
    "invited_company":     "Acme Suppliers Pvt. Ltd.",
    "supplier_company_name": "Acme Suppliers Pvt. Ltd.",
    "supplier_name":       "John Doe",
    "registration_link":   "https://erp.bvc24.in/supplier-register/sample-token",
    "expires_at":          "31 December 2025",
    "approved_at":         "11 July 2026",
    "rejected_at":         "11 July 2026",
    "rejection_reason":    "Documentation could not be verified.",
    "support_email":       "support@bvc24.in",
    "company_address":     "Plot No. 14, Industrial Estate, Chennai, Tamil Nadu 600032",
    "contact_number":      "+91 90000 12345",
    "website":             "www.bvc24.in",
    "logo_html":           "",  # cleared so preview doesn't show raw placeholder
}


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class TemplateUpdate(BaseModel):
    SUBJECT:     str
    BODY_HTML:   str
    DESIGN_JSON: Optional[str] = None


class PreviewRequest(BaseModel):
    TEMPLATE_TYPE: str
    BODY_HTML:     Optional[str] = None
    SUBJECT:       Optional[str] = None
    variables:     Optional[dict] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize_list(tmpl: EmailTemplate) -> dict:
    return {
        "TEMPLATE_TYPE": tmpl.TEMPLATE_TYPE,
        "DISPLAY_NAME":  tmpl.DISPLAY_NAME,
        "SUBJECT":       tmpl.SUBJECT,
        "UPDATED_AT":    tmpl.UPDATED_AT.isoformat() if tmpl.UPDATED_AT else None,
    }


def _serialize_full(tmpl: EmailTemplate) -> dict:
    return {
        "ID":            tmpl.ID,
        "VENDOR_ID":     tmpl.VENDOR_ID,
        "TEMPLATE_TYPE": tmpl.TEMPLATE_TYPE,
        "DISPLAY_NAME":  tmpl.DISPLAY_NAME,
        "SUBJECT":       tmpl.SUBJECT,
        "BODY_HTML":     tmpl.BODY_HTML,
        "DESIGN_JSON":   tmpl.DESIGN_JSON,
        "CREATED_AT":    tmpl.CREATED_AT.isoformat() if tmpl.CREATED_AT else None,
        "UPDATED_AT":    tmpl.UPDATED_AT.isoformat() if tmpl.UPDATED_AT else None,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_editor_logo_html(db: Session, vendor_id: int) -> str:
    """Build an <img> tag for the template editor (uses an HTTP URL, not CID)."""
    try:
        company = get_company_settings(db, vendor_id)
        if not company or not company.LOGO_URL:
            return ""
        backend_base = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
        logo_url = (
            company.LOGO_URL
            if company.LOGO_URL.startswith("http")
            else f"{backend_base}{company.LOGO_URL}"
        )
        alt = company.LEGAL_NAME or "Logo"
        return (
            f'<img src="{logo_url}" alt="{alt}"'
            f' style="max-height:70px;max-width:200px;display:block;margin:0 auto 12px;" />'
        )
    except Exception:
        return ""


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/email-templates", dependencies=[Depends(require("setting.modify"))])
def list_email_templates(
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """List all template types for a vendor. Auto-seeds any catalog entries that are missing."""
    templates = seed_all_templates(db, vendor_id)
    return [_serialize_list(t) for t in templates]


@router.get("/email-templates/{template_type}", dependencies=[Depends(require("setting.modify"))])
def get_email_template(
    template_type: str,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """Get the full template (including HTML body and design JSON) by type."""
    tmpl = get_or_create_template(db, vendor_id, template_type.upper())
    if not tmpl:
        raise HTTPException(
            status_code=404,
            detail=f"Template type '{template_type}' is not in the template catalog.",
        )
    result = _serialize_full(tmpl)
    # Pre-substitute {{logo_html}} for the editor display so the logo appears
    # in the template editor. The DB record is unchanged — the placeholder is
    # preserved for re-seeding detection and actual email rendering.
    if result.get("BODY_HTML") and "{{logo_html}}" in result["BODY_HTML"]:
        result["BODY_HTML"] = result["BODY_HTML"].replace(
            "{{logo_html}}", _get_editor_logo_html(db, vendor_id)
        )
    return result


@router.put("/email-templates/{template_type}", dependencies=[Depends(require("setting.modify"))])
def update_email_template(
    template_type: str,
    data: TemplateUpdate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """Update the subject, HTML body, and optional Unlayer design JSON for a template."""
    tmpl = get_or_create_template(db, vendor_id, template_type.upper())
    if not tmpl:
        raise HTTPException(
            status_code=404,
            detail=f"Template type '{template_type}' is not in the template catalog.",
        )
    tmpl.SUBJECT     = data.SUBJECT.strip()
    tmpl.BODY_HTML   = data.BODY_HTML
    tmpl.DESIGN_JSON = data.DESIGN_JSON
    db.commit()
    db.refresh(tmpl)
    return {"message": "Template updated", **_serialize_full(tmpl)}


@router.post("/email-templates/preview", dependencies=[Depends(require("setting.modify"))])
def preview_email_template(
    data: PreviewRequest,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
):
    """Render a template preview with sample variable substitution.

    If BODY_HTML is provided in the request, that HTML is used directly
    (editor live-preview mode). Otherwise the stored template is fetched.
    """
    if data.BODY_HTML:
        html    = data.BODY_HTML
        subject = data.SUBJECT or ""
    else:
        tmpl = get_or_create_template(db, vendor_id, data.TEMPLATE_TYPE.upper())
        if not tmpl:
            raise HTTPException(status_code=404, detail="Template not found")
        html    = tmpl.BODY_HTML
        subject = tmpl.SUBJECT

    variables = {**_SAMPLE_VARIABLES, **(data.variables or {})}
    rendered_subject, rendered_html = render_template(html, subject, variables)
    return {"subject": rendered_subject, "html": rendered_html}
