"""Vendor-level Payment Milestone evaluation engine.

Detects when a Customer Lead Project's (admin-maintained)
PROJECT_COMPLETION_PERCENTAGE reaches a configured PaymentMilestone's
trigger, and reacts: sends a payment-request email, places the assignment
on HOLD if the required payment is missing, and auto-resumes it once paid.
Runs after (a) PROJECT_COMPLETION_PERCENTAGE is updated and (b) every
payment is recorded (see customer_payment_service.record_payment/
update_payment_record) — reuses compute_payment_summary() unchanged rather
than duplicating payment-total logic.

REQUIRED_PAYMENT_PERCENTAGE on PaymentMilestone is INCREMENTAL (the amount
due AT that milestone — Initial 50% + Middle 30% + Final 20% = 100%), so a
milestone's actual payment requirement is the CUMULATIVE sum of
REQUIRED_PAYMENT_PERCENTAGE for every active milestone up to and including
it — see cumulative_required_through()."""

import logging
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.models import (
    PaymentMilestone, CustomerProjectMilestoneStatus, Project, VendorEmailConfig,
)
from app.services.customer_payment_service import compute_payment_summary, get_accepted_quotation
from app.services.email_template_service import get_template_for_send, render_template
from app.services.email_service import send_via_vendor_smtp, send_via_resend
from app.services.email_logo_service import build_email_logo, apply_cid_logo, extract_cid_logo
from app.services.lead_quotation_service import company_branding_variables
from app.services.company_settings_service import get_company_settings
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)


def get_active_milestones(db: Session, vendor_id: int) -> list:
    return (
        db.query(PaymentMilestone)
        .filter(PaymentMilestone.VENDOR_ID == vendor_id, PaymentMilestone.IS_ACTIVE == True)  # noqa: E712
        .order_by(PaymentMilestone.MILESTONE_ORDER)
        .all()
    )


def cumulative_required_through(milestones: list, order: int) -> Decimal:
    """Sum of REQUIRED_PAYMENT_PERCENTAGE across every active milestone up
    to and including MILESTONE_ORDER `order` — the incremental-to-cumulative
    reconciliation described in this module's docstring."""
    return sum(
        (Decimal(m.REQUIRED_PAYMENT_PERCENTAGE) for m in milestones if m.MILESTONE_ORDER <= order),
        Decimal("0"),
    )


def first_milestone_status(db: Session, assignment) -> dict:
    """Read-only check: has the FIRST active Payment Milestone's cumulative
    required payment been reached for this assignment? Reuses the exact
    same milestone/payment-summary computation
    evaluate_milestones_for_assignment() uses inline for its own first-
    milestone check, so the manual Edit-Lead 'request production schedule'
    validation (both the frontend's pre-check and the backend's
    authoritative gate) can never disagree with the automatic path about
    whether the milestone has been reached."""
    milestones = get_active_milestones(db, assignment.VENDOR_ID)
    if not milestones:
        return {
            "reached": False, "required_percentage": None, "paid_percentage": None,
            "reason": "No payment milestones are configured for this vendor.",
        }
    accepted_quotation = get_accepted_quotation(db, assignment)
    summary = compute_payment_summary(db, assignment, accepted_quotation=accepted_quotation)
    total_paid_percentage = summary["total_paid_percentage"]
    required_first = cumulative_required_through(milestones, milestones[0].MILESTONE_ORDER)
    return {
        "reached": total_paid_percentage >= required_first,
        "required_percentage": float(required_first),
        "paid_percentage": float(total_paid_percentage),
        "reason": None,
    }


def _get_or_create_status(db: Session, assignment, milestone) -> CustomerProjectMilestoneStatus:
    row = db.query(CustomerProjectMilestoneStatus).filter(
        CustomerProjectMilestoneStatus.CUSTOMER_PROJECT_ASSIGNMENT_ID == assignment.ID,
        CustomerProjectMilestoneStatus.PAYMENT_MILESTONE_ID == milestone.ID,
    ).first()
    if not row:
        row = CustomerProjectMilestoneStatus(
            CUSTOMER_PROJECT_ASSIGNMENT_ID=assignment.ID,
            PAYMENT_MILESTONE_ID=milestone.ID,
        )
        db.add(row)
        db.flush()
    return row


