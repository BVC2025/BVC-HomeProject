"""Shared customer payment handling — the single implementation used by
both the optional payment fields on the public Purchase Order upload
endpoint (routes/po_actions.py, source="CUSTOMER") and the authenticated
Accounts manual-entry endpoint (routes/customer_payment.py, source="STAFF"),
so amount/balance validation and percentage calculation exist exactly once.
Mirrors po_service.py's shape (file-save helper + a shared "apply" function
that other routes call after their own request-shape validation)."""

import logging
import re
import uuid as uuid_lib
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import CustomerProjectAssignment, CustomerProjectPayment, CustomerProjectQuotation
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

# Same depth-from-backend-root convention as po_service.py's _PO_DOCS_DIR.
_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
_PAYMENT_PROOFS_DIR = _STATIC_DIR / "payment-proofs"

# Images + PDF + common office docs — broader than po_service.py's PDF-only
# set, mirroring employee_documents.py's ALLOWED_EXTS since a payment proof
# may be a screenshot, a scanned receipt, or a bank-issued PDF/doc.
ALLOWED_PROOF_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx"}
MAX_PROOF_BYTES = 15 * 1024 * 1024  # 15 MB, matching the PO upload cap


def save_payment_proof_file(assignment_id: str, filename: str, content: bytes) -> dict:
    """Streams `content` to static/payment-proofs/{assignment_id}/{uuid}{ext},
    preserving the real extension (unlike po_service.py's hardcoded .pdf).
    Returns {file_url, file_name, mime, size_bytes}."""
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", assignment_id)[:64]
    target_dir = _PAYMENT_PROOFS_DIR / safe_id
    target_dir.mkdir(parents=True, exist_ok=True)

    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    stored_name = f"{uuid_lib.uuid4().hex}{ext}"
    (target_dir / stored_name).write_bytes(content)

    mime_by_ext = {
        ".pdf": "application/pdf", ".png": "image/png",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }

    return {
        "file_url": f"/static/payment-proofs/{safe_id}/{stored_name}",
        "file_name": filename,
        "mime": mime_by_ext.get(ext, "application/octet-stream"),
        "size_bytes": len(content),
    }


def read_payment_proof_bytes(file_url: Optional[str]) -> Optional[bytes]:
    """Best-effort read of an already-saved proof file's bytes off disk,
    for the authenticated proof-viewing endpoint. Returns None (never
    raises) if the file is missing/unreadable."""
    if not file_url:
        return None
    try:
        rel = file_url.lstrip("/")
        if rel.startswith("static/"):
            rel = rel[len("static/"):]
        return (_STATIC_DIR / rel).read_bytes()
    except Exception:
        log.exception("read_payment_proof_bytes: failed to read %s", file_url)
        return None


def get_accepted_quotation(db: Session, assignment) -> Optional[CustomerProjectQuotation]:
    """The quotation the customer actually accepted: an APPROVED Revised
    Quotation if one exists, else an APPROVED Final Quotation, else None.
    Mirrors po_service.py's resolve_po_quotation_type() resolution rule,
    but returns the row itself (needed for QUOTED_PRICE) rather than just
    the type string."""
    quotations = db.query(CustomerProjectQuotation).filter(
        CustomerProjectQuotation.ASSIGNMENT_ID == assignment.ID,
    ).all()
    by_type = {q.QUOTATION_TYPE: q for q in quotations}
    revised = by_type.get("REVISED_QUOTATION")
    final = by_type.get("FINAL_QUOTATION")
    if revised and revised.QUOTATION_STATUS == "APPROVED":
        return revised
    if final and final.QUOTATION_STATUS == "APPROVED":
        return final
    return None


