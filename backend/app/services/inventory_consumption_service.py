"""
Production-triggered inventory consumption.

When a CustomerProjectAssignment's production schedule is locked in
(approve_schedule() / reject_and_reschedule() in
production_scheduling_service.py), the project's configured
ProjectProductRequirement rows tell us which products — and how many of
each — that project consumes per unit. This service multiplies each
requirement by the assignment's QUANTITY and consumes that much stock,
FIFO across the product's active InventoryBatch rows (oldest
RECEIVED_DATE first), recording exactly one InventoryMovement per
product referencing the assignment (REFERENCE_TYPE=
"CUSTOMER_PROJECT_ASSIGNMENT") so /inventory-items' Movements tab and
the Inventory Movements filters (Part 11) can show "which customer
project consumed this stock."

Insufficient-stock policy: consumption is allowed to drive CURRENT_QTY
negative rather than block production — the system's actual answer to a
shortage is the low-stock reorder automation (inventory_reorder_service),
not halting a customer's already-scheduled project. A shortage is only
logged, never raised. This mirrors _derive_suggested_start()'s own
manpower-shortage philosophy (approve as-is with a partial assignment
rather than hard-blocking).
"""

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import ProjectProductRequirement, CustomerProjectAssignment, Project
from app.models.inventory_models import InventoryBatch
from app.services.inventory_automation_service import record_movement, get_latest_unit_cost

log = logging.getLogger(__name__)


def consume_stock_for_assignment(
    db: Session,
    assignment: CustomerProjectAssignment,
    project: Project,
    performed_by_employee_id: Optional[str] = None,
) -> list:
    """Consume every ProjectProductRequirement configured on `project`,
    multiplied by assignment.QUANTITY. Returns the list of created
    InventoryMovement rows (empty if the project has no requirements
    configured). Caller commits — this function only flushes."""

    requirements = (
        db.query(ProjectProductRequirement)
        .filter(ProjectProductRequirement.PROJECT_ID == project.ID)
        .all()
    )
    if not requirements:
        return []

    unit_multiplier = float(assignment.QUANTITY or 1)
    movements = []

    for req in requirements:
        total_needed = float(req.REQUIRED_QTY or 0) * unit_multiplier
        if total_needed <= 0:
            continue

        remaining = total_needed
        batches = (
            db.query(InventoryBatch)
            .filter(
                InventoryBatch.VENDOR_ID == assignment.VENDOR_ID,
                InventoryBatch.PRODUCT_ID == req.PRODUCT_ID,
                InventoryBatch.STATUS == "ACTIVE",
                InventoryBatch.QTY_REMAINING > 0,
            )
            .order_by(InventoryBatch.RECEIVED_DATE.asc(), InventoryBatch.CREATED_AT.asc())
            .with_for_update()
            .all()
        )

        for batch in batches:
            if remaining <= 0:
                break
            take = min(float(batch.QTY_REMAINING), remaining)
            batch.QTY_REMAINING = float(batch.QTY_REMAINING) - take
            if batch.QTY_REMAINING <= 0:
                batch.QTY_REMAINING = 0
                batch.STATUS = "CONSUMED"
            remaining -= take

        if remaining > 0:
            log.warning(
                "consume_stock_for_assignment: product %s short by %.2f units across active "
                "batches for assignment %s (project %s) — recording full consumption anyway, "
                "stock may go negative.",
                req.PRODUCT_ID, remaining, assignment.ID, project.ID,
            )

        movement = record_movement(
            db, assignment.VENDOR_ID, req.PRODUCT_ID, "STOCK_OUT", total_needed,
            performed_by_id=performed_by_employee_id,
            reference_type="CUSTOMER_PROJECT_ASSIGNMENT", reference_id=assignment.ID,
            reason="Production consumption",
            notes=f"Auto-consumed for project '{project.NAME}' (qty x{assignment.QUANTITY or 1})",
            unit_cost=get_latest_unit_cost(db, assignment.VENDOR_ID, req.PRODUCT_ID),
            allow_negative=True,
        )
        if movement.QTY_AFTER < 0:
            log.warning(
                "consume_stock_for_assignment: product %s stock went negative (%.2f) after "
                "consumption for assignment %s.",
                req.PRODUCT_ID, movement.QTY_AFTER, assignment.ID,
            )
        movements.append(movement)

    db.flush()
    return movements
