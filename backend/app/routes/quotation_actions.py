"""Public, unauthenticated Accept/Reject click targets for the Lead-
conversion quotation emails (Project Quotation / Revised Project
Quotation). Public by design — secured by the emailed ACTION_TOKEN, not a
login session — mirrors the exact same pattern already used by
leave.py's GET /leave/decide/{token} and task_approval.py's
GET /approve-task /reject-task: an opaque, high-entropy token stored in a
unique DB column, matched with a plain WHERE lookup, gated purely by the
row's own status (never burned), returning a small styled HTML
confirmation page rather than JSON since this is a link a customer clicks
from their email client."""

from typing import Optional

from fastapi import APIRouter, Depends, Form
from fastapi.responses import HTMLResponse
from sqlalchemy import update
from sqlalchemy.orm import Session

import logging

from app.database.database import get_db
from app.models.lead_models import Lead, LeadModuleSetting
from app.models.models import Customer, CustomerProjectAssignment, CustomerProjectQuotation, Project
from app.services.lead_quotation_service import send_purchase_order_request_email
from app.services.quotation_notification_service import send_quotation_decision_notifications
from app.services.po_notification_service import send_po_requested_notification
from app.utils.datetime_utils import now_ist

log = logging.getLogger(__name__)

router = APIRouter(prefix="/quotation-actions", tags=["Quotation Actions"])

# (QUOTATION_TYPE, new QUOTATION_STATUS) -> Lead.LEAD_STATUS
_LEAD_STATUS_MAP = {
    ("FINAL_QUOTATION", "APPROVED"):   "QUOTE_APPROVED",
    ("FINAL_QUOTATION", "REJECTED"):   "QUOTE_REJECTED",
    ("REVISED_QUOTATION", "APPROVED"): "REVISED_QUOTE_APPROVED",
    ("REVISED_QUOTATION", "REJECTED"): "REVISED_QUOTE_REJECTED",
}


def _decision_html(title: str, message: str, color: str = "#16a34a") -> str:
    """Small styled confirmation page — mirrors leave.py's _decision_html
    exactly (same layout/palette), kept local since each public-action
    file in this codebase owns its own copy rather than sharing one."""
    return f"""
    <!DOCTYPE html>
    <html><head><title>{title}</title></head>
    <body style="font-family:Segoe UI,sans-serif;background:#f1f5f9;
         min-height:100vh;display:flex;align-items:center;
         justify-content:center;margin:0;">
      <div style="background:white;padding:36px 44px;border-radius:14px;
           box-shadow:0 12px 40px rgba(15,23,42,0.18);max-width:480px;
           text-align:center;">
        <div style="font-size:48px;margin-bottom:12px;color:{color};">
          {('&#10003;' if color == '#16a34a' else '&#10007;' if color == '#dc2626' else '&#9432;')}
        </div>
        <div style="font-size:22px;font-weight:700;color:#0f172a;">
          {title}
        </div>
        <div style="font-size:14px;color:#475569;margin-top:10px;
             line-height:1.6;">{message}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:20px;">
          You can close this tab.
        </div>
      </div>
    </body></html>
    """


def _already_responded_page(quotation: CustomerProjectQuotation) -> HTMLResponse:
    return HTMLResponse(_decision_html(
        f"Already {quotation.QUOTATION_STATUS.title()}",
        f"This quotation has already been <strong>{quotation.QUOTATION_STATUS.lower()}</strong>. "
        f"No further action is needed.",
        color="#94a3b8",
    ))


