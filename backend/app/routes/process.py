"""
Process Stage endpoints — the per-machine manufacturing flow.

Provides:
  - CRUD for ProcessStage (per ProductModel)
  - Auto-spawn of WorkOrderStageProgress rows when a Work Order
    is created (called via POST /process/spawn-for-wo)
  - Per-WO stage list + status updates (✓ DONE or ✗ FAILED)
  - BOM item type updates (PURCHASE / PROCESS + linkages)
"""

from datetime import datetime, timedelta, date, time
from math import ceil
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database.database import get_db

from app.models.models import (
    ProcessStage,
    WorkOrderStageProgress,
    WorkOrder,
    ProductModel,
    Employee,
    BOMItem,
    Supplier,
    Role,
    Department,
    Designation
)

from app.schemas.process_schema import (
    ProcessStageCreate,
    ProcessStageUpdate,
    WOStageProgressUpdate,
    BOMItemTypeUpdate
)


router = APIRouter(prefix="/process", tags=["Process Stages"])


VALID_STAGE_TYPES = {
    "DESIGN", "MECHANICAL", "ELECTRICAL", "WIRING",
    "FABRICATION", "ASSEMBLY", "TESTING", "QC",
    "PACKAGING", "OTHER"
}

VALID_PROGRESS_STATUSES = {
    "PENDING", "IN_PROGRESS", "DONE", "FAILED", "SKIPPED"
}

VALID_ITEM_TYPES = {"PURCHASE", "PROCESS"}


# ----------------------------------------------------------------
# Serializers
# ----------------------------------------------------------------

def _serialize_stage(s: ProcessStage) -> dict:

    return {
        "ID": s.ID,
        "PRODUCT_MODEL_ID": s.PRODUCT_MODEL_ID,
        "SEQUENCE": s.SEQUENCE,
        "STAGE_NAME": s.STAGE_NAME,
        "STAGE_TYPE": s.STAGE_TYPE,
        "DESCRIPTION": s.DESCRIPTION,
        "ESTIMATED_HOURS": s.ESTIMATED_HOURS,
        "IS_ACTIVE": s.IS_ACTIVE
    }


def _serialize_progress(
    p: WorkOrderStageProgress,
    stage: Optional[ProcessStage] = None,
    assignee: Optional[Employee] = None
) -> dict:

    return {
        "ID": p.ID,
        "WORK_ORDER_ID": p.WORK_ORDER_ID,
        "STAGE_ID": p.STAGE_ID,
        "STAGE_NAME": stage.STAGE_NAME if stage else None,
        "STAGE_TYPE": stage.STAGE_TYPE if stage else None,
        "SEQUENCE": stage.SEQUENCE if stage else None,
        "ESTIMATED_HOURS": stage.ESTIMATED_HOURS if stage else None,
        "STATUS": p.STATUS,
        "ASSIGNED_TO_ID": p.ASSIGNED_TO_ID,
        "ASSIGNEE_NAME": assignee.NAME if assignee else None,
        "STARTED_AT": (
            p.STARTED_AT.isoformat() if p.STARTED_AT else None
        ),
        "COMPLETED_AT": (
            p.COMPLETED_AT.isoformat() if p.COMPLETED_AT else None
        ),
        "NOTES": p.NOTES,
        "UPDATED_AT": (
            p.UPDATED_AT.isoformat() if p.UPDATED_AT else None
        )
    }


# ----------------------------------------------------------------
# ProcessStage CRUD
# ----------------------------------------------------------------

@router.post("/stages")
def create_stage(
    data: ProcessStageCreate,
    db: Session = Depends(get_db)
):

    if data.STAGE_TYPE not in VALID_STAGE_TYPES:

        raise HTTPException(
            status_code=400,
            detail=f"STAGE_TYPE must be one of {sorted(VALID_STAGE_TYPES)}"
        )

    if not db.query(ProductModel).filter(
        ProductModel.ID == data.PRODUCT_MODEL_ID
    ).first():

        raise HTTPException(status_code=404, detail="Model not found")

    stage = ProcessStage(**data.dict(), IS_ACTIVE=1)

    db.add(stage)

    db.commit()

    db.refresh(stage)

    return {
        "message": "Stage created",
        "stage": _serialize_stage(stage)
    }


