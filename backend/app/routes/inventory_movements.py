"""
Inventory Movement audit trail — append-only stock ledger.
Rows are created by inventory_automation_service.record_movement()
and are NEVER updated after insert.

REFERENCE_TYPE/REFERENCE_ID is a generic polymorphic pair — "PO"/"GRN"
resolve back to a PurchaseOrder/GoodsReceiptNote, "CUSTOMER_PROJECT_
ASSIGNMENT" (set by inventory_consumption_service when production
consumes project-required materials) resolves back to a
CustomerProjectAssignment (and from there Customer/Project/Lead).
"""

import io
from datetime import datetime
from typing import Optional

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.inventory_models import InventoryMovement, ProductMaster
from app.models.models import PurchaseOrder, GoodsReceiptNote
from app.models.customer_models import CustomerProjectAssignment, Customer
from app.models.project_models import Project
from app.auth.auth_bearer import require

router = APIRouter(prefix="/inventory-movements", tags=["Inventory Movements"])


def _apply_customer_project_filters(q, customer_id: Optional[str], project_id: Optional[str]):
    """Outer-joins CustomerProjectAssignment only for rows whose
    REFERENCE_TYPE is CUSTOMER_PROJECT_ASSIGNMENT — movements referencing
    a PO/GRN don't resolve to a customer and must still show up when no
    customer/project filter is applied."""
    if not customer_id and not project_id:
        return q
    q = q.outerjoin(
        CustomerProjectAssignment,
        (InventoryMovement.REFERENCE_TYPE == "CUSTOMER_PROJECT_ASSIGNMENT")
        & (InventoryMovement.REFERENCE_ID == CustomerProjectAssignment.ID),
    )
    if customer_id:
        q = q.filter(CustomerProjectAssignment.CUSTOMER_ID == customer_id)
    if project_id:
        q = q.filter(CustomerProjectAssignment.PROJECT_ID == project_id)
    return q


def _resolve_references(db: Session, rows: list) -> dict:
    """Batch-resolves every row's REFERENCE_ID to a human-readable label
    (and, for CUSTOMER_PROJECT_ASSIGNMENT rows, customer/project/lead
    ids/names), keyed by (REFERENCE_TYPE, REFERENCE_ID) -> dict."""
    po_ids, grn_ids, assignment_ids = set(), set(), set()
    for r in rows:
        if r.REFERENCE_TYPE == "PO" and r.REFERENCE_ID:
            po_ids.add(r.REFERENCE_ID)
        elif r.REFERENCE_TYPE == "GRN" and r.REFERENCE_ID:
            grn_ids.add(r.REFERENCE_ID)
        elif r.REFERENCE_TYPE == "CUSTOMER_PROJECT_ASSIGNMENT" and r.REFERENCE_ID:
            assignment_ids.add(r.REFERENCE_ID)

    resolved: dict = {}
    if po_ids:
        for po in db.query(PurchaseOrder).filter(PurchaseOrder.ID.in_([int(i) for i in po_ids if i.isdigit()])).all():
            resolved[("PO", str(po.ID))] = {"label": po.PO_NUMBER}
    if grn_ids:
        for grn in db.query(GoodsReceiptNote).filter(GoodsReceiptNote.ID.in_([int(i) for i in grn_ids if i.isdigit()])).all():
            resolved[("GRN", str(grn.ID))] = {"label": grn.GRN_NUMBER}
    if assignment_ids:
        rows2 = (
            db.query(CustomerProjectAssignment, Customer, Project)
            .join(Customer, Customer.ID == CustomerProjectAssignment.CUSTOMER_ID)
            .join(Project, Project.ID == CustomerProjectAssignment.PROJECT_ID)
            .filter(CustomerProjectAssignment.ID.in_(assignment_ids))
            .all()
        )
        for assignment, customer, project in rows2:
            resolved[("CUSTOMER_PROJECT_ASSIGNMENT", assignment.ID)] = {
                "label": f"{customer.NAME} — {project.NAME}",
                "customer_id": customer.ID,
                "customer_name": customer.NAME,
                "project_id": project.ID,
                "project_name": project.NAME,
                "lead_id": assignment.LEAD_ID,
            }
    return resolved