def _quantize_amount(value) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _quantize_percent(value) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def compute_payment_summary(db: Session, assignment, accepted_quotation=None) -> dict:
    """Backend-authoritative totals for one assignment — always a fresh
    SUM(PAYMENT_AMOUNT) query, never a cached/frontend value. `accepted_amount`
    is the TOTAL project value — the accepted quotation's per-unit price
    multiplied by the assignment's QUANTITY (a customer buying 4 units of a
    ₹2,00,000 project owes ₹8,00,000 total, not ₹2,00,000) — never the raw
    quotation price alone once quantity > 1. Returns
    Decimal-free-of-surprises floats-as-strings-safe dict (values are
    Decimal; callers/serializers convert to str/float as needed)."""
    if accepted_quotation is None:
        accepted_quotation = get_accepted_quotation(db, assignment)

    quantity = int(assignment.QUANTITY or 1)
    price_per_unit = Decimal(accepted_quotation.QUOTED_PRICE) if accepted_quotation else Decimal("0")
    accepted_amount = price_per_unit * quantity

    total_paid = db.query(CustomerProjectPayment).filter(
        CustomerProjectPayment.CUSTOMER_PROJECT_ASSIGNMENT_ID == assignment.ID,
    ).all()
    paid_sum = sum((Decimal(p.PAYMENT_AMOUNT) for p in total_paid), Decimal("0"))

    remaining_balance = accepted_amount - paid_sum
    if remaining_balance < 0:
        remaining_balance = Decimal("0")

    if accepted_amount > 0:
        total_paid_percentage = _quantize_percent(paid_sum / accepted_amount * 100)
        remaining_percentage = _quantize_percent(remaining_balance / accepted_amount * 100)
    else:
        total_paid_percentage = Decimal("0.00")
        remaining_percentage = Decimal("0.00")

    return {
        "accepted_amount": accepted_amount,
        "price_per_unit": price_per_unit,
        "quantity": quantity,
        "total_paid": _quantize_amount(paid_sum),
        "remaining_balance": _quantize_amount(remaining_balance),
        "total_paid_percentage": total_paid_percentage,
        "remaining_percentage": remaining_percentage,
        "payment_count": len(total_paid),
    }


def record_payment(
    db: Session,
    *,
    assignment,
    amount,
    payment_date=None,
    reference_number: Optional[str],
    comments: Optional[str],
    source: str,  # "CUSTOMER" | "STAFF"
    employee_id: Optional[str] = None,
    proof_filename: Optional[str] = None,
    proof_content: Optional[bytes] = None,
) -> CustomerProjectPayment:
    """The single shared entry point for recording a customer payment —
    used by both the public PO-upload-time mandatory capture and the
    authenticated Accounts manual-entry endpoint. Validates amount > 0 and
    amount <= remaining balance against the accepted quotation, computes
    PAYMENT_PERCENTAGE server-side, saves the proof file if provided, and
    commits inside one locked transaction so two near-simultaneous
    submissions (double-click, retry) can never together overspend the
    accepted quotation amount.

    `payment_date` is optional — omitted (or None) defaults to now_ist(),
    the current IST date/time at the moment of submission (the public
    PO-upload flow never asks the customer to pick one). When provided as a
    string (Accounts' manual-entry date/time picker), it's parsed via
    datetime.fromisoformat() — the same naive-IST convention now_ist()
    itself uses, so no timezone math is needed."""
    try:
        amount = _quantize_amount(amount)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payment amount.")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")

    if payment_date is None:
        payment_date = now_ist()
    elif isinstance(payment_date, str):
        try:
            payment_date = datetime.fromisoformat(payment_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid payment date.")

    # Row-level lock on the assignment for the duration of this transaction —
    # a concurrent record_payment() call for the same assignment blocks here
    # until this one commits, so the remaining-balance check below is always
    # against the latest committed total (closes the double-submit/retry race).
    locked_assignment = (
        db.query(CustomerProjectAssignment)
        .filter(CustomerProjectAssignment.ID == assignment.ID)
        .with_for_update()
        .first()
    )
    if not locked_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found.")

    accepted_quotation = get_accepted_quotation(db, locked_assignment)
    if not accepted_quotation:
        raise HTTPException(
            status_code=400,
            detail="No accepted quotation exists for this assignment — a payment cannot be recorded yet.",
        )

    summary = compute_payment_summary(db, locked_assignment, accepted_quotation=accepted_quotation)
    if amount > summary["remaining_balance"]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Payment amount exceeds the remaining balance "
                f"({summary['remaining_balance']} left of {summary['accepted_amount']})."
            ),
        )

    accepted_amount = summary["accepted_amount"]
    percentage = _quantize_percent(amount / accepted_amount * 100) if accepted_amount > 0 else Decimal("0.00")

    payment = CustomerProjectPayment(
        VENDOR_ID=locked_assignment.VENDOR_ID,
        CUSTOMER_PROJECT_ASSIGNMENT_ID=locked_assignment.ID,
        PAYMENT_AMOUNT=amount,
        PAYMENT_PERCENTAGE=percentage,
        PAYMENT_DATE=payment_date,
        PAYMENT_REFERENCE_NUMBER=(reference_number.strip() if reference_number and reference_number.strip() else None),
        PAYMENT_STATUS="RECORDED",
        COMMENTS=(comments.strip() if comments and comments.strip() else None),
        RECORDED_BY_SOURCE=source,
        RECORDED_BY_EMPLOYEE_ID=employee_id,
    )

    if proof_filename and proof_content:
        saved = save_payment_proof_file(locked_assignment.ID, proof_filename, proof_content)
        payment.FILE_URL = saved["file_url"]
        payment.FILE_NAME = saved["file_name"]
        payment.MIME = saved["mime"]
        payment.SIZE_BYTES = saved["size_bytes"]

    db.add(payment)
    db.commit()
    db.refresh(payment)

    # Re-evaluate configured Payment Milestones now that the totals this
    # payment feeds into (compute_payment_summary) have changed — may
    # complete an outstanding milestone and resume a HELD assignment. Local
    # import avoids a service/service import cycle at module load time
    # (payment_milestone_service imports compute_payment_summary from here).
    from app.services.payment_milestone_service import evaluate_milestones_for_assignment
    evaluate_milestones_for_assignment(db, locked_assignment)
    db.commit()

    return payment