@router.get("/stages/{model_id}")
def list_stages_for_model(
    model_id: int,
    include_inactive: bool = False,
    db: Session = Depends(get_db)
):

    q = db.query(ProcessStage).filter(
        ProcessStage.PRODUCT_MODEL_ID == model_id
    )

    if not include_inactive:

        q = q.filter(ProcessStage.IS_ACTIVE == 1)

    rows = q.order_by(ProcessStage.SEQUENCE, ProcessStage.ID).all()

    return [_serialize_stage(s) for s in rows]


@router.patch("/stages/{stage_id}")
def update_stage(
    stage_id: int,
    data: ProcessStageUpdate,
    db: Session = Depends(get_db)
):

    stage = db.query(ProcessStage).filter(
        ProcessStage.ID == stage_id
    ).first()

    if not stage:

        raise HTTPException(status_code=404, detail="Stage not found")

    if data.STAGE_TYPE and data.STAGE_TYPE not in VALID_STAGE_TYPES:

        raise HTTPException(
            status_code=400,
            detail=f"STAGE_TYPE must be one of {sorted(VALID_STAGE_TYPES)}"
        )

    for field, value in data.dict(exclude_unset=True).items():

        setattr(stage, field, value)

    db.commit()

    db.refresh(stage)

    return {
        "message": "Stage updated",
        "stage": _serialize_stage(stage)
    }


@router.delete("/stages/{stage_id}")
def delete_stage(
    stage_id: int,
    db: Session = Depends(get_db)
):

    stage = db.query(ProcessStage).filter(
        ProcessStage.ID == stage_id
    ).first()

    if not stage:

        raise HTTPException(status_code=404, detail="Stage not found")

    stage.IS_ACTIVE = 0

    db.commit()

    return {"message": "Stage deactivated"}


# ----------------------------------------------------------------
# Work Order stage progress
# ----------------------------------------------------------------

@router.post("/spawn-for-wo/{wo_id}")
def spawn_progress_for_wo(
    wo_id: int,
    db: Session = Depends(get_db)
):
    """
    Idempotent: creates one WorkOrderStageProgress row per
    active stage of the WO's model, skipping any that already
    exist. Called automatically when a WO is created (see seed
    and production.py); also callable manually to backfill
    progress rows for WOs that pre-date this module.
    """

    wo = db.query(WorkOrder).filter(WorkOrder.ID == wo_id).first()

    if not wo:

        raise HTTPException(status_code=404, detail="Work order not found")

    stages = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == wo.PRODUCT_MODEL_ID,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    existing_ids = {
        row[0] for row in
        db.query(WorkOrderStageProgress.STAGE_ID)
        .filter(WorkOrderStageProgress.WORK_ORDER_ID == wo_id)
        .all()
    }

    created = 0

    for stage in stages:

        if stage.ID in existing_ids:

            continue

        db.add(WorkOrderStageProgress(
            WORK_ORDER_ID=wo_id,
            STAGE_ID=stage.ID,
            STATUS="PENDING"
        ))

        created += 1

    db.commit()

    return {
        "message": f"Spawned {created} stage progress rows",
        "wo_id": wo_id,
        "created": created,
        "total_stages": len(stages)
    }


