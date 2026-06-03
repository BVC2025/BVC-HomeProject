"""
Machine monitoring — every manufactured unit auto-becomes a Machine.

Each Work Order with QUANTITY = N spawns N Machine rows on sync
(serial like "CVM-2001-WO0007-U01"). Status starts IDLE; the floor
updates it to RUNNING / DOWN / MAINTENANCE through the UI. Cancelled
WOs are skipped. Sync is idempotent — re-running adds only the new
units that don't have a Machine row yet.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from app.database.database import get_db

from app.models.models import (
    Machine,
    MachineLog,
    Notification,
    WorkOrder,
    ProductModel,
    Project,
    Customer
)

from app.schemas.machine_schema import (
    MachineCreate,
    MachineStatusUpdate
)

router = APIRouter()


VALID_STATUSES = {
    "RUNNING",
    "IDLE",
    "DOWN",
    "MAINTENANCE"
}


def _build_serial(model_code: str | None, wo_number: str | None, unit: int) -> str:
    """Compose a human-readable per-unit serial, e.g.
    'CVM-2001-WO0007-U03'. Falls back to numeric IDs when codes
    are missing so we never return None."""

    code = (model_code or "PROD").replace(" ", "")

    wo_tail = ""

    if wo_number:

        # WO-2026-0007 -> WO0007 (keep the sequence, drop the year)
        parts = wo_number.split("-")

        wo_tail = (
            "WO" + parts[-1]
            if parts and parts[-1].isdigit() else wo_number
        )

    else:

        wo_tail = "WO000"

    return f"{code}-{wo_tail}-U{unit:02d}"


def sync_machines_from_work_orders(db: Session) -> dict:
    """Idempotently create one Machine per unit of every non-cancelled
    Work Order. Returns counts. Safe to call repeatedly — existing
    (WORK_ORDER_ID, UNIT_NUMBER) pairs are skipped."""

    created = 0

    skipped = 0

    wos = (
        db.query(WorkOrder)
        .filter(WorkOrder.STATUS != "CANCELLED")
        .all()
    )

    # Build an index of what already exists so we do a single DB scan
    existing_pairs = {
        (m.WORK_ORDER_ID, m.UNIT_NUMBER)
        for m in db.query(
            Machine.WORK_ORDER_ID,
            Machine.UNIT_NUMBER
        ).filter(Machine.WORK_ORDER_ID.isnot(None)).all()
    }

    for wo in wos:

        model = db.query(ProductModel).filter(
            ProductModel.ID == wo.PRODUCT_MODEL_ID
        ).first()

        project = db.query(Project).filter(
            Project.ID == wo.PROJECT_ID
        ).first() if wo.PROJECT_ID else None

        customer = None

        if project and project.CUSTOMER_ID:

            customer = db.query(Customer).filter(
                Customer.ID == project.CUSTOMER_ID
            ).first()

        location_hint = (
            customer.CUSTOMER_NAME if customer else "Factory floor"
        )

        for unit in range(1, (wo.QUANTITY or 1) + 1):

            if (wo.ID, unit) in existing_pairs:

                skipped += 1

                continue

            serial = _build_serial(
                model.MODEL_CODE if model else None,
                wo.WO_NUMBER,
                unit
            )

            machine_name = (
                f"{model.MODEL_NAME if model else 'Machine'} "
                f"#{unit}/{wo.QUANTITY or 1} · {wo.WO_NUMBER}"
            )

            machine = Machine(
                MACHINE_NAME=machine_name,
                MACHINE_TYPE=(
                    model.CATEGORY if model and model.CATEGORY
                    else "vending"
                ),
                STATUS="IDLE",
                LOCATION=location_hint,
                LAST_UPDATED=datetime.utcnow(),
                VENDOR_ID=wo.VENDOR_ID,
                PRODUCT_MODEL_ID=wo.PRODUCT_MODEL_ID,
                WORK_ORDER_ID=wo.ID,
                UNIT_NUMBER=unit,
                SERIAL_NO=serial
            )

            db.add(machine)

            db.flush()

            db.add(MachineLog(
                MACHINE_ID=machine.ID,
                STATUS="IDLE",
                NOTE=f"Auto-registered from {wo.WO_NUMBER}"
            ))

            created += 1

    db.commit()

    return {"created": created, "skipped": skipped}


def _serialize_machine(
    m: Machine,
    model: ProductModel | None = None,
    wo: WorkOrder | None = None,
    customer_name: str | None = None
) -> dict:

    return {
        "ID": m.ID,
        "MACHINE_NAME": m.MACHINE_NAME,
        "MACHINE_TYPE": m.MACHINE_TYPE,
        "STATUS": m.STATUS,
        "LOCATION": m.LOCATION,
        "LAST_UPDATED": (
            m.LAST_UPDATED.isoformat() if m.LAST_UPDATED else None
        ),
        "VENDOR_ID": m.VENDOR_ID,
        "PRODUCT_MODEL_ID": m.PRODUCT_MODEL_ID,
        "WORK_ORDER_ID": m.WORK_ORDER_ID,
        "UNIT_NUMBER": m.UNIT_NUMBER,
        "SERIAL_NO": m.SERIAL_NO,
        "MODEL_NAME": model.MODEL_NAME if model else None,
        "MODEL_CODE": model.MODEL_CODE if model else None,
        "MODEL_CATEGORY": model.CATEGORY if model else None,
        "WO_NUMBER": wo.WO_NUMBER if wo else None,
        "WO_QUANTITY": wo.QUANTITY if wo else None,
        "CUSTOMER_NAME": customer_name
    }


# =========================
# CREATE MACHINE (manual fallback, kept for backwards compatibility)
# =========================

@router.post("/create-machine")
def create_machine(
    data: MachineCreate,
    db: Session = Depends(get_db)
):

    status = (data.STATUS or "IDLE").upper()

    if status not in VALID_STATUSES:

        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid status. Must be one of: "
                + ", ".join(VALID_STATUSES)
            )
        )

    machine = Machine(
        MACHINE_NAME=data.MACHINE_NAME,
        MACHINE_TYPE=data.MACHINE_TYPE,
        LOCATION=data.LOCATION,
        STATUS=status,
        LAST_UPDATED=datetime.utcnow(),
        VENDOR_ID=data.VENDOR_ID
    )

    db.add(machine)

    db.commit()

    db.refresh(machine)

    log = MachineLog(
        MACHINE_ID=machine.ID,
        STATUS=status,
        NOTE="Machine registered"
    )

    db.add(log)

    db.commit()

    return {
        "message": "Machine created",
        "machine_id": machine.ID
    }


# =========================
# SYNC FROM WORK ORDERS — the new primary entry point
# =========================

@router.post("/machines/sync")
def sync_machines(db: Session = Depends(get_db)):
    """Create one Machine row per manufactured unit of every active
    Work Order. Idempotent — only adds units that don't have a
    Machine row yet."""

    result = sync_machines_from_work_orders(db)

    return {
        "message": (
            f"Sync complete: {result['created']} new machine(s) "
            f"registered, {result['skipped']} already existed."
        ),
        **result
    }


# =========================
# LIST MACHINES (enriched + auto-sync on first call)
# =========================

@router.get("/machines")
def list_machines(
    db: Session = Depends(get_db),
    auto_sync: bool = True
):
    """Returns every machine with model + work order + customer
    info joined in. Triggers an auto-sync first so any new WOs are
    reflected without a separate button click."""

    if auto_sync:

        try:

            sync_machines_from_work_orders(db)

        except Exception:

            # Sync errors shouldn't block the listing
            db.rollback()

    rows = (
        db.query(Machine, ProductModel, WorkOrder)
        .outerjoin(
            ProductModel, Machine.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .outerjoin(
            WorkOrder, Machine.WORK_ORDER_ID == WorkOrder.ID
        )
        .order_by(Machine.ID.desc())
        .all()
    )

    # Customer name lookup per work order project
    project_ids = {
        wo.PROJECT_ID for _, _, wo in rows if wo and wo.PROJECT_ID
    }

    customer_by_project = {}

    if project_ids:

        for p in db.query(Project).filter(
            Project.ID.in_(project_ids)
        ).all():

            if p.CUSTOMER_ID:

                c = db.query(Customer).filter(
                    Customer.ID == p.CUSTOMER_ID
                ).first()

                if c:

                    customer_by_project[p.ID] = c.CUSTOMER_NAME

    return [
        _serialize_machine(
            m,
            model=model,
            wo=wo,
            customer_name=(
                customer_by_project.get(wo.PROJECT_ID)
                if wo and wo.PROJECT_ID else None
            )
        )
        for m, model, wo in rows
    ]


# =========================
# UPDATE STATUS
# =========================

@router.put("/machine-status/{machine_id}")
def update_status(
    machine_id: int,
    data: MachineStatusUpdate,
    db: Session = Depends(get_db)
):

    status = data.STATUS.upper()

    if status not in VALID_STATUSES:

        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid status. Must be one of: "
                + ", ".join(VALID_STATUSES)
            )
        )

    machine = db.query(Machine).filter(
        Machine.ID == machine_id
    ).first()

    if not machine:

        raise HTTPException(
            status_code=404,
            detail="Machine not found"
        )

    previous = machine.STATUS

    machine.STATUS = status

    machine.LAST_UPDATED = datetime.utcnow()

    log = MachineLog(
        MACHINE_ID=machine.ID,
        STATUS=status,
        NOTE=data.NOTE
    )

    db.add(log)

    if status == "DOWN" and previous != "DOWN":

        notif = Notification(
            TITLE="Machine Down",
            MESSAGE=(
                f"{machine.MACHINE_NAME} is reported "
                "DOWN. Investigate immediately."
            ),
            TYPE="ERROR",
            VENDOR_ID=machine.VENDOR_ID
        )

        db.add(notif)

    elif (
        status == "MAINTENANCE"
        and previous != "MAINTENANCE"
    ):

        notif = Notification(
            TITLE="Machine Maintenance",
            MESSAGE=(
                f"{machine.MACHINE_NAME} entered "
                "maintenance mode."
            ),
            TYPE="WARNING",
            VENDOR_ID=machine.VENDOR_ID
        )

        db.add(notif)

    db.commit()

    return {
        "message": "Machine status updated"
    }


# =========================
# MACHINE LOGS
# =========================

@router.get("/machine-logs/{machine_id}")
def machine_logs(
    machine_id: int,
    db: Session = Depends(get_db)
):

    return db.query(MachineLog).filter(
        MachineLog.MACHINE_ID == machine_id
    ).order_by(
        MachineLog.TIMESTAMP.desc()
    ).limit(50).all()


# =========================
# DELETE MACHINE
# =========================

@router.delete("/delete-machine/{machine_id}")
def delete_machine(
    machine_id: int,
    db: Session = Depends(get_db)
):

    machine = db.query(Machine).filter(
        Machine.ID == machine_id
    ).first()

    if not machine:

        raise HTTPException(
            status_code=404,
            detail="Machine not found"
        )

    db.query(MachineLog).filter(
        MachineLog.MACHINE_ID == machine_id
    ).delete()

    db.delete(machine)

    db.commit()

    return {
        "message": "Machine deleted"
    }
