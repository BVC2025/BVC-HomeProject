"""Public, unauthenticated Purchase Order upload endpoints for a customer
following the "Upload Purchase Order" link in the Purchase Order Request
email — the opaque UPLOAD_TOKEN IS the secret, no JWT, mirroring
quotation_actions.py's/employee_onboarding.py's same public-token
convention. Unlike quotation_actions.py's one-shot GET-click HTML
confirmation pages, these return JSON: the frontend here is a real React
page (frontend/src/pages/PublicPOUpload.jsx) that needs a file picker and
upload progress, following EmployeeOnboardingChat.jsx's precedent — the
only existing public FILE-UPLOAD page in this codebase."""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import Customer, CustomerProjectAssignment, CustomerProjectPurchaseOrder, Project
from app.services.po_service import ALLOWED_PO_EXTENSIONS, MAX_PO_BYTES, apply_po_upload
from app.services.customer_payment_service import (
    ALLOWED_PROOF_EXTENSIONS, MAX_PROOF_BYTES, compute_payment_summary,
    get_accepted_quotation, record_payment,
)
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

router = APIRouter(prefix="/po-actions", tags=["Purchase Order Actions"])


def _get_po_row_or_404(db: Session, token: str) -> CustomerProjectPurchaseOrder:
    row = db.query(CustomerProjectPurchaseOrder).filter(
        CustomerProjectPurchaseOrder.UPLOAD_TOKEN == token
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="This Purchase Order upload link is invalid.")
    return row


@router.get("/{token}")
def get_po_upload_context(token: str, db: Session = Depends(get_db)):
    """Context for the public upload page to render before the customer
    picks a file — project/customer name, current quantity (so a re-upload
    pre-fills what was previously entered), and whether something was
    already uploaded (so the page can say "upload a new file to replace
    it" instead of a blank first-time form)."""
    po_row = _get_po_row_or_404(db, token)
    assignment = db.query(CustomerProjectAssignment).filter(
        CustomerProjectAssignment.ID == po_row.ASSIGNMENT_ID
    ).first()
    project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first() if assignment else None
    customer = db.query(Customer).filter(Customer.ID == assignment.CUSTOMER_ID).first() if assignment else None

    # Lets the public upload page know the remaining balance — never trust a
    # frontend-computed figure, this always comes from a fresh backend
    # calculation (quantity-aware: accepted quotation price x QUANTITY).
    remaining_balance = 0.0
    if assignment:
        accepted_quotation = get_accepted_quotation(db, assignment)
        if accepted_quotation:
            summary = compute_payment_summary(db, assignment, accepted_quotation=accepted_quotation)
            remaining_balance = float(summary["remaining_balance"])

    return {
        "project_name": project.NAME if project else "",
        "customer_name": customer.NAME if customer else "",
        "already_uploaded": bool(po_row.FILE_URL),
        "file_name": po_row.FILE_NAME,
        "uploaded_at": po_row.UPLOADED_AT.isoformat() if po_row.UPLOADED_AT else None,
        "quantity": assignment.QUANTITY if assignment else 1,
        "remaining_balance": remaining_balance,
    }


