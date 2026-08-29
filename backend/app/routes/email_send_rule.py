"""Email Send Rule — configures which employees receive an internal
notification email for a given business event (today: a customer
approving/rejecting a Final or Revised Quotation). See
services/email_send_rule_service.py for the recipient-resolution/dedup
logic consumed by the quotation-approval flow (quotation_actions.py)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.utils.db_error_handler import raise_db_error
from app.auth.auth_bearer import require
from app.models.email_send_rule_models import EmailSendRule, EMAIL_SEND_RULE_EVENT_ENUM
from app.schemas.email_send_rule_schema import EmailSendRuleUpdate
from app.services.email_send_rule_service import get_rule, replace_recipients, _serialize_rule

router = APIRouter(prefix="/email-send-rules", tags=["Email Send Rule"])

_VALID_EVENT_TYPES = set(EMAIL_SEND_RULE_EVENT_ENUM.enums)


@router.get("")
def list_email_send_rules(
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    _admin=Depends(require("system.email_send_rule.view")),
):
    rows = db.query(EmailSendRule).filter(EmailSendRule.VENDOR_ID == vendor_id).all()
    return {"rows": [_serialize_rule(r) for r in rows]}


@router.get("/{event_type}")
def get_email_send_rule(
    event_type: str,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    _admin=Depends(require("system.email_send_rule.view")),
):
    # Not-yet-configured is a normal, expected first-run state — return an
    # empty-recipients shape rather than 404, so the frontend renders
    # cleanly without a special-cased error branch.
    return _serialize_rule(get_rule(db, vendor_id, event_type))


@router.put("/{event_type}")
def update_email_send_rule(
    event_type: str,
    data: EmailSendRuleUpdate,
    vendor_id: int = Query(1),
    db: Session = Depends(get_db),
    _admin=Depends(require("system.email_send_rule.manage")),
):
    if event_type not in _VALID_EVENT_TYPES:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Unknown event type '{event_type}'.")

    try:
        rule = replace_recipients(
            db, vendor_id, event_type,
            [r.model_dump() for r in data.RECIPIENTS],
        )
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise_db_error(e, "update email send rule")
    except Exception as e:
        db.rollback()
        raise_db_error(e, "update email send rule")

    db.refresh(rule)
    return {"message": "Email send rule updated", **_serialize_rule(rule)}
