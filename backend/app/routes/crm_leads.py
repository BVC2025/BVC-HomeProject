"""
CRM Leads — Phase 1 of the CRM & Sales workflow redesign.

The pre-customer pipeline: NEW -> ASSIGNED -> CONTACTED -> QUALIFIED ->
REQUIREMENT_DISCUSSION -> PROPOSAL_NEEDED -> QUOTATION_REQUESTED ->
QUOTATION_GENERATED -> NEGOTIATION -> WON / LOST / CANCELLED.

A lead only ever becomes a Customer via POST /crm/leads/{id}/convert
(crm_conversion_service.convert_lead_to_customer) — nothing here writes
to the Customer table directly.

Permission-gated (RBAC sweep): crm_lead.view on reads, crm_lead.manage on
every mutation (create/update/activity/convert/delete).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.crm_models import CrmLead, CrmActivity
from app.models.models import Employee
from app.schemas.crm_lead_schema import CrmLeadCreate, CrmLeadUpdate, CrmActivityCreate
from app.services.crm_conversion_service import convert_lead_to_customer
from app.auth.auth_bearer import require

router = APIRouter()

_VIEW_DEP = Depends(require("crm_lead.view"))
_MANAGE_DEP = Depends(require("crm_lead.manage"))


def _next_lead_code(db: Session, vendor_id: int) -> str:

    count = db.query(CrmLead).filter(CrmLead.VENDOR_ID == vendor_id).count()

    return f"LEAD-{count + 1:03d}"


def _serialize_lead(lead: CrmLead, sales_name: str = None) -> dict:

    return {
        "ID": lead.ID,
        "LEAD_CODE": lead.LEAD_CODE,
        "VENDOR_ID": lead.VENDOR_ID,
        "COMPANY_NAME": lead.COMPANY_NAME,
        "CONTACT_PERSON": lead.CONTACT_PERSON,
        "DESIGNATION": lead.DESIGNATION,
        "PHONE": lead.PHONE,
        "WHATSAPP_NUMBER": lead.WHATSAPP_NUMBER,
        "EMAIL": lead.EMAIL,
        "CITY": lead.CITY,
        "STATE": lead.STATE,
        "SOURCE": lead.SOURCE,
        "EXTERNAL_REFERENCE_ID": lead.EXTERNAL_REFERENCE_ID,
        "STATUS": lead.STATUS,
        "PRIORITY": lead.PRIORITY,
        "SCORE": lead.SCORE,
        "ASSIGNED_SALES_ID": lead.ASSIGNED_SALES_ID,
        "ASSIGNED_SALES_NAME": sales_name,
        "FOLLOW_UP_DATE": lead.FOLLOW_UP_DATE.isoformat() if lead.FOLLOW_UP_DATE else None,
        "NEXT_MEETING_DATE": lead.NEXT_MEETING_DATE.isoformat() if lead.NEXT_MEETING_DATE else None,
        "REQUIREMENT_NOTES": lead.REQUIREMENT_NOTES,
        "LOST_REASON": lead.LOST_REASON,
        "CONVERTED_CUSTOMER_ID": lead.CONVERTED_CUSTOMER_ID,
        "CREATED_AT": lead.CREATED_AT.isoformat() if lead.CREATED_AT else None,
        "UPDATED_AT": lead.UPDATED_AT.isoformat() if lead.UPDATED_AT else None,
    }


@router.get("/crm/leads", dependencies=[_VIEW_DEP])
def get_crm_leads(db: Session = Depends(get_db)):
    """All CRM leads, newest first, with resolved sales-person name
    (one bulk query, no N+1) — same pattern as GET /customers."""

    leads = db.query(CrmLead).order_by(CrmLead.CREATED_AT.desc()).all()

    sales_ids = {l.ASSIGNED_SALES_ID for l in leads if l.ASSIGNED_SALES_ID}

    sales_names = {}

    if sales_ids:
        for emp in db.query(Employee).filter(Employee.ID.in_(sales_ids)).all():
            sales_names[emp.ID] = emp.NAME

    return [
        _serialize_lead(l, sales_names.get(l.ASSIGNED_SALES_ID))
        for l in leads
    ]


@router.get("/crm/leads/{lead_id}", dependencies=[_VIEW_DEP])
def get_crm_lead(lead_id: int, db: Session = Depends(get_db)):

    lead = db.query(CrmLead).filter(CrmLead.ID == lead_id).first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    sales_name = None

    if lead.ASSIGNED_SALES_ID:
        emp = db.query(Employee).filter(Employee.ID == lead.ASSIGNED_SALES_ID).first()
        sales_name = emp.NAME if emp else None

    return _serialize_lead(lead, sales_name)


@router.post("/crm/leads", dependencies=[_MANAGE_DEP])
def create_crm_lead(data: CrmLeadCreate, db: Session = Depends(get_db)):

    code = _next_lead_code(db, data.VENDOR_ID)

    lead = CrmLead(
        LEAD_CODE=code,
        VENDOR_ID=data.VENDOR_ID,
        COMPANY_NAME=data.COMPANY_NAME,
        CONTACT_PERSON=data.CONTACT_PERSON,
        DESIGNATION=data.DESIGNATION,
        PHONE=data.PHONE,
        WHATSAPP_NUMBER=data.WHATSAPP_NUMBER,
        EMAIL=data.EMAIL,
        CITY=data.CITY,
        STATE=data.STATE,
        SOURCE=data.SOURCE or "MANUAL",
        EXTERNAL_REFERENCE_ID=data.EXTERNAL_REFERENCE_ID,
        STATUS="NEW",
        PRIORITY=data.PRIORITY or "MEDIUM",
        ASSIGNED_SALES_ID=data.ASSIGNED_SALES_ID,
        FOLLOW_UP_DATE=data.FOLLOW_UP_DATE,
        REQUIREMENT_NOTES=data.REQUIREMENT_NOTES,
    )

    db.add(lead)
    db.flush()

    db.add(CrmActivity(
        CRM_LEAD_ID=lead.ID,
        EVENT_TYPE="CREATED",
        EVENT_DETAIL=f"Lead created via {lead.SOURCE}",
        ACTOR_TYPE="SYSTEM",
    ))

    db.commit()
    db.refresh(lead)

    return _serialize_lead(lead)


@router.patch("/crm/leads/{lead_id}", dependencies=[_MANAGE_DEP])
def update_crm_lead(lead_id: int, data: CrmLeadUpdate, db: Session = Depends(get_db)):

    lead = db.query(CrmLead).filter(CrmLead.ID == lead_id).first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if lead.CONVERTED_CUSTOMER_ID:
        raise HTTPException(
            status_code=409,
            detail="This lead has already been converted to a customer and is read-only."
        )

    updates = data.dict(exclude_unset=True)

    old_status = lead.STATUS
    new_status = updates.get("STATUS")

    if new_status == "WON":
        raise HTTPException(
            status_code=400,
            detail="Use POST /crm/leads/{id}/convert to move a lead to Won — "
                   "that also creates the Customer record."
        )

    for field, value in updates.items():
        setattr(lead, field, value)

    if new_status and new_status != old_status:
        db.add(CrmActivity(
            CRM_LEAD_ID=lead.ID,
            EVENT_TYPE="STATUS_CHANGE",
            EVENT_DETAIL=f"{old_status} → {new_status}",
            ACTOR_TYPE="SALES",
        ))
        if new_status == "LOST":
            db.add(CrmActivity(
                CRM_LEAD_ID=lead.ID,
                EVENT_TYPE="LOST",
                EVENT_DETAIL=lead.LOST_REASON or "No reason given",
                ACTOR_TYPE="SALES",
            ))

    db.commit()
    db.refresh(lead)

    return _serialize_lead(lead)


@router.get("/crm/leads/{lead_id}/activities", dependencies=[_VIEW_DEP])
def get_crm_lead_activities(lead_id: int, db: Session = Depends(get_db)):

    lead = db.query(CrmLead).filter(CrmLead.ID == lead_id).first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    rows = db.query(CrmActivity).filter(
        CrmActivity.CRM_LEAD_ID == lead_id
    ).order_by(CrmActivity.CREATED_AT.desc()).all()

    return [
        {
            "ID": a.ID,
            "EVENT_TYPE": a.EVENT_TYPE,
            "EVENT_DETAIL": a.EVENT_DETAIL,
            "ACTOR_TYPE": a.ACTOR_TYPE,
            "ACTOR_NAME": a.ACTOR_NAME,
            "CREATED_AT": a.CREATED_AT.isoformat() if a.CREATED_AT else None,
        }
        for a in rows
    ]


@router.post("/crm/leads/{lead_id}/activities", dependencies=[_MANAGE_DEP])
def add_crm_lead_activity(lead_id: int, data: CrmActivityCreate, db: Session = Depends(get_db)):

    lead = db.query(CrmLead).filter(CrmLead.ID == lead_id).first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    activity = CrmActivity(
        CRM_LEAD_ID=lead_id,
        EVENT_TYPE=data.EVENT_TYPE,
        EVENT_DETAIL=data.EVENT_DETAIL,
        ACTOR_TYPE="SALES",
        ACTOR_NAME=data.ACTOR_NAME,
    )

    db.add(activity)
    db.commit()
    db.refresh(activity)

    return {
        "ID": activity.ID,
        "EVENT_TYPE": activity.EVENT_TYPE,
        "EVENT_DETAIL": activity.EVENT_DETAIL,
        "ACTOR_TYPE": activity.ACTOR_TYPE,
        "ACTOR_NAME": activity.ACTOR_NAME,
        "CREATED_AT": activity.CREATED_AT.isoformat(),
    }


@router.post("/crm/leads/{lead_id}/convert", dependencies=[_MANAGE_DEP])
def convert_crm_lead(lead_id: int, db: Session = Depends(get_db)):
    """Won -> Customer. See crm_conversion_service.convert_lead_to_customer
    for exactly what this creates."""

    try:
        result = convert_lead_to_customer(db, lead_id)

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return result


@router.delete("/crm/leads/{lead_id}", dependencies=[_MANAGE_DEP])
def delete_crm_lead(lead_id: int, db: Session = Depends(get_db)):

    lead = db.query(CrmLead).filter(CrmLead.ID == lead_id).first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    if lead.CONVERTED_CUSTOMER_ID:
        raise HTTPException(
            status_code=409,
            detail="This lead has already been converted to a customer — "
                   "delete the customer record instead if needed."
        )

    db.delete(lead)  # cascades to CrmActivity via relationship
    db.commit()

    return {"message": f"Lead {lead.LEAD_CODE} deleted"}
