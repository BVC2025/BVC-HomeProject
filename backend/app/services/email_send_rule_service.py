"""Resolves an Email Send Rule's configured recipients into the actual
list of Employees to notify for one specific business event instance
(e.g. one Lead's quotation decision) — deduplicating so an employee who is
both the Lead Owner and an explicitly-listed recipient is only notified
once, and filtering out anyone who can't actually receive an email
(inactive, or no address on file)."""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Employee
from app.models.email_send_rule_models import EmailSendRule, EmailSendRuleRecipient
from app.models.lead_models import Lead

log = logging.getLogger(__name__)


def _serialize_rule(rule: Optional[EmailSendRule]) -> dict:
    if not rule:
        return {"EVENT_TYPE": None, "RECIPIENTS": []}
    recipients = []
    for r in rule.recipients:
        recipients.append({
            "ID": r.ID,
            "EMPLOYEE_ID": r.EMPLOYEE_ID,
            "IS_LEAD_OWNER": r.IS_LEAD_OWNER,
        })
    return {
        "ID": rule.ID,
        "EVENT_TYPE": rule.EVENT_TYPE,
        "RECIPIENTS": recipients,
        "CREATED_AT": rule.CREATED_AT.isoformat() if rule.CREATED_AT else None,
        "UPDATED_AT": rule.UPDATED_AT.isoformat() if rule.UPDATED_AT else None,
    }


def get_rule(db: Session, vendor_id: int, event_type: str) -> Optional[EmailSendRule]:
    return db.query(EmailSendRule).filter(
        EmailSendRule.VENDOR_ID == vendor_id, EmailSendRule.EVENT_TYPE == event_type,
    ).first()


def replace_recipients(db: Session, vendor_id: int, event_type: str, recipients: list) -> EmailSendRule:
    """Wholesale replace — mirrors EmailTemplate's own PUT-replace
    convention. `recipients` is a list of {"EMPLOYEE_ID": str} or
    {"IS_LEAD_OWNER": True} dicts. Dedupes server-side (Req: must not rely
    only on frontend validation) before insert: unique EMPLOYEE_IDs, and
    at most one IS_LEAD_OWNER row. Single transaction — caller commits."""
    rule = get_rule(db, vendor_id, event_type)
    if not rule:
        rule = EmailSendRule(VENDOR_ID=vendor_id, EVENT_TYPE=event_type)
        db.add(rule)
        db.flush()
    else:
        for r in list(rule.recipients):
            db.delete(r)
        db.flush()

    seen_employee_ids = set()
    lead_owner_added = False
    for item in recipients or []:
        if item.get("IS_LEAD_OWNER"):
            if lead_owner_added:
                continue
            db.add(EmailSendRuleRecipient(RULE_ID=rule.ID, IS_LEAD_OWNER=True))
            lead_owner_added = True
            continue
        emp_id = item.get("EMPLOYEE_ID")
        if not emp_id or emp_id in seen_employee_ids:
            continue
        seen_employee_ids.add(emp_id)
        db.add(EmailSendRuleRecipient(RULE_ID=rule.ID, EMPLOYEE_ID=emp_id, IS_LEAD_OWNER=False))

    db.flush()
    return rule


def resolve_recipients(db: Session, vendor_id: int, event_type: str, lead: Optional[Lead] = None) -> list:
    """Returns the deduplicated list of Employee rows that should be
    notified for this event instance. Silently returns [] if the rule
    isn't configured yet (a valid, expected state — not an error)."""
    rule = get_rule(db, vendor_id, event_type)
    if not rule or not rule.recipients:
        return []

    employee_ids = set()
    for r in rule.recipients:
        if r.IS_LEAD_OWNER:
            if lead is not None and lead.ASSIGNED_TO_ID:
                employee_ids.add(lead.ASSIGNED_TO_ID)
            else:
                log.info("resolve_recipients: rule %s has a Lead Owner recipient but no lead/owner to resolve", rule.ID)
        elif r.EMPLOYEE_ID:
            employee_ids.add(r.EMPLOYEE_ID)

    if not employee_ids:
        return []

    employees = db.query(Employee).filter(Employee.ID.in_(employee_ids)).all()
    resolved = []
    for emp in employees:
        if getattr(emp, "STATUS", "ACTIVE") != "ACTIVE":
            log.info("resolve_recipients: skipping inactive employee %s", emp.ID)
            continue
        if not (emp.EMAIL or "").strip():
            log.info("resolve_recipients: skipping employee %s — no email on file", emp.ID)
            continue
        resolved.append(emp)
    return resolved
