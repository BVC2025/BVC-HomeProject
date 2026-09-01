"""Customer Payments — the Accounts-facing page's backend API. Unlike
lead_management.py's payment endpoint (scoped to one Lead), this is scoped
to one Customer across ALL of their Leads/Projects, since that's how the
/customer-payments page is organized (search a customer, see every
Lead/Project they have and the payment status of each). Manual payment
entry funnels through the same customer_payment_service.record_payment()
used by the public PO-upload-time optional capture, so validation exists
in exactly one place."""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from pydantic import BaseModel, Field

from app.database.database import get_db
from app.auth.auth_bearer import require
from app.models.models import (
    Customer, CustomerProjectAssignment, CustomerProjectPayment, Lead, Project,
)
from app.services.customer_payment_service import (
    ALLOWED_PROOF_EXTENSIONS, MAX_PROOF_BYTES, compute_payment_summary,
    get_accepted_quotation, read_payment_proof_bytes, record_payment, update_payment_record,
)
from app.services.payment_milestone_service import (
    compute_milestone_eligibility_for_assignment, evaluate_milestones_for_assignment,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/customer-payments", tags=["Customer Payments"])

# A Lead's payment/production data becomes meaningful once its PO is
# received — and stays meaningful for every later stage of the lifecycle.
# PRODUCTION_SCHEDULED/PRODUCTION_STARTED are automatically set well after
# PO_RECEIVED by the production scheduling engine (production_scheduling_
# service.py) — a Lead sitting at either of those must still show up here
# exactly like one still at PO_RECEIVED, since it's simply further along
# the SAME converted lifecycle, not a different one.
_PO_RECEIVED_OR_LATER_STATUSES = {"PO_RECEIVED", "PRODUCTION_SCHEDULED", "PRODUCTION_STARTED"}


def _serialize_payment(p: CustomerProjectPayment) -> dict:
    return {
        "ID": p.ID,
        "PAYMENT_AMOUNT": float(p.PAYMENT_AMOUNT) if p.PAYMENT_AMOUNT is not None else None,
        "PAYMENT_PERCENTAGE": float(p.PAYMENT_PERCENTAGE) if p.PAYMENT_PERCENTAGE is not None else None,
        "PAYMENT_DATE": p.PAYMENT_DATE.isoformat() if p.PAYMENT_DATE else None,
        "FILE_URL": p.FILE_URL,
        "FILE_NAME": p.FILE_NAME,
        "MIME": p.MIME,
        "PAYMENT_REFERENCE_NUMBER": p.PAYMENT_REFERENCE_NUMBER,
        "PAYMENT_STATUS": p.PAYMENT_STATUS,
        "COMMENTS": p.COMMENTS,
        "RECORDED_BY_SOURCE": p.RECORDED_BY_SOURCE,
        "CREATED_AT": p.CREATED_AT.isoformat() if p.CREATED_AT else None,
    }


def _payment_status_label(accepted_amount, total_paid, remaining_balance) -> str:
    if accepted_amount <= 0:
        return "No Accepted Quotation"
    if remaining_balance <= 0:
        return "Fully Paid"
    if total_paid > 0:
        return "Partially Paid"
    return "Not Paid"


@router.get("/by-customer/{customer_id}", dependencies=[Depends(require("customer.payments.view"))])
def get_customer_payments(customer_id: str, vendor_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    """Every Lead/Project assignment for this customer whose Lead has
    reached PO_RECEIVED **or any later stage of the same lifecycle**
    (PRODUCTION_SCHEDULED/PRODUCTION_STARTED), with accepted quotation
    amount, payment summary, and the payment record list — powers the
    /customer-payments page once a customer is selected, and (via the
    same customerPaymentService.getByCustomer() call) the Lead/Project
    picker on /customer-task-timeline too.

    Scoped two ways, both required:
      - vendor isolation: the resolved Customer (and, defensively, every
        assignment row) must belong to the requested vendor.
      - lifecycle gating: an assignment is only surfaced once its driving
        Lead has actually reached PO_RECEIVED-or-later — a Lead still
        mid-quotation (or anywhere earlier in the pipeline) has no
        meaningful payment data yet and previously showed up here as a
        confusing, empty-looking "extra" record. An exact `== "PO_RECEIVED"`
        check would incorrectly DROP a Lead the moment it progresses to
        PRODUCTION_SCHEDULED/PRODUCTION_STARTED — exactly the bug this set
        membership check fixes. Assignments with no linked Lead (LEAD_ID is
        nullable — see CustomerProjectAssignment's own model comment) are
        excluded for the same reason: there's no Lead lifecycle to confirm
        PO_RECEIVED-or-later against."""
    q = db.query(Customer).filter(Customer.ID == customer_id)
    if vendor_id is not None:
        q = q.filter(Customer.VENDOR_ID == vendor_id)
    customer = q.first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    assignments = db.query(CustomerProjectAssignment).filter(
        CustomerProjectAssignment.CUSTOMER_ID == customer_id,
        CustomerProjectAssignment.VENDOR_ID == customer.VENDOR_ID,
    ).all()

    rows = []
    for assignment in assignments:
        lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first() if assignment.LEAD_ID else None
        if not lead or lead.LEAD_STATUS not in _PO_RECEIVED_OR_LATER_STATUSES:
            continue

        project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first()
        accepted_quotation = get_accepted_quotation(db, assignment)
        summary = compute_payment_summary(db, assignment, accepted_quotation=accepted_quotation)
        payments = (
            db.query(CustomerProjectPayment)
            .filter(CustomerProjectPayment.CUSTOMER_PROJECT_ASSIGNMENT_ID == assignment.ID)
            .order_by(CustomerProjectPayment.PAYMENT_DATE.desc(), CustomerProjectPayment.CREATED_AT.desc())
            .all()
        )
        # Common vendor-level Payment Milestones — this assignment's own
        # request/completion state against them (see payment_milestone_service).
        milestone_eligibility = compute_milestone_eligibility_for_assignment(db, assignment)
        rows.append({
            "assignment_id": assignment.ID,
            "lead_id": assignment.LEAD_ID,
            "lead_contact_name": lead.CONTACT_NAME,
            "lead_company_name": lead.COMPANY_NAME,
            "lead_status": lead.LEAD_STATUS,
            "lead_created_at": lead.CREATED_AT.isoformat() if lead.CREATED_AT else None,
            "assignment_created_at": assignment.CREATED_AT.isoformat() if assignment.CREATED_AT else None,
            "project_id": assignment.PROJECT_ID,
            "project_name": project.NAME if project else None,
            "assignment_status": assignment.STATUS,
            "project_completion_percentage": float(assignment.PROJECT_COMPLETION_PERCENTAGE or 0),
            "quantity": summary["quantity"],
            "price_per_unit": float(summary["price_per_unit"]),
            "accepted_quotation_amount": float(summary["accepted_amount"]),
            "total_paid": float(summary["total_paid"]),
            "remaining_balance": float(summary["remaining_balance"]),
            "total_paid_percentage": float(summary["total_paid_percentage"]),
            "remaining_percentage": float(summary["remaining_percentage"]),
            "payment_status": _payment_status_label(
                summary["accepted_amount"], summary["total_paid"], summary["remaining_balance"],
            ),
            "milestones": [
                {
                    **m,
                    "PROJECT_COMPLETION_TRIGGER_PERCENTAGE": float(m["PROJECT_COMPLETION_TRIGGER_PERCENTAGE"]),
                    "REQUIRED_PAYMENT_PERCENTAGE": float(m["REQUIRED_PAYMENT_PERCENTAGE"]),
                }
                for m in milestone_eligibility
            ],
            "payments": [_serialize_payment(p) for p in payments],
        })

    return {
        "customer": {
            "ID": customer.ID,
            "NAME": customer.NAME,
            "COMPANY_NAME": customer.COMPANY_NAME,
            "EMAIL": customer.EMAIL,
            "PHONE_NUMBER": customer.PHONE_NUMBER,
        },
        "assignments": rows,
    }


@router.post("/{assignment_id}/manual")
async def add_manual_payment(
    assignment_id: str,
    amount: str = Form(...),
    payment_date: str = Form(...),
    reference_number: Optional[str] = Form(None),
    comments: Optional[str] = Form(None),
    proof: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    admin=Depends(require("customer.payments.manual_add")),
):
    """Accounts team's manual payment entry — for a payment received via
    email/WhatsApp/other channel, outside the customer's own upload flow."""
    assignment = db.query(CustomerProjectAssignment).filter(CustomerProjectAssignment.ID == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    proof_filename = None
    proof_content = None
    if proof is not None and proof.filename:
        ext = ("." + proof.filename.rsplit(".", 1)[-1].lower()) if "." in proof.filename else ""
        if ext not in ALLOWED_PROOF_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail="Unsupported payment proof file type. Accepted: PDF, image, or Word document.",
            )
        proof_content = await proof.read()
        if proof_content and len(proof_content) > MAX_PROOF_BYTES:
            raise HTTPException(status_code=400, detail="Payment proof file is too large — the maximum size is 15 MB.")
        proof_filename = proof.filename

    payment = record_payment(
        db, assignment=assignment, amount=amount, payment_date=payment_date,
        reference_number=reference_number, comments=comments,
        source="STAFF", employee_id=admin.get("employee_id"),
        proof_filename=proof_filename, proof_content=proof_content,
    )
    return {"message": "Payment recorded", "payment": _serialize_payment(payment)}


@router.put("/{payment_id}", dependencies=[Depends(require("customer.payments.update"))])
async def update_payment(
    payment_id: str,
    amount: Optional[str] = Form(None),
    payment_date: Optional[str] = Form(None),
    reference_number: Optional[str] = Form(None),
    comments: Optional[str] = Form(None),
    proof: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Full-field edit — Amount, Payment Date/Time, Reference Number,
    Comments, and (optionally) a replacement Payment Proof file. Amount
    edits are re-validated against the remaining balance (excluding this
    payment's own current amount) and PAYMENT_PERCENTAGE is recomputed
    server-side — never left stale relative to an edited amount."""
    payment = db.query(CustomerProjectPayment).filter(CustomerProjectPayment.ID == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    proof_filename = None
    proof_content = None
    if proof is not None and proof.filename:
        ext = ("." + proof.filename.rsplit(".", 1)[-1].lower()) if "." in proof.filename else ""
        if ext not in ALLOWED_PROOF_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail="Unsupported payment proof file type. Accepted: PDF, image, or Word document.",
            )
        proof_content = await proof.read()
        if proof_content and len(proof_content) > MAX_PROOF_BYTES:
            raise HTTPException(status_code=400, detail="Payment proof file is too large — the maximum size is 15 MB.")
        proof_filename = proof.filename

    updated = update_payment_record(
        db, payment=payment, amount=amount, payment_date=payment_date,
        reference_number=reference_number, comments=comments,
        proof_filename=proof_filename, proof_content=proof_content,
    )
    return {"message": "Payment updated", "payment": _serialize_payment(updated)}


@router.delete("/{payment_id}", dependencies=[Depends(require("customer.payments.delete"))])
def delete_payment(payment_id: str, db: Session = Depends(get_db)):
    payment = db.query(CustomerProjectPayment).filter(CustomerProjectPayment.ID == payment_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    db.delete(payment)
    db.commit()
    return {"message": "Payment deleted"}


class CompletionUpdate(BaseModel):
    PROJECT_COMPLETION_PERCENTAGE: float = Field(ge=0, le=100)


@router.patch("/assignments/{assignment_id}/completion", dependencies=[Depends(require("customer.payments.update"))])
def update_project_completion(assignment_id: str, data: CompletionUpdate, db: Session = Depends(get_db)):
    """Staff-maintained project completion percentage — no automatic
    task-based rollup exists in this codebase today (see
    payment_milestone_service's module docstring), so this is updated
    manually from the Customer Payments page as real project work
    progresses. Every update re-evaluates configured Payment Milestones
    against the new value: may trigger a payment-request email and/or
    place the assignment on HOLD, or resume one whose outstanding
    milestones are now satisfied. Gated by the same permission that
    already governs editing this assignment's payments."""
    assignment = db.query(CustomerProjectAssignment).filter(CustomerProjectAssignment.ID == assignment_id).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    assignment.PROJECT_COMPLETION_PERCENTAGE = data.PROJECT_COMPLETION_PERCENTAGE
    db.flush()
    evaluate_milestones_for_assignment(db, assignment)
    db.commit()
    db.refresh(assignment)

    return {
        "message": "Project completion updated",
        "assignment_status": assignment.STATUS,
        "project_completion_percentage": float(assignment.PROJECT_COMPLETION_PERCENTAGE or 0),
        "milestones": compute_milestone_eligibility_for_assignment(db, assignment),
    }


@router.get("/{payment_id}/proof", dependencies=[Depends(require("customer.payments.view_proof"))])
def view_payment_proof(payment_id: str, db: Session = Depends(get_db)):
    """Authenticated proof-serving proxy — the concrete enforcement behind
    the dedicated 'View Payment Proof' permission, rather than exposing the
    static file path directly. Returns the raw file bytes with its stored
    MIME type so the browser can preview images/PDFs inline."""
    payment = db.query(CustomerProjectPayment).filter(CustomerProjectPayment.ID == payment_id).first()
    if not payment or not payment.FILE_URL:
        raise HTTPException(status_code=404, detail="No payment proof on file for this payment.")
    content = read_payment_proof_bytes(payment.FILE_URL)
    if content is None:
        raise HTTPException(status_code=404, detail="Payment proof file could not be found on disk.")
    return Response(
        content=content,
        media_type=payment.MIME or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{payment.FILE_NAME or "payment-proof"}"'},
    )