@router.post("/wo/{wo_id}/resync-stages")
def resync_wo_stages(
    wo_id: int,
    force: bool = False,
    db: Session = Depends(get_db)
):
    """
    One-click "bring this WO onto the current stage flow".

    Steps:
      1. If the product has fewer ACTIVE stages than the canonical
         catalogue (40), refresh it: soft-disable old stages that
         are still referenced by ANY work order's progress rows,
         hard-delete any that aren't referenced, then insert the
         full catalogue.
      2. Wipe THIS WO's existing WorkOrderStageProgress rows
         (refuses with 409 if any have STARTED/COMPLETED unless
         force=true).
      3. Re-spawn one fresh PENDING progress row per active stage.
    """

    from app.services.stage_catalog import build_stages_for_product, stage_count

    wo = db.query(WorkOrder).filter(WorkOrder.ID == wo_id).first()

    if not wo:

        raise HTTPException(status_code=404, detail="Work order not found")

    # ---- Step 0: protect in-flight WO progress ----

    existing = (
        db.query(WorkOrderStageProgress)
        .filter(WorkOrderStageProgress.WORK_ORDER_ID == wo_id)
        .all()
    )

    if not force:

        in_flight = [
            r for r in existing
            if r.STARTED_AT is not None
            or r.COMPLETED_AT is not None
            or (r.STATUS or "PENDING").upper() not in ("PENDING",)
        ]

        if in_flight:

            raise HTTPException(
                status_code=409,
                detail=(
                    f"Cannot resync: {len(in_flight)} stage(s) already "
                    "started or completed. Pass force=true to override "
                    "(this will erase actuals)."
                )
            )

    # ---- Step 1: refresh the product's stage template if stale ----

    target_count = stage_count()

    product_id = wo.PRODUCT_MODEL_ID

    product = db.query(ProductModel).filter(
        ProductModel.ID == product_id
    ).first()

    active_now = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == product_id,
            ProcessStage.IS_ACTIVE == 1
        )
        .count()
    )

    template_refreshed = False
    template_seeded = 0
    template_soft_disabled = 0
    template_hard_deleted = 0

    if active_now != target_count:

        # Soft-disable all currently-active stages on this product
        # that are referenced anywhere (any WO progress row).
        # Hard-delete unreferenced ones.

        referenced_ids = {
            row[0] for row in
            db.query(WorkOrderStageProgress.STAGE_ID)
            .filter(WorkOrderStageProgress.STAGE_ID.isnot(None))
            .distinct()
            .all()
        }

        product_stages = (
            db.query(ProcessStage)
            .filter(ProcessStage.PRODUCT_MODEL_ID == product_id)
            .all()
        )

        for ps in product_stages:

            if ps.ID in referenced_ids:

                ps.IS_ACTIVE = 0

                template_soft_disabled += 1

            else:

                db.delete(ps)

                template_hard_deleted += 1

        db.flush()

        new_stages = build_stages_for_product(
            product.CATEGORY if product else None
        )

        for s in new_stages:

            db.add(ProcessStage(
                PRODUCT_MODEL_ID=product_id,
                SEQUENCE=s["sequence"],
                STAGE_NAME=s["stage_name"],
                STAGE_TYPE=s["stage_type"],
                ESTIMATED_HOURS=s["estimated_hours"],
                DESCRIPTION=s["description"],
                IS_ACTIVE=1
            ))

            template_seeded += 1

        db.flush()

        template_refreshed = True

    # ---- Step 2: wipe this WO's progress rows ----

    deleted = 0

    for row in existing:

        db.delete(row)

        deleted += 1

    db.flush()

    # ---- Step 3: re-spawn against the now-current active template ----

    stages = (
        db.query(ProcessStage)
        .filter(
            ProcessStage.PRODUCT_MODEL_ID == product_id,
            ProcessStage.IS_ACTIVE == 1
        )
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    created = 0

    for stage in stages:

        db.add(WorkOrderStageProgress(
            WORK_ORDER_ID=wo_id,
            STAGE_ID=stage.ID,
            STATUS="PENDING"
        ))

        created += 1

    db.commit()

    msg_parts = [
        f"Resynced WO {wo.WO_NUMBER}: removed {deleted} old row(s), "
        f"seeded {created} fresh row(s)."
    ]

    if template_refreshed:

        msg_parts.append(
            f"Product template refreshed: {template_soft_disabled} stage(s) "
            f"soft-disabled, {template_hard_deleted} deleted, "
            f"{template_seeded} new stages seeded."
        )

    return {
        "message": " ".join(msg_parts),
        "wo_id": wo_id,
        "deleted": deleted,
        "created": created,
        "forced": force,
        "template_refreshed": template_refreshed,
        "template_seeded": template_seeded,
        "template_soft_disabled": template_soft_disabled,
        "template_hard_deleted": template_hard_deleted
    }


@router.get("/wo/{wo_id}/stages")
def list_wo_progress(
    wo_id: int,
    db: Session = Depends(get_db)
):

    rows = (
        db.query(WorkOrderStageProgress, ProcessStage, Employee)
        .outerjoin(
            ProcessStage,
            WorkOrderStageProgress.STAGE_ID == ProcessStage.ID
        )
        .outerjoin(
            Employee,
            WorkOrderStageProgress.ASSIGNED_TO_ID == Employee.ID
        )
        .filter(WorkOrderStageProgress.WORK_ORDER_ID == wo_id)
        .order_by(ProcessStage.SEQUENCE, WorkOrderStageProgress.ID)
        .all()
    )

    return [
        _serialize_progress(p, stage, emp)
        for p, stage, emp in rows
    ]


@router.get("/employee/{employee_ref}/production-stages")
def employee_production_stages(
    employee_ref: str,
    db: Session = Depends(get_db)
):
    """All WorkOrderStageProgress rows assigned to this employee
    (across every Work Order). Returns PENDING and IN_PROGRESS only
    — completed/failed/skipped stages drop off the list. Enriched
    with WO number, product name, customer name, and project name
    so the employee dashboard can render each card with full
    context without extra calls.

    The employee can be referenced by their UUID or EMPLOYEE_CODE.
    """

    # Resolve the employee — accept either ID or EMPLOYEE_CODE
    emp = db.query(Employee).filter(
        Employee.ID == employee_ref
    ).first()

    if not emp:

        emp = db.query(Employee).filter(
            Employee.EMPLOYEE_CODE == employee_ref.upper()
        ).first()

    if not emp:

        raise HTTPException(
            status_code=404,
            detail=f"Employee '{employee_ref}' not found"
        )

    rows = (
        db.query(
            WorkOrderStageProgress,
            ProcessStage,
            WorkOrder,
            ProductModel
        )
        .join(
            ProcessStage,
            WorkOrderStageProgress.STAGE_ID == ProcessStage.ID
        )
        .join(
            WorkOrder,
            WorkOrderStageProgress.WORK_ORDER_ID == WorkOrder.ID
        )
        .outerjoin(
            ProductModel,
            WorkOrder.PRODUCT_MODEL_ID == ProductModel.ID
        )
        .filter(
            WorkOrderStageProgress.ASSIGNED_TO_ID == emp.ID,
            WorkOrderStageProgress.STATUS.in_(("PENDING", "IN_PROGRESS"))
        )
        .order_by(
            # PENDING first (so today's queue is on top), then by stage seq
            WorkOrderStageProgress.STATUS.desc(),
            ProcessStage.SEQUENCE,
            WorkOrderStageProgress.ID
        )
        .all()
    )

    # Enrich each row with customer + project name (one shared lookup)
    from app.models.models import Project, Customer

    project_ids = {wo.PROJECT_ID for _, _, wo, _ in rows if wo.PROJECT_ID}

    projects = {
        p.ID: p
        for p in db.query(Project).filter(Project.ID.in_(project_ids)).all()
    } if project_ids else {}

    customer_ids = {
        p.CUSTOMER_ID for p in projects.values() if p.CUSTOMER_ID
    }

    customers = {
        c.ID: c
        for c in db.query(Customer).filter(Customer.ID.in_(customer_ids)).all()
    } if customer_ids else {}

    out = []

    for progress, stage, wo, product in rows:

        proj = projects.get(wo.PROJECT_ID) if wo.PROJECT_ID else None

        cust = customers.get(proj.CUSTOMER_ID) if (proj and proj.CUSTOMER_ID) else None

        out.append({
            "WO_STAGE_ID":     progress.ID,
            "WORK_ORDER_ID":   wo.ID,
            "WO_NUMBER":       wo.WO_NUMBER,
            "STAGE_ID":        stage.ID,
            "STAGE_NAME":      stage.STAGE_NAME,
            "STAGE_TYPE":      stage.STAGE_TYPE,
            "SEQUENCE":        stage.SEQUENCE,
            "ESTIMATED_HOURS": stage.ESTIMATED_HOURS,
            "STATUS":          progress.STATUS,
            "STARTED_AT":      progress.STARTED_AT.isoformat() if progress.STARTED_AT else None,
            "COMPLETED_AT":    progress.COMPLETED_AT.isoformat() if progress.COMPLETED_AT else None,
            "NOTES":           progress.NOTES,
            "PRODUCT_NAME":    product.MODEL_NAME if product else None,
            "PRODUCT_CODE":    product.MODEL_CODE if product else None,
            "QUANTITY":        wo.QUANTITY,
            "PROJECT_ID":      proj.ID if proj else None,
            "PROJECT_NAME":    proj.PROJECT_NAME if proj else None,
            "CUSTOMER_NAME":   cust.CUSTOMER_NAME if cust else None,
            "CUSTOMER_CODE":   cust.CUSTOMER_CODE if cust else None,
            "WO_PLANNED_START": (
                wo.PLANNED_START_DATE.isoformat()
                if wo.PLANNED_START_DATE else None
            )
        })

    return {
        "employee_id":   emp.ID,
        "employee_code": emp.EMPLOYEE_CODE,
        "employee_name": emp.NAME,
        "as_of":         datetime.utcnow().isoformat(),
        "total":         len(out),
        "pending":       sum(1 for s in out if s["STATUS"] == "PENDING"),
        "in_progress":   sum(1 for s in out if s["STATUS"] == "IN_PROGRESS"),
        "stages":        out
    }


@router.patch("/wo/{wo_id}/stages/{stage_id}")
def update_wo_stage_progress(
    wo_id: int,
    stage_id: int,
    data: WOStageProgressUpdate,
    db: Session = Depends(get_db)
):

    if data.STATUS not in VALID_PROGRESS_STATUSES:

        raise HTTPException(
            status_code=400,
            detail=f"STATUS must be one of {sorted(VALID_PROGRESS_STATUSES)}"
        )

    progress = (
        db.query(WorkOrderStageProgress)
        .filter(
            WorkOrderStageProgress.WORK_ORDER_ID == wo_id,
            WorkOrderStageProgress.STAGE_ID == stage_id
        )
        .first()
    )

    if not progress:

        raise HTTPException(
            status_code=404,
            detail="Stage progress row not found for this WO"
        )

    prev = progress.STATUS

    progress.STATUS = data.STATUS

    if data.ASSIGNED_TO_ID is not None:

        progress.ASSIGNED_TO_ID = data.ASSIGNED_TO_ID

    now = datetime.utcnow()

    if data.STATUS == "IN_PROGRESS" and not progress.STARTED_AT:

        progress.STARTED_AT = now

    if data.STATUS in ("DONE", "FAILED", "SKIPPED"):

        progress.COMPLETED_AT = now

        if not progress.STARTED_AT:

            progress.STARTED_AT = now

    if data.NOTES:

        progress.NOTES = (
            (progress.NOTES + "\n") if progress.NOTES else ""
        ) + f"[{prev}→{data.STATUS}] {data.NOTES}"

    # ---- Mirror status onto the paired TaskAssignment row ----
    # project_from_product_service creates one TaskAssignment per
    # stage when the project is spawned. Keep that row in sync so
    # the employee's task counters + monthly STAR performance score
    # credit the work the moment the stage is completed.
    paired_task_id = None
    try:

        from app.models.models import TaskAssignment, WorkOrder

        wo = db.query(WorkOrder).filter(WorkOrder.ID == wo_id).first()

        stage = db.query(ProcessStage).filter(
            ProcessStage.ID == stage_id
        ).first()

        if wo and stage and wo.PROJECT_ID and stage.STAGE_NAME:

            # Match by project + stage name fragment — the task
            # is created as f"Stage {SEQUENCE}: {STAGE_NAME}"
            task = (
                db.query(TaskAssignment)
                .filter(TaskAssignment.PROJECT_ID == wo.PROJECT_ID)
                .filter(TaskAssignment.TASK_NAME.contains(stage.STAGE_NAME))
                .first()
            )

            if task:

                mirror = {
                    "PENDING":     "PENDING",
                    "IN_PROGRESS": "IN_PROGRESS",
                    "DONE":        "COMPLETED",
                    "FAILED":      "FAILED",
                    "SKIPPED":     "ON_HOLD",
                }

                task.TASK_STATUS = mirror.get(data.STATUS, task.TASK_STATUS)

                task.UPDATED_AT = now

                if data.STATUS == "IN_PROGRESS" and not task.START_TIME:

                    task.START_TIME = now

                if data.STATUS in ("DONE", "FAILED", "SKIPPED"):

                    task.END_TIME = now

                paired_task_id = task.ID

    except Exception:

        # Don't let mirror-sync failures block the primary update
        pass

    db.commit()

    db.refresh(progress)

    # ---- Post-complete side effects (auto-unlock + point award) ----
    # These are best-effort: any failure here is logged into the
    # response payload but never bubbles up as a 500 to the client.
    post_complete_errors = []
    unlock_result = None
    points_result = None

    if data.STATUS == "DONE":

        # 1) Cascade: unlock & auto-assign the next stage in the WO.
        try:
            from app.services.stage_auto_unlock_service import (
                handle_stage_completed,
            )
            unlock_result = handle_stage_completed(db, progress.ID)
        except Exception as e:
            post_complete_errors.append(
                f"stage_auto_unlock_service.handle_stage_completed: {e!r}"
            )

        # 2) Calculate the points earned by the assignee for this
        #    completion (on-time / early / late bonus or penalty).
        if paired_task_id is not None:
            try:
                from app.services.employee_performance_service import (
                    award_points_on_task_complete,
                )
                points_result = award_points_on_task_complete(
                    db, paired_task_id
                )
            except Exception as e:
                post_complete_errors.append(
                    "employee_performance_service."
                    f"award_points_on_task_complete: {e!r}"
                )

    return {
        "message": f"Stage {prev} → {data.STATUS}",
        "progress": _serialize_progress(progress),
        "unlock_result": unlock_result,
        "points_result": points_result,
        "post_complete_errors": post_complete_errors,
    }


# ----------------------------------------------------------------
# BOM item type update (PURCHASE / PROCESS)
# ----------------------------------------------------------------

@router.get("/wo/{wo_id}/gantt")
def wo_gantt(
    wo_id: int,
    db: Session = Depends(get_db)
):
    """
    Returns a Gantt-ready timeline for a Work Order:
    every stage of the WO with planned + actual datetime ranges
    so the frontend can render horizontal bars on a time axis.

    Planned positioning is sequential by SEQUENCE (start = end
    of previous stage). Actual data overrides planned where
    STARTED_AT / COMPLETED_AT are recorded.

    Working hours: 9 AM – 6 PM (8 productive hours per day).
    Hours overflowing a day spill onto the next day.
    """

    wo = db.query(WorkOrder).filter(WorkOrder.ID == wo_id).first()

    if not wo:

        raise HTTPException(status_code=404, detail="Work order not found")

    rows = (
        db.query(WorkOrderStageProgress, ProcessStage, Employee)
        .join(
            ProcessStage,
            WorkOrderStageProgress.STAGE_ID == ProcessStage.ID
        )
        .outerjoin(
            Employee,
            WorkOrderStageProgress.ASSIGNED_TO_ID == Employee.ID
        )
        .filter(WorkOrderStageProgress.WORK_ORDER_ID == wo_id)
        .order_by(ProcessStage.SEQUENCE)
        .all()
    )

    # ----------------------------------------------------------------
    # No auto-assignment. Stages stay UNASSIGNED until an admin
    # picks an employee manually. We do, however, *clear* any
    # existing assignment that points to a sales-role employee
    # (e.g. "Ragul") so the chart no longer shows them.
    # ----------------------------------------------------------------

    def _is_sales(emp_row):
        """emp_row = (Employee, Department.NAME, Designation.TITLE,
        Role.ROLE_NAME). True if any text hints at a sales role, or
        if the employee is named Ragul (per business rule)."""

        emp, dept_name, des_title, role_name = emp_row

        haystack = " ".join([
            emp.NAME or "",
            emp.OCCUPATION or "",
            emp.SKILLS or "",
            dept_name or "",
            des_title or "",
            role_name or ""
        ]).lower()

        return (
            "sales" in haystack
            or "marketing" in haystack
            or "ragul" in (emp.NAME or "").lower()
        )

    employee_rows = (
        db.query(Employee, Department.NAME, Designation.TITLE, Role.ROLE_NAME)
        .outerjoin(Department, Employee.DEPARTMENT_ID == Department.ID)
        .outerjoin(Designation, Employee.DESIGNATION_ID == Designation.ID)
        .outerjoin(Role, Employee.ROLE_ID == Role.ID)
        .all()
    )

    sales_ids = {er[0].ID for er in employee_rows if _is_sales(er)}

    if sales_ids:

        dirty = False

        for i, (progress, stage, assignee) in enumerate(rows):

            if progress.ASSIGNED_TO_ID in sales_ids:

                progress.ASSIGNED_TO_ID = None

                rows[i] = (progress, stage, None)

                dirty = True

        if dirty:

            db.commit()

    if not rows:

        return {
            "work_order_id": wo_id,
            "wo_number": wo.WO_NUMBER,
            "base_date": (
                (wo.PLANNED_START_DATE or wo.ACTUAL_START_DATE
                 or date.today()).isoformat()
            ),
            "stages": [],
            "total_planned_hours": 0,
            "total_actual_hours": 0,
            "completed_count": 0,
            "failed_count": 0
        }

    base_date = (
        wo.PLANNED_START_DATE
        or wo.ACTUAL_START_DATE
        or date.today()
    )

    DAY_START_HOUR = 9
    DAY_END_HOUR = 18
    HOURS_PER_DAY = 8

    # ----------------------------------------------------------------
    # Duration-aware sequential scheduling.
    # Each stage spans ceil(estimated_hours / 8) working days
    # (Sundays skipped). Stages run back-to-back.
    # Timeline length is sized to cover the full plan + 5-day buffer.
    # ----------------------------------------------------------------

    def _next_working_day(d: date) -> date:
        """Return the first date >= d that is not a Sunday."""

        while d.weekday() == 6:

            d = d + timedelta(days=1)

        return d

    def _add_working_days(start: date, working_days: int) -> date:
        """Return the date that is `working_days` working days AFTER
        `start` (i.e. start counts as day 1 if working_days==1, so
        we return start; if 2 we return the next working day, etc.).
        Sundays are skipped."""

        if working_days <= 1:

            return _next_working_day(start)

        d = _next_working_day(start)

        remaining = working_days - 1

        while remaining > 0:

            d = d + timedelta(days=1)

            if d.weekday() != 6:

                remaining -= 1

        return d

    bars = []

    cursor_date = _next_working_day(base_date)

    total_planned = 0
    total_actual = 0
    completed = 0
    failed = 0

    max_end_offset = 0  # track furthest end-date for timeline sizing

    for progress, stage, assignee in rows:

        est_hours = stage.ESTIMATED_HOURS or HOURS_PER_DAY

        days_allocated = max(1, ceil(est_hours / HOURS_PER_DAY))

        cursor_date = _next_working_day(cursor_date)

        planned_start_date = cursor_date

        planned_end_date = _add_working_days(
            planned_start_date, days_allocated
        )

        planned_start = datetime.combine(
            planned_start_date, time(DAY_START_HOUR, 0)
        )

        planned_end = datetime.combine(
            planned_end_date, time(DAY_END_HOUR, 0)
        )

        day_number = (planned_start_date - base_date).days + 1

        end_offset = (planned_end_date - base_date).days + 1

        if end_offset > max_end_offset:

            max_end_offset = end_offset

        actual_start = progress.STARTED_AT
        actual_end = progress.COMPLETED_AT
        actual_hours = None

        if actual_start and actual_end:

            actual_hours = round(
                (actual_end - actual_start).total_seconds() / 3600, 2
            )

            total_actual += actual_hours

        total_planned += est_hours

        if progress.STATUS == "DONE":

            completed += 1

        elif progress.STATUS == "FAILED":

            failed += 1

        bars.append({
            "stage_id": stage.ID,
            "stage_name": stage.STAGE_NAME,
            "stage_type": stage.STAGE_TYPE,
            "sequence": stage.SEQUENCE,
            "estimated_hours": est_hours,
            "actual_hours": actual_hours,
            "days_allocated": days_allocated,
            "days_span": days_allocated,
            "day_number": day_number,
            "status": progress.STATUS,
            "planned_start": planned_start.isoformat(),
            "planned_end": planned_end.isoformat(),
            "planned_start_date": planned_start_date.isoformat(),
            "planned_end_date": planned_end_date.isoformat(),
            "actual_start": (
                actual_start.isoformat() if actual_start else None
            ),
            "actual_end": (
                actual_end.isoformat() if actual_end else None
            ),
            "notes": progress.NOTES,
            "assignee_id": progress.ASSIGNED_TO_ID,
            "assignee_name": assignee.NAME if assignee else None,
            "assignee_code": (
                assignee.EMPLOYEE_CODE if assignee else None
            )
        })

        # Advance cursor to the day AFTER this stage ends.
        cursor_date = planned_end_date + timedelta(days=1)

    # Timeline header: cover full plan + 5-day buffer, min 30 days.
    TIMELINE_DAYS = max(30, max_end_offset + 5)

    timeline = []

    for i in range(TIMELINE_DAYS):

        d = base_date + timedelta(days=i)

        timeline.append({
            "day_number": i + 1,
            "date": d.isoformat(),
            "weekday": d.strftime("%a"),
            "is_sunday": d.weekday() == 6,
            "is_working_day": d.weekday() != 6
        })

    return {
        "work_order_id": wo_id,
        "wo_number": wo.WO_NUMBER,
        "base_date": base_date.isoformat(),
        "timeline_days": TIMELINE_DAYS,
        "timeline": timeline,
        "stages": bars,
        "total_planned_hours": total_planned,
        "total_actual_hours": round(total_actual, 2),
        "completed_count": completed,
        "failed_count": failed,
        "total_stages": len(bars),
        "wo_status": wo.STATUS
    }


@router.patch("/bom-items/{item_id}/classify")
def classify_bom_item(
    item_id: int,
    data: BOMItemTypeUpdate,
    db: Session = Depends(get_db)
):
    """
    Set whether a BOM line is sourced via PURCHASE (from a
    supplier) or PROCESS (made in-house at a stage), and
    attach the corresponding link.
    """

    if data.ITEM_TYPE not in VALID_ITEM_TYPES:

        raise HTTPException(
            status_code=400,
            detail=f"ITEM_TYPE must be one of {sorted(VALID_ITEM_TYPES)}"
        )

    item = db.query(BOMItem).filter(BOMItem.ID == item_id).first()

    if not item:

        raise HTTPException(status_code=404, detail="BOM item not found")

    if data.ITEM_TYPE == "PURCHASE":

        if data.PREFERRED_SUPPLIER_ID:

            sup = db.query(Supplier).filter(
                Supplier.ID == data.PREFERRED_SUPPLIER_ID
            ).first()

            if not sup:

                raise HTTPException(
                    status_code=404,
                    detail="Preferred supplier not found"
                )

        item.ITEM_TYPE = "PURCHASE"

        item.PREFERRED_SUPPLIER_ID = data.PREFERRED_SUPPLIER_ID

        item.PROCESS_STAGE_ID = None

    else:

        if data.PROCESS_STAGE_ID:

            stage = db.query(ProcessStage).filter(
                ProcessStage.ID == data.PROCESS_STAGE_ID
            ).first()

            if not stage:

                raise HTTPException(
                    status_code=404,
                    detail="Process stage not found"
                )

        item.ITEM_TYPE = "PROCESS"

        item.PROCESS_STAGE_ID = data.PROCESS_STAGE_ID

        item.PREFERRED_SUPPLIER_ID = None

    db.commit()

    db.refresh(item)

    return {
        "message": f"BOM item classified as {item.ITEM_TYPE}",
        "ID": item.ID,
        "ITEM_TYPE": item.ITEM_TYPE,
        "PREFERRED_SUPPLIER_ID": item.PREFERRED_SUPPLIER_ID,
        "PROCESS_STAGE_ID": item.PROCESS_STAGE_ID
    }
