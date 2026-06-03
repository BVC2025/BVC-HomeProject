"""
Quality Management endpoints for BVC24.

Three resources:
  - Checklist templates per ProductModel
  - Inspections per WorkOrder (run-through of the template)
  - NCRs auto-created from FAIL/NEEDS_REWORK results

Inspection lifecycle:
  POST /quality/inspections                  -> creates PENDING inspection
                                                + one result row per active
                                                checklist item for that model
  PATCH /quality/results/{id}                -> inspector marks PASS / FAIL / etc.
  POST /quality/inspections/{id}/finalise    -> rollup: if any FAIL -> overall FAIL;
                                                NCRs auto-opened for each
                                                FAIL/NEEDS_REWORK row
"""

from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract

from app.database.database import get_db

from app.models.models import (
    QCChecklistItem,
    QCInspection,
    QCInspectionResult,
    NCR,
    ProductModel,
    WorkOrder,
    Employee,
    Vendor
)

from app.schemas.quality_schema import (
    ChecklistItemCreate,
    ChecklistItemUpdate,
    InspectionCreate,
    InspectionResultUpdate,
    InspectionFinalise,
    NCRUpdate
)


router = APIRouter(prefix="/quality", tags=["Quality Management"])


SEVERITY_LEVELS = {"CRITICAL", "MAJOR", "MINOR"}

RESULT_VALUES = {"PASS", "FAIL", "NEEDS_REWORK", "NA"}

NCR_STATUSES = {"OPEN", "IN_PROGRESS", "CLOSED"}


def _resolve_vendor_id(db: Session, requested: Optional[int]) -> int:

    if requested:

        v = db.query(Vendor).filter(Vendor.ID == requested).first()

        if v:

            # Check this vendor has any QC data; fall through if not
            has_data = (
                db.query(QCInspection)
                .filter(QCInspection.VENDOR_ID == requested)
                .first()
                is not None
            )

            if has_data:

                return requested

    bvc = db.query(Vendor).filter(
        Vendor.VENDOR_NAME == "Bharath Vending Corporation"
    ).first()

    if bvc:

        return bvc.ID

    any_v = db.query(Vendor).first()

    return any_v.ID if any_v else (requested or 1)


def _next_ncr_number(db: Session, vendor_id: int) -> str:
    """
    NCR_NUMBER is globally unique. Use the max existing
    sequence + 1 (not COUNT + 1) so we don't collide with
    rows from other vendors or rows whose count drifted after
    deletes.
    """

    year = datetime.utcnow().year

    prefix = f"NCR-{year}-"

    existing = db.query(NCR.NCR_NUMBER).filter(
        NCR.NCR_NUMBER.like(f"{prefix}%")
    ).all()

    max_seq = 0

    for (num,) in existing:

        try:

            seq = int((num or "").split("-")[-1])

            if seq > max_seq:

                max_seq = seq

        except (ValueError, IndexError):

            continue

    return f"{prefix}{max_seq + 1:04d}"


def _serialize_checklist_item(item: QCChecklistItem) -> dict:

    return {
        "ID": item.ID,
        "PRODUCT_MODEL_ID": item.PRODUCT_MODEL_ID,
        "SEQUENCE": item.SEQUENCE,
        "CHECK_POINT": item.CHECK_POINT,
        "DESCRIPTION": item.DESCRIPTION,
        "SEVERITY": item.SEVERITY,
        "IS_ACTIVE": item.IS_ACTIVE
    }


def _serialize_inspection(
    inspection: QCInspection,
    work_order: Optional[WorkOrder] = None,
    model: Optional[ProductModel] = None,
    inspector: Optional[Employee] = None
) -> dict:

    return {
        "ID": inspection.ID,
        "WORK_ORDER_ID": inspection.WORK_ORDER_ID,
        "WO_NUMBER": work_order.WO_NUMBER if work_order else None,
        "PRODUCT_MODEL_ID": inspection.PRODUCT_MODEL_ID,
        "MODEL_NAME": model.MODEL_NAME if model else None,
        "MODEL_CODE": model.MODEL_CODE if model else None,
        "INSPECTOR_ID": inspection.INSPECTOR_ID,
        "INSPECTOR_NAME": inspector.NAME if inspector else None,
        "INSPECTION_DATE": (
            inspection.INSPECTION_DATE.isoformat()
            if inspection.INSPECTION_DATE else None
        ),
        "STATUS": inspection.STATUS,
        "PASS_COUNT": inspection.PASS_COUNT,
        "FAIL_COUNT": inspection.FAIL_COUNT,
        "REWORK_COUNT": inspection.REWORK_COUNT,
        "NOTES": inspection.NOTES,
        "CREATED_AT": (
            inspection.CREATED_AT.isoformat()
            if inspection.CREATED_AT else None
        )
    }