def _serialize_movement(m: InventoryMovement, resolved: Optional[dict] = None) -> dict:
    d = {
        "ID": m.ID,
        "PRODUCT_ID": m.PRODUCT_ID,
        "PRODUCT_CODE": m.product.PRODUCT_CODE if m.product else None,
        "PRODUCT_NAME": m.product.PRODUCT_NAME if m.product else None,
        "MOVEMENT_TYPE": m.MOVEMENT_TYPE,
        "QTY": m.QTY,
        "QTY_BEFORE": m.QTY_BEFORE,
        "QTY_AFTER": m.QTY_AFTER,
        "DIFFERENCE": m.QTY_AFTER - m.QTY_BEFORE,
        "UNIT_COST": m.UNIT_COST,
        "REFERENCE_TYPE": m.REFERENCE_TYPE,
        "REFERENCE_ID": m.REFERENCE_ID,
        "BATCH_ID": m.BATCH_ID,
        "REASON": m.REASON,
        "NOTES": m.NOTES,
        "PERFORMED_BY_ID": m.PERFORMED_BY_ID,
        "PERFORMED_BY_NAME": m.performed_by.NAME if m.performed_by else None,
        "CREATED_AT": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
    }
    key = (m.REFERENCE_TYPE, m.REFERENCE_ID)
    if resolved and key in resolved:
        d["reference_detail"] = resolved[key]
    else:
        d["reference_detail"] = None
    return d


@router.get("", dependencies=[Depends(require("inventory.view", "inventory.movements.view"))])
def list_movements(
    vendor_id: int = Query(1),
    product_id: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    movement_type: Optional[str] = Query(None),
    reference_type: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    q = db.query(InventoryMovement).filter(InventoryMovement.VENDOR_ID == vendor_id)
    if product_id:
        q = q.filter(InventoryMovement.PRODUCT_ID == product_id)
    if movement_type:
        q = q.filter(InventoryMovement.MOVEMENT_TYPE == movement_type.upper())
    if reference_type:
        q = q.filter(InventoryMovement.REFERENCE_TYPE == reference_type.upper())
    if from_date:
        try:
            q = q.filter(InventoryMovement.CREATED_AT >= datetime.fromisoformat(from_date))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid from_date format (use YYYY-MM-DD)")
    if to_date:
        try:
            q = q.filter(InventoryMovement.CREATED_AT <= datetime.fromisoformat(to_date + "T23:59:59"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid to_date format (use YYYY-MM-DD)")
    q = _apply_customer_project_filters(q, customer_id, project_id)

    total = q.count()
    rows = q.order_by(InventoryMovement.CREATED_AT.desc()).offset((page - 1) * page_size).limit(page_size).all()
    resolved = _resolve_references(db, rows)

    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [_serialize_movement(m, resolved) for m in rows],
    }


@router.get("/{product_id}/history", dependencies=[Depends(require("inventory.view", "inventory.movements.view"))])
def get_item_history(
    product_id: str,
    vendor_id: int = Query(1),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    """All movements for a single product, most recent first."""
    product = db.query(ProductMaster).filter(
        ProductMaster.ID == product_id,
        ProductMaster.VENDOR_ID == vendor_id,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    q = db.query(InventoryMovement).filter(InventoryMovement.PRODUCT_ID == product_id)
    total = q.count()
    rows = q.order_by(InventoryMovement.CREATED_AT.desc()).offset((page - 1) * page_size).limit(page_size).all()
    resolved = _resolve_references(db, rows)
    return {
        "product_id": product_id,
        "total": total, "page": page, "page_size": page_size,
        "movements": [_serialize_movement(m, resolved) for m in rows],
    }


@router.get("/export/excel", dependencies=[Depends(require("inventory.view", "inventory.movements.view", "inventory.movements.export"))])
def export_movements(
    vendor_id: int = Query(1),
    product_id: Optional[str] = Query(None),
    customer_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(InventoryMovement).filter(InventoryMovement.VENDOR_ID == vendor_id)
    if product_id:
        q = q.filter(InventoryMovement.PRODUCT_ID == product_id)
    if from_date:
        q = q.filter(InventoryMovement.CREATED_AT >= datetime.fromisoformat(from_date))
    if to_date:
        q = q.filter(InventoryMovement.CREATED_AT <= datetime.fromisoformat(to_date + "T23:59:59"))
    q = _apply_customer_project_filters(q, customer_id, project_id)
    rows = q.order_by(InventoryMovement.CREATED_AT.desc()).all()
    resolved = _resolve_references(db, rows)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Movements"
    ws.append([
        "MOVEMENT ID", "PRODUCT CODE", "PRODUCT NAME", "TYPE", "QTY", "QTY BEFORE", "QTY AFTER",
        "DIFFERENCE", "UNIT COST", "REFERENCE TYPE", "REFERENCE", "REASON", "CREATED AT",
    ])
    for r in rows:
        detail = resolved.get((r.REFERENCE_TYPE, r.REFERENCE_ID))
        ws.append([
            r.ID, r.product.PRODUCT_CODE if r.product else "", r.product.PRODUCT_NAME if r.product else "",
            r.MOVEMENT_TYPE, r.QTY, r.QTY_BEFORE, r.QTY_AFTER, r.QTY_AFTER - r.QTY_BEFORE,
            r.UNIT_COST or "", r.REFERENCE_TYPE or "", detail["label"] if detail else (r.REFERENCE_ID or ""),
            r.REASON or "",
            r.CREATED_AT.isoformat() if r.CREATED_AT else "",
        ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=inventory_movements_export.xlsx"},
    )
