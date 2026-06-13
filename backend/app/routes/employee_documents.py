"""HR Module — Phase B: Employee Documents.

Endpoints for uploading, listing, and removing files attached to an
employee (Aadhaar, PAN, Resume, Offer Letter, Certificates, etc.).
Files live on disk under backend/static/employee-docs/<emp_id>/ and
the row in employee_document holds the metadata + public URL."""

from fastapi import (
    APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
)
from sqlalchemy.orm import Session
from pathlib import Path

import shutil
import uuid
import re

from app.database.database import get_db
from app.models.models import Employee, EmployeeDocument
from app.auth.auth_bearer import (
    get_current_admin,
    get_current_user,
    assert_self_or_admin,
    require,
)


router = APIRouter()


# ---- Config ----

DOC_TYPES = {
    # ---- Identity ----
    "AADHAAR",
    "PAN",
    "VOTER_ID",
    "PASSPORT",
    "DRIVING_LICENSE",

    # ---- Education ----
    "TENTH_MARKSHEET",         # 10th / SSLC
    "TWELFTH_MARKSHEET",       # 12th / HSC
    "DIPLOMA",                 # Diploma / ITI
    "DEGREE",                  # Bachelor's (BE / BTech / BSc / BCom etc.)
    "POSTGRADUATE",            # Master's (ME / MTech / MSc / MBA etc.)
    "EDUCATIONAL",             # Other educational (kept for back-compat)
    "CERTIFICATE",             # Professional / technical certificate

    # ---- Employment ----
    "RESUME",
    "OFFER_LETTER",
    "JOINING_LETTER",
    "EXPERIENCE_LETTER",
    "RELIEVING_LETTER",
    "SALARY_SLIP",             # Previous employer payslip

    # ---- Personal / Banking ----
    "PHOTO",
    "BIRTH_CERTIFICATE",
    "MARRIAGE_CERTIFICATE",
    "ADDRESS_PROOF",
    "BANK_PASSBOOK",           # Or cancelled cheque

    # ---- Catch-all ----
    "OTHER",
}

ALLOWED_EXTS = {
    ".pdf",
    ".png", ".jpg", ".jpeg", ".webp",
    ".doc", ".docx",
    ".xls", ".xlsx",
}

# 10 MB per file
MAX_BYTES = 10 * 1024 * 1024

_STATIC_DOCS_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "static" / "employee-docs"
)


# ---- Helpers ----

def _safe_emp_dir(employee_id: str) -> Path:
    """Per-employee folder, created on demand."""

    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", employee_id)[:64]

    p = _STATIC_DOCS_DIR / safe

    p.mkdir(parents=True, exist_ok=True)

    return p


def _serialize(d: EmployeeDocument) -> dict:

    return {
        "ID":             d.ID,
        "EMPLOYEE_ID":    d.EMPLOYEE_ID,
        "DOC_TYPE":       d.DOC_TYPE,
        "TITLE":          d.TITLE,
        "FILE_URL":       d.FILE_URL,
        "FILE_NAME":      d.FILE_NAME,
        "MIME":           d.MIME,
        "SIZE_BYTES":     d.SIZE_BYTES,
        "STATUS":         d.STATUS,
        "NOTES":          d.NOTES,
        "UPLOADED_BY_ID": d.UPLOADED_BY_ID,
        "UPLOADED_AT": (
            d.UPLOADED_AT.isoformat()
            if d.UPLOADED_AT else None
        ),
    }


# ---- Endpoints ----