def _serialize_result(result: QCInspectionResult) -> dict:

    return {
        "ID": result.ID,
        "INSPECTION_ID": result.INSPECTION_ID,
        "CHECKLIST_ITEM_ID": result.CHECKLIST_ITEM_ID,
        "CHECK_POINT": result.CHECK_POINT,
        "RESULT": result.RESULT,
        "NOTES": result.NOTES,
        "RECORDED_AT": (
            result.RECORDED_AT.isoformat()
            if result.RECORDED_AT else None
        )
    }


def _serialize_ncr(ncr: NCR) -> dict:

    return {
        "ID": ncr.ID,
        "NCR_NUMBER": ncr.NCR_NUMBER,
        "INSPECTION_ID": ncr.INSPECTION_ID,
        "WORK_ORDER_ID": ncr.WORK_ORDER_ID,
        "PRODUCT_MODEL_ID": ncr.PRODUCT_MODEL_ID,
        "CHECK_POINT": ncr.CHECK_POINT,
        "SEVERITY": ncr.SEVERITY,
        "DESCRIPTION": ncr.DESCRIPTION,
        "ROOT_CAUSE": ncr.ROOT_CAUSE,
        "CORRECTIVE_ACTION": ncr.CORRECTIVE_ACTION,
        "STATUS": ncr.STATUS,
        "REPORTED_BY_ID": ncr.REPORTED_BY_ID,
        "ASSIGNED_TO_ID": ncr.ASSIGNED_TO_ID,
        "OPENED_AT": (
            ncr.OPENED_AT.isoformat() if ncr.OPENED_AT else None
        ),
        "CLOSED_AT": (
            ncr.CLOSED_AT.isoformat() if ncr.CLOSED_AT else None
        )
    }


# ----------------------------------------------------------------
# Checklist templates
# ----------------------------------------------------------------

@router.post("/checklist-items")
def add_checklist_item(
    data: ChecklistItemCreate,
    db: Session = Depends(get_db)
):

    if data.SEVERITY not in SEVERITY_LEVELS:

        raise HTTPException(
            status_code=400,
            detail=f"SEVERITY must be one of {sorted(SEVERITY_LEVELS)}"
        )

    if not db.query(ProductModel).filter(
        ProductModel.ID == data.PRODUCT_MODEL_ID
    ).first():

        raise HTTPException(
            status_code=404,
            detail="Product model not found"
        )

    item = QCChecklistItem(
        PRODUCT_MODEL_ID=data.PRODUCT_MODEL_ID,
        SEQUENCE=data.SEQUENCE,
        CHECK_POINT=data.CHECK_POINT,
        DESCRIPTION=data.DESCRIPTION,
        SEVERITY=data.SEVERITY
    )

    db.add(item)

    db.commit()

    db.refresh(item)

    return {
        "message": "Checklist item added",
        "item": _serialize_checklist_item(item)
    }


@router.get("/checklist/{model_id}")
def get_checklist(
    model_id: int,
    db: Session = Depends(get_db)
):

    items = (
        db.query(QCChecklistItem)
        .filter(
            QCChecklistItem.PRODUCT_MODEL_ID == model_id,
            QCChecklistItem.IS_ACTIVE == 1
        )
        .order_by(QCChecklistItem.SEQUENCE, QCChecklistItem.ID)
        .all()
    )

    return [_serialize_checklist_item(i) for i in items]


@router.patch("/checklist-items/{item_id}")
def update_checklist_item(
    item_id: int,
    data: ChecklistItemUpdate,
    db: Session = Depends(get_db)
):

    item = db.query(QCChecklistItem).filter(
        QCChecklistItem.ID == item_id
    ).first()

    if not item:

        raise HTTPException(status_code=404, detail="Item not found")

    for field, value in data.dict(exclude_unset=True).items():

        setattr(item, field, value)

    db.commit()

    db.refresh(item)

    return {
        "message": "Checklist item updated",
        "item": _serialize_checklist_item(item)
    }