def _send_payment_milestone_request_email(db: Session, assignment, milestone, summary, milestones) -> tuple:
    """Mirrors lead_quotation_service.send_purchase_order_request_email()'s
    send pipeline exactly (get_template_for_send -> render_template ->
    per-active-VendorEmailConfig send_via_vendor_smtp -> send_via_resend
    fallback), including this session's Supplier-reference CID logo
    pipeline. Returns (sent: bool, message: str) — never raises, matching
    every other email-sending function in this codebase."""
    customer = assignment.customer
    if not customer or not customer.EMAIL:
        return False, "Customer has no email address on file."

    vendor_id = assignment.VENDOR_ID
    body_html, subject = get_template_for_send(db, vendor_id, "PAYMENT_MILESTONE_REQUEST")
    if not body_html:
        return False, "No email template configured for PAYMENT_MILESTONE_REQUEST."

    project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first()
    accepted_amount = summary["accepted_amount"]
    required_cumulative = cumulative_required_through(milestones, milestone.MILESTONE_ORDER)
    amount_due_now = (required_cumulative / Decimal("100") * accepted_amount) - summary["total_paid"]
    if amount_due_now < 0:
        amount_due_now = Decimal("0")
    milestone_amount = milestone.REQUIRED_PAYMENT_PERCENTAGE and (
        Decimal(milestone.REQUIRED_PAYMENT_PERCENTAGE) / Decimal("100") * accepted_amount
    )

    variables = {
        **company_branding_variables(db, vendor_id),
        "customer_name": customer.NAME or "",
        "project_name": project.NAME if project else "",
        "milestone_name": milestone.MILESTONE_NAME or "",
        "required_payment_percentage": f"{float(milestone.REQUIRED_PAYMENT_PERCENTAGE):,.2f}",
        "required_payment_amount": f"{float(milestone_amount or 0):,.2f}",
        "amount_paid": f"{float(summary['total_paid']):,.2f}",
        "amount_due_now": f"{float(amount_due_now):,.2f}",
        "remaining_payment": f"{float(summary['remaining_balance']):,.2f}",
        "project_completion_percentage": f"{float(assignment.PROJECT_COMPLETION_PERCENTAGE or 0):,.2f}",
    }
    rendered_subject, rendered_html = render_template(body_html, subject, variables)

    company = get_company_settings(db, vendor_id)
    logo_bytes, logo_content_type, _logo_html = build_email_logo(company)
    rendered_html = apply_cid_logo(rendered_html, logo_bytes, company)
    if not logo_bytes:
        rendered_html, logo_bytes, logo_content_type = extract_cid_logo(rendered_html)

    active_cfgs = db.query(VendorEmailConfig).filter(
        VendorEmailConfig.VENDOR_ID == vendor_id, VendorEmailConfig.IS_ACTIVE == True,  # noqa: E712
    ).all()
    for cfg in active_cfgs:
        ok, err, _detail = send_via_vendor_smtp(
            cfg, customer.EMAIL, rendered_subject, rendered_html,
            logo_bytes=logo_bytes, logo_content_type=logo_content_type,
        )
        if ok:
            return True, "Sent"
        log.warning("send_payment_milestone_request_email: vendor SMTP config %s failed: %s", cfg.ID, err)

    ok, err = send_via_resend(subject=rendered_subject, body_html=rendered_html, recipient=customer.EMAIL)
    if ok:
        return True, "Sent via Resend fallback"
    return False, err or "Failed to send payment milestone request email — no working email configuration."


def evaluate_milestones_for_assignment(db: Session, assignment) -> list:
    """The core engine — called after PROJECT_COMPLETION_PERCENTAGE is
    updated and after every payment is recorded. For each active vendor
    milestone whose trigger has been reached: marks it COMPLETED if the
    cumulative required payment has been met, sends the payment-request
    email and marks it REQUESTED exactly once otherwise (never resent while
    still REQUESTED — the concrete duplicate-request-prevention mechanism),
    then recomputes assignment.STATUS (HOLD while any milestone is
    REQUESTED, auto-resume to IN_PROGRESS once none remain). Returns the
    list of CustomerProjectMilestoneStatus rows evaluated this run. A
    milestone-email failure is logged, never raised — this must not block
    the payment/completion update that triggered it."""
    milestones = get_active_milestones(db, assignment.VENDOR_ID)
    if not milestones:
        return []

    accepted_quotation = get_accepted_quotation(db, assignment)
    summary = compute_payment_summary(db, assignment, accepted_quotation=accepted_quotation)
    total_paid_percentage = summary["total_paid_percentage"]
    completion = Decimal(assignment.PROJECT_COMPLETION_PERCENTAGE or 0)

    touched = []
    for m in milestones:
        if Decimal(m.PROJECT_COMPLETION_TRIGGER_PERCENTAGE) > completion:
            continue  # not yet triggered

        status_row = _get_or_create_status(db, assignment, m)
        if status_row.STATUS == "COMPLETED":
            continue  # terminal — never re-requested

        required_cumulative = cumulative_required_through(milestones, m.MILESTONE_ORDER)
        if total_paid_percentage >= required_cumulative:
            was_requested = status_row.STATUS == "REQUESTED"
            status_row.STATUS = "COMPLETED"
            status_row.COMPLETED_AT = now_ist()
            if was_requested:
                _attribute_latest_payment(db, assignment, m)
            if m.MILESTONE_ORDER == milestones[0].MILESTONE_ORDER:
                # First milestone reached (PO + payment proof cleared) —
                # kick off automatic production scheduling. Local import
                # avoids a service/service import cycle at module load
                # time (production_scheduling_service pulls in the task
                # generation / employee matching stack), matching this
                # codebase's existing convention (see po_notification_
                # service.py's own local import of po_service).
                from app.models.lead_models import Lead
                from app.services.production_scheduling_service import evaluate_and_propose_schedule
                lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first() if assignment.LEAD_ID else None
                if lead and lead.LEAD_STATUS in ("PRODUCTION_SCHEDULE_REQUESTED", "PRODUCTION_SCHEDULED", "PRODUCTION_STARTED"):
                    # Already scheduled (e.g. manually, via the Edit Lead
                    # modal) — evaluate_and_propose_schedule() is already
                    # idempotent at the data layer (ASSIGNMENT_ID unique
                    # constraint), but skip the attempt outright so this
                    # never re-fires after a milestone config edit changes
                    # which row now qualifies as "first."
                    log.info(
                        "evaluate_milestones_for_assignment: skipping production scheduling — assignment %s's lead is already %s",
                        assignment.ID, lead.LEAD_STATUS,
                    )
                else:
                    try:
                        evaluate_and_propose_schedule(db, assignment)
                    except Exception:
                        log.exception(
                            "evaluate_milestones_for_assignment: production scheduling failed for assignment %s",
                            assignment.ID,
                        )
        elif status_row.STATUS == "PENDING":
            ok, message = _send_payment_milestone_request_email(db, assignment, m, summary, milestones)
            if not ok:
                log.warning(
                    "evaluate_milestones_for_assignment: request email failed for assignment %s milestone %s: %s",
                    assignment.ID, m.ID, message,
                )
            status_row.STATUS = "REQUESTED"
            status_row.REQUESTED_AT = now_ist()
        # else: already REQUESTED and still unpaid — no resend.
        touched.append(status_row)

    if any(t.STATUS == "REQUESTED" for t in touched):
        assignment.STATUS = "HOLD"
    elif assignment.STATUS == "HOLD":
        assignment.STATUS = "IN_PROGRESS"

    db.flush()
    return touched