def _reject_reason_form_html(token: str) -> str:
    """A required-reason form for the reject action — the reject link can
    no longer decide immediately (unlike accept), since a reason is
    mandatory. Plain server-rendered HTML/form, matching this file's own
    convention of owning its confirmation pages locally rather than
    building a new frontend route for one text field. Any reject link
    already sitting in a previously-sent, still-pending email lands here
    instead of instant-rejecting — strictly safer than before, nothing
    breaks."""
    return f"""
    <!DOCTYPE html>
    <html><head><title>Reject Quotation</title></head>
    <body style="font-family:Segoe UI,sans-serif;background:#f1f5f9;
         min-height:100vh;display:flex;align-items:center;
         justify-content:center;margin:0;padding:24px;box-sizing:border-box;">
      <div style="background:white;padding:36px 44px;border-radius:14px;
           box-shadow:0 12px 40px rgba(15,23,42,0.18);max-width:480px;
           width:100%;box-sizing:border-box;">
        <div style="font-size:22px;font-weight:700;color:#0f172a;text-align:center;">
          Reject Quotation
        </div>
        <div style="font-size:14px;color:#475569;margin-top:10px;
             line-height:1.6;text-align:center;">
          Please let us know why you're rejecting this quotation. This helps our team
          follow up appropriately.
        </div>
        <form id="rejectForm" method="POST" action="/quotation-actions/{token}/reject" style="margin-top:20px;">
          <label style="font-size:13px;font-weight:600;color:#0f172a;display:block;margin-bottom:6px;">
            Reason for Rejection *
          </label>
          <textarea id="reasonInput" name="reason" required minlength="1" rows="5"
            style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;
                   border-radius:8px;font-family:inherit;font-size:14px;resize:vertical;"
            placeholder="e.g. Price too high, changed requirements, selected another vendor..."></textarea>
          <div id="errorBox" style="display:none;margin-top:10px;padding:10px 12px;background:#fef2f2;
               border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:13px;"></div>
          <button id="submitBtn" type="submit"
            style="margin-top:16px;width:100%;background:#dc2626;color:white;border:none;
                   padding:12px 20px;border-radius:8px;font-size:15px;font-weight:700;
                   cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
            <span id="submitBtnSpinner" style="display:none;width:15px;height:15px;
                  border:2px solid rgba(255,255,255,0.4);border-top-color:#ffffff;
                  border-radius:50%;animation:rejectSpin 0.7s linear infinite;"></span>
            <span id="submitBtnLabel">Submit Rejection</span>
          </button>
        </form>
        <div style="font-size:11px;color:#94a3b8;margin-top:16px;text-align:center;">
          A reason is required to submit this rejection.
        </div>
      </div>
      <style>
        @keyframes rejectSpin {{ to {{ transform: rotate(360deg); }} }}
      </style>
      <script>
        (function() {{
          var form = document.getElementById('rejectForm');
          var btn = document.getElementById('submitBtn');
          var spinner = document.getElementById('submitBtnSpinner');
          var label = document.getElementById('submitBtnLabel');
          var errorBox = document.getElementById('errorBox');
          var submitting = false;

          function setSubmitting(on) {{
            submitting = on;
            btn.disabled = on;
            btn.style.opacity = on ? '0.75' : '1';
            btn.style.cursor = on ? 'default' : 'pointer';
            spinner.style.display = on ? 'inline-block' : 'none';
            label.textContent = on ? 'Submitting...' : 'Submit Rejection';
          }}

          form.addEventListener('submit', function(e) {{
            e.preventDefault();
            if (submitting) return;
            errorBox.style.display = 'none';
            setSubmitting(true);
            fetch(form.action, {{ method: 'POST', body: new FormData(form) }})
              .then(function(res) {{
                return res.text().then(function(html) {{ return {{ ok: res.ok, html: html }}; }});
              }})
              .then(function(result) {{
                if (result.ok) {{
                  document.open();
                  document.write(result.html);
                  document.close();
                }} else {{
                  errorBox.textContent = 'Something went wrong submitting your rejection. Please try again.';
                  errorBox.style.display = 'block';
                  setSubmitting(false);
                }}
              }})
              .catch(function() {{
                errorBox.textContent = 'Network error — please check your connection and try again.';
                errorBox.style.display = 'block';
                setSubmitting(false);
              }});
          }});
        }})();
      </script>
    </body></html>
    """