@router.post("/{token}/upload")
async def upload_po(
    token: str,
    file: UploadFile = File(...),
    comments: str = Form(None),
    quantity: str = Form(...),
    payment_amounts: List[str] = Form(default=[]),
    payment_reference_numbers: List[str] = Form(default=[]),
    payment_proofs: List[UploadFile] = File(default=[]),
    payment_comments: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Accepts the customer's PDF, the purchased Quantity (mandatory —
    stored on the assignment), and one or more payments (each a mandatory
    amount + proof file — a single payment may be split across several
    proofs, e.g. two bank transfers totalling one payment). No payment date
    field: every payment created in this submission shares one now_ist()
    timestamp captured below, since the customer never picks one here.
    Each payment is recorded via the same record_payment() used everywhere
    else, called once per row in sequence — its own row-locked remaining-
    balance check means the running total across rows is enforced correctly
    with no separate validation needed."""
    po_row = _get_po_row_or_404(db, token)
    assignment = db.query(CustomerProjectAssignment).filter(
        CustomerProjectAssignment.ID == po_row.ASSIGNMENT_ID
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="This Purchase Order upload link is no longer valid.")

    original_name = file.filename or "purchase-order.pdf"
    ext = ("." + original_name.rsplit(".", 1)[-1].lower()) if "." in original_name else ""
    if ext not in ALLOWED_PO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF files are accepted for a Purchase Order.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > MAX_PO_BYTES:
        raise HTTPException(status_code=400, detail="File is too large — the maximum size is 15 MB.")

    try:
        qty = int(quantity)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Quantity must be a whole number.")
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than zero.")

    # Payment is mandatory UNLESS this assignment is already fully paid
    # (e.g. a re-upload of a corrected PDF after the customer already
    # settled the full amount) — otherwise a fully-paid customer would be
    # stuck unable to re-submit a PO at all, since there'd be nothing left
    # to validly pay.
    already_fully_paid = False
    accepted_quotation = get_accepted_quotation(db, assignment)
    if accepted_quotation:
        pre_summary = compute_payment_summary(db, assignment, accepted_quotation=accepted_quotation)
        already_fully_paid = pre_summary["remaining_balance"] <= 0

    if not payment_amounts and not already_fully_paid:
        raise HTTPException(status_code=400, detail="At least one payment is required.")
    if not (len(payment_amounts) == len(payment_reference_numbers) == len(payment_proofs)):
        raise HTTPException(status_code=400, detail="Payment rows are inconsistent — please try again.")

    shared_comments = payment_comments.strip() if payment_comments and payment_comments.strip() else None
    submission_time = now_ist()

    validated_rows = []
    for idx, (amount_str, reference_number, proof) in enumerate(
        zip(payment_amounts, payment_reference_numbers, payment_proofs), start=1
    ):
        if not proof or not proof.filename:
            raise HTTPException(status_code=400, detail=f"Payment {idx}: a payment proof file is required.")
        proof_ext = ("." + proof.filename.rsplit(".", 1)[-1].lower()) if "." in proof.filename else ""
        if proof_ext not in ALLOWED_PROOF_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Payment {idx}: unsupported payment proof file type. Accepted: PDF, image, or Word document.",
            )
        proof_content = await proof.read()
        if not proof_content:
            raise HTTPException(status_code=400, detail=f"Payment {idx}: the payment proof file is empty.")
        if len(proof_content) > MAX_PROOF_BYTES:
            raise HTTPException(status_code=400, detail=f"Payment {idx}: payment proof file is too large — the maximum size is 15 MB.")
        validated_rows.append({
            "amount": amount_str,
            "reference_number": reference_number,
            "proof_filename": proof.filename,
            "proof_content": proof_content,
        })

    # Quantity is set before payments are recorded, since payment validation
    # (remaining balance) is computed against the quantity-aware total value.
    assignment.QUANTITY = qty
    db.commit()

    for row in validated_rows:
        record_payment(
            db, assignment=assignment, amount=row["amount"], payment_date=submission_time,
            reference_number=row["reference_number"], comments=shared_comments,
            source="CUSTOMER", proof_filename=row["proof_filename"], proof_content=row["proof_content"],
        )

    result = apply_po_upload(
        db, po_row=po_row, assignment=assignment, filename=original_name, content=content,
        comments=(comments.strip() if comments and comments.strip() else None), source="CUSTOMER",
    )

    return {
        "message": f"Purchase Order {result['action_label'].lower()} successfully. Thank you.",
        "file_name": result["file_name"],
        "uploaded_at": result["uploaded_at"].isoformat() if result["uploaded_at"] else None,
        "payment_recorded": True,
        "payments_recorded": len(validated_rows),
    }