def _attribute_latest_payment(db: Session, assignment, milestone) -> None:
    """Best-effort attribution (Requirement 11) — when a milestone
    transitions REQUESTED -> COMPLETED, tag the most recent payment for
    this assignment that isn't already attributed to a milestone as the
    one that satisfied it. Not a hard guarantee (a single large payment
    satisfying two milestones at once still only tags the latest row) —
    purely an aid for "which milestone did this payment help complete",
    never a source of truth for the actual totals (those always come from
    compute_payment_summary())."""
    from app.models.models import CustomerProjectPayment
    payment = (
        db.query(CustomerProjectPayment)
        .filter(
            CustomerProjectPayment.CUSTOMER_PROJECT_ASSIGNMENT_ID == assignment.ID,
            CustomerProjectPayment.MILESTONE_ID.is_(None),
        )
        .order_by(CustomerProjectPayment.PAYMENT_DATE.desc(), CustomerProjectPayment.CREATED_AT.desc())
        .first()
    )
    if payment:
        payment.MILESTONE_ID = milestone.ID


def compute_milestone_eligibility_for_assignment(db: Session, assignment) -> list:
    """Read-only serializer for GET /by-customer/{id} — replaces the old
    customer_payment_service.compute_milestone_eligibility(). Combines
    PaymentMilestone (vendor-shared config) with this assignment's own
    CustomerProjectMilestoneStatus rows, in MILESTONE_ORDER. A milestone
    never evaluated yet for this assignment (trigger not reached) reports
    STATUS "PENDING" with no request/completion timestamps."""
    milestones = get_active_milestones(db, assignment.VENDOR_ID)
    if not milestones:
        return []

    statuses_by_milestone = {
        s.PAYMENT_MILESTONE_ID: s
        for s in db.query(CustomerProjectMilestoneStatus).filter(
            CustomerProjectMilestoneStatus.CUSTOMER_PROJECT_ASSIGNMENT_ID == assignment.ID,
        ).all()
    }

    results = []
    for m in milestones:
        status_row = statuses_by_milestone.get(m.ID)
        results.append({
            "ID": m.ID,
            "MILESTONE_NAME": m.MILESTONE_NAME,
            "MILESTONE_ORDER": m.MILESTONE_ORDER,
            "PROJECT_COMPLETION_TRIGGER_PERCENTAGE": m.PROJECT_COMPLETION_TRIGGER_PERCENTAGE,
            "REQUIRED_PAYMENT_PERCENTAGE": m.REQUIRED_PAYMENT_PERCENTAGE,
            "DESCRIPTION": m.DESCRIPTION,
            "IS_ACTIVE": m.IS_ACTIVE,
            "STATUS": status_row.STATUS if status_row else "PENDING",
            "REQUESTED_AT": status_row.REQUESTED_AT.isoformat() if status_row and status_row.REQUESTED_AT else None,
            "COMPLETED_AT": status_row.COMPLETED_AT.isoformat() if status_row and status_row.COMPLETED_AT else None,
            "eligible": (status_row.STATUS == "COMPLETED") if status_row else False,
        })
    return results