def _respond(db: Session, token: str, new_status: str, reason: Optional[str] = None) -> HTMLResponse:
    quotation = db.query(CustomerProjectQuotation).filter(
        CustomerProjectQuotation.ACTION_TOKEN == token
    ).first()
    if not quotation:
        return HTMLResponse(
            _decision_html(
                "Invalid or expired link",
                "This quotation link is invalid. It may have been generated for a different action.",
                color="#dc2626",
            ),
            status_code=404,
        )

    if quotation.QUOTATION_STATUS != "PENDING":
        return _already_responded_page(quotation)

    # Backend-authoritative — never trust that the form's own `required`
    # attribute was honored (a direct POST could omit it entirely).
    if new_status == "REJECTED" and not (reason and reason.strip()):
        return HTMLResponse(
            _decision_html(
                "Reason Required",
                "A reason for rejection is required. Please go back and fill in the reason field.",
                color="#dc2626",
            ),
            status_code=400,
        )

    now = now_ist()
    # Atomic conditional UPDATE — the hard guarantee against a race between
    # two near-simultaneous clicks (e.g. the customer double-clicking, or
    # opening the same email link in two tabs). Only the request that
    # actually flips PENDING -> {new_status} proceeds to update the Lead.
    update_values = {"QUOTATION_STATUS": new_status, "RESPONDED_AT": now}
    if new_status == "REJECTED":
        update_values["REJECTION_REASON"] = reason.strip()
    result = db.execute(
        update(CustomerProjectQuotation)
        .where(
            CustomerProjectQuotation.ID == quotation.ID,
            CustomerProjectQuotation.QUOTATION_STATUS == "PENDING",
        )
        .values(**update_values)
    )

    if result.rowcount == 0:
        db.rollback()
        db.refresh(quotation)
        return _already_responded_page(quotation)

    lead_status = _LEAD_STATUS_MAP.get((quotation.QUOTATION_TYPE, new_status))
    assignment = db.query(CustomerProjectAssignment).filter(
        CustomerProjectAssignment.ID == quotation.ASSIGNMENT_ID
    ).first()
    # Resolved unconditionally (not just inside the Lead-status branch) —
    # both the internal notification and the Purchase Order Request need
    # Customer/Project regardless of whether a Lead row still exists.
    customer = db.query(Customer).filter(Customer.ID == assignment.CUSTOMER_ID).first() if assignment else None
    project = db.query(Project).filter(Project.ID == assignment.PROJECT_ID).first() if assignment else None
    lead = None
    if lead_status and assignment and assignment.LEAD_ID:
        lead = db.query(Lead).filter(Lead.ID == assignment.LEAD_ID).first()
        if lead:
            lead.LEAD_STATUS = lead_status

    db.commit()

    # Best-effort, post-commit — mirrors convert_lead()'s/revise_lead_quotation()'s
    # existing "never roll back an already-committed decision over an email
    # failure" pattern. A repeat click never reaches this point a second
    # time (the early-return above already guarantees single-fire).
    if customer and project:
        try:
            send_quotation_decision_notifications(
                db, vendor_id=assignment.VENDOR_ID, quotation=quotation,
                customer=customer, project=project, lead=lead, decision=new_status,
            )
        except Exception:
            log.exception("quotation_actions: internal notification failed for quotation %s", quotation.ID)

        if new_status == "APPROVED":
            try:
                setting = db.query(LeadModuleSetting).filter(
                    LeadModuleSetting.VENDOR_ID == assignment.VENDOR_ID
                ).first()
                if setting and setting.AUTO_SEND_PO_REQUEST_ENABLED and not quotation.PO_REQUEST_SENT_AT:
                    sent, _message = send_purchase_order_request_email(
                        db, vendor_id=assignment.VENDOR_ID, customer=customer, project=project,
                        quotation=quotation, assignment=assignment,
                    )
                    if sent:
                        quotation.PO_REQUEST_SENT_AT = now_ist()
                        if lead:
                            lead.LEAD_STATUS = "PO_REQUESTED"
                        db.commit()
                        try:
                            send_po_requested_notification(
                                db, vendor_id=assignment.VENDOR_ID, quotation=quotation, assignment=assignment,
                                customer=customer, project=project, lead=lead,
                                request_mode_label="Automatically Requested",
                            )
                        except Exception:
                            log.exception("quotation_actions: PO-requested notification failed for quotation %s", quotation.ID)
            except Exception:
                db.rollback()
                log.exception("quotation_actions: auto purchase-order-request failed for quotation %s", quotation.ID)

    if new_status == "APPROVED":
        return HTMLResponse(_decision_html(
            "Quotation Accepted",
            f"Thank you — your acceptance of quotation "
            f"(&#8377;{quotation.QUOTED_PRICE:,.2f}) has been recorded. Our team will "
            f"be in touch shortly to proceed further.",
            color="#16a34a",
        ))
    return HTMLResponse(_decision_html(
        "Quotation Rejected",
        "Your response has been recorded. If you'd like to discuss this quotation "
        "further, please reach out to our team.",
        color="#dc2626",
    ))


@router.get("/{token}/accept", response_class=HTMLResponse)
def accept_quotation(token: str, db: Session = Depends(get_db)):
    return _respond(db, token, "APPROVED")


@router.get("/{token}/reject", response_class=HTMLResponse)
def reject_quotation_form(token: str, db: Session = Depends(get_db)):
    """Renders the required-reason form rather than deciding immediately —
    a reason is mandatory for rejection (never for acceptance)."""
    quotation = db.query(CustomerProjectQuotation).filter(
        CustomerProjectQuotation.ACTION_TOKEN == token
    ).first()
    if not quotation:
        return HTMLResponse(
            _decision_html(
                "Invalid or expired link",
                "This quotation link is invalid. It may have been generated for a different action.",
                color="#dc2626",
            ),
            status_code=404,
        )
    if quotation.QUOTATION_STATUS != "PENDING":
        return _already_responded_page(quotation)
    return HTMLResponse(_reject_reason_form_html(token))


@router.post("/{token}/reject", response_class=HTMLResponse)
def reject_quotation(token: str, reason: str = Form(...), db: Session = Depends(get_db)):
    return _respond(db, token, "REJECTED", reason=reason)