@router.delete("/checklist-items/{item_id}")
def delete_checklist_item(
    item_id: int,
    db: Session = Depends(get_db)
):

    item = db.query(QCChecklistItem).filter(
        QCChecklistItem.ID == item_id
    ).first()

    if not item:

        raise HTTPException(status_code=404, detail="Item not found")

    item.IS_ACTIVE = 0

    db.commit()

    return {"message": "Checklist item deactivated"}


# ----------------------------------------------------------------
# Inspections
# ----------------------------------------------------------------

@router.post("/inspections")
def create_inspection(
    data: InspectionCreate,
    db: Session = Depends(get_db)
):
    """
    Create a PENDING inspection for a Work Order. Pre-populates
    one result row per active checklist item so the inspector
    just has to fill in PASS/FAIL for each.
    """

    wo = db.query(WorkOrder).filter(
        WorkOrder.ID == data.WORK_ORDER_ID
    ).first()

    if not wo:

        raise HTTPException(
            status_code=404,
            detail="Work order not found"
        )

    # If an inspection already exists for this WO that isn't
    # closed, return it instead of creating a duplicate.
    existing = (
        db.query(QCInspection)
        .filter(
            QCInspection.WORK_ORDER_ID == wo.ID,
            QCInspection.STATUS.in_(["PENDING", "REWORK"])
        )
        .order_by(QCInspection.CREATED_AT.desc())
        .first()
    )

    if existing:

        return {
            "message": "Inspection already in progress for this WO",
            "inspection_id": existing.ID,
            "reused_existing": True
        }

    vendor_id = _resolve_vendor_id(db, data.VENDOR_ID)

    inspection = QCInspection(
        WORK_ORDER_ID=wo.ID,
        PRODUCT_MODEL_ID=wo.PRODUCT_MODEL_ID,
        INSPECTOR_ID=data.INSPECTOR_ID,
        INSPECTION_DATE=date.today(),
        STATUS="PENDING",
        NOTES=data.NOTES,
        VENDOR_ID=vendor_id
    )

    db.add(inspection)

    db.flush()

    # Pre-populate results from the model's active checklist
    items = (
        db.query(QCChecklistItem)
        .filter(
            QCChecklistItem.PRODUCT_MODEL_ID == wo.PRODUCT_MODEL_ID,
            QCChecklistItem.IS_ACTIVE == 1
        )
        .order_by(QCChecklistItem.SEQUENCE, QCChecklistItem.ID)
        .all()
    )

    for item in items:

        result = QCInspectionResult(
            INSPECTION_ID=inspection.ID,
            CHECKLIST_ITEM_ID=item.ID,
            CHECK_POINT=item.CHECK_POINT,
            RESULT="PENDING"
        )

        db.add(result)

    db.commit()

    db.refresh(inspection)

    return {
        "message": "Inspection created",
        "inspection_id": inspection.ID,
        "checklist_items_count": len(items)
    }


