"""Shared Purchase Order upload handling — the single implementation used
by both the public customer-facing upload endpoint (routes/po_actions.py)
and the authenticated staff upload/re-upload endpoint
(routes/lead_management.py), so "save the file, update the row, flip the
Lead to PO_RECEIVED, fire the staff notification" exists exactly once."""

import logging
import re
import uuid as uuid_lib
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Customer, CustomerProjectQuotation, Employee, Project
from app.models.lead_models import Lead
from app.services.po_notification_service import send_po_upload_notification
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

# Same depth-from-backend-root convention as employee_documents.py's
# _STATIC_DOCS_DIR: backend/app/services/po_service.py -> parent.parent.parent == backend/
_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
_PO_DOCS_DIR = _STATIC_DIR / "purchase-orders"

ALLOWED_PO_EXTENSIONS = {".pdf"}
MAX_PO_BYTES = 15 * 1024 * 1024  # 15 MB


def save_po_file(assignment_id: str, filename: str, content: bytes) -> dict:
    """Streams `content` to static/purchase-orders/{assignment_id}/{uuid}.pdf.
    Returns {file_url, file_name, mime, size_bytes}."""
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", assignment_id)[:64]
    target_dir = _PO_DOCS_DIR / safe_id
    target_dir.mkdir(parents=True, exist_ok=True)

    stored_name = f"{uuid_lib.uuid4().hex}.pdf"
    (target_dir / stored_name).write_bytes(content)

    return {
        "file_url": f"/static/purchase-orders/{safe_id}/{stored_name}",
        "file_name": filename,
        "mime": "application/pdf",
        "size_bytes": len(content),
    }


def read_po_file_bytes(file_url: Optional[str]) -> Optional[bytes]:
    """Best-effort read of an already-saved PO file's bytes off disk, for
    attaching to the staff notification email. Returns None (never raises)
    if the file is missing/unreadable — the notification still sends,
    just without an attachment."""
    if not file_url:
        return None
    try:
        rel = file_url.lstrip("/")
        if rel.startswith("static/"):
            rel = rel[len("static/"):]
        return (_STATIC_DIR / rel).read_bytes()
    except Exception:
        log.exception("read_po_file_bytes: failed to read %s", file_url)
        return None


def resolve_po_quotation_type(db: Session, assignment) -> Optional[str]:
    """Best-effort context for the staff notification: which quotation
    (an APPROVED Revised Quotation preferred, else an APPROVED Final
    Quotation — NOT merely "does a Revised Quotation row exist at all",
    since one is created as soon as it's sent, before the customer ever
    responds) this PO corresponds to. Mirrors the same resolution used by
    send_lead_po_request()/LeadQuotationModal.jsx's poEligibleQuotation."""
    quotations = db.query(CustomerProjectQuotation).filter(
        CustomerProjectQuotation.ASSIGNMENT_ID == assignment.ID,
    ).all()
    by_type = {q.QUOTATION_TYPE: q for q in quotations}
    revised = by_type.get("REVISED_QUOTATION")
    final = by_type.get("FINAL_QUOTATION")
    if revised and revised.QUOTATION_STATUS == "APPROVED":
        return revised.QUOTATION_TYPE
    if final and final.QUOTATION_STATUS == "APPROVED":
        return final.QUOTATION_TYPE
    return None


def apply_po_upload(
    db: Session,
    *,
    po_row,
    assignment,
    filename: str,
    content: bytes,
    comments: Optional[str],
    source: str,  # "CUSTOMER" | "STAFF"
    uploaded_by_employee_id: Optional[str] = None,
) -> dict:
    """Saves the file, updates the CustomerProjectPurchaseOrder row in
    place, flips the Lead to PO_RECEIVED, commits — then best-effort fires
    the staff notification (a notification failure never rolls back the
    already-committed upload, mirroring quotation_actions.py's own
    "never undo a committed action over an email failure" pattern).
    Returns {action_label, file_name, uploaded_at}."""
    saved = save_po_file(assignment.ID, filename, content)

    is_reupload = (po_row.UPLOAD_COUNT or 0) > 0
    po_row.FILE_URL = saved["file_url"]
    po_row.FILE_NAME = saved["file_name"]
    po_row.MIME = saved["mime"]
    po_row.SIZE_BYTES = saved["size_bytes"]
    if comments is not None:
        po_row.COMMENTS = comments
    po_row.UPLOADED_AT = now_ist()
    po_row.UPLOAD_COUNT = (po_row.UPLOAD_COUNT or 0) + 1
    po_row.UPLOADED_BY_SOURCE = source
    po_row.UPLOADED_BY_EMPLOYEE_ID = uploaded_by_employee_id

    lead = None
    if assignment.LEAD_ID:
        lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first()
        if lead:
            lead.LEAD_STATUS = "PO_RECEIVED"

    db.commit()
    db.refresh(po_row)

    action_label = "Reuploaded" if is_reupload else "Uploaded"

    try:
        customer = db.query(Customer).filter(Customer.ID == assignment.CUSTOMER_ID).first()
        project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first()
        if customer and project:
            uploaded_by_label = "the customer"
            if source == "STAFF":
                emp = (
                    db.query(Employee).filter(Employee.ID == uploaded_by_employee_id).first()
                    if uploaded_by_employee_id else None
                )
                uploaded_by_label = f"{emp.NAME} (staff)" if emp else "a staff member"
            send_po_upload_notification(
                db, vendor_id=assignment.VENDOR_ID, po_row=po_row, assignment=assignment,
                customer=customer, project=project, lead=lead,
                quotation_type=resolve_po_quotation_type(db, assignment),
                action_label=action_label, uploaded_by_label=uploaded_by_label,
            )
    except Exception:
        log.exception("apply_po_upload: staff notification failed for assignment %s", assignment.ID)

    return {"action_label": action_label, "file_name": saved["file_name"], "uploaded_at": po_row.UPLOADED_AT}
