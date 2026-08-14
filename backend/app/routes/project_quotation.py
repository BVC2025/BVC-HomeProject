import json
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Project, ProjectQuotationTemplate
from app.schemas.project_quotation_schema import ProjectQuotationUpdate
from app.services.company_settings_service import get_company_settings
from app.services.project_quotation_service import (
    build_default_quotation_content,
    default_quotation_number,
    render_quotation_html,
    render_quotation_pdf_bytes,
    render_quotation_docx_bytes,
)
from app.utils.datetime_utils import now_ist
from app.utils.db_error_handler import raise_db_error
from app.auth.auth_bearer import require

router = APIRouter()

_ALLOWED_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg"}
_QUOTATION_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "quotation"


def _get_project_or_404(db: Session, project_id: str) -> Project:
    project = db.query(Project).filter(Project.ID == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _serialize(row: ProjectQuotationTemplate) -> dict:
    return {
        "ID": row.ID,
        "PROJECT_ID": row.PROJECT_ID,
        "VENDOR_ID": row.VENDOR_ID,
        "QUOTATION_NUMBER": row.QUOTATION_NUMBER,
        "QUOTATION_DATE": row.QUOTATION_DATE.isoformat() if row.QUOTATION_DATE else None,
        "CONTENT_JSON": json.loads(row.CONTENT_JSON) if row.CONTENT_JSON else {},
        "RENDERED_HTML": row.RENDERED_HTML,
        "CREATED_AT": row.CREATED_AT.isoformat() if row.CREATED_AT else None,
        "UPDATED_AT": row.UPDATED_AT.isoformat() if row.UPDATED_AT else None,
    }


def _get_or_create_quotation(db: Session, project_id: str) -> ProjectQuotationTemplate:
    """Self-healing: if a project predates this feature (or its row was
    somehow lost), auto-create it here instead of requiring a backfill
    migration."""
    project = _get_project_or_404(db, project_id)
    row = db.query(ProjectQuotationTemplate).filter(
        ProjectQuotationTemplate.PROJECT_ID == project_id
    ).first()
    if row:
        return row

    company = get_company_settings(db, project.VENDOR_ID)
    content = build_default_quotation_content(project, company)
    row = ProjectQuotationTemplate(
        PROJECT_ID=project.ID,
        VENDOR_ID=project.VENDOR_ID,
        QUOTATION_NUMBER=default_quotation_number(project, company, now_ist().date()),
        QUOTATION_DATE=now_ist().date(),
        CONTENT_JSON=json.dumps(content),
    )
    row.RENDERED_HTML = render_quotation_html(row, company)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/projects/{project_id}/quotation", dependencies=[Depends(require("project.view", "project.quotations.view"))])
def get_project_quotation(project_id: str, db: Session = Depends(get_db)):
    row = _get_or_create_quotation(db, project_id)
    return _serialize(row)


@router.put("/projects/{project_id}/quotation", dependencies=[Depends(require("project.update", "project.quotations.update"))])
def update_project_quotation(project_id: str, data: ProjectQuotationUpdate, db: Session = Depends(get_db)):
    row = _get_or_create_quotation(db, project_id)

    if data.QUOTATION_NUMBER is not None:
        row.QUOTATION_NUMBER = data.QUOTATION_NUMBER.strip()
    if data.QUOTATION_DATE is not None:
        row.QUOTATION_DATE = data.QUOTATION_DATE
    if data.CONTENT_JSON is not None:
        row.CONTENT_JSON = json.dumps(data.CONTENT_JSON)

    project = _get_project_or_404(db, project_id)
    company = get_company_settings(db, project.VENDOR_ID)
    row.RENDERED_HTML = render_quotation_html(row, company)

    try:
        db.commit()
        db.refresh(row)
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "update project quotation")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "update project quotation")

    return _serialize(row)


@router.get("/projects/{project_id}/quotation/pdf", dependencies=[Depends(require("project.view", "project.quotations.view", "project.quotations.export"))])
def download_project_quotation_pdf(
    project_id: str, db: Session = Depends(get_db),
    filename: Optional[str] = Query(None, description="Override the downloaded file's name (e.g. a customer-friendly name); defaults to the quotation number"),
):
    row = _get_or_create_quotation(db, project_id)
    project = _get_project_or_404(db, project_id)
    company = get_company_settings(db, project.VENDOR_ID)
    html = row.RENDERED_HTML or render_quotation_html(row, company)

    pdf_bytes, error = render_quotation_pdf_bytes(html)
    if pdf_bytes is None:
        raise HTTPException(status_code=500, detail=f"Failed to generate PDF: {error}")

    filename = f"{filename.strip()}.pdf" if filename and filename.strip() else f"{row.QUOTATION_NUMBER.replace('/', '-')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/projects/{project_id}/quotation/docx", dependencies=[Depends(require("project.view", "project.quotations.view", "project.quotations.export"))])
def download_project_quotation_docx(project_id: str, db: Session = Depends(get_db)):
    row = _get_or_create_quotation(db, project_id)
    project = _get_project_or_404(db, project_id)
    company = get_company_settings(db, project.VENDOR_ID)

    docx_bytes = render_quotation_docx_bytes(row, company)
    if docx_bytes is None:
        raise HTTPException(status_code=500, detail="Failed to generate Word document")

    filename = f"{row.QUOTATION_NUMBER.replace('/', '-')}.docx"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/projects/{project_id}/quotation/upload-image", dependencies=[Depends(require("project.update", "project.quotations.update"))])
def upload_project_quotation_image(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    _get_project_or_404(db, project_id)

    ext = Path(file.filename or "").suffix.lower()
    if ext not in _ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image extension '{ext}'. Allowed: " + ", ".join(sorted(_ALLOWED_IMAGE_EXTS)),
        )

    _QUOTATION_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"pqt-{project_id[:8]}-{uuid.uuid4().hex[:8]}{ext}"
    dest = _QUOTATION_DIR / fname
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    return {"url": f"/static/quotation/{fname}"}