@router.post(
    "/employees/{employee_id}/documents",
    dependencies=[Depends(require("document.upload"))]
)
def upload_document(
    employee_id: str,
    file: UploadFile = File(...),
    doc_type: str = Form(...),
    title: str = Form(""),
    notes: str = Form(""),
    uploaded_by_id: str = Form(""),
    db: Session = Depends(get_db),
):
    """Upload a single file against an employee.

    Form fields:
      file           — the file itself (multipart)
      doc_type       — required, one of DOC_TYPES
      title          — optional friendly label
      notes          — optional admin note
      uploaded_by_id — optional; admin's employee_id for audit
    """

    emp = db.query(Employee).filter(Employee.ID == employee_id).first()

    if not emp:

        raise HTTPException(status_code=404, detail="Employee not found")

    dt = (doc_type or "").upper().strip()

    if dt not in DOC_TYPES:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid doc_type '{doc_type}'. Allowed: "
                + ", ".join(sorted(DOC_TYPES))
            )
        )

    ext = Path(file.filename or "").suffix.lower()

    if ext not in ALLOWED_EXTS:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{ext}'. Allowed: "
                + ", ".join(sorted(ALLOWED_EXTS))
            )
        )

    target_dir = _safe_emp_dir(employee_id)

    fname = f"{uuid.uuid4().hex}{ext}"

    dest = target_dir / fname

    # Stream-copy to disk, then check size and bail out if oversized.
    with dest.open("wb") as out:

        shutil.copyfileobj(file.file, out)

    size = dest.stat().st_size

    if size > MAX_BYTES:

        try:

            dest.unlink()

        except Exception:

            pass

        raise HTTPException(
            status_code=400,
            detail=(
                f"File too large ({size} bytes). "
                f"Max is {MAX_BYTES} bytes ({MAX_BYTES // (1024*1024)} MB)."
            )
        )

    public_url = f"/static/employee-docs/{target_dir.name}/{fname}"

    doc = EmployeeDocument(
        EMPLOYEE_ID=employee_id,
        DOC_TYPE=dt,
        TITLE=(title.strip() or file.filename or dt.title()),
        FILE_URL=public_url,
        FILE_NAME=file.filename,
        MIME=file.content_type,
        SIZE_BYTES=size,
        NOTES=(notes.strip() or None),
        UPLOADED_BY_ID=(uploaded_by_id.strip() or None),
        STATUS="ACTIVE",
    )

    db.add(doc)

    db.commit()

    db.refresh(doc)

    return {
        "message": "Document uploaded.",
        "document": _serialize(doc),
    }


@router.get("/employees/{employee_id}/documents")
def list_documents(
    employee_id: str,
    doc_type: str = Query(None),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):
    """List every document attached to an employee. Optional
    ?doc_type=AADHAAR filter."""

    assert_self_or_admin(employee_id, payload)

    q = db.query(EmployeeDocument).filter(
        EmployeeDocument.EMPLOYEE_ID == employee_id
    )

    if doc_type:

        q = q.filter(EmployeeDocument.DOC_TYPE == doc_type.upper().strip())

    rows = q.order_by(EmployeeDocument.UPLOADED_AT.desc()).all()

    return [_serialize(r) for r in rows]


@router.get("/employees/{employee_id}/documents/{doc_id}")
def get_document(
    employee_id: str,
    doc_id: int,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    assert_self_or_admin(employee_id, payload)

    doc = db.query(EmployeeDocument).filter(
        EmployeeDocument.ID == doc_id,
        EmployeeDocument.EMPLOYEE_ID == employee_id,
    ).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    return _serialize(doc)


@router.delete(
    "/employees/{employee_id}/documents/{doc_id}",
    dependencies=[Depends(require("document.delete"))]
)
def delete_document(
    employee_id: str,
    doc_id: int,
    db: Session = Depends(get_db),
):
    """Permanently remove a document row + its file on disk."""

    doc = db.query(EmployeeDocument).filter(
        EmployeeDocument.ID == doc_id,
        EmployeeDocument.EMPLOYEE_ID == employee_id,
    ).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    # Best-effort file cleanup
    file_removed = False

    if doc.FILE_URL:

        try:

            rel = doc.FILE_URL.split("/static/", 1)[-1]

            fpath = (
                Path(__file__).resolve().parent.parent.parent
                / "static" / rel
            )

            if fpath.exists() and fpath.is_file():

                fpath.unlink()

                file_removed = True

        except Exception:

            pass

    db.delete(doc)

    db.commit()

    return {
        "message": f"Document {doc_id} deleted.",
        "file_removed": file_removed,
    }