@router.get("/inspections")
def list_inspections(
    vendor_id: int = 1,
    status: Optional[str] = None,
    work_order_id: Optional[int] = None,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    q = (
        db.query(
            QCInspection,
            WorkOrder,
            ProductModel,
            Employee
        )
        .outerjoin(
            WorkOrder,
            QCInspection.WORK_ORDER_ID == WorkOrder.ID
        )
        .outerjoin(
            ProductModel,
            QCInspection.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .outerjoin(
            Employee,
            QCInspection.INSPECTOR_ID == Employee.ID
        )
        .filter(QCInspection.VENDOR_ID == vendor_id)
    )

    if status:

        q = q.filter(QCInspection.STATUS == status)

    if work_order_id:

        q = q.filter(QCInspection.WORK_ORDER_ID == work_order_id)

    rows = q.order_by(QCInspection.CREATED_AT.desc()).all()

    return [
        _serialize_inspection(insp, wo, model, inspector)
        for insp, wo, model, inspector in rows
    ]


@router.get("/inspections/{inspection_id}")
def get_inspection(
    inspection_id: int,
    db: Session = Depends(get_db)
):

    row = (
        db.query(QCInspection, WorkOrder, ProductModel, Employee)
        .outerjoin(
            WorkOrder,
            QCInspection.WORK_ORDER_ID == WorkOrder.ID
        )
        .outerjoin(
            ProductModel,
            QCInspection.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .outerjoin(
            Employee,
            QCInspection.INSPECTOR_ID == Employee.ID
        )
        .filter(QCInspection.ID == inspection_id)
        .first()
    )

    if not row:

        raise HTTPException(
            status_code=404,
            detail="Inspection not found"
        )

    insp, wo, model, inspector = row

    results = (
        db.query(QCInspectionResult)
        .filter(QCInspectionResult.INSPECTION_ID == inspection_id)
        .order_by(QCInspectionResult.ID)
        .all()
    )

    return {
        "inspection": _serialize_inspection(insp, wo, model, inspector),
        "results": [_serialize_result(r) for r in results]
    }


@router.patch("/results/{result_id}")
def update_result(
    result_id: int,
    data: InspectionResultUpdate,
    db: Session = Depends(get_db)
):

    if data.RESULT not in RESULT_VALUES:

        raise HTTPException(
            status_code=400,
            detail=f"RESULT must be one of {sorted(RESULT_VALUES)}"
        )

    result = db.query(QCInspectionResult).filter(
        QCInspectionResult.ID == result_id
    ).first()

    if not result:

        raise HTTPException(status_code=404, detail="Result not found")

    result.RESULT = data.RESULT

    result.NOTES = data.NOTES or result.NOTES

    result.RECORDED_AT = datetime.utcnow()

    # Live-update the parent inspection's rollup counts
    insp = db.query(QCInspection).filter(
        QCInspection.ID == result.INSPECTION_ID
    ).first()

    if insp:

        rows = db.query(QCInspectionResult).filter(
            QCInspectionResult.INSPECTION_ID == insp.ID
        ).all()

        insp.PASS_COUNT = sum(1 for r in rows if r.RESULT == "PASS")

        insp.FAIL_COUNT = sum(1 for r in rows if r.RESULT == "FAIL")

        insp.REWORK_COUNT = sum(
            1 for r in rows if r.RESULT == "NEEDS_REWORK"
        )

    db.commit()

    db.refresh(result)

    return {
        "message": "Result updated",
        "result": _serialize_result(result)
    }


@router.post("/inspections/{inspection_id}/finalise")
def finalise_inspection(
    inspection_id: int,
    data: InspectionFinalise,
    db: Session = Depends(get_db)
):
    """
    Lock in the inspection. Computes overall PASS/FAIL/REWORK
    from the per-item results and (if needed) opens an NCR per
    FAIL or NEEDS_REWORK row so corrective action can be tracked
    independently from the inspection.
    """

    insp = db.query(QCInspection).filter(
        QCInspection.ID == inspection_id
    ).first()

    if not insp:

        raise HTTPException(status_code=404, detail="Inspection not found")

    results = db.query(QCInspectionResult).filter(
        QCInspectionResult.INSPECTION_ID == inspection_id
    ).all()

    fails = [r for r in results if r.RESULT == "FAIL"]

    reworks = [r for r in results if r.RESULT == "NEEDS_REWORK"]

    passes = [r for r in results if r.RESULT == "PASS"]

    insp.PASS_COUNT = len(passes)

    insp.FAIL_COUNT = len(fails)

    insp.REWORK_COUNT = len(reworks)

    if fails:

        insp.STATUS = "FAIL"

    elif reworks:

        insp.STATUS = "REWORK"

    else:

        insp.STATUS = "PASS"

    if data.NOTES:

        insp.NOTES = (insp.NOTES or "") + f"\n[finalise] {data.NOTES}"

    # Auto-open NCRs for each FAIL / REWORK item
    ncrs_created = []

    for r in fails + reworks:

        # Find severity from the checklist item template
        severity = "MAJOR"

        if r.CHECKLIST_ITEM_ID:

            item = db.query(QCChecklistItem).filter(
                QCChecklistItem.ID == r.CHECKLIST_ITEM_ID
            ).first()

            if item:

                severity = item.SEVERITY

        ncr = NCR(
            NCR_NUMBER=_next_ncr_number(db, insp.VENDOR_ID),
            INSPECTION_ID=insp.ID,
            WORK_ORDER_ID=insp.WORK_ORDER_ID,
            PRODUCT_MODEL_ID=insp.PRODUCT_MODEL_ID,
            CHECK_POINT=r.CHECK_POINT,
            SEVERITY=severity,
            DESCRIPTION=(
                f"Inspection {insp.ID} flagged '{r.CHECK_POINT}' "
                f"as {r.RESULT}. "
                f"{r.NOTES or '(no inspector notes)'}"
            ),
            STATUS="OPEN",
            REPORTED_BY_ID=insp.INSPECTOR_ID,
            VENDOR_ID=insp.VENDOR_ID
        )

        db.add(ncr)

        db.flush()

        ncrs_created.append(ncr.ID)

    db.commit()

    db.refresh(insp)

    return {
        "message": f"Inspection finalised — {insp.STATUS}",
        "inspection_id": insp.ID,
        "status": insp.STATUS,
        "pass_count": insp.PASS_COUNT,
        "fail_count": insp.FAIL_COUNT,
        "rework_count": insp.REWORK_COUNT,
        "ncrs_opened": ncrs_created
    }


# ----------------------------------------------------------------
# NCRs
# ----------------------------------------------------------------

@router.get("/ncrs")
def list_ncrs(
    vendor_id: int = 1,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    q = db.query(NCR).filter(NCR.VENDOR_ID == vendor_id)

    if status:

        q = q.filter(NCR.STATUS == status)

    if severity:

        q = q.filter(NCR.SEVERITY == severity)

    rows = q.order_by(NCR.OPENED_AT.desc()).all()

    return [_serialize_ncr(n) for n in rows]


@router.patch("/ncrs/{ncr_id}")
def update_ncr(
    ncr_id: int,
    data: NCRUpdate,
    db: Session = Depends(get_db)
):

    ncr = db.query(NCR).filter(NCR.ID == ncr_id).first()

    if not ncr:

        raise HTTPException(status_code=404, detail="NCR not found")

    if data.STATUS and data.STATUS not in NCR_STATUSES:

        raise HTTPException(
            status_code=400,
            detail=f"STATUS must be one of {sorted(NCR_STATUSES)}"
        )

    if data.SEVERITY and data.SEVERITY not in SEVERITY_LEVELS:

        raise HTTPException(
            status_code=400,
            detail=f"SEVERITY must be one of {sorted(SEVERITY_LEVELS)}"
        )

    for field, value in data.dict(exclude_unset=True).items():

        setattr(ncr, field, value)

    if data.STATUS == "CLOSED" and not ncr.CLOSED_AT:

        ncr.CLOSED_AT = datetime.utcnow()

    db.commit()

    db.refresh(ncr)

    return {
        "message": "NCR updated",
        "ncr": _serialize_ncr(ncr)
    }


# ----------------------------------------------------------------
# Dashboard
# ----------------------------------------------------------------

@router.get("/dashboard")
def quality_dashboard(
    vendor_id: int = 1,
    db: Session = Depends(get_db)
):

    vendor_id = _resolve_vendor_id(db, vendor_id)

    total_inspections = db.query(QCInspection).filter(
        QCInspection.VENDOR_ID == vendor_id
    ).count()

    by_status = {}

    for s in ["PENDING", "PASS", "FAIL", "REWORK"]:

        by_status[s] = (
            db.query(QCInspection)
            .filter(
                QCInspection.VENDOR_ID == vendor_id,
                QCInspection.STATUS == s
            )
            .count()
        )

    total_ncrs = db.query(NCR).filter(
        NCR.VENDOR_ID == vendor_id
    ).count()

    open_ncrs = db.query(NCR).filter(
        NCR.VENDOR_ID == vendor_id,
        NCR.STATUS.in_(["OPEN", "IN_PROGRESS"])
    ).count()

    critical_open = db.query(NCR).filter(
        NCR.VENDOR_ID == vendor_id,
        NCR.STATUS.in_(["OPEN", "IN_PROGRESS"]),
        NCR.SEVERITY == "CRITICAL"
    ).count()

    pass_rate = (
        round(by_status["PASS"] / total_inspections * 100, 1)
        if total_inspections else 0
    )

    return {
        "total_inspections": total_inspections,
        "by_status": by_status,
        "pass_rate_pct": pass_rate,
        "total_ncrs": total_ncrs,
        "open_ncrs": open_ncrs,
        "critical_open_ncrs": critical_open
    }
