"""
Admin routes — document upload / list / delete.

  POST   /hrms-ai/documents          upload a new document (admin only)
  GET    /hrms-ai/documents          list every active document
  GET    /hrms-ai/documents/{id}     one document's metadata
  DELETE /hrms-ai/documents/{id}     soft-delete (admin only)

The GET endpoints are open to every authenticated user (admins AND
employees — both need to see what's in the shared library so they
can pick which doc to chat with in Phase B).

The POST + DELETE endpoints are gated to admin roles per the earlier
RBAC decision. `ADMIN_ROLES` comes from app.auth.auth_bearer and
already includes ADMIN / SUPER_ADMIN / HR_MANAGER / MANAGING_DIRECTOR
and friends, so no bespoke role list is duplicated here.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth.auth_bearer import ADMIN_ROLES, get_current_user
from app.database.database import get_db

from app.hrms_ai.document_extractor import extract, sniff_mime
from app.hrms_ai.document_store import (
    create_document_row,
    get_document,
    list_documents,
    relative_storage_path,
    serialize_document,
    soft_delete_document,
    update_extraction_result,
    write_uploaded_file,
)


log = logging.getLogger("hrms_ai.admin_routes")


router = APIRouter(prefix="/hrms-ai", tags=["HRMS AI Documents"])


# =====================================================================
# Config
# =====================================================================

# Cap uploads to something sensible for HR docs. Bump if you hit it
# (also bump uvicorn's client_max_body_size on nginx / Caddy if you
# reverse-proxy).
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024   # 25 MB
_ALLOWED_EXTS = {
    ".pdf", ".docx", ".txt", ".md", ".log", ".csv",
    ".xlsx", ".xlsm",
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff",
}


# =====================================================================
# Auth helper
# =====================================================================

def _require_admin(payload: dict) -> None:
    """Any role in ADMIN_ROLES may pass. Employees get 403."""

    role = (payload.get("role") or "").upper()
    if role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Admin access required to manage HRMS AI documents.",
        )


# =====================================================================
# Upload
# =====================================================================

@router.post("/documents")
async def upload_document(
    file:  UploadFile = File(...),
    title: Optional[str] = Form(None),
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Accept a single file, persist raw bytes to disk, extract text +
    tables, store metadata. Returns the fresh document row."""

    _require_admin(payload)

    vendor_id      = payload.get("vendor_id") or 1
    uploaded_by_id = payload.get("employee_id")

    filename = (file.filename or "document").strip()
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED_EXTS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type '{ext}'. Allowed: "
                f"{', '.join(sorted(_ALLOWED_EXTS))}"
            ),
        )

    # Read fully into memory so we can size-check before touching disk.
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Limit: {_MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )

    mime = sniff_mime(filename, file.content_type)

    # 1. Create the DB row so we have an ID to name the file with.
    row = create_document_row(
        db,
        vendor_id=vendor_id,
        uploaded_by_id=uploaded_by_id,
        title=(title or filename)[:255],
        original_filename=filename,
        mime_type=mime,
        size_bytes=len(content),
    )

    # 2. Persist raw bytes under uploads/{id}_...
    try:
        stored_at = write_uploaded_file(row.ID, filename, content)
    except Exception as e:
        log.exception("Failed to write upload for doc %s", row.ID)
        row.EXTRACTION_ERROR = f"Storage write failed: {e}"
        db.commit()
        raise HTTPException(status_code=500, detail="Could not persist the uploaded file.")

    row.STORAGE_PATH = relative_storage_path(stored_at)
    db.commit()

    # 3. Extract text + tables. Extractor never raises.
    result = extract(stored_at, mime)

    row = update_extraction_result(
        db,
        row,
        page_count=result.get("page_count"),
        text=result.get("text") or "",
        tables=result.get("tables") or [],
        has_images=bool(result.get("has_images")),
        ocr_applied=bool(result.get("ocr_applied")),
        extraction_error=result.get("error"),
    )

    return {
        "message":  "Document uploaded.",
        "document": serialize_document(row),
    }


# =====================================================================
# List
# =====================================================================

@router.get("/documents")
def list_docs(
    include_inactive: bool = False,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Both admins and employees can list. Employees see is_active=1
    only; admins can toggle include_inactive to see soft-deleted rows."""

    vendor_id = payload.get("vendor_id") or 1
    role      = (payload.get("role") or "").upper()
    is_admin  = role in ADMIN_ROLES

    rows = list_documents(
        db,
        vendor_id=vendor_id,
        include_inactive=bool(include_inactive) if is_admin else False,
    )
    return {"documents": [serialize_document(r) for r in rows]}


# =====================================================================
# Single doc
# =====================================================================

@router.get("/documents/{doc_id}")
def get_doc(
    doc_id: int,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    vendor_id = payload.get("vendor_id") or 1
    row = get_document(db, doc_id=doc_id, vendor_id=vendor_id)
    if not row or not row.IS_ACTIVE:
        raise HTTPException(status_code=404, detail="Document not found.")
    return {"document": serialize_document(row)}


# =====================================================================
# Delete
# =====================================================================

@router.delete("/documents/{doc_id}")
def delete_doc(
    doc_id: int,
    payload: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(payload)

    vendor_id = payload.get("vendor_id") or 1
    row = soft_delete_document(db, doc_id=doc_id, vendor_id=vendor_id)
    if not row:
        raise HTTPException(status_code=404, detail="Document not found.")

    return {"message": "Document removed.", "document": serialize_document(row)}
