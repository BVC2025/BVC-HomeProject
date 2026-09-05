"""Delivery Challan / Invoice file handling for InventoryBatch — mirrors
customer_payment_service.py's save_payment_proof_file()/
read_payment_proof_bytes() shape exactly, just scoped to
static/inventory-batches/{batch_id}/ instead of static/payment-proofs/."""

import logging
import re
import uuid as uuid_lib
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
_BATCH_FILES_DIR = _STATIC_DIR / "inventory-batches"

ALLOWED_BATCH_FILE_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx"}
MAX_BATCH_FILE_BYTES = 15 * 1024 * 1024  # 15 MB, matching the payment-proof cap

_MIME_BY_EXT = {
    ".pdf": "application/pdf", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def mime_for_filename(filename: Optional[str]) -> str:
    if not filename or "." not in filename:
        return "application/octet-stream"
    ext = "." + filename.rsplit(".", 1)[-1].lower()
    return _MIME_BY_EXT.get(ext, "application/octet-stream")


def save_batch_file(batch_id: str, kind: str, filename: str, content: bytes) -> str:
    """Streams `content` to static/inventory-batches/{batch_id}/{kind}_{uuid}{ext}.
    Returns the stored /static/... URL (goes straight into DC_FILE_URL /
    INVOICE_FILE_URL — no other schema change needed)."""
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", batch_id)[:64]
    target_dir = _BATCH_FILES_DIR / safe_id
    target_dir.mkdir(parents=True, exist_ok=True)

    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    stored_name = f"{kind}_{uuid_lib.uuid4().hex}{ext}"
    (target_dir / stored_name).write_bytes(content)

    return f"/static/inventory-batches/{safe_id}/{stored_name}"


def read_batch_file_bytes(file_url: Optional[str]) -> Optional[bytes]:
    """Best-effort read of an already-saved DC/Invoice file's bytes off
    disk, for the authenticated file-viewing endpoint. Returns None
    (never raises) if the file is missing/unreadable."""
    if not file_url:
        return None
    try:
        rel = file_url.lstrip("/")
        if rel.startswith("static/"):
            rel = rel[len("static/"):]
        return (_STATIC_DIR / rel).read_bytes()
    except Exception:
        log.exception("read_batch_file_bytes: failed to read %s", file_url)
        return None