def update_payment_record(
    db: Session,
    *,
    payment: CustomerProjectPayment,
    amount=None,
    payment_date=None,
    reference_number: Optional[str] = None,
    comments: Optional[str] = None,
    proof_filename: Optional[str] = None,
    proof_content: Optional[bytes] = None,
) -> CustomerProjectPayment:
    """Full-field edit of an existing payment record — Amount, Payment
    Date/Time, Reference Number, Comments, and (optionally) replacing the
    Payment Proof file. Mirrors record_payment()'s row-lock + validation
    shape: locks the owning assignment, re-validates the new amount against
    the remaining balance EXCLUDING this payment's own current amount (so
    editing a payment doesn't collide with itself), and recomputes
    PAYMENT_PERCENTAGE from the new amount so it's never left stale/
    inconsistent with an edited amount. Fields left as None are unchanged
    (a PATCH-like partial update, matching the endpoint's existing
    reference/comments semantics)."""
    locked_assignment = (
        db.query(CustomerProjectAssignment)
        .filter(CustomerProjectAssignment.ID == payment.CUSTOMER_PROJECT_ASSIGNMENT_ID)
        .with_for_update()
        .first()
    )
    if not locked_assignment:
        raise HTTPException(status_code=404, detail="Assignment not found.")

    accepted_quotation = get_accepted_quotation(db, locked_assignment)
    if not accepted_quotation:
        raise HTTPException(status_code=400, detail="No accepted quotation exists for this assignment.")

    new_amount = Decimal(payment.PAYMENT_AMOUNT)
    if amount is not None:
        try:
            new_amount = _quantize_amount(amount)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid payment amount.")
        if new_amount <= 0:
            raise HTTPException(status_code=400, detail="Payment amount must be greater than zero.")

    other_payments = db.query(CustomerProjectPayment).filter(
        CustomerProjectPayment.CUSTOMER_PROJECT_ASSIGNMENT_ID == locked_assignment.ID,
        CustomerProjectPayment.ID != payment.ID,
    ).all()
    other_paid_sum = sum((Decimal(p.PAYMENT_AMOUNT) for p in other_payments), Decimal("0"))

    quantity = int(locked_assignment.QUANTITY or 1)
    accepted_amount = Decimal(accepted_quotation.QUOTED_PRICE) * quantity
    remaining_excluding_this = accepted_amount - other_paid_sum
    if remaining_excluding_this < 0:
        remaining_excluding_this = Decimal("0")

    if new_amount > remaining_excluding_this:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Payment amount exceeds the remaining balance "
                f"({remaining_excluding_this} left of {accepted_amount})."
            ),
        )

    payment.PAYMENT_AMOUNT = new_amount
    payment.PAYMENT_PERCENTAGE = (
        _quantize_percent(new_amount / accepted_amount * 100) if accepted_amount > 0 else Decimal("0.00")
    )

    if payment_date is not None:
        if isinstance(payment_date, str):
            try:
                payment_date = datetime.fromisoformat(payment_date)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid payment date.")
        payment.PAYMENT_DATE = payment_date

    if reference_number is not None:
        payment.PAYMENT_REFERENCE_NUMBER = reference_number.strip() or None
    if comments is not None:
        payment.COMMENTS = comments.strip() or None

    if proof_filename and proof_content:
        saved = save_payment_proof_file(locked_assignment.ID, proof_filename, proof_content)
        payment.FILE_URL = saved["file_url"]
        payment.FILE_NAME = saved["file_name"]
        payment.MIME = saved["mime"]
        payment.SIZE_BYTES = saved["size_bytes"]

    db.commit()
    db.refresh(payment)

    # Same re-evaluation as record_payment() — editing a payment's amount
    # changes the totals a milestone's eligibility is computed from.
    from app.services.payment_milestone_service import evaluate_milestones_for_assignment
    evaluate_milestones_for_assignment(db, locked_assignment)
    db.commit()

    return payment
