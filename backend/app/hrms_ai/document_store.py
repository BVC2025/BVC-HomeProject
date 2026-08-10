"""
Document store — models + CRUD helpers for admin-uploaded documents.

Admins upload PDF / DOCX / TXT / MD / XLSX (or images that get OCR'd).
Each upload:
  - the raw file is saved under backend/app/hrms_ai/uploads/{doc_id}_...
  - extracted plain text goes to backend/app/hrms_ai/extracted/{doc_id}.txt
  - a metadata row lands in hrms_ai_document
  - detected tables (if any) land in hrms_ai_document_table

Both tables are Vendor-scoped so nothing crosses tenants. Employees
have read-only access to the LIST + chat surface; only admins can
create / delete rows here.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Session

from app.database.database import Base


# =====================================================================
# Filesystem layout
# =====================================================================
# The upload / extract folders live inside the hrms_ai module so they
# ship with the code (created on demand). Keep them small — a document
# corpus larger than a few hundred MB should move to object storage.

_HERE = Path(__file__).resolve().parent
UPLOAD_DIR    = _HERE / "uploads"
EXTRACTED_DIR = _HERE / "extracted"
INDEX_DIR     = _HERE / "indexes"

for _d in (UPLOAD_DIR, EXTRACTED_DIR, INDEX_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def _slug(name: str) -> str:
    """Sanitise a filename so it's safe to write to disk. Strips path
    separators, collapses whitespace, keeps only alphanumerics + dot +
    dash + underscore."""

    base = (name or "document").strip()
    base = re.sub(r"[^\w.\-]+", "_", base)
    return base[:120] or "document"


# =====================================================================
# Models — auto-created by Base.metadata.create_all in main.py.
# =====================================================================
# main.py imports these before calling create_all so SQLAlchemy sees
# the tables. The wiring line lives with the existing HrmsAiConversation
# import.

class HrmsAiDocument(Base):
    """One row per admin-uploaded document."""

    __tablename__ = "hrms_ai_document"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    VENDOR_ID = Column(
        Integer,
        ForeignKey("vendor.ID"),
        nullable=False,
        index=True,
    )
    UPLOADED_BY_ID = Column(
        String(36),
        ForeignKey("employee.ID"),
        nullable=True,
    )

    TITLE             = Column(String(255), nullable=False)
    ORIGINAL_FILENAME = Column(String(255), nullable=False)
    MIME_TYPE         = Column(String(120), nullable=True)
    SIZE_BYTES        = Column(Integer, nullable=True)

    # Extraction outputs
    PAGE_COUNT         = Column(Integer, nullable=True)
    EXTRACTED_TEXT_LEN = Column(Integer, nullable=True)
    TABLE_COUNT        = Column(Integer, default=0, nullable=False)
    HAS_IMAGES         = Column(Integer, default=0, nullable=False)   # bool 0/1
    OCR_APPLIED        = Column(Integer, default=0, nullable=False)   # bool 0/1
    EXTRACTION_ERROR   = Column(Text, nullable=True)

    # Disk paths — relative to project root
    STORAGE_PATH = Column(String(500), nullable=True)  # raw uploaded file
    TEXT_PATH    = Column(String(500), nullable=True)  # extracted plain text
    INDEX_PATH   = Column(String(500), nullable=True)  # embedding index (Phase B)

    IS_ACTIVE = Column(Integer, default=1, nullable=False, index=True)

    CREATED_AT = Column(DateTime, default=datetime.now, index=True)
    UPDATED_AT = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class HrmsAiDocumentTable(Base):
    """Zero-or-more numeric tables detected inside an uploaded document.
    Rows/columns are stored as JSON strings — good enough for the
    modest table sizes in HR docs (rosters, salary tables, holiday
    calendars). If we ever load 100k-row Excels this needs a rethink.
    """

    __tablename__ = "hrms_ai_document_table"

    ID = Column(Integer, primary_key=True, autoincrement=True, index=True)

    DOCUMENT_ID = Column(
        Integer,
        ForeignKey("hrms_ai_document.ID"),
        nullable=False,
        index=True,
    )

    TABLE_INDEX  = Column(Integer, nullable=False)   # order within doc, 0-based
    SHEET_NAME   = Column(String(120), nullable=True)  # for xlsx
    PAGE_NUMBER  = Column(Integer, nullable=True)      # for pdf

    ROW_COUNT    = Column(Integer, nullable=True)
    COL_COUNT    = Column(Integer, nullable=True)
    COLUMNS_JSON = Column(Text, nullable=True)         # ["Name","Dept",...]
    ROWS_JSON    = Column(Text, nullable=True)         # [["Puvi","Dev"],...]

    CREATED_AT   = Column(DateTime, default=datetime.now)


# =====================================================================
# Serialization
# =====================================================================

def serialize_document(row: HrmsAiDocument) -> dict:
    return {
        "id":                 row.ID,
        "vendor_id":          row.VENDOR_ID,
        "uploaded_by_id":     row.UPLOADED_BY_ID,
        "title":              row.TITLE,
        "original_filename":  row.ORIGINAL_FILENAME,
        "mime_type":          row.MIME_TYPE,
        "size_bytes":         row.SIZE_BYTES,
        "page_count":         row.PAGE_COUNT,
        "extracted_text_len": row.EXTRACTED_TEXT_LEN,
        "table_count":        row.TABLE_COUNT,
        "has_images":         bool(row.HAS_IMAGES),
        "ocr_applied":        bool(row.OCR_APPLIED),
        "extraction_error":   row.EXTRACTION_ERROR,
        "is_active":          bool(row.IS_ACTIVE),
        "created_at":         row.CREATED_AT.isoformat() if row.CREATED_AT else None,
        "updated_at":         row.UPDATED_AT.isoformat() if row.UPDATED_AT else None,
    }


# =====================================================================
# CRUD
# =====================================================================

def create_document_row(
    db: Session,
    *,
    vendor_id: int,
    uploaded_by_id: Optional[str],
    title: str,
    original_filename: str,
    mime_type: Optional[str],
    size_bytes: Optional[int],
    storage_path: Optional[str] = None,
) -> HrmsAiDocument:
    row = HrmsAiDocument(
        VENDOR_ID=vendor_id,
        UPLOADED_BY_ID=uploaded_by_id,
        TITLE=(title or original_filename)[:255],
        ORIGINAL_FILENAME=original_filename[:255],
        MIME_TYPE=(mime_type or "")[:120] or None,
        SIZE_BYTES=size_bytes,
        STORAGE_PATH=storage_path,
        IS_ACTIVE=1,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_extraction_result(
    db: Session,
    row: HrmsAiDocument,
    *,
    page_count: Optional[int],
    text: str,
    tables: Iterable[dict],
    has_images: bool,
    ocr_applied: bool,
    extraction_error: Optional[str] = None,
) -> HrmsAiDocument:
    """Persist the outputs of document_extractor.extract() to disk +
    DB. Extracted text goes to a file (avoid TEXT-column bloat on
    long docs); table rows land in hrms_ai_document_table."""

    row.PAGE_COUNT = page_count
    row.EXTRACTED_TEXT_LEN = len(text or "")
    row.HAS_IMAGES = 1 if has_images else 0
    row.OCR_APPLIED = 1 if ocr_applied else 0
    row.EXTRACTION_ERROR = (extraction_error or None)

    # Write the extracted text to disk. Filename ties back to the row
    # ID so a stale text file can't leak into a different doc.
    text_path = EXTRACTED_DIR / f"{row.ID}.txt"
    try:
        text_path.write_text(text or "", encoding="utf-8")
        row.TEXT_PATH = str(text_path.relative_to(_HERE.parent.parent.parent))
    except Exception as e:
        row.EXTRACTION_ERROR = (extraction_error or "") + f" | text-write: {e}"

    # Persist tables
    tables_list = list(tables or [])
    row.TABLE_COUNT = len(tables_list)
    for idx, tbl in enumerate(tables_list):
        rec = HrmsAiDocumentTable(
            DOCUMENT_ID=row.ID,
            TABLE_INDEX=idx,
            SHEET_NAME=tbl.get("sheet"),
            PAGE_NUMBER=tbl.get("page"),
            ROW_COUNT=len(tbl.get("rows") or []),
            COL_COUNT=len(tbl.get("columns") or []),
            COLUMNS_JSON=json.dumps(tbl.get("columns") or [], ensure_ascii=False),
            ROWS_JSON=json.dumps(tbl.get("rows") or [], ensure_ascii=False),
        )
        db.add(rec)

    db.commit()
    db.refresh(row)
    return row


def list_documents(
    db: Session,
    *,
    vendor_id: int,
    include_inactive: bool = False,
) -> List[HrmsAiDocument]:
    q = db.query(HrmsAiDocument).filter(HrmsAiDocument.VENDOR_ID == vendor_id)
    if not include_inactive:
        q = q.filter(HrmsAiDocument.IS_ACTIVE == 1)
    return q.order_by(HrmsAiDocument.CREATED_AT.desc()).all()


def get_document(
    db: Session,
    *,
    doc_id: int,
    vendor_id: int,
) -> Optional[HrmsAiDocument]:
    return (
        db.query(HrmsAiDocument)
        .filter(HrmsAiDocument.ID == doc_id)
        .filter(HrmsAiDocument.VENDOR_ID == vendor_id)
        .first()
    )


def soft_delete_document(
    db: Session,
    *,
    doc_id: int,
    vendor_id: int,
) -> Optional[HrmsAiDocument]:
    """Flip IS_ACTIVE=0 and clean the tables + on-disk files. Leaves
    the metadata row so audits can see who uploaded / deleted what."""

    row = get_document(db, doc_id=doc_id, vendor_id=vendor_id)
    if not row:
        return None

    row.IS_ACTIVE = 0

    # Bulk-delete detected tables — they only make sense with a live doc
    (
        db.query(HrmsAiDocumentTable)
        .filter(HrmsAiDocumentTable.DOCUMENT_ID == row.ID)
        .delete(synchronize_session=False)
    )

    # Best-effort file cleanup — don't fail the API on a filesystem issue
    for path_str in (row.STORAGE_PATH, row.TEXT_PATH, row.INDEX_PATH):
        if not path_str:
            continue
        try:
            p = Path(path_str)
            if not p.is_absolute():
                p = _HERE.parent.parent.parent / p
            if p.exists() and p.is_file():
                p.unlink()
        except Exception:
            pass

    db.commit()
    db.refresh(row)
    return row


# =====================================================================
# Disk write helper
# =====================================================================

def write_uploaded_file(doc_id: int, original_filename: str, content: bytes) -> Path:
    """Persist raw bytes under uploads/. Returns absolute path."""

    safe = _slug(original_filename)
    dest = UPLOAD_DIR / f"{doc_id}_{safe}"
    dest.write_bytes(content)
    return dest


def relative_storage_path(absolute_path: Path) -> str:
    """Return the storage path relative to the project root so the
    same DB rows work if the app is moved to a different install dir."""

    try:
        return str(absolute_path.relative_to(_HERE.parent.parent.parent))
    except ValueError:
        return str(absolute_path)
